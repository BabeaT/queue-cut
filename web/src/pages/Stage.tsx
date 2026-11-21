// 店员台 + 导演台（口令：/stage?key=xxx，记在本机）
import { useState } from "react";
import { useLive, useBlock, fmt, EXPLORER } from "../live.ts";
import { stage, stageKey } from "../wallet.ts";
import { avatarOf, nameOf } from "./Mobile.tsx";
import "./stage.css";

export default function Stage() {
  const { state, connected } = useLive();
  const block = useBlock();
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [mon, setMon] = useState<{ address: string; mon: number }[] | null>(null);
  const [secs, setSecs] = useState(20);
  const key = stageKey();

  const act = async (label: string, action: string, body: unknown = {}) => {
    setBusy(label);
    const t = Date.now();
    try {
      const r = await stage(action, body);
      setLog((l) => [`${new Date().toLocaleTimeString()} ✅ ${label} ${Date.now() - t}ms ${JSON.stringify(r).slice(0, 160)}`, ...l].slice(0, 30));
      return r;
    } catch (e) {
      setLog((l) => [`${new Date().toLocaleTimeString()} ❌ ${label}：${(e as Error).message}`, ...l].slice(0, 30));
    } finally {
      setBusy(null);
    }
  };

  if (!key) return <div className="st-root">请用 /stage?key=口令 打开</div>;
  const q = state?.queue ?? [];
  const headBots = (() => {
    let n = 0;
    for (const r of q) {
      if (!r.isBot) break;
      n++;
    }
    return n;
  })();

  return (
    <div className="st-root">
      <header className="st-head">
        <b>🧑‍🍳 店员台 · 🎬 导演台</b>
        <span className={connected ? "ok" : "bad"}>{connected ? "● 已连接" : "● 断线"}</span>
        <span className="mono">块 #{block || state?.block}</span>
        <span>队伍 {q.length} 人 · 黄牛在队首 {headBots} 个</span>
        <a href={`${EXPLORER}/address/${state?.contract}`} target="_blank" rel="noreferrer" className="mono">
          合约 {state?.contract?.slice(0, 10)}…
        </a>
      </header>

      <div className="st-grid">
        <section className="st-card">
          <h3>🧑‍🍳 店员</h3>
          <div className="st-btns">
            <button className="primary" disabled={!!busy} onClick={() => act("叫号", "call")}>
              📣 叫号
            </button>
            <button className="primary" disabled={!!busy || !q.length} onClick={() => act("叫号并核销队首", "callServe")}>
              ✅ 叫号 + 核销队首（{q[0] ? nameOf(q[0].nick) : "—"}）
            </button>
          </div>
          <h4>柜台（已叫号）</h4>
          {state?.called.length ? (
            state.called.map((c) => (
              <div key={c.uid} className="st-row">
                <span>{nameOf(c.nick)}</span>
                <button disabled={!!busy} onClick={() => act(`核销 ${c.nick}`, "serve", { uid: c.uid })}>
                  核销（来了）
                </button>
                <button disabled={!!busy} onClick={() => act(`过号 ${c.nick}`, "skip", { uid: c.uid })}>
                  过号（没来）
                </button>
              </div>
            ))
          ) : (
            <div className="dim">柜台没人</div>
          )}
        </section>

        <section className="st-card">
          <h3>🎬 三幕</h3>
          <div className="st-btns col">
            <button disabled={!!busy} onClick={() => act("放出黄牛 20 个号", "botsJoin")}>
              🕶️ 开场前：放出黄牛（20 个号各自上链入队）
            </button>
            <div className="st-inline">
              <span>第二幕 聚光灯</span>
              <input type="number" value={secs} min={5} max={60} onChange={(e) => setSecs(Number(e.target.value))} />
              <span>秒 · 在下面队伍里点「🔦」选人</span>
              <button disabled={!!busy || !state?.spotlight} onClick={() => act("关聚光灯", "spotlightOff")}>
                关
              </button>
            </div>
            {state?.spotlight && (
              <div className="st-spot">
                🔦 {nameOf(state.spotlight.nick)} · 喊让 {state.spotlight.yield} / 喊不让 {state.spotlight.hold}
              </div>
            )}
            <button className="danger" disabled={!!busy || headBots === 0} onClick={() => act(`黄牛专场：${headBots} 个一次过号`, "act3")}>
              🕶️ 第三幕：队首 {headBots} 个黄牛一次过号（同一笔交易）
            </button>
            {headBots === 0 && q.length > 0 && <div className="dim small">队首是真人：先「叫号 + 核销队首」，黄牛到了队首再按</div>}
          </div>
        </section>

        <section className="st-card wide">
          <h3>队伍</h3>
          <div className="st-queue">
            {q.map((r) => (
              <div key={r.uid} className={`st-q ${r.isBot ? "bot" : ""}`}>
                <span className="st-rank">{r.rank}</span>
                <span>{avatarOf(r.nick, r.uid, r.isBot)}</span>
                <span className="grow">{nameOf(r.nick)}</span>
                <span className="mono">{r.noYield ? "🧱" : fmt(r.price)}</span>
                <span className="mono gold">🔒{fmt(r.frozenIn)}</span>
                <button disabled={!!busy} onClick={() => act(`聚光灯 ${r.nick}`, "spotlight", { uid: r.uid, seconds: secs })}>
                  🔦
                </button>
              </div>
            ))}
            {!q.length && <div className="dim">队伍是空的</div>}
          </div>
        </section>

        <section className="st-card">
          <h3>🛠️ 运维</h3>
          <div className="st-btns col">
            <button disabled={!!busy} onClick={async () => setMon((await act("查 MON 余额", "balances")) ?? null)}>
              查各账户 MON 余额
            </button>
            {mon && (
              <div className="st-mon mono">
                {mon.map((m, i) => (
                  <div key={m.address} className={m.mon < 0.05 ? "low" : ""}>
                    {i === 0 ? "运营" : i <= 3 ? `中继${i}` : `黄牛${String(i - 3).padStart(2, "0")}`} {m.address.slice(0, 8)} {fmt(m.mon, 3)}
                  </div>
                ))}
              </div>
            )}
            <button disabled={!!busy} onClick={() => confirm("收摊：队里所有人算没消费，钱全部原路退回。确定？") && act("收摊", "close")}>
              🌙 收摊
            </button>
            <button className="danger" disabled={!!busy} onClick={() => confirm("重置：过号柜台、收摊、开新一场。彩排后用。确定？") && act("重置开新一场", "reset")}>
              ♻️ 重置（彩排后开新一场）
            </button>
          </div>
        </section>

        <section className="st-card wide">
          <h3>日志 {busy && <span className="dim">（{busy}…）</span>}</h3>
          <div className="st-log mono">
            {log.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
