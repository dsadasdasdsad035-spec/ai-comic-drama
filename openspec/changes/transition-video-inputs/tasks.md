# Tasks: transition-video-inputs

## 1. 上下文缺口修复（先做，它是 bug）

- [x] 1.1 把 `assetNodesFromAssets` 从 `src/App.tsx:369` 搬到 `src/canvasShots.ts` 并导出，实现逐字搬运（顺序仍按 `assets` 下标落位）；`App.tsx` 改为 import。验证：`rg -n "function assetNodesFromAssets" src/` 只剩 `canvasShots.ts` 一处。
- [x] 1.2 在 `src/agent/builtinPlatformTools.ts` 的 `generationContext` 中，无宿主时用 `composeShotCanvasNodes(assetNodesFromAssets(project.assets ?? []), project.shots ?? [])` 取代 `buildShotNodes(base, project.shots ?? [])` 的空基底，保留原有「非分镜节点原样带入」逻辑。验证：无宿主时 `refIds: ['asset-<canvasId>']` 能解析。
- [x] 1.3 `createReadAdapter` 增加 `shotVideoContext`：`nodes` / `characters` / `missingMedia` 取 `input.getCanvasContext?.()`，`model` 取 `input.getSelectedVideoModel?.() ?? null`，`resolution` 取 `input.getVideoResolution?.() ?? ''`。验证：Pi 创意会话里 `read_shot_video_inputs` 的参考条数与画布内聊天一致。
- [x] 1.4 `src/agent/stageTools.ts` 的 `shotVideoInputsContext` 退化分支同步改为素材卡 + 分镜节点合成。验证：新增用例「无宿主 + `asset-cv1` 参考」返回 2 条参考。

## 2. 新增转场读工具

- [x] 2.1 在 `src/agent/stageTools.ts` 新增 `read_transition_video_inputs`：入参 `after_no`（必填）、`to_no`（可选）、`episode`（可选）；按源镜定位，目标镜缺省取 `transition_out.to`。验证：不传 `to_no` 时与传显式目标镜（与 `transition_out.to` 相同）结果一致。
- [x] 2.2 工具内部调用 `buildTransitionVideoPreview`（不得复制参考合并逻辑），投影 `inputMode`、`bridging`、`submitsLastFrame`、`seconds`、`requestSeconds`、`refs`（`index` 从 1 起）、`refTotal`、`styleRefs`、`styleOmitted`、`omitted`、`omittedVideos`、`video`、`audio`、`blocking`、`warnings`、`promptSource`、`promptStale`、`promptEmpty`。验证：`rg -n "collectShotComposerRefs|limitVideoReferenceImages" src/agent/stageTools.ts` 不因该工具新增命中。
- [x] 2.3 错误路径：源镜不存在、`transition_out` 缺失、`to` 指向镜头不存在时返回 `ok: false` 与可用镜号提示。验证：三种情况各有一条用例。
- [x] 2.4 工具不得返回正文：`promptSource` / `promptEmpty` 有值，但响应中不含 `generated.prompt` 文本。验证：正文写成独特字符串后调用，响应 JSON 不含该字符串。

## 3. 素材卡反查

- [x] 3.1 `read_asset_inventory` 的 `assets` 行增加 `canvasId`（存在时）。验证：响应行含 `canvasId` 且与 `project.assets[].canvasId` 一致。
- [x] 3.2 `read_asset_detail` 的 `assets` 分类 `key` 支持裸 `canvasId` 与 `asset-<canvasId>`：先剥离前缀按 `canvasId` 命中，未命中再按 inventory 的 `key` 匹配。验证：三种写法返回同一条记录。
- [x] 3.3 未命中时返回可读错误并提示先取 `read_asset_inventory` 的行。验证：乱填 `key` 报错文案含该提示。

## 4. 登记与授权

- [x] 4.1 `src/skills/tools.ts` 的 `KNOWN_TOOL_IDS` 登记 `read_transition_video_inputs`。验证：`rg -n "read_transition_video_inputs" src/skills/tools.ts` 命中。
- [x] 4.2 `src/agent/builtinPlatformTools.ts` 的 `PLATFORM_READ_TOOL_NAMES` 与 `src/skills/tools.ts` 的只读清单同步增名。验证：`verify-creative-builtin-tools.mjs` 的工具名快照包含新工具。
- [x] 4.3 `src/creative/expertToolGroups.ts` 的 `classifyExpertTool` 把新工具归入「读项目」，并加进 `DEFAULT_EXPERT_PLATFORM_TOOLS`。验证：设置页专家工具分组出现该工具且落在「读项目」。
- [x] 4.4 三个 `experts/expert-omni*/manifest.json` 的 `toolIds` 增加该工具，`soul.md` 补一句转场用法（先 `read_transition_video_inputs` 取有序参考，再 `read_shot_detail` 取两镜内容，最后 `submit_joins` 写正文）。验证：`verify-creative-experts.mjs` 通过。

## 5. 测试

- [x] 5.1 新增 `tests/transition-read.ts`：覆盖 ①有序参考与尾帧互斥 ②`promptEmpty` 与 `transition-prompt-empty` ③三种错误路径 ④正文不回传。验证：`npx tsx tests/transition-read.ts` 全绿。
- [x] 5.2 扩展 `tests/shot-read.ts`：新增「无宿主 + 素材卡参考」用例，验证 `asset-<canvasId>` 被解析而不是静默丢弃。验证：用例在修复前的实现上会失败（回归有意义）。
- [x] 5.3 扩展 `tests/shot-read.ts`：素材三写法等价用例。验证：`key: url` / `key: canvasId` / `key: asset-canvasId` 返回同一记录。
- [x] 5.4 `npx tsc --noEmit` 无新增错误；`openspec validate transition-video-inputs` 通过。

## 6. 端到端验收

- [ ] 6.1 **需真实模型会话**：在 Pi 创意会话里对一条已有转场的接缝走完整链路：`read_shots` → `read_shot_detail`（两镜）→ `read_transition_video_inputs` → 写正文 → `submit_joins`，确认正文逐字落库。验证：`transition_out.generated.prompt` 与 Agent 提交文本逐字相同。
- [x] 6.2 用同一份数据在画布内聊天与 Pi 会话各调一次 `read_transition_video_inputs`，确认参考顺序、`submitsLastFrame`、`requestSeconds` 一致。验证：两份响应除 `scope` 外逐字段相同。
- [x] 6.3 确认转场出片面板与请求仍只发 `effectivePrompt.text`，本次改动未引入任何正文拼接。验证：`rg -n "transitionRecipePromptBlock|transitionContinuityBlock" src/transitionGen.ts` 的命中仍不在 `prompt` 赋值路径上。
