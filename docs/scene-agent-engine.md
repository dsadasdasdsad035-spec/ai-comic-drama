# 聊天执行引擎

应用内所有聊天（3D 调度、五个工作台、发布助手、创意会话）共用**一个**执行引擎：`@earendil-works/pi-agent-core` 的 `Agent`，并且**只走渠道原生工具调用**。没有第二个引擎，也没有文本动作（JSON action）回退路径。

| 位置 | 作用 |
|---|---|
| `src/agent/pi/engine.ts` | 3D 调度的运行器：渲染试运行门禁、视觉验收、`finish` 终止 |
| `src/agent/pi/stageRunner.ts` | 通用聊天运行器：工作台、发布、创意共用；无门禁，工具调用结束即完成 |
| `src/agent/pi/toolAdapter.ts` | `ToolDef` → pi `AgentTool`：参数声明、结果拆分、错误映射 |
| `src/agent/pi/streamFn.ts` | 把项目 `/api/text` 代理包装成 pi 的 `StreamFn` |
| `src/agent/pi/events.ts` | pi 事件 → 聊天事件（步骤 / 文本 / 工具） |
| `src/agent/pi/compact.ts` | 草稿分片折叠（唯一的实现） |
| `src/agent/tool.ts` | 框架无关的 `ToolDef`：`name / description / zod schema / run` |

## 前置条件：模型必须在能力表内

见 `src/agent/toolCapabilities.ts` 的 `TOOL_CAPABILITIES`。判定**以模型标识为键**，渠道只作审计信息——同一模型换渠道提供时结论不变。当前收录：

- `MiniMax-M3`
- `doubao-seed-2-1-lite-260915` / `doubao-seed-2-1-pro-260915` / `doubao-seed-evolving`
- `deepseek-v4-flash` / `deepseek-v4-pro`
- `kimi-k3` / `glm-5.3`

用其他模型时，聊天在**发起任何模型请求之前**就返回可读错误，并列出可换用的模型：

```
模型「openai / gpt-x」未声明支持原生工具调用，聊天不可用；
可换用：MiniMax-M3、doubao-seed-2-1-lite-260915、…
```

设置页「Agent 运行上限」下的「聊天工具能力」一行显示当前环节模型的状态（支持 / 未验证，聊天不可用）。

## 工具约定

每个工具是 `ToolDef`，`schema` 是参数结构的**唯一真相**：模型看到的声明由它生成，执行前的校验也用它。

- 声明用 `z.toJSONSchema(schema, { io: 'input' })` 生成。**不要**改成默认的 `io: 'output'`——那会把带 `.default()` 的字段算进 `required`，模型漏传就被判非法。
- 结果拆成两半：`content` 是模型可见摘要（经 `modelFacingResult` 裁剪，不含帧 data URL 与整段代码），`details` 是界面可见的完整结果。
- 失败用 `isError` 上报，不靠文本描述。
- `finish` 成功后返回 `terminate`，本轮在工具结果落定后停止。

## 输出契约的必填字段

原生工具模式下，契约 schema 是模型看到的第一手约束。`required` 太宽松会让模型交出「通过校验但内容为空」的草稿（实测：`shots-v1` 只要求镜号时，`kimi-k3` 会只回 `{no:"S01"}`）。因此六个业务契约都要求业务上不可省略的字段：

- `script-v1` 场次：`slug` / `place` / `time` / `beats`
- `shots-v1`：`no` / `scene_no` / `scene_slug` / `seconds` / `size` / `move` / `desc`
- `prompts-v1`：`no` / `keyframe_prompt` / `video_prompt`
- `reverse-v1`：`start` / `end` / `size` / `keyframe_prompt` / `video_prompt`

`characters-v1` / `designs-v1` 仍允许空结果（内容里确实没有可拆的素材时，空列表是正确输出）。

改动契约后跑 `node verify-tool-contracts.mjs`。

## 上限与取消

- 总时长上限来自设置页「Agent 运行上限」，超时终止上游请求与进行中的工具。
- 取消后不再产生新的文本或工具事件；审计轨迹保留已发生的事件。
- `maxSteps` 只是内部安全阀（工作台 16、3D 512），不是用户可配置的产品设置。
- `agent.abort()` 只中止当前模型流与工具 signal，**不会自行终止循环**；`streamFn` 必须在 `signal.aborted` 时以 `stopReason: 'aborted'` 结束，否则循环会继续。
- 渠道失败按 pi 契约编码进消息（`stopReason: 'error'` + `errorMessage`）而不是抛出；运行器会读出来作为错误，否则真实原因会被「未完成 finish」盖掉。

## 聊天输入区与附件

所有聊天共用一个输入区（`src/agent/ChatThreadShell.tsx` 的 `ChatThreadBody`）：附件条在输入框上方，与发送操作同属一个容器。附件类型为 `image | video | doc | text`，由 `src/agent/chatAttachments.ts` 的 `ChatAttachment` 表达。

附件不统一去向，各自写回所在面板已有的正式数据：

| 聊天 | 附件去向 | 说明 |
| --- | --- | --- |
| 五个工作台技能聊天 | 本轮用户消息里的「【本轮附件】」块 | 不写宿主数据；角色技能的 `referenceDigest` 保持原样 |
| 3D 调度 | 该镜头的 `shot_3d_context.imageUrls` / `videoUrls` | 与左侧选择器编辑同一份数据，按镜头持久化 |
| 创意会话 | 会话级 source（摄取链路） | 入口在输入区内，但产物是 session source |
| 发布助手 | 不声明附件 | 封面需要比例维度，通用附件表达不了 |

3D 的上传与选素材都会写回镜头上下文，且**必须**按「落盘 → 刷新 media → 写 context」三步执行：`catalog` 由 `media` 派生，只写 `imageUrls` 而不刷新 media 会得到「上下文里有、catalog 里没有」，表现是加了图但 Blender 看不到。写 context 时用函数式更新，因为刷新 media 会重建 catalog，闭包里的旧 `context` 已过期。

assistant-ui 的发送能力在输入框为空时被库硬性禁用，所以「只带附件发送」由输入区自己的「发送附件」按钮发起，不经过 Composer 的 send。

## 验证脚本

```sh
node verify-tool-contracts.mjs      # 契约声明：required 覆盖与 input 语义
node verify-native-tool-protocol.mjs # 能力表、服务端归一化、工具声明与消息映射
node verify-pi-engine.mjs           # 适配层：流事件、错误/取消编码、依赖边界
node verify-pi-agent.mjs            # 3D 引擎行为：工具顺序、门禁、催促、取消、超时、镜头隔离
node verify-skills-unit.mjs         # 全部 TS 单元测试（含工具外壳与历史压缩）
```

浏览器验收（需 dev server）：

```sh
APP_URL=http://127.0.0.1:5280 node verify-agent-chat-ui.mjs            # 3D 聊天全链路
APP_URL=http://127.0.0.1:5280 node verify-agent-chat-failure.mjs       # 失败/取消/超时
APP_URL=http://127.0.0.1:5280 node verify-agent-video-acceptance-ui.mjs # finish 后 MP4 验收
node verify-workbench-chats.mjs      # 四个内容工作台（自带临时 dev server）
node verify-workbench-chat-ui.mjs    # 工作台聊天 UI（自带临时 dev server）
node verify-unified-composer.mjs     # 统一输入区：结构一致、仅附件发送、跨轮保留、上限、理解中不锁输入
node verify-3d-composer.mjs          # 3D 附件条：位置、上传写回、从素材选、跨镜隔离
```

## 历史

本文件此前描述「LangGraph 与 pi 双引擎 + 可切换」，该结构已在 `pi-only-chat-runtime` 中删除：`@langchain/core`、`@langchain/langgraph` 与两个自写 `BaseChatModel` 适配器都已移除，`agentEngine` / `agentToolProtocol` 设置项不再存在（存量值按默认处理，不报错）。
