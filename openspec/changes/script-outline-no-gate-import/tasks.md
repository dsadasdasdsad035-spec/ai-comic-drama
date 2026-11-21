# Tasks

## 1. 解析与格式识别

- [x] 1.1 在 `src/intake/scriptMarkdown.ts` 实现宽松场切分与无场兜底，非空输入返回 `ok: true`（仅空内容 `ok: false`）；验证：`node --import tsx tests/script-markdown-import.ts` 含新杂稿用例全绿。
- [x] 1.2 `src/intake/format.ts` 在 `intake: 'script'` 时对非空文本一律识别为剧本文本；验证：杂稿 `detectFormat(..., { intake: 'script' })` 不再为 `free-text`。
- [x] 1.3 在 `src/board/scriptIntake.ts` 增加导入专用 normalize（占位 slug/place/time），不因 `validateContract` 挡预览；验证：畸形解析产物可 `planScriptImport` 且无 throw。

## 2. 导入对话框与剧本视图文案

- [x] 2.1 更新 `EpisodeScriptImportDialog`：接受 `.txt`、去掉契约 `blocked` 禁用确认、placeholder/帮助对齐宽进；验证：本地粘贴无场标题文本可点「确认导入」（写盘可走 mock 或集成测）。
- [x] 2.2 更新剧本空态与 hub 文案（`ScriptEpisodeHub` 等）：不再强制 short-drama 先行；验证：UI 文案与 spec「空态」场景一致。

## 3. 测试与文档

- [x] 3.1 扩展 `tests/script-markdown-import.ts`：纯文本单场、畸形 `##`、严格样本回归、合体忽略分镜表；验证：`node --import tsx tests/script-markdown-import.ts`。
- [x] 3.2 更新 `README.md` 分集剧本导入节：宽进 + Agent 后修 + 推荐 short-drama 为导出格式；验证：段落与 `workbench-text-intake` delta 一致。