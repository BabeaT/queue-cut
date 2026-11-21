// queue-cut 后端：中继（ERC-2771 代付 gas）+ 索引器（订阅链上事件）+ WebSocket 推送 + 店员/导演台接口
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import {
  createPublicClient,
  http as httpTransport,
  webSocket,
  fallback,
  encodeFunctionData,
  decodeFunctionData,
  formatEther,
  parseEther,
  parseEventLogs,
  decodeErrorResult,
  getAddress,
  hexToString,
  type Address,
  type Hex,
  type Log,
  keccak256,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { queueCutAbi, forwarderAbi, deployment } from "../../shared/abi.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const PORT = Number(process.env.PORT ?? 8787);
const STAGE_KEY = process.env.STAGE_KEY ?? "blitz";
const RPC_HTTP = (process.env.RPC_HTTP ?? "https://testnet-rpc.monad.xyz,https://rpc-testnet.monadinfra.com")
  .split(",")
  .map((s) => s.trim());
const RPC_WS = process.env.RPC_WS ?? "wss://testnet-rpc.monad.xyz";
const GRANT_AMOUNT = parseEther("100");
const BOT_PRICE = parseEther(process.env.BOT_PRICE ?? "1");

const QC = getAddress(deployment.queueCut) as Address;
const FWD = getAddress(deployment.forwarder) as Address;

// 私钥：云上部署用环境变量 KEYS_JSON（整个 keys.json 的内容），本地用 .secrets/keys.json
const keys = JSON.parse(process.env.KEYS_JSON ?? fs.readFileSync(path.join(ROOT, ".secrets/keys.json"), "utf8")) as {
  deployer: { address: string; privateKey: Hex };
  relayers: { address: string; privateKey: Hex }[];
  bots: { address: string; privateKey: Hex }[];
};
const botSet = new Set(keys.bots.map((b) => b.address.toLowerCase()));

const pub = createPublicClient({
  chain: monadTestnet,
  transport: fallback(RPC_HTTP.map((u) => httpTransport(u, { timeout: 10_000, retryCount: 1 }))),
});

// eth_sendRawTransactionSync 只走主 RPC（备用 RPC 不一定支持），失败再退回普通发送 + 等回执
const syncClient = createPublicClient({ chain: monadTestnet, transport: httpTransport(RPC_HTTP[0], { timeout: 12_000, retryCount: 0 }) });
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 23), ...a);
const num = (x: bigint) => Number(formatEther(x));

// ─────────────────────────── 发交易 ───────────────────────────

let baseFee = 100_000_000_000n;
const PRIORITY = 2_000_000_000n;

type Pending = { resolve: (blockNumber: bigint) => void; t: number };
const pendingTx = new Map<string, Pending>(); // txHash -> 等事件

class Sender {
  account: PrivateKeyAccount;
  nonce: number | null = null;
  lock: Promise<unknown> = Promise.resolve();
  busy = 0;
  constructor(pk: Hex) {
    this.account = privateKeyToAccount(pk);
  }
  private async sign(to: Address, data: Hex, gas: bigint) {
    if (this.nonce === null) {
      this.nonce = await pub.getTransactionCount({ address: this.account.address, blockTag: "latest" });
    }
    const nonce = this.nonce;
    const raw = await this.account.signTransaction({
      chainId: monadTestnet.id,
      type: "eip1559",
      to,
      data,
      gas,
      nonce,
      maxFeePerGas: (baseFee * 115n) / 100n + PRIORITY, // Monad 每块 base fee 最多涨 1/28，留 15% 足够；余额要覆盖 limit×maxFee
      maxPriorityFeePerGas: PRIORITY,
    });
    this.nonce = nonce + 1;
    return raw;
  }
  /** 提交但不等回执（同一发送者按 nonce 顺序提交），返回 txHash */
  submit(to: Address, data: Hex, gas: bigint): Promise<Hex> {
    const run = async () => {
      try {
        const raw = await this.sign(to, data, gas);
        return (await pub.request({ method: "eth_sendRawTransaction", params: [raw] })) as Hex;
      } catch (e) {
        this.nonce = null;
        throw e;
      }
    };
    const p = this.lock.then(run, run);
    this.lock = p.catch(() => undefined);
    return p;
  }
  /** 用 Monad 的 eth_sendRawTransactionSync 发送并直接拿回执 */
  submitSync(
    to: Address,
    data: Hex,
    gas: bigint,
    onSigned?: (hash: Hex) => void,
  ): Promise<{ hash: Hex; receipt: any; ms: number }> {
    const run = async () => {
      this.busy++;
      try {
        const raw = await this.sign(to, data, gas);
        const hash = keccak256(raw);
        onSigned?.(hash);
        const t = Date.now();
        try {
          const receipt = (await syncClient.request({
            method: "eth_sendRawTransactionSync" as any,
            params: [raw, 8000] as any,
          })) as any;
          return { hash: receipt.transactionHash as Hex, receipt, ms: Date.now() - t };
        } catch (e) {
          log("sync send failed, fallback:", errMsg(e));
          try {
            await pub.request({ method: "eth_sendRawTransaction", params: [raw] });
          } catch (e2) {
            const m = errMsg(e2).toLowerCase();
            if (!m.includes("known") && !m.includes("nonce too low")) throw e2;
          }
          const r = await pub.waitForTransactionReceipt({ hash, pollingInterval: 250, timeout: 15_000 });
          return {
            hash,
            receipt: { ...r, status: r.status, blockNumber: r.blockNumber, gasUsed: r.gasUsed, logs: r.logs },
            ms: Date.now() - t,
          };
        }
      } catch (e) {
        this.nonce = null;
        throw e;
      } finally {
        this.busy--;
      }
    };
    const p = this.lock.then(run, run);
    this.lock = p.catch(() => undefined);
    return p;
  }
}

const owner = new Sender(keys.deployer.privateKey);
const relayers = keys.relayers.map((r) => new Sender(r.privateKey));
const bots = keys.bots.map((b) => new Sender(b.privateKey));
let rr = 0;
const relayerBal = new Map<Sender, bigint>();
async function refreshRelayerBal() {
  await Promise.all(
    relayers.map(async (r) => relayerBal.set(r, await pub.getBalance({ address: r.account.address }).catch(() => 0n))),
  );
}
setInterval(refreshRelayerBal, 15_000);
refreshRelayerBal();
function pickRelayer(need = 0n) {
  // 先挑余额够（limit×maxFee）的，再挑最闲的；Monad 的 reserve balance 也按这个算
  const ok = relayers.filter((r) => (relayerBal.get(r) ?? 10n ** 18n) > need);
  const pool = ok.length ? ok : [...relayers].sort((a, b) => Number((relayerBal.get(b) ?? 0n) - (relayerBal.get(a) ?? 0n)));
  let best = pool[rr++ % pool.length];
  for (const r of pool) if (r.busy < best.busy) best = r;
  return best;
}

const ERR_ZH: Record<string, string> = {
  Blocked: "被「不让」的人挡住了，插不过去",
  OverMaxPay: "有人刚改了价，超过你确认的上限，请重新看一下价格",
  InsufficientBalance: "钱包余额不够",
  BadTarget: "队伍刚变了，请重新选位置",
  AlreadyQueued: "你已经在队里了",
  NotQueued: "你现在不在队里",
  ShopIsClosed: "已经收摊了",
  BadStatus: "状态不对（可能已经被处理了）",
  NotClerk: "只有店员能操作",
};
async function estimate(from: Address, to: Address, data: Hex, pct = 125n, pad = 10_000n) {
  try {
    const g = await pub.estimateGas({ account: from, to, data });
    return (g * pct) / 100n + pad;
  } catch (e: any) {
    // 把合约的自定义错误翻成中文
    let raw: Hex | undefined;
    e?.walk?.((x: any) => {
      if (typeof x?.data === "string" && x.data.startsWith("0x")) raw = x.data;
      return false;
    });
    if (raw) {
      try {
        const { errorName } = decodeErrorResult({ abi: queueCutAbi, data: raw });
        throw new Error(ERR_ZH[errorName] ?? errorName);
      } catch (inner) {
        if ((inner as Error).message && !(inner as Error).message.includes("not found")) throw inner;
      }
    }
    throw e;
  }
}

async function ownerCall(fn: string, args: unknown[], gas?: bigint) {
  const data = encodeFunctionData({ abi: queueCutAbi, functionName: fn as any, args: args as any });
  const g = gas ?? (await estimate(owner.account.address, QC, data));
  return owner.submit(QC, data, g);
}

// ─────────────────────────── 状态（索引器） ───────────────────────────

type Status = "queued" | "called" | "served" | "gone";
type UserInfo = { uid: number; user: Address; nick: string; status: Status; isBot: boolean; reason?: string };
const users = new Map<number, UserInfo>(); // uid -> info
const balances = new Map<string, bigint>(); // addr(lower) -> 排队币
const granted = new Set<string>();
let snapshotRows: any[] = [];
let head = 0;
let blockNumber = 0n;
let calledUids: number[] = [];
const stats = {
  cuts: 0,
  packets: 0,
  toVictim: 0,
  refunded: 0,
  lastCut: null as null | {
    cutId: number;
    gasUsed: number;
    gasLimit: number;
    chainMs: number | null;
    fanoutMs: number | null;
    acks: number;
    block: number;
    txHash: string;
    victims: number;
    total: number;
  },
  latencies: [] as number[],
};
const botHistory: { t: number; frozen: number; profit: number }[] = [];
const paidBy = new Map<string, bigint>(); // 插队王：花了多少
const gotBy = new Map<string, bigint>(); // 躺赚王：被插收到多少（含冻结）
const nickByAddr = new Map<string, string>();
const blockAgg = new Map<number, { joins: number; cuts: number; prices: number; settles: number; txs: Set<string> }>();
const seenTx = new Set<string>();
let feeWei = 0n; // 我们代付的 gas 费
let reveal = false; // 导演台「黄牛场景」开关
let maxJoinsPerBlock = 0;
type Spot = { uid: number; nick: string; user: string; until: number; yield: number; hold: number } | null;
let spotlight: Spot = null;
const cheerVotes = new Map<string, "yield" | "hold">(); // 每台设备一票，可改票
function bump(m: Map<string, bigint>, k: string, d: bigint) {
  const key = k.toLowerCase();
  m.set(key, (m.get(key) ?? 0n) + d);
}
let blockStatsTimer: NodeJS.Timeout | null = null;
let blockStatsDirty = new Set<number>();
function noteBlock(l: any, isJoin: boolean) {
  seenTx.add(l.transactionHash);
  const b = Number(l.blockNumber);
  if (!b) return;
  let a = blockAgg.get(b);
  if (!a) {
    a = { joins: 0, cuts: 0, prices: 0, settles: 0, txs: new Set() };
    blockAgg.set(b, a);
    if (blockAgg.size > 200) blockAgg.delete(blockAgg.keys().next().value!);
  }
  if (isJoin) a.joins++;
  if (l.eventName === "Cut") a.cuts++;
  if (l.eventName === "PriceScheduled") a.prices++;
  if (l.eventName === "Settled") a.settles++;
  a.txs.add(l.transactionHash);
  if (a.joins > maxJoinsPerBlock) maxJoinsPerBlock = a.joins;
  blockStatsDirty.add(b);
  if (!blockStatsTimer)
    blockStatsTimer = setTimeout(() => {
      blockStatsTimer = null;
      for (const bn of blockStatsDirty) {
        const x = blockAgg.get(bn);
        if (x) broadcast({ type: "blockStats", block: bn, joins: x.joins, cuts: x.cuts, prices: x.prices, settles: x.settles, txs: x.txs.size, maxJoins: maxJoinsPerBlock });
      }
      blockStatsDirty = new Set();
    }, 80);
}
let botProfit = 0n; // 黄牛实际到手（结算给黄牛的钱）

const relayT0 = new Map<string, { t0: number; chainMs?: number; gasLimit?: number }>(); // txHash -> 计时
const cutAck = new Map<number, { sentAt: number; acks: number; maxMs: number }>();

function addBal(addr: string, d: bigint) {
  const k = addr.toLowerCase();
  balances.set(k, (balances.get(k) ?? 0n) + d);
}

function nickOf(uid: number) {
  return users.get(uid)?.nick ?? `#${uid}`;
}

const seenLogs = new Set<string>();
function applyLog(l: any, live: boolean) {
  const key = `${l.transactionHash}:${Number(l.logIndex)}`;
  if (seenLogs.has(key)) return;
  seenLogs.add(key);
  const a = l.args;
  switch (l.eventName) {
    case "Joined": {
      const nick = hexToString(a.nickname as Hex).replace(/\0+$/, "") || `#${a.uid}`;
      users.set(Number(a.uid), {
        uid: Number(a.uid),
        user: a.user,
        nick,
        status: "queued",
        isBot: botSet.has(String(a.user).toLowerCase()),
      });
      nickByAddr.set(String(a.user).toLowerCase(), nick);
      if (live) {
        broadcast({ type: "joined", uid: Number(a.uid), nick, user: a.user, block: Number(l.blockNumber) });
        noteBlock(l, true);
      }
      break;
    }
    case "PriceScheduled": {
      const u = users.get(Number(a.uid));
      if (live)
        broadcast({
          type: "price",
          uid: Number(a.uid),
          nick: nickOf(Number(a.uid)),
          user: u?.user,
          price: num(a.price),
          noYield: a.noYield,
          block: Number(l.blockNumber),
          txHash: l.transactionHash,
        });
      break;
    }
    case "Granted":
      granted.add(String(a.user).toLowerCase());
      addBal(a.user, a.amount);
      break;
    case "Cut": {
      const cutter = users.get(Number(a.cutter));
      if (cutter) {
        addBal(cutter.user, -a.total);
        bump(paidBy, cutter.user, a.total);
      }
      (a.victims as bigint[]).forEach((v, i) => {
        const vu = users.get(Number(v));
        if (vu) bump(gotBy, vu.user, a.amounts[i]);
      });
      stats.cuts++;
      stats.packets += a.victims.length;
      if (live) {
        const timing = relayT0.get(l.transactionHash);
        const now = Date.now();
        const chainMs = timing ? (timing.chainMs ?? now - timing.t0) : null;
        if (chainMs !== null) {
          stats.latencies.push(chainMs);
          if (stats.latencies.length > 50) stats.latencies.shift();
        }
        const cutId = Number(a.cutId);
        cutAck.set(cutId, { sentAt: now, acks: 0, maxMs: 0 });
        stats.lastCut = {
          cutId,
          gasUsed: 0,
          gasLimit: timing?.gasLimit ?? 0,
          chainMs,
          fanoutMs: null,
          acks: 0,
          block: Number(l.blockNumber),
          txHash: l.transactionHash,
          victims: a.victims.length,
          total: num(a.total),
        };
        pub
          .getTransactionReceipt({ hash: l.transactionHash })
          .then((r) => {
            if (stats.lastCut?.cutId === cutId) {
              stats.lastCut.gasUsed = Number(r.gasUsed);
              broadcastStats();
            }
          })
          .catch(() => undefined);
        broadcast({
          type: "cut",
          cutId,
          cutter: { uid: Number(a.cutter), nick: nickOf(Number(a.cutter)), user: cutter?.user },
          fromPos: Number(a.fromPos),
          toPos: Number(a.toPos),
          total: num(a.total),
          victims: (a.victims as bigint[]).map((v, i) => ({
            uid: Number(v),
            nick: nickOf(Number(v)),
            user: users.get(Number(v))?.user,
            amount: num(a.amounts[i]),
            isBot: users.get(Number(v))?.isBot ?? false,
          })),
          block: Number(l.blockNumber),
          txHash: l.transactionHash,
          chainMs,
        });
      }
      break;
    }
    case "Called": {
      const u = users.get(Number(a.uid));
      if (u) u.status = "called";
      if (live) broadcast({ type: "called", uid: Number(a.uid), nick: nickOf(Number(a.uid)), user: u?.user });
      break;
    }
    case "Served": {
      const u = users.get(Number(a.uid));
      if (u) u.status = "served";
      if (live) broadcast({ type: "served", uid: Number(a.uid), nick: nickOf(Number(a.uid)), user: u?.user });
      break;
    }
    case "Gone": {
      const u = users.get(Number(a.uid));
      const reason = ["", "skipped", "left", "closed"][Number(a.reason)] ?? "";
      if (u) {
        u.status = "gone";
        u.reason = reason;
      }
      if (live) broadcast({ type: "gone", uid: Number(a.uid), nick: nickOf(Number(a.uid)), user: u?.user, reason });
      break;
    }
    case "Settled": {
      const c = users.get(Number(a.cutter));
      const v = users.get(Number(a.victim));
      const to = a.toVictim ? v : c;
      if (to) addBal(to.user, a.amount);
      if (a.toVictim) {
        stats.toVictim++;
        if (v?.isBot) botProfit += a.amount;
      } else stats.refunded++;
      if (live)
        broadcast({
          type: "settled",
          rid: Number(a.rid),
          cutter: { uid: Number(a.cutter), nick: nickOf(Number(a.cutter)), user: c?.user },
          victim: { uid: Number(a.victim), nick: nickOf(Number(a.victim)), user: v?.user, isBot: v?.isBot },
          amount: num(a.amount),
          toVictim: a.toVictim,
        });
      break;
    }
    case "SessionStarted":
      // 新的一场：统计、排行榜清零
      stats.cuts = stats.packets = stats.toVictim = stats.refunded = 0;
      stats.lastCut = null;
      stats.latencies = [];
      paidBy.clear();
      gotBy.clear();
      seenTx.clear();
      feeWei = 0n;
      botProfit = 0n;
      botHistory.length = 0;
      maxJoinsPerBlock = 0;
      reveal = false;
      if (live) broadcast({ type: "session", session: Number(a.session) });
      break;
  }
  if (live && l.eventName !== "Joined") noteBlock(l, false);
  const p = pendingTx.get(l.transactionHash);
  if (p) {
    pendingTx.delete(l.transactionHash);
    p.resolve(l.blockNumber);
  }
}

let refreshTimer: NodeJS.Timeout | null = null;
let refreshing = false;
function scheduleRefresh() {
  if (refreshTimer) return;
  refreshTimer = setTimeout(async () => {
    refreshTimer = null;
    if (refreshing) return scheduleRefresh();
    refreshing = true;
    try {
      await refreshSnapshot();
    } catch (e) {
      log("snapshot error", (e as Error).message);
    } finally {
      refreshing = false;
    }
  }, 120);
}

async function refreshSnapshot() {
  const [h, , rows] = (await pub.readContract({ address: QC, abi: queueCutAbi, functionName: "snapshot" })) as any;
  head = Number(h);
  snapshotRows = rows;
  calledUids = [...users.values()].filter((u) => u.status === "called").map((u) => u.uid);
  // 黄牛曲线
  let botFrozen = 0n;
  for (const r of rows) if (botSet.has(String(r.user).toLowerCase())) botFrozen += r.frozenIn;
  botHistory.push({ t: Date.now(), frozen: num(botFrozen), profit: num(botProfit) });
  if (botHistory.length > 600) botHistory.shift();
  broadcast({ type: "state", state: buildState() });
}

function buildState() {
  const queue = snapshotRows.map((r: any, i: number) => {
    const info = users.get(Number(r.uid));
    return {
      uid: Number(r.uid),
      user: r.user,
      nick: info?.nick ?? `#${r.uid}`,
      isBot: info?.isBot ?? false,
      pos: Number(r.pos),
      rank: i + 1,
      price: num(r.price),
      noYield: r.noYield,
      pendingPrice: num(r.pendingPrice),
      pendingNoYield: r.pendingNoYield,
      pendingFrom: Number(r.pendingFrom),
      frozenIn: num(r.frozenIn),
      frozenOut: num(r.frozenOut),
    };
  });
  // 「不让」挡住了多少人：他身后所有人
  queue.forEach((q: any, i: number) => (q.blocking = q.noYield ? queue.length - i - 1 : 0));
  const called = calledUids.map((uid) => ({ uid, nick: nickOf(uid), user: users.get(uid)?.user }));
  const bal: Record<string, number> = {};
  for (const [k, v] of balances) bal[k] = num(v);
  const status: Record<string, { uid: number; status: Status; reason?: string }> = {};
  for (const u of users.values()) {
    const k = u.user.toLowerCase();
    const prev = status[k];
    if (!prev || prev.uid < u.uid) status[k] = { uid: u.uid, status: u.status, reason: u.reason };
  }
  return {
    block: Number(blockNumber),
    head,
    queue,
    called,
    balances: bal,
    status,
    stats: statsView(),
    bots: { history: botHistory.slice(-200), count: keys.bots.length },
    contract: QC,
    forwarder: FWD,
    leaders: leadersView(),
    prices: pricesView(queue),
    spotlight,
    reveal,
    maxJoinsPerBlock,
  };
}

function top(m: Map<string, bigint>) {
  return [...m.entries()]
    .filter(([k]) => !botSet.has(k))
    .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
    .slice(0, 5)
    .map(([k, v]) => ({ nick: nickByAddr.get(k) ?? k.slice(0, 8), value: num(v) }));
}
function leadersView() {
  return { cutKing: top(paidBy), lieKing: top(gotBy) };
}
function pricesView(queue: any[]) {
  const humans = queue.filter((q) => !q.isBot);
  const priced = humans.filter((q) => !q.noYield);
  const avg = priced.length ? priced.reduce((s, q) => s + q.price, 0) / priced.length : 0;
  const edges: [string, number, number][] = [
    ["≤0.2", 0, 0.2],
    ["0.3–0.5", 0.2, 0.5],
    ["0.6–1", 0.5, 1],
    ["1–3", 1, 3],
    [">3", 3, Infinity],
  ];
  const buckets = edges.map(([label, lo, hi]) => ({
    label,
    count: priced.filter((q) => q.price > lo - (lo === 0 ? 1 : 0) && q.price <= hi && !(lo === 0 && q.price > hi)).length,
  }));
  buckets.push({ label: "🧱 不让", count: humans.length - priced.length });
  return { avg: Math.round(avg * 100) / 100, count: priced.length, noYield: humans.length - priced.length, buckets };
}

function statsView() {
  const l = stats.latencies;
  return {
    cuts: stats.cuts,
    packets: stats.packets,
    toVictim: stats.toVictim,
    refunded: stats.refunded,
    avgChainMs: l.length ? Math.round(l.reduce((a, b) => a + b, 0) / l.length) : null,
    lastCut: stats.lastCut,
    queueLength: snapshotRows.length,
    txs: seenTx.size,
    feeMon: Math.round(num(feeWei) * 1000) / 1000,
  };
}

function broadcastStats() {
  broadcast({ type: "stats", stats: statsView() });
}

async function bootstrap() {
  const latest = await pub.getBlockNumber();
  blockNumber = latest;
  let from = BigInt(deployment.deployBlock) - 5n;
  const step = 100n;
  let all: any[] = [];
  while (from <= latest) {
    const to = from + step - 1n > latest ? latest : from + step - 1n;
    const logs = await pub.getContractEvents({ address: QC, abi: queueCutAbi, fromBlock: from, toBlock: to });
    all = all.concat(logs);
    from = to + 1n;
  }
  for (const l of all) applyLog(l, false);
  lastIndexed = latest;
  log(`bootstrap: ${all.length} logs, ${users.size} users`);
  await refreshSnapshot();
}

// 实时：WebSocket 订阅新块和日志；断了就退回 HTTP 轮询
let lastIndexed = 0n;
let polling = false;
async function pollLogs() {
  if (polling) return;
  polling = true;
  try {
    const latest = await pub.getBlockNumber();
    if (latest > blockNumber) blockNumber = latest;
    if (latest > lastIndexed) {
      const from = lastIndexed + 1n;
      const to = latest - from > 99n ? from + 99n : latest;
      const logs = await pub.getContractEvents({ address: QC, abi: queueCutAbi, fromBlock: from, toBlock: to });
      for (const l of logs) applyLog(l, true);
      lastIndexed = to;
      if (logs.length) scheduleRefresh();
    }
  } catch (e) {
    log("poll error", (e as Error).message);
  } finally {
    polling = false;
  }
}

function startLive() {
  const wsc = createPublicClient({ chain: monadTestnet, transport: webSocket(RPC_WS, { keepAlive: true, reconnect: true }) });
  wsc.watchBlocks({
    onBlock: (b) => {
      if (b.number && b.number > blockNumber) blockNumber = b.number;
      if (b.baseFeePerGas) baseFee = b.baseFeePerGas;
      broadcast({ type: "block", number: Number(b.number), t: Date.now() });
    },
    onError: (e) => log("ws block error", e.message),
  });
  // 实时日志：WS 订阅（提议块就推）；HTTP 轮询每秒一次兜底补齐，按 txHash+logIndex 去重
  wsc.watchContractEvent({
    address: QC,
    abi: queueCutAbi,
    onLogs: (logs) => {
      for (const l of logs) applyLog(l, true);
      if (logs.length) scheduleRefresh();
    },
    onError: (e) => log("ws log error", e.message),
  });
  setInterval(pollLogs, 1000);
}

// ─────────────────────────── WebSocket 推送 ───────────────────────────

const server = http.createServer(handle);
const wss = new WebSocketServer({ server, path: "/ws" });
function broadcast(msg: unknown) {
  const s = JSON.stringify(msg);
  for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(s);
}
wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "state", state: buildState() }));
  ws.on("message", (buf) => {
    try {
      const m = JSON.parse(String(buf));
      if (m.type === "cheer" && spotlight && (m.side === "yield" || m.side === "hold")) {
        const who = String(m.address ?? "").toLowerCase() || String((ws as any)._socket?.remoteAddress) + Math.random();
        cheerVotes.set(who, m.side);
        let y = 0;
        let h = 0;
        for (const v of cheerVotes.values()) v === "yield" ? y++ : h++;
        spotlight = { ...spotlight, yield: y, hold: h };
        broadcast({ type: "cheers", yield: y, hold: h });
        return;
      }
      if (m.type === "ack" && typeof m.cutId === "number") {
        const a = cutAck.get(m.cutId);
        if (a) {
          a.acks++;
          a.maxMs = Math.max(a.maxMs, Date.now() - a.sentAt);
          if (stats.lastCut?.cutId === m.cutId) {
            stats.lastCut.acks = a.acks;
            stats.lastCut.fanoutMs = (stats.lastCut.chainMs ?? 0) + a.maxMs;
          }
          broadcastStats();
        }
      }
    } catch {
      /* ignore */
    }
  });
});

// ─────────────────────────── HTTP 接口 ───────────────────────────

const ALLOWED_FN = new Set(["join", "setPrice", "cut", "leave"]);
const inflight = new Set<string>();

async function readBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const s = Buffer.concat(chunks).toString("utf8");
  return s ? JSON.parse(s) : {};
}

function send(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

function errMsg(e: unknown) {
  const m = (e as any)?.shortMessage ?? (e as any)?.message ?? String(e);
  return String(m).split("\n")[0].slice(0, 300);
}

const ttsCache = new Map<string, Promise<Buffer | null>>();
function ttsAudio(text: string): Promise<Buffer | null> {
  let p = ttsCache.get(text);
  if (!p) {
    p = (async () => {
      const q = encodeURIComponent(text);
      const sources = [
        `https://fanyi.baidu.com/gettts?lan=zh&text=${q}&spd=5&source=web`,
        `https://translate.google.com/translate_tts?ie=UTF-8&tl=zh-CN&client=tw-ob&q=${q}`,
      ];
      for (const u of sources) {
        try {
          const r = await fetch(u, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(6000) });
          const ct = r.headers.get("content-type") ?? "";
          if (!r.ok || !ct.includes("audio")) continue;
          const b = Buffer.from(await r.arrayBuffer());
          if (b.length > 2000) return b;
        } catch {
          /* 换下一个来源 */
        }
      }
      return null;
    })();
    ttsCache.set(text, p);
    p.then((b) => {
      if (!b) ttsCache.delete(text);
    });
    if (ttsCache.size > 500) ttsCache.delete(ttsCache.keys().next().value!);
  }
  return p;
}
// 预热常用播报
for (const t of ["欢迎来到插队红包", "Monad 到账，0.5排队币", "Monad 到账，1排队币", "Monad 到账，0.2排队币"]) ttsAudio(t);

async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? "/", "http://x");
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "content-type,x-stage-key",
        "access-control-allow-methods": "GET,POST",
      });
      return res.end();
    }
    if (url.pathname === "/api/config") {
      return send(res, 200, { chainId: monadTestnet.id, queueCut: QC, forwarder: FWD, explorer: "https://testnet.monadvision.com" });
    }
    if (url.pathname === "/api/state") return send(res, 200, buildState());

    // 女声播报：后端合成成 MP3，手机用和金币声同一个音频通道播放（不依赖手机自带朗读）
    if (url.pathname === "/api/tts") {
      const text = (url.searchParams.get("t") ?? "").slice(0, 60);
      if (!text || /[<>{}\\]/.test(text)) return send(res, 400, { error: "bad text" });
      const buf = await ttsAudio(text);
      if (!buf) return send(res, 502, { error: "tts unavailable" });
      res.writeHead(200, { "content-type": "audio/mpeg", "access-control-allow-origin": "*", "cache-control": "public, max-age=86400" });
      return res.end(buf);
    }

    if (url.pathname === "/api/onboard" && req.method === "POST") {
      const { address } = await readBody(req);
      const a = getAddress(address);
      if (granted.has(a.toLowerCase())) return send(res, 200, { ok: true, already: true });
      granted.add(a.toLowerCase());
      try {
        const hash = await ownerCall("grant", [a, GRANT_AMOUNT], 80_000n);
        return send(res, 200, { ok: true, hash });
      } catch (e) {
        granted.delete(a.toLowerCase());
        throw e;
      }
    }

    // 准备签名：返回 forwarder nonce 和内层 gas
    if (url.pathname === "/api/prepare" && req.method === "POST") {
      const { from, data } = await readBody(req);
      const f = getAddress(from);
      const { functionName } = decodeFunctionData({ abi: queueCutAbi, data });
      if (!ALLOWED_FN.has(functionName)) return send(res, 400, { error: "不允许的操作" });
      const [nonce, gas] = await Promise.all([
        pub.readContract({ address: FWD, abi: forwarderAbi, functionName: "nonces", args: [f] }),
        estimate(f, QC, data, 118n, 25_000n),
      ]);
      return send(res, 200, { nonce: nonce.toString(), gas: gas.toString(), deadline: Math.floor(Date.now() / 1000) + 300 });
    }

    // 中继：收到签好名的 ForwardRequest，代付 gas 发出去
    if (url.pathname === "/api/relay" && req.method === "POST") {
      const t0 = Date.now();
      const body = await readBody(req);
      const r = body.request;
      const from = getAddress(r.from);
      if (getAddress(r.to) !== QC) return send(res, 400, { error: "目标合约不对" });
      const { functionName } = decodeFunctionData({ abi: queueCutAbi, data: r.data });
      if (!ALLOWED_FN.has(functionName)) return send(res, 400, { error: "不允许的操作" });
      if (inflight.has(from)) return send(res, 429, { error: "上一笔还在处理，请稍等" });
      inflight.add(from);
      try {
        const reqData = {
          from,
          to: QC,
          value: 0n,
          gas: BigInt(r.gas),
          deadline: Number(r.deadline),
          data: r.data as Hex,
          signature: r.signature as Hex,
        };
        const data = encodeFunctionData({ abi: forwarderAbi, functionName: "execute", args: [reqData] });
        // Monad 按 gas limit 收费：外层 = 内层（已按估算 +18%）+ 转发开销，不再多估一次
        const outerGas = BigInt(r.gas) + 70_000n;
        const relayer = pickRelayer(outerGas * ((baseFee * 115n) / 100n + PRIORITY));
        const sent = await relayer.submitSync(FWD, data, outerGas, (h) =>
          relayT0.set(h, { t0, gasLimit: Number(outerGas) }),
        );
        feeWei += outerGas * (baseFee + PRIORITY);
        const ok = sent.receipt.status === "0x1" || sent.receipt.status === "success";
        if (!ok) log("relay tx reverted", sent.hash);
        // 回执里就有事件，直接推给全场（不等轮询）
        if (ok) {
          const logs = parseEventLogs({ abi: queueCutAbi, logs: sent.receipt.logs, strict: false });
          for (const l of logs) applyLog(l, true);
          if (logs.length) scheduleRefresh();
        }
        return send(res, ok ? 200 : 500, {
          ok,
          fn: functionName,
          hash: sent.hash,
          block: Number(sent.receipt.blockNumber),
          gasLimit: Number(outerGas),
          gasUsed: Number(sent.receipt.gasUsed),
          syncMs: sent.ms,
          totalMs: Date.now() - t0,
        });
      } finally {
        inflight.delete(from);
      }
    }

    // ── 店员台 / 导演台（需要口令） ──
    if (url.pathname.startsWith("/api/stage/")) {
      if (req.headers["x-stage-key"] !== STAGE_KEY && url.searchParams.get("key") !== STAGE_KEY)
        return send(res, 403, { error: "口令不对" });
      const action = url.pathname.slice("/api/stage/".length);
      const body = req.method === "POST" ? await readBody(req) : {};
      return send(res, 200, await stageAction(action, body));
    }

    return serveStatic(url.pathname, res);
  } catch (e) {
    log("api error", url.pathname, errMsg(e));
    return send(res, 500, { error: errMsg(e) });
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ethBalanceAbi = [{ type: "function", name: "getEthBalance", stateMutability: "view", inputs: [{ name: "addr", type: "address" }], outputs: [{ name: "balance", type: "uint256" }] }] as const;
/** 一批演示账号错峰发交易（公共 RPC 每秒只给 20 次请求），失败自动重试 */
async function staggered<T>(items: T[], fn: (x: T) => Promise<Hex>, gapMs = 45): Promise<{ ok: Hex[]; errors: string[] }> {
  const ok: Hex[] = [];
  const errors: string[] = [];
  await Promise.all(
    items.map(async (x, i) => {
      await sleep(i * gapMs);
      for (let k = 0; k < 4; k++) {
        try {
          ok.push(await fn(x));
          return;
        } catch (e) {
          if (k === 3) errors.push(errMsg(e));
          else await sleep(350 + Math.random() * 300);
        }
      }
    }),
  );
  return { ok, errors };
}
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const NICK_A = ["🐼", "🦊", "🐯", "🐸", "🐙", "🦄", "🐳", "🐧", "🦁", "🐨", "🐹", "🐰", "🐻", "🐮", "🐷", "🐵", "🦉", "🍋", "🧋", "🥟"];
const NICK_B = ["阿明", "小红", "大雄", "阿珍", "靓仔", "靓女", "肥仔", "叉烧", "虾饺", "肠粉", "阿强", "小美", "老陈", "阿芳", "细佬", "家姐", "阿杰", "婷婷"];
const randomNick = () => pick(NICK_A) + pick(NICK_B);
function nickHex(nick: string): Hex {
  const nb = new Uint8Array(16);
  const enc = new TextEncoder();
  let out = "";
  for (const ch of nick) {
    if (enc.encode(out + ch).length > 16) break;
    out += ch;
  }
  nb.set(enc.encode(out));
  return ("0x" + Buffer.from(nb).toString("hex")) as Hex;
}
function isActive(addr: string) {
  const a = addr.toLowerCase();
  for (const u of users.values()) if (u.user.toLowerCase() === a && (u.status === "queued" || u.status === "called")) return true;
  return false;
}
async function ensureBotsGranted() {
  const need = bots.map((b) => b.account.address).filter((a) => (balances.get(a.toLowerCase()) ?? 0n) < parseEther("200"));
  if (!need.length) return;
  for (const a of need) addBalOptimistic(a);
  await ownerCall("grantBatch", [need, parseEther("1000")], 80_000n + 45_000n * BigInt(need.length));
  await new Promise((r) => setTimeout(r, 1500));
}
const optimistic = new Set<string>();
function addBalOptimistic(a: string) {
  optimistic.add(a.toLowerCase());
}

async function stageAction(action: string, body: any) {
  switch (action) {
    case "call":
      return { hash: await ownerCall("callNext", [], 200_000n) };
    case "serve":
      return { hash: await ownerCall("serve", [Number(body.uid)]) };
    case "skip":
      return { hash: await ownerCall("skip", [Number(body.uid)]) };
    case "act3": {
      // 黄牛专场：队首连续的黄牛一次性过号（一笔交易、同一个块）；遇到真人停下
      let n = 0;
      for (const r of snapshotRows) {
        if (!botSet.has(String(r.user).toLowerCase())) break;
        n++;
      }
      if (n === 0) return { skipped: 0, note: "队首不是黄牛（先把队首的真人叫号核销）" };
      return { skipped: n, hash: await ownerCall("skipHead", [n]) };
    }
    case "skipHead":
      return { hash: await ownerCall("skipHead", [Number(body.n ?? 1)]) };
    case "callServe": {
      // 叫号并核销队首（真人到柜台）
      const head = snapshotRows[0];
      if (!head) return { note: "队伍是空的" };
      const h1 = await ownerCall("callNext", [], 150_000n);
      const data = encodeFunctionData({ abi: queueCutAbi, functionName: "serve", args: [Number(head.uid)] });
      const h2 = await owner.submit(QC, data, 1_500_000n);
      return { uid: Number(head.uid), hashes: [h1, h2] };
    }
    case "spotlight": {
      const uid = Number(body.uid ?? snapshotRows[0]?.uid);
      const u = users.get(uid);
      if (!u) return { note: "没有这个人" };
      cheerVotes.clear();
      spotlight = { uid, nick: u.nick, user: u.user, until: Date.now() + 1000 * Number(body.seconds ?? 20), yield: 0, hold: 0 };
      broadcast({ type: "spotlight", spotlight });
      return { spotlight };
    }
    case "spotlightOff":
      spotlight = null;
      broadcast({ type: "spotlight", spotlight: null });
      return { ok: true };
    case "reset": {
      // 彩排后重置：过号所有已叫号的人、收摊、开新一场
      const hashes: Hex[] = [];
      for (const c of calledUids) hashes.push(await ownerCall("skip", [c], 1_500_000n));
      const cnt = snapshotRows.length;
      for (let i = 0; i < Math.max(1, Math.ceil(cnt / 40)); i++) hashes.push(await ownerCall("close", [40], 25_000_000n));
      hashes.push(await ownerCall("newSession", [], 3_000_000n));
      spotlight = null;
      broadcast({ type: "spotlight", spotlight: null });
      return { hashes };
    }
    case "close":
      return { hash: await ownerCall("close", [40], 25_000_000n) };
    case "newSession":
      return { hash: await ownerCall("newSession", [], 2_000_000n) };
    case "botsJoin":
    case "addPeople": {
      // 演示账号（最多 20 个）各自用自己的地址上链入队，自付 gas
      await ensureBotsGranted();
      const idle = bots.filter((b) => !isActive(b.account.address));
      const n = Math.min(Number(body.n ?? 20), idle.length);
      const r = await staggered(idle.slice(0, n), (b) => {
        const price = body.price ? parseEther(String(body.price)) : parseEther(pick(["0.2", "0.5", "0.5", "0.5", "1", "1"]));
        const data = encodeFunctionData({ abi: queueCutAbi, functionName: "join", args: [price, false, nickHex(randomNick())] });
        return b.submit(QC, data, 330_000n);
      });
      return { joined: r.ok.length, idleLeft: idle.length - n, errors: r.errors.slice(0, 3) };
    }
    case "botCut": {
      // 让队尾的演示账号插队（真人就能体验被插队）：插到第 toRank 位
      await ensureBotsGranted();
      const q = snapshotRows;
      if (q.length < 2) return { note: "队里人太少" };
      let idx = q.length - 1;
      let bot = bots.find((b) => b.account.address.toLowerCase() === String(q[idx].user).toLowerCase());
      if (!bot) {
        // 队尾是真人：先让一个空闲的演示账号排到队尾
        const idle = bots.find((b) => !isActive(b.account.address));
        if (!idle) return { note: "没有空闲的演示账号了（先清空队伍）" };
        const data = encodeFunctionData({ abi: queueCutAbi, functionName: "join", args: [parseEther("0.5"), false, nickHex(randomNick())] });
        await idle.submit(QC, data, 330_000n);
        bot = idle;
        idx = q.length; // 入队后在最后
      }
      const toRank = Math.max(1, Math.min(Number(body.toRank ?? 1), idx));
      const toPos = Number(q[toRank - 1].pos);
      const span = idx - (toRank - 1);
      const data = encodeFunctionData({ abi: queueCutAbi, functionName: "cut", args: [toPos, parseEther("100000")] });
      const hash = await bot.submit(QC, data, 250_000n + 50_000n * BigInt(span));
      relayT0.set(hash, { t0: Date.now(), gasLimit: Number(250_000n + 50_000n * BigInt(span)) });
      return { hash, toRank, over: span };
    }
    case "botsReprice": {
      // 全场改价：所有在队里的演示账号同时各发一笔改价交易（真上链，各写各的存储）
      const prices = ["0.2", "0.3", "0.5", "0.8", "1", "1.5", "2", "3"];
      const inQ = bots.filter((b) => snapshotRows.some((r: any) => String(r.user).toLowerCase() === b.account.address.toLowerCase()));
      const r = await staggered(
        inQ,
        (b) => {
          const data = encodeFunctionData({ abi: queueCutAbi, functionName: "setPrice", args: [parseEther(pick(prices)), false] });
          return b.submit(QC, data, 130_000n);
        },
        25,
      );
      return { sent: r.ok.length, errors: r.errors.slice(0, 2) };
    }
    case "reveal":
      reveal = body.on ?? !reveal;
      broadcast({ type: "reveal", on: reveal });
      return { reveal };
    case "botsLeave": {
      const out: string[] = [];
      for (const b of bots) {
        const st = [...users.values()].filter((u) => u.user.toLowerCase() === b.account.address.toLowerCase());
        if (!st.some((u) => u.status === "queued")) continue;
        const data = encodeFunctionData({ abi: queueCutAbi, functionName: "leave", args: [] });
        out.push(await b.submit(QC, data, 800_000n));
      }
      return { hashes: out };
    }
    case "balances": {
      const all = [owner, ...relayers, ...bots];
      // 24 个地址并发 getBalance 会撞公共 RPC 每秒 20 次的限额，改成 Multicall3 一次查完
      const r = (await pub.multicall({
        contracts: all.map((s) => ({ address: monadTestnet.contracts.multicall3.address, abi: ethBalanceAbi, functionName: "getEthBalance", args: [s.account.address] }) as const),
        allowFailure: false,
      })) as bigint[];
      return all.map((s, i) => ({ address: s.account.address, mon: num(r[i]) }));
    }
    default:
      throw new Error("unknown action " + action);
  }
}

// ─────────────────────────── 静态文件（前端打包产物） ───────────────────────────

const WEB_DIST = path.resolve(ROOT, "web/dist");
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".mp3": "audio/mpeg",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};
function serveStatic(p: string, res: http.ServerResponse) {
  let f = path.join(WEB_DIST, decodeURIComponent(p));
  if (!f.startsWith(WEB_DIST)) return send(res, 403, { error: "forbidden" });
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(WEB_DIST, "index.html");
  if (!fs.existsSync(f)) return send(res, 404, { error: "web not built" });
  res.writeHead(200, {
    "content-type": MIME[path.extname(f)] ?? "application/octet-stream",
    "cache-control": f.endsWith("index.html") ? "no-cache" : "public, max-age=3600",
  });
  fs.createReadStream(f).pipe(res);
}

// ─────────────────────────── 启动 ───────────────────────────

await bootstrap();
for (const snd of [owner, ...relayers, ...bots]) {
  try {
    snd.nonce = await pub.getTransactionCount({ address: snd.account.address, blockTag: "latest" });
  } catch {
    /* 用到时再取 */
  }
  await sleep(60);
}
startLive();
setInterval(() => {
  if (snapshotRows.length) scheduleRefresh();
}, 3000); // 黄牛曲线和待生效改价需要定期刷新
server.listen(PORT, () => log(`queue-cut server on :${PORT}  contract ${QC}`));
