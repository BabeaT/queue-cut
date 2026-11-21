import { useCallback, useEffect, useId, useRef, useState } from "react";
import QRCode from "qrcode";

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
    <svg aria-hidden="true" focusable="false" className={`lp-char ${className}`} viewBox={`${x} ${y} ${width} ${height}`} width={width} height={height} preserveAspectRatio="xMidYMax meet">
      <defs><clipPath id={clipId}><rect x={x} y={y} width={width} height={height} /></clipPath></defs>
      <image href="/arena/queue-characters.png" width="2172" height="724" clipPath={`url(#${clipId})`} />
    </svg>
  );
}

const QR_BASE = ((import.meta.env.VITE_QR_BASE as string | undefined) || location.origin).replace(/\/$/, "");
const VIDEO_SRC = new URLSearchParams(location.search).get("video") || "/intro.mp4";
const CONTRACT = "0x0Eede199697d4b5a4E6b95c82858989a5525D35c";
const QR_LABEL = QR_BASE.replace(/^https?:\/\//, "") + "/m";

function Qr({ size = 220 }: { size?: number }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    QRCode.toDataURL(QR_BASE + "/m", { width: size * 2, margin: 1, color: { dark: "#15121f", light: "#ffffff" } }).then(setSrc).catch(() => {});
  }, [size]);
  return src ? <img className="lp-qr-img" src={src} width={size} height={size} alt={`扫码排队：${QR_LABEL}`} /> : <span className="lp-qr-img lp-qr-ph" style={{ width: size, height: size }} />;
}

const SLIDES = ["开场", "问题", "链上", "答案", "怎么玩", "Why Monad", "演示"];

function VideoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [ended, setEnded] = useState(false);
  const [failed, setFailed] = useState(false);
  const replay = () => {
    setEnded(false);
    const v = ref.current;
    if (v) { v.currentTime = 0; v.play().catch(() => {}); }
  };
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (open) { setEnded(false); v.currentTime = 0; v.play().catch(() => {}); }
    else v.pause();
  }, [open]);
  return (
    <div className={`lp-video ${open ? "is-open" : ""}`} role="dialog" aria-modal="true" aria-label="介绍视频" aria-hidden={!open} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="lp-video-frame">
        <video ref={ref} src={VIDEO_SRC} controls playsInline preload="auto" onEnded={() => setEnded(true)} onError={() => setFailed(true)} onLoadedData={() => setFailed(false)} />
        {failed && <div className="lp-video-msg"><b>视频没有加载出来</b><span>把视频放到 web/public/intro.mp4，或在地址后面加 ?video=视频地址</span></div>}
        {(ended || failed) && (
          <div className="lp-video-end">
            <a className="lp-btn lp-btn-primary" href="/screen">开始现场演示 <span aria-hidden="true">→</span></a>
            {!failed && <button className="lp-btn lp-btn-glass" type="button" onClick={replay}>重播</button>}
          </div>
        )}
      </div>
      <button className="lp-video-close" type="button" onClick={onClose} aria-label="关闭视频">×</button>
    </div>
  );
}

const faq = [
  ["入队要花钱吗？", "免费入队，没有押金和占位费。首次入队送 100 个演示用排队币，不用装钱包，也不用自己领测试币。"],
  ["让位价是什么？", "有人插到你前面，就按你挂的价付给你。默认 0.5，可以在 0.1–10 之间改；也可以选「不让」，一分钱不花。改价 2 个区块后生效。"],
  ["选了「不让」会怎样？", "插队的人停在你身后，只付给他实际越过的人。"],
  ["会不会比确认时多扣钱？", "确认前显示逐人明细和总价，你可以设最多愿付多少；实际超过上限，整笔交易失败，不会多扣。"],
  ["什么时候到账？", "每一笔单独冻结。插队的人和被插的人都消费了，钱才归被插的人；任何一方退出、过号或打烊没消费，这一笔原路退回。"],
];

const vi = (i: number) => ({ ["--i" as string]: i });

export default function HomePage() {
  const [active, setActive] = useState(0);
  const [video, setVideo] = useState(false);
  const sections = useRef<(HTMLElement | null)[]>([]);

  const go = useCallback((i: number) => {
    const n = Math.max(0, Math.min(SLIDES.length - 1, i));
    sections.current[n]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("is-in");
        const i = sections.current.indexOf(e.target as HTMLElement);
        if (i >= 0) setActive(i);
      }
    }, { threshold: 0.5 });
    sections.current.forEach((s) => s && io.observe(s));
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (video) { if (e.key === "Escape") setVideo(false); return; }
      if ((e.target as HTMLElement).closest("input, textarea, summary")) return;
      if (["ArrowDown", "ArrowRight", "PageDown", " "].includes(e.key)) { e.preventDefault(); go(active + 1); }
      else if (["ArrowUp", "ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); go(active - 1); }
      else if (e.key === "Home") { e.preventDefault(); go(0); }
      else if (e.key === "v" || e.key === "V") setVideo(true);
      else if (e.key === "d" || e.key === "D") location.href = "/screen";
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [active, video, go]);

  const reg = (i: number) => (el: HTMLElement | null) => { sections.current[i] = el; };
  const jump = (i: number) => (e: React.MouseEvent) => { e.preventDefault(); go(i); };

  return (
    <div className="lp">
      <div className="lp-bg" aria-hidden="true"><span className="lp-orb lp-orb-a" /><span className="lp-orb lp-orb-b" /><span className="lp-orb lp-orb-c" /></div>

      <header className="lp-top">
        <a className="lp-brand" href="#start" onClick={jump(0)}><span className="lp-brand-mark" aria-hidden="true">¥</span>插队红包<small>Queue Arena</small></a>
        <nav aria-label="页面导航">
          <a className="lp-top-link" href="#rules" onClick={jump(4)}>怎么玩</a>
          <a className="lp-top-link" href="#monad" onClick={jump(5)}>Why Monad</a>
          <a className="lp-top-link" href="#faq">规则</a>
          <a className="lp-top-join" href="/m">免费入队</a>
        </nav>
      </header>

      <nav className="lp-dots" aria-label="翻页">
        {SLIDES.map((s, i) => <button key={s} type="button" className={i === active ? "is-on" : ""} onClick={() => go(i)} aria-label={s} aria-current={i === active}><span>{s}</span></button>)}
      </nav>

      <main>
        {/* 0 开场 */}
        <section className="lp-slide lp-hero" id="start" ref={reg(0)} aria-labelledby="hero-title">
          <div className="lp-wrap lp-hero-grid">
            <div className="lp-hero-copy">
              <p className="lp-eyebrow"><span className="lp-live" aria-hidden="true" />Monad 测试网 · 真实运行中</p>
              <h1 id="hero-title">插队红包</h1>
              <p className="lp-hero-line">在以太坊上插队，钱给了矿工；<br /><em>在这里插队，钱给被你插队的每一个人。</em></p>
              <div className="lp-actions">
                <button className="lp-btn lp-btn-primary" type="button" onClick={() => setVideo(true)}><span className="lp-play" aria-hidden="true" />播放介绍视频</button>
                <a className="lp-btn lp-btn-ghost" href="/screen">开始现场演示 <span aria-hidden="true">→</span></a>
              </div>
              <p className="lp-tags"><span>免费入队</span><span>自己挂价</span><span>插队公开付费</span><span>双方消费才到账</span></p>
            </div>
            <aside className="lp-qr-card" aria-label="扫码排队">
              <Qr size={200} />
              <div className="lp-qr-text"><b>扫码排队</b><span>有人插你，就有钱收</span><code>{QR_LABEL}</code></div>
            </aside>
          </div>
          <div className="lp-queue" aria-hidden="true">
            <div className="lp-queue-runner"><Character kind={0} /></div>
            {[1, 2, 3, 4].map((k, i) => <div className="lp-queue-p" key={k} style={vi(i)}><span className="lp-red">+0.5</span><Character kind={k} /></div>)}
          </div>
          <p className="lp-hint" aria-hidden="true">↓ 翻页　·　V 播放视频　·　D 开始演示</p>
        </section>

        {/* 1 问题 */}
        <section className="lp-slide" id="problem" ref={reg(1)} aria-labelledby="problem-title">
          <div className="lp-wrap lp-split">
            <div className="lp-copy">
              <p className="lp-kicker">01 · 问题</p>
              <h2 id="problem-title">排队一小时，<br />有人插到你前面。</h2>
              <p className="lp-lead">他花了钱，钱给了黄牛、代排、VIP 通道。<br />被插队的你，一分钱没有。</p>
            </div>
            <div className="lp-card lp-flow">
              <div className="lp-flow-from"><Character kind={0} /><span>插队的人</span></div>
              <ul className="lp-flow-to">
                <li style={vi(0)}><i className="lp-coin" />黄牛<b>+¥200</b></li>
                <li style={vi(1)}><i className="lp-coin" />代排<b>+¥80</b></li>
                <li style={vi(2)}><i className="lp-coin" />VIP 通道<b>+¥50</b></li>
              </ul>
              <div className="lp-flow-you"><Character kind={2} /><div><span>被插队的你</span><strong>¥0</strong></div></div>
            </div>
          </div>
        </section>

        {/* 2 链上 */}
        <section className="lp-slide" id="mev" ref={reg(2)} aria-labelledby="mev-title">
          <div className="lp-wrap lp-split">
            <div className="lp-copy">
              <p className="lp-kicker">02 · 链上也一样</p>
              <h2 id="mev-title">插队叫 MEV，<br />插队费给了矿工。</h2>
              <p className="lp-lead">谁出的优先费高，谁的交易就排到前面。<br />被挤到后面的普通用户，同样什么都拿不到。</p>
            </div>
            <div className="lp-card lp-chain">
              <div className="lp-block">
                <span className="lp-block-no">区块 #81,546,634</span>
                <div className="lp-tx lp-tx-cut">插队交易 · 高优先费</div>
                <div className="lp-tx" style={vi(1)}>用户 A 的交易</div>
                <div className="lp-tx" style={vi(2)}>用户 B 的交易</div>
                <div className="lp-tx" style={vi(3)}>用户 C 的交易</div>
              </div>
              <div className="lp-miner"><i className="lp-coin" />优先费<b>→ 矿工 / 验证者</b></div>
              <p className="lp-chain-zero">被挤到后面的 A、B、C　<b>0</b></p>
            </div>
          </div>
        </section>

        {/* 3 答案 */}
        <section className="lp-slide lp-answer" id="answer" ref={reg(3)} aria-labelledby="answer-title">
          <div className="lp-wrap">
            <p className="lp-kicker">03 · 我们的答案</p>
            <h2 id="answer-title">插队不会消失，总有人着急。<br /><em>我们改的是钱的去向。</em></h2>
            <div className="lp-answer-queue" aria-hidden="true">
              <div className="lp-answer-p lp-answer-wall" style={vi(3)}><span className="lp-wall">不让</span><Character kind={4} /><span className="lp-name">小紫 · 不让</span></div>
              {[{ k: 1, n: "小桃", p: "0.5" }, { k: 2, n: "阿明", p: "0.2" }, { k: 3, n: "小绿", p: "1.0" }].map((m, i) => (
                <div className="lp-answer-p" key={m.n} style={vi(2 - i)}>
                  <span className="lp-red">+{m.p}</span>
                  <Character kind={m.k} />
                  <span className="lp-name">{m.n} · 挂价 {m.p}</span>
                </div>
              ))}
              <div className="lp-answer-runner"><Character kind={0} /><span className="lp-name">插队的人</span></div>
            </div>
            <p className="lp-answer-line">越过谁，就付给谁，按他自己挂的价。遇到「不让」，就停在他身后。</p>
          </div>
        </section>

        {/* 4 怎么玩 */}
        <section className="lp-slide" id="rules" ref={reg(4)} aria-labelledby="rules-title">
          <div className="lp-wrap">
            <p className="lp-kicker">04 · 怎么玩</p>
            <h2 id="rules-title">三条规则，就这么多。</h2>
            <div className="lp-rules">
              <article className="lp-card lp-rule" style={vi(0)}>
                <span className="lp-rule-no">1</span>
                <h3>每个人挂一个让位价</h3>
                <p>价是你自己挂的，有人出这个价你就让。不想让？选「不让」，一分钱不花。</p>
                <span className="lp-rule-chip">挂价即同意</span>
              </article>
              <article className="lp-card lp-rule" style={vi(1)}>
                <span className="lp-rule-no">2</span>
                <h3>越过谁，就付给谁</h3>
                <p>插队按人付钱，一笔交易给越过的每一个人分账。遇到「不让」就停在他身后。</p>
                <span className="lp-rule-chip">钱不给平台，不给黄牛</span>
              </article>
              <article className="lp-card lp-rule" style={vi(2)}>
                <span className="lp-rule-no">3</span>
                <h3>双方都消费才到账</h3>
                <p>每一笔先冻结。叫号不来就过号，钱原路退回。黄牛开小号占位，一分钱拿不到。</p>
                <span className="lp-rule-chip">黄牛要么白忙，要么变成真顾客</span>
              </article>
            </div>
          </div>
        </section>

        {/* 5 Why Monad */}
        <section className="lp-slide" id="monad" ref={reg(5)} aria-labelledby="monad-title">
          <div className="lp-wrap">
            <p className="lp-kicker">05 · Why Monad</p>
            <h2 id="monad-title">链上的队伍，要和店门口同步。</h2>
            <div className="lp-stats">
              <div className="lp-card lp-stat" style={vi(0)}><b>0.3<small>s</small></b><span>出块</span><p>12 秒一个块的链，队伍永远是旧的</p></div>
              <div className="lp-card lp-stat" style={vi(1)}><b>0.6<small>s</small></b><span>终局</span><p>插队那一刻，被越过的人手机同时响</p></div>
              <div className="lp-card lp-stat" style={vi(2)}><b>1<small>笔</small></b><span>交易给 N 人分账</span><p>越过 30 人，就是一笔交易里 30 笔记账</p></div>
              <div className="lp-card lp-stat" style={vi(3)}><b>1<small>次</small></b><span>请求拿到回执</span><p>eth_sendRawTransactionSync，不用轮询</p></div>
            </div>
            <p className="lp-monad-line">Monad 在协议层不让人偷偷插队；<br /><em>我们在应用层让插队公开、付费，钱给被插的人。</em></p>
            <p className="lp-contract">合约已部署在 Monad 测试网并完成验证　<a href={`https://testnet.monadscan.com/address/${CONTRACT}`} target="_blank" rel="noreferrer"><code>{CONTRACT.slice(0, 10)}…{CONTRACT.slice(-6)}</code></a></p>
          </div>
        </section>

        {/* 6 演示 */}
        <section className="lp-slide lp-demo" id="demo" ref={reg(6)} aria-labelledby="demo-title">
          <div className="lp-wrap lp-hero-grid">
            <div className="lp-copy">
              <p className="lp-kicker">06 · 现在，轮到你们</p>
              <h2 id="demo-title">先看一段视频，<br />再现场插一次队。</h2>
              <div className="lp-actions">
                <button className="lp-btn lp-btn-primary lp-btn-lg" type="button" onClick={() => setVideo(true)}><span className="lp-play" aria-hidden="true" />播放介绍视频</button>
                <a className="lp-btn lp-btn-ghost lp-btn-lg" href="/screen">开始现场演示 <span aria-hidden="true">→</span></a>
              </div>
            </div>
            <aside className="lp-qr-card lp-qr-card-lg" aria-label="扫码排队">
              <Qr size={240} />
              <div className="lp-qr-text"><b>扫码排队</b><span>有人插你，就有钱收</span><code>{QR_LABEL}</code></div>
            </aside>
          </div>
        </section>

        <section className="lp-faq lp-wrap" id="faq" aria-labelledby="faq-title">
          <h2 id="faq-title">完整规则</h2>
          <div className="lp-faq-list">{faq.map(([q, a]) => <details key={q}><summary>{q}<span aria-hidden="true">+</span></summary><p>{a}</p></details>)}</div>
        </section>
      </main>

      <footer className="lp-foot lp-wrap"><span>插队红包 · Queue Arena</span><span>Monad Blitz 广州站 2026</span><a href="https://github.com/BabeaT/queue-cut" target="_blank" rel="noreferrer">GitHub 开源</a></footer>

      <VideoModal open={video} onClose={() => setVideo(false)} />
    </div>
  );
}
