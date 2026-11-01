# Tasks

## 1. ScriptBoard UI

- [x] 1.1 在 `src/ScriptBoard.tsx` 移除 `sb-left`（原著、logline、「+ 加一集」）与顶栏「生成分集」按钮；删除仅顶栏使用的 `generate()` 调用路径；验证：剧本页 DOM 无 `.sb-left`、无顶栏「生成分集」按钮，分集列表占满主区域。
- [x] 1.2 更新空态与 `builtins`/`runGenerateEpisodes` 失败文案（不提左栏/顶栏拆集）；验证：无分集时空态引导 Agent；`source` 为空时内置动作禁用 reason 可读。
- [x] 1.3 更新文件头注释，反映「主区域分集 + Agent 生成」；验证：注释与界面一致。

## 2. 样式与周边文案

- [x] 2.1 在 `src/theme.css` 删除或注释未使用的 `.sb-left`、`.sb-source`、`.sb-logline`、`.sb-actions`（若全项目无引用）；验证：构建通过，剧本页布局正常。
- [x] 2.2 更新 `src/chat-ui/WorkbenchInspector.tsx` 剧本显式保存提示（「左侧点保存」→ 顶栏保存）；更新 `src/agent/workbenchChat.ts` 剧本 `emptyBody`（若仍引用顶栏拆集）；验证：打开剧本 Agent「查看将发送」/空态文案无顶栏拆集指引。
- [x] 2.3 更新 `README.md` 工作台内置动作说明：剧本拆集仅在聊天；验证：文档与 UI 一致。

## 3. 回归脚本

- [x] 3.1 修改 `verify-stage-models-ui.mjs`：不再依赖 `.sb-source` 与顶栏「生成分集」；用 API 预置 `source` 并在聊天触发拆集或仅验证环节模型选择器；验证：`node verify-stage-models-ui.mjs` 退出码 0。
- [x] 3.2 修改 `verify-workbench-builtin-actions.mjs`：移除顶栏「生成分集」一致性断言，保留聊天 builtin 与保存；验证：`node verify-workbench-builtin-actions.mjs` 退出码 0。
- [x] 3.3 运行 `node verify-script-chat.mjs` 与 `node verify-script-knobs.mjs`；若有失败则按新 UI 调整选择器/断言；验证：两者退出码 0。

## Workflow follow-up

- 归档本 change 后同步主 spec：`script-workbench`、`workbench-shell`、`project-context`。
- 若随后归档 `workbench-chat-builtin-actions`，在主 spec 或 README 中保留「剧本无顶栏拆集按钮」例外说明。
