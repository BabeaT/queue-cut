// 实时数据：连接后端 /ws，拿全量状态 + 事件流（插队、结算、叫号……）
import { useEffect, useRef, useState } from "react";

export type QueueRow = {
  uid: number;
  user: string;
  nick: string;
  isBot: boolean;
  pos: number;
  rank: number;
  price: number;
  noYield: boolean;
  pendingPrice: number;
  pendingNoYield: boolean;
  pendingFrom: number;
  frozenIn: number;
  frozenOut: number;
  blocking: number;
};

export type LastCut = {
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
};

export type Stats = {
  cuts: number;
  packets: number;
  toVictim: number;
  refunded: number;
  avgChainMs: number | null;
  txs?: number; // 本场链上交易笔数
  feeMon?: number; // 本场我们代付的 gas 费（MON）
  lastCut: LastCut | null;
  queueLength: number;
};

export type Spotlight = { uid: number; nick: string; user: string; until: number; yield: number; hold: number } | null;

export type LiveState = {
  block: number;
  head: number;
  queue: QueueRow[];
  called: { uid: number; nick: string; user: string }[];
  balances: Record<string, number>;
  status: Record<string, { uid: number; status: "queued" | "called" | "served" | "gone"; reason?: string }>;
  stats: Stats;
  bots: { history: { t: number; frozen: number; profit: number }[]; count: number };
  contract: string;
  forwarder: string;
  leaders: { cutKing: { nick: string; value: number }[]; lieKing: { nick: string; value: number }[] };
  prices: { avg: number; count: number; noYield: number; buckets: { label: string; count: number }[] };
  spotlight: Spotlight;
  reveal?: boolean; // 导演台打开「黄牛场景」：把只排不买的演示账号标出来
  maxJoinsPerBlock?: number;
};

export type CutEvent = {
  type: "cut";
  cutId: number;
  cutter: { uid: number; nick: string; user: string };
  fromPos: number;
  toPos: number;
  total: number;
  victims: { uid: number; nick: string; user: string; amount: number; isBot: boolean }[];
  block: number;
  txHash: string;
  chainMs: number | null;
};

export type SettledEvent = {
  type: "settled";
  rid: number;
  cutter: { uid: number; nick: string; user: string };
  victim: { uid: number; nick: string; user: string; isBot?: boolean };
  amount: number;
  toVictim: boolean;
};

export type LiveEvent =
  | CutEvent
  | SettledEvent
  | { type: "block"; number: number; t: number }
  | { type: "called" | "served"; uid: number; nick: string; user: string }
  | { type: "gone"; uid: number; nick: string; user: string; reason: string }
  | { type: "joined"; uid: number; nick: string; user: string; block: number }
  | { type: "blockStats"; block: number; joins: number; cuts?: number; prices?: number; settles?: number; txs: number; maxJoins?: number }
  | { type: "price"; uid: number; nick: string; user: string; price: number; noYield: boolean; block: number; txHash: string }
  | { type: "reveal"; on: boolean }
  | { type: "spotlight"; spotlight: Spotlight }
  | { type: "cheers"; yield: number; hold: number }
  | { type: "stats"; stats: Stats }
  | { type: "session"; session: number };

type Listener = (e: LiveEvent) => void;

let socket: WebSocket | null = null;
let current: LiveState | null = null;
let block = 0;
const stateSubs = new Set<(s: LiveState) => void>();
const blockSubs = new Set<(b: number) => void>();
const eventSubs = new Set<Listener>();
let connected = false;
const connSubs = new Set<(c: boolean) => void>();

/** 后端地址：前端放 Vercel、后端放别处时，用 VITE_API_BASE 指过去；默认同域 */
export const API = ((import.meta.env.VITE_API_BASE as string | undefined) ?? "").replace(/\/$/, "");

function wsUrl() {
  if (API) return API.replace(/^http/, "ws") + "/ws";
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

/** 被插的手机收到红包后回执：后端用它统计「被插的人多久收到」 */
export function ackCut(cutId: number) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ack", cutId }));
}

/** 发消息给后端（喊话投票等） */
export function sendWs(msg: unknown) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  socket = new WebSocket(wsUrl());
  socket.onopen = () => {
    connected = true;
    connSubs.forEach((f) => f(true));
  };
  socket.onclose = () => {
    connected = false;
    connSubs.forEach((f) => f(false));
    setTimeout(connect, 1000);
  };
  socket.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.type === "state") {
      current = msg.state;
      if (current && current.block > block) block = current.block;
      stateSubs.forEach((f) => f(current!));
      return;
    }
    if (msg.type === "block") {
      if (msg.number > block) {
        block = msg.number;
        blockSubs.forEach((f) => f(block));
      }
    }
    if (msg.type === "stats" && current) {
      current = { ...current, stats: msg.stats };
      stateSubs.forEach((f) => f(current!));
    }
    if (msg.type === "reveal" && current) {
      current = { ...current, reveal: msg.on };
      stateSubs.forEach((f) => f(current!));
    }
    if (msg.type === "spotlight" && current) {
      current = { ...current, spotlight: msg.spotlight };
      stateSubs.forEach((f) => f(current!));
    }
    if (msg.type === "cheers" && current?.spotlight) {
      current = { ...current, spotlight: { ...current.spotlight, yield: msg.yield, hold: msg.hold } };
      stateSubs.forEach((f) => f(current!));
    }
    eventSubs.forEach((f) => f(msg));
  };
}

export function useLive() {
  const [state, setState] = useState<LiveState | null>(current);
  const [isConnected, setConnected] = useState(connected);
  useEffect(() => {
    connect();
    stateSubs.add(setState);
    connSubs.add(setConnected);
    return () => {
      stateSubs.delete(setState);
      connSubs.delete(setConnected);
    };
  }, []);
  return { state, connected: isConnected };
}

export function useBlock() {
  const [b, setB] = useState(block);
  useEffect(() => {
    connect();
    blockSubs.add(setB);
    return () => {
      blockSubs.delete(setB);
    };
  }, []);
  return b;
}

export function useLiveEvents(fn: Listener) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    connect();
    const l: Listener = (e) => ref.current(e);
    eventSubs.add(l);
    return () => {
      eventSubs.delete(l);
    };
  }, []);
}

export const fmt = (n: number, d = 2) => (Math.round(n * 10 ** d) / 10 ** d).toString();
export const short = (a?: string) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");
export const EXPLORER = "https://testnet.monadvision.com";
