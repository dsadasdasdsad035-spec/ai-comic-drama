# Proposal

## Why

剧本、镜头表、提示词三个文本环节目前只有两条入口：让大模型生成，或在表格里逐格手敲。用户手上已经写好的剧本、分镜表、提示词没有入口——要么先喂给模型重写一遍（费钱、等待、还会改写原意），要么一格格复制。而这三个环节的落库、契约校验与合并函数其实都已经具备，缺的只是「把已有文本变成契约形状」这一层。

## What Changes

- 剧本页、镜头表、提示词页各增加「导入」入口，支持**上传文件**与**粘贴文本**两种方式；导入是人的动作，产出的内容与手改同源。
- 三级解析，按成本从低到高：
  1. **JSON 直通**：文件本身就是目标契约（`script-v1` / `shots-v1` / `prompts-v1`）→ 直接校验，不过模型。
  2. **表格映射**：Markdown / CSV / TSV，按表头别名映射到字段（镜号 / 秒 / 景别 / 运镜 / 描述 / 台词 / 首帧 / 视频）→ 不过模型。
  3. **模型整理**：认不出的自由文本（一份手写剧本、一段散文式分镜）→ 用户点「让模型整理」才发请求。
- 新增三个 intake 技能：`script-intake`、`shotlist-intake`、`prompt-intake`。它们只做**结构整理**（切场、切镜、拆台词），不新增情节、不改写字句、不补用户没写的内容。技能的 `stage` 指向目标环节（`script` / `shot` / `prompt`），复用设置页已有的环节模型，不新增环节、不新增模型配置。
- 导入**先预览后应用**：显示新增 N / 更新 N / 保留 N / 跳过 N，以及场次回退、未匹配镜号这类需要人判断的项。
- 导入采用 **merge 语义**：只改文件里出现的行、只改文件里给了值的列，其余一律保留。**BREAKING** 相对现有 `applyDraft` 的整集替换行为，聊天仍走 replace。
- 修正手改保护的两个缺口：提示词表编辑标记 `handEdited`；导入写入的字段在后续「生成」时受手改保护，不再被静默覆盖。
- 不做：docx / pdf 解析、云端文档拉取、扫描件 OCR、多文件批量导入。

## Capabilities

### New Capabilities

- `workbench-text-intake`: 已有文本进入三个文本工作台的格式识别、解析优先级、模型整理边界、合并语义、预览与手改保护。

### Modified Capabilities

（无。三个目标环节现有的 `scripts-v1` / `shots-v1` / `prompts-v1` 契约不变，本变更只是新增了「从文件得到契约形状」的入口。）

## Impact

- 前端新增 `src/intake/`：格式识别、表格表头映射、CSV/TSV 解析、差异预览、导入对话框。
- 前端改动：`src/ScriptBoard.tsx`、`src/ShotTable.tsx`、`src/PromptTable.tsx` 增加导入入口并给 `applyDraft` 传 `mode`；`src/agent/drafts.ts`、`src/agent/shotDraft.ts`、`src/agent/promptDraft.ts` 增加 merge 模式分支；`src/skills/registry.ts` 注册三个新技能。
- 新增 `skills/script-intake/SKILL.md`、`skills/shotlist-intake/SKILL.md`、`skills/prompt-intake/SKILL.md`；技能前端挂载表 `src/skills/registry.ts` 的内置文本映射同步补齐。
- 不改服务端：`/api/project` 的写入语义、`/api/text` 的请求形状、`/api/skills` 的技能读取都不用动。
- 不改数据结构：`ProjectEpisode` / `ProjectShot` 的字段集合不变；`handEdited` 字段已存在，只是被更多写入路径使用。
- 新增验收脚本 `verify-text-intake.mjs`，覆盖格式识别、表头映射、merge 语义、场次回退计数与手改保护。
