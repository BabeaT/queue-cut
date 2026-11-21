import { useEffect, useId, type ReactNode } from "react";
import { initHomepage } from "./interactions.js";

function PixelLink({ children, secondary = false, className = "" }: { children: ReactNode; secondary?: boolean; className?: string }) {
  return <a className={`qa-button ${secondary ? "qa-button-secondary" : ""} ${className}`} href="/m" data-join>{children}</a>;
}

// The generated atlas has uneven spacing. Each viewport follows the actual
// artwork bounds; SVG preserves its proportions at every responsive size.
const characterBounds = [
  { x: 20, y: 145, width: 490, height: 480 },
  { x: 510, y: 140, width: 350, height: 490 },
  { x: 935, y: 130, width: 330, height: 500 },
  { x: 1345, y: 135, width: 345, height: 495 },
  { x: 1760, y: 115, width: 370, height: 520 },
] as const;

export function Character({ kind, className = "" }: { kind: number; className?: string }) {
  const { x, y, width, height } = characterBounds[kind];
  const clipId = useId();
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={`qa-character ${className}`}
      viewBox={`${x} ${y} ${width} ${height}`}
      width={width}
      height={height}
      preserveAspectRatio="xMidYMax meet"
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={x} y={y} width={width} height={height} />
        </clipPath>
      </defs>
      <image href="/arena/queue-characters.png" width="2172" height="724" clipPath={`url(#${clipId})`} />
    </svg>
  );
}

function QueueScene() {
  return (
    <section className="qa-scene" aria-label="排队与逐人补偿机制演示" data-scene data-mode="idle">
      <div className="qa-scene-meta"><span className="qa-demo-label">机制演示 · 模拟队列</span><span className="qa-scene-hint">让每一次向前，都有补偿去向。</span></div>
      <div className="qa-scene-world">
        <div className="qa-shop-sign"><span>QUEUE</span><strong>排队中</strong><span className="qa-checkers" /></div>
        <div className="qa-members">
          {[{ kind: 1, name: "小桃" }, { kind: 2, name: "阿明" }, { kind: 3, name: "小绿" }].map(({ kind, name }) => (
            <div className="qa-member" key={name}>
              <span className="qa-packet" data-packet>待结算 +0.5</span>
              <Character kind={kind} />
              <span className="qa-price-tag">{name} <b>0.5</b><small>排队币</small></span>
            </div>
          ))}
          <div className="qa-member qa-member-wall"><span className="qa-wall-label">我不让位</span><Character kind={4} /><span className="qa-price-tag">小紫 <b>不让</b></span></div>
        </div>
        <div className="qa-scene-runner"><span className="qa-speech">想快一点？逐人补偿！</span><Character kind={0} /><span className="qa-running-trail" /></div>
        <div className="qa-finish-flag" aria-hidden="true"><span /></div>
        <div className="qa-road" aria-hidden="true" />
      </div>
      <div className="qa-scene-controls">
        <p role="status" aria-live="polite" data-demo-status>示例：越过 3 人，各付 0.5，合计 1.5 排队币。</p>
        <div className="qa-demo-actions"><button className="qa-small-button" type="button" data-demo-cut>演示插队</button><button className="qa-small-button" type="button" data-demo-settle hidden>双方消费</button><button className="qa-small-button qa-small-secondary" type="button" data-demo-refund hidden>一方未消费</button><button className="qa-small-button qa-small-secondary" type="button" data-demo-reset hidden>重新演示</button></div>
      </div>
    </section>
  );
}

const rules = [
  ["入队需要付钱吗？", "免费入队，无需押金或占位费。首次入队获得 100 个演示用排队币，普通用户无需安装钱包插件或自行领取测试币。"],
  ["我的让位价代表什么？", "有人越过你时，需要按你当前生效的报价向你记一笔补偿。默认 0.5 排队币，可在 0.1–10 之间调整，也可以选择不让。改价和不让状态的调整在 2 个区块后生效。"],
  ["选择“不让”以后会怎样？", "其他人插队时会停在你身后，只补偿实际被越过的人。选择不让免费，位置也不能转让。"],
  ["插队会不会比确认时多扣钱？", "确认前会显示逐人补偿明细、预计总额和最多愿付金额。实际费用超过你设置的上限，整笔交易失败，不会超额扣款。"],
  ["什么时候收到补偿？", "每个人的补偿独立冻结。只有插队者和被越过者双方都完成消费，对应款项才归被越过者。任何一方退出、过号或打烊未消费，对应款项就原路退回插队者。"],
];

export default function HomePage() {
  useEffect(() => initHomepage(document, { preview: false }), []);
  return (
    <div className="qa-home" id="top">
      <a className="qa-skip" href="#main-content">跳到主要内容</a>
      <header className="qa-header">
        <a className="qa-brand" href="#top" aria-label="插队红包首页"><span className="qa-brand-packet" aria-hidden="true">¥</span><span>插队红包<small>QUEUE ARENA</small></span></a>
        <nav aria-label="主导航"><a href="#how-it-works">玩法说明</a><a href="#rules">队列规则</a><a href="#guide">操作指南</a><a href="#about">关于项目</a></nav>
        <PixelLink className="qa-header-join">免费入队</PixelLink>
      </header>
      <main id="main-content">
        <section className="qa-hero" aria-labelledby="hero-title">
          <div className="qa-cloud qa-cloud-one" aria-hidden="true" /><div className="qa-cloud qa-cloud-two" aria-hidden="true" /><div className="qa-cloud qa-cloud-three" aria-hidden="true" />
          <div className="qa-hero-content">
            <div className="qa-hero-copy">
              <p className="qa-eyebrow"><span className="qa-checkers" /> 让排队时间有价</p>
              <h1 id="hero-title">插队红包<span className="qa-title-spark" aria-hidden="true">!</span></h1>
              <p className="qa-english">QUEUE ARENA</p>
              <p className="qa-hero-tagline">想快一点，<br className="qa-mobile-break" />就给被越过的人一份补偿。</p>
              <div className="qa-hero-cta"><PixelLink><span className="qa-play" aria-hidden="true" /> PRESS START</PixelLink><a className="qa-text-link" href="#how-it-works">看看怎么玩 <span aria-hidden="true">↓</span></a></div>
              <p className="qa-free-note">免费入队 · 自主报价 · 公开插队 · 消费后结算</p>
            </div>
            <div className="qa-hero-art" aria-hidden="true"><span className="qa-art-sticker">我的时间，我来定价。</span><span className="qa-speed qa-speed-one" /><span className="qa-speed qa-speed-two" /><Character kind={0} className="qa-hero-character" /><span className="qa-coin">★</span><span className="qa-spark qa-spark-one">✦</span><span className="qa-spark qa-spark-two">✦</span><span className="qa-pixel-plus">+</span></div>
          </div>
          <QueueScene />
          <div className="qa-sky-edge" aria-hidden="true" />
        </section>
        <section className="qa-manifesto" id="how-it-works" aria-labelledby="manifesto-title">
          <div className="qa-section-wrap qa-manifesto-inner"><h2 id="manifesto-title">给排队时间<br /><em>定个价格。</em></h2><div className="qa-manifesto-copy"><p>有人想向前一步，<br />就向被越过的每一个人支付补偿。</p><p>愿意让位，价格自己定。想守住位置，就选择“不让”。<br />每笔补偿先冻结，双方完成消费后独立结算。</p></div><span className="qa-manifesto-spark" aria-hidden="true">✦</span></div>
        </section>
        <section className="qa-how qa-section-wrap" id="guide" aria-labelledby="guide-title">
          <div className="qa-section-heading"><div><p className="qa-kicker">HOW TO PLAY</p><h2 id="guide-title">三步，玩转插队红包。</h2></div><span className="qa-heading-note">把选择权，交给排队的人。</span></div>
          <div className="qa-step-grid">
            <article className="qa-step-card"><span className="qa-step-icon qa-ticket-icon" aria-hidden="true">FREE</span><h3>免费加入队列</h3><p>输入昵称，领取你的排队位置。<br />无需押金，首次获得 100 排队币。</p><span className="qa-step-note">从这里开始</span></article>
            <article className="qa-step-card"><span className="qa-step-icon qa-price-icon" aria-hidden="true">0.5</span><h3>给让位报个价</h3><p>决定每被越过一位的补偿价格，<br />也可以选择“我不让位”。</p><span className="qa-step-note">改价 2 个区块后生效</span></article>
            <article className="qa-step-card"><span className="qa-step-icon qa-settle-icon" aria-hidden="true">✓</span><h3>双方消费后结算</h3><p>插队者和你都完成消费，补偿到账。<br />任意一方未消费，对应款项原路退回。</p><span className="qa-step-note">每个人的补偿独立结算</span></article>
          </div>
        </section>
        <section className="qa-rules qa-section-wrap" id="rules" aria-labelledby="rules-title"><div className="qa-section-heading"><div><p className="qa-kicker">FAIR PLAY</p><h2 id="rules-title">规则摊开，排得明白。</h2></div><span className="qa-rule-seal">公开报价<br />逐人补偿</span></div><div className="qa-faq-list">{rules.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div></section>
        <section className="qa-bottom-cta" id="about"><div className="qa-section-wrap qa-bottom-inner"><span className="qa-pixel-monitor" aria-hidden="true"><span>^ ^<br /> ▿ </span></span><div><p className="qa-kicker">YOUR TIME. YOUR CALL.</p><h2>让等待被看见，<br />让时间拥有自己的价格。</h2><p>Queue Arena · Monad 广州站现场排队实验</p></div><PixelLink>免费加入队列</PixelLink></div><div className="qa-grass" aria-hidden="true" /></section>
      </main>
      <footer className="qa-footer"><a href="#top">插队红包 <span>QUEUE ARENA</span></a><p>补偿以排队币记账 · 双方完成消费后结算</p><a href="#rules">了解完整规则</a></footer>
      <dialog className="qa-preview-dialog" data-preview-dialog aria-labelledby="preview-title"><div className="qa-dialog-inner"><p className="qa-kicker">LOCAL PREVIEW</p><h2 id="preview-title">你正在查看独立首页预览</h2><p>此文件提供页面和机制演示。真实入队需要打开 React 应用并连接排队服务。</p><p className="qa-preview-address">开发版入口 <a href="http://localhost:5173/m">http://localhost:5173/m</a></p><button className="qa-button" type="button" data-close-preview>继续浏览首页</button></div></dialog>
    </div>
  );
}
