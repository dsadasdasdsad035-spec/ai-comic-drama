# Tasks

## 1. 依赖与类型基线

- [x] 1.1 安装 `react-markdown`、`remark-gfm`、`remark-breaks` 到 `dependencies`；验证：`npm ls react-markdown remark-gfm remark-breaks` 三个包均解析到具体版本，且 `npx tsc --noEmit` 无新增类型错误（设计 D1/D2）
- [x] 1.2 确认打包与运行时兼容性；验证：`npm run build` 通过，构建产物能正常加载（`vite build` 无 `Cannot resolve` 类报错）。基线体积：`index.js 2,195.00 kB / gzip 675.94 kB`

## 2. 渲染核心

- [x] 2.1 重写 `src/chat-ui/ChatText.tsx`：正文交给 `react-markdown`，插件为 `remark-gfm` + `remark-breaks`；验证：助手文本 `## 步骤`、`**重点**`、`- 项`、`` `code` `` 渲染后分别出现标题、`<strong>`、`<ul><li>`、行内 `code` 节点，且页面上看不到 `##`、`**` 源符号
- [x] 2.2 在 `components.pre` 中从子节点提取语言与代码文本，整体渲染既有 `ChatCodeBlock`；验证：围栏代码渲染结果为 `[data-chat-code]` 且 `data-open="false"`，语言与行数文案正确，`ChatCodeBlock.tsx` 文件零改动
- [x] 2.3 补齐 `components.code`（行内代码样式类）、`components.a`（`target="_blank"` + `rel="noreferrer"`）；验证：链接节点带两个属性，`javascript:` 链接被 `urlTransform` 过滤为空 href
- [x] 2.4 用 `components.table` 包裹横向滚动容器；验证：5 列以上表格外层存在 `overflow-x` 容器，表格自身 `min-width: max-content`
- [x] 2.5 删除 `splitFencedCode` 及其相关 import；验证：`rg "splitFencedCode" src` 无命中，`npx tsc --noEmit` 通过（设计 D7）
- [x] 2.6 新增 `tests/chat-markdown.ts`，用 `react-dom/server` 的 `renderToStaticMarkup` 断言渲染结果：标题/粗体/列表/行内代码/表格容器/`data-chat-code`/单换行为 `<br>`/`<script>` 与 `<img onerror>` 被转义为纯文本；验证：`node verify-chat-markdown.mjs` 该文件全绿（设计 D2/D3/D5）
- [x] 2.7 新建 `verify-chat-markdown.mjs`，按仓库既有 esbuild 打包 + 运行模式接入 2.6 的测试文件；验证：脚本以退出码 0 结束并逐项打印 ✅
- [x] 2.8 在 `docs/creative-studio.md` 补一段消息渲染契约说明（Markdown 支持范围、代码块折叠、表格横向滚动、轮次前缀优先于 Markdown）；验证：文档中描述的行为与 2.1~2.4 的实际渲染一致

## 3. 排版样式

- [x] 3.1 新建 `src/chat-ui/chat-markdown.css`，在 `.chat-ui .chat-md` 作用域内定义 `h1~h4` 层级字号、段落间距、`strong`/`em`、`ul`/`ol`、`blockquote`、`a`（accent 色 + 下划线）、行内 `code`、`hr`、表格边框与表头加粗；验证：文件存在且选择器均带 `.chat-md` 前缀，无 `!important`
- [x] 3.2 在 `src/chat-ui/chat.css` 顶部用 `@import` 引入新样式，`ChatText` 外层挂 `.chat-md`；验证：`App.tsx` 与 `SceneAgentChat.tsx` 两处引入点无需改动，页面样式生效（设计 D4）。构建后 CSS 288.16 → 290.56 kB，样式已内联
- [x] 3.3 覆盖 `chat.css` 中 `h1~h4 / p` 与 `a` 的 reset；验证：浏览器中 `h2` 计算字号大于正文、`strong` 计算字重 ≥ 600、链接有下划线，且卡片标题等非 `.chat-md` 元素样式不变。实测 h2 14.95px / 正文 13px、strong 600、链接 underline、对照 h2 仍 13px；截图见 `evidence/md-style-harness.png`

## 4. 三会话回归

- [x] 4.1 回归创意会话的前缀分支（`第 N 轮`、`已取消`、`失败：`、`模型说明：`）仍走 `AssistantText` 的专用渲染；验证：`verify-creative-*.mjs` 相关脚本通过，且这些前缀文案不被当作 Markdown 语法渲染。`verify-creative-ui.mjs` 在本机既存失败（见下），改用新增 `verify-chat-markdown-sessions.mjs`：ChatStep 内无 `**` 与 `strong`、说明正文渲染出 strong、错误/取消/失败分支文案保留，截图 `evidence/creative-prefix-and-markdown.png`
- [x] 4.2 回归 `SkillChat` 的 `【图片处置】` 分支；验证：`node verify-chat-attachments.mjs` 通过。核查发现该分支所在组件已无任何挂载点（`SkillChat` 只被同样未挂载的 `PromptRefineModal` 引用），经确认随本 change 一并删除，`【图片处置】` 分支不再存在，无需回归；`verify-creative-thread-fidelity.mjs` 中对 `SkillChat.tsx` 源码的断言同步移除
- [x] 4.3 回归 3D 调度会话的结构化 parts 与工具卡片；验证：旧脚本 `verify-agent-chat-ui.mjs` 依赖已下线的「镜头表 / 3D 调度 / .s3d-card」，改由新增 `verify-chat-markdown-scene3d.mjs` 覆盖新壳路径（素材 → 镜头语言 → 自定义白模 → 编辑 / 渲染），API 预置白模与线程。实测：工具卡仍是 `[data-chat-tool]` 卡片且文案未被 Markdown 化，正文 h2 / 折叠代码块 / 表格滚动容器齐全，截图 `evidence/scene3d-markdown-and-tools.png`
- [x] 4.4 确认用户消息也只走同一渲染器、无额外开关；验证：用户消息中粘贴多行 `- 项` 渲染为列表，`ChatText` 对外签名仍为 `{ text: string }`。实测用户气泡内 `ul li` 为 2 条且被 `.chat-md` 包裹

## 5. 集成验证

- [x] 5.1 端到端一致性：同一段含标题、列表、代码块、表格的助手文本分别出现在创意会话与 3D 调度会话（`SkillChat` 已删除，实际只剩这两处挂载点）；验证：`verify-chat-markdown-sessions.mjs` 与 `verify-chat-markdown-scene3d.mjs` 分别断言两处富文本结构、`[data-chat-code]` 折叠行为、表格滚动容器一致，截图存于 `evidence/creative-prefix-and-markdown.png` 与 `evidence/scene3d-markdown-and-tools.png`
- [x] 5.2 记录构建产物体积差异与流式表现；验证：对比改动前后 `dist` 体积写入 evidence，流式输出一段长文本时无持续掉帧（设计 D9 的实测依据）。结果见 `evidence/markdown-render-cost.md`：gzip +51.66 kB；60 次追加 p50 4.8ms / p95 17.1ms / 最大间隔 51.6ms

## Workflow follow-up

- 三个会话回归与集成验证全部通过后，归档本 change。
- 归档前用 `openspec validate chat-markdown-render --strict` 复核。
- 若 5.2 实测显示流式明显掉帧，另起 change 做 `status === 'running'` 降级，不在本 change 内扩范围。
