# creative-experts Specification

## Purpose
创意工作室可选「专家」：用 soul 约束 system，用技能/工具白名单约束 Pi，与无专家的自动技能目录模式并列。

## Requirements

### Requirement: 专家目录与持久化

系统 SHALL 提供创意专家定义，包含 `id`、`name`、`description`、`soul`、`skillIds`、`toolIds`。内置专家 SHALL 来自仓库 `experts/<id>/`；自定义专家 SHALL 存 SQLite 设置键 `creativeExperts`。同一 `id` 时自定义 MUST NOT 覆盖内置 id。

#### Scenario: 列举专家

- **WHEN** 客户端 `GET /api/experts`
- **THEN** 返回内置与自定义合并列表，按名称排序

#### Scenario: 保存自定义

- **WHEN** 客户端 `PUT /api/experts` 提交自定义数组
- **THEN** 持久化后再次 GET 反映更新；内置 id 写入 MUST 被拒绝

### Requirement: 技能白名单通配

`skillIds` 含 `*` 时 SHALL 视为「全部已安装技能可读」：`read_skill` / `read_skill_text` MUST 不再按 id 拦截，`{{skillIds}}` 占位符 MUST 渲染为「全部已安装技能（*）」。内置「全能专家」SHOULD 使用该通配，避免逐个挂载技能。

#### Scenario: 通配读技能

- **WHEN** 专家 `skillIds` 为 `["*"]` 且模型调用 `read_skill_text`
- **THEN** 不返回「专家不允许读取技能」，而是按技能是否存在返回结果

### Requirement: list_experts 始终可用

系统 SHALL 在创意 Pi 工具集中注册 `list_experts`，调用 `GET /api/experts` 返回摘要。该工具 MUST 在专家模式下始终注入，且 MUST NOT 出现在专家设置的工具勾选列表中。

#### Scenario: 无专家模式

- **WHEN** 用户未选专家且发送创意消息
- **THEN** 工具名单含 `list_experts` 与其它自动目录工具

#### Scenario: 专家模式

- **WHEN** 用户选中某专家
- **THEN** 运行时工具集含 `list_experts` 即使专家 manifest 未列出该名

### Requirement: 专家模式运行时约束

当创意顶栏选中非空专家时，系统 MUST 使用仅含占位符替换后的专家 `soul` 作为 system，MUST NOT 拼接通用创意自主 system 或顶栏偏好技能说明。工具 MUST 为专家 `toolIds` 与创意 MCP 勾选的交集加 `list_experts`。`read_skill` / `read_skill_text` MUST 仅允许专家 `skillIds` 内的 id，否则返回 `ok:false`。

#### Scenario: 发送预览一致

- **WHEN** 用户打开「发送预览」且已选专家
- **THEN** 展示的 system 与 tool 列表与下一轮 `runStageAgent` 一致

#### Scenario: 隐藏偏好技能

- **WHEN** 顶栏选中专家
- **THEN** 「偏好技能」下拉不可见

### Requirement: 会话绑定专家

系统 SHALL 在 `creative_sessions.expert_id` 存储可选专家 id。打开会话时 MUST 优先使用该字段；顶栏变更专家 MUST 写回当前会话。列表 UI SHOULD 显示专家显示名。

#### Scenario: 绑定与清空

- **WHEN** 客户端 `PUT /api/creative/sessions/:id` 带 `expertId`
- **THEN** 读取会话返回相同 `expertId`；空字符串表示不绑定

### Requirement: 专家导入导出

系统 SHALL 支持自定义专家 JSON 与 zip（`id/manifest.json` + `soul.md`）导入合并及单包/多包 zip 导出。zip 导入 MUST 经 `POST /api/experts/import-zip` 合并自定义表。

#### Scenario: zip 往返

- **WHEN** 用户导出专家 zip 再导入
- **THEN** 同 id 专家定义被合并更新且可在创意顶栏选用
