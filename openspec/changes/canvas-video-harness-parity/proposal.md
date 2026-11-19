# Proposal: canvas-video-harness-parity

## Why

创意 DSH harness（DeepSeek 等模型经 `/studio` 调平台工具）与画布「出片」按钮共用 `buildShotVideoRequest`，但 **Agent 可调参数远少于 Inspector**：正文手改、原生音频、表情参考、分辨率/模型会话态、`refExtras`、工位切换等只能人手点画布；`generate_clip` 的 schema 宣称可选 `prompt`，实现却只拿它做非空检查，真正提交的是 `effectiveVideoPrompt`（手改 / `videoPrompt`），与工具描述和用户预期不一致。结果是 Agent 能 `read_shot_video_inputs` 看清请求，却无法把画布上那些「会改变出片」的开关与正文写回去，也难以在单次调用里覆盖模型/分辨率做试验。

## What Changes

- **修正 `generate_clip`**：可选 `prompt` 在不存在有效 `videoPromptOverride` 时 MUST 作为本次提交的出片正文（与画布按钮在「仅运动提示词」路径下行为一致）；若存在手改正文，MUST 仍以 override 为准，并在工具描述中写明优先级。
- **新增镜级出片写工具**（名字寻址、单镜写回、无成本）：
  - `set_shot_video_override`：保存/清除 `video_prompt_override`（须携带或复算 fingerprint，与面板「手改」语义一致）。
  - `set_shot_video_options`：写入 `useExpressionRef`、`audioMode`（`native` / `off`，与 `NativeAudioPanel` 同形）、`prod_kind`（`image` / `video`）。
  - `set_shot_ref_extras`：`refExtras` 增删（仅项目内媒体 URL，对齐 Meta 页手工参考）。
  - `set_shot_neighbor_refs`：为镜号添加/移除 `SHOT_PREV` / `SHOT_NEXT` 邻镜参考 token（与画布邻镜连线等价）。
- **扩展 `generate_clip` 可选会话覆盖**：可选 `modelKey`、`resolution`（`480p` | `720p`），仅作用于**该次**提交；省略时仍用当前画布会话的出片模型与分辨率（与今天一致）。
- **专家与清单**：新工具纳入 `KNOWN_TOOL_IDS`、`builtinPlatformToolNames()`、`DEFAULT_EXPERT_PLATFORM_TOOLS`、专家设置「项目与分镜管理」分组；`docs/creative-studio.md` 补「画布参数 ↔ 工具」对照表。
- **测试**：单元/契约测试覆盖优先级、写回字段、fail-closed（外链 refExtras、无音色样本开 native）、`generate_clip` 单次 model/resolution 覆盖。

无 **BREAKING**：现有工具参数保持兼容；`generate_clip` 仅在「此前 `prompt` 被忽略」的场景下行为变严格（更接近 schema 描述）。

## Capabilities

### New Capabilities

- `creative-shot-video-harness`：创意 harness 对单镜出片参数的写能力与 `generate_clip` 提交语义，使 Agent 可配置的画布维度与 `read_shot_video_inputs` 投影一致。

### Modified Capabilities

- `dsh-tool-bridge`：`generate_clip` 参数定义与执行语义一致；新增动作工具纳入声明/校验/专家边界。
- `shot-video-prompt`：Agent 可通过工具写入/清除手改正文，且生成路径 MUST 与面板逐字一致。

## Impact

- `src/agent/builtinPlatformTools.ts`：`generate_clip` 正文优先级与可选 model/resolution；`PLATFORM_ACTION_TOOL_NAMES`。
- `src/agent/materialTools.ts`（或同级新模块）：四个镜级写工具实现。
- `src/agent/stageTools.ts` / 读侧无需改语义；`read_shot_video_inputs` 回归「写后读一致」。
- `src/creative/expertToolGroups.ts`、`src/skills/tools.ts`、`experts/expert-omni*/manifest.json`、`soul.md`。
- `server/studio-tool-bridge.mjs`：重建 `server-build` 后热更新声明。
- 测试：`tests/platform-generate-tools.ts`、`verify-creative-builtin-tools.mjs`、新增 `tests/shot-video-harness-tools.ts`。
- **不在本次**：构图 `marks`、首帧候选切换、挂载已有 mp4、`submit_prompt_renders` 注册、全局设置页改默认视频模型。