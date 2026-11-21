继续开发插队红包 / Queue Arena 前端。请接手 GitHub 仓库 `BabeaT/queue-cut` 的分支 `frontend/queue-arena-style-handoff-1121`。

先完整阅读 `docs/frontend/HANDOFF.md`，再阅读根目录 `AGENTS.md`、`queue-cut-PRD-最终方案-1121.md`、`插队红包_UI视觉与交互设计规范_V2.0.md.md`，并查看 `queue-arena-homepage-visual-reference-v3.png.png`。文件名中的双重扩展名是当前真实名称。

我们的设计风格已基本确定，本轮目标是全面调整和统一前端样式，继续完善页面与交互。请复用现有 React + TypeScript + Vite 工程，并保留工作区所有已有改动。

目前已完成 React 首页 `/`、独立 HTML 首页 `preview/queue-arena-homepage.html`、前端排队演示 `/m?demo=1`。演示模式有入队、报价、不让、逐人插队补偿、最多愿付保护、双方消费后结算、退款、叫号、核销和重置，全部明确标注模拟。真实 `/m` 是另一套依赖后端的原有页面，样式尚未统一，缺少后端时会显示“连接中…”。请先通过 `/m?demo=1` 验证界面。

品牌沿用蓝天白云、奶油白、荧光粉、黑色粗描边、硬阴影和复古像素人物。中文正文保证可读，金额用“排队币”，明确区分可用、待结算、已到账和退款。

请保留已修复的人物等比显示与精确裁切。人物原图不是等宽精灵格，当前 `Character` 组件通过实际边界、SVG viewBox 和 clipPath 显示，不能再用五等分背景定位。

请先查看当前页面并提出具体样式调整方向，再按我后续反馈实施。改动后运行构建和类型检查，验证桌面与手机布局、入队和插队交互。首页改动后运行 `npm run build:preview`，同步离线 HTML。按 PRD 保留现有业务规则，合约、后端和部署变更需先明确范围。
