/** Shared enhancement for the React page and offline HTML. All queue values here are illustrative. */
export function initHomepage(root, { preview }) {
  const scene = root.querySelector("[data-scene]");
  const status = root.querySelector("[data-demo-status]");
  const dialog = root.querySelector("[data-preview-dialog]");
  let lastFocus = null;

  function setDemo(mode) {
    scene.dataset.mode = mode;
    const messages = {
      idle: "示例：越过 3 人，各付 0.5，合计 1.5 排队币。",
      cut: "模拟插队完成：3 笔补偿各 0.5 排队币，合计 1.5 已冻结，等待双方消费。",
      settled: "模拟双方消费：3 笔补偿各 0.5 排队币，分别结算给被越过的人。",
      refunded: "模拟插队者未消费：3 笔冻结款项共 1.5 排队币，原路退回插队者。",
    };
    status.textContent = messages[mode];
    root.querySelector("[data-demo-cut]").hidden = mode !== "idle";
    root.querySelector("[data-demo-settle]").hidden = mode !== "cut";
    root.querySelector("[data-demo-refund]").hidden = mode !== "cut";
    root.querySelector("[data-demo-reset]").hidden = mode === "idle" || mode === "cut";
    root.querySelectorAll("[data-packet]").forEach((packet) => {
      packet.textContent = mode === "settled" ? "已到账 +0.5" : mode === "refunded" ? "已退回 0.5" : "待结算 +0.5";
    });
    const next = scene.querySelector("button:not([hidden])");
    next?.focus({ preventScroll: true });
  }

  function click(event) {
    const target = event.target.closest("a,button");
    if (!target) return;
    if (preview && target.hasAttribute("data-join")) {
      event.preventDefault();
      lastFocus = target;
      dialog.showModal();
    }
    if (target.hasAttribute("data-close-preview")) dialog.close();
    if (target.hasAttribute("data-demo-cut")) setDemo("cut");
    if (target.hasAttribute("data-demo-settle")) setDemo("settled");
    if (target.hasAttribute("data-demo-refund")) setDemo("refunded");
    if (target.hasAttribute("data-demo-reset")) setDemo("idle");
  }

  function close() { lastFocus?.focus(); }
  root.addEventListener("click", click);
  dialog.addEventListener("close", close);
  return () => {
    root.removeEventListener("click", click);
    dialog.removeEventListener("close", close);
  };
}
