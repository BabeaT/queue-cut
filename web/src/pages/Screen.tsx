// 大屏：队伍动画、插队红包雨、结算飞回、评委守位聚光灯、黄牛面板、排行榜、价格分布、指标
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  useLive,
  useBlock,
  useLiveEvents,
  fmt,
  EXPLORER,
  type LiveState,
  type QueueRow,
  type CutEvent,
  type Spotlight,
} from "../live.ts";
import { Character } from "../home/HomePage.tsx";
import "./screen.css";

/** 像素小人：普通人按 uid 在 1–4 里选；正在插队冲刺的人用 0（举红包奔跑） */
const kindOf = (uid: number, running = false) => (running ? 0 : 1 + (uid % 4));

// ───────────── 头像 ─────────────
const AVATARS = ["🐼", "🦊", "🐯", "🐨", "🐸", "🐵", "🐰", "🐻", "🐷", "🐮", "🦁", "🐶", "🐱", "🐧", "🦄", "🐲", "🦉", "🐙", "🦀", "🐳"];
const EMOJI_RE = /\p{Extended_Pictographic}/u;
function splitNick(nick: string, uid: number) {
  const chars = Array.from(nick || "");
  if (chars.length && EMOJI_RE.test(chars[0])) {
    // 头像 emoji 可能带变体选择符
    let i = 1;
    while (i < chars.length && /[️‍]/.test(chars[i])) i++;
    return { avatar: chars.slice(0, i).join(""), name: chars.slice(i).join("") || `#${uid}` };
  }
  return { avatar: AVATARS[uid % AVATARS.length], name: nick || `#${uid}` };
}

// ───────────── 临时特效 ─────────────
type Fx = { id: number; uid: number; kind: "packet" | "paid" | "refund" | "served"; text: string };
type Fly = { id: number; x: number; y: number; dx: number; dy: number; text: string; delay?: number; coin?: boolean };
type PriceEv = { uid: number; nick: string; price: number; noYield: boolean; block: number };
type Storm = { id: number; items: PriceEv[] };
type Trace = { id: number; cut: CutEvent; at: number };
type BlockAgg = { joins: number; cuts: number; prices: number; settles: number; txs: number };
type Ghost = { id: number; x: number; y: number; w: number; h: number; avatar: string; name: string; isBot: boolean; uid: number };
type Beam = { id: number; x: number; y: number; len: number; angle: number };
type Banner = { id: number; cut: CutEvent; rank: number };
type Link = { x1: number; y1: number; x2: number; y2: number; label?: string; delay: number; thin?: boolean };
type LinkBatch = {
  id: number;
  kind: "pay" | "paid" | "refund";
  links: Link[];
  hub?: { x: number; y: number; text: string };
};
const arc = (l: Link) => {
  const mx = (l.x1 + l.x2) / 2;
  const d = Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
  const my = Math.min(l.y1, l.y2) - Math.min(170, 40 + d * 0.28);
  return { d: `M ${l.x1} ${l.y1} Q ${mx} ${my} ${l.x2} ${l.y2}`, lx: mx, ly: (my + (l.y1 + l.y2) / 2) / 2 };
};

let fxSeq = 0;
const nextId = () => ++fxSeq;

export default function Screen() {
  const { state, connected } = useLive();
  const queue = state?.queue ?? [];
  const reveal = !!state?.reveal;

  const [fx, setFx] = useState<Fx[]>([]);
  const [flies, setFlies] = useState<Fly[]>([]);
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const [beams, setBeams] = useState<Beam[]>([]);
  const [batches, setBatches] = useState<LinkBatch[]>([]);
  const addBatch = (b: Omit<LinkBatch, "id">, ms: number) => {
    const id = nextId();
    setBatches((a) => [...a.slice(-5), { ...b, id }]);
    setTimeout(() => setBatches((a) => a.filter((x) => x.id !== id)), ms);
  };
  const [banner, setBanner] = useState<Banner | null>(null);
  const [shake, setShake] = useState(false);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [storm, setStorm] = useState<Storm | null>(null);
  const priceBuf = useRef<(PriceEv & { t: number })[]>([]);
  const stormOpen = useRef(false);
  const [joinTicker, setJoinTicker] = useState<{ id: number; text: string }[]>([]);
  const [counterFx, setCounterFx] = useState<{ id: number; text: string }[]>([]);

  const cardEls = useRef(new Map<number, HTMLDivElement>());
  const counterEl = useRef<HTMLDivElement | null>(null);

  const later = (ms: number, f: () => void) => setTimeout(f, ms);
  const addFx = (items: Omit<Fx, "id">[], ms: number) => {
    const withId = items.map((x) => ({ ...x, id: nextId() }));
    setFx((a) => [...a, ...withId]);
    const ids = new Set(withId.map((x) => x.id));
    later(ms, () => setFx((a) => a.filter((x) => !ids.has(x.id))));
  };
  const rectOf = (uid?: number) => {
    const el = (uid !== undefined && cardEls.current.get(uid)) || counterEl.current;
    return el?.getBoundingClientRect() ?? null;
  };

  useLiveEvents((e) => {
    switch (e.type) {
      case "cut": {
        // 光束：插队者原位置 → 被越过者里最靠前的位置
        const from = rectOf(e.cutter.uid);
        const firstVictim = e.victims.reduce<number | undefined>((best, v) => {
          const r = queue.find((q) => q.uid === v.uid)?.rank ?? Infinity;
          const b = best === undefined ? Infinity : (queue.find((q) => q.uid === best)?.rank ?? Infinity);
          return r < b ? v.uid : best;
        }, undefined);
        const to = rectOf(firstVictim);
        void to;
        void setBeams;
        addFx(
          e.victims.map((v) => ({ uid: v.uid, kind: "packet" as const, text: `+${fmt(v.amount)}` })),
          4200,
        );
        // 连线：从插队的人分别连到每个被越过的人，金币沿线滑过去；再汇到同一个区块
        // 等队伍排好新位置再画线：线从插队的人的新位置出发
        setTimeout(() => {
          const from2 = rectOf(e.cutter.uid);
          if (!from2) return;
          const x1 = from2.left + from2.width / 2;
          const y1 = from2.top + from2.height * 0.45;
          const links: Link[] = [];
          e.victims.slice(0, 40).forEach((v, i) => {
            const r = rectOf(v.uid);
            if (!r || !cardEls.current.has(v.uid)) return;
            links.push({ x1, y1, x2: r.left + r.width / 2, y2: r.top + r.height * 0.4, label: fmt(v.amount), delay: i * 30 });
          });
          if (links.length) {
            const hx = links.reduce((a, l) => a + l.x2, x1) / (links.length + 1);
            const hy = Math.max(215, Math.min(y1, ...links.map((l) => l.y2)) - 150);
            const hubLinks: Link[] = links.map((l, i) => ({ x1: l.x2, y1: l.y2 - 30, x2: hx, y2: hy + 18, delay: 500 + i * 20, thin: true }));
            addBatch(
              {
                kind: "pay",
                links: [...links, ...hubLinks],
                hub: { x: hx, y: hy, text: `⛓ #${e.block} · ${e.victims.length} 笔付款 · 同一笔交易` },
              },
              3400,
            );
          }
                }, 700);
        const targetRank = firstVictim !== undefined ? (queue.find((q) => q.uid === firstVictim)?.rank ?? 1) : 1;
        const id = nextId();
        setBanner({ id, cut: e, rank: targetRank });
        later(5200, () => setBanner((b) => (b?.id === id ? null : b)));
        setTrace({ id, cut: e, at: Date.now() });
        later(14500, () => setTrace((t) => (t?.id === id ? null : t)));
        setShake(true);
        later(600, () => setShake(false));
        break;
      }
      case "settled": {
        const va = cardEls.current.has(e.victim.uid) ? rectOf(e.victim.uid) : null;
        const cb = cardEls.current.has(e.cutter.uid) ? rectOf(e.cutter.uid) : null;
        const pair =
          va && cb
            ? { x1: va.left + va.width / 2, y1: va.top + va.height * 0.4, x2: cb.left + cb.width / 2, y2: cb.top + cb.height * 0.4 }
            : null;
        if (e.toVictim) {
          addFx([{ uid: e.victim.uid, kind: "paid", text: `🔓 到账 +${fmt(e.amount)}` }], 3000);
          if (pair) addBatch({ kind: "paid", links: [{ ...pair, label: `🔓 ${fmt(e.amount)}`, delay: 0 }] }, 1800);
        } else {
          addFx([{ uid: e.victim.uid, kind: "refund", text: `↩ 退回 ${fmt(e.amount)}` }], 2600);
          if (pair) addBatch({ kind: "refund", links: [{ ...pair, label: `↩ ${fmt(e.amount)}`, delay: 0 }] }, 2200);
        }
        break;
      }
      case "gone": {
        if (e.reason === "skipped" || e.reason === "left") {
          const r = rectOf(e.uid);
          const row = queue.find((q) => q.uid === e.uid);
          if (r && row) {
            const { avatar, name } = splitNick(row.nick, row.uid);
            const id = nextId();
            setGhosts((g) => [
              ...g,
              { id, x: r.left, y: r.top, w: r.width, h: r.height, avatar, name, isBot: row.isBot, uid: row.uid },
            ]);
            later(2200, () => setGhosts((g) => g.filter((x) => x.id !== id)));
          } else if (e.reason === "skipped") {
            const id = nextId();
            setCounterFx((c) => [...c.slice(-4), { id, text: `⏭ ${e.nick} 过号` }]);
            later(2500, () => setCounterFx((c) => c.filter((x) => x.id !== id)));
          }
        }
        break;
      }
      case "served": {
        const id = nextId();
        setCounterFx((c) => [...c.slice(-4), { id, text: `✅ ${e.nick} 已消费` }]);
        later(3500, () => setCounterFx((c) => c.filter((x) => x.id !== id)));
        break;
      }
      case "joined": {
        const id = nextId();
        setJoinTicker((t) => [...t.slice(-3), { id, text: `${e.nick} 来排队了` }]);
        later(3500, () => setJoinTicker((t) => t.filter((x) => x.id !== id)));
        break;
      }
      case "price": {
        // 并发泳道：1.5 秒内 ≥5 笔改价 → 弹出「全场改价」面板
        const now = Date.now();
        const item = { uid: e.uid, nick: e.nick, price: e.price, noYield: e.noYield, block: e.block };
        priceBuf.current = [...priceBuf.current.filter((x) => now - x.t < 1500), { ...item, t: now }];
        if (stormOpen.current) {
          setStorm((st) => (st && st.items.length < 30 ? { ...st, items: [...st.items, item] } : st));
        } else if (priceBuf.current.length >= 5) {
          stormOpen.current = true;
          const id = nextId();
          setStorm({ id, items: priceBuf.current.map(({ t: _t, ...x }) => x) });
          later(6500, () => {
            stormOpen.current = false;
            priceBuf.current = [];
            setStorm((st) => (st?.id === id ? null : st));
          });
        }
        break;
      }
    }
  });

  // ───────────── FLIP：位置变化平滑移动 ─────────────
  const prevRects = useRef(new Map<number, DOMRect>());
  const orderKey = queue.map((q) => q.uid).join(",") + "|" + (state?.called ?? []).map((c) => c.uid).join(",");
  useLayoutEffect(() => {
    const next = new Map<number, DOMRect>();
    cardEls.current.forEach((el, uid) => {
      const r = el.getBoundingClientRect();
      next.set(uid, r);
      const p = prevRects.current.get(uid);
      if (p) {
        const dx = p.left - r.left;
        const dy = p.top - r.top;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          el.style.transition = "none";
          el.style.transform = `translate(${dx}px, ${dy}px)`;
          requestAnimationFrame(() => {
            el.style.transition = "transform 750ms cubic-bezier(.2,.8,.2,1)";
            el.style.transform = "";
          });
        }
      } else {
        el.animate(
          [
            { opacity: 0, transform: "translateY(-30px) scale(.6)" },
            { opacity: 1, transform: "translateY(0) scale(1)" },
          ],
          { duration: 450, easing: "cubic-bezier(.2,.8,.2,1)" },
        );
      }
    });
    prevRects.current = next;
  }, [orderKey]);

  const fxByUid = useMemo(() => {
    const m = new Map<number, Fx[]>();
    for (const f of fx) m.set(f.uid, [...(m.get(f.uid) ?? []), f]);
    return m;
  }, [fx]);

  const spotlight = null as Spotlight | null;
  void SpotlightPanel;
  const dense = queue.length > 48;

  return (
    <div className={`sc-root ${shake ? "shake" : ""} ${spotlight ? "spot-on" : ""}`}>
      <header className="sc-head">
        <div className="sc-title">
          <div className="sc-logo">
            <span className="sc-logo-zh">插队红包</span>
            <span className="sc-logo-en">QUEUE ARENA</span>
          </div>
          <div className="sc-slogan">
            在以太坊上插队，钱给了矿工；<b>在这里插队，钱给被你插队的每一个人</b>
          </div>
        </div>
        <div className="sc-joins">
          {joinTicker.map((j) => (
            <div key={j.id} className="sc-join">
              {j.text}
            </div>
          ))}
        </div>
        <BlockBox connected={connected} fallback={state?.block ?? 0} initMax={state?.maxJoinsPerBlock ?? 0} />
      </header>

      <BlockBelt fallback={state?.block ?? 0} />

      <main className="sc-main">
        <section className={`sc-stage ${dense ? "dense" : ""}`}>
          {!state || queue.length === 0 ? (
            <EmptyStage connected={connected} hasState={!!state} />
          ) : (
            <div className="sc-line">
              <div className="sc-counter" ref={counterEl}>
                <div className="sc-awning" aria-hidden="true" />
                <div className="sc-counter-title">
                  <span className="sc-shop-en">SHOP</span> 柜台
                </div>
                <div className="sc-counter-list">
                  {(state.called ?? []).slice(-3).map((c) => {
                    const { name } = splitNick(c.nick, c.uid);
                    return (
                      <div key={c.uid} className="sc-called">
                        <span className="sc-called-av"><Character kind={kindOf(c.uid)} /></span>
                        <span className="sc-called-name">{name}</span>
                      </div>
                    );
                  })}
                  {(state.called ?? []).length === 0 && <div className="sc-counter-idle">等待叫号</div>}
                </div>
                {counterFx.map((c) => (
                  <div key={c.id} className="sc-counter-fx">
                    {c.text}
                  </div>
                ))}
              </div>
              {queue.map((row) => (
                <Card
                  key={row.uid}
                  row={row}
                  fx={fxByUid.get(row.uid)}
                  spot={spotlight?.uid === row.uid}
                  running={banner?.cut.cutter.uid === row.uid}
                  reveal={reveal}
                  refCb={(el) => {
                    if (el) cardEls.current.set(row.uid, el);
                    else cardEls.current.delete(row.uid);
                  }}
                />
              ))}
            </div>
          )}
        </section>

        <aside className="sc-side">
          <QrCard />
          <BotPanel state={state} />
          <Leaders state={state} />
          <Prices state={state} />
        </aside>
      </main>

      <Metrics state={state} />

      {/* ───── 叠加层 ───── */}
      <div className="sc-overlay">
        {beams.map((b) => (
          <div
            key={b.id}
            className="sc-beam"
            style={{ left: b.x, top: b.y, width: b.len, transform: `rotate(${b.angle}deg)` }}
          />
        ))}
        {flies.map((f) => (
          <div
            key={f.id}
            className={`sc-fly ${f.coin ? "coin" : ""}`}
            style={{
              left: f.x,
              top: f.y,
              animationDelay: f.delay ? `${f.delay}ms` : undefined,
              ["--dx" as any]: `${f.dx}px`,
              ["--dy" as any]: `${f.dy}px`,
            }}
          >
            {f.text}
          </div>
        ))}
        {ghosts.map((g) => (
          <div key={g.id} className={`sc-ghost ${g.isBot && reveal ? "bot" : ""}`} style={{ left: g.x, top: g.y, width: g.w, height: g.h }}>
            <div className="sc-ghost-av"><Character kind={kindOf(g.uid)} /></div>
            <div className="sc-ghost-name">{g.name}</div>
            <div className="sc-ghost-tag">过号</div>
          </div>
        ))}
        {(banner || trace) && (
          <div className="sc-cutstack">
            {banner && <CutBanner key={banner.id} banner={banner} />}
            {trace && <CutTrace key={trace.id} trace={trace} lastCut={state?.stats?.lastCut ?? null} solo={!banner} />}
          </div>
        )}
        {batches.map((b) => (
          <svg key={b.id} className={`sc-links ${b.kind}`} width="100%" height="100%">
            {b.links.map((l, i) => {
              const a = arc(l);
              return (
                <g key={i}>
                  <path
                    className={`sc-link ${l.thin ? "thin" : ""}`}
                    d={a.d}
                    pathLength={1}
                    style={{ animationDelay: `${l.delay}ms` }}
                  />
                  {!l.thin && (
                    <circle className="sc-link-dot" r={8}>
                      <animateMotion dur="0.7s" begin={`${(l.delay + 120) / 1000}s`} fill="freeze" path={a.d} />
                    </circle>
                  )}
                  {l.label && b.links.filter((x) => !x.thin).length <= 14 && (
                    <text className="sc-link-label" x={a.lx} y={a.ly} textAnchor="middle" style={{ animationDelay: `${l.delay + 300}ms` }}>
                      {l.label}
                    </text>
                  )}
                </g>
              );
            })}
            {b.hub && (
              <foreignObject x={b.hub.x - 230} y={b.hub.y - 22} width={460} height={44}>
                <div className="sc-hub">{b.hub.text}</div>
              </foreignObject>
            )}
          </svg>
        ))}
        {storm && <StormPanel key={storm.id} storm={storm} />}
      </div>
    </div>
  );
}

// ───────────── 队伍里的一个人 ─────────────
function Card(props: {
  row: QueueRow;
  fx?: Fx[];
  spot: boolean;
  running?: boolean;
  reveal: boolean;
  refCb: (el: HTMLDivElement | null) => void;
}) {
  const { row } = props;
  const base = splitNick(row.nick, row.uid);
  const scalper = row.isBot && props.reveal; // 只有导演台打开「黄牛场景」才标出来
  const name = base.name;
  const pending = row.pendingFrom > 0;
  const paid = props.fx?.some((f) => f.kind === "paid");
  return (
    <div className="sc-slot" ref={props.refCb}>
      <div
        className={`sc-card ${scalper ? "bot" : ""} ${row.noYield ? "wall" : ""} ${props.spot ? "spot" : ""} ${paid ? "paidflash" : ""}`}
        style={scalper ? { animationDelay: `${(row.rank % 24) * 45}ms` } : undefined}
      >
        <div className="sc-rank mono">{row.rank}</div>
        <div className={`sc-tag ${row.noYield ? "wall" : ""}`}>
          {row.noYield ? (
            <>
              🧱 不让{row.blocking > 0 && <span className="sc-block-n">挡住 {row.blocking} 人</span>}
            </>
          ) : (
            <>
              让位 <b>{fmt(row.price, 1)}</b>
              {pending && <span className="sc-pending">→{row.pendingNoYield ? "🧱" : fmt(row.pendingPrice, 1)}</span>}
            </>
          )}
        </div>
        <div className={`sc-av ${props.running ? "running" : ""}`} key={scalper ? "s" : "n"}>
          <Character kind={kindOf(row.uid, props.running)} />
          {scalper && <span className="sc-shades">🕶️</span>}
        </div>
        <div className="sc-name">{name}</div>
        {scalper ? (
          <div className="sc-bot-tag">黄牛</div>
        ) : (
          row.isBot && (
            <div className="sc-demo-tag" title="演示账号">
              🤖
            </div>
          )
        )}
        {row.frozenIn > 0 && <div className="sc-frozen">🔒 {fmt(row.frozenIn)}</div>}
        {props.fx?.map((f) =>
          f.kind === "packet" ? (
            <div key={f.id} className="sc-packet">
              <div className="sc-packet-env">🧧</div>
              <div className="sc-packet-txt">
                被越过 <b>{f.text}</b>
              </div>
            </div>
          ) : (
            <div key={f.id} className={`sc-fx ${f.kind}`}>
              {f.text}
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function EmptyStage(props: { connected: boolean; hasState: boolean }) {
  return (
    <div className="sc-empty">
      <div className="sc-empty-big">{props.hasState ? "等待第一个人排队…" : props.connected ? "加载中…" : "连接中…"}</div>
      <div className="sc-empty-sub">扫右边的码排队 · 有人插你就有钱收</div>
    </div>
  );
}

// ───────────── 插队横幅 ─────────────
function CutBanner({ banner }: { banner: Banner }) {
  const c = banner.cut;
  const { name } = splitNick(c.cutter.nick, c.cutter.uid);
  return (
    <div className="sc-banner">
      <div className="sc-banner-main">
        <span className="sc-banner-runner"><Character kind={0} /></span> <b>{name}</b> 插队到第 <b className="hot">{banner.rank}</b> 位
      </div>
      <div className="sc-banner-sub">
        同一个块 <b className="mono">#{c.block}</b> · <b className="hot">{c.victims.length}</b> 人同时到账 · 共{" "}
        <b>{fmt(c.total)}</b>
        {c.chainMs !== null && (
          <>
            {" "}
            · <b className="mono">{c.chainMs}ms</b>
          </>
        )}
      </div>
      <div className="sc-banner-rain">
        {c.victims.slice(0, 24).map((v, i) => (
          <span key={v.uid} className="sc-rain" style={{ animationDelay: `${i * 40}ms`, left: `${(i * 37) % 100}%` }}>
            🧧
          </span>
        ))}
      </div>
    </div>
  );
}

// ───────────── 评委守位：聚光灯 ─────────────
function SpotlightPanel({ spotlight }: { spotlight: NonNullable<Spotlight> }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.ceil((spotlight.until - now) / 1000));
  const total = Math.max(1, (spotlight.yield ?? 0) + (spotlight.hold ?? 0));
  const { name } = splitNick(spotlight.nick, spotlight.uid);
  return (
    <div className="sc-spot">
      <div className="sc-spot-box">
        <div className="sc-spot-av"><Character kind={kindOf(spotlight.uid)} /></div>
        <div className="sc-spot-q">
          <b>{name}</b>：让，还是不让？
        </div>
        <div className={`sc-spot-count mono ${left <= 3 ? "hot" : ""}`}>{left}</div>
        <div className="sc-cheer">
          <div className="sc-cheer-row">
            <span className="sc-cheer-label">全场喊：让！</span>
            <div className="sc-bar">
              <div className="sc-bar-fill yield" style={{ width: `${((spotlight.yield ?? 0) / total) * 100}%` }} />
            </div>
            <span className="sc-cheer-n mono">{spotlight.yield ?? 0}</span>
          </div>
          <div className="sc-cheer-row">
            <span className="sc-cheer-label">不让！🧱</span>
            <div className="sc-bar">
              <div className="sc-bar-fill hold" style={{ width: `${((spotlight.hold ?? 0) / total) * 100}%` }} />
            </div>
            <span className="sc-cheer-n mono">{spotlight.hold ?? 0}</span>
          </div>
        </div>
        <div className="sc-spot-hint">评委请按自己的手机 · 观众在手机上喊话</div>
      </div>
    </div>
  );
}

// ───────────── 右栏 ─────────────
const QR_BASE = ((import.meta.env.VITE_QR_BASE as string | undefined) || location.origin).replace(/\/$/, "");
function QrCard() {
  const [src, setSrc] = useState("");
  useEffect(() => {
    QRCode.toDataURL(QR_BASE + "/m", {
      margin: 1,
      width: 320,
      color: { dark: "#0b0714", light: "#ffffff" },
    })
      .then(setSrc)
      .catch(() => undefined);
  }, []);
  return (
    <div className="sc-panel sc-qr">
      {src ? <img src={src} alt="扫码排队" /> : <div className="sc-qr-ph" />}
      <div className="sc-qr-text">
        <div className="sc-qr-big">扫码排队</div>
        <div className="dim">有人插你就有钱收</div>
        <div className="sc-qr-url mono">{QR_BASE.replace(/^https?:\/\//, "")}/m</div>
      </div>
    </div>
  );
}

function BotPanel({ state }: { state: LiveState | null }) {
  const hist = state?.bots?.history ?? [];
  const last = hist[hist.length - 1];
  const W = 380;
  const H = 90;
  const maxV = Math.max(1, ...hist.map((h) => Math.max(h.frozen, h.profit)));
  const pts = (key: "frozen" | "profit") =>
    hist
      .map((h, i) => {
        const x = hist.length > 1 ? (i / (hist.length - 1)) * W : W;
        const y = H - (h[key] / maxV) * (H - 6) - 3;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  return (
    <div className="sc-panel sc-bots">
      <div className="sc-panel-title">
        {state?.reveal
          ? `🕶️ 黄牛场景：${state?.bots?.count ?? 20} 个只排不买的号`
          : `🤖 演示账号 ${state?.bots?.count ?? 20} 个 · 只排不买`}
      </div>
      <div className="sc-bots-big">
        实际到手 <b className="gold mono">{fmt(last?.profit ?? 0)}</b>
        <span className="sc-bots-idle">{state?.reveal ? "黄牛白忙中" : "不消费，红包就不解锁"}</span>
      </div>
      <svg className="sc-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <line x1="0" y1={H - 3} x2={W} y2={H - 3} className="axis" />
        {hist.length > 1 && <polyline points={pts("frozen")} className="frozen" />}
        {hist.length > 1 && <polyline points={pts("profit")} className="profit" />}
      </svg>
      <div className="sc-legend">
        <span className="l-frozen">— 冻结中 {fmt(last?.frozen ?? 0)}</span>
        <span className="l-profit">— 实际到手</span>
      </div>
    </div>
  );
}

function Leaders({ state }: { state: LiveState | null }) {
  const cut = state?.leaders?.cutKing ?? [];
  const lie = state?.leaders?.lieKing ?? [];
  const medal = ["🥇", "🥈", "🥉"];
  const List = ({ items, unit }: { items: { nick: string; value: number }[]; unit: string }) =>
    items.length ? (
      <ol className="sc-lb">
        {items.slice(0, 3).map((x, i) => (
          <li key={i}>
            <span>{medal[i]}</span>
            <span className="sc-lb-name">{x.nick}</span>
            <span className="mono">
              {fmt(x.value)}
              <small>{unit}</small>
            </span>
          </li>
        ))}
      </ol>
    ) : (
      <div className="dim sc-lb-empty">虚位以待</div>
    );
  return (
    <div className="sc-panel sc-leaders">
      <div className="sc-lb-col">
        <div className="sc-panel-title">🏃 插队王</div>
        <List items={cut} unit="花" />
      </div>
      <div className="sc-lb-col">
        <div className="sc-panel-title">😴 躺赚王</div>
        <List items={lie} unit="收" />
      </div>
    </div>
  );
}

function Prices({ state }: { state: LiveState | null }) {
  const p = state?.prices;
  const buckets = p?.buckets ?? [];
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div className="sc-panel sc-prices">
      <div className="sc-prices-big">
        广州人排一位，平均值 <b className="gold mono">{p && p.count ? fmt(p.avg) : "—"}</b>
      </div>
      <div className="sc-hist">
        {buckets.map((b) => (
          <div key={b.label} className="sc-hist-col">
            <div className="sc-hist-n mono">{b.count || ""}</div>
            <div className="sc-hist-bar" style={{ height: `${(b.count / max) * 100}%` }} />
            <div className="sc-hist-label">{b.label}</div>
          </div>
        ))}
        {buckets.length === 0 && <div className="dim">还没有人报价</div>}
      </div>
      {!!p?.noYield && <div className="dim sc-noyield">🧱 选「不让」的有 {p.noYield} 人</div>}
    </div>
  );
}

// ───────────── 底部指标条 ─────────────
function Metrics({ state }: { state: LiveState | null }) {
  const s = state?.stats;
  const lc = s?.lastCut;
  return (
    <footer className="sc-foot sc-foot2">
      <Metric label="插队次数" value={s?.cuts ?? 0} />
      <Metric label="发出红包" value={s?.packets ?? 0} />
      <Metric label="最近一次上链" value={lc?.chainMs ?? "—"} unit="ms" />
      <div className="sc-foot-minor">
        <span>已到账 {s?.toVictim ?? 0} 笔</span>
        <span>原路退回 {s?.refunded ?? 0} 笔</span>
        <span>本场链上交易 {s?.txs ?? "—"} 笔</span>
        <span>gas 费 {s?.feeMon !== undefined ? fmt(s.feeMon, 3) : "—"} MON（我们代付）</span>
        {lc && (
          <>
            <span>
              被插的人手机收到 {lc.fanoutMs ?? "—"}ms（{lc.acks} 台已回执）
            </span>
            <span>
              gas limit/used {(lc.gasLimit || lc.gasUsed).toLocaleString()} / {lc.gasUsed.toLocaleString()} · Monad 按 limit 收费
            </span>
            <a className="mono" href={`${EXPLORER}/tx/${lc.txHash}`} target="_blank" rel="noreferrer">
              {lc.txHash.slice(0, 10)}…
            </a>
          </>
        )}
      </div>
    </footer>
  );
}

function Metric(props: { label: string; value: number | string; unit?: string }) {
  return (
    <div className="sc-metric">
      <div className="sc-m-label">{props.label}</div>
      <div key={props.value} className="sc-m-value mono">
        {props.value}
        {props.unit && <small>{props.unit}</small>}
      </div>
    </div>
  );
}

// ───────────── 顶栏块号（单独组件：每 0.3 秒只重渲染这一小块） ─────────────
function BlockBox(props: { connected: boolean; fallback: number; initMax: number }) {
  const block = useBlock();
  const [flash, setFlash] = useState<{ id: number; block: number; joins: number; txs: number } | null>(null);
  const [maxJoins, setMaxJoins] = useState(0);
  useLiveEvents((e) => {
    if (e.type !== "blockStats") return;
    const id = nextId();
    setFlash({ id, block: e.block, joins: e.joins ?? 0, txs: e.txs ?? 0 });
    setMaxJoins((m) => Math.max(m, e.joins ?? 0, e.maxJoins ?? 0));
    setTimeout(() => setFlash((b) => (b?.id === id ? null : b)), 2500);
  });
  const max = Math.max(maxJoins, props.initMax);
  return (
    <div className="sc-blockbox">
      <div className="sc-block-row">
        {!props.connected && <span className="sc-recon">● 重连中</span>}
        <span className="sc-block-label">块</span>
        <span key={block} className="sc-block mono">
          #{block || props.fallback || "…"}
        </span>
      </div>
      <div className="sc-block-sub">Monad 测试网 · 0.3s 出块 · 0.6s 终局</div>
      <div className="sc-block-stats">
        {flash ? (
          <span key={flash.id} className="sc-bflash">
            块 #{flash.block}：{flash.joins} 人入队 / {flash.txs} 笔交易
          </span>
        ) : max > 0 ? (
          <span className="dim">最高同块入队 {max} 人</span>
        ) : null}
      </div>
    </div>
  );
}

// ───────────── A 区块传送带 ─────────────
const BELT_MAX = 40;
function BlockBelt({ fallback }: { fallback: number }) {
  const live = useBlock();
  const block = live || fallback;
  const [blocks, setBlocks] = useState<number[]>([]);
  const [agg, setAgg] = useState<Map<number, BlockAgg>>(new Map());
  useEffect(() => {
    if (!block) return;
    setBlocks((bs) => {
      const last = bs[bs.length - 1] ?? block - 1;
      if (block <= last) return bs;
      const add: number[] = [];
      for (let n = Math.max(last + 1, block - 5); n <= block; n++) add.push(n);
      return [...bs, ...add].slice(-BELT_MAX);
    });
  }, [block]);
  useLiveEvents((e) => {
    if (e.type !== "blockStats") return;
    setAgg((m) => {
      const next = new Map(m);
      next.set(e.block, {
        joins: e.joins ?? 0,
        cuts: e.cuts ?? 0,
        prices: e.prices ?? 0,
        settles: e.settles ?? 0,
        txs: e.txs ?? 0,
      });
      if (next.size > 120) next.delete(next.keys().next().value as number);
      return next;
    });
  });
  return (
    <div className="sc-belt">
      <div className="sc-belt-legend">
        <b>⛓ 区块传送带</b>
        <span className="sc-belt-chip prop" /> 已提议
        <span className="sc-belt-chip fin" /> 已终局
        <span className="dim">0.3s 出块 → 0.6s 终局</span>
      </div>
      <div className="sc-belt-track">
        {blocks.map((n) => {
          const a = agg.get(n);
          const fin = block - n >= 2;
          return (
            <div key={n} className={`sc-blk ${fin ? "fin" : "prop"} ${a ? "lit" : ""}`}>
              <span className="sc-blk-n mono">{String(n % 1000).padStart(3, "0")}</span>
              {a && (
                <span className="sc-blk-ev">
                  {a.joins > 0 && <i>🎟️×{a.joins}</i>}
                  {a.cuts > 0 && <i>⚡×{a.cuts}</i>}
                  {a.prices > 0 && <i>🏷️×{a.prices}</i>}
                  {a.settles > 0 && <i>💰×{a.settles}</i>}
                  {a.joins + a.cuts + a.prices + a.settles === 0 && a.txs > 0 && <i>📦×{a.txs}</i>}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ───────────── B 一笔插队的时间线 + C 以太坊对照条 ─────────────
const ETH_BLOCK_S = 12;
function CutTrace(props: { trace: Trace; lastCut: LiveState["stats"]["lastCut"]; solo: boolean }) {
  const c = props.trace.cut;
  const lc = props.lastCut && props.lastCut.cutId === c.cutId ? props.lastCut : null;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, ETH_BLOCK_S - (now - props.trace.at) / 1000);
  const chain = c.chainMs ?? lc?.chainMs ?? null;
  const steps: { label: string; value: string }[] = [
    { label: "点击", value: "0ms" },
    { label: "中继签名发出", value: "代付 gas" },
    { label: `进入区块 #${c.block}`, value: chain !== null ? `${chain}ms` : "—" },
    { label: "终局", value: "+600ms（2 个块）" },
    {
      label: "被插的人手机收到",
      value: lc?.fanoutMs != null ? `${lc.fanoutMs}ms（${lc.acks} 台已回执）` : "—",
    },
  ];
  void steps;
  return (
    <div className={`sc-trace sc-trace2 ${props.solo ? "solo" : ""}`}>
      <div className="sc-trace-line">
        点击 <i>→</i> 上链 <b className="mono">{chain !== null ? `${chain}ms` : "—"}</b> <i>→</i> 终局 <b className="mono">+600ms</b> <i>→</i>{" "}
        被插的人手机收到 <b className="mono">{lc?.fanoutMs != null ? `${lc.fanoutMs}ms` : "—"}</b>
      </div>
      <div className={`sc-eth ${left <= 0 ? "done" : ""}`}>
        <div className="sc-eth-text">
          {left > 0 ? (
            <>
              同一笔在以太坊：还要等 <b className="mono">{left.toFixed(1)}</b> 秒
            </>
          ) : (
            <>以太坊：现在才进块</>
          )}
        </div>
        <div className="sc-eth-bar">
          <div className="sc-eth-fill" />
        </div>
      </div>
    </div>
  );
}

function StormPanel({ storm }: { storm: Storm }) {
  const blocks = new Set(storm.items.map((x) => x.block)).size;
  return (
    <div className="sc-storm">
      <div className="sc-storm-title">
        🏷️ 全场改价：同一时刻 <b>{storm.items.length}</b> 笔改价 · 分布在 <b>{blocks}</b> 个块 ·
        各写各的数据，可并行执行
      </div>
      <div className="sc-lanes">
        {storm.items.map((x, i) => {
          const { name } = splitNick(x.nick, x.uid);
          return (
            <div key={`${x.uid}-${i}`} className="sc-lane">
              <span className="sc-lane-who">
                {name}
              </span>
              <span className="sc-lane-bar">
                <span className="sc-lane-fill" />
              </span>
              <span className="sc-lane-val mono">{x.noYield ? "🧱" : fmt(x.price, 1)}</span>
            </div>
          );
        })}
      </div>
      <div className="sc-serial">
        <span className="sc-lane-who">⚡ 插队</span>
        <span className="sc-serial-bar">
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className="sc-serial-seg" style={{ animationDelay: `${i * 260}ms` }} />
          ))}
        </span>
        <span className="sc-serial-note">改动整条队伍，串行执行</span>
      </div>
    </div>
  );
}
