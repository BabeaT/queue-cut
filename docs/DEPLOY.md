# queue-cut 部署与现场运维（2026-11-21 15:00）

> 写给：负责部署和现场操作的队员。

## 一、部署形态

| 部分 | 放哪 | 说明 |
|---|---|---|
| 前端（`web/`） | **Vercel** | 静态站，`web/vercel.json` 已配好；环境变量 `VITE_API_BASE` 指向后端地址 |
| 后端（`server/`） | **一个能常驻的 Node 进程** | 中继（持有中继私钥）、WebSocket 推送、事件索引，Vercel 跑不了常驻进程和 WebSocket |
| 合约 | Monad 测试网 | 已部署，见下表 |

后端本身也会把 `web/dist` 当静态文件提供，所以**后端地址直接打开 `/m`、`/screen`、`/stage` 也能用**。Vercel 地址作为正式演示链接；如果现场手机打不开 vercel.app，就让观众扫后端地址的二维码。

## 二、合约（Monad 测试网，Chain ID 10143）

| 合约 | 地址 |
|---|---|
| QueueCut | `0x0Eede199697d4b5a4E6b95c82858989a5525D35c` |
| ERC2771Forwarder | `0x5B73b76D850357E2ffc00cbA44Eb58dC96Dcb8EE` |
| 运营账户（owner、店员） | `0xf1dBCaC3F29C2864938A05Dda33C4bB3Bf83241C` |

## 三、后端启动

```bash
cd server && npm i
PORT=8787 STAGE_KEY=<导演台口令> npx tsx src/index.ts
```

需要 `.secrets/keys.json`（运营、3 个中继、20 个黄牛的私钥，不在仓库里）。

可选环境变量：`RPC_HTTP`（逗号分隔，第一个必须支持 `eth_sendRawTransactionSync`）、`RPC_WS`、`BOT_PRICE`（黄牛让位价，默认 1）。

## 四、前端部署到 Vercel

- Root Directory：`web`
- 允许读取 Root Directory 之外的文件（要用到 `../shared/abi.ts`）
- 环境变量：`VITE_API_BASE=https://<后端地址>`（不带结尾斜杠）
- 命令行：`cd web && npx vercel --prod --token <TOKEN> -e VITE_API_BASE=...`（或 `--build-env`）

## 五、现场运维

| 操作 | 怎么做 |
|---|---|
| 打开导演台 | `<地址>/stage?key=<口令>`，口令会记在本机 |
| 开场前放黄牛 | 导演台「放出黄牛」：20 个号各自上链入队，同块统计会跳 |
| 第一幕 | 队友手机「我要插队」→ 默认插到最前 → 确认 |
| 第二幕 | 导演台队伍列表里点评委那一行的 🔦，评委手机弹出「不让 / 让」，全场手机可以喊话 |
| 第三幕 | 先「叫号 + 核销队首」（插队的队友去柜台拿奶茶），黄牛到了队首后按「第三幕：黄牛一次过号」 |
| 彩排后重置 | 导演台「重置」：过号柜台、收摊（全部退款）、开新一场 |
| 查余额 | 导演台「查各账户 MON 余额」；中继余额低于 0.3 就要补 |
| 补 gas | `cd server && AMOUNT=0.3 npx tsx src/topup.ts`（运营 → 3 个中继）；黄牛：`TARGET=0.5 npx tsx src/fundbots.ts`（运营 → 20 个黄牛，补到 0.5） |
| 冒烟测试 | `cd server && N=3 npx tsx src/e2e.ts`（模拟 3 个手机入队并插队） |

## 六、gas 预算（实测，base fee 约 102 gwei）

| 操作 | gas | MON |
|---|---|---|
| 入队 | 约 27 万 | 约 0.03 |
| 插队，每越过一人 | 约 3.9 万 | 约 0.004 |
| 插队越过 30 人 | 约 106 万 | 约 0.11 |
| 黄牛 20 个号入队 | 20 × 27 万 | 约 0.55（黄牛自己付） |
| 黄牛专场（20 人一次过号） | 一笔 | 约 0.1 |

一场 50 人的演示大约 3–4 MON；彩排两遍加正式一场，准备 10 MON 以上。
