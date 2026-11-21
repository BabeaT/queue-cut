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
  const [addN, setAddN] = useState(10);
  const [cutRank, setCutRank] = useState(1);
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
        <span>队伍 {q.length} 人 · 其中演示账号 {q.filter((r) => r.isBot).length} 个</span>
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
          <h3>🤖 演示账号（20 个真实链上地址，各自发交易）</h3>
          <div className="st-inline">
            <span>添加</span>
            <input type="number" value={addN} min={1} max={20} onChange={(e) => setAddN(Number(e.target.value))} />
            <span>人排队</span>
            <button className="primary" disabled={!!busy} onClick={() => act(`添加 ${addN} 人排队`, "addPeople", { n: addN })}>
              ➕ 添加
            </button>
          </div>
          <div className="st-inline">
            <span>让队尾的演示账号插队到第</span>
            <input type="number" value={cutRank} min={1} max={Math.max(1, q.length)} onChange={(e) => setCutRank(Number(e.target.value))} />
            <span>位</span>
            <button className="primary" disabled={!!busy || q.length < 2} onClick={() => act(`演示账号插到第 ${cutRank} 位`, "botCut", { toRank: cutRank })}>
              ⚡ 插队（体验被插）
            </button>
          </div>
          <div className="st-btns col">
            <button disabled={!!busy} onClick={() => act("全场改价", "botsReprice")}>
              🏷️ 全场改价（演示账号同时各发一笔改价交易，看并发）
            </button>
            <button className="danger" disabled={!!busy} onClick={() => confirm("清空队伍：所有人算没消费，钱全部原路退回，开新一场。确定？") && act("清空队伍", "reset")}>
              🧹 一键清空队伍
            </button>
          </div>
        </section>

        <section className="st-card">
          <h3>🎬 演示</h3>
          <div className="st-btns col">
            <button disabled={!!busy} onClick={() => act(state?.reveal ? "关闭黄牛场景" : "打开黄牛场景", "reveal", { on: !state?.reveal })}>
              🕶️ 黄牛场景：{state?.reveal ? "已打开（点击关闭）" : "打开（把只排不买的演示账号标成黄牛）"}
            </button>
            <button className="danger" disabled={!!busy || headBots === 0} onClick={() => act(`队首 ${headBots} 个一次过号`, "act3")}>
              📣 叫号没人来：队首 {headBots} 个演示账号一次过号（同一笔交易）
            </button>
            {headBots === 0 && q.length > 0 && <div className="dim small">队首是真人：先「叫号 + 核销队首」</div>}
          </div>
        </section>

        <section className="st-card wide">
          <h3>队伍</h3>
          <div className="st-queue">
            {q.map((r) => (
              <div key={r.uid} className={`st-q ${r.isBot ? "bot" : ""}`}>
                <span className="st-rank">{r.rank}</span>
                <span>{avatarOf(r.nick, r.uid)}</span>
                <span className="grow">{nameOf(r.nick)}{r.isBot ? " 🤖" : ""}</span>
                <span className="mono">{r.noYield ? "🧱" : fmt(r.price)}</span>
                <span className="mono gold">🔒{fmt(r.frozenIn)}</span>
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
                    {i === 0 ? "运营" : i <= 3 ? `中继${i}` : `演示${String(i - 3).padStart(2, "0")}`} {m.address.slice(0, 8)} {fmt(m.mon, 3)}
                  </div>
                ))}
              </div>
            )}
            <button disabled={!!busy} onClick={() => confirm("收摊：队里所有人算没消费，钱全部原路退回。确定？") && act("收摊", "close")}>
              🌙 收摊
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
