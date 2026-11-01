# Proposal

## Why

创意视图与发布助手已接入 `resolveStageModel`（环节 `creative` / `publish` + 本机 `StagePick`），但界面只读展示当前模型，无法像剧本/角色/镜头等工作台那样手选；设置页「生成环节默认」还缺少 `creative` 一行。用户只能在设置里改全局文本默认或无法单独绑创意环节，体验与既有工作台不一致，也违背创意工作室设计里「对话文本走 `stageModels.creative` + 手选优先」的约定。

## What Changes

- 创意头部上下文条增加 `StageModelSelect`（`stage="creative"`），经 `App` 传入 `pickStageModel`，手选写入现有 `STAGE_PICK_KEY` localStorage，与五工作台共用机制。
- 发布助手（`PublishChatPanel` / `WorkbenchHeader` 上下文条）增加 `StageModelSelect`（`stage="publish"`），同样接 `pickStageModel`。
- 设置页 `STAGE_META` 增加「创意（对话助手）」行，绑定 `stageModels.creative`；空则跟随「文本 · 常规」默认（与 `publish` 等文本环节一致）。
- 无文本族可运行模型时，下拉保持 disabled 并沿用现有 `stageDefaultLabel` 报错样式；不新增服务端 API。

## Capabilities

### New Capabilities

- `creative-chat`: 补全主规格中缺失的「创意对话文本模型可在页面手选」行为（与能力托盘负责的媒体能力绑定分离）。

### Modified Capabilities

- `publish-assistant`: 发布助手聊天头部 MUST 允许手选 `publish` 环节文本模型，并与设置页环节默认、本机手选解析顺序一致。

## Impact

- 前端：`src/App.tsx`（向 `CreativeStudio`、`PublishBoard` / `PublishChatPanel` 传 `onPickStage`）、`src/creative/CreativeHeader.tsx` 或 `CreativeStudio.tsx`、`src/publish/PublishChatPanel.tsx`、`src/chat-ui/WorkbenchHeader.tsx`（可选 slot 或内联 select）、`src/settings/SettingsPage.tsx`（`STAGE_META`）。
- 复用：`src/ModelSelect.tsx` 的 `StageModelSelect`、`stageModelKey`、`stageDefaultLabel`；无新持久化键。
- 测试：Playwright 或现有 verify 脚本可断言创意/发布 dock 存在 `[data-stage-model-select="creative"|"publish"]` 且变更后 `stagePick` 生效；设置页存在 `data-stage-row="creative"`。
- 非目标：不改创意 `creative.models` 能力托盘语义；不把创意文本手选迁入会话 DB；不改 `/api/text` 或模型解析算法。
