// 手机页：扫码入队、我的号、让位价 / 不让、拆红包、点人插队、评委守位喊话
import { useEffect, useMemo, useRef, useState } from "react";
import { useLive, useLiveEvents, useBlock, fmt, EXPLORER, sendWs, ackCut, type QueueRow } from "../live.ts";
import { actions, address, getNick, setNick, onboard } from "../wallet.ts";
import "./mobile.css";

const me = address.toLowerCase();
const AVATARS = ["🐼", "🦊", "🐯", "🐸", "🐙", "🦄", "🐳", "🐧", "🦁", "🐨", "🐹", "🐰", "🐻", "🐮", "🐷", "🐵", "🦉", "🐲", "🍋", "🍑", "🧋", "🥟", "🌶️", "🍜"];
const BOT_AVATAR = "🕶️";
const RANDOM_NAMES = ["靓仔", "靓女", "老细", "阿明", "阿珍", "肥仔", "叉烧", "虾饺", "肠粉", "奶茶", "菠萝包", "煲仔饭"];

export function avatarOf(nick: string, uid: number, scalper = false) {
  if (scalper) return BOT_AVATAR;
  const first = [...nick][0] ?? "";
  if (/\p{Extended_Pictographic}/u.test(first)) return first;
  return AVATARS[uid % AVATARS.length];
}
export function nameOf(nick: string) {
  const chars = [...nick];
  return /\p{Extended_Pictographic}/u.test(chars[0] ?? "") ? chars.slice(1).join("").replace(/^️/, "") : nick;
}

// ── 提醒：安卓震动；iPhone 不支持网页震动，用提示音 + 全屏闪 ──
let audio: AudioContext | null = null;
function unlockAudio() {
  try {
    audio ??= new (window.AudioContext || (window as any).webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
    const o = audio.createOscillator();
    const g = audio.createGain();
    g.gain.value = 0;
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.01);
  } catch {
    /* ignore */
  }
}
function ding(kind: "money" | "call" | "refund" | "cut") {
  try {
    navigator.vibrate?.(kind === "call" ? [300, 120, 300, 120, 300] : kind === "money" ? [80, 50, 80, 50, 200] : [120]);
  } catch {
    /* ignore */
  }
  if (!audio) return;
  const notes =
    kind === "money" ? [988, 1319, 1568, 2093] : kind === "call" ? [880, 660, 880, 660] : kind === "cut" ? [523, 659, 784, 1047] : [523, 392];
  notes.forEach((f, i) => {
    const o = audio!.createOscillator();
    const g = audio!.createGain();
    o.type = kind === "refund" ? "sine" : "triangle";
    o.frequency.value = f;
    const t = audio!.currentTime + i * 0.1;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(audio!.destination);
    o.start(t);
    o.stop(t + 0.13);
  });
}

type Toast = { id: number; text: string; kind: "money" | "refund" | "info" | "error" | "receipt"; href?: string };
type Packet = { id: number; from: string; fromAvatar: string; amount: number; opened: boolean };

export default function Mobile() {
  const { state, connected } = useLive();
  const block = useBlock();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [packets, setPackets] = useState<Packet[]>([]);
  const [flash, setFlash] = useState<null | "money" | "call">(null);
  const [confetti, setConfetti] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [myVote, setMyVote] = useState<"yield" | "hold" | null>(null);
  const toastId = useRef(0);

  const toast = (text: string, kind: Toast["kind"] = "info", href?: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, text, kind, href }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 6000 : 4000);
  };

  const myStatus = state?.status[me];
  const myRow = state?.queue.find((q) => q.user.toLowerCase() === me);
  const balance = state?.balances[me] ?? 0;
  const calledMe = state?.called.some((c) => c.user?.toLowerCase() === me) ?? false;
  const phase: "join" | "queued" | "called" | "served" | "gone" = !myStatus
    ? "join"
    : myStatus.status === "queued" && myRow
      ? "queued"
      : myStatus.status === "called" || calledMe
        ? "called"
        : myStatus.status === "served"
          ? "served"
          : myStatus.status === "gone"
            ? "gone"
            : "join";

  const spot = state?.spotlight && state.spotlight.until > Date.now() - 3000 ? state.spotlight : null;
  useEffect(() => setMyVote(null), [spot?.uid, spot?.until]);

  useLiveEvents((e) => {
    if (e.type === "cut") {
      const v = e.victims.find((x) => x.user?.toLowerCase() === me);
      if (v) {
        ackCut(e.cutId);
        ding("money");
        setFlash("money");
        setTimeout(() => setFlash(null), 900);
        setPackets((p) => [
          ...p,
          { id: e.cutId, from: nameOf(e.cutter.nick), fromAvatar: avatarOf(e.cutter.nick, e.cutter.uid), amount: v.amount, opened: false },
        ]);
      }
      if (e.cutter.user?.toLowerCase() === me) {
        ding("cut");
        setConfetti((c) => c + 1);
        toast(`插队成功！越过 ${e.victims.length} 人，红包已发出 ${fmt(e.total)}${e.chainMs ? ` · ${e.chainMs}ms 上链` : ""}`, "info");
      }
    }
    if (e.type === "settled") {
      if (e.victim.user?.toLowerCase() === me && e.toVictim) {
        ding("money");
        toast(`💰 解锁到账 +${fmt(e.amount)}（${nameOf(e.cutter.nick)} 插队的钱）`, "money");
      }
      if (e.victim.user?.toLowerCase() === me && !e.toVictim) toast(`↩ ${fmt(e.amount)} 退回给了 ${nameOf(e.cutter.nick)}（有人没消费）`, "refund");
      if (e.cutter.user?.toLowerCase() === me && !e.toVictim) {
        ding("refund");
        toast(`↩ 退回 ${fmt(e.amount)}：${nameOf(e.victim.nick)} 没消费，钱回到你这`, "refund");
      }
    }
    if (e.type === "called" && e.user?.toLowerCase() === me) {
      ding("call");
      setFlash("call");
      setTimeout(() => setFlash(null), 1500);
    }
  });

  const run = async (label: string, fn: () => Promise<any>) => {
    unlockAudio();
    setBusy(label);
    try {
      const r = await fn();
      if (r?.ok === false) toast(`${label}失败`, "error");
      else if (r?.hash)
        // 链上小票：这一步真的上链了
        toast(
          `⛓️ ${label}已上链 · 区块 #${r.block} · ${r.totalMs}ms · gas 费约 ${fmt((r.gasLimit * 104) / 1e9, 3)} MON（我们付）· 点我看交易`,
          "receipt",
          `${EXPLORER}/tx/${r.hash}`,
        );
      return r;
    } catch (e) {
      toast(`${label}失败：${(e as Error).message}`, "error");
    } finally {
      setBusy(null);
    }
  };

  const cheer = (side: "yield" | "hold") => {
    unlockAudio();
    setMyVote(side);
    sendWs({ type: "cheer", side, address });
    try {
      navigator.vibrate?.(30);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className={`m-root ${flash ? "flash-" + flash : ""}`}>
      <header className="m-head">
        <div className="m-brand">🧧 插队红包</div>
        <div className="m-block mono">
          <span className={connected ? "dot ok" : "dot"} />
          <span key={block} className="tick">#{block || state?.block || "…"}</span>
        </div>
      </header>

      {!state ? (
        <div className="m-center dim">连接中…</div>
      ) : phase === "join" || phase === "served" || phase === "gone" ? (
        <JoinView
          phase={phase}
          reason={myStatus?.reason}
          balance={balance}
          busy={busy}
          queueLen={state.queue.length}
          avg={state.prices?.avg ?? 0}
          onJoin={(nick, price, noYield) =>
            run("排队", async () => {
              setNick(nick);
              if (!(state.balances[me] > 0)) await onboard();
              return actions.join(price, noYield, nick);
            })
          }
        />
      ) : phase === "called" ? (
        <div className="m-called">
          <div className="m-called-ring">🔔</div>
          <div className="m-called-big">到你了！</div>
          <div className="m-called-sub">请到柜台。店员核销后，你收到的红包就解锁到账</div>
          <div className="m-frozen big">🔒 {fmt(myRow?.frozenIn ?? 0)}</div>
        </div>
      ) : (
        myRow && (
          <QueuedView
            row={myRow}
            queue={state.queue}
            balance={balance}
            busy={busy}
            reveal={!!state.reveal}
            block={block || state.block}
            onSetPrice={(p, ny) => run("改价", () => actions.setPrice(p, ny))}
            onCut={(toPos, maxPay) => run("插队", () => actions.cut(toPos, maxPay))}
            onLeave={() => run("退出", () => actions.leave())}
          />
        )
      )}

      {spot && phase !== "join" && (
        <div className={`m-spot ${spot.user?.toLowerCase() === me ? "me" : ""}`}>
          {spot.user?.toLowerCase() === me ? (
            <>
              <div className="m-spot-title">🔦 全场在看你！有人要插你前面</div>
              <div className="m-spot-sub">守住就选「不让」；想收红包就挂个价</div>
              <div className="m-spot-btns">
                <button className="hold" disabled={!!busy} onClick={() => run("改价", () => actions.setPrice(myRow?.price || 0.5, true))}>
                  🧱 不让！
                </button>
                <button className="yield" disabled={!!busy} onClick={() => run("改价", () => actions.setPrice(Math.max(myRow?.price || 1, 1), false))}>
                  💰 让，给钱就行
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="m-spot-title">🔦 {nameOf(spot.nick)}：让，还是不让？</div>
              <div className="m-spot-btns">
                <button className={`yield ${myVote === "yield" ? "on" : ""}`} onClick={() => cheer("yield")}>
                  喊「让！」{spot.yield ? ` ${spot.yield}` : ""}
                </button>
                <button className={`hold ${myVote === "hold" ? "on" : ""}`} onClick={() => cheer("hold")}>
                  喊「不让！」{spot.hold ? ` ${spot.hold}` : ""}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {packets.length > 0 && (
        <RedPacket
          p={packets[0]}
          onOpen={() => setPackets((ps) => ps.map((x, i) => (i === 0 ? { ...x, opened: true } : x)))}
          onClose={() => setPackets((ps) => ps.slice(1))}
          more={packets.length - 1}
        />
      )}

      {confetti > 0 && <Confetti key={confetti} />}

      <div className="m-toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`m-toast ${t.kind}`} onClick={() => t.href && window.open(t.href, "_blank")}>
            {t.text}
          </div>
        ))}
      </div>
      <footer className="m-foot dim">
        <a href={`${EXPLORER}/address/${address}`} target="_blank" rel="noreferrer" className="mono">
          我的链上地址 {address.slice(0, 6)}…{address.slice(-4)}
        </a>
        <span> · gas 我们请了</span>
      </footer>
    </div>
  );
}

// ───────────────── 入队 ─────────────────
function JoinView(props: {
  phase: string;
  reason?: string;
  balance: number;
  busy: string | null;
  queueLen: number;
  avg: number;
  onJoin: (nick: string, price: number, noYield: boolean) => void;
}) {
  const saved = getNick();
  const [avatar, setAvatar] = useState(() => {
    const f = [...saved][0];
    return f && /\p{Extended_Pictographic}/u.test(f) ? f : AVATARS[Math.floor(Math.random() * AVATARS.length)];
  });
  const [name, setName] = useState(nameOf(saved));
  const [price, setPrice] = useState(0.5);
  const [noYield, setNoYield] = useState(false);
  const done =
    props.phase === "served"
      ? "✅ 已核销！你收到的红包已解锁到账"
      : props.phase === "gone"
        ? props.reason === "skipped"
          ? "叫号没来，已过号。收到的红包原路退回了"
          : props.reason === "left"
            ? "你已退出。收到的红包原路退回了"
            : "已收摊，没轮到的钱原路退回了"
        : null;
  const reroll = () => setAvatar(AVATARS[Math.floor(Math.random() * AVATARS.length)]);
  return (
    <div className="m-join">
      {done && <div className="m-done">{done}</div>}
      <h1 className="m-title">
        有人插你前面，
        <br />
        <em>钱就进你口袋</em>
      </h1>
      <div className="m-avatar-row">
        <button className="m-avatar" onClick={reroll} aria-label="换头像">
          {avatar}
        </button>
        <input type="text" maxLength={6} placeholder="昵称（不填就随机）" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="m-q">你的一位，值多少钱？</div>
      <PriceChips price={price} noYield={noYield} onChange={(p, n) => (setPrice(p), setNoYield(n))} />
      <div className="dim small m-hint">
        {noYield
          ? "选了不让：谁也插不过你，但你也收不到红包"
          : `谁出 ${fmt(price, 1)}，你就往后让一位，钱归你${props.avg ? ` · 全场平均 ${fmt(props.avg)}` : ""}`}
      </div>
      <button
        className="primary m-cta"
        disabled={!!props.busy}
        onClick={() => props.onJoin(`${avatar}${name.trim() || RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)]}`, price, noYield)}
      >
        {props.busy ? `${props.busy}中…` : `🎟️ 领号排队（现在 ${props.queueLen} 人）`}
      </button>
      <ul className="m-rules dim small">
        <li>排队免费，gas 我们请。</li>
        <li>被插一次收一个红包；你和插队的人都消费了，红包才解锁。</li>
        <li>任何一方没消费，红包原路退回，谁也不亏。</li>
      </ul>
      {props.balance > 0 && <div className="dim small m-bal">钱包里有 {fmt(props.balance)} 排队币</div>}
    </div>
  );
}

function PriceChips(props: { price: number; noYield: boolean; onChange: (p: number, noYield: boolean) => void }) {
  return (
    <div className="m-chips">
      {[0.2, 0.5, 1, 3].map((p) => (
        <button key={p} className={`chip ${!props.noYield && props.price === p ? "on" : ""}`} onClick={() => props.onChange(p, false)}>
          <span className="chip-ico">🧧</span>
          {p}
        </button>
      ))}
      <button className={`chip wall ${props.noYield ? "on" : ""}`} onClick={() => props.onChange(props.price, !props.noYield)}>
        <span className="chip-ico">🧱</span>不让
      </button>
      {!props.noYield && (
        <input
          className="m-range"
          type="range"
          min={0.1}
          max={10}
          step={0.1}
          value={props.price}
          onChange={(e) => props.onChange(Number(e.target.value), false)}
        />
      )}
    </div>
  );
}

// ───────────────── 排队中 ─────────────────
function QueuedView(props: {
  row: QueueRow;
  queue: QueueRow[];
  balance: number;
  busy: string | null;
  reveal: boolean;
  block: number;
  onSetPrice: (p: number, noYield: boolean) => void;
  onCut: (toPos: number, maxPay: number) => void;
  onLeave: () => void;
}) {
  const { row, queue } = props;
  const effPrice = row.pendingFrom ? row.pendingPrice : row.price;
  const effNoYield = row.pendingFrom ? row.pendingNoYield : row.noYield;
  const [price, setPrice] = useState(effPrice);
  const [noYield, setNoYield] = useState(effNoYield);
  const [cutTarget, setCutTarget] = useState<number | null>(null); // 要插到谁前面（uid）；null = 面板关着
  const aheadRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = aheadRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [row.rank]);
  const dirty = price !== effPrice || noYield !== effNoYield;
  const pending = row.pendingFrom > props.block;
  const prevRank = useRef(row.rank);
  const [bump, setBump] = useState<"" | "up" | "down">("");
  useEffect(() => {
    if (row.rank !== prevRank.current) {
      setBump(row.rank < prevRank.current ? "up" : "down");
      prevRank.current = row.rank;
      const t = setTimeout(() => setBump(""), 900);
      return () => clearTimeout(t);
    }
  }, [row.rank]);
  const myIdx = row.rank - 1;
  const ahead = queue.slice(0, myIdx);
  // 从我往前数，第一个「不让」的人以及他前面的人都插不过去
  let wallIdx = -1;
  for (let k = myIdx - 1; k >= 0; k--) if (queue[k].noYield) { wallIdx = k; break; }

  return (
    <div className="m-main">
      <div className={`m-ticket ${bump}`}>
        <div className="m-ticket-top">
          <span>取号单</span>
          <span className="mono">#{row.uid}</span>
        </div>
        <div className="m-ticket-rank">
          第<b>{row.rank}</b>位
        </div>
        <div className="m-ticket-sub">
          前面 {row.rank - 1} 人 · 队伍 {queue.length} 人
        </div>
        <div className="m-ticket-cut" />
        <div className="m-ticket-money">
          <div>
            <div className="dim small">待解锁红包</div>
            <div className="m-frozen">🔒 {fmt(row.frozenIn)}</div>
          </div>
          <div>
            <div className="dim small">钱包</div>
            <div className="m-bal-big">{fmt(props.balance)}</div>
          </div>
        </div>
      </div>

      {ahead.length > 0 && (
        <div className="m-ahead">
          <div className="m-row-between">
            <span className="m-label">⚡ 想插队？点你要插到谁前面</span>
            <span className="dim small">← 左滑看更前面</span>
          </div>
          <div className="m-ahead-row" ref={aheadRef}>
            {ahead.map((q, k) => {
              const blocked = k <= wallIdx;
              return (
                <button
                  key={q.uid}
                  className={`m-person ${q.noYield ? "wall" : ""} ${blocked ? "blocked" : ""}`}
                  disabled={blocked || !!props.busy}
                  onClick={() => setCutTarget(q.uid)}
                >
                  <div className="m-person-rank">{q.rank}</div>
                  <div className="m-person-av">{avatarOf(q.nick, q.uid, props.reveal && q.isBot)}</div>
                  <div className="m-person-tag">{q.noYield ? "🧱" : fmt(q.price, 1)}</div>
                </button>
              );
            })}
            <div className="m-person me">
              <div className="m-person-rank">{row.rank}</div>
              <div className="m-person-av">{avatarOf(row.nick, row.uid)}</div>
              <div className="m-person-tag">我</div>
            </div>
          </div>
          {wallIdx >= 0 && <div className="dim small">🧱 第 {queue[wallIdx].rank} 位选了「不让」，他和他前面的人插不过去</div>}
        </div>
      )}

      {row.noYield && row.blocking > 0 && <div className="m-wall">🧱 你选了「不让」，身后 {row.blocking} 个人被你挡住了</div>}

      <div className="m-section">
        <div className="m-row-between">
          <span className="m-label">我的让位价</span>
          {pending && <span className="dim small">块 #{row.pendingFrom} 生效</span>}
        </div>
        <PriceChips price={price} noYield={noYield} onChange={(p, n) => (setPrice(p), setNoYield(n))} />
        {dirty && (
          <button className="primary" disabled={!!props.busy} onClick={() => props.onSetPrice(price, noYield)}>
            {props.busy === "改价" ? "提交中…" : noYield ? "改成「不让」" : `改成 ${fmt(price, 1)}`}
          </button>
        )}
      </div>

      <button className="m-leave" disabled={!!props.busy} onClick={() => confirm("确定不排了？收到的红包会原路退回。") && props.onLeave()}>
        不排了
      </button>

      {cutTarget !== null && (
        <CutSheet
          queue={queue}
          row={row}
          targetUid={cutTarget}
          reveal={props.reveal}
          balance={props.balance}
          busy={props.busy}
          onClose={() => setCutTarget(null)}
          onCut={(toPos, maxPay) => {
            setCutTarget(null);
            props.onCut(toPos, maxPay);
          }}
        />
      )}
    </div>
  );
}

// ───────────────── 插队：点人选位置，看明细 ─────────────────
function CutSheet(props: {
  queue: QueueRow[];
  row: QueueRow;
  targetUid: number;
  reveal: boolean;
  balance: number;
  busy: string | null;
  onClose: () => void;
  onCut: (toPos: number, maxPay: number) => void;
}) {
  const myIdx = props.row.rank - 1;
  // 从我往前数，遇到「不让」就是墙
  const reachable = useMemo(() => {
    const list: { q: QueueRow; cum: number; worst: number }[] = [];
    let cum = 0;
    let worst = 0;
    for (let k = myIdx - 1; k >= 0; k--) {
      const q = props.queue[k];
      if (q.noYield) break;
      cum += q.price;
      worst += q.pendingFrom && !q.pendingNoYield ? Math.max(q.price, q.pendingPrice) : q.price;
      list.push({ q, cum, worst });
    }
    return list;
  }, [props.queue, myIdx]);
  const wall = myIdx - reachable.length - 1 >= 0 ? props.queue[myIdx - reachable.length - 1] : null;
  const [sel, setSel] = useState(() => {
    const i = reachable.findIndex((x) => x.q.uid === props.targetUid);
    return i >= 0 ? i : 0;
  });
  const chosen = reachable[Math.min(sel, reachable.length - 1)];
  const passed = reachable.slice(0, Math.min(sel, reachable.length - 1) + 1);
  const maxOne = passed.reduce((m, x) => (x.q.price > m.q.price ? x : m), passed[0] ?? reachable[0]);

  return (
    <div className="m-sheet-mask" onClick={props.onClose}>
      <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="m-sheet-head">
          <b>确认插队</b>
          <button className="m-x" onClick={props.onClose}>
            ✕
          </button>
        </div>
        {reachable.length === 0 ? (
          <div className="m-wall">🧱 你前面的人选了「不让」，插不过去</div>
        ) : (
          <>
            <div className="m-sheet-list">
              {wall && (
                <div className="m-sheet-item wallitem">
                  <span>{avatarOf(wall.nick, wall.uid, props.reveal && wall.isBot)}</span>
                  <span className="grow">{nameOf(wall.nick)} · 第 {wall.rank} 位</span>
                  <span>🧱 不让</span>
                </div>
              )}
              {[...reachable].reverse().map((x) => {
                const i = reachable.indexOf(x);
                const on = i <= sel;
                return (
                  <button key={x.q.uid} className={`m-sheet-item ${on ? "on" : ""} ${i === sel ? "target" : ""}`} onClick={() => setSel(i)}>
                    <span>{avatarOf(x.q.nick, x.q.uid, props.reveal && x.q.isBot)}</span>
                    <span className="grow">
                      {nameOf(x.q.nick)}
                      {x.q.isBot && <em className="botmark">{props.reveal ? "黄牛" : "🤖"}</em>} · 第 {x.q.rank} 位
                    </span>
                    <span className="mono">🧧 {fmt(x.q.price, 2)}</span>
                  </button>
                );
              })}
              <div className="m-sheet-item me">
                <span>{avatarOf(props.row.nick, props.row.uid)}</span>
                <span className="grow">我 · 第 {props.row.rank} 位</span>
              </div>
            </div>
            {passed.length > 1 && maxOne && maxOne.q.price > chosen.cum / passed.length * 2 && (
              <div className="dim small m-sheet-hint">
                💡 {nameOf(maxOne.q.nick)} 报价最高（{fmt(maxOne.q.price)}），只插到他身后能省下这一笔
              </div>
            )}
            <button
              className="danger m-cta"
              disabled={!!props.busy || chosen.worst > props.balance}
              onClick={() => props.onCut(chosen.q.pos, chosen.worst)}
            >
              {chosen.worst > props.balance
                ? `钱包不够（要 ${fmt(chosen.worst)}）`
                : `确认插到第 ${chosen.q.rank} 位 · 付 ${fmt(chosen.cum)} 给 ${passed.length} 个人`}
            </button>
            <div className="dim small center">每个人拿他自己挂的价 · 你确认的价就是上限，不会多扣</div>
          </>
        )}
      </div>
    </div>
  );
}

// ───────────────── 拆红包 ─────────────────
function RedPacket(props: { p: Packet; more: number; onOpen: () => void; onClose: () => void }) {
  const { p } = props;
  return (
    <div className="m-packet-mask" onClick={p.opened ? props.onClose : undefined}>
      <div className={`m-packet ${p.opened ? "opened" : ""}`}>
        <div className="m-packet-from">
          {p.fromAvatar} {p.from} 插队越过了你
        </div>
        {!p.opened ? (
          <button className="m-packet-open" onClick={props.onOpen}>
            開
          </button>
        ) : (
          <div className="m-packet-amount">
            <div className="amt">+{fmt(p.amount)}</div>
            <div className="lock">🔒 你和 TA 都消费后解锁</div>
            <div className="small">点任意处收下{props.more ? `（还有 ${props.more} 个）` : ""}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function Confetti() {
  const bits = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.4,
        dur: 1.6 + Math.random() * 1.2,
        ch: ["🧧", "✨", "💰", "🎉"][i % 4],
      })),
    [],
  );
  return (
    <div className="m-confetti">
      {bits.map((b, i) => (
        <span key={i} style={{ left: `${b.left}%`, animationDelay: `${b.delay}s`, animationDuration: `${b.dur}s` }}>
          {b.ch}
        </span>
      ))}
    </div>
  );
}
