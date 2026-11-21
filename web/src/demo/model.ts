// Amounts are integer tenths of a demo queue coin, avoiding floating point sums.
export const ME = 100;
export type PersonStatus = "queued" | "called" | "served" | "gone";
export type Person = {
  id: number;
  nick: string;
  kind: number;
  price: number;
  noYield: boolean;
  balance: number;
  status: PersonStatus;
  pending?: { price: number; noYield: boolean; block: number };
};
export type Receipt = {
  id: number;
  cutter: number;
  victim: number;
  amount: number;
  status: "pending" | "paid" | "refunded";
};
export type DemoState = {
  block: number;
  people: Person[];
  line: number[];
  receipts: Receipt[];
  joined: boolean;
  closed: boolean;
  notice: string;
  error: boolean;
};
export type DemoAction =
  | { type: "join"; nick: string; price: number; noYield: boolean }
  | { type: "price"; price: number; noYield: boolean }
  | { type: "cut"; target: number; maxPay: number }
  | {
      type:
        | "tick"
        | "incoming"
        | "call"
        | "serve"
        | "skip"
        | "leave"
        | "close"
        | "frontServed"
        | "reset";
    }
  | { type: "otherLeaves"; id: number };

export function initialDemo(): DemoState {
  return {
    block: 1200,
    people: [
      {
        id: 1,
        nick: "小桃",
        kind: 1,
        price: 5,
        noYield: false,
        balance: 1000,
        status: "queued",
      },
      {
        id: 2,
        nick: "阿明",
        kind: 2,
        price: 8,
        noYield: true,
        balance: 1000,
        status: "queued",
      },
      {
        id: 3,
        nick: "小绿",
        kind: 3,
        price: 3,
        noYield: false,
        balance: 1000,
        status: "queued",
      },
      {
        id: 4,
        nick: "小紫",
        kind: 4,
        price: 10,
        noYield: false,
        balance: 1000,
        status: "queued",
      },
      {
        id: 5,
        nick: "小蓝",
        kind: 0,
        price: 5,
        noYield: false,
        balance: 1000,
        status: "queued",
      },
    ],
    line: [1, 2, 3, 4, 5],
    receipts: [],
    joined: false,
    closed: false,
    notice: "先输入昵称免费入队，再试试报价、插队和补偿结算。",
    error: false,
  };
}

export const person = (state: DemoState, id: number) =>
  state.people.find((p) => p.id === id)!;
export const amount = (value: number) => (value / 10).toFixed(2);
export function parseAmount(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length === 2 && fraction[1] !== "0") return null;
  const units =
    Number(whole) * 10 + Number(fraction.padEnd(1, "0").slice(0, 1));
  return Number.isSafeInteger(units) ? units : null;
}

export function quoteDemo(state: DemoState, targetRank: number, actor = ME) {
  const from = state.line.indexOf(actor);
  const target = Math.max(0, Math.min(from, targetRank - 1));
  let reach = from;
  let wall: Person | undefined;
  for (let i = from - 1; i >= target; i--) {
    const entry = person(state, state.line[i]);
    if (entry.noYield) {
      wall = entry;
      break;
    }
    reach = i;
  }
  const victims =
    from < 0
      ? []
      : state.line.slice(reach, from).map((id) => person(state, id));
  return {
    reach: reach + 1,
    victims,
    total: victims.reduce((sum, p) => sum + p.price, 0),
    wall,
  };
}

function settle(state: DemoState) {
  for (const receipt of state.receipts) {
    if (receipt.status !== "pending") continue;
    const cutter = person(state, receipt.cutter);
    const victim = person(state, receipt.victim);
    if (cutter.status === "gone" || victim.status === "gone") {
      receipt.status = "refunded";
      cutter.balance += receipt.amount;
    } else if (cutter.status === "served" && victim.status === "served") {
      receipt.status = "paid";
      victim.balance += receipt.amount;
    }
  }
}

function finish(state: DemoState, id: number, status: "served" | "gone") {
  const entry = person(state, id);
  entry.status = status;
  delete entry.pending;
  state.line = state.line.filter((uid) => uid !== id);
  settle(state);
}

function cut(state: DemoState, actor: number, target: number, maxPay: number) {
  const quote = quoteDemo(state, target, actor);
  const cutter = person(state, actor);
  if (!quote.victims.length) return "前方有人不让位，当前没有可以越过的用户。";
  if (quote.total > maxPay)
    return `实际报价 ${amount(quote.total)} 超过最多愿付 ${amount(maxPay)}，模拟交易失败，余额未扣除。`;
  if (cutter.balance < quote.total) return "可用排队币不足，请调整目标位置。";
  cutter.balance -= quote.total;
  for (const victim of quote.victims) {
    state.receipts.push({
      id: state.receipts.length + 1,
      cutter: actor,
      victim: victim.id,
      amount: victim.price,
      status: "pending",
    });
  }
  state.line = state.line.filter((uid) => uid !== actor);
  state.line.splice(quote.reach - 1, 0, actor);
  return null;
}

export function demoReducer(current: DemoState, action: DemoAction): DemoState {
  if (action.type === "reset") return initialDemo();
  const state: DemoState = structuredClone(current);
  const me = state.people.find((p) => p.id === ME);
  const notify = (message: string, error = false) => ({
    ...state,
    notice: message,
    error,
  });
  if (action.type === "tick") {
    state.block++;
    for (const entry of state.people) {
      if (entry.pending && entry.pending.block <= state.block) {
        entry.price = entry.pending.price;
        entry.noYield = entry.pending.noYield;
        delete entry.pending;
      }
    }
    return state;
  }
  switch (action.type) {
    case "join":
      if (state.joined || state.closed) return current;
      state.people.push({
        id: ME,
        nick: action.nick.trim(),
        kind: 0,
        price: action.price,
        noYield: action.noYield,
        balance: 1000,
        status: "queued",
      });
      state.line.push(ME);
      state.joined = true;
      return notify("模拟入队成功，已发放 100.00 排队币。可以开始体验！");
    case "price":
      if (me?.status !== "queued") return current;
      me.pending = {
        price: action.price,
        noYield: action.noYield,
        block: state.block + 2,
      };
      return notify(`设置已提交，将在模拟区块 #${state.block + 2} 生效。`);
    case "cut": {
      if (me?.status !== "queued") return current;
      const error = cut(state, ME, action.target, action.maxPay);
      return notify(
        error ?? "模拟插队成功，逐人补偿已冻结，等待双方完成消费。",
        !!error,
      );
    }
    case "incoming": {
      if (me?.status !== "queued") return current;
      if (me.noYield)
        return notify(
          "你当前选择不让，模拟插队者停在你身后，没有产生补偿或扣款。",
        );
      const id = Math.max(...state.people.map((p) => p.id)) + 1;
      state.people.push({
        id,
        nick: `赶时间的顾客 ${id - ME}`,
        kind: 0,
        price: 5,
        noYield: false,
        balance: 1000,
        status: "queued",
      });
      state.line.push(id);
      cut(state, id, state.line.indexOf(ME) + 1, 1000);
      return notify(
        `有人模拟插队越过你，新增 ${amount(me.price)} 排队币待结算补偿。`,
      );
    }
    case "call": {
      if (state.people.some((p) => p.status === "called"))
        return notify("请先核销或过号当前叫号用户。", true);
      const id = state.line.shift();
      if (id === undefined) return notify("队列已经为空。");
      person(state, id).status = "called";
      return notify(`模拟叫号：${person(state, id).nick}，请到柜台。`);
    }
    case "serve":
    case "skip": {
      const called = state.people.find((p) => p.status === "called");
      if (!called) return notify("请先叫号。", true);
      finish(state, called.id, action.type === "serve" ? "served" : "gone");
      return notify(
        action.type === "serve"
          ? `${called.nick} 已模拟完成消费，相关补偿按双方状态结算。`
          : `${called.nick} 已模拟过号，相关冻结费用已退回插队者。`,
      );
    }
    case "leave":
      if (!me || !["queued", "called"].includes(me.status)) return current;
      finish(state, ME, "gone");
      return notify("你已模拟退出，相关待结算款项已原路退回插队者。");
    case "otherLeaves": {
      const other = state.people.find((p) => p.id === action.id);
      if (!other || !["queued", "called"].includes(other.status))
        return current;
      finish(state, other.id, "gone");
      return notify(
        `${other.nick} 已模拟退出，与其相关的冻结费用已退回插队者。`,
      );
    }
    case "frontServed": {
      if (me?.status !== "queued") return current;
      const called = state.people.find((p) => p.status === "called");
      if (called) finish(state, called.id, "served");
      while (state.line.length && state.line[0] !== ME)
        finish(state, state.line[0], "served");
      return notify("你前面的顾客已模拟完成消费，现在可以叫到你了。");
    }
    case "close":
      state.closed = true;
      for (const entry of state.people) {
        if (["queued", "called"].includes(entry.status))
          finish(state, entry.id, "gone");
      }
      return notify("已模拟收摊，未消费用户出队，剩余冻结费用已原路退回。");
  }
}
