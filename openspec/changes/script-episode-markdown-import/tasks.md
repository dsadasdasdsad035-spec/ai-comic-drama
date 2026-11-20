# Tasks

## 1. 解析与格式识别

- [x] 1.1 新增 `src/intake/scriptMarkdown.ts`：移植 short-drama 场标题正则，实现 `parseScriptMarkdown`（集/场/beats/警告）；验证：`node --import tsx tests/script-markdown-import.ts` 全绿（新建用例）。
- [x] 1.2 在 `src/intake/format.ts` 增加 `script-markdown` 形态：存在合法场标题时优先于分镜表判定；验证：同文件用例 `detectFormat` 返回 `script-markdown`。
- [x] 1.3 为解析失败、多集 EP 前缀、合体文件忽略分镜表补充 `tests/script-markdown-import.ts` 用例并跑绿。

## 2. 分集导入对话框

- [x] 2.1 改造 `EpisodeScriptImportDialog`：仅 `.md`/`.markdown`、接入 `parseScriptMarkdown` + `planScriptImport`；移除 JSON/模型整理 UI 与 `runIntake` 依赖；验证：手测粘贴示例 `剧本.md` 可直接预览并确认导入。
- [x] 2.2 预览展示 `warnings`（如已忽略分镜表）；契约校验失败时展示错误、禁用确认；验证：故意坏标题时无法点「确认导入」。
- [x] 2.3 更新 `README.md`「导入已有文本」：分集剧本仅 Markdown + 场标题格式说明；验证：文案与规格一致。

## 3. 回归

- [x] 3.1 跑既有 intake 相关单测（含 `tests/studio-*` 若触及 format）；验证：`npm run test:unit` 或仓库文档中的 verify 脚本无新增失败。
- [x] 3.2 画布 `IntakeDialog` 手测：分镜 md 仍走表格零模型，不被 `script-markdown` 破坏；验证：导出分镜 md 回灌预览正常。

## Workflow follow-up

- 规格归档后同步主 spec `openspec/specs/workbench-text-intake/spec.md`。