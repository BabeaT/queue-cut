# queue-cut 技术架构（2026-11-21 14:40）

> 写给：参赛队员和写代码的 Agent。产品规则见 [PRD.md](PRD.md)，路演讲法见 [PITCH.md](PITCH.md)。
> 原则：**优先用主办方（Monad Foundation）在《Monad 广州》PPT 里给的工具和能力**，用不上的写明原因。

---

## 一、总体架构

```
 手机 H5（/m）                        大屏（/screen）        店员台 / 导演台（/stage）
 浏览器内钱包，私钥存 localStorage        只读，看实时状态         口令保护
   │ ① EIP-712 签名                      ▲                        │
   │ ② POST /api/relay                   │ WebSocket 推送          │ POST /api/stage/*
   ▼                                     │                        ▼
 ┌──────────────────────── 后端 server（Node + TypeScript，单进程）────────────────────────┐
 │ relayer   3 个中继账户轮流发，每个账户本地记 nonce；用 eth_sendRawTransactionSync 拿回执   │
 │ indexer   WS 订阅新块和合约日志（提议块就推），HTTP 每秒补齐一次，按 txHash+logIndex 去重  │
 │ hub       WebSocket 广播：全量状态、块号、插队、结算、叫号、过号                            │
 │ stage     店员：叫号 / 核销 / 过号 / 收摊；导演：黄牛入队、黄牛专场、开新一场              │
 │ metrics   点击→上链、上链→全场手机回执的毫秒数；gas limit / used                           │
 └──────────────────────────────────────────────────────────────────────────────────────────┘
   │ 两条公共 RPC 线路轮换（fallback）
   ▼
 Monad 测试网（Chain ID 10143，300 ms 出块，600 ms 终局）
   ├─ ERC2771Forwarder（OpenZeppelin）：验签、转发，_msgSender() 是用户本人
   └─ QueueCut：队列、插队、冻结、结算
   ▲
   │ 各自签名、各自付 gas
 黄牛机器人：20 个真实 EOA
```

**为什么手机不直连 RPC**：公共 RPC 每秒只给约 20 次请求，40 部手机加大屏直连一定被限流。所有链上读写都由后端集中做，手机只连我们的 WebSocket。

---

## 二、PPT 里的 Monad 能力和工具，我们怎么用

| PPT 页 | 能力 / 工具 | 我们怎么用 | 用在哪 |
|---|---|---|---|
| 17–19 | **300 ms 出块，600 ms 确定性最终性**（MonadBFT 流水线共识） | 队伍和现实同步：插队、改价、叫号都在一秒内上链。大屏块号每 0.3 秒跳一次 | 全部链上操作；大屏块号、到账毫秒 |
| 20 | **异步执行**（共识只定顺序，执行在独立管线） | 这是 Monad **按 gas limit 收费**的原因。我们每笔交易都先估准 gas，再加 18% 余量，不乱给 limit；大屏同时显示 gas limit 和 used | 中继的 gas 计算；大屏指标 |
| 21 | **乐观并行执行，串行提交** | 改让位价、入队只写自己的数据，互不冲突，适合并行。插队要动整条队伍，**如实说它是串行的** | 路演的「Why Monad」；开场同块统计 |
| 22 | MonadDB（异步 I/O、并发状态访问） | 不直接调用；它是并行执行能落地的底座，路演不展开 | — |
| 23 | **MIP-8 存储按页预热**：128 个连续槽一页，首次读 8100 gas，同页其余每个 100 gas | 合约存储专门按页排：队列是 `uint32[]`，一个槽装 8 个人；用户数据按 uid 连续存；收款记录只追加。插队遍历几十个人，大部分读写落在同一页 | `QueueCut.sol` 存储布局 |
| 23 | 内存线性计费、128 KB 合约上限 | 插队时在内存里收集被越过者的数组（线性计费，不怕）；合约体积远低于上限 | `cut()` |
| 23 | **P256 预编译 0x0100（Passkey）** | 不做（P1）。后续可以用 Passkey 绑定「一机一人」 | — |
| 24 | **协议层抗 MEV**：没有全局 mempool，Cadence 多 proposer，BTX 密文排序 | **叙事核心**：Monad 在协议层不让人偷偷插队；我们在应用层让插队公开、付费，钱给被插的人。我们的口号「在以太坊上插队，钱给了矿工」讲的就是 MEV | 开场金句、Why Monad |
| 26 | **eth_sendRawTransactionSync**：同步返回完整回执 | 中继发每一笔用户交易都用它，一次请求拿到回执，省掉轮询；拿到回执立刻把事件推给全场 | `server/src/index.ts` 的 `submitSync` |
| 26 | 执行事件流（直接从节点流式拿事件） | 需要自己跑节点，现场不具备；改用 RPC 的 WebSocket 订阅（新块 + 合约日志），也是提议块就推 | indexer |
| 27 | 同样的 Solidity、Foundry、viem、JSON-RPC、WebSocket | 全套照搬 | 全部 |
| 28 | **skills.devnads.com 技能包**：水龙头、合约部署、前端部署、索引器 | 已安装 monskills 插件；用它的**水龙头接口**给运营、中继、黄牛账户领 MON；用它的**合约验证接口**一次在 MonadVision、Socialscan、Monadscan 三个浏览器验证源码 | 部署和封版 |
| 29 | docs.monad.xyz/developer-essentials、llms-full.txt | 开工前核对过 Chain ID、RPC、gas 规则、reserve balance、WebSocket 订阅 | 本文第六节 |
| 30 | **viem 2.40+**（原生 `monadTestnet`）、**Monad Foundry** | 前后端都用 viem 2.40.3；合约用 Foundry 1.10 编译、测试、部署 | 全部 |
| 33 | React Native / PWA 模板 | 手机端做成 PWA 风格的 H5（扫码即用、可加到主屏）。官方「代付 gas」模板要求用户先登录 Privy、再接 Pimlico，和「扫码即入队、不用登录」冲突，所以代付 gas 用自己的 ERC-2771 中继 | `/m` |
| 35 | 工具与基础设施目录（不要重复造轮子） | 转发合约直接用 OpenZeppelin 的 `ERC2771Forwarder`，不自己写 | 合约 |
| 37–38 | **创意导师**（mojo） | 已用两轮评审方案，结论写进 PRD | PRD 第十三节 |
| 39 | github.com/monad-developers | 参考官方的 `send-transaction-sync-example` | 中继 |
| 44–45 | 少放幻灯片多演示；不要现场打字 | 演示全程用大屏和手机；合约地址、交易链接都放在大屏和二维码里，不手敲 | 路演 |
| 46 | mojo.devnads.com：测试币领取、提交项目 | 用 mojo-submit 技能提交；截止 18:30 | 封版 |
| 31–32 | x402、ERC-8004 | 和题目无关，不用 | — |
| 36 | 主网沙盒（contract.dev） | 不需要接主网协议，不用 | — |

---

## 三、合约：`contracts/src/QueueCut.sol`

### 3.1 存储

```solidity
struct Entry {                     // 每人 3 个槽，按 uid 连续存（MIP-8 同页）
    address user; uint32 pos; uint32 session; Status status; bool noYield; bool pendingNoYield;   // 槽 0
    uint96 price; uint96 pendingPrice; uint40 pendingFrom;                                       // 槽 1
    uint96 frozenIn; uint96 frozenOut; uint40 joinedBlock;                                       // 槽 2
}
struct Receipt { uint32 cutter; uint32 victim; uint96 amount; uint8 state; }  // 一个槽；0 冻结 1 已付 2 已退

Entry[]   entries;                 // uid → Entry，uid 0 占位
uint32[]  line;                    // 队列，存 uid，0 = 空位（出队不搬数组）
uint32    head;                    // 队首下标，叫号时后移
Receipt[] receipts;                // 只追加
mapping(uint32 => uint32[]) inRc;  // 被插者 → 收款记录
mapping(uint32 => uint32[]) outRc; // 插队者 → 付款记录
mapping(address => uint32)  activeUid;
mapping(address => uint256) balanceOf;  // 排队币（合约内记账）
```

### 3.2 接口

```solidity
// 排队的人（经 Forwarder 代付 gas；黄牛直接调用）
join(uint96 price, bool noYield, bytes16 nickname)
setPrice(uint96 price, bool noYield)          // 2 块后生效
cut(uint32 toPos, uint96 maxPay)              // 遇「不让」停下；超过 maxPay 整笔失败
leave()

// 店员（owner 或 clerk）
callNext() / serve(uid) / skip(uid) / close(maxCount)

// 运营（owner）
grant(user, amount) / grantBatch(users, amount) / setClerk(addr, on) / newSession()

// 只读
quoteCut(user, toPos) → (reachablePos, total, worstTotal, count)
snapshot() → (head, blockNumber, View[])
myEntry(user) / entryOf(uid) / lineLength() / receiptCount()
```

### 3.3 插队算法

```
从我的位置 i 往前走到目标 j：
  遇到空位：跟着往后挪
  遇到「不让」：停下，我插在他身后
  遇到其他人：先应用已到期的改价，再按他的让位价记一笔 Receipt（冻结），他往后挪一位
最后检查：总价 ≤ maxPay、余额够，扣款，发一条 Cut 事件（被越过者数组 + 金额数组）
```

### 3.4 结算算法

一个人有了结果（核销 = Served；过号 / 退出 / 收摊 = Gone）时，遍历他的 `inRc` 和 `outRc`：
- 任何一方是 Gone → 退给插队者；
- 双方都是 Served → 付给被插者；
- 对方还没结果 → 先不动，等对方有结果时再结算。

### 3.5 事件

`Joined`、`PriceScheduled`、`Cut(cutId, cutter, fromPos, toPos, total, victims[], amounts[])`、`Called`、`Served`、`Gone(uid, reason)`、`Settled(rid, cutter, victim, amount, toVictim)`、`Granted`、`SessionStarted`、`ShopClosed`。

### 3.6 测试（13 个，全部通过）

20 人队尾插到队首付给 19 人；「不让」是一堵墙；一上来就被挡住要 revert；maxPay 保护；改价 2 块后生效；双方消费付给被插者；被插者过号退回；插队者过号全退；被插者先消费、插队者后消费的延后结算；退出退钱；收摊全部退回且总额守恒；只有店员能叫号；gas 测量。

### 3.7 部署（Monad 测试网）

| 合约 | 地址 |
|---|---|
| QueueCut | `0x1728F192c2a6a5CDfA775520934b7a88DeA96cE6` |
| ERC2771Forwarder（name = `QueueCutForwarder`） | `0x5B73b76D850357E2ffc00cbA44Eb58dC96Dcb8EE` |
| 运营账户（owner / 店员） | `0xf1dBCaC3F29C2864938A05Dda33C4bB3Bf83241C` |

---

## 四、后端：`server/`

### 4.1 HTTP 接口

| 接口 | 说明 |
|---|---|
| `GET /api/config` | 链 ID、合约地址、区块浏览器 |
| `GET /api/state` | 全量状态（同 WebSocket 的 state） |
| `POST /api/onboard {address}` | 首次入队发 100 排队币（每个地址一次） |
| `POST /api/prepare {from, data}` | 返回 Forwarder nonce、内层 gas（按 `eth_estimateGas` ×1.18 + 25k）、deadline |
| `POST /api/relay {request}` | 收到签好名的 ForwardRequest，只允许 `join / setPrice / cut / leave`，每个地址同时只能有一笔；外层 gas = 内层 + 70k；用 `eth_sendRawTransactionSync` 发出，回执里的事件立刻推给全场 |
| `POST /api/stage/{call, serve, skip, act3, close, newSession, botsJoin, botsLeave, balances}` | 店员台和导演台，需要 `x-stage-key` 口令 |

### 4.2 WebSocket（`/ws`）消息

| type | 内容 |
|---|---|
| `state` | 全量：块号、队列（含昵称、是否黄牛、让位价、「不让」、挡住几人、冻结收益）、柜台、余额、状态、统计、黄牛曲线 |
| `block` | 新块号（每 0.3 秒） |
| `cut` | 插队者、起止位置、总价、被越过者数组（昵称、金额）、块号、txHash、链上毫秒 |
| `settled` | 一笔结算：给被插者还是退回插队者 |
| `called` / `served` / `gone` / `joined` | 叫号、核销、过号/退出/收摊、入队 |
| `stats` | 统计更新（含全场手机回执的最慢毫秒） |

手机收到 `cut` 会回一条 `ack`，后端据此统计「全场到账」毫秒数。

### 4.3 发交易的细节（Monad 专项）

- **按 gas limit 收费**：所有交易先估 gas 再加少量余量；店员操作用固定上限。
- **nonce 本地递增**：Monad 的 `pending` 等于 `latest`，没有交易池查询，所以每个发送账户在本地记 nonce，出错就按 `latest` 重新同步。
- **Reserve Balance**：每个账户在途交易的 gas 总额不能超过 min(10 MON, 余额)。3 个中继账户轮流发，各有约 1 MON，足够。
- **事件实时性**：WS 订阅在提议块阶段就推，比回执还快；HTTP 每秒补齐一次，按 `txHash:logIndex` 去重。

---

## 五、前端：`web/`

| 路由 | 说明 |
|---|---|
| `/m` | 手机：入队、我的位置、冻结收益、让位价和「不让」、插队明细、到账提醒（安卓震动，iPhone 声音 + 闪屏） |
| `/screen` | 大屏：队列动画、块号、红包特效、结算飞回、黄牛曲线、指标、同块统计、入队二维码 |
| `/stage?key=…` | 店员台和导演台 |

公共模块：`live.ts`（WebSocket 状态和事件流）、`wallet.ts`（浏览器内钱包、EIP-712 签名、中继调用、本地报价）。
技术栈：Vite 6 + React 18 + viem 2.40.3 + qrcode。打包后由后端同一个端口提供静态文件，前后端同域。

---

## 六、Monad 测试网参数（开工前已按官方文档核对）

| 项 | 值 |
|---|---|
| Chain ID | 10143 |
| 出块 / 终局 | 300 ms / 600 ms |
| RPC | `https://testnet-rpc.monad.xyz`、`https://rpc-testnet.monadinfra.com`（各约 20 rps），WebSocket `wss://testnet-rpc.monad.xyz` |
| 浏览器 | testnet.monadvision.com、testnet.monadscan.com |
| 计费 | 按 gas limit；最低 base fee 100 gwei；实测约 102 gwei |
| 单笔 / 单块 gas 上限 | 30M / 150M–200M |
| TIMESTAMP | 精度 1 秒，合约里一律用 `block.number` |

---

## 七、实测数据（14:00）

| 操作 | 链上耗时 | gas |
|---|---|---|
| 入队（经中继） | 0.8–1.0 秒 | 约 28 万 |
| 插队越过 7 人（经中继） | 0.87 秒 | 约 85 万 |
| 本地测试：插队越过 19 人 | — | 约 179 万（EVM 计价，Monad 上以实测为准） |
| 部署两个合约 | — | 约 0.39 MON |

---

## 八、密钥和安全

- 运营、3 个中继、20 个黄牛的私钥只放在 `.secrets/keys.json`，已在 `.gitignore` 里，不进仓库。
- Mojo 凭证在 `.mojo/agent.json`，同样不进仓库。
- 用户私钥只存在自己手机浏览器里。
- 中继只转发本合约的 4 个用户函数；店员台和导演台需要口令。

---

## 九、开发环境说明

- D 盘挂载点不支持修改文件权限，git、npm、Foundry 在上面会失败。所以开发目录在容器里（`~/work/queue-cut`），git 数据在 `~/gitdirs/queue-cut.git`；文档和代码定期同步到 `D:\monad Blitz\queue-cut\` 给队长查看。
- 依赖：Foundry 1.10、Node 24、OpenZeppelin 5.4.0、forge-std（源码直接放在 `contracts/lib/`）。

## 十、启动

```bash
# 合约
cd contracts && forge test
# 后端（默认 8787 端口，口令 STAGE_KEY=blitz）
cd server && npm i && npx tsx src/index.ts
# 前端开发
cd web && npm i && npx vite --host
# 前端打包后由后端提供：cd web && npx vite build
# 冒烟测试：模拟 N 个手机用户入队并插队
cd server && N=5 npx tsx src/e2e.ts
```
