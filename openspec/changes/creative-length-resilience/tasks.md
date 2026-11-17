# Tasks

## 1. 输出长度上限续写

- [x] 1.1 改 `src/agent/pi/streamFn.ts`：`finishReason === 'length'` 时不再 `fail()`，保留已流出正文并按有无工具调用分别记录可续写标记；有工具调用时丢弃这些调用，不 emit `toolcall_*`。验证：`tests/pi-stream.ts` 新增两条用例（length+纯文本、length+工具调用），确认不产生 error 事件、不产生 toolcall 事件、正文完整。
- [x] 1.2 改 `src/agent/pi/stageRunner.ts`：`finishTurn` 读取标记，`prepareNextTurn` 注入续写推动消息（文本续写最多 3 次、工具参数续写最多 2 次），并计入现有总时长与步数。验证：`tests/stage-agent.ts` 新增用 mock `ask` 连续返回 `length` 的用例，断言最终文本为各段拼接且不重复、超过次数后返回可读错误。
- [x] 1.3 对齐 `src/agent/pi/engine.ts`（3D 调度）：把现有的 `finishTurn`/`pendingNudge` 机制扩展到长度上限续写，避免 3D 路径仍直接失败。验证：`tests/stage-agent.ts` 或 `verify-pi-engine.mjs` 增加 3D 续写用例，断言工具参数仍按完整参数执行。

## 2. 历史预算与指针化投影

- [x] 2.1 新建 `src/agent/pi/budget.ts`，实现纯函数 `applyHistoryBudget(messages, opts)`：最近 2 轮 `toolResult` 保真、更早工具结果替换为指针 stub、仍超预算时摘要化更早助手正文，并返回 `{ messages, stubbed, summarized, charsBefore, charsAfter }`。验证：新增 `tests/history-budget.ts` 并加入 `verify-skills-unit.mjs` 的 TESTS，覆盖「近期保真」「stub 含读工具名」「摘要轮数」「未超预算不改动」。
- [x] 2.2 在 `src/agent/pi/stageRunner.ts` 接入 `transformContext`，用 2.1 的函数约束运行内历史增长；`src/creative/creativeTurnPayload.ts` 在构造 system 前先算一次投影。验证：`tests/stage-agent.ts` 构造 20 轮历史，断言送模型的 `priorMessages` 中早期工具结果已是 stub、最近 2 轮仍原文。
- [x] 2.3 让 system 与压缩状态一致：`buildCreativePiSystem`、`buildExpertSystem` 及专家 soul 提示中凡声明「已读可不再重复读取」处，在投影发生压缩时改为指示用读工具重取。验证：`tests/creative-workspace-context.ts` 与 `tests/expert-manifests.ts` 增加断言，确认两种状态下文案互斥。
- [x] 2.4 扩展 `src/agent/pi/threadMemory.ts` 的 `describePiThreadMemory`，报告本轮送入字符数、指针化条数与摘要轮数。验证：`tests/creative-workspace-context.ts` 断言诊断文本包含这三个数字。

## 3. 上下文溢出压缩重试

- [x] 3.1 让 `src/api.ts` 的流错误保留 `kind`（`context-overflow`），并确认 `server/app.ts` 的三处 `context-overflow` 分支都把 kind 透传。验证：`verify-creative-context-overflow.mjs` 的「服务端」段断言收到 `kind` 而不仅是 message。
- [x] 3.2 在 `src/agent/pi/stageRunner.ts` 捕获 `context-overflow`：用激进预算重建 `priorMessages` 后重跑一次，事件不重复；仍失败才返回可读错误。验证：更新 `verify-creative-context-overflow.mjs`，mock 上游首次返回 400 超限、第二次成功，断言本轮继续完成且界面出现压缩提示；再补一条两次都失败的用例，断言提示已尝试压缩。

## 4. 分批写入契约

- [x] 4.1 在 `src/skills/contracts.ts` 的 `getContractToolSchema` 外层注入可选 `cursor` / `limit` 字段（契约 schema 本体不变），`src/agent/stageTools.ts` 在执行前剥离分页字段再 `validateContract`。验证：`tests/creative-contract.ts` 断言声明含两个可选字段、剥离后原契约校验通过、分页字段不会被当作业务字段。
- [x] 4.2 实现游标编解码与快照指纹校验（新模块或 `src/platform/projectDraft.ts` 内）：自造游标、编辑状态变化后的旧游标都必须被拒绝并给出重读入口。验证：新增 `tests/submit-paging.ts` 覆盖合法游标、自造游标、指纹变化三种情况。
- [x] 4.3 改 `src/platform/projectDraft.ts`：分批请求（带 `cursor` 或 `limit`）走 `mode: 'merge'`，非分批请求保持现有 `mode: 'full'`。验证：`tests/shot-write-mode.ts` 增加 12 镜分三批用例，断言最终 12 镜、顺序一致、未提交镜头未被判为删除；再断言非分批路径仍会删除缺席镜头。
- [x] 4.4 在 `src/agent/stageTools.ts` 的 submit 工具加超限预检（默认 24 000 字符），超限返回 `{ ok:false, error, suggestedLimit, hint }` 且不写入任何数据。验证：`tests/submit-paging.ts` 断言超限时不调用 `applyDraft`、错误含建议条数与分批参数名。
- [x] 4.5 更新写回工具描述与技能提示（`src/skills/tools.ts`、`CONTRACT_WRITE_HINTS`），说明分批参数与「一次提交过大时的下一步」。验证：`tests/creative-tools.ts` 与 `tests/skill-prompts.ts` 断言描述包含 `cursor`/`limit`，专家工具清单与默认工具集仍一致。

## 5. 事件与界面可见性

- [x] 5.1 在 `src/agent/sceneAgentTypes.ts` 增加 `custom` 名称约定 `continuation` 与 `context_compaction`，并在 `src/agent/agentMessageReducer.ts` 渲染为步骤提示、持久化为步骤部件。验证：`tests/creative-tools.ts` 或新增 reducer 用例断言两种事件各生成一条步骤部件、不生成用户气泡。
- [x] 5.2 在对话壳渲染这两类提示（`src/agent/ChatThreadShell.tsx` 或步骤组件），重开线程仍可见。验证：`verify-workbench-chat-ui.mjs` 增加断言：出现续写提示文案、刷新后仍存在。
  - 落地说明：工作台 SkillChat 已在 `0f21f45` 移除，该脚本的 `[data-script-chat]` 选择器已不存在，断言改由新增的 `verify-creative-notices-ui.mjs` 覆盖（创意对话壳：提示可见、两段正文都在、离开再回来仍可见），截图存 `evidence/creative-continuation-notice.png`。

## 6. 环节输出预算配置

- [x] 6.1 让 `src/skills/stages.ts` 的 `maxTokens` 可从设置页配置并在运行解析中生效；未配置时不带 `max_tokens`。验证：`tests/stage-runtime.ts` 断言三态（未配置/配置/非法值回退）。
  - 落地：新增 `resolveStageMaxTokens(stage, settings)`（三态 `configured`/`stage-default`/`unset`，非法值保留 `invalid` 并回落）；设置库新增 `stageMaxTokens`（服务端归一化只留 1–200000 的正整数），设置页「默认路由 → 生成环节默认」每行加输出上限输入框；创意运行只在配置时传 `maxTokens`。
- [x] 6.2 错误文案带上实际预算来源（渠道默认或配置值）。验证：`tests/stage-agent.ts` 断言长度上限错误消息包含预算数字或「渠道默认」。
  - 落地：`lengthExhaustedMessage(kind, budget)` 追加「本次上限 N tokens（设置页配置 / 环节默认）」或「渠道默认」；断言加在 `tests/pi-stream.ts`（同一套 stageRunner 续写用例所在文件）。

## 7. 集成验收

- [x] 7.1 更新 `verify-creative-context-overflow.mjs` 的既有断言（不再只提示新建会话），并在 `README.md` 的验证清单登记新脚本。验证：`node verify-creative-context-overflow.mjs` 全绿。
  - 落地：服务端那条断言改成「文案只作兜底，客户端按 kind 自救」（运行器压缩重试的断言已在 3.2 补齐）；README 登记 `verify-creative-context-overflow.mjs` 与 `verify-creative-notices-ui.mjs`。
- [x] 7.2 跑完整回归：`node verify-skills-unit.mjs`、`node verify-pi-engine.mjs`、`node verify-workbench-chat-ui.mjs`、`npm run build`。验证：全部通过且 `tsc --noEmit` 无错。
  - 落地：`verify-workbench-chat-ui.mjs` 的目标 UI 已在 `0f21f45` 删除，脚本按仓库既有 `@deprecated → 转发` 约定转调 `verify-creative-notices-ui.mjs`；另修掉 `verify-creative-thread-fidelity.mjs` 里「stageRunner 不装 transformContext」的旧断言，以及 `tests/platform-generate-tools.ts` 里「正文会被拼装参考图槽位」的过时断言（正文逐字提交）。

## Workflow follow-up

- 归档前确认 `openspec validate creative-length-resilience --strict` 通过。
- 归档本 change，并检查 `openspec/specs/creative-thread-context/spec.md` 中两条 REMOVED 要求已按迁移说明被替换。
