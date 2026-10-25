# Tasks

## 1. 能力声明与配置

- [x] 1.1 在 `AppSettings` 增加 3D agent 的协议字段（`auto | native | json`，默认 `auto`），并在服务端 settings 归一化中保留该字段；用 `npx tsc --noEmit` 与一次设置读写验证默认值不丢。
- [x] 1.2 新增共享的模型能力表（渠道 + 模型 → 是否支持 tools、thinking 策略、验证日期），首批只包含已实测的 MiniMax-M3、Agent Plan 的 doubao-seed-2-1-lite、deepseek-v4-flash、kimi-k3；用单元测试验证未列出的模型默认为“不支持”。
- [x] 1.3 在设置页为「3D 代码」环节增加协议选择与当前能力状态（支持/不支持/JSON 回退）；手工切换并保存后刷新页面，确认值与状态保持。
- [x] 1.4 在 README 的设置/模型章节记录协议字段与能力表；按文档描述操作一遍，确认与界面一致。

## 2. 服务端代理支持工具协议

- [x] 2.1 扩展 `/api/text` 请求体，接受 `messages`、`tools`、`toolChoice`，同时保留 `system + prompt`；验证旧请求返回行为不变，新请求能把工具定义传给 provider。
- [x] 2.2 非流式路径归一化 `message.tool_calls` 与 `finishReason`；用一次真实 tools 请求（MiniMax 或 Agent Plan）验证返回的工具名与参数正确。
- [x] 2.3 扩展 `server/text-stream.mjs` 按 `index` 聚合 `delta.tool_calls`（id/name/arguments），并在 `done` 事件返回完整 tool_calls；用录制的 SSE fixture 写单元测试，覆盖分片合并、多个工具、无工具三条路径。
- [x] 2.4 工具调用模式的 thinking 策略：MiniMax-M3 与 DeepSeek Flash 关闭 thinking；用请求体断言测试验证；对 Ark Plan 豆包与 Kimi/GLM 用真实 Key 验证字段是否被接受，并把结果写回能力表。
- [x] 2.5 失败语义：provider 返回不支持 tools、参数截断或 `finishReason=length` 时返回可读错误，且不自动改渠道；用 mock 上游验证错误文本与状态码。
- [x] 2.6 在 README/接口说明中记录 `/api/text` 的新请求/响应字段；按文档构造一次 curl 请求，确认示例可用。

## 3. 客户端原生工具模型

- [x] 3.1 新增原生工具模型（`NativeToolChatModel`），用 `z.toJSONSchema` 生成工具 `parameters`，默认 `toolChoice: auto`；单元测试验证 schema 转换与工具绑定。
- [x] 3.2 实现消息映射：System/Human/AI（含 tool_calls）/Tool（含 tool_call_id），映射前复用 `compactDraftHistory`；用含多轮工具调用的样例消息做单元测试，断言角色、id 与参数。
- [x] 3.3 解析非流式与流式 tool_calls，生成稳定的工具调用 id，并通过 `onToolCallDelta` 暴露参数增量；单元测试覆盖完整、截断、多工具三种输入。
- [x] 3.4 失败与取消：provider 错误、参数不完整、`finishReason=length`、abort 时抛出可读错误且不产生伪造 tool_calls；用 fake `ask` 覆盖这些分支。
- [x] 3.5 在 README/模型层注释中说明原生模型的输入输出与与 JSON 模型的差异；按注释构造一次调用验证签名。

## 4. 运行时接入

- [x] 4.1 `runSceneAgent` 按配置选择模型（`auto` 查能力表，`native` 要求支持，`json` 强制），并在运行轨迹中记录最终协议；用 fake 模型验证三种配置的选择结果。
- [x] 4.2 把参数增量映射为 `tool_call_args` / `tool_call_input_available` 事件，工具仍只在 `tools` 节点执行；用 mock 模型验证执行前没有 `tool_start`、完整后只执行一次。
- [x] 4.3 原生模式跳过 `AGENT_PROTOCOL_LINES` 的 JSON 协议提示，保留技能 system、工具纪律与草稿分片规则；用系统提示快照测试验证两种模式的差异。
- [x] 4.4 在聊天/工作台显示当前协议与回退原因（例如技能 chip 或模型行），且不改变现有工具卡；手工跑一轮确认显示与轨迹一致。

## 5. 集成验收

- [x] 5.1 在 S01 双人对打场景分别用 native 与 json 跑完整流程，记录工具调用顺序、试运行、抓帧、验收与最终 MP4；确认两种协议都能完成且事件一致。
- [x] 5.2 在 S05 多人混战场景重复双协议对比，记录首次工具调用成功率、修复轮数、输入/输出 token 与耗时；把结果写进验收记录。
- [x] 5.3 覆盖异常路径：不支持 tools 的模型、参数截断、用户取消、渠道 400；确认不写半成品代码、不静默回退、轨迹可读。
- [x] 5.4 运行 `npx tsc --noEmit` 与仓库现有 agent/workbench 验收脚本，确认 JSON 路径无回归、阶段技能聊天不受影响。
- [x] 5.5 在 README 的 Agent 章节补充“何时用 native / 何时回退 JSON / 如何看协议”；按文档对照一次实际运行。
