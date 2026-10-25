# Tasks

## 1. 宿主动作契约与一键函数收敛

- [x] 1.1 在 `src/agent/workbenchChat.ts` 增加 `BuiltinAction` / `BuiltinResult` 与 adapter 的可选 `builtins`；验证：`npm run build` 通过，未提供 `builtins` 的工作台聊天行为与改动前一致。
- [x] 1.2 把 `ScriptBoard.generate` 收敛为接受 `AbortSignal`、返回 `BuiltinResult` 的宿主函数；顶部按钮和 `builtins` 共用它；验证：按钮仍替换分集草稿，聊天动作返回集数/新增更新摘要。
- [x] 1.3 把 `App.extractCharacters` 收敛为共享宿主回调（返回结果 + 信号），经 `CharacterBoard` 同时供按钮和 adapter 使用；验证：两条路径都经过 `mergeCharacters`，手改锚点保留，自动落库语义不变。
- [x] 1.4 把 `AssetBoard.extract` 的本集/全剧两条路径收敛为返回结果 + 信号的宿主函数；验证：按钮与动作都立即 `patchProject`，同名合并与关联镜号并集一致。
- [x] 1.5 把 `ShotTable.generate` 收敛为返回结果 + 信号的宿主函数，继续使用本地 `brief` 的 inline 输入；验证：按钮与动作产出相同镜号/数量，`mergeGenerated` 手改保护一致。
- [x] 1.6 把 `PromptTable.generate` 的分批并行收敛为返回结果 + 信号；取消时所有批次结果丢弃，不合并半份提示词；验证：成功返回 filled/unresolved/failed，取消后镜头表保持原样。
- [x] 1.7 五个 adapter 暴露 `builtins`：剧本生成分集、角色本集/全剧、素材本集/全剧、镜头表拆镜、提示词生成；补齐 label、scope、disabled/reason；验证：纯函数用例断言五个工作台的动作清单、范围与禁用原因。

## 2. 聊天动作 UI、回执与互斥

- [x] 2.1 在聊天消息模型增加 `builtin` part，并在 `stageToolUis.tsx` 渲染动作卡（动作/范围/摘要/数量/模型/耗时/保存语义）；验证：动作完成后卡片出现，不显示原始 JSON。
- [x] 2.2 在 `WorkbenchEmpty` 渲染内置动作按钮，并在首轮后保留头部紧凑入口；把空态“用上方的…”文案改为指向聊天动作；验证：五个工作台空态都显示对应动作，顶部按钮仍在。
- [x] 2.3 实现忙碌/互斥状态：动作运行中禁用聊天发送、顶部按钮和其他动作；聊天 agent 运行中禁用动作；验证：Playwright 覆盖两个方向的禁用。
- [x] 2.4 动作运行中显示取消；取消中止底层请求且不 merge/save；验证：单次拆镜与分批提示词取消后草稿保持动作前版本，任务台账显示已取消。
- [x] 2.5 把 `builtin` 回执写入线程并持久化；下一轮 `threadTranscript` 只带摘要；验证：关闭/重开线程回执仍在，下一次模型请求不包含整份产物。
- [x] 2.6 为五个工作台做“按钮 vs 聊天动作”一致性测试：相同输入产生相同合并结果、数量、手改保护与契约错误；验证：mock 文本响应的单元/Playwright 用例全部通过。
- [x] 2.7 覆盖范围语义：角色/素材本集与全剧、剧本全剧、镜头表/提示词当前集；验证：全剧动作的输入规模与结果摘要写明范围，单集动作不受其他集影响。
- [x] 2.8 大输入与本地草稿：构造 3000 字本地 `brief`，断言 `/api/text` 请求体包含完整 `brief`；未保存角色/素材按本地状态合并；验证：请求体断言与合并结果用例。
- [x] 2.9 守住模型边界：工具列表没有 `run_builtin`；只读技能不能运行内置动作；3D 工作台聊天工具与验收流程不变；验证：工具集断言、只读技能用例、现有 3D 测试。
- [x] 2.10 更新 README 的工作台聊天章节：内置动作、范围、保存语义、取消、动作与聊天发送互斥、不跨工作台；验证：按文档逐条手动操作可完成从零生成与改稿。

## 3. 集成与验收

- [x] 3.1 新增 `verify-workbench-builtin-actions.mjs`（或扩展现有 `verify-workbench-chats.mjs`），覆盖动作清单、按钮/聊天一致性、范围、取消、回执持久化、模型边界；验证：脚本退出码 0。
- [x] 3.2 回归现有工作台聊天与 3D：运行 `verify-workbench-chats.mjs`、`verify-script-chat.mjs`、相关 `verify-agent-*.mjs`、`verify-project-scope.mjs`；验证：全部通过。
- [x] 3.3 真实模型 smoke：至少从聊天运行一次拆镜和一次生成提示词，与顶部按钮结果对比；验证：镜号/数量一致，记录模型与耗时。
- [x] 3.4 完整手工流程：剧本生成分集 → 角色本集/全剧拆 → 素材本集/全剧拆 → 镜头表拆镜 → 提示词生成，全程从聊天入口触发并完成保存；验证：产物正确、线程回执可重开，截图/记录写入 `evidence/`。
- [x] 3.5 项目隔离与线程恢复：A/B 项目各运行一次动作，切换后回执与草稿不串；验证：Playwright 项目隔离用例通过。

## Workflow follow-up

- 实施前先完成/归档 `skill-driven-workbench-chats`（当前 39/40），确认主规格 `workbench-chat` 已同步；本变更会改同一批聊天文件，避免两个 apply 同时进行。
- 评审通过后同步 `workbench-chat-actions` 规格，再归档本变更。
- 本变更不自动实现；实现从 `/opsx:apply` 开始。
