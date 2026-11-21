# Proposal

## Why

分集剧本「导入剧本大纲」仍按 short-drama 场标题硬解析：任意不规范的 `##`、缺少时间/EP-SC、或仅有纯文本都会导致整份无法预览或 `script-v1` 阻塞确认。创作者往往先灌原料，再在创意工作室用 Agent 改结构；门口不应再当格式警察。

## What Changes

- 分集剧本导入对**任意非空文本**产出可合并的 `episodes` 草案（零门禁）；仅在空内容、读文件失败、体积上限、未选项目或落库失败时拒绝。
- 用**单通道宽松解析**替代 strict fail-fast：尽量按 `##`/`###` 切场；切不出则整篇归入建议集号的单一场次；`beats` 保持原文切片。
- 导入路径 **MUST NOT** 因 `script-v1` 校验或场次标题形态阻挡「确认导入」；缺 `slug/place/time/space` 由 normalize 填占位，推断明细可记录为 warnings，但不得禁用确认按钮。
- `detectFormat` 在 `intake: 'script'` 时：非空文本一律进入剧本 Markdown 解析，不再标 `free-text` 红字挡预览。
- 对话框接受 `.txt` 与 `.md`；占位符与帮助文案改为「先导入，规范格式可经 Agent 或再导出」。
- 内嵌分镜表仍忽略并提示走画布导入（范围不变）。
- **BREAKING（规格层）**：`workbench-text-intake` 中「分集剧本须 short-drama 场标题否则拒绝」类要求改为「尽力解析 + 兜底一场」。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `workbench-text-intake`：分集剧本 Markdown 导入改为零门禁解析、normalize 占位、预览与确认不受契约/格式失败阻挡。
- `script-workbench`：导入入口文案与空态/帮助语义对齐「宽进、Agent 后修」。

## Impact

- `src/intake/scriptMarkdown.ts`、`src/intake/format.ts`、`src/board/scriptIntake.ts`、`src/board/EpisodeScriptImportDialog.tsx`
- `tests/script-markdown-import.ts`（及现有验收脚本）
- `README.md` 导入章节（分集剧本不再强调必须先写 EP-SC 格式）
- 不改画布分镜导入、Agent `submit_episodes` 契约、short-drama Python 校验栈