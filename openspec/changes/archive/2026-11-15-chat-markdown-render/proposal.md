# Proposal

## Why

创意会话、3D 调度会话、技能会话共用同一个文本渲染入口 `src/chat-ui/ChatText.tsx`，它只识别成对围栏代码，其余文本以 `whitespace-pre-wrap` 原样输出。模型实际输出大量 Markdown（`#` 标题、`**粗体**`、`-` 列表、`|` 表格、行内反引号），用户在 360-420px 侧栏里看到的是带符号的裸文本，模型说明的可读性明显低于其信息量。

同时 `scene-agent-chat-ui` 规格已经声明文本消息「支持 Markdown」，但代码从未实现，规格与实现不一致，也让这个缺口长期不被当作缺陷。

## What Changes

- 引入 `react-markdown` + `remark-gfm` + `remark-breaks`，把消息文本按 Markdown 渲染。
- 重写 `ChatText`：正文走 Markdown，围栏代码仍复用现有 `ChatCodeBlock` 折叠块，保留 `[data-chat-code]` 契约。
- 新增 `.chat-md` 作用域排版样式：正文层级字号、粗体、列表、引用、链接、行内代码；表格外包横向滚动容器，避免窄面板被撑破。
- 覆盖 `chat.css` 中 `h1~h4 / p / a` 的全局 reset（`font-size: inherit`、`text-decoration: none`），否则 Markdown 渲染出来与正文无差别。
- 用户消息与助手消息统一走同一渲染器；两个在册调用点（`CreativeStudio`、`SceneAgentChat`）签名不变。`SkillChat` 已是死代码，随本 change 删除。
- 移除手写 `splitFencedCode` 及其正则切分路径（无其它引用）。
- **BREAKING**（对前端构建）：新增 3 个运行时依赖，Web 构建产物增大（unified/micromark 生态，gzip 约 100KB 量级）。

## Capabilities

### New Capabilities

- `chat-message-markdown`: 工作台会话（创意、3D 调度、技能）消息文本的 Markdown 渲染契约——支持的语法范围、代码块的折叠行为、表格的窄栏溢出处理、单换行保留，以及不渲染原始 HTML 的安全边界。

### Modified Capabilities

- `scene-agent-chat-ui`: 把「文本消息支持 Markdown」这条笼统场景收敛为指向共享渲染契约的具体表述（代码块走折叠块、表格可横向滚动、行内代码可读），消除规格与实现的长期偏差。

## Impact

- 代码：`src/chat-ui/ChatText.tsx`（重写）、新增 `src/chat-ui/chat-markdown.css`、`src/App.tsx` 与 `src/agent/SceneAgentChat.tsx` 的样式引入、`src/chat-ui/chat.css` 可能的少量调整。
- 依赖：`react-markdown`、`remark-gfm`、`remark-breaks`（新增）；不改动 `ChatCodeBlock` 与 `@assistant-ui/react` 用法。
- 行为面：创意会话与 3D 调度会话的消息渲染同时变化；`CreativeStudio` 的 `第 N 轮` 轮次前缀匹配在文本进入渲染器之前执行，理论上不受影响，需回归验证。
- 验证：新增 `verify-chat-markdown.mjs`，断言标题/粗体/列表/表格节点存在、代码块仍带 `data-chat-code`、关键前缀分支未被破坏。
- 部署：Electron 桌面端无感；纯 Web 部署需评估首屏体积。
