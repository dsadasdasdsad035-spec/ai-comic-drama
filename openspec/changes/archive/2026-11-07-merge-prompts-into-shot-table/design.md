# Design

## Context

详见 proposal.md。当前 `submit_shots` → `buildShotsFromModel` 丢弃提示词列；提示词在 `PromptTable` 经 `submit_prompts` + `mergePromptDraft` + `expandAnchors` 写回。3D 已独立顶栏，提示词 Tab 仅剩文本提示词编辑与批量生成。

## Goals / Non-Goals

**Goals:**

- 单次 `shotlist` 提交写入结构字段与两列提示词。
- 镜头表 UI 含首帧/视频编辑、锚点状态、推画布前校验。
- 契约分层：schema optional、聊天技能 mandatory、导入 partial 与现 `mergePromptDraft` 一致。
- 保留 `prompt` 技能作次路径，不占导航。

**Non-Goals:**

- 删除 `prompts-v1` 或合并 intake 技能文件到单文件（可后续归档）。
- 改 Seedance 拼装、`shot-video-prompt` 自动正文字段语义。
- 强制旧项目批量回填提示词。

## Decisions

### 1. 扩 `shots-v1` 而非新建 `shots-v2`

在现有 `shotsV1` 镜对象上增加 `keyframe_prompt`、`video_prompt` 为 `z.string().min(1).optional()`。工具 schema 随 `getContractSchema` 自动变宽；旧 payload 仍校验通过。

**备选**：`shots-v2` 必填 prompts — 否决：阻塞 JSON 直通与只导结构列。

### 2. 聊天路径：技能正文强制两列，宿主展开锚点

`ShotTable.applyDraft` 在 `buildShotsFromModel` 之后对每镜首帧跑 `expandAnchors`（需项目角色表）；汇总 `hasUnresolvedAnchor` 写入回执 summary。与 `mergePromptDraft` 非 partial 分支一致。

`buildShotsFromModel` 增加对两列的透传（trim 后写入 `ProjectShot`）。

**备选**：拆镜后自动再调 `prompt` 技能 — 用户已选 B，否决。

### 3. `shotlist` 工具集与指令合并

- `tools` 增加 `read_characters`（与 `prompt` 对齐）。
- SKILL 正文并入 `skills/prompt/SKILL.md` 的 A/B、词汇表、`{{角色名}}` 规则；任务段说明拆镜同时写两列。
- `version` bump；`tests/skill-prompts.ts` / 新 `skill-shotlist-prompts` 探针覆盖契约含 prompts。

### 4. UI：吸收 `PromptTable` 子集

- 列：首帧/视频（textarea 或折叠区）、锚点指示；顶栏去掉提示词批量生成，保留「生成到画布」。
- 删除 `view === 'prompts'`；`schedule3dEditorDirty` 等离开保护检查镜头表未保存草稿（含提示词列）。
- 聊天 `surface` 仅 `shots`；删除 `prompts` 线程键与 `WORKBENCH_PROFILES.prompts`。

### 5. 次路径：只刷提示词

镜头表 Agent 仍可绑定 `prompt` 技能（显式用户指令或未来内置「只重写提示词」）：`submit_prompts` → `mergePromptDraft`，不经过 `mergeGenerated` 的结构字段替换。

设置页保留 `prompt` stage 模型供该路径与 `prompt-intake`。

### 6. 导入

- 镜头表导入：表头已有「首帧提示词/视频提示词」映射（`workbench-text-intake` 已支持列别名），合并 UI 后预览写回同一 `ProjectShot`。
- 纯提示词文件：`prompt-intake` 在镜头表「导入」中选环节或自动识别 `prompts-v1` JSON，走 `mergePromptDraft` partial。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 单次输出过大截断 | 技能限制镜数；任务台账支持分段 submit + merge（已有全集 replace 语义） |
| 模型漏 prompts 列 | 契约校验可选不拦；回执标明缺列镜号；验收探针 |
| 删 Tab 破坏 E2E | 批量改 verify 脚本；保留 `data-surface=shots` 选器 |
| `handEdited` 与重拆 | 两列加入手改标记；`clearHandEdited` 恢复模型 |

## Migration Plan

1. 扩契约 + shotDraft + applyDraft（后端/宿主可无 UI 先行）。
2. 更 shotlist SKILL；跑契约/Apimart schema 脚本。
3. 合并 ShotTable UI；删顶栏 Tab。
4. 更 README 与 verify；归档 change 同步主 spec。

回滚：恢复 `PromptTable` 与旧导航；契约 optional 字段对旧代码无害。

## Open Questions

- 镜头表列默认是否折叠「提示词」区（仅 UX，spec 不写死）。
