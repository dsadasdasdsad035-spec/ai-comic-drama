# Proposal

## Why

当前聊天 UI 是 `SceneAgentChat` 里的 JSX 加 `theme.css` 的 `.cw-agent*` 手写样式：工具卡、模型轮次、帧和清单都耦合在一个扁平 CSS 文件里，视觉迭代和复用困难。项目没有 Tailwind 或 shadcn 基础设施，也没有独立的聊天组件边界。

assistant-ui 已经负责聊天 runtime、消息、Composer、取消和 tool UI 绑定，适合保留；需要替换的是视觉层，而不是再引入一套聊天状态系统。

## What Changes

- 引入 Tailwind + shadcn 基础设施，只作用于聊天子树；不迁移全站样式。
- 新增 `src/chat-ui/` 内部组件层：消息、模型轮次、工具卡、代码摘要、关键帧、验收清单、Composer 和空状态。
- `SceneAgentChat` 保留 assistant-ui 的 `ExternalStoreRuntime`、`ThreadPrimitive`、`ComposerPrimitive` 和 `makeAssistantToolUI`，只把渲染交给 `chat-ui` 组件。
- shadcn token 映射到现有日间/夜间语义变量；Tailwind preflight 不得污染工作台、画布、Inspector 和 React Flow。
- 保留现有聊天行为：工具卡顺序、帧缩略图、清单、页签切换、滚动恢复、取消和超时状态。
- 增加聊天视觉/布局回归，覆盖日夜主题、900/760px、焦点和工具卡可读性。

**BREAKING**：聊天 DOM 的 `.cw-agent*` 类名会调整；需要同步测试选择器，但保留稳定的 `data-testid`/role。

## Capabilities

### New Capabilities

- `chat-ui-design-system`: 定义聊天视觉层使用 Tailwind/shadcn、独立 `chat-ui` 组件边界、主题 token 映射、样式隔离和可访问性要求。

### Modified Capabilities

无。现有 `scene-agent-chat-ui` 的行为契约保持不变；本次只更换视觉实现和组件组织。

## Impact

- 前端依赖与配置：`tailwindcss`、`@tailwindcss/vite`、shadcn copy-in primitives、`clsx`、`tailwind-merge`、少量 Radix/图标依赖；`tsconfig`/Vite 的 `@/` alias 和 `components.json`。
- 代码：`src/agent/SceneAgentChat.tsx`、新增 `src/chat-ui/**`、`src/theme.css` 中聊天段落的迁移。
- 测试：`verify-agent-chat-ui.mjs`、`verify-agent-chat-failure.mjs`、工作台/主题回归。
- 不改变 LangGraph runtime、工具白名单、agent 上限、项目数据结构或服务端 API。
- 不把整个工作台迁移到 Tailwind，也不替换 assistant-ui。
