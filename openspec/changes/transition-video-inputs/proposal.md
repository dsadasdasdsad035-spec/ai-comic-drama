# Proposal: transition-video-inputs

## Why

分镜侧已经有 `read_shot_video_inputs` 把「实际会提交的参考顺序、省略项、模式与秒数」交给 Agent，正文由 Agent 读数据后自己写。转场侧没有对等工具：Agent 只能读 `transition_out` 原始字段与两镜内容，无法知道转场真正会提交哪几张参考图、什么顺序、哪些被尾帧互斥掉、请求几秒。结果 Agent 写得出桥接文字，却写不出带 `[图N]` 槽位映射的正文，只能靠猜顺序。

同时发现两个连带缺口：Pi 创意会话路径下 `read_shot_video_inputs` 会静默丢掉素材卡参考（无画布上下文时只重建分镜节点）；`read_asset_inventory` 不暴露 `canvasId`，Agent 看到 `refIds: ["asset-<canvasId>"]` 无法反查是哪张素材。

## What Changes

- 新增只读工具 `read_transition_video_inputs`：按接缝（`after_no` → `to_no`，或 source shotId）返回转场出片的实际输入投影——`inputMode`、`bridging`、是否真提交尾帧、镜头秒数与请求秒数、按提交顺序排列的 `refs`（label/用途/source/是否提交）、`styleRefs` 与 `styleOmitted`（含互斥原因）、`omitted`/`omittedVideos`、`video`、`audio`、`blocking`、`warnings`、`promptSource`、`promptStale`、`promptEmpty`。不返回正文（正文用读工具 `read_shot_detail` 的 `transition_out.generated.prompt` / 手改快照）。
- `WorkbenchChatAdapter.shotVideoContext` 在平台内置工具适配器里接线，使 Pi 创意会话与画布内聊天拿到同一份出片上下文（节点 / 角色 / 缺失媒体 / 当前视频模型 / 分辨率）。
- 无宿主上下文时，`shotVideoInputsContext` 按项目快照同时重建**分镜节点与素材卡节点**，让 `asset-<canvasId>` token 能解析（对齐「参考顺序与出片请求一致」）。
- `read_asset_inventory` 的 `assets` 行增加 `canvasId` 字段；`read_asset_detail` 的 key 支持 `canvasId` 或 `asset-<canvasId>`，使 Agent 能把 `refIds` 里的素材 token 反查成素材本体。
- 登记与授权：`KNOWN_TOOL_IDS`、`builtinPlatformToolNames()`、`DEFAULT_EXPERT_PLATFORM_TOOLS`、`classifyExpertTool`（归「读项目」）、三个 `expert-omni*` manifest 与 soul 文案。

无 **BREAKING**：全部为新增只读工具与新增字段；现有工具参数与返回字段保持不变（`assets` 行多一个字段）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `shot-transition-video-prompt`：新增「转场出片输入对 Agent 可见」要求（有序参考、省略项与互斥原因、输入模式与时长）。
- `creative-asset-tools`：新增「素材卡行可按画布身份反查」要求（`canvasId` 暴露与按 token 钻取）。
- `creative-chat`：新增「创意会话的出片输入上下文与画布一致」要求（Pi 路径不得丢素材卡参考）。

## Impact

- `src/transitionGen.ts`：导出/复用 `buildTransitionVideoPreview` 供工具投影（只读调用，不改拼装语义）。
- `src/agent/stageTools.ts`：新增 `read_transition_video_inputs`；`shotVideoInputsContext` 补素材卡节点。
- `src/agent/builtinPlatformTools.ts`：`createReadAdapter` 接线 `shotVideoContext`；`PLATFORM_READ_TOOL_NAMES` 增名。
- `src/agent/workbenchChat.ts`：`shotVideoContext` 类型不变（本次只接线，不改形状）。
- `src/canvasAssets.ts`（或从 `App.tsx` 抽出）：`project.assets → 素材卡节点` 的共用构造，供工具与画布共用。
- `src/skills/tools.ts`、`src/creative/expertToolGroups.ts`、`experts/expert-omni*/manifest.json`、`experts/expert-omni*/soul.md`。
- 测试：`tests/shot-read.ts`（补转场投影与 Pi 路径素材卡用例）、新增 `tests/transition-read.ts`、`verify-creative-builtin-tools.mjs`、`verify-creative-experts.mjs`。
