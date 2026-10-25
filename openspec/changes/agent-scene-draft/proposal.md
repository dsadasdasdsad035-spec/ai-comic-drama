# Proposal

## Why

每镜场景代码现在只能通过一次 `set_scene_code` 完整提交：代码必须塞进一个 JSON 工具参数，单次模型输出有 12k token 上限，截断后 `parseJson` 拿不到工具调用；同时每一轮模型输入都会把整段代码重新拼进历史。代码一长，就会表现为"提交持续未生效"、只能压缩代码或反复重发。

给模型一个受控的场景草稿文件，允许它分段写入、按行读取、局部替换，最后再提交；这样长代码不再依赖单次输出，也不需要把全文反复塞进上下文。草稿由应用自己管理，模型拿不到任意文件路径。

## What Changes

- 新增受控草稿工具：`begin_scene_draft`、`append_scene_draft`、`read_scene_draft`、`patch_scene_draft`、`commit_scene_draft`、`discard_scene_draft`。
- 草稿存放在应用固定的草稿目录（按项目/镜头隔离、gitignore、可清理）；模型只操作当前镜头的草稿，不能指定任意路径。
- `commit_scene_draft` 读取草稿、跑现有静态准入、写入 agent 会话的当前代码并发代码卡；**不**直接改工作台草稿，渲染试运行通过后才成为工作台草稿。
- `set_scene_code` 保留为短代码的一次性快捷方式，内部走"写入草稿 + 提交"；长代码使用新工具。
- 草稿操作产生可观察事件（开始/进度/提交/丢弃），聊天显示草稿行数、字符数和状态；可查看只读草稿预览，并明确标记"未试运行"。
- 提交后压缩历史：草稿分片工具调用与结果替换为草稿摘要/引用，后续修改通过 `read_scene_draft` 取片段。
- 草稿有大小上限（与 200KB 代码上限一致）、单次 append/patch 上限、路径白名单和清理规则。
- 不提供任意文件读写、shell、网络或 provider 原生工具；不改 `SceneCode` 数据模型、渲染协议或现有 6 个工具的行为。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `scene-agent-runtime`: 新增受控场景草稿工具族、草稿生命周期与审计事件、草稿提交与工作台草稿的边界（提交不绕过试运行）。
- `scene-agent-chat-ui`: 新增草稿进度/状态卡片、只读草稿预览和"未试运行"标记；聊天不直接铺完整代码。

## Impact

- 代码：新增草稿存储与路由（应用服务端，固定草稿目录）、`sceneAgentTools` 新工具、agent 会话草稿字段、`sceneAgentEvents`/`agentMessageReducer` 草稿事件、`SceneAgentChat` 草稿卡与预览、`SceneCodeWorkbench` 的提交后刷新、`.gitignore` 草稿目录。
- 规格：`scene-agent-runtime`、`scene-agent-chat-ui` 两份增量；不涉及 `scene-code-runtime` 的 ABI/指纹，也不改渲染宿主协议。
- 数据：草稿是临时文件，不写入项目、不进入 `SceneCode`；提交失败或取消保留旧代码，草稿可清理。
- 安全：草稿目录是唯一可写范围；模型不能传路径；仍禁止 shell、网络和任意文件访问。
- 兼容：`set_scene_code` 和现有 6 个工具保持可用；旧的 JSON action 协议不变。流式传输不在本变更内，草稿工具通过分片规避单次输出上限。
