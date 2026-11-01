# Proposal

## Why

镜头表页同时提供「本集梗概」输入框、顶栏「拆镜」按钮与 Agent 聊天，三条入口做同一件事；主区域又是可编辑大表格，和「在聊天里拆镜、左边只看/改结果」的方向不一致。用户已明确产镜只走聊天，左侧保留可编辑镜头草稿并显式保存，不再在页内单独维护梗概或一键拆镜。

## What Changes

- **BREAKING（UI）**：移除镜头表页 `.wb-gen` 区域（本集梗概 `textarea` 与「拆镜」按钮）。
- 镜头表主区域继续展示当前集镜头列表（字段编辑、增删插镜、表演展开、导入、保存、推画布等既有能力保留）；空态改为指向 Agent，不再写「上面写点内容，点拆镜」。
- 产镜与结构性改镜统一为 Agent：自由对话经 `read_episode` / `read_shots` / `submit_shots` 与 `shotlist` 技能；移除与已删顶栏按钮绑定的聊天内置「拆镜」动作（镜头表成为与剧本类似的「生成仅在聊天对话/工具链」例外，不再要求顶栏与内置一一对应）。
- 镜头表视图 SHALL 在宽屏下默认展开 Agent 面板（仍可用 Agent 按钮收起）；聊天是唯一产镜输入面。
- 剧本页「拆这一集 →」改为切换到镜头表并聚焦 Agent（不再暗示顶栏拆镜）。
- 更新 `WORKBENCH_PROFILES.shots` 空态/占位文案；回归脚本不再依赖 `.wb-gen`、`data-split` 或顶栏拆镜 DOM。
- 数据模型与 `shots-v1` 契约不变；`mergeGenerated`、手改保护、按集线程键不变。

## Capabilities

### New Capabilities

- `shots-workbench`: 镜头表工作台左右分栏契约——左侧可编辑镜头草稿与保存，产镜入口仅在 Agent 聊天。

### Modified Capabilities

- `workbench-shell`: 镜头表视图上下文带不再以「拆镜」为顶栏主操作；空态与强调按钮规则与剧本/chat-first 对齐。
- `workbench-chat-clear`: 清空对话时「拆镜运行中」场景改为覆盖 Agent 侧分镜生成/提交流程（无顶栏拆镜时仍须取消进行中的产镜请求）。

## Impact

- 前端：`src/ShotTable.tsx`、`src/theme.css`（`.wb-gen` 等）、`src/ScriptBoard.tsx`（跳转文案/行为）、`src/agent/workbenchChat.ts`（shots profile、移除 shots 的 `split_shots` builtin 注册）、`src/agent/chatPanel.ts`（shots 默认展开策略，可选）。
- 测试：`verify-workbench-builtin-actions.mjs`、`verify-workbench-builtin-real.mjs`、`verify-workbench-chats.mjs` 等：镜头表改为经聊天工具链或 mock `submit_shots`，不再点顶栏/内置拆镜。
- 文档：`README.md` 工作台内置动作表对镜头表改为「拆镜仅在聊天」。
- 与进行中变更 `workbench-chat-builtin-actions` 的关系：归档后需在主 spec 或 README 注明镜头表（及已完成的剧本）不再要求「顶栏按钮与内置动作一一对应」。
