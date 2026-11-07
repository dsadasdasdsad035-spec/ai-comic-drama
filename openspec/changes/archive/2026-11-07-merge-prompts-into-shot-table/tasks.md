# Tasks

## 1. 契约与技能

- [x] 1.1 在 `src/skills/contracts.ts` 的 `shotsV1` 镜对象增加可选 `keyframe_prompt` / `video_prompt`；跑 `node verify-apimart-tool-schemas.mjs` 确认 `submit_shots` schema 通过
- [x] 1.2 扩展 `skills/shotlist/SKILL.md`（并入 prompt A/B 规则、`read_characters`、`{{角色名}}`、两列必填）；bump version；`node verify-skills-unit.mjs` 通过
- [x] 1.3 更新 `tests/skill-prompts.ts` 或新增 shotlist 用例：`validateContract('shots-v1')` 接受含 prompts 的镜对象

## 2. 宿主写回

- [x] 2.1 `src/agent/shotDraft.ts` 的 `buildShotsFromModel` 映射两列提示词；`tests/drafts.ts` 覆盖透传
- [x] 2.2 `ShotTable.applyDraft`：合并后按角色表 `expandAnchors`，回执含未解析锚点计数；行为对齐 `mergePromptDraft` 非 partial 路径
- [x] 2.3 镜头表 textarea 编辑写入 `handEdited`（`keyframe_prompt` / `video_prompt`）；`mergeGenerated` 回归 `tests/drafts.ts` 或现有手改测试

## 3. UI 与导航

- [x] 3.1 从 `PromptTable` 迁入首帧/视频列、锚点指示、保存与推画布校验到 `ShotTable.tsx`；`theme.css` 样式合并
- [x] 3.2 `App.tsx` 移除 `view === 'prompts'`、顶栏按钮与 `PromptTable` 挂载；离开保护改检查镜头表提示词草稿
- [x] 3.3 删除或仅测试引用 `PromptTable.tsx`；`grep PromptTable` 无生产路径残留

## 4. Agent 与设置

- [x] 4.1 `workbenchChat` / `WORKBENCH_PROFILES`：移除 `prompts` surface；镜头表保留 `shotlist`；次路径仍可调 `prompt`+`submit_prompts`（文档化）
- [x] 4.2 移除提示词顶栏「生成提示词」与对应 builtin 一一对应；更新 `verify-workbench-builtin-actions.mjs`
- [x] 4.3 设置页：隐藏或标注 `prompt` 环节为辅助；README 环节表改为镜头表承担主生成

## 5. 导入与文档

- [x] 5.1 `IntakeDialog`：纯 `prompts-v1` / `prompt-intake` 从镜头表导入进入，预览走 `mergePromptDraft` partial；`node verify-text-intake.mjs` 通过
- [x] 5.2 更新 `README.md` 五工作台叙事、JSON 契约说明、内置动作表
- [x] 5.3 批量改 `verify-workbench-chats.mjs`、`verify-prompt-3d-workbench.mjs` 等脚本改从镜头表操作；本地 `APP_URL` 下主路径绿

## 6. 集成验收

- [x] 6.1 新增或扩展验收：mock `submit_shots` 含 prompts → 镜头表可见展开后文本 → 保存 → 推画布前空首帧仍被拦
- [x] 6.2 `openspec validate merge-prompts-into-shot-table --strict` 通过

## Workflow follow-up

- 实现完成后由用户执行 `/opsx-apply`，全部任务勾选后 `/opsx-archive` 同步主 spec。
