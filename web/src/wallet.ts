// 浏览器内钱包：私钥存 localStorage；操作用 EIP-712 签名后交给后端中继代付 gas
import { encodeFunctionData, parseEther, stringToHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { queueCutAbi, deployment } from "../../shared/abi.ts";
import { API } from "./live.ts";

const KEY = "queuecut.pk";
const NICK = "queuecut.nick";

function load(): Hex {
  try {
    const k = localStorage.getItem(KEY);
    if (k && /^0x[0-9a-fA-F]{64}$/.test(k)) return k as Hex;
  } catch {
    /* 隐私模式 */
  }
  const k = generatePrivateKey();
  try {
    localStorage.setItem(KEY, k);
  } catch {
    /* ignore */
  }
  return k;
}

export const pk = load();
export const account = privateKeyToAccount(pk);
export const address = account.address;

export function getNick(): string {
  try {
    return localStorage.getItem(NICK) ?? "";
  } catch {
    return "";
  }
}
export function setNick(n: string) {
  try {
    localStorage.setItem(NICK, n);
  } catch {
    /* ignore */
  }
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(API + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `请求失败 ${r.status}`);
  return j;
}

export async function onboard() {
  return post("/api/onboard", { address });
}

export type RelayResult = {
  ok: boolean;
  fn: string;
  hash: string;
  block: number;
  gasLimit: number;
  gasUsed: number;
  syncMs: number;
  totalMs: number;
};

async function relay(fn: string, args: unknown[]): Promise<RelayResult> {
  const data = encodeFunctionData({ abi: queueCutAbi, functionName: fn as any, args: args as any });
  const prep = await post("/api/prepare", { from: address, data });
  const message = {
    from: address,
    to: deployment.queueCut as Hex,
    value: 0n,
    gas: BigInt(prep.gas),
    nonce: BigInt(prep.nonce),
    deadline: prep.deadline as number,
    data,
  };
  const signature = await account.signTypedData({
    domain: {
      name: "QueueCutForwarder",
      version: "1",
      chainId: deployment.chainId,
      verifyingContract: deployment.forwarder as Hex,
    },
    types: {
      ForwardRequest: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "gas", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint48" },
        { name: "data", type: "bytes" },
      ],
    },
    primaryType: "ForwardRequest",
    message,
  });
  return post("/api/relay", {
    request: { ...message, value: "0", gas: prep.gas, nonce: prep.nonce, signature },
  });
}

const toWei = (x: number) => parseEther(String(Math.max(0, Math.round(x * 1e6) / 1e6)));

export const actions = {
  join: (price: number, noYield: boolean, nick: string) =>
    relay("join", [toWei(price), noYield, stringToHex(truncateUtf8(nick, 16), { size: 16 })]),
  setPrice: (price: number, noYield: boolean) => relay("setPrice", [toWei(price), noYield]),
  cut: (toPos: number, maxPay: number) => relay("cut", [toPos, toWei(maxPay * 1.0001 + 0.000001)]),
  leave: () => relay("leave", []),
};

function truncateUtf8(s: string, max: number) {
  const enc = new TextEncoder();
  let out = "";
  for (const ch of s) {
    if (enc.encode(out + ch).length > max) break;
    out += ch;
  }
  return out;
}

// 店员台 / 导演台
export function stageKey() {
  const u = new URL(location.href);
  const k = u.searchParams.get("key");
  if (k) {
    try {
      localStorage.setItem("queuecut.stage", k);
    } catch {
      /* ignore */
    }
    return k;
  }
  try {
    return localStorage.getItem("queuecut.stage") ?? "";
  } catch {
    return "";
  }
}
export async function stage(action: string, body: unknown = {}) {
  return post(`/api/stage/${action}`, body, { "x-stage-key": stageKey() });
}

/** 本地报价：按当前快照算插到 targetRank 要付多少、能插到哪（遇到「不让」停下） */
export function quote(
  queue: { uid: number; user: string; pos: number; rank: number; price: number; noYield: boolean; pendingPrice: number; pendingNoYield: boolean; pendingFrom: number }[],
  me: string,
  targetRank: number,
) {
  const i = queue.findIndex((q) => q.user.toLowerCase() === me.toLowerCase());
  if (i < 0) return null;
  let total = 0;
  let worst = 0;
  let count = 0;
  let reach = i;
  for (let k = i - 1; k >= targetRank - 1 && k >= 0; k--) {
    const v = queue[k];
    if (v.noYield) break;
    total += v.price;
    worst += v.pendingFrom && !v.pendingNoYield ? Math.max(v.price, v.pendingPrice) : v.price;
    count++;
    reach = k;
  }
  return { myIndex: i, reachRank: reach + 1, toPos: queue[reach]?.pos ?? queue[i].pos, total, worst, count };
}
