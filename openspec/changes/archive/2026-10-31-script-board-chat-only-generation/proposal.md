# Proposal

## Why

剧本页同时提供左栏原著编辑、顶栏「生成分集」和 Agent 聊天，三条入口做同一件事，界面占宽且与「改稿在聊天、表格只承载结构化结果」的产品方向不一致。用户已明确生成剧本应只走聊天（内置动作 + 自由对话 `submit_script`），主区域应专注分集/场次的阅读与手改。

## What Changes

- **BREAKING（UI）**：移除剧本页左栏（原著、一句话故事、「+ 加一集」）及顶栏上下文带中的「生成分集 / 重新生成分集」按钮。
- 剧本主区域改为全宽展示分集列表；顶栏保留集数、每集时长、环节模型、Agent、重新加载、保存。
- 从零拆集与改稿的生成入口统一为 Agent：聊天内置「生成分集/重新生成分集」与自由对话提交剧本草稿；行为与现有宿主流程、输出契约不变。
- 更新空态与禁用文案（不再引用「左栏」「顶栏生成分集」）；Inspector 等文案改为指向顶栏保存。
- 数据模型不变：`project.json` 仍读写 `source`、`logline`、`episodes`、`style`；`source` 可通过项目文件/API/聊天产物维护，页面上不再提供原著与 logline 表单。
- 回归脚本：`verify-stage-models-ui.mjs`、`verify-workbench-builtin-actions.mjs` 等改为经聊天或 API 预置 `source`，不再依赖 `.sb-source` 与顶栏生成按钮。

## Capabilities

### New Capabilities

- `script-workbench`: 剧本工作台主区域布局、允许的编辑面、以及生成入口仅位于 Agent 聊天的行为契约。

### Modified Capabilities

- `workbench-shell`: 剧本视图上下文带的主强调操作定义（不再要求顶栏「生成分集」为 primary）。
- `project-context`: 「没有项目时生成」等场景改为覆盖聊天内置动作，而非仅顶栏按钮。

## Impact

- 前端：`src/ScriptBoard.tsx`、`src/theme.css`（`.sb-left` 及相关样式可删除或保留未使用）、`src/chat-ui/WorkbenchInspector.tsx`（保存提示文案）、`src/agent/workbenchChat.ts`（剧本 profile 空态文案，可选）。
- 测试：`verify-stage-models-ui.mjs`、`verify-workbench-builtin-actions.mjs`；必要时 `verify-script-knobs.mjs` 若引用左栏 DOM。
- 文档：`README.md` 中「顶部按钮与聊天内置动作一一对应」对剧本需改为「剧本生成仅在聊天」。
- 与进行中变更 `workbench-chat-builtin-actions` 的关系：该变更要求聊天与顶栏按钮一致；本变更对**剧本**例外——顶栏按钮移除，聊天内置动作成为唯一显式拆集入口（自由对话路径不变）。
