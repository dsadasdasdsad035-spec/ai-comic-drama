# Tasks

## 1. 聊天页签生命周期

- [x] 1.1 修改 `SceneCodeWorkbench` 侧栏，让聊天和代码两个 pane 同时挂载，仅切换可见性/`hidden`/`aria-hidden`；验证：两个 pane 都在 DOM 中，非活动 pane 不可交互且不参与布局。
- [x] 1.2 调整 `SceneAgentChat` 的卸载清理边界：只有工作台关闭或真正卸载时才 abort/dispose，页签切换不触发清理；验证：运行中切到代码页签后 agent 仍完成，切回聊天能看到新事件。
- [x] 1.3 为 `verify-agent-chat-ui.mjs` 增加页签切换用例：已完成消息/工具卡/帧/清单保留，滚动位置保留；验证：切换前后 DOM 内容和 scrollTop 一致。
- [x] 1.4 为同一条用例增加运行中切换：使用延迟 mock 发送后切到代码页签，确认 `data-running` 仍为运行中且最终完成；验证：agent 不被取消，代码页签可正常查看。

## 2. streamEvents 事件桥

- [x] 2.1 扩展 `sceneAgentTypes.ts`：增加模型轮次事件和 step message part 类型；验证：`npx tsc --noEmit` 通过。
- [x] 2.2 在 `sceneAgentEvents.ts` 实现有状态事件桥：模型 start/end、工具 start/end/error、chain error，按 run id/轮次去重并裁剪内容；验证：Node 单测覆盖事件顺序、模型说明、空说明、工具错误、未知事件和去重。
- [x] 2.3 将 `runSceneAgent` 从 `graph.invoke()` 改为消费 `graph.streamEvents(..., { version: 'v2', signal, recursionLimit })`；工具节点把 LangGraph `config` 传给 `tool.invoke`；验证：mock 图仍完成 finish，事件顺序和最终 session 结果不变。
- [x] 2.4 移除 `toolsNode` 手动 `tool_start/tool_end`，保留 `code/frames/review/done` 领域事件；验证：图测试中每个工具只出现一张开始/结束卡，领域结果仍能更新对应结果。
- [x] 2.5 在事件桥中过滤 reasoning/系统提示，只提取模型面向用户的 content，并去掉工具参数中的完整代码和 data URL；验证：单测断言 reasoning 字段、完整 code、base64 不进入事件。
- [x] 2.6 在 `SceneAgentChat` 渲染 step part：同一轮 start/end 更新同一条轮次，工具卡保持原顺序；验证：Playwright 断言“模型说明 → 工具卡 → 下一轮”顺序和空 content 轮次仍可见。
- [x] 2.7 更新 `verify-agent-graph.mjs` 的事件测试覆盖 streamEvents 模型轮次、工具去重、错误/取消和隐藏推理；验证：脚本全部通过。
- [x] 2.8 更新 `verify-agent-chat-failure.mjs`：模型 500、运行中取消和取消后输入在 streamEvents 下行为一致；验证：失败保留旧代码，取消显示已取消且保留轨迹。

## 3. 集成与文档

- [x] 3.1 更新 `README.md` 的 agent 聊天说明：页签切换保留范围（仅当前工作台）、模型轮次/执行事件、`streamEvents` 边界、不展示 CoT、无 token 级流式；验证：命令和描述与实现一致。
- [x] 3.2 运行 `npm run build`、`npx tsc --noEmit`，确认主应用和 agent chunk 构建通过。
- [x] 3.3 运行 `verify-agent-chat-ui.mjs`、`verify-agent-graph.mjs`、`verify-agent-chat-failure.mjs`，确认页签、事件、失败取消全部通过。
- [x] 3.4 回归 `verify-code-workbench.mjs`、`verify-code-sandbox.mjs`、`verify-theme.mjs`，确认旧代码工作台、沙箱和主题无回归。
- [x] 3.5 若本机有可用的真实代码模型，跑一次 `AGENT_REAL=1 APP_URL=http://127.0.0.1:5280 node verify-agent-3d-duel.mjs`，确认 streamEvents 下真实模型仍能生成并保存证据；不可用时记录明确原因。

## Workflow follow-up

- 归档前确认所有任务完成、主 specs 已同步，再执行 archive。
