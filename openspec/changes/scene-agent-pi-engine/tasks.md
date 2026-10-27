# Tasks

## 1. 依赖与浏览器打包验证

- [x] 1.1 在 `package.json` 加入精确版本 `"@earendil-works/pi-agent-core": "1.4.0"` 并安装；验证 `package-lock.json` 记录的是精确版本、`npm ls @earendil-works/pi-agent-core` 无 peer 冲突
- [x] 1.2 建一个不接生产路径的临时入口，用 esbuild/Vite 以 `platform: browser` 打包 `Agent`；验证产物中不出现 `node:` 内建、`process`、`Buffer`
- [x] 1.3 在临时入口用假 `streamFn` 跑通一次「模型返回一个工具调用 → 工具执行 → 第二轮结束」；验证事件顺序为 `agent_start → turn_start → message_* → tool_execution_start/end → turn_end → agent_end`
- [x] 1.4 在同一临时入口验证 `agent.abort()` 会停止后续事件，且 `finishTurn` 返回 `{ action: 'end' }` 时不再发起新请求
- [x] 1.5 记录浏览器产物体积增量到本变更的验收记录；若增量超过约定阈值，暂停后续任务并重新评估（spike 不通过则不引入生产依赖）

## 2. 门面拆分（零行为变化）

- [x] 2.1 把现有 LangGraph 实现整体搬为 `runSceneAgentLangGraph`，`runSceneAgent` 改为引擎选择器，签名与 `SceneAgentResult` 不变；验证 `npm run build` 通过
- [x] 2.2 运行 `node verify-agent-graph.mjs`，验证全部用例通过、输出与改动前一致（无新增失败项）
- [x] 2.3 运行 `node verify-agent-3d-duel.mjs` 的 mock 部分，验证工具门禁、草稿与验收链路未被拆分破坏
- [x] 2.4 在 `runSceneAgent` 门面记录 `engine` 选择结果的类型定义（先只返回，不展示）；验证类型检查通过且现有调用方无需改动

## 3. pi `streamFn` 适配

- [x] 3.1 实现 pi `TranscriptContext` → 项目 `ProviderChatMessage[]` 的转换（system / user / assistant tool_calls / toolResult），验证单元测试覆盖四种角色与中间 system 合并
- [x] 3.2 实现 `AssistantMessageEventStream` 合成：`start → text_* → toolcall_end* → done`，补齐 `role/api/provider/model/usage/stopReason/timestamp`；验证类型检查与最小事件序列测试
- [x] 3.3 实现 `toolCalls` 映射与 `onToolCallDelta` 进度事件；验证测试覆盖「参数分片只作进度、完整后才执行」
- [x] 3.4 实现失败与取消编码：请求错误映射为 `stopReason: 'error'`，`AbortError` 映射为 `'aborted'`，`streamFn` 不 throw；验证两条测试各自断言错误消息进入最终 `AssistantMessage`
- [x] 3.5 实现 `finishReason === 'length'` 的可读失败（参数可能不完整）；验证测试断言不会把截断参数交给工具

## 4. pi 工具定义

- [x] 4.1 为 12 个工具建立 TypeBox 参数 schema，字段与现有 zod 定义逐项对齐；验证参数校验测试对非法输入返回失败、对合法输入通过
- [x] 4.2 实现 `execute()` 的 `content` / `details` 分离：`content` 只放模型摘要，帧 URL、代码正文、草稿行数放 `details`；验证测试断言 `content` 不含 `data:` 与完整代码
- [x] 4.3 复用现有工具函数体（草稿增删改查、提交准入、试运行、抓帧、验收、结束），不复制业务逻辑；验证两个引擎调用同一批工具函数时结果字段一致
- [x] 4.4 让 `finish` 返回 `terminate: true`；验证测试断言结束后不再有新的模型请求
- [x] 4.5 配置 `toolExecution: 'sequential'` 并加 `beforeToolCall` 取消检查；验证「同一批同时请求 run_render 与 capture_frames」时抓帧在试运行成功之后

## 5. pi 事件映射与引擎组装

- [x] 5.1 实现 `src/agent/pi/events.ts`，把 pi 事件映射为项目 `AgentEvent`（步骤、文本、工具三组）；验证单测覆盖每组事件的开始/增量/结束
- [x] 5.2 丢弃 `thinking_*` 事件；验证测试断言映射结果不含任何推理内容
- [x] 5.3 实现 `runSceneAgentPi`：组装 `Agent`、注入 system 与工具、复用现有 `SceneAgentDeps`；验证与 `runSceneAgentLangGraph` 相同输入下返回结构完整的 `SceneAgentResult`
- [x] 5.4 实现 `finishTurn` 的催促语义：无工具调用且未完成时返回 `{ action: 'continue' }` 并注入催促消息；验证测试断言「模型只回文本」会触发下一轮而不是直接结束
- [x] 5.5 复用门面层总超时，把 `agent.abort()` 接入 `AbortSignal` 链路；验证测试断言超时后返回可读超时错误且不带半成品代码
- [x] 5.6 复用 `session.attempts` / `session.reviewAttempts` 上限，不在新引擎重复计数；验证测试断言达到上限时两个引擎给出等价失败

## 6. 引擎选择、回退与可审计

- [x] 6.1 在 `AppSettings` 增加 `agentEngine?: 'langgraph' | 'pi'`，默认与缺省行为为 `pi`，并在设置页提供下拉；验证设置读写、默认值、切换落库与刷新回读
- [x] 6.2 引擎选择器按「显式入参 → 设置 → 默认」解析，并对 `pi` 检查 `resolveToolProtocol()` 是否为 `native`；验证测试覆盖四条分支（默认、显式 pi 可用、pi 前置不满足回退、显式 pi 前置不满足报错）
- [x] 6.3 在 `SceneAgentResult` 与事件流中记录实际引擎与回退原因，聊天头部显示引擎标识；验证 `verify-agent-chat-ui.mjs` 或等价脚本能读到该标识
- [x] 6.4 加依赖边界检查：断言 `src/agent/SceneAgentChat.tsx`、`sceneAgentTools.ts`、`agentMessageReducer.ts`、`sceneDraft.ts` 不引用 `@earendil-works/*`；验证检查脚本在有违规 import 时失败
- [x] 6.5 在项目文档中记录如何开启/回退引擎及前置条件；验证文档中的命令与设置键可照着执行

## 7. 双引擎对齐测试

- [x] 7.1 提取共享 mock 场景：正常生成、试运行失败后修复、视觉验收未通过、用户取消、整体超时、空镜头、已有代码基线；验证场景可在两个引擎下复用
- [x] 7.2 对每个场景比较工具调用序列、最终代码草稿、抓帧数量、验收结论与运行结局；验证比较脚本对两个引擎都运行并输出差异
- [x] 7.3 比较事件分组与去重语义（步骤/文本/工具），允许不影响用户判断的顺序差异；验证差异超出白名单时脚本失败
- [x] 7.4 验证镜头隔离：任一引擎运行后，其他镜头的代码、参考选择与视频状态不变
- [x] 7.5 把对齐脚本接入现有验证入口（如 `verify-all.mjs` 或对应 npm 脚本）；验证一键运行能同时跑两个引擎的 mock 用例

## 8. 真机验收

- [x] 8.1 用 `pi` 引擎跑验收场景「山体背景、男女两人、各持剑对打、镜头环绕、4 秒、16:9、clean」；验证保存代码、关键帧、MP4 与验收清单位于项目输出目录
- [x] 8.2 对 8.1 的关键帧执行视觉验收；验证清单逐项有结论，缺项时明确列出而不是笼统通过
- [x] 8.3 在渲染或抓帧过程中取消一次；验证 Blender 作业终止、旧代码与旧视频保留、聊天标记已取消
- [x] 8.4 对同一镜头分别用两个引擎各跑一次；验证两次都能通过试运行门禁、产出同一份代码 hash，且 agent 侧没有保存工具（代码阶段只改草稿，写入项目仍由既有视频验收流程触发）
- [x] 8.5 汇总 1.5、7.x、8.x 的结果到本变更的验收记录，标明体积增量、对齐差异白名单与真机结论

## Workflow follow-up

- 归档前按项目要求完成 review；确认默认引擎仍为 LangGraph。
- 归档后验证 specs 已同步、`openspec validate --strict` 通过。
- 切换默认引擎是独立决定，需在本变更归档后另行立项。
