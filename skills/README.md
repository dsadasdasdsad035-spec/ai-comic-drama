# 技能作者指南

技能是运行时可读的提示词数据，不是代码。每个技能一个目录：

```
skills/<id>/SKILL.md
```

`<id>` 只能是小写字母、数字和短横线（`^[a-z0-9][a-z0-9-]{0,63}$`），且必须与 frontmatter 的 `name` 一致。

## 文件结构

```markdown
---
name: shotlist
description: 一句话说明这个技能做什么；会出现在技能目录和设置页
stage: shot
runtime: json-tools
tools: [read_episode, read_shots, submit_shots]
inputs: [style, aspect, brief, target]
output: shots-v1
contracts: [shots-v1]
version: 1
---
## 角色与约束
（进入 system：角色、任务、硬约束、输出示例）

## 任务
（进入 prompt：本轮输入模板和任务说明）
```

### frontmatter 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | 是 | 必须与目录 id 一致 |
| `description` | 是 | 技能目录/设置页展示的简短说明 |
| `stage` | 是 | 决定模型环节：`script` / `character` / `asset` / `shot` / `prompt` / `sceneCode` / `vision` / `videoVision` |
| `runtime` | 是 | `json-tools`（普通工作台）或 `scene3d`（3D 场景） |
| `tools` | 是 | 工具 id 数组；只能引用代码里已注册的工具 |
| `inputs` | 是 | 任务模板会用到的输入键；每个都必须被 `{{input:key}}` 使用 |
| `output` | 是 | 输出契约 id，必须出现在 `contracts` 里 |
| `contracts` | 否 | 锁定契约 id 数组；缺省为 `[output]` |
| `version` | 是 | 大于 0 的整数；用于覆盖版本与审计 |

## 输入占位符

只认 `{{input:key}}`：

```
画风：{{input:style}}
```

提示词里本来就有 `{{角色名}}`、`{{陈默}}` 这类示例，它们不会被当成占位符——这是刻意保留的。

- 一次性生成：所有输入完整内联。
- 聊天：超过 2000 字符的输入只留一行引用，由读工具按范围读取。
- 未提供（undefined/null）的必需输入会阻止发送；空字符串是合法值。

## 可编辑层与锁定契约

- **可编辑**：`## 角色与约束` 和 `## 任务` 两节。设置页按技能保存为用户覆盖，存在 `skill_overrides` 表。
- **锁定**：frontmatter、工具列表、输出 schema、代码 ABI、安全规则、JSON 协议。用户覆盖只能改正文，服务端会把内置 frontmatter 拼回去。
- 未知契约或未知工具会让技能加载失败；一个坏的用户覆盖会退回内置版本并在设置页报错。

## 只读技能与写能力

- 只声明 `read_*` / `get_shot_context` 工具的技能是只读技能；新增只读技能只需要加一个 `SKILL.md`，不需要改代码。
- 需要写产物的技能必须引用已注册的 `submit_*` 工具；写工具只能由宿主工作台使用，写操作只产生草稿，合并交给宿主。
- 只读技能即使被加载到某个工作台，也不会获得宿主的写工具。

## 内置技能

| id | 工作台 | 输出契约 |
|---|---|---|
| `script` | 剧本 | `script-v1` |
| `character` | 角色 | `characters-v1` |
| `asset` | 素材 | `designs-v1` |
| `shotlist` | 镜头表 | `shots-v1` |
| `prompt` | 提示词 | `prompts-v1` |
| `scene3d` | 3D 场景聊天 | `scene3d-code-v1` |
| `scene-code` | 一次性 3D 代码生成（非聊天） | `scene3d-code-v1` |
| `scene-code-chat` | 一次性 3D 代码改写（非聊天） | `scene3d-code-v1` |

`scene-code` / `scene-code-chat` 没有工具，也不出现在工作台聊天的只读技能列表里；它们只服务 `sceneCodeJob` 的一次性代码生成，角色层之外仍由锁定契约提供完整 ABI。

## 接口

- `GET /api/skills`：返回有效技能列表（内置 + 用户覆盖）。
- `GET /api/skills/<id>`：返回单个技能。
- `PUT /api/skills/<id>`：保存正文覆盖（只接受正文；frontmatter 使用内置文件）。
- `DELETE /api/skills/<id>`：恢复默认。

服务端只读取 `skills/<id>/SKILL.md`，拒绝路径穿越、符号链接逃逸和超过 64KB 的文件；技能内容永远不会被执行。
