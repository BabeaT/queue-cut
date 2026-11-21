// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {QueueCut} from "../src/QueueCut.sol";

contract QueueCutTest is Test {
    QueueCut q;
    address[] users;
    uint256 constant GRANT = 100e18;
    uint96 constant P = 0.5e18;

    function setUp() public {
        q = new QueueCut(address(0xF0));
        for (uint256 i; i < 20; i++) {
            address u = address(uint160(0x1000 + i));
            users.push(u);
        }
        q.grantBatch(users, GRANT);
    }

    function _joinAll(uint96 price) internal {
        for (uint256 i; i < users.length; i++) {
            vm.prank(users[i]);
            q.join(price, false, bytes16("u"));
        }
    }

    function _uid(uint256 i) internal view returns (uint32) {
        return q.activeUid(users[i]);
    }

    function _total() internal view returns (uint256 t) {
        for (uint256 i; i < users.length; i++) {
            (QueueCut.View memory v, uint256 bal) = q.myEntry(users[i]);
            t += bal + v.frozenOut;
        }
    }

    /// 里程碑一：20 人队列，队尾插到队首，19 个人各收一笔
    function test_CutFromTailToHeadPays19() public {
        _joinAll(P);
        address last = users[19];
        (uint32 reach, uint96 total,, uint32 count) = q.quoteCut(last, 0);
        assertEq(reach, 0);
        assertEq(count, 19);
        assertEq(total, P * 19);

        vm.prank(last);
        q.cut(0, total);

        assertEq(q.line(0), _uid(19));
        assertEq(q.balanceOf(last), GRANT - P * 19);
        for (uint256 i; i < 19; i++) {
            QueueCut.View memory v = q.entryOf(_uid(i));
            assertEq(v.pos, i + 1);
            assertEq(v.frozenIn, P);
        }
        assertEq(q.receiptCount(), 20); // 含占位 0
    }

    function test_NoYieldIsAWall() public {
        for (uint256 i; i < 10; i++) {
            vm.prank(users[i]);
            q.join(P, i == 4, bytes16("u")); // 第 5 位选「不让」
        }
        (uint32 reach,, , uint32 count) = q.quoteCut(users[9], 0);
        assertEq(reach, 5);
        assertEq(count, 4);
        vm.prank(users[9]);
        q.cut(0, type(uint96).max);
        assertEq(q.line(5), _uid(9)); // 停在「不让」的人身后
        assertEq(q.line(4), _uid(4));
        assertEq(q.balanceOf(users[9]), GRANT - P * 4);
    }

    function test_BlockedImmediatelyReverts() public {
        vm.prank(users[0]);
        q.join(P, true, bytes16("a"));
        vm.prank(users[1]);
        q.join(P, false, bytes16("b"));
        vm.prank(users[1]);
        vm.expectRevert(QueueCut.Blocked.selector);
        q.cut(0, 100e18);
    }

    function test_MaxPayProtects() public {
        _joinAll(P);
        vm.prank(users[19]);
        vm.expectRevert(abi.encodeWithSelector(QueueCut.OverMaxPay.selector, P * 19, P * 19 - 1));
        q.cut(0, P * 19 - 1);
    }

    function test_PriceChangeDelayedTwoBlocks() public {
        _joinAll(P);
        vm.prank(users[18]);
        q.setPrice(5e18, false);
        // 同一块和下一块，旧价有效
        (, uint96 total, uint96 worst,) = q.quoteCut(users[19], 18);
        assertEq(total, P);
        assertEq(worst, 5e18);
        vm.roll(block.number + 1);
        (, total,,) = q.quoteCut(users[19], 18);
        assertEq(total, P);
        vm.roll(block.number + 1);
        (, total,,) = q.quoteCut(users[19], 18);
        assertEq(total, 5e18);
    }

    function test_BothServedPaysVictim() public {
        _joinAll(P);
        vm.prank(users[19]);
        q.cut(0, type(uint96).max);
        // 叫号：插队者先，被插者后
        uint32 c = q.callNext();
        assertEq(c, _uid(19));
        q.serve(c);
        uint32 v = q.callNext();
        assertEq(v, _uid(0));
        q.serve(v);
        assertEq(q.balanceOf(users[0]), GRANT + P);
        assertEq(q.entryOf(v).frozenIn, 0);
    }

    function test_VictimSkippedRefundsCutter() public {
        _joinAll(P);
        vm.prank(users[19]);
        q.cut(0, type(uint96).max);
        q.serve(q.callNext()); // 插队者消费
        uint32 v = q.callNext();
        q.skip(v); // 被插者过号
        assertEq(q.balanceOf(users[0]), GRANT);
        assertEq(q.balanceOf(users[19]), GRANT - P * 19 + P); // 这一笔退回
    }

    function test_CutterSkippedRefundsAll() public {
        _joinAll(P);
        vm.prank(users[19]);
        q.cut(0, type(uint96).max);
        q.skip(q.callNext()); // 插队者没来
        assertEq(q.balanceOf(users[19]), GRANT);
        for (uint256 i; i < 19; i++) {
            assertEq(q.entryOf(_uid(i)).frozenIn, 0);
        }
    }

    function test_VictimServedBeforeCutterSettlesLater() public {
        _joinAll(P);
        // users[19] 插到 1；users[0] 还在队首
        vm.prank(users[19]);
        q.cut(1, type(uint96).max);
        // users[1] 被越过后，自己又插回 users[19] 前面
        vm.prank(users[1]);
        q.cut(1, type(uint96).max);
        // 叫号顺序：0, 1(被插者先消费), 19(插队者后消费)
        q.serve(q.callNext());
        uint32 v = q.callNext();
        assertEq(v, _uid(1));
        q.serve(v);
        // users[19] 付给 users[1] 的那笔还冻结着
        assertGt(q.entryOf(v).frozenIn, 0);
        uint32 c = q.callNext();
        assertEq(c, _uid(19));
        q.serve(c);
        assertEq(q.entryOf(v).frozenIn, 0);
    }

    function test_LeaveRefunds() public {
        _joinAll(P);
        vm.prank(users[19]);
        q.cut(0, type(uint96).max);
        vm.prank(users[5]);
        q.leave();
        assertEq(q.balanceOf(users[19]), GRANT - P * 18);
        // 退出的位置变空，插队时跳过不收钱
        vm.prank(users[10]);
        (,, , uint32 count) = q.quoteCut(users[10], 1);
        assertEq(count, 9); // 位置 1..10 里有一个空位
    }

    function test_CloseRefundsEveryoneAndConserves() public {
        _joinAll(P);
        uint256 before = _total();
        vm.prank(users[19]);
        q.cut(0, type(uint96).max);
        vm.prank(users[10]);
        q.cut(3, type(uint96).max);
        q.serve(q.callNext());
        q.serve(q.callNext());
        q.close(100);
        uint256 after_ = _total();
        assertEq(after_, before);
        q.newSession();
        vm.prank(users[0]);
        q.join(P, false, bytes16("again"));
    }

    function test_OnlyClerk() public {
        _joinAll(P);
        vm.prank(users[0]);
        vm.expectRevert(QueueCut.NotClerk.selector);
        q.callNext();
    }

    function test_GasCut19() public {
        _joinAll(P);
        vm.prank(users[19]);
        uint256 g = gasleft();
        q.cut(0, type(uint96).max);
        emit log_named_uint("gas for cut over 19 people", g - gasleft());
    }
}
