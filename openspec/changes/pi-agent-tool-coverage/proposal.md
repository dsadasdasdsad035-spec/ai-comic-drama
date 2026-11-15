# Proposal

## Why

平台内置 Pi agent 的工具层只覆盖了页面 API 的一小部分，而且覆盖得不对等：能读分镜、能写角色/素材/镜头/提示词/接缝，但**创建项目、项目画风与画幅、剧本/分集写回**完全没有工具；`read_source` 明明取到了 `logline`/`style`/`aspect` 却只回 `source`，模型因此在不知道画风与画幅的情况下写提示词；`submit_shots` 对**已存在镜头**只写 10 个标量字段（`cast`、`performance`、`refIds`、`refExtras`、`prod_kind`、`motion_note` 等一律静默丢弃），回执仍报「更新 N 镜」；出图/出片/配音工具只存在于未被挂载的创意会话工具集中，agent 能写出片提示词却做不出片。

同时存在「幽灵工具」：`submit_prompt_renders` 出现在专家写工具分组与默认专家白名单里，但平台工具集从不注册它，`buildCreativeExpertTools` 又对缺失工具静默跳过——设置页和检查器显示可用，模型实际拿不到。这类不一致让「工具齐不齐」无法从界面判断。

## What Changes

- 新增项目元信息读工具（或扩展 `read_source` 的返回）回 `logline`、`style`、`aspect`、项目标题；工具描述与实际返回对齐。
- 新增 `submit_episodes` 写回分集/剧本，复用既有 `script-v1` 契约（剧本导入与 intake 已在用）与 `mergeScriptDraft`、`patchProject({ episodes })` 语义，不再另造 `episodes-v1`。
- 新增项目生命周期工具：`create_project` 与 `update_project_meta`（标题、logline、画风、画幅），写前须用户确认，目录名规则与新建项目对话框一致。
- `submit_shots` 对已存在镜头放开全字段写回（含 `cast`、`performance`、`refIds`、`refExtras`、`transition_out`、`prod_kind`、`motion_note`、`video_prompt_override` 等），仍遵守 `handEdited` 手改保护；新增 `delete_shots`。
- 新增出图、出片、配音三个带成本闸门的生成工具，产物按既有产线写回镜头（`keyframe`/`clip`/`audio_*`），不在工具里另写一套保存逻辑。
- 工具清单与注册**双向一致**：`KNOWN_TOOL_IDS`、`builtinPlatformToolNames()`、专家分组与默认白名单里的每个名字都必须在运行时工具集中存在；未注册的名字要么注册要么移除，装载期即报错，不再静默跳过。
- 不把内置动作做成模型可调用的 `run_builtin`；不开放 API Key 等设置写工具；不恢复五个工作台聊天。

## Capabilities

### New Capabilities

- `platform-tool-coverage`: 平台内置 Agent 工具的覆盖面与一致性——工具名清单与实际注册一致、无幽灵工具、项目元信息可读、镜头写回字段完整、生成媒体工具有明确落库目标。

### Modified Capabilities

- `project-lifecycle`: 新建项目与项目元信息编辑新增 Agent 工具入口，且与界面入口共用同一套校验（目录名规则、同名拒绝、写前确认）。
- `script-workbench`: 补齐「经提交工具写入剧本」所需的 `submit_episodes` 契约与合并语义；该能力原文已要求走提交工具，但工具一直不存在。
- `canvas-shots-workbench`: `submit_shots` 的写回范围从 10 个字段扩展到镜头全字段，并新增删除镜头工具；写回后仍走同一套落库与水合规则。
- `shot-still-image`: Agent 出图工具必须复用静帧产线、遵守 `prodKind === 'image'` 限制，并把结果写入镜头 `keyframe`/候选列表而不是只留在工具回执里。

## Impact

- 前端 Agent 层：`src/agent/stageTools.ts`（读工具返回、submit 注册）、`src/agent/builtinPlatformTools.ts`（平台工具清单与注册）、`src/platform/projectDraft.ts`（新增契约的合并分支）、`src/shotSync.ts`（`mergeShotsDraft` 的字段白名单）、`src/creative/expertToolGroups.ts`（分组与默认白名单一致性）、`src/skills/tools.ts`（`KNOWN_TOOL_IDS`）。
- 契约层：`src/skills/contracts.ts` 新增 `project-meta-v1`（标题、logline、画风、画幅）；`submit_episodes` 复用既有 `script-v1`，并同步 `validate_contract` 可校验范围。
- 服务端：`createProject` / `patchProject` 已有接口直接复用，不需要新 HTTP 端点；删除镜头复用 `mergeProjectShots(deleteShotIds)`。
- 生成工具：复用 `generateImage` / `startVideo` / `generateVoice` 与既有成本确认组件，不新增模型调用路径。
- 测试：`tests/` 补「清单与注册一致」「已存在镜头全字段写回」「剧本写回」「幽灵工具加载即报错」四类断言；`tsc --noEmit` 与现有 verify 脚本保持全绿。
- 不做：设置页写工具（API Key / 渠道）、技能安装与 MCP 配置工具、`run_builtin`、恢复五个工作台聊天、清理未挂载的死代码（另起变更）。
