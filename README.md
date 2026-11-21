# queue-cut

> Monad Blitz 广州站 2026 参赛项目

**在以太坊上插队，钱给了矿工；在这里插队，钱给被你插队的每一个人。**

- 入队免费：每人挂一个「让位价」（挂价即同意），也可以选「不让」。
- 补偿式插队：插进去，按被越过的每个人的让位价分别付钱，一笔交易给几十个人记账。
- 双方都消费才结算：插队者和被插者都完成消费，钱才归被插者；任何一方没消费，钱原路退回。
- 位置不能转让：黄牛要么白忙一场，要么变成真顾客。

运行在 Monad 测试网（Chain ID 10143）。

| 文档 | 内容 |
|---|---|
| [docs/PRD.md](docs/PRD.md) | 产品规则（定稿）、页面、演示脚本、评委问答 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 技术架构、合约设计、Monad 能力怎么用 |
| [docs/PITCH.md](docs/PITCH.md) | 产品介绍、Why Monad、怎么做得有趣、三分钟路演 |

## 已部署（Monad 测试网）

| 合约 | 地址 |
|---|---|
| QueueCut | [0x1728F192c2a6a5CDfA775520934b7a88DeA96cE6](https://testnet.monadvision.com/address/0x1728F192c2a6a5CDfA775520934b7a88DeA96cE6) |
| ERC2771Forwarder | [0x5B73b76D850357E2ffc00cbA44Eb58dC96Dcb8EE](https://testnet.monadvision.com/address/0x5B73b76D850357E2ffc00cbA44Eb58dC96Dcb8EE) |

## 目录

| 目录 | 内容 |
|---|---|
| `contracts/` | Solidity 合约（Foundry） |
| `server/` | 中继、索引器、WebSocket 推送 |
| `web/` | 手机端、大屏、店员台、导演台 |
| `bots/` | 黄牛机器人（20 个真实链上账号） |
| `docs/` | 产品方案 |
