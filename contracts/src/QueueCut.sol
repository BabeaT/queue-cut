// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";

/// @title QueueCut — 插队付钱给被插队的人
/// @notice 入队免费；自报让位价或选「不让」；插队按被越过的每个人的让位价分别付钱，遇到「不让」停在他身后；
///         每笔插队钱单独冻结，插队者与被插者都消费才归被插者，任何一方没消费就原路退回插队者。
/// @dev 存储按 Monad MIP-8 的 128 槽一页来排：队列用 uint32 连续数组，用户数据按 uid 连续存，收款记录只追加。
contract QueueCut is ERC2771Context {
    // ───────────────────────── 类型 ─────────────────────────

    enum Status {
        None,
        Queued, // 在队里
        Called, // 被叫号，等核销
        Served, // 已核销 = 已消费
        Gone // 没消费：过号 / 主动退出 / 收摊
    }

    enum GoneReason {
        None,
        Skipped,
        Left,
        Closed
    }

    struct Entry {
        // slot 0
        address user;
        uint32 lastOut; // 作为插队者，最新一条付款记录（链表头）
        uint32 session;
        Status status;
        bool noYield;
        bool pendingNoYield;
        // slot 1
        uint96 price; // 当前生效的让位价
        uint96 pendingPrice;
        uint40 pendingFrom; // 0 = 没有待生效的改价
        // slot 2 —— 插队时被越过的人只改这一个槽（MIP-8：少碰页、少写槽）
        uint96 frozenIn; // 作为被插者还冻结着的钱
        uint96 frozenOut; // 作为插队者还冻结着的钱
        uint32 lastIn; // 作为被插者，最新一条收款记录（链表头）
        uint32 pos; // line 里的绝对下标
    }

    /// @dev 一条记录一个槽：两个链表指针把同一个人的收款、付款串起来，不再为每人单独开数组
    struct Receipt {
        uint32 cutter;
        uint32 victim;
        uint96 amount;
        uint8 state; // 0 冻结，1 已付被插者，2 已退插队者
        uint32 prevIn; // 同一个被插者的上一条
        uint32 prevOut; // 同一个插队者的上一条
    }

    // ───────────────────────── 存储 ─────────────────────────

    uint40 public constant PRICE_DELAY = 2; // 改价 2 块后生效

    address public owner;
    mapping(address => bool) public isClerk;

    uint32 public session = 1;
    bool public closed;

    Entry[] internal entries; // uid -> Entry；uid 0 占位
    uint32[] public line; // 队列，存 uid，0 = 空位
    uint32 public head; // 队首下标

    Receipt[] public receipts;

    mapping(address => uint32) public activeUid; // 本场正在用的 uid
    mapping(address => uint256) public balanceOf; // 排队币（合约内记账）

    uint64 public cutCount;
    uint32 public calledOpen; // 已叫号还没核销/过号的人数

    // ───────────────────────── 事件 ─────────────────────────

    event Joined(uint32 indexed uid, address indexed user, bytes16 nickname, uint32 pos, uint96 price, bool noYield);
    event PriceScheduled(uint32 indexed uid, uint96 price, bool noYield, uint40 effectiveBlock);
    event Cut(
        uint64 indexed cutId,
        uint32 indexed cutter,
        uint32 fromPos,
        uint32 toPos,
        uint96 total,
        uint32[] victims,
        uint96[] amounts
    );
    event Called(uint32 indexed uid);
    event Served(uint32 indexed uid);
    event Gone(uint32 indexed uid, GoneReason reason);
    event Settled(uint32 indexed rid, uint32 indexed cutter, uint32 indexed victim, uint96 amount, bool toVictim);
    event Granted(address indexed user, uint256 amount);
    event SessionStarted(uint32 session);
    event ShopClosed(uint32 session);
    event ClerkSet(address clerk, bool enabled);

    // ───────────────────────── 错误 ─────────────────────────

    error NotOwner();
    error NotClerk();
    error ShopIsClosed();
    error AlreadyQueued();
    error NotQueued();
    error BadTarget();
    error Blocked();
    error OverMaxPay(uint96 total, uint96 maxPay);
    error InsufficientBalance(uint256 have, uint96 need);
    error BadStatus();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyClerk() {
        if (!isClerk[msg.sender] && msg.sender != owner) revert NotClerk();
        _;
    }

    constructor(address trustedForwarder) ERC2771Context(trustedForwarder) {
        owner = msg.sender;
        isClerk[msg.sender] = true;
        entries.push(); // uid 0 占位
        receipts.push(); // rid 0 占位
        emit SessionStarted(session);
    }

    // ───────────────────────── 排队的人 ─────────────────────────

    /// @notice 入队，免费。price = 让位价；noYield = 选「不让」
    function join(uint96 price, bool noYield, bytes16 nickname) external returns (uint32 uid) {
        if (closed) revert ShopIsClosed();
        address u = _msgSender();
        if (_isActive(activeUid[u])) revert AlreadyQueued();

        uid = uint32(entries.length);
        uint32 pos = uint32(line.length);
        entries.push(
            Entry({
                user: u,
                lastOut: 0,
                session: session,
                status: Status.Queued,
                noYield: noYield,
                pendingNoYield: false,
                price: price,
                pendingPrice: 0,
                pendingFrom: 0,
                frozenIn: 0,
                frozenOut: 0,
                lastIn: 0,
                pos: pos
            })
        );
        line.push(uid);
        activeUid[u] = uid;
        emit Joined(uid, u, nickname, pos, price, noYield);
    }

    /// @notice 改让位价或切换「不让」，2 块后生效
    function setPrice(uint96 price, bool noYield) external {
        uint32 uid = activeUid[_msgSender()];
        Entry storage e = entries[uid];
        if (!_isActive(uid) || e.status != Status.Queued) revert NotQueued();
        _applyPending(e);
        uint40 eff = uint40(block.number) + PRICE_DELAY;
        e.pendingPrice = price;
        e.pendingNoYield = noYield;
        e.pendingFrom = eff;
        emit PriceScheduled(uid, price, noYield, eff);
    }

    /// @notice 插队到绝对下标 toPos；遇到「不让」的人停在他身后
    function cut(uint32 toPos, uint96 maxPay) external {
        address u = _msgSender();
        uint32 me = activeUid[u];
        Entry storage e = entries[me];
        if (!_isActive(me) || e.status != Status.Queued) revert NotQueued();
        uint32 from = e.pos;
        if (toPos < head || toPos >= from) revert BadTarget();

        uint32 span = from - toPos;
        uint32[] memory victims = new uint32[](span);
        uint96[] memory amounts = new uint96[](span);
        uint32 n;
        uint96 total;
        uint32 k = from;
        uint32 lastOut = e.lastOut;

        while (k > toPos) {
            uint32 v = line[k - 1];
            if (v != 0) {
                Entry storage ve = entries[v];
                _applyPending(ve);
                if (ve.noYield) break; // 「不让」= 一堵墙
                uint96 p = ve.price;
                uint32 lastIn = ve.lastIn;
                if (p > 0) {
                    total += p;
                    uint32 rid = uint32(receipts.length);
                    receipts.push(
                        Receipt({cutter: me, victim: v, amount: p, state: 0, prevIn: lastIn, prevOut: lastOut})
                    );
                    lastIn = rid;
                    lastOut = rid;
                }
                // 一次写回槽 2：冻结收益 + 收款链表头 + 新位置
                ve.frozenIn += p;
                ve.lastIn = lastIn;
                ve.pos = k;
                victims[n] = v;
                amounts[n] = p;
                n++;
            }
            line[k] = v;
            k--;
        }
        if (k == from) revert Blocked();
        line[k] = me;
        e.pos = k;
        e.lastOut = lastOut;

        if (total > maxPay) revert OverMaxPay(total, maxPay);
        uint256 bal = balanceOf[u];
        if (bal < total) revert InsufficientBalance(bal, total);
        balanceOf[u] = bal - total;
        e.frozenOut += total;

        assembly {
            mstore(victims, n)
            mstore(amounts, n)
        }
        uint64 cutId = ++cutCount;
        emit Cut(cutId, me, from, k, total, victims, amounts);
    }

    /// @notice 主动退出，算没消费
    function leave() external {
        uint32 uid = activeUid[_msgSender()];
        Entry storage e = entries[uid];
        if (!_isActive(uid)) revert NotQueued();
        if (e.status == Status.Queued) line[e.pos] = 0;
        _finish(uid, Status.Gone, GoneReason.Left);
    }

    // ───────────────────────── 店员 ─────────────────────────

    /// @notice 叫号：叫队首的人
    function callNext() external onlyClerk returns (uint32 uid) {
        uint32 len = uint32(line.length);
        uint32 h = head;
        while (h < len && line[h] == 0) h++;
        if (h >= len) {
            head = h;
            return 0;
        }
        uid = line[h];
        line[h] = 0;
        head = h + 1;
        entries[uid].status = Status.Called;
        calledOpen++;
        emit Called(uid);
    }

    /// @notice 核销 = 已消费
    function serve(uint32 uid) external onlyClerk {
        if (entries[uid].status != Status.Called) revert BadStatus();
        _finish(uid, Status.Served, GoneReason.None);
    }

    /// @notice 过号 = 没消费
    function skip(uint32 uid) external onlyClerk {
        if (entries[uid].status != Status.Called) revert BadStatus();
        _finish(uid, Status.Gone, GoneReason.Skipped);
    }

    /// @notice 连叫 n 个号都没来：队首 n 人直接过号（黄牛专场用，一笔交易、同一个块）
    function skipHead(uint32 n) external onlyClerk returns (uint32 skipped) {
        uint32 len = uint32(line.length);
        uint32 h = head;
        while (h < len && skipped < n) {
            uint32 uid = line[h];
            if (uid != 0) {
                line[h] = 0;
                emit Called(uid);
                _finish(uid, Status.Gone, GoneReason.Skipped);
                skipped++;
            }
            h++;
        }
        head = h;
    }

    /// @notice 收摊：队里剩下的人都算没消费；分批处理，返回还剩几个
    function close(uint32 maxCount) external onlyClerk returns (uint32 remaining) {
        closed = true;
        uint32 len = uint32(line.length);
        uint32 h = head;
        uint32 done;
        while (h < len && done < maxCount) {
            uint32 uid = line[h];
            if (uid != 0) {
                line[h] = 0;
                _finish(uid, Status.Gone, GoneReason.Closed);
                done++;
            }
            h++;
        }
        head = h;
        while (h < len) {
            if (line[h] != 0) remaining++;
            h++;
        }
        if (remaining == 0) emit ShopClosed(session);
    }

    // ───────────────────────── 运营 ─────────────────────────

    function grant(address user, uint256 amount) external onlyOwner {
        balanceOf[user] += amount;
        emit Granted(user, amount);
    }

    function grantBatch(address[] calldata users, uint256 amount) external onlyOwner {
        for (uint256 i; i < users.length; i++) {
            balanceOf[users[i]] += amount;
            emit Granted(users[i], amount);
        }
    }

    function setClerk(address clerk, bool enabled) external onlyOwner {
        isClerk[clerk] = enabled;
        emit ClerkSet(clerk, enabled);
    }

    /// @notice 开新一场（彩排后重置）。上一场必须先 close 完。
    function newSession() external onlyOwner {
        if (!closed || calledOpen != 0) revert BadStatus();
        for (uint256 i = head; i < line.length; i++) {
            if (line[i] != 0) revert BadStatus();
        }
        session++;
        closed = false;
        head = uint32(line.length);
        emit SessionStarted(session);
    }

    // ───────────────────────── 只读 ─────────────────────────

    /// @return reachablePos 实际能插到的绝对下标（遇到「不让」会被挡住）
    /// @return total 按现价要付的钱
    /// @return worstTotal 把待生效改价也算进去的最坏情况，前端用它当 maxPay
    /// @return count 越过的人数
    function quoteCut(address user, uint32 toPos)
        external
        view
        returns (uint32 reachablePos, uint96 total, uint96 worstTotal, uint32 count)
    {
        uint32 me = activeUid[user];
        Entry storage e = entries[me];
        if (!_isActive(me) || e.status != Status.Queued) return (0, 0, 0, 0);
        uint32 k = e.pos;
        if (toPos < head || toPos >= k) return (k, 0, 0, 0);
        while (k > toPos) {
            uint32 v = line[k - 1];
            if (v != 0) {
                Entry storage ve = entries[v];
                (uint96 p, bool ny) = _effective(ve);
                if (ny) break;
                uint96 w = p;
                if (ve.pendingFrom != 0 && !ve.pendingNoYield && ve.pendingPrice > w) w = ve.pendingPrice;
                total += p;
                worstTotal += w;
                count++;
            }
            k--;
        }
        reachablePos = k;
    }

    struct View {
        uint32 uid;
        address user;
        uint32 pos;
        uint8 status;
        uint96 price;
        bool noYield;
        uint96 pendingPrice;
        bool pendingNoYield;
        uint40 pendingFrom;
        uint96 frozenIn;
        uint96 frozenOut;
    }

    /// @notice 当前队列里的所有人（按顺序）
    function snapshot() external view returns (uint32 head_, uint256 blockNumber, View[] memory out) {
        uint32 len = uint32(line.length);
        uint32 cnt;
        for (uint32 i = head; i < len; i++) {
            if (line[i] != 0) cnt++;
        }
        out = new View[](cnt);
        uint32 j;
        for (uint32 i = head; i < len; i++) {
            uint32 uid = line[i];
            if (uid == 0) continue;
            out[j++] = _view(uid);
        }
        return (head, block.number, out);
    }

    function entryOf(uint32 uid) external view returns (View memory) {
        return _view(uid);
    }

    function myEntry(address user) external view returns (View memory v, uint256 balance) {
        uint32 uid = activeUid[user];
        if (uid != 0) v = _view(uid);
        balance = balanceOf[user];
    }

    function lineLength() external view returns (uint256) {
        return line.length;
    }

    function entryCount() external view returns (uint256) {
        return entries.length;
    }

    function receiptCount() external view returns (uint256) {
        return receipts.length;
    }

    // ───────────────────────── 内部 ─────────────────────────

    function _isActive(uint32 uid) internal view returns (bool) {
        if (uid == 0) return false;
        Entry storage e = entries[uid];
        return e.session == session && (e.status == Status.Queued || e.status == Status.Called);
    }

    function _effective(Entry storage e) internal view returns (uint96, bool) {
        if (e.pendingFrom != 0 && block.number >= e.pendingFrom) return (e.pendingPrice, e.pendingNoYield);
        return (e.price, e.noYield);
    }

    function _applyPending(Entry storage e) internal {
        if (e.pendingFrom != 0 && block.number >= e.pendingFrom) {
            e.price = e.pendingPrice;
            e.noYield = e.pendingNoYield;
            e.pendingFrom = 0;
        }
    }

    function _view(uint32 uid) internal view returns (View memory v) {
        Entry storage e = entries[uid];
        (uint96 p, bool ny) = _effective(e);
        bool pend = e.pendingFrom != 0 && block.number < e.pendingFrom;
        v = View({
            uid: uid,
            user: e.user,
            pos: e.pos,
            status: uint8(e.status),
            price: p,
            noYield: ny,
            pendingPrice: pend ? e.pendingPrice : 0,
            pendingNoYield: pend ? e.pendingNoYield : false,
            pendingFrom: pend ? e.pendingFrom : 0,
            frozenIn: e.frozenIn,
            frozenOut: e.frozenOut
        });
    }

    /// @dev 一个人有了结果（已消费 / 没消费），结算他作为两种角色的所有收付记录：
    ///      对方也有结果的当场结算；对方还没结果的，等对方有结果时再结算。
    function _finish(uint32 uid, Status result, GoneReason reason) internal {
        Entry storage e = entries[uid];
        if (e.status == Status.Called) calledOpen--;
        e.status = result;
        if (activeUid[e.user] == uid) activeUid[e.user] = 0;
        if (result == Status.Served) emit Served(uid);
        else emit Gone(uid, reason);

        for (uint32 rid = e.lastIn; rid != 0; rid = receipts[rid].prevIn) {
            _trySettle(rid);
        }
        for (uint32 rid = e.lastOut; rid != 0; rid = receipts[rid].prevOut) {
            _trySettle(rid);
        }
    }

    function _trySettle(uint32 rid) internal {
        Receipt storage r = receipts[rid];
        if (r.state != 0) return;
        Entry storage c = entries[r.cutter];
        Entry storage v = entries[r.victim];
        Status cs = c.status;
        Status vs = v.status;
        bool cDone = cs == Status.Served || cs == Status.Gone;
        bool vDone = vs == Status.Served || vs == Status.Gone;
        bool toVictim;
        if (cs == Status.Gone || vs == Status.Gone) {
            toVictim = false; // 任何一方没消费 → 退回插队者
        } else if (cDone && vDone) {
            toVictim = true; // 双方都消费 → 归被插者
        } else {
            return; // 还有一方没结果
        }
        r.state = toVictim ? 1 : 2;
        v.frozenIn -= r.amount;
        c.frozenOut -= r.amount;
        balanceOf[toVictim ? v.user : c.user] += r.amount;
        emit Settled(rid, r.cutter, r.victim, r.amount, toVictim);
    }
}
