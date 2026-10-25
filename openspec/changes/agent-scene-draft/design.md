# Design

## Context

见 `proposal.md - Why`。当前实现的约束：

- agent 只有 `set_scene_code` 一个写入入口，参数是完整代码字符串；`ZCodeChatModel` 的 `maxTokens` 是 12,000，JSON action 协议截断后无法恢复。
- `historyPrompt` 每轮把 AI 消息里的完整 tool args 重新拼进模型输入，长代码会重复占用上下文。
- 工具白名单固定 6 个，没有 shell、文件、网络；`scene-agent-runtime` 明确禁止任意文件写入。
- 当前没有草稿事件类型；`agent-streaming-events` 已归档，`tool_call_args` / `input_available` 事件可用但当前未产生。
- `chat-context-transparency` 是活跃变更，会改 `get_shot_context` 和 manifest；本变更不与其冲突：提交后上下文工具应读到新的 `session.code`。

## Goals / Non-Goals

**Goals:**

- 长代码通过分片追加/局部替换完成，不依赖单次模型输出上限。
- 草稿由应用管理在固定目录，模型不能指定路径；提交后才进入 agent 会话。
- 草稿进度、提交状态、失败原因可见；未试运行的草稿不冒充已生效代码。
- 提交后压缩历史，避免把全部分片重复发给模型。

**Non-Goals:**

- 不提供任意文件读写、shell、网络或 provider 原生工具。
- 不实现流式传输（独立变更；草稿工具本身通过分片解决长度）。
- 不改 `SceneCode`、渲染宿主协议、指纹或试运行准入规则。
- 不删除 `set_scene_code`；它保留为短代码快捷方式。
- 不做草稿的跨项目共享或云端存储。

## Decisions

### 1. 草稿是应用管理的临时文件

```
<appRoot>/.scene-drafts/<project>/<shot>/draft.py
```

- 路径由服务端根据当前项目和镜头拼接；模型只拿到"当前草稿"句柄，不能传路径。
- 目录 gitignore；每次 `begin_scene_draft` 重置，`discard` / 取消 / 关闭工作台时删除。
- 草稿不写入项目数据；`commit` 只是把内容交给会话，项目保存仍走现有流程。
- 总大小 200KB（与 `SCENE_CODE_LIMITS.codeBytes` 一致）；单次 append/patch 32KB；单次读取 200 行/8KB。

**Alternatives**：只放浏览器内存（简单，但大代码占内存、刷新丢失、渲染宿主读不到）；放到 `projects/<项目>/`（会污染项目备份，草稿不是项目资产）。

### 2. 草稿工具族

| 工具 | 行为 | 返回 |
|---|---|---|
| `begin_scene_draft` | 创建/重置当前镜头草稿 | 草稿标识、行数 0 |
| `append_scene_draft` | 在末尾追加一段 | 行数/字符数 |
| `read_scene_draft` | 按 1-based 行范围读片段 | 带行号的文本、总行数 |
| `patch_scene_draft` | 一次替换一个行范围（start 含、end 不含） | 行数/字符数 |
| `commit_scene_draft` | 读草稿 → 静态准入 → 设为 `session.code` → 发代码卡 | 哈希、行数 |
| `discard_scene_draft` | 删除当前草稿 | 确认 |

- `patch` 一次只接受一个编辑，避免多范围互相错位；模型先 `read` 再 `patch`。
- `set_scene_code` 保留：内部等价于"写入临时草稿 + 立即 commit"，适合短代码和旧调用。
- `commit` **不**调用 `onDraftCode`；工作台草稿仍然只在 `run_render` 试运行通过后更新。这是现有的"试运行成功才是草稿"契约。

### 3. 提交与会话状态

```
begin/append/patch --> draft.py
commit -------------> checkSceneCode --> session.code（暂存）
run_render ---------> Blender 试运行 --> onDraftCode --> 工作台草稿
```

- `commit` 失败不改变 `session.code`，旧代码继续有效。
- 草稿可以反复 patch/commit；每次 commit 更新代码哈希/行数。
- `session.draft = { id, project, shotId, lines, chars, updatedAt, committedAt? }` 只活在当前 agent 会话。

### 4. 审计事件

新增事件（或复用现有 `custom` 事件并固定 name）：

- `draft_started`：草稿标识、0 行。
- `draft_progress`：行数、字符数、操作（append/patch/read）。
- `draft_committed`：新代码哈希、行数、是否通过准入。
- `draft_discarded`：原因（用户取消/重置/关闭）。

事件不包含完整代码；UI 用行数/字符数展示进度。

### 5. 历史压缩

- `ZCodeChatModel.historyPrompt` 在序列化历史时，把已提交之前的 `begin/append/patch` 工具调用和结果折叠成一行：`[场景草稿] <lines> 行，已提交 hash <x>`。
- `read_scene_draft` / `commit_scene_draft` 的结果保留；模型要改代码时重新 `read` 片段。
- 未提交的草稿保留最近若干次操作（例如最近 4 次），避免模型忘记自己写到哪。

**Risk**：折叠后模型可能丢失早期细节；草稿文件仍在，`read` 可以取回。

### 6. UI

- 草稿卡：`场景草稿 · 120 行 / 3.4k 字符 · 暂存 | 已提交，待试运行 | 已生效 | 失败`。
- 「查看草稿」：只读预览，顶部固定标注「未试运行」；不提供保存/运行入口。
- 代码页签仍显示最近一次通过试运行的代码；草稿预览与代码页签分开。
- 提交/试运行失败显示原因；旧代码不变。

### 7. 安全边界

- 草稿目录固定，路径由服务端拼；拒绝任意路径、绝对路径、`..` 和符号链接。
- 草稿只当纯文本读写；不执行草稿文件本身。
- 渲染仍然走 `checkSceneCode` 和 Blender 作业；草稿文件不改变现有执行模型。
- 读草稿的 HTTP 路由只接受随机草稿标识，映射到会话内的固定路径；过期/清理后 404。

### 8. 与现有变更的关系

- `chat-context-transparency`：manifest 和上下文工具不受影响；`get_shot_context` 读 `session.code` 时会看到 commit 后的新代码。
- `agent-streaming-events`：`tool_call_args` / `input_available` 已存在；草稿工具可以后续接入流式参数，不作为本变更前提。
- `set_scene_code` 的现有调用和测试保持兼容。

## Risks / Trade-offs

- **[patch 行号错位]** → 一次一个编辑；先 read 后 patch；行号 1-based、end 不含；超范围拒绝。
- **[草稿文件残留/磁盘增长]** → 每次 begin 重置；commit 后保留到会话结束；discard/关闭/启动清理；gitignore。
- **[历史折叠丢信息]** → 保留最近操作；read 可取回；commit 后的摘要包含 hash/行数。
- **[模型滥用 read/patch]** → 单次范围/大小上限；工具调用次数沿用现有上限。
- **[草稿预览被误当生效代码]** → 只读、固定"未试运行"标记、无保存/运行入口；代码页签独立。
- **[路径穿越/符号链接]** → 服务端 canonical path 校验；只允许固定目录下的文件。
- **[并发运行]** → 一个会话一个草稿；取消/关闭清理；其他镜头不受影响。

## Migration Plan

1. 新增草稿存储、路由和工具；`set_scene_code` 保持不变，现有 agent 流程可继续。
2. agent 提示词加入草稿工具说明；长代码优先使用草稿。
3. UI 草稿卡和只读预览上线；历史折叠在适配器内实现。
4. 回滚：工具是增量的，关闭草稿开关后回到 `set_scene_code` 单次提交；草稿文件可清理，不影响项目数据。

## Open Questions

- 草稿是否需要跨工作台重开保留？默认会话内保留、关闭即清理；如果需要跨会话恢复，再补草稿标识的持久化。
