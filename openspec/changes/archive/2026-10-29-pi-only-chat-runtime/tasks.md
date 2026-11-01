# Tasks

## 1. 前置：消解双引擎规格冲突

- [x] 1.1 决定 `openspec/changes/scene-agent-pi-engine/` 的归档去向（归档后由本变更改写，或作废其 delta），执行后确认 `openspec/specs/scene-agent-runtime/spec.md` 中不存在「聊天引擎可切换且可回退」等双引擎需求；验证：`openspec show scene-agent-runtime --type spec` 不含引擎切换需求，`openspec validate --strict` 对两个变更都通过

## 2. 契约收紧（原生工具模式的前提）

- [x] 2.1 收紧 `script-v1`、`characters-v1`、`designs-v1`、`shots-v1`、`prompts-v1`、`reverse-v1` 六个契约的 `required`：把业务上不可省略的字段标记为必填，保留现有 `.optional()` 语义与 `validateContract` 行为不变；验证：`node verify-publish-contract.mjs`、`node verify-creative-reverse-contract.mjs`、`node verify-character-extract-contract.mjs` 通过
- [x] 2.2 用确定性脚本确认收紧后 `shots-v1` 的 `required` 覆盖镜号、场次、时长、景别与描述；验证：`z.toJSONSchema(getContractSchema('shots-v1'), { io: 'input' }).properties.shots.items.required` 包含上述五项
- [x] 2.3 用真实模型复验收紧效果：同一提示词下 `kimi-k3` 提交的镜头草稿不再为空；验证：保存探测输出，`submit_shots` 参数两镜均含 `no/scene_no/seconds/size/desc`

## 3. 原生工具能力表

- [x] 3.1 把 `TOOL_CAPABILITIES` 的匹配键从「渠道 + 模型」改为「模型」，渠道降级为审计字段；验证：`node verify-native-tool-protocol.mjs` 更新后通过，且新增「同模型换渠道判定不变」用例
- [x] 3.2 能力表扩到 8 条实测模型（MiniMax-M3、豆包 lite/pro/evolving、DeepSeek Flash/Pro、Kimi K3、GLM 5.3），保留 thinking 关闭策略；验证：能力表单测覆盖 8 条命中与常见未命中模型
- [x] 3.3 设置页的能力状态文案改为「支持原生工具调用 / 未验证，聊天不可用」，删除协议选择下拉后的死代码；验证：`node verify-settings-ui-v2.mjs` 通过且页面无「工具协议」下拉

## 4. 工具定义层

- [x] 4.1 新增 `src/agent/tool.ts` 定义框架无关的 `ToolDef`（name/description/zod schema/run），替换 `StructuredToolInterface` 在 `stageTools` 与 `bindSkillTools` 中的类型；验证：`npm run build` 类型检查通过，`node tests/stage-agent.ts` 的绑定用例通过
- [x] 4.2 新增 `src/agent/pi/toolAdapter.ts`：`ToolDef` → `AgentTool`，参数用 `z.toJSONSchema(schema, { io: 'input' })`，结果拆成 `content`（经 `modelFacingResult` 裁剪）与 `details`，`ok:false` 映射 `isError`，`finish` 返回 `terminate`；验证：新增适配层单测覆盖 input 语义（带 `.default()` 的字段不进 required）、嵌套数组、未知字段、错误映射与 terminate
- [x] 4.3 迁移 `sceneAgentTools`（12 个）、`stageTools`（8 个）、`creative/tools`（12 个）、`publish/publishTools`（15 个）到 `ToolDef`，函数体与 `boundJson` 截断、契约校验、`ok:false` 语义保持不变；验证：`node tests/creative-tools.ts`、`node tests/publish-chat.ts`、`node verify-agent-scene-draft.mjs` 通过
- [x] 4.4 删除 `pi/tools.ts` 的手写 TypeBox SPECS，改由适配层从 zod 生成；验证：`pi/tools.ts` 中不再出现 `Type.Object` 参数定义，`node verify-pi-engine.mjs` 通过

## 5. 通用聊天运行器

- [x] 5.1 新增 `src/agent/pi/stageRunner.ts`，保持 `RunStageAgentInput/Result` 契约：有工具调用自动继续、无工具调用结束、`maxSteps` 在 `finishTurn` 内计数并在超限后补发原错误、总超时与取消统一处理；验证：`node tests/stage-agent.ts` 全通过（含步数上限、模型失败不写草稿、取消后不写草稿）
- [x] 5.2 把五个工作台、发布助手与创意会话的 `runStageAgent` 调用切到新 runner，事件经 `pi/events.ts` 映射；验证：`node verify-script-chat.mjs`、`node verify-workbench-chats.mjs` 更新 mock 后通过
- [x] 5.3 验证取消语义：模型流中取消与工具执行中取消都不产生后续事件与工具执行；验证：新增 runner 用例断言 `cancelled` 状态与事件序列尾部
- [x] 5.4 验证超时语义：超过总时长上限时上游请求与进行中工具被终止并返回可读超时错误；验证：runner 用例以短上限运行并断言错误文案与耗时上限

## 6. 3D 门面收敛

- [x] 6.1 `runSceneAgent` 去掉引擎选择，直接走 pi；`SceneAgentResult` 移除 `engine`/`engineFallbackReason`，`toolProtocol` 恒为 `native`；验证：`node verify-pi-agent.mjs` 通过，结果对象无 `engine` 字段
- [x] 6.2 能力校验前移：未命中能力表时在构造 `Agent` 之前返回可读错误，错误含渠道、模型与可用清单；验证：新增用例断言错误文案与「未发起任何模型请求」
- [x] 6.3 删除 `sceneAgentGraphLangGraph.ts`、`zcodeChatModel.ts`、`nativeToolChatModel.ts`、`actionJson.ts`、`agentHistory.ts`、`sceneAgentEngine.ts`，清理 `sceneAgentGraph.ts` 与 `SceneAgentChat.tsx` 的引擎展示；验证：`npm run build` 通过，`rg "langgraph|LangGraph|@langchain"` 在 `src/` 无命中
- [x] 6.4 删除 `sceneAgentEvents.ts` 的 `createAgentEventBridge`、`mapLangGraphEvent` 与 `RawLangGraphEvent`，保留与框架无关的纯函数并改为 `pi/events.ts` 复用；验证：`node tests/chat-model.ts` 改写成 pi 消息形状后通过
- [x] 6.5 移除 `package.json` 的 `@langchain/core` 与 `@langchain/langgraph` 并重装；验证：`npm ls @langchain/core @langchain/langgraph` 为空，`npm run build` 通过

## 7. 设置与技能元数据

- [x] 7.1 从 `AppSettings`、服务端归一化、设置页与文档中移除 `agentEngine` 与 `agentToolProtocol`，存量值按默认处理而不报错；验证：写入含 `agentEngine:"langgraph"` 的设置后读取仍成功，`node verify-settings-db.mjs` 通过
- [x] 7.2 技能 `runtime` 字面量从 `json-tools` 改为 `tools`，`parse.ts` 接受 `json-tools` 作为归一化别名；验证：`node verify-skill-parser.mjs`、`node verify-skills-unit.mjs` 通过，含旧字面量的技能覆盖仍能加载

## 8. 测试与文档收尾

- [x] 8.1 删除 `verify-agent-graph.mjs` 与 `verify-pi-alignment.mjs`，把其中仍有效的场景（正常生成、试运行失败修复、验收上限、取消、超时、镜头隔离、事件分组）迁到单引擎回归；验证：新回归脚本通过且不再有双引擎对比
- [x] 8.2 把浏览器验收脚本的模型 mock 从 `{ json: { content, tool_calls } }` 改为 `{ text, toolCalls, finishReason: 'tool_calls' }`；验证：`node verify-workbench-chat-ui.mjs`、`node verify-agent-chat-ui.mjs` 通过
- [x] 8.3 测量浏览器打包体积增量并记录到变更证据；验证：`npm run build` 产物中聊天入口 gzip 体积与升级前对比有具体数字，超阈值时记录后续优化项
- [x] 8.4 重写 `docs/scene-agent-engine.md` 为单引擎 + 原生工具说明，删除引擎切换与双实现一致性章节；验证：文档中的命令逐条可运行
- [x] 8.5 真机验收：3D 调度生成一个场景（渲染试运行 + 抓帧 + 验收 + finish）、一个工作台改稿（`submit_*` 草稿）、发布助手一轮只读问答；验证：保存关键帧、视频、草稿回执与截图到变更证据目录

## Workflow follow-up

- 修复后运行 `node verify-all.mjs` 全量回归，确认没有脚本因 mock 形状变更而失败。
- 归档本变更前先确认第 1 组的规格冲突已消解，再 `openspec archive pi-only-chat-runtime`。
