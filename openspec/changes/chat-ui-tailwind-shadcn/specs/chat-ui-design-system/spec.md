# Spec Delta

## Purpose

让聊天视觉层成为独立、可复用的组件层，用 Tailwind 与 shadcn primitives 表达现有主题，同时保持 assistant-ui runtime 和既有聊天行为不变。

## ADDED Requirements

### Requirement: 聊天视觉层必须独立于 runtime

聊天视觉 MUST 由独立的 `chat-ui` 组件层承载；assistant-ui MUST 继续负责消息 runtime、Composer 和 tool UI 绑定。组件层 MUST 提供消息、模型轮次、工具卡、代码摘要、关键帧、验收清单、空状态和 Composer 的可复用组件。

#### Scenario: 组件边界

- **WHEN** 渲染 agent 聊天
- **THEN** `SceneAgentChat` 只负责 runtime/事件适配，消息和工具卡由 `chat-ui` 组件渲染

#### Scenario: 保留 tool UI 绑定

- **WHEN** 工具事件到达
- **THEN** 仍通过 assistant-ui 的 tool UI 机制更新对应卡片，不建立第二套消息状态

#### Scenario: 组件复用

- **WHEN** 其他聊天场景需要相同的消息或工具卡
- **THEN** 可以复用 `chat-ui` 组件，而不复制 `.cw-agent` 样式

### Requirement: 聊天 Tailwind 样式必须作用域隔离

Tailwind 与 shadcn 样式 MUST 只作用于聊天子树，MUST NOT 通过全局 preflight 或默认主题覆盖工作台、画布、Inspector 和 React Flow。聊天容器 MUST 有 scoped reset 和明确的样式边界。

#### Scenario: 全局样式不被污染

- **WHEN** 打开聊天面板
- **THEN** 工作台、画布、表单和 React Flow 的布局与字体不受 Tailwind preflight 影响

#### Scenario: 聊天内部 reset

- **WHEN** shadcn 组件在聊天子树内渲染
- **THEN** 边框、盒模型、按钮和文本的默认样式只在该子树内生效

#### Scenario: 关闭后无残留

- **WHEN** 聊天面板关闭
- **THEN** 不留下影响其他页面的全局聊天样式或 token

### Requirement: shadcn token 必须映射现有主题

聊天视觉 MUST 使用现有日间/夜间主题的语义颜色，不得引入与工作台冲突的第二套默认主题。shadcn 的颜色、圆角和状态 token MUST 映射到现有主题变量，并在 `data-theme` 切换时同步。

#### Scenario: 日间主题

- **WHEN** 工作台处于日间主题
- **THEN** 聊天背景、卡片、文字、强调色和错误色与工作台一致

#### Scenario: 夜间主题

- **WHEN** 工作台处于夜间主题
- **THEN** 聊天不残留浅色表面或默认 shadcn 颜色

#### Scenario: 状态色

- **WHEN** 工具卡处于 running、done、warn 或 error
- **THEN** 对应状态色可区分，并保持可读对比度

### Requirement: 视觉迁移不得改变聊天行为

切换视觉层 MUST NOT 改变工具卡顺序、代码摘要、帧缩略图、验收清单、页签切换、滚动恢复、取消/超时或输入状态。现有聊天验收 MUST 继续通过，必要选择器 MUST 改用稳定的 `data-testid` 或 role。

#### Scenario: 工具轨迹

- **WHEN** agent 完成上下文、代码、沙箱、抓帧和验收
- **THEN** 卡片顺序和结果与迁移前一致

#### Scenario: 页签与滚动

- **WHEN** 用户切到代码页签再切回聊天
- **THEN** 消息、帧、清单和滚动位置仍保留

#### Scenario: 取消与超时

- **WHEN** 用户取消或运行超时
- **THEN** 聊天仍显示正确的取消/超时状态，输入恢复可用

### Requirement: 聊天视觉必须保持响应式和可访问

聊天组件 MUST 在 900px 和 760px 工作台宽度下不横向溢出；按钮、输入、工具状态和缩略图 MUST 有可访问名称和可见焦点。过渡 MUST 尊重减少动效偏好。

#### Scenario: 窄屏

- **WHEN** 工作台宽度为 900px 或 760px
- **THEN** 工具卡、帧和清单可读且不横向溢出

#### Scenario: 键盘

- **WHEN** 用户只用键盘操作
- **THEN** 输入、发送、取消和工具卡可聚焦，焦点可见

#### Scenario: 减少动效

- **WHEN** 系统开启减少动效
- **THEN** 聊天开启/关闭或状态切换不依赖长动画
