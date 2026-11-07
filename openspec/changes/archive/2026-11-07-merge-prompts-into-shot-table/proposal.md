# Proposal

## Why

拆镜与写首帧/视频提示词分两阶段、两个顶栏视图，模型在第二次才读镜头表，容易与当场写下的 `desc` / `performance` 脱节。用户要求在一次拆镜里同步产出可直接出图的提示词，并把编辑与校验收进镜头表，去掉单独的「提示词」菜单。

## What Changes

- **BREAKING（导航）**：移除顶栏「提示词」视图与 `PromptTable` 主入口；首帧/视频提示词在镜头表编辑、保存与推画布。
- **BREAKING（主生成路径）**：`shotlist` 技能扩展为单次 `submit_shots` 产出完整 `shots-v1`（含每镜 `keyframe_prompt` 与 `video_prompt`）；技能增加读角色 bible（`read_characters`）及 `prompt` 技能中的 A/B 提示词规则与 `{{角色名}}` 占位约定。
- **`shots-v1` 契约**：镜对象增加可选的 `keyframe_prompt`、`video_prompt`（schema 层 optional，保证导入与旧 JSON 兼容）；聊天拆镜路径在技能正文要求全集两列必填。
- **宿主合并**：`buildShotsFromModel` 映射提示词列；`applyDraft` 在写入前对首帧做 `expandAnchors` 与未解析锚点计数（对齐原提示词工作台）。
- **手改保护**：`keyframe_prompt` / `video_prompt` 纳入 `handEdited`；`mergeGenerated` 重拆镜时保留手改提示词。
- **次路径（非顶栏）**：保留 `prompt` 技能 + `submit_prompts` / `prompts-v1` 与 `prompt-intake`，供「只刷新提示词、不改结构」的聊天或导入；不再有独立工作台 Tab。
- **设置与内置动作**：移除提示词顶栏「生成提示词」与内置一一对应；设置页 `prompt` 环节标为辅助或隐藏，拆镜默认用 `shot` 环节模型。
- **文档与验收**：`README` 五工作台改为四项目视图 + 3D；`verify-workbench-*`、`verify-text-intake.mjs`、`verify-prompt-*` 等改从镜头表进入。

## Capabilities

### New Capabilities

- `shots-workbench`: 镜头表承载分镜字段与首帧/视频提示词、锚点校验、推画布与 Agent 拆镜（含同次产出提示词）。

### Modified Capabilities

- `workbench-shell`: 顶栏导航与集上下文不再含「提示词」视图；相关场景改为镜头表。
- `workbench-text-intake`: 导入入口与契约说明从「三工作台」调整为剧本 + 镜头表（镜头表可含提示词列）；`prompt-intake` 降级为镜头表上的部分列更新路径。
- `scene-blocking-3d`: 未保存草稿场景中的「提示词工作台」改为「镜头表」。
- `shot-video-prompt`: 手改/重生 `video_prompt` 的入口描述改为镜头表（行为不变）。

## Impact

- 前端：`App.tsx`、`ShotTable.tsx`、`PromptTable.tsx`（删除或内联）、`theme.css`。
- 技能/契约：`skills/shotlist/SKILL.md`、`src/skills/contracts.ts`、`src/agent/shotDraft.ts`、`ShotTable` `applyDraft`。
- Agent：`src/skills/registry.ts`、`workbenchChat` profiles、builtin actions、`verify-workbench-builtin-actions.mjs`。
- 导入：`IntakeDialog`、`shotlist-intake` 表头映射；`prompt-intake` 挂到镜头表导入预览。
- Spec/README/E2E 全链路更名与回归。
