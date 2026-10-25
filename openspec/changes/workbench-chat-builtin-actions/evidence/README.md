# 工作台聊天内置动作验收

日期：2026-10-24 · 环境：macOS · 临时 Vite server + 临时项目库（不写用户项目）

## 覆盖

`node verify-workbench-builtin-actions.mjs`（mock 文本模型，临时 server）：

- 纯函数：五个工作台动作清单、角色/素材本集+全剧范围、剧本全剧、镜头/提示词当前集、禁用原因、线程摘要、工具集没有 `run_builtin`。
- 镜头表：空态「拆镜」、缺 brief 禁用并可读原因、3000 字本地 brief 完整 inline 发送、动作回执、顶部按钮一致性、动作运行中聊天/顶部按钮禁用、取消不落半份、刷新后回执仍在、动作结果可保存。
- 剧本：空态「生成分集/重新生成分集」、全剧范围回执、顶部按钮一致性、显式保存到项目。
- 角色：本地未保存的新角色参与合并、全剧范围回执、约 1 秒自动落库、顶部按钮一致性。
- 素材：全剧范围回执、立即落库、顶部按钮一致性。
- 提示词：每批 3 镜的两批并行、顶部按钮一致性、显式保存、取消后提示词保持原样。
- 项目隔离：A/B 项目各运行一次拆镜，切换后回执不串。

真实模型路径 `node verify-skills-real.mjs`：剧本/角色/素材/镜头/提示词五阶段全部通过（MiniMax M3；镜头 3s、提示词 4s 的真实调用与内置动作共用同一技能与 `callText` 路径）。

真实模型 UI smoke `node verify-workbench-builtin-real.mjs`（临时 server + 真实设置，不写用户项目）：

- 从镜头表聊天点「拆镜」：MiniMax M3 真实调用，21.1s 拆出 16 镜；顶部按钮再次运行不新增聊天回执。
- 从提示词聊天点「生成提示词」：MiniMax M3 真实调用，11.7s 补全 2 镜（1/1 批）；顶部按钮再次运行不新增聊天回执。
- 截图：`builtin-actions-real-shots.png`、`builtin-actions-real-prompts.png`。

回归：`verify-workbench-chats.mjs`、`verify-script-chat.mjs`、`verify-project-scope.mjs`、`verify-agent-graph.mjs` 全部通过。现有测试里两个只读技能下拉和「从本集/从全剧拆角色」按钮按新 UI 收紧了选择器（新增了内置动作按钮/下拉），行为断言未改。

## 截图

- `builtin-actions-shots.png`：镜头表动作回执、保存语义、6 镜结果。
- `builtin-actions-script.png`：剧本全剧动作与 2 集草稿。
- `builtin-actions-characters.png`：角色全剧动作，林岚 + 陈默 + 本地新角色。
- `builtin-actions-assets.png`：素材全剧动作，雨夜街口立即落库。
- `builtin-actions-prompts.png`：提示词动作、两批回执与取消回执。
- `builtin-actions-isolation.png`：切回 A 项目后的镜头回执（B 项目回执未串入）。
- `builtin-actions-real-shots.png`：真实模型从聊天拆镜（MiniMax M3，16 镜 / 21.1s）。
- `builtin-actions-real-prompts.png`：真实模型从聊天生成提示词（MiniMax M3，2 镜 / 1 批 / 11.7s）。

## 结论

- 内置动作由用户点击触发，走工作台宿主函数；不是模型工具，不占聊天轮次/步骤/总时长，也不在 agent 循环里嵌套模型调用。
- 动作使用完整 inline 输入与本地草稿（3000 字 brief 未走 2000 字引用；本地未保存角色参与合并），与顶部按钮共用同一合并/保存语义。
- 运行中可取消且不写半份草稿；同一工作台动作/聊天发送互斥；A/B 项目线程隔离。
- 回执随线程持久化，下一轮模型只看到摘要（纯函数断言），不重放整份产物。

## 复跑

```bash
node verify-workbench-builtin-actions.mjs
node verify-workbench-builtin-real.mjs
node verify-skills-real.mjs
node verify-workbench-chats.mjs
node verify-script-chat.mjs
node verify-project-scope.mjs
node verify-agent-graph.mjs
```
