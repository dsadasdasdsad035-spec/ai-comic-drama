# Tasks

## 1. 折叠原语与样式

- [x] 1.1 新建受控折叠组件 `src/Fold.tsx`：接收 `open` / `onToggle` / `title` / `meta` / `children`，输出 `aria-expanded`、`aria-controls` 与 `fold-head` / `fold-title` / `fold-meta` / `fold-chevron` / `fold-body` 类；用 `npx tsc --noEmit` 通过，并在新增的 `verify-fold.mjs` 中断言开合时 `aria-expanded` 与 `hidden` 同步变化
- [x] 1.2 在 `src/theme.css` 增加 `fold` 家族样式，复用现有 `vp-disclosure-*` 的尺寸与配色；验证 `verify-fold.mjs` 中断言折叠态高度小于展开态、摘要行单行不换行
- [x] 1.3 用 `Fold` 替换 `vp-disclosure`、`vp-refs-disclosure`、`tr-advanced` 与 `si-section` 的折叠外观，保留 `vp-panel` / `vp-summary` / `vp-refs` / `vp-issue` / `vp-text` / `vp-meta` 与 `data-open` 输出；验证改由 `verify-fold.mjs` 的类名契约断言 + `node verify-shot-inspector.mjs` 覆盖（原口径里的 `verify-video-prompt-preview` / `verify-transitions-ui` 已陈旧，见下方 follow-up）

## 2. 折叠偏好与默认值

- [x] 2.1 在 `src/inspectorLayout.ts` 的 `CollapsibleSection` 增加 `videoSettings` 与 `motionPrompt`，默认 `true`，`normalizePrefs` 对缺失键回落默认；扩展 `verify-shot-inspector.mjs`，断言旧偏好 JSON 读入后新键为 `true` 且其余键不被重置
- [x] 2.2 在 `Inspector.tsx` 接入两个新键的读写，确认折叠后刷新页面仍保持；验证 `verify-shot-inspector.mjs` 中「折叠 → 重新挂载 → 仍折叠」用例通过

## 3. 分镜视频 Tab 分区

- [x] 3.1 把 `gen-box vid-box` 的出片设置改为摘要条折叠：摘要行固定展示「模型 · 分辨率 · 秒数 · 估价」，切换模型或分辨率后摘要即时更新；验证写在 `verify-shot-inspector.mjs`（三种模型切换后摘要文本正确）
- [x] 3.2 确定默认态：提示词展开、参考与槽位折叠、运动提示词折叠；验证页面上 `data-shot-tab="video"` 各区块的 `open` 状态与预期一致
- [x] 3.3 实现 issue 分层：`blocking` 常驻且折叠态仍可见，`warnings` 合并为「N 条提示」入口并可展开逐条；验证写在 `verify-shot-inspector.mjs`（blocking 折叠后仍可见且主按钮禁用；3 条 warning 默认只占一行、展开逐条）
- [x] 3.4 把「AI 扩写」改成单行入口 + `fixed` 定位浮层，浮层内含文本模型选择与三个动作，支持 Esc 与外部点击关闭、关闭后焦点回到入口；验证写在 `verify-shot-inspector.mjs`（打开后四个元素可见、Esc/外部点击关闭、焦点回到入口、开关不改变正文高度）
- [x] 3.5 加高度回归断言：360×800 下默认态 `[data-video-prompt-text]` 与底栏主按钮同时位于视口内，且开关 AI 扩写浮层前后 `.vp-panel` 高度不变（原 `scrollHeight / clientHeight < 1.1` 指标受成片预览固有高度影响，见 design D7）；验证用例写入 `verify-shot-inspector.mjs` 并在 CI 本地跑通

## 4. 转场面板对齐

- [x] 4.1 生成模式按同一折叠语言编排：提示词展开，出片设置与参考与边界折叠，`gen-box` 内分区顺序保持不变；验证写入 `verify-transition-folds.mjs`（默认态提示词正文与「生成视频」同屏）
- [x] 4.2 效果预设改为「常用 4 项（叠化 / 黑场淡出 / 白场淡入 / 推移）+ 全部预设折叠」，全部预设展开后按原分组可见且选中后保持展开；验证写入 `verify-transition-folds.mjs`（默认只渲染常用 4 项且不占高度、展开后按 4 组、总数 27 ≥ 12、选中后保持展开）
- [x] 4.3 断言两条路径同构：分镜视频 Tab 与转场生成区的提示词面板使用相同类名与折叠行为；验证在 `verify-transition-folds.mjs` 中断言所有折叠头子元素顺序为 chevron → title → meta，并在 `verify-fold.mjs` 中断言两条路径的出片设置折叠参数一致

## 5. 集成验证与文档

- [x] 5.1 运行 `npm run build`（`tsc --noEmit` + `vite build`）通过，无新增类型错误
- [x] 5.2 依次运行 `node verify-fold.mjs`、`node verify-shot-inspector.mjs`、`node verify-transition-folds.mjs`、`node verify-transitions-ui.mjs` 全部通过（`verify-video-prompt-preview` 的「参考图数量」与 `verify-transitions` 的 esbuild `.md` loader 属既有陈旧债，另立 change 修复，不计入本次验收）
- [x] 5.3 在 360×800 与 1280×900 两个视口各截一张默认态与提示词展开态截图，留存到 `.verify-panel-folds/` 并人工确认无裁切、无跳动
- [x] 5.4 在 `README.md` 的检查器/转场章节补充一段折叠行为说明（默认展开项、AI 扩写浮层、blocking 常驻），验证文档描述与实机一致

## Workflow follow-up

- 评审通过后运行 `openspec archive outgoing-panel-folds` 并确认主 spec 已合并 3 个 delta。
- 两个陈旧验收脚本单独立 change 修复（本 change 不含）：`verify-video-prompt-preview.mjs` 的「面板列出参考图数量」仍按 3 张旧夹具断言（实际 2 张）；`verify-transitions.mjs` 的 esbuild 缺 `--loader:.md=text`，被 `skills/asset/SKILL.md?raw` 卡住。`verify-transitions-ui.mjs` 已随夹具改为从 `public/` 现取而恢复全绿。
- `verify-transition-folds.mjs` 与 `verify-transitions-ui.mjs` 的浏览器级用例依赖「画布边缘右击菜单」（`src/EdgeContextMenu.tsx`，另一工作流未提交）。该文件落地前，两个脚本只能在完整工作区跑通，在仅含本次改动的树上会在打开转场面板处停下。
