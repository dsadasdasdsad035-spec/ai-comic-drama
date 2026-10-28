# Tasks

## 1. 解析层与验收骨架

- [x] 1.1 新建 `src/intake/format.ts`：识别输入是 JSON / Markdown 表格 / CSV / TSV / 自由文本，返回 `{ kind, reason }`；建立 `verify-text-intake.mjs` 骨架（断言工具 + 该文件的分段入口）。运行 `node verify-text-intake.mjs`，确认三种表格与自由文本各被识别为预期 kind，空输入返回明确 reason。
- [x] 1.2 在 `src/intake/format.ts` 增加 CSV/TSV 分列（支持引号包裹与逗号/制表符混排）与 Markdown 表格切行；在 `verify-text-intake.mjs` 增加分段，覆盖带引号含逗号的单元格、空单元格与首尾空行。
- [x] 1.3 新建 `src/intake/tableMap.ts`：中英文表头别名表（`镜头`/`镜号`、`时间`/`秒`、`景别`/`景别机位`、`运镜`、`画面与动作`/`描述`、`台词`/`台词声音`/`旁白声音`、`首帧`、`视频` 及英文对应）、列名归一化、必需列（镜号）检查、被忽略列的收集（如「制作方式」）；在 `verify-text-intake.mjs` 覆盖中文表头、英文表头、缺镜号列（拒绝）、多余列（记入 ignored）。
- [x] 1.4 新建 `src/intake/normalize.ts` 三个纯函数并在 `verify-text-intake.mjs` 逐段验证：
      `parseDuration` 覆盖 `00-05`、`0–5秒`、`5—11 秒`（三种破折号）、纯秒数 `6`、无法解析返回 null；
      `normalizeSize` 覆盖 `中景`（直通）、`极近景，猫眼`→大特写、`低机位远景`→远景+机位、`中近景`→近景、`猫咪主观镜头`→未识别保留原文；
      `splitDialogueCell` 覆盖 `旁白：…`、`雨声、远处车声。`（无台词）、`脚步声停止。人类轻声：小火伴…`（拆两段）、`音乐由紧张转柔和`。
- [x] 1.5 新建 `src/intake/diff.ts`：给定当前行集合与导入行集合，产出 `{ added, updated, kept, skipped, scenesFallback, defaultsFilled, ignoredColumns, unparsed }` 与「本次涉及/该集共」计数；在 `verify-text-intake.mjs` 覆盖全新增、部分重叠、全部重叠、镜号重复（计入 skipped 并给原因）、缺运镜列（defaultsFilled 计数）。

## 2. 合并语义（merge / replace）

- [x] 2.1 给 `src/agent/drafts.ts` 的 `mergeScriptDraft` 增加 `mode` 参数：`replace` 保持现有行为，`merge` 只改文件里出现的集；在 `verify-text-intake.mjs` 覆盖「只导入第 2 集时其他集不变」与「两模式结果差异」。
- [x] 2.2 给 `src/shotSync.ts` 增加 `mergeShotsDraft(cur, generated, epNo, mode)`：`replace` 调现有 `mergeGenerated`，`merge` 以镜号为准只改出现的行并保留 `handEdited` 保护；在 `verify-text-intake.mjs` 覆盖「20 镜导入 3 镜后仍为 20 镜」与「手改字段不被覆盖」。
- [x] 2.3 给 `src/agent/promptDraft.ts` 的 `mergePromptDraft` 增加「只写给了值的列」分支：首帧为空时不写 `keyframe_prompt`，视频为空时不写 `video_prompt`；在 `verify-text-intake.mjs` 覆盖单列导入后另一列保持原值。
- [x] 2.4 在 `src/agent/shotDraft.ts` 增加 `buildShotsFromImport(got, episodes, epNo)`：复用 `buildShotsFromModel` 的字段映射，但对有台词角色缺表演条目时自动补 `{ emotion: 'neutral', intensity: 3, speaks: true }` 并返回 `filledPerformance` 计数；`buildShotsFromModel` 的抛错行为保持不变。在 `verify-text-intake.mjs` 覆盖「缺表演可导入且计数正确」与「聊天路径仍抛错」。

## 3. 三个 intake 技能

- [x] 3.1 新增 `skills/script-intake/SKILL.md`：`stage: script`、`runtime: json-tools`、`output: script-v1`、`inputs: [raw]`；正文写死「只做结构切分与字段归位，不改写句子、不新增情节、不补写空缺」。在 `src/skills/registry.ts` 的 `BUILTIN_TEXTS` 挂载该文件。运行 `node verify-skills-unit.mjs` 与 `node verify-skills-api.mjs`，确认技能可解析、`/api/skills` 能返回、设置页可见。
- [x] 3.2 新增 `skills/shotlist-intake/SKILL.md`：`stage: shot`、`output: shots-v1`、`inputs: [raw, style, aspect]`；正文要求按镜切分并只填原文有依据的字段，缺表演不编造。在 `verify-skills-unit.mjs` 增加该技能的 frontmatter 与占位符校验段。
- [x] 3.3 新增 `skills/prompt-intake/SKILL.md`：`stage: prompt`、`output: prompts-v1`、`inputs: [raw, style]`；正文要求按镜号归位两列提示词，只有一列时只输出该列。在 `verify-skills-unit.mjs` 增加校验段，并确认三个 intake 技能的 `stage` 分别解析到 `script` / `shot` / `prompt` 的环节模型。
- [x] 3.4 在 `src/intake/intakeSkill.ts` 实现「整理一次」的调用：按目标环节选技能与模型（复用 `stageModelKey`）、`callText` + `json: true`、`assertSkillOutput` 校验、超长文本按「第 N 集 / 第 N 场 / 场景 N」标记切块并逐块校验后合并。在 `verify-text-intake.mjs` 用 mock fetch 覆盖：契约不通过时报错且不返回草稿、含集标记的长文被切块、无标记的长文被拒绝。

## 4. 导入对话框与三个入口

- [x] 4.1 新建 `src/intake/IntakeDialog.tsx`：上传/粘贴切换、格式识别结果、零模型路径的即时预览、无法识别时的「让模型整理」按钮（显示将用的模型）、diff 预览（新增/更新/保留/跳过/场次回退/忽略列）、应用与取消。用 `audit-ui.mjs` 的既有方式做 DOM 断言，确认无项目时入口禁用、预览前不改数据、取消后脏状态不变。
- [x] 4.2 在 `src/ScriptBoard.tsx` 接入导入：`applyDraft` 增加 `mode` 入参并透传 `mergeScriptDraft`；导入后 `setDirty(true)` 但不自动保存。运行 `node verify-script-knobs.mjs`，并新增断言确认「导入第 2 集后第 1、3 集不变」。
- [x] 4.3 在 `src/ShotTable.tsx` 接入导入：`applyDraft` 透传 `mode`，默认 `merge`，提供「按此文件替换整集」勾选；导入提交前必须合出全集（含其他集）再保存，避免 `mergeShots` 把缺席镜头标 orphan。在 `verify-project.mjs` 增加段：导入 3 镜后 `project.json` 的该集仍为原镜头数，其他集不受影响。
- [x] 4.3b 确认导入产生的旁白不进入 `cast`：用真实资料包里的第 1 集分镜表（10 镜、含旁白与纯音效行）做端到端导入，断言该集 `cast` 不含「旁白」、纯音效镜头的 `dialogue` 为空、混合单元格被拆成两条。把这份表存为 `fixtures/intake-cat-ep01.md` 供回归使用。
- [x] 4.4 在 `src/PromptTable.tsx` 接入导入；同时修改 `edit()` 在改字段时加入 `handEdited`。运行 `node verify-video-prompt.mjs` 与 `node verify-script-knobs.mjs`，并新增断言确认「导入后调用生成不覆盖已导入的首帧提示词」。

## 5. 集成与回归

- [x] 5.1 运行 `npx tsc --noEmit` 与 `npm run build`，确认类型与构建通过；修复新代码引入的类型问题。
- [x] 5.2 运行 `node verify-all.mjs`。新增 `verify-text-intake` / `verify-text-intake-ui` 全绿；`applyDraft` 新增可选参数向后兼容，未破坏既有调用。全量跑相对基线无新增失败。
- [x] 5.3 端到端手工验证一条完整链路：粘贴 Excel 复制的镜头表 → 预览显示新增/更新 → 应用 → 保存 → 刷新后仍在；再验证「让模型整理」一份手写剧本，确认预览中的原文措辞未被改写。
- [x] 5.4 在 `README.md` 的流水线说明处补一段「导入已有文本」的用法与两种语义（merge / 替换整集），并说明 docx/pdf 不支持。
