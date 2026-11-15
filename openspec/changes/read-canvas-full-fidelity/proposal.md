# Proposal

## Why

内置 Pi agent 读分镜时拿不到画布上的完整内容：`read_shots` 用 8000 字符的 `boundJson` 截断，超出时返回的是**前半截 JSON 字符串**而不是合法 JSON。实测当前项目第 1 集 31 镜序列化后 44,744 字符，能被模型看到的只有第 1 镜，该集 15 条视频提示词里只有 1 条进了上下文；`video_prompt_override`、`video_prompt_rendered`、`transition_out`、`refIds` 这些排在记录末尾或 `extra` 里的字段几乎必然被砍掉。模型因此以为分镜没有视频提示词，写回时还会把看不见的字段当成空值覆盖。

## What Changes

- 读工具的截断从「按字符切 JSON 文本」改为「按整条记录装填」：被截断时响应仍是合法 JSON，并显式给出 `total`、`returned` 与续读游标，不再出现半截 JSON 或无提示的静默丢弃。
- `read_shots` 支持游标续读（在现有 `episode` / `shotIds` / `limit` 之外新增游标参数），使一集任意数量的镜头都能被完整读到。
- 新增单镜钻取读工具，按镜号或 `shotId` 返回该镜完整记录（含视频提示词各形态、转场、参考连线），不受列表预算影响。
- 新增出片正文读工具，返回该镜最终会提交给视频模型的正文与其来源标记，与画布出片前预览逐字一致。
- `read_episodes`、`read_episode`、`read_characters`、`read_designs`、`read_transition_recipes` 复用同一套按条装填与截断标记，不再返回半截 JSON。
- 移除「`read_shots` 返回形状与截断策略不得改变」的旧约束，改由新能力定义该契约。
- 新工具纳入平台内置工具名清单与默认专家工具白名单，专家设置页的「读项目」分组可见。

## Capabilities

### New Capabilities

- `shot-read-tools`: 分镜与相关项目数据的读取契约：整条装填、无损续读、单镜钻取、出片正文与拼装结果一致。

### Modified Capabilities

- `creative-asset-tools`: 移除「MUST NOT 改变 `read_shots` 的返回形状与截断策略」这一约束，改为把 `read_shots` 的读取契约交给 `shot-read-tools`，同时保留「素材分类不得混入分镜成片」的范围约束。

## Impact

- 前端 Agent 层：`src/agent/workbenchChat.ts`（`boundJson` 不再作为通用截断）、`src/agent/stageTools.ts`（六个读工具与工具集注册）、`src/agent/builtinPlatformTools.ts`（工具名清单）、`src/creative/expertToolGroups.ts`（默认专家工具与分组）。
- 出片正文复用：`src/videoPrompt.ts` 的既有拼装结果，读工具不得另写一套优先级。
- 测试：新增读工具装填/续读/钻取与出片正文一致性的断言；沿用 `tests/` 下的纯函数测试风格。
- 规格：`openspec/specs/creative-asset-tools/spec.md` 的范围约束需要同步。
- 不影响写回契约、画布渲染与数据库结构。
