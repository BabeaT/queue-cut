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
import "./screen.css";

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
type Fly = { id: number; x: number; y: number; dx: number; dy: number; text: string };
type Ghost = { id: number; x: number; y: number; w: number; h: number; avatar: string; name: string; isBot: boolean };
type Beam = { id: number; x: number; y: number; len: number; angle: number };
type Banner = { id: number; cut: CutEvent; rank: number };

let fxSeq = 0;
const nextId = () => ++fxSeq;

export default function Screen() {
  const { state, connected } = useLive();
  const block = useBlock();
  const queue = state?.queue ?? [];

  const [fx, setFx] = useState<Fx[]>([]);
  const [flies, setFlies] = useState<Fly[]>([]);
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const [beams, setBeams] = useState<Beam[]>([]);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [shake, setShake] = useState(false);
  const [blockFlash, setBlockFlash] = useState<{ id: number; block: number; joins: number; txs: number } | null>(null);
  const [maxJoins, setMaxJoins] = useState(0);
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
        if (from && to) {
          const x1 = from.left + from.width / 2;
          const y1 = from.top + from.height / 2;
          const x2 = to.left + to.width / 2;
          const y2 = to.top + to.height / 2;
          const id = nextId();
          setBeams((b) => [
            ...b,
            { id, x: x1, y: y1, len: Math.hypot(x2 - x1, y2 - y1), angle: (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI },
          ]);
          later(1400, () => setBeams((b) => b.filter((x) => x.id !== id)));
        }
        addFx(
          e.victims.map((v) => ({ uid: v.uid, kind: "packet" as const, text: `+${fmt(v.amount)}` })),
          4200,
        );
        const targetRank = firstVictim !== undefined ? (queue.find((q) => q.uid === firstVictim)?.rank ?? 1) : 1;
        const id = nextId();
        setBanner({ id, cut: e, rank: targetRank });
        later(5200, () => setBanner((b) => (b?.id === id ? null : b)));
        setShake(true);
        later(600, () => setShake(false));
        break;
      }
      case "settled": {
        if (e.toVictim) {
          addFx([{ uid: e.victim.uid, kind: "paid", text: `✅ 到账 +${fmt(e.amount)}` }], 3000);
        } else {
          addFx([{ uid: e.victim.uid, kind: "refund", text: `↩ 退回 ${fmt(e.amount)}` }], 2600);
          const a = rectOf(e.victim.uid);
          const b = rectOf(e.cutter.uid);
          if (a && b) {
            const id = nextId();
            setFlies((f) => [
              ...f,
              {
                id,
                x: a.left + a.width / 2,
                y: a.top + 10,
                dx: b.left + b.width / 2 - (a.left + a.width / 2),
                dy: b.top + 10 - (a.top + 10),
                text: `🧧${fmt(e.amount)}`,
              },
            ]);
            later(1500, () => setFlies((f) => f.filter((x) => x.id !== id)));
          }
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
              { id, x: r.left, y: r.top, w: r.width, h: r.height, avatar, name, isBot: row.isBot },
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
      case "blockStats": {
        const id = nextId();
        setBlockFlash({ id, block: e.block, joins: e.joins, txs: e.txs });
        setMaxJoins((m) => Math.max(m, e.joins));
        later(2500, () => setBlockFlash((b) => (b?.id === id ? null : b)));
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

  const spotlight = state?.spotlight ?? null;
  const dense = queue.length > 48;

  return (
    <div className={`sc-root ${shake ? "shake" : ""} ${spotlight ? "spot-on" : ""}`}>
      <header className="sc-head">
        <div className="sc-title">
          <div className="sc-logo">🧧 插队红包</div>
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
        <div className="sc-blockbox">
          <div className="sc-block-row">
            {!connected && <span className="sc-recon">● 重连中</span>}
            <span className="sc-block-label">块</span>
            <span key={block} className="sc-block mono">
              #{block || state?.block || "…"}
            </span>
          </div>
          <div className="sc-block-sub">Monad 测试网 · 0.3s 出块 · 0.6s 终局</div>
          <div className="sc-block-stats">
            {blockFlash ? (
              <span key={blockFlash.id} className="sc-bflash">
                块 #{blockFlash.block}：{blockFlash.joins} 人入队 / {blockFlash.txs} 笔交易
              </span>
            ) : maxJoins > 0 ? (
              <span className="dim">最高同块入队 {maxJoins} 人</span>
            ) : null}
          </div>
        </div>
      </header>

      <main className="sc-main">
        <section className={`sc-stage ${dense ? "dense" : ""}`}>
          {!state || queue.length === 0 ? (
            <EmptyStage connected={connected} hasState={!!state} />
          ) : (
            <div className="sc-line">
              <div className="sc-counter" ref={counterEl}>
                <div className="sc-counter-title">🏪 柜台</div>
                <div className="sc-counter-list">
                  {(state.called ?? []).slice(-3).map((c) => {
                    const { avatar, name } = splitNick(c.nick, c.uid);
                    return (
                      <div key={c.uid} className="sc-called">
                        <span className="sc-called-av">{avatar}</span>
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
            className="sc-fly"
            style={{ left: f.x, top: f.y, ["--dx" as any]: `${f.dx}px`, ["--dy" as any]: `${f.dy}px` }}
          >
            {f.text}
          </div>
        ))}
        {ghosts.map((g) => (
          <div key={g.id} className={`sc-ghost ${g.isBot ? "bot" : ""}`} style={{ left: g.x, top: g.y, width: g.w, height: g.h }}>
            <div className="sc-ghost-av">{g.avatar}</div>
            <div className="sc-ghost-name">{g.name}</div>
            <div className="sc-ghost-tag">过号</div>
          </div>
        ))}
        {banner && <CutBanner key={banner.id} banner={banner} />}
        {spotlight && <SpotlightPanel spotlight={spotlight} />}
      </div>
    </div>
  );
}

// ───────────── 队伍里的一个人 ─────────────
function Card(props: { row: QueueRow; fx?: Fx[]; spot: boolean; refCb: (el: HTMLDivElement | null) => void }) {
  const { row } = props;
  const { avatar, name } = splitNick(row.nick, row.uid);
  const pending = row.pendingFrom > 0;
  return (
    <div className="sc-slot" ref={props.refCb}>
      <div className={`sc-card ${row.isBot ? "bot" : ""} ${row.noYield ? "wall" : ""} ${props.spot ? "spot" : ""}`}>
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
        <div className="sc-av">{avatar}</div>
        <div className="sc-name">{name}</div>
        {row.isBot && <div className="sc-bot-tag">黄牛</div>}
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
  const { avatar, name } = splitNick(c.cutter.nick, c.cutter.uid);
  return (
    <div className="sc-banner">
      <div className="sc-banner-main">
        {avatar} <b>{name}</b> 插队到第 <b className="hot">{banner.rank}</b> 位
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
  const { avatar, name } = splitNick(spotlight.nick, spotlight.uid);
  return (
    <div className="sc-spot">
      <div className="sc-spot-box">
        <div className="sc-spot-av">{avatar}</div>
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
function QrCard() {
  const [src, setSrc] = useState("");
  useEffect(() => {
    QRCode.toDataURL(location.origin + "/m", {
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
        <div className="sc-qr-url mono">{location.host}/m</div>
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
        🕴 黄牛 {state?.bots?.count ?? 20} 个号
      </div>
      <div className="sc-bots-big">
        实际到手 <b className="gold mono">{fmt(last?.profit ?? 0)}</b>
        <span className="sc-bots-idle">黄牛白忙中</span>
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
    <footer className="sc-foot">
      <Metric label="插队次数" value={s?.cuts ?? 0} />
      <Metric label="发出红包" value={s?.packets ?? 0} />
      <Metric label="已到账" value={s?.toVictim ?? 0} unit="笔" />
      <Metric label="原路退回" value={s?.refunded ?? 0} unit="笔" />
      <div className="sc-metric wide">
        <div className="sc-m-label">最近一次插队</div>
        {lc ? (
          <div className="sc-m-row">
            <span>
              链上确认 <b className="mono">{lc.chainMs ?? "—"}</b>ms
            </span>
            <span>
              全场到账 <b className="mono">{lc.fanoutMs ?? "—"}</b>ms<small>（{lc.acks} 台手机）</small>
            </span>
            <span>
              gas <b className="mono">{(lc.gasLimit || lc.gasUsed).toLocaleString()}</b> /{" "}
              <b className="mono">{lc.gasUsed.toLocaleString()}</b>
              <small> limit/used · Monad 按 gas limit 收费</small>
            </span>
            <a className="mono" href={`${EXPLORER}/tx/${lc.txHash}`} target="_blank" rel="noreferrer">
              {lc.txHash.slice(0, 10)}…
            </a>
          </div>
        ) : (
          <div className="dim">还没有人插队</div>
        )}
      </div>
    </footer>
  );
}

function Metric(props: { label: string; value: number; unit?: string }) {
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
