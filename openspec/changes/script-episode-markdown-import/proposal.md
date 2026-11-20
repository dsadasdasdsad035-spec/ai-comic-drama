# Proposal

## Why

分集目录「导入剧本大纲」目前对大多数 Markdown 原稿只能走 `script-intake` 模型整理，与「创作者手里已有 short-drama 式 `剧本.md`、应原样进项目」不符，也与 `workbench-text-intake` 的零模型优先原则冲突。需要把 short-drama 场次标题语法定为分集剧本导入的硬约定，去掉该入口对模型的依赖。

## What Changes

- 分集剧本导入入口**仅接受** Markdown（`.md` / `.markdown` 与等价的粘贴文本）。
- 新增零模型解析：识别 `## EP001-SC001 内|外|内外 · 地点 · 时间` 场次标题，将场次正文整块映射为 `script-v1` 的 `beats`，不改写句子。
- 从集标题 `# EP001 集名`、场景 ID 中的 `EP`/`SC` 编号及导入上下文推断集号与场号；合并语义沿用 `planScriptImport` / `mergeScriptDraft`。
- **BREAKING**：分集剧本导入对话框不再接受 `.json` / `.txt`，不再展示「让模型整理」与对文本模型的硬依赖（`script-v1` JSON 仍可通过 Agent `submit_episodes` 写入）。
- 同一文件若内嵌分镜表：剧本路径优先解析场次，分镜表忽略并在预览中说明须用画布导入。
- `detectFormat` 在同时存在场标题与镜号表时，分集剧本流程 MUST NOT 误判为仅分镜表格而无法导入剧本。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `workbench-text-intake`：增加分集剧本 short-drama Markdown 零模型路径；收窄分集导入入口的文件形态与模型兜底行为。

## Impact

- `src/board/EpisodeScriptImportDialog.tsx`、`src/intake/format.ts`、新增 `src/intake/scriptMarkdown.ts`（或等价模块）、`src/board/scriptIntake.ts` 调用链。
- 单测：场次标题解析、多集/单集、校验失败、合体文件忽略分镜表。
- `README.md` 导入章节需与「剧本仅 Markdown」对齐。
- 可选后续：资料包导入在用户改判为「剧本」时复用同一解析器（本期可在 tasks 中单列，不阻塞对话框交付）。