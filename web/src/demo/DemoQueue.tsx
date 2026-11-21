import { useEffect, useReducer, useRef, useState, type FormEvent } from "react";
import { Character } from "../home/HomePage.tsx";
import {
  amount,
  demoReducer,
  initialDemo,
  ME,
  parseAmount,
  person,
  quoteDemo,
  type DemoAction,
  type DemoState,
  type PersonStatus,
} from "./model.ts";
import "./demo.css";

const statusText: Record<PersonStatus, string> = {
  queued: "排队中",
  called: "已叫号",
  served: "已完成消费",
  gone: "未消费离队",
};
const receiptText = {
  pending: "待双方消费",
  paid: "已到账",
  refunded: "已退回插队者",
};

function PriceEditor({
  price,
  noYield,
  onPrice,
  onNoYield,
}: {
  price: string;
  noYield: boolean;
  onPrice: (value: string) => void;
  onNoYield: (value: boolean) => void;
}) {
  return (
    <div className="demo-price-editor">
      <div className="demo-field-heading">
        <label htmlFor="asking-price">我的让位价格</label>
        <span>排队币 / 每被越过一位</span>
      </div>
      <div className="demo-price-input">
        <input
          id="asking-price"
          type="number"
          min="0.1"
          max="10"
          step="0.1"
          inputMode="decimal"
          value={price}
          disabled={noYield}
          onChange={(e) => onPrice(e.target.value)}
        />
        <span>排队币</span>
      </div>
      <input
        aria-label="调整让位价格"
        type="range"
        min="0.1"
        max="10"
        step="0.1"
        value={price || "0.5"}
        disabled={noYield}
        onChange={(e) => onPrice(e.target.value)}
      />
      <div className="demo-presets">
        {["0.2", "0.5", "1", "3"].map((value) => (
          <button
            type="button"
            key={value}
            className={price === value && !noYield ? "selected" : ""}
            disabled={noYield}
            onClick={() => onPrice(value)}
          >
            {value}
          </button>
        ))}
      </div>
      <label className="demo-toggle">
        <input
          type="checkbox"
          role="switch"
          checked={noYield}
          onChange={(e) => onNoYield(e.target.checked)}
        />
        <span>我不让位</span>
        <small>其他人最多插到你身后</small>
      </label>
    </div>
  );
}

function CutDialog({
  state,
  dispatch,
  onClose,
}: {
  state: DemoState;
  dispatch: (action: DemoAction) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [target, setTarget] = useState(1);
  const initialQuote = quoteDemo(state, 1);
  const [maxPay, setMaxPay] = useState(amount(initialQuote.total));
  const [error, setError] = useState("");
  const quote = quoteDemo(state, target);
  const rank = state.line.indexOf(ME) + 1;
  const me = person(state, ME);

  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    const cap = parseAmount(maxPay);
    if (cap === null) {
      setError("请输入有效金额，最小步进为 0.1 排队币。");
      return;
    }
    if (!quote.victims.length) {
      setError("当前被不让用户挡住，没有可越过的人。");
      return;
    }
    dispatch({ type: "cut", target, maxPay: cap });
    if (cap < quote.total) {
      setError(
        "模拟交易失败：实际报价超过最多愿付，未扣除余额。请调整金额或目标位置。",
      );
      return;
    }
    if (me.balance < quote.total) {
      setError("可用余额不足，请调整目标位置。");
      return;
    }
    onClose();
  }

  return (
    <dialog
      className="demo-dialog"
      ref={dialog}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      aria-labelledby="cut-title"
    >
      <form onSubmit={submit}>
        <div className="demo-dialog-heading">
          <div>
            <p className="qa-kicker">SIMULATED CUT</p>
            <h2 id="cut-title">准备往前几位？</h2>
          </div>
          <button
            className="demo-close"
            type="button"
            aria-label="关闭插队窗口"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p className="demo-muted">当前第 {rank} 位 · 本次操作使用模拟排队币</p>
        <label className="demo-field">
          希望插到的位置
          <select
            value={target}
            onChange={(e) => {
              const next = Number(e.target.value);
              setTarget(next);
              setMaxPay(amount(quoteDemo(state, next).total));
              setError("");
            }}
          >
            {Array.from({ length: rank - 1 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                第 {i + 1} 位
              </option>
            ))}
          </select>
        </label>
        {quote.wall && (
          <p className="demo-warning">
            {quote.wall.nick} 选择了不让，最多能到第 {quote.reach}{" "}
            位，停在其身后。
          </p>
        )}
        <div className="demo-quote-top">
          <span>
            实际可到 <b>第 {quote.reach} 位</b>
          </span>
          <span>
            越过 <b>{quote.victims.length} 人</b>
          </span>
        </div>
        <h3>逐人补偿明细</h3>
        <ul className="demo-breakdown">
          {quote.victims.map((p) => (
            <li key={p.id}>
              <span>{p.nick}</span>
              <strong>{amount(p.price)} 排队币</strong>
            </li>
          ))}
        </ul>
        {!quote.victims.length && (
          <p className="demo-muted">当前没有可越过的用户。</p>
        )}
        <div className="demo-total">
          <span>预计支付总额</span>
          <strong>
            {amount(quote.total)} <small>排队币</small>
          </strong>
        </div>
        <label className="demo-field">
          最多愿付金额
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.1"
            value={maxPay}
            onChange={(e) => {
              setMaxPay(e.target.value);
              setError("");
            }}
          />
        </label>
        <p className="demo-muted">
          实际费用超过这个上限，整笔模拟交易失败。补偿先冻结，双方都消费后才结算。
        </p>
        {error && (
          <p className="demo-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="demo-button demo-primary"
          type="submit"
          disabled={!quote.victims.length}
        >
          确认模拟插队
        </button>
        <button
          className="demo-button demo-text-button"
          type="button"
          onClick={onClose}
        >
          再考虑一下
        </button>
      </form>
    </dialog>
  );
}

export default function DemoQueue() {
  const [state, dispatch] = useReducer(demoReducer, undefined, initialDemo);
  const [nick, setNick] = useState("");
  const [price, setPrice] = useState("0.5");
  const [noYield, setNoYield] = useState(false);
  const [formError, setFormError] = useState("");
  const [cutOpen, setCutOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<
    "leave" | "close" | "reset" | null
  >(null);
  const confirmDialog = useRef<HTMLDialogElement>(null);
  const me = state.people.find((p) => p.id === ME);
  const rank = state.line.indexOf(ME) + 1;
  const called = state.people.find((p) => p.status === "called");
  const records = state.receipts.filter(
    (r) => r.cutter === ME || r.victim === ME,
  );
  const incoming = records.filter((r) => r.victim === ME);
  const outgoing = records.filter((r) => r.cutter === ME);
  const sum = (items: typeof records) =>
    items.reduce((total, r) => total + r.amount, 0);
  const frozenIn = sum(incoming.filter((r) => r.status === "pending"));
  const paid = sum(incoming.filter((r) => r.status === "paid"));
  const frozenOut = sum(outgoing.filter((r) => r.status === "pending"));
  const refunded = sum(outgoing.filter((r) => r.status === "refunded"));
  const active = me?.status === "queued" || me?.status === "called";
  const isQueued = me?.status === "queued";

  useEffect(() => {
    const timer = window.setInterval(() => dispatch({ type: "tick" }), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (confirmation) confirmDialog.current?.showModal();
    else confirmDialog.current?.close();
  }, [confirmation]);

  function submitSettings(event: FormEvent) {
    event.preventDefault();
    const parsed = parseAmount(price);
    if (parsed === null || parsed < 1 || parsed > 100) {
      setFormError("让位价需在 0.1–10 排队币之间，步进为 0.1。");
      return;
    }
    if (!state.joined && !nick.trim()) {
      setFormError("先给自己取个昵称吧。");
      return;
    }
    setFormError("");
    if (!state.joined) dispatch({ type: "join", nick, price: parsed, noYield });
    else dispatch({ type: "price", price: parsed, noYield });
  }

  function reset() {
    dispatch({ type: "reset" });
    setCutOpen(false);
    setPrice("0.5");
    setNoYield(false);
    setFormError("");
  }

  return (
    <div className="qa-home qa-demo-app">
      <div className="demo-banner">
        <strong>前端演示模式</strong>
        <span>全部数据与操作均为模拟 · 刷新可重置</span>
      </div>
      <header className="demo-header">
        <a className="qa-brand" href="/">
          <span className="qa-brand-packet" aria-hidden="true">
            ¥
          </span>
          <span>
            插队红包<small>QUEUE ARENA</small>
          </span>
        </a>
        <div className="demo-header-links">
          <a href="/#rules">规则说明</a>
          <span className="demo-block">模拟块 #{state.block}</span>
        </div>
      </header>
      <main className="demo-main">
        <div className="demo-page-heading">
          <div>
            <p className="qa-kicker">YOUR TIME. YOUR CALL.</p>
            <h1>
              {!me ? "先领个号，给时间报个价。" : "你的时间，由你来定价。"}
            </h1>
            <p>免费排队，自主让位。补偿等双方消费后，再各自结算。</p>
          </div>
          <a className="demo-home-link" href="/">
            返回首页
          </a>
        </div>
        <div
          className={`demo-notice ${state.error ? "is-error" : ""}`}
          role="status"
          aria-live="polite"
        >
          {state.notice}
        </div>
        <div className="demo-layout">
          <aside className="demo-personal">
            {!me ? (
              <section className="demo-card">
                <div className="demo-card-heading">
                  <h2>免费加入队列</h2>
                  <span className="demo-badge">零入队费</span>
                </div>
                <p className="demo-muted">首次入队，领取 100 个模拟排队币。</p>
                <form onSubmit={submitSettings}>
                  <label className="demo-field">
                    你的昵称
                    <input
                      autoComplete="nickname"
                      maxLength={8}
                      placeholder="怎么称呼你？"
                      value={nick}
                      onChange={(e) => setNick(e.target.value)}
                    />
                  </label>
                  <PriceEditor
                    price={price}
                    noYield={noYield}
                    onPrice={setPrice}
                    onNoYield={setNoYield}
                  />
                  {formError && (
                    <p className="demo-error" role="alert">
                      {formError}
                    </p>
                  )}
                  <button
                    className="demo-button demo-primary"
                    disabled={state.closed}
                  >
                    免费入队 · 开始演示
                  </button>
                </form>
              </section>
            ) : (
              <>
                <section className="demo-card demo-ticket">
                  <div className="demo-card-heading">
                    <span className="qa-kicker">MY QUEUE TICKET</span>
                    <span
                      className={`demo-badge ${me.status === "served" ? "is-green" : ""}`}
                    >
                      {statusText[me.status]}
                    </span>
                  </div>
                  {isQueued ? (
                    <>
                      <div className="demo-rank">
                        第 <strong>{rank}</strong> 位
                      </div>
                      <p>
                        前面还有 {rank - 1} 人 · 队伍共 {state.line.length} 人
                      </p>
                    </>
                  ) : (
                    <>
                      <h2 className="demo-status-title">
                        {me.status === "called"
                          ? "轮到你了，请到柜台。"
                          : me.status === "served"
                            ? "消费已完成。"
                            : "本次排队已结束。"}
                      </h2>
                      <p>
                        {me.status === "served"
                          ? "每笔补偿继续等待对应双方的消费结果。"
                          : me.status === "gone"
                            ? "相关冻结款项已按规则退回插队者。"
                            : "可在下方演示控制中模拟核销或过号。"}
                      </p>
                    </>
                  )}
                  <div className="demo-ticket-bottom">
                    <span>{me.nick}</span>
                    <span>模拟号码 #100</span>
                  </div>
                </section>
                <section className="demo-card">
                  <div className="demo-card-heading">
                    <h2>我的排队币</h2>
                    <span className="demo-badge">模拟余额</span>
                  </div>
                  <div className="demo-balance">
                    <strong>{amount(me.balance)}</strong>
                    <span>可用排队币</span>
                  </div>
                  <div className="demo-money-grid">
                    <div>
                      <span>待结算补偿</span>
                      <strong>{amount(frozenIn)}</strong>
                    </div>
                    <div>
                      <span>已到账补偿</span>
                      <strong className="demo-green">{amount(paid)}</strong>
                    </div>
                    <div>
                      <span>付出冻结中</span>
                      <strong>{amount(frozenOut)}</strong>
                    </div>
                    <div>
                      <span>已退回给我</span>
                      <strong>{amount(refunded)}</strong>
                    </div>
                  </div>
                  <p className="demo-muted">
                    待结算补偿独立冻结，未计入可用余额。
                  </p>
                </section>
                {isQueued && (
                  <section className="demo-card">
                    <div className="demo-card-heading">
                      <h2>设置让位价格</h2>
                    </div>
                    <p className="demo-current">
                      当前生效{" "}
                      <strong>
                        {me.noYield ? "不让" : `${amount(me.price)} 排队币`}
                      </strong>
                    </p>
                    {me.noYield && (
                      <p className="demo-muted">
                        你挡住了身后 {state.line.length - rank} 人的插队路径。
                      </p>
                    )}
                    {me.pending && (
                      <p className="demo-warning">
                        待生效：
                        {me.pending.noYield
                          ? "不让"
                          : `${amount(me.pending.price)} 排队币`}
                        ，还需 {me.pending.block - state.block} 个模拟区块。
                      </p>
                    )}
                    <form onSubmit={submitSettings}>
                      <PriceEditor
                        price={price}
                        noYield={noYield}
                        onPrice={setPrice}
                        onNoYield={setNoYield}
                      />
                      {formError && (
                        <p role="alert" className="demo-error">
                          {formError}
                        </p>
                      )}
                      <button className="demo-button" disabled={!!me.pending}>
                        确认修改 · 2 个区块后生效
                      </button>
                    </form>
                  </section>
                )}
              </>
            )}
          </aside>
          <div className="demo-queue-column">
            <section className="demo-card demo-queue-card">
              <div className="demo-card-heading">
                <div>
                  <p className="qa-kicker">THE QUEUE</p>
                  <h2>大家都在这里排队</h2>
                </div>
                <span className="demo-badge">{state.line.length} 人等待</span>
              </div>
              <p className="demo-muted">
                每个人自己定价。遇到“不让”，就停在他身后。
              </p>
              <ol className="demo-queue-list">
                {state.line.map((id, index) => {
                  const entry = person(state, id);
                  return (
                    <li
                      className={`demo-queue-member ${id === ME ? "is-me" : ""}`}
                      key={id}
                    >
                      <span className="demo-position">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <Character kind={entry.kind} />
                      <div className="demo-member-copy">
                        <strong>
                          {entry.nick}{" "}
                          {id === ME && <span className="demo-you">我</span>}
                        </strong>
                        <span>
                          {entry.noYield
                            ? `不让位 · 挡住身后 ${state.line.length - index - 1} 人`
                            : "每被越过一位的报价"}
                        </span>
                      </div>
                      <div
                        className={`demo-member-price ${entry.noYield ? "is-wall" : ""}`}
                      >
                        {entry.noYield ? (
                          "不让"
                        ) : (
                          <>
                            <strong>{amount(entry.price)}</strong>
                            <small>排队币</small>
                          </>
                        )}
                        {entry.pending && <small>改价待生效</small>}
                      </div>
                    </li>
                  );
                })}
              </ol>
              {!state.line.length && (
                <div className="demo-empty">
                  <span aria-hidden="true">✓</span>
                  <h3>{state.closed ? "本场已收摊" : "队列已处理完毕"}</h3>
                  <p>可以重置演示，再体验一次。</p>
                </div>
              )}
              {isQueued && (
                <div className="demo-cut-entry">
                  <div>
                    <strong>
                      {rank > 1
                        ? "想快一点？先看看补偿明细。"
                        : "你已经在队首了。"}
                    </strong>
                    <p>按实际越过的每个人分别付费。</p>
                  </div>
                  <button
                    className="demo-button demo-primary"
                    disabled={rank <= 1}
                    onClick={() => setCutOpen(true)}
                  >
                    我要插队
                  </button>
                </div>
              )}
              {!state.joined && (
                <p className="demo-queue-tip">
                  完成左侧入队，即可选择目标位置、查看逐人报价。
                </p>
              )}
            </section>
            <section className="demo-card demo-controls">
              <div className="demo-card-heading">
                <div>
                  <p className="qa-kicker">DEMO CONTROLS</p>
                  <h2>试着推动一下现场</h2>
                </div>
                <button
                  className="demo-reset"
                  onClick={() => setConfirmation("reset")}
                >
                  重置演示
                </button>
              </div>
              <p className="demo-muted">
                这些按钮用来模拟其他顾客和店员的操作。
              </p>
              <div className="demo-control-grid">
                <button
                  className="demo-button"
                  disabled={!isQueued}
                  onClick={() => dispatch({ type: "incoming" })}
                >
                  模拟有人插我
                </button>
                <button
                  className="demo-button"
                  disabled={!isQueued}
                  onClick={() => dispatch({ type: "frontServed" })}
                >
                  前方顾客完成消费
                </button>
                <button
                  className="demo-button"
                  disabled={!state.line.length || !!called}
                  onClick={() => dispatch({ type: "call" })}
                >
                  叫下一位
                </button>
                <button
                  className="demo-button"
                  disabled={!called}
                  onClick={() => dispatch({ type: "serve" })}
                >
                  核销当前叫号
                </button>
                <button
                  className="demo-button"
                  disabled={!called}
                  onClick={() => dispatch({ type: "skip" })}
                >
                  当前叫号过号
                </button>
                <button
                  className="demo-button demo-danger"
                  disabled={state.closed}
                  onClick={() => setConfirmation("close")}
                >
                  模拟收摊
                </button>
              </div>
              <div className="demo-counter">
                当前柜台{" "}
                <strong>
                  {called ? `${called.nick} · 等待核销或过号` : "暂无叫号用户"}
                </strong>
              </div>
              <p className="demo-control-guide">
                体验补偿到账：先“模拟有人插我”，再让前方顾客消费，叫到自己后核销。体验退款：在记录中模拟对方退出。
              </p>
            </section>
          </div>
        </div>
        {me && (
          <section className="demo-card demo-records">
            <div className="demo-card-heading">
              <div>
                <p className="qa-kicker">COMPENSATION RECORDS</p>
                <h2>每一笔，都有去向</h2>
              </div>
              <span className="demo-badge">{records.length} 笔记录</span>
            </div>
            <p className="demo-muted">
              双方消费独立核对。任何一方未消费，对应款项退给插队者。
            </p>
            {!records.length ? (
              <p className="demo-record-empty">
                还没有补偿记录。试试“我要插队”或“模拟有人插我”。
              </p>
            ) : (
              <div className="demo-receipts">
                {[...records].reverse().map((receipt) => {
                  const received = receipt.victim === ME;
                  const other = person(
                    state,
                    received ? receipt.cutter : receipt.victim,
                  );
                  const cutter = person(state, receipt.cutter);
                  const victim = person(state, receipt.victim);
                  return (
                    <article className="demo-receipt" key={receipt.id}>
                      <div className="demo-receipt-heading">
                        <strong>
                          {received ? "收到的补偿" : "付出的补偿"} ·{" "}
                          {other.nick}
                        </strong>
                        <span
                          className={`demo-badge receipt-${receipt.status}`}
                        >
                          {receiptText[receipt.status]}
                        </span>
                      </div>
                      <div className="demo-receipt-amount">
                        {amount(receipt.amount)} <small>排队币</small>
                        <span>模拟记录 #{receipt.id}</span>
                      </div>
                      <p>
                        插队者 {cutter.nick}：{statusText[cutter.status]}
                        <br />
                        被越过者 {victim.nick}：{statusText[victim.status]}
                      </p>
                      {receipt.status === "pending" &&
                        ["queued", "called"].includes(other.status) && (
                          <button
                            className="demo-inline-action"
                            onClick={() =>
                              dispatch({ type: "otherLeaves", id: other.id })
                            }
                          >
                            模拟对方退出，查看这笔退款
                          </button>
                        )}
                      {receipt.status === "refunded" && (
                        <p className="demo-refund-note">
                          已退给 {cutter.id === ME ? "我" : cutter.nick}
                          ，不是被越过者的已到账收入。
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}
        <div className="demo-bottom">
          <p>
            模拟区块每秒推进一次，改价等待 2
            个区块。刷新页面会清空本轮模拟进度。
          </p>
          {active && (
            <button
              className="demo-inline-action"
              onClick={() => setConfirmation("leave")}
            >
              我先不排了
            </button>
          )}
        </div>
      </main>
      {cutOpen && (
        <CutDialog
          state={state}
          dispatch={dispatch}
          onClose={() => setCutOpen(false)}
        />
      )}
      <dialog
        ref={confirmDialog}
        className="demo-dialog demo-confirm"
        onCancel={(event) => {
          event.preventDefault();
          setConfirmation(null);
        }}
        aria-labelledby="demo-confirm-title"
      >
        <h2 id="demo-confirm-title">
          {confirmation === "reset"
            ? "重新开始这场演示？"
            : confirmation === "close"
              ? "确认模拟收摊？"
              : "确认退出这次排队？"}
        </h2>
        <p>
          {confirmation === "reset"
            ? "本轮模拟记录、报价和余额会恢复初始状态。"
            : "未消费用户的相关冻结款项将原路退回插队者。"}
        </p>
        <div className="demo-confirm-actions">
          <button className="demo-button" onClick={() => setConfirmation(null)}>
            再想一下
          </button>
          <button
            className="demo-button demo-primary"
            onClick={() => {
              if (confirmation === "reset") reset();
              else if (confirmation) dispatch({ type: confirmation });
              setConfirmation(null);
            }}
          >
            确认
          </button>
        </div>
      </dialog>
    </div>
  );
}
