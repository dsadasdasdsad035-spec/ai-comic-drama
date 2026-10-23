# Design

## Context

当前 `SceneAgentChat` 直接组合 assistant-ui primitives，并在 `theme.css` 中维护约 80 行 `.cw-agent*` 样式。项目没有 Tailwind/shadcn 依赖，也没有 `@/` alias。聊天在 900/760px 下有独立的可见性、滚动和取消行为，测试依赖 `.cw-agent` 选择器。

## Goals / Non-Goals

**Goals:**

- 把聊天视觉层抽成 `src/chat-ui`，用 Tailwind + shadcn primitives 表达。
- 样式严格限制在聊天子树，不改变工作台、画布、Inspector 和 React Flow。
- 保留 assistant-ui runtime、tool UI 绑定、事件顺序和现有交互。
- 用现有日/夜主题变量驱动 shadcn token。
- 让聊天组件可以脱离 `.cw-agent*` CSS 复用。

**Non-Goals:**

- 不替换 assistant-ui，不引入第二套消息 runtime。
- 不迁移全站到 Tailwind。
- 不改变 agent tool、上限、subagent、MCP 或技能运行时。
- 不在这轮做并行工具执行或新聊天功能。

## Decisions

### 1. Tailwind v4 + Vite 插件，聊天 CSS 独立入口

使用 Tailwind v4 的 Vite 插件，把聊天 CSS 放在 `src/chat-ui/chat.css`，由懒加载的聊天入口引入。只引入 theme/utilities，不引入全局 preflight；在 `.chat-ui` 下补 scoped reset（box-sizing、边框、按钮/输入字体、标题 margin）。

不把 Tailwind 加到 `theme.css` 全局入口。备选方案是全站迁移 Tailwind，但会与现有大量手写 CSS 和主题变量冲突，收益不成比例。

### 2. shadcn 组件是 copy-in primitives，不是新 runtime

新增 `components.json` 和 `@/*` alias；shadcn 组件放在 `src/chat-ui/ui/`，只引入实际用到的 Button、Textarea、Card、Badge、Separator、Tooltip。`ScrollArea` 不替换 assistant-ui 的 viewport，继续用原生滚动容器，保留滚动位置和自动滚底逻辑。

新增依赖控制在 `clsx`、`tailwind-merge`、`class-variance-authority`、`@radix-ui/react-slot`、`@radix-ui/react-tooltip` 和图标库；不引入大型聊天 kit。

### 3. `chat-ui` 组件边界

```text
SceneAgentChat
  - assistant-ui runtime / events / tool UI registration
  - 传给 ChatRoot 的消息、状态、回调
  - 工具渲染器调用 chat-ui/tools/*

src/chat-ui/
  ChatRoot          .chat-ui 容器 + tokens
  ChatViewport      原生滚动容器 + ThreadPrimitive.Viewport
  ChatMessage       用户/助手消息
  ChatStep          模型轮次
  ChatText          普通文本 + fenced code block 拆分
  ChatCodeBlock     默认折叠代码块
  ChatComposer      输入/发送/取消
  ChatEmpty         空状态
  tools/            各工具卡（代码、沙箱、帧、清单、结束）
  ui/               shadcn primitives
```

组件只接收展示数据，不持有 agent 运行状态。`makeAssistantToolUI` 继续在 `SceneAgentChat` 注册，`render` 只返回 `chat-ui/tools` 组件。

### 4. 主题 token 映射

在 `.chat-ui` 内定义 shadcn 变量：

```css
--background: var(--bg);
--foreground: var(--text);
--card: var(--panel);
--primary: var(--accent);
--secondary: var(--panel-2);
--muted: var(--bg-2);
--muted-foreground: var(--muted);
--destructive: var(--danger);
--border: var(--line);
--ring: var(--accent);
--radius: var(--r-md);
```

日/夜由现有 `html[data-theme]` 驱动；不使用 shadcn 默认 `.dark` 类，也不在 `.chat-ui` 外部声明这些变量。

### 5. 测试钩子和迁移顺序

现有测试依赖 `.cw-agent`、`.cw-agent-input`、`.cw-agent-frames` 等类名。迁移时保留 `.chat-ui` 外层和稳定的 `data-chat-*`/role：

```text
chat-root, chat-user-message, chat-assistant-message,
chat-step, chat-tool, chat-frames, chat-review,
chat-composer, chat-input
```

先完成 Tailwind/shadcn 基础设施和组件，再替换 JSX，最后删除 `.cw-agent*` 旧样式。测试从类名断言逐步改为 `data-testid`/role，避免测试和实现互相绑死。

### 6. 代码块默认折叠

新增 `ChatText` 解析 assistant/step 文本中的 fenced code block（```lang ... ```），把普通文本和代码段拆开；代码段交给 `ChatCodeBlock`。`ChatCodeBlock` 使用 shadcn `Collapsible`（或等价的 Radix collapsible primitive），默认 `open=false`，首行显示语言、行数和“展开代码”，展开后显示 `<pre><code>`。

不引入完整 Markdown 渲染器；只处理 fenced code，避免大依赖。`set_scene_code` 工具卡继续只显示行数/hash 和“查看代码”，完整代码始终在代码页签。

### 7. 样式加载与构建


聊天是懒加载 chunk。`chat.css` 由聊天入口 import，让 CSS 随 agent chunk 加载；Tailwind 只扫描 `src/chat-ui` 和 `SceneAgentChat`，不扫描全项目，减少无关 utilities。构建后检查主应用 CSS 不因聊天样式膨胀。

## Risks / Trade-offs

- [Tailwind preflight 污染全局] → 不引入 preflight，只在 `.chat-ui` 补 scoped reset；运行工作台/主题截图回归。
- [shadcn 组件依赖 preflight 的盒模型/边框] → 在 scoped reset 中显式补 box-sizing、border-style、button/input 基础样式；逐组件检查。
- [日夜主题出现第二套色板] → 所有 shadcn token 映射到现有变量，禁止默认主题覆盖；日夜截图验证。
- [懒加载 CSS 未随 chunk 加载] → 在聊天入口 import `chat.css`，检查构建产物和实际打开面板后的样式。
- [测试选择器大面积失效] → 先加 `data-chat-*` 稳定钩子，再迁移组件；保留 `.chat-ui` 外层。
- [代码 fence 解析误伤普通文本/不完整 fence] → 只识别成对 fenced block，未闭合时按普通文本显示；单测覆盖多种语言和正文混排。
- [shadcn 组件/依赖增加包体] → 只复制实际用到的 primitives，不引入大型 chat kit；比较 agent chunk 大小。
- [Tailwind 类被全项目扫描导致 CSS 膨胀] → 配置 content/source 为 `src/chat-ui` 与 `SceneAgentChat`。

## Migration Plan

1. 增加 Tailwind/shadcn 配置、alias、`chat.css` 和最小 primitives。
2. 建立 `src/chat-ui` 组件和稳定 `data-chat-*` 钩子，先并排渲染/替换单个工具卡。
3. 替换 `SceneAgentChat` 的 JSX，保留 runtime/tool UI 注册和事件处理。
4. 加 `ChatText`/`ChatCodeBlock`，聊天代码默认折叠；更新聊天工具卡/页签说明。
5. 更新聊天测试选择器，删除旧 `.cw-agent*` 样式。
6. 跑构建、聊天 UI/失败取消、工作台/沙箱/主题回归；比较包体和截图。

回滚时恢复 `SceneAgentChat` 旧 JSX 和 `.cw-agent*` 样式、移除 Tailwind/shadcn 配置；agent runtime 和数据不变。
