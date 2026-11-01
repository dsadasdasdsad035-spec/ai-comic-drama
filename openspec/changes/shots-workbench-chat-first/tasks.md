# Tasks

## 1. 镜头表 UI 与状态

- [x] 1.1 在 `ShotTable.tsx` 移除 `brief` 状态、切集自动填充、`generate()`/`.wb-gen` DOM 及顶栏拆镜相关禁用逻辑；保留表格编辑与保存，并通过打开页面确认无梗概条与拆镜按钮
- [x] 1.2 删除或清理 `theme.css` 中仅被 `.wb-gen` 使用的样式，并确认镜头表布局无多余空白
- [x] 1.3 更新空态与 `WORKBENCH_PROFILES.shots`（`workbenchChat.ts`）文案，使其只指向 Agent，运行应用打开空集镜头表核对文案

## 2. Agent 与产镜路径

- [x] 2.1 从 shots `chatAdapter.builtins` 移除 `split_shots`；调整 `inputs()` 使任务卡仍含画风/画幅/目标时长与本集摘要（由 `episodes` 推导，无页内编辑框），并确认 Inspector 标签合理
- [x] 2.2 为 `useWorkbenchChatOpen('shots')` 实现宽屏首次默认展开（尊重用户已记忆的 localStorage），打开镜头表在 ≥1440px 下验证 Agent 默认可见
- [x] 2.3 确认 SkillChat 在 agent 运行中「清空对话」仍会 abort 且不落半份镜头草稿（手动或现有 `verify-workbench-chat-clear.mjs` 镜头表场景）

## 3. 剧本跳转与导航

- [x] 3.1 在 `App.tsx`/`ScriptBoard.tsx` 将「拆这一集 →」改为切换至镜头表、设置集号并 `setChatOpen(true)`；从剧本点击后验证 Agent 可输入且集号正确

## 4. 回归与文档

- [x] 4.1 更新 `verify-workbench-builtin-actions.mjs`（及涉及的 `verify-workbench-builtin-real.mjs` 镜头表段）：断言无顶栏/内置拆镜，改经聊天产镜或 mock 路径，脚本退出码 0
- [x] 4.2 更新 `README.md` 工作台内置动作说明：镜头表拆镜仅在 Agent 对话/工具链，不再与顶栏按钮对应
- [x] 4.3 运行 `openspec validate shots-workbench-chat-first --strict` 与相关现有 verify（至少 `node verify-workbench-chats.mjs`）确认无回归
