# Spec Delta

## MODIFIED Requirements

### Requirement: 技能白名单通配

`skillIds` 含 `*` 时 SHALL 视为「全部已安装技能可读」：`read_skill` / `read_skill_text` / `read_skill_file` MUST 不再按 id 拦截，`{{skillIds}}` 占位符 MUST 渲染为「全部已安装技能（*）」。内置「全能专家」SHOULD 使用该通配，避免逐个挂载技能。

#### Scenario: 通配读技能

- **WHEN** 专家 `skillIds` 为 `["*"]` 且模型调用 `read_skill_text`
- **THEN** 不返回「专家不允许读取技能」，而是按技能是否存在返回结果

#### Scenario: 通配读技能子文件

- **WHEN** 专家 `skillIds` 为 `["*"]` 且模型调用 `read_skill_file`
- **THEN** 不返回「专家不允许读取技能」，而是按文件是否存在返回结果

### Requirement: 专家模式运行时约束

当创意顶栏选中非空专家时，系统 MUST 使用仅含占位符替换后的专家 `soul` 作为 system，MUST NOT 拼接通用创意自主 system 或顶栏偏好技能说明。工具 MUST 为专家 `toolIds` 与创意 MCP 勾选的交集加 `list_experts`。`read_skill` / `read_skill_text` / `read_skill_file` MUST 仅允许专家 `skillIds` 内的 id，否则返回 `ok:false`。

#### Scenario: 发送预览一致

- **WHEN** 用户打开「发送预览」且已选专家
- **THEN** 展示的 system 与 tool 列表与下一轮 `runStageAgent` 一致

#### Scenario: 隐藏偏好技能

- **WHEN** 顶栏选中专家
- **THEN** 「偏好技能」下拉不可见

#### Scenario: 非白名单技能的子文件被拒绝

- **WHEN** 专家 `skillIds` 不含某 id 且模型对该 id 调用 `read_skill_file`
- **THEN** 返回 `ok:false`，不读取该技能任何文件

## ADDED Requirements

### Requirement: 技能读工具保持一致登记

专家可用的技能读工具清单 SHALL 与运行时实际注册的技能读工具一致。新增技能读工具时 MUST 同步到专家工具分组、专家白名单与自动目录模式的工具名单，避免出现「工具已注册但专家模式取不到」。

#### Scenario: 新读工具在专家模式可用

- **WHEN** 专家 `toolIds` 勾选了技能读工具组且该技能在白名单内
- **THEN** 运行时工具集含全部技能读工具，包括读取包内子文件的工具

#### Scenario: 新读工具不出现在外部工具勾选列表

- **WHEN** 用户打开专家设置的工具勾选列表
- **THEN** 技能读工具归入技能组，不列为可单独勾选的外部工具
