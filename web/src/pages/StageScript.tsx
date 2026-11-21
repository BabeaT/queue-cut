// 导演台 · 演示剧本：把路演按顺序拆成一步一步，操作员只管照着点
import { useEffect, useRef, useState } from "react";
import { fmt, type LiveState, type QueueRow } from "../live.ts";
import { nameOf } from "./Mobile.tsx";

type Act = (label: string, action: string, body?: unknown) => Promise<any>;
type Ctx = {
  q: QueueRow[];
  state: LiveState | null;
  judge: QueueRow | undefined;
  act: Act;
  latest: () => LiveState | null;
  setNote: (s: string | null) => void;
};
type Step = {
  phase: "上台前" | "台上";
  title: string;
  say?: string; // 主讲台词
  what: string; // 会发生什么 / 操作员注意
  button: (c: Ctx) => string; // 按钮文字；manual 步骤是「完成，下一步」
  manual?: boolean;
  warn?: (c: Ctx) => string | null; // 有值就把按钮置灰并提示
  run?: (c: Ctx) => Promise<boolean>; // 返回 true 才进入下一步
  live?: (c: Ctx) => string | null; // 实时状态
};

const BOTS_TOTAL = 20;
const HEAD_BOTS = 15;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** 改价 2 个块后生效：按当前块算出实际生效的让位价 */
const eff = (r: QueueRow, block: number) =>
  r.pendingFrom && block >= r.pendingFrom ? { noYield: r.pendingNoYield, price: r.pendingPrice } : { noYield: r.noYield, price: r.price };
const botsIn = (q: QueueRow[]) => q.filter((r) => r.isBot).length;
const humans = (q: QueueRow[]) => q.filter((r) => !r.isBot);
/** 队首连续的「黄牛」：演示账号，且自己没付过插队钱（付过的是插队的人，不算黄牛） */
const headScalpers = (q: QueueRow[]) => {
  let n = 0;
  for (const r of q) {
    if (!r.isBot || r.frozenOut > 0) break;
    n++;
  }
  return n;
};
/** 等队首换人（索引器有一点延迟） */
async function waitHeadChange(latest: () => LiveState | null, uid: number | undefined, ms = 6000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (latest()?.queue[0]?.uid !== uid) return true;
    await sleep(200);
  }
  return false;
}

const STEPS: Step[] = [
  {
    phase: "上台前",
    title: "查 MON 余额",
    what: "查运营、3 个中继、20 个演示账号的 MON。标红的（不到 0.05）要先补，不然插队和入队会失败。",
    button: () => "💰 查余额",
    run: async ({ act, setNote }) => {
      const r = (await act("查 MON 余额", "balances")) as { address: string; mon: number }[] | undefined;
      if (!r) return false;
      const name = (i: number) => (i === 0 ? "运营" : i <= 3 ? `中继${i}` : `演示${String(i - 3).padStart(2, "0")}`);
      const low = r.map((m, i) => ({ ...m, n: name(i) })).filter((m) => m.mon < 0.05);
      setNote(
        `余额：运营 ${fmt(r[0]?.mon ?? 0, 3)} · 中继 ${r.slice(1, 4).map((m) => fmt(m.mon, 3)).join(" / ")} · ` +
          (low.length ? `⚠️ 不够 0.05 的有 ${low.length} 个：${low.map((m) => m.n).join("、")}` : "全部够用 ✅"),
      );
      return !low.length;
    },
  },
  {
    phase: "上台前",
    title: "清空队伍，开新一场",
    what: "过号柜台上的人、收摊、开新一场，钱全部原路退回；同时关掉黄牛场景。这是最贵的一步（gas limit 很高），上台前点一次就够，彩排别反复点。",
    button: () => "🧹 清空并开新一场",
    run: async ({ act }) => {
      if (!confirm("清空队伍并开新一场？队里所有人的钱原路退回。")) return false;
      const r = await act("清空队伍", "reset");
      await act("关闭黄牛场景", "reveal", { on: false });
      return !!r;
    },
  },
  {
    phase: "上台前",
    title: `铺 ${HEAD_BOTS} 个演示账号（之后变黄牛）`,
    what: `${HEAD_BOTS} 个演示账号先入队，排在最前面。黄牛场景关着，大屏上看起来就是普通人。剩下 ${BOTS_TOTAL - HEAD_BOTS} 个留给插队用，别全加满。`,
    button: ({ q }) => `➕ 添加 ${Math.max(0, HEAD_BOTS - botsIn(q))} 个演示账号`,
    warn: ({ q }) => (botsIn(q) >= HEAD_BOTS ? `队里已有 ${botsIn(q)} 个演示账号，直接点「跳过」` : null),
    run: async ({ act, q }) => !!(await act(`添加 ${HEAD_BOTS - botsIn(q)} 人`, "addPeople", { n: HEAD_BOTS - botsIn(q) })),
    live: ({ q }) => `队里演示账号 ${botsIn(q)} / ${HEAD_BOTS}`,
  },
  {
    phase: "上台前",
    title: "评委机、备用机扫码入队，选出评委",
    what: "评委那部手机最先扫码，然后备用手机陆续扫码，都排在演示账号后面。在下面「评委是谁」里选中评委那部手机（默认第一个真人）。",
    button: () => "✅ 完成，下一步",
    manual: true,
    warn: ({ judge }) => (judge ? null : "还没有真人入队 / 没选评委"),
    live: ({ q, judge }) => `真人 ${humans(q).length} 人 · 评委：${judge ? `${nameOf(judge.nick)}（第 ${judge.rank} 位）` : "未选"}`,
  },
  {
    phase: "台上",
    title: "开场：全场扫码排队",
    say: "大家先扫码排个队，有人插你，你就有钱收。",
    what: "大屏放二维码，主讲讲背景。等真人数涨上来再点下一步。",
    button: () => "✅ 下一步",
    manual: true,
    live: ({ q }) => `现在真人 ${humans(q).length} 人 · 队伍共 ${q.length} 人`,
  },
  {
    phase: "台上",
    title: "第一幕 · 插队红包雨",
    say: "现在全场都在这条队里。有个人很着急，他要从最后一位插到第一位。",
    what: "一个演示账号从队尾插到第 1 位，越过所有人。台下真人的手机同时响，大屏一排红包。前面的演示账号也收到冻结红包（第三幕要用）。点完停两秒，再念下面的数字。",
    button: () => "⚡ 插到第 1 位",
    warn: ({ q }) => (q.length < 2 ? "队里人太少" : botsIn(q) >= BOTS_TOTAL ? "没有空闲的演示账号了" : null),
    run: async ({ act }) => !!(await act("第一幕：插到第 1 位", "botCut", { toRank: 1 })),
    live: ({ state }) => {
      const c = state?.stats.lastCut;
      return c ? `最近一次插队：越过 ${c.victims} 人 · 合计 ${fmt(c.total)} · 链上 ${c.chainMs ?? "…"} ms · 块 #${c.block}` : null;
    },
  },
  {
    phase: "台上",
    title: "第二幕 · 评委守位",
    say: "他还想往前插，插到评委老师前面。评委老师，您挂的是 0.5：让，就收钱；不让，点一下「不让」，一分钱不花。",
    what: "先等评委在手机上选完（改价 2 个块后生效，看下面状态不再显示「生效中」）。然后点按钮：选了「让」，评委手机到账；选了「不让」，插队停在评委身后，大屏出现一堵墙。",
    button: ({ judge }) => (judge ? `⚡ 插到评委前面（第 ${judge.rank} 位）` : "⚡ 插到评委前面"),
    warn: ({ judge, q, state }) => {
      if (!judge) return "评委不在队里，先在上面选评委";
      if (judge.pendingFrom && judge.pendingFrom > (state?.block ?? 0)) return "评委的选择还在生效中，等一秒";
      if (botsIn(q) >= BOTS_TOTAL) return "没有空闲的演示账号了";
      return null;
    },
    run: async ({ act, judge }) => !!(judge && (await act(`第二幕：插到第 ${judge.rank} 位`, "botCut", { toRank: judge.rank }))),
    live: ({ judge, state }) => {
      if (!judge) return null;
      const e = eff(judge, state?.block ?? 0);
      return `评委 ${nameOf(judge.nick)}：第 ${judge.rank} 位 · ${e.noYield ? "🧱 不让" : `让位价 ${fmt(e.price)}`} · 冻结收益 🔒${fmt(judge.frozenIn)}`;
    },
  },
  {
    phase: "台上",
    title: "第三幕 ① 黄牛现形",
    say: "有人会问：黄牛呢？其实队伍最前面这十几个，就是黄牛。他们只排队不买东西，手里还攥着刚才的插队红包。",
    what: "打开黄牛场景，大屏把队首的演示账号标成黄牛。",
    button: () => "🕶️ 打开黄牛场景",
    run: async ({ act }) => !!(await act("打开黄牛场景", "reveal", { on: true })),
  },
  {
    phase: "台上",
    title: "第三幕 ② 插队的人先消费",
    what: "队首是第一幕插队的人，先叫号核销他（插队的人真消费了）。不先核销他的话，下一步会把他一起过号，第一幕真人收到的红包就全退了。",
    button: ({ q }) => `✅ 叫号 + 核销队首（${q[0] ? nameOf(q[0].nick) : "—"}）`,
    warn: ({ q }) => (!q[0] ? "队伍是空的" : q[0].isBot && q[0].frozenOut > 0 ? null : "队首不是第一幕插队的人，确认没问题再点「跳过」"),
    run: async ({ act, q, latest }) => {
      const r = await act("核销插队的人", "callServe");
      if (r) await waitHeadChange(latest, q[0]?.uid);
      return !!r;
    },
  },
  {
    phase: "台上",
    title: "第三幕 ③ 叫号，黄牛一个都没来",
    say: "叫号——没人来，过号。",
    what: "队首连续的黄牛一笔交易全部过号，成排变灰，他们攥着的红包原路飞回插队的人。黄牛「实际到手」一直是 0。",
    button: ({ q }) => `📣 队首 ${headScalpers(q)} 个黄牛一次过号`,
    warn: ({ q }) => (headScalpers(q) === 0 ? "队首没有黄牛" : null),
    run: async ({ act, q }) => !!(await act(`黄牛过号 ${headScalpers(q)} 个`, "skipHead", { n: headScalpers(q) })),
  },
  {
    phase: "台上",
    title: "第三幕 ④ 真人来了，钱到账",
    say: "真来消费的人，钱到手；黄牛，白忙一场。黄牛要么白忙一场，要么变成真顾客。",
    what: "一直核销到第一个真人为止（中间如果有插队的演示账号，一起核销掉）。真人身上冻结的红包变成金色到账。",
    button: ({ q }) => {
      const h = q.findIndex((r) => !r.isBot);
      return h < 0 ? "✅ 核销到第一个真人" : `✅ 核销到第一个真人（${nameOf(q[h].nick)}，核销 ${h + 1} 人）`;
    },
    warn: ({ q }) => (q.findIndex((r) => !r.isBot) < 0 ? "队里没有真人" : null),
    run: async ({ act, latest }) => {
      for (let i = 0; i < 4; i++) {
        const head = latest()?.queue[0];
        if (!head) return false;
        const r = await act(`核销 ${nameOf(head.nick)}`, "callServe");
        if (!r) return false;
        if (!head.isBot) return true;
        await waitHeadChange(latest, head.uid);
      }
      return true;
    },
  },
  {
    phase: "台上",
    title: "Why Monad · 全场改价",
    say: "为什么是 Monad？0.3 秒一个块，链上的队伍和店门口同步；一笔交易给几十个人分账，gas 可以忽略。现在全场同时改价——",
    what: "队里所有演示账号同时各发一笔改价交易，大屏显示同块统计。主讲指着大屏底部的实测数字讲。",
    button: () => "🏷️ 全场改价",
    run: async ({ act }) => !!(await act("全场改价", "botsReprice")),
  },
  {
    phase: "台上",
    title: "收尾",
    say: "Monad 在协议层不让人偷偷插队，我们在应用层让插队公开、付费，钱给被插的人。同一套合约也能管演唱会回流票的候补队。广州人排一位，值几多钱？今晚全场的答案在大屏上。谢谢！",
    what: "不用点任何东西。演完下台后，回到第 1 步准备下一轮。",
    button: () => "🎉 演完了",
    manual: true,
  },
];

const LS_STEP = "queuecut.script.step";
const LS_JUDGE = "queuecut.script.judge";
const lsGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
};

export default function StageScript({ state, act, busy }: { state: LiveState | null; act: Act; busy: string | null }) {
  const [cur, setCur] = useState(() => Math.min(STEPS.length - 1, Number(lsGet(LS_STEP) ?? 0) || 0));
  const [judgeUid, setJudgeUid] = useState<number | null>(() => (lsGet(LS_JUDGE) ? Number(lsGet(LS_JUDGE)) : null));
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const ref = useRef(state);
  ref.current = state;
  useEffect(() => lsSet(LS_STEP, String(cur)), [cur]);
  useEffect(() => lsSet(LS_JUDGE, judgeUid == null ? "" : String(judgeUid)), [judgeUid]);

  const q = state?.queue ?? [];
  const judge = q.find((r) => r.uid === judgeUid) ?? (judgeUid == null ? humans(q)[0] : undefined);
  const ctx: Ctx = { q, state, judge, act, latest: () => ref.current, setNote };
  const step = STEPS[cur];
  const warn = step.warn?.(ctx) ?? null;
  const live = step.live?.(ctx) ?? null;
  const go = (i: number) => {
    setNote(null);
    setCur(Math.max(0, Math.min(STEPS.length - 1, i)));
  };

  const run = async () => {
    if (step.manual || !step.run) return go(cur + 1);
    setRunning(true);
    try {
      setNote(null);
      if (await step.run(ctx)) setCur((c) => Math.min(STEPS.length - 1, c + 1));
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="st-card wide ss">
      <div className="ss-top">
        <h3>📋 演示剧本 · 照着点</h3>
        <span className="dim small">进度存在本机，刷新不丢</span>
        <span className="ss-judge">
          评委是谁：
          <select value={judge?.uid ?? ""} onChange={(e) => setJudgeUid(e.target.value ? Number(e.target.value) : null)}>
            <option value="">（自动：第一个真人）</option>
            {humans(q).map((r) => (
              <option key={r.uid} value={r.uid}>
                第 {r.rank} 位 · {nameOf(r.nick)}
              </option>
            ))}
          </select>
        </span>
        <button onClick={() => go(0)} disabled={running}>
          ↺ 从头开始
        </button>
      </div>
      <div className="ss-body">
        <ol className="ss-list">
          {STEPS.map((s, i) => (
            <li key={i} className={i === cur ? "on" : i < cur ? "done" : ""} onClick={() => !running && go(i)}>
              <span className="ss-no">{i < cur ? "✓" : i + 1}</span>
              <span className="ss-ph">{s.phase}</span>
              <span>{s.title}</span>
            </li>
          ))}
        </ol>
        <div className="ss-now">
          <div className="ss-step">
            第 {cur + 1} / {STEPS.length} 步 · {step.phase}
          </div>
          <div className="ss-title">{step.title}</div>
          {step.say && (
            <div className="ss-say">
              <b>🎤 主讲说：</b>
              {step.say}
            </div>
          )}
          <div className="ss-what">
            <b>👉 会发生：</b>
            {step.what}
          </div>
          {live && <div className="ss-live mono">● {live}</div>}
          {note && <div className="ss-live mono">{note}</div>}
          {warn && <div className="ss-warn">⚠️ {warn}</div>}
          <button className="primary ss-go" disabled={running || !!busy || !!warn} onClick={run}>
            {running ? `执行中…${busy ? `（${busy}）` : ""}` : step.button(ctx)}
          </button>
          <div className="ss-nav">
            <button onClick={() => go(cur - 1)} disabled={running || cur === 0}>
              ← 上一步
            </button>
            <button onClick={() => go(cur + 1)} disabled={running || cur === STEPS.length - 1}>
              跳过 →
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
