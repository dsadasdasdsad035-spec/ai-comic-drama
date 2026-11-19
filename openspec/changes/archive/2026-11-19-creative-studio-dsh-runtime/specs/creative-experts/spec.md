# Spec Delta

## MODIFIED Requirements

### Requirement: 专家目录与持久化

系统 SHALL 把每个创意专家表达为宿主的一份 preset 与 persona：等价字段仍包含 `id`、`name`、`description`、`soul`、`skillIds`、`toolIds`。内置专家 SHALL 来自仓库 `experts/<id>/` 并在启动时同步到宿主配置；自定义专家 SHALL 持久化在宿主配置目录。同一 `id` 时自定义 MUST NOT 覆盖内置 id。

#### Scenario: 列举专家

- **WHEN** 操作员打开宿主的创意专家设置
- **THEN** 显示内置与自定义合并后的列表，按名称排序

#### Scenario: 保存自定义

- **WHEN** 操作员在宿主设置中保存一个自定义专家
- **THEN** 再次打开设置可见该专家，且创意会话可选用

#### Scenario: 内置 id 不可覆盖

- **WHEN** 尝试写入与内置专家同 `id` 的自定义定义
- **THEN** 写入被拒绝，内置定义保持不变

### Requirement: 技能白名单通配

`skillIds` 含 `*` 时 SHALL 视为「该专家可用技能根内全部技能」：技能读取 MUST 不再按 id 拦截，占位符 MUST 渲染为「全部已安装技能（*）」。内置「全能专家」SHOULD 使用该通配，避免逐个挂载技能。

#### Scenario: 通配读技能

- **WHEN** 专家 `skillIds` 为 `["*"]` 且模型调用技能读取工具
- **THEN** 不返回「专家不允许读取技能」，而是按技能是否存在返回结果

#### Scenario: 通配读技能子文件

- **WHEN** 专家 `skillIds` 为 `["*"]` 且模型读取技能包内子文件
- **THEN** 不返回「专家不允许读取技能」，而是按文件是否存在返回结果

### Requirement: list_experts 始终可用

系统 SHALL 在创意运行时始终注册专家列举工具，返回当前可选专家的摘要。该工具 MUST 在默认模式与专家模式都可用，且 MUST NOT 出现在专家设置的工具勾选列表中。

#### Scenario: 无专家模式

- **WHEN** 用户未选专家且发送创意消息
- **THEN** 工具名单含专家列举工具与默认技能发现工具

#### Scenario: 专家模式

- **WHEN** 用户选中某专家
- **THEN** 运行时工具集含专家列举工具，即使该专家定义未列出该工具名

### Requirement: 专家模式运行时约束

当创意会话选中某专家时，系统 MUST 使用仅含占位符替换后的专家 `soul` 作为 system，MUST NOT 拼接默认模式的通用创意 system 或偏好技能说明。工具 MUST 为该专家 `toolIds` 与创意工具的交集加专家列举工具。技能读取 MUST 仅允许该专家 `skillIds` 内的 id，否则返回 `ok:false`。

#### Scenario: 发送预览一致

- **WHEN** 操作员查看该轮实际使用的 system 与工具列表
- **THEN** 与下一轮运行时一致，不出现仅存在于预览的额外段落

#### Scenario: 隐藏偏好技能

- **WHEN** 选中专家
- **THEN** 界面不出现默认模式的偏好技能选择入口

#### Scenario: 非白名单技能的子文件被拒绝

- **WHEN** 专家 `skillIds` 不含某 id 且模型对该 id 读取子文件
- **THEN** 返回 `ok:false`，不读取该技能任何文件

### Requirement: 会话绑定专家

系统 SHALL 在会话记录中保存可选的专家标识。打开会话时 MUST 优先使用该字段；切换专家 MUST 写回当前会话。会话列表 SHOULD 显示专家显示名。

#### Scenario: 绑定与清空

- **WHEN** 操作员为某会话选择专家或清空选择
- **THEN** 再次打开该会话时专家选择与上次一致

#### Scenario: 会话列表标注

- **WHEN** 会话列表中某会话绑定了专家
- **THEN** 该行显示对应专家的显示名

### Requirement: 专家导入导出

系统 SHALL 支持自定义专家包的导入合并与导出，包内含专家定义、persona 正文与该专家私有技能。导入 MUST 合并到自定义专家集合，MUST NOT 覆盖内置 id。旧格式专家包 MUST 在导入时被识别并转换为新结构。

#### Scenario: zip 往返

- **WHEN** 操作员导出某自定义专家包再导入
- **THEN** 同 id 定义被合并更新且可在创意会话选用

#### Scenario: 旧包导入

- **WHEN** 操作员导入旧格式专家包
- **THEN** 导入后该专家以新结构出现，persona 与技能均可读取

### Requirement: 技能读工具保持一致登记

专家可用的技能读工具清单 SHALL 与运行时实际注册的技能读工具一致。新增技能读工具时 MUST 同步到专家工具分组、专家白名单与默认模式的工具名单，避免出现「工具已注册但专家模式取不到」。

#### Scenario: 新读工具在专家模式可用

- **WHEN** 专家 `toolIds` 勾选了技能读工具组且该技能在白名单内
- **THEN** 运行时工具集含全部技能读工具，包括读取包内子文件的工具

#### Scenario: 新读工具不出现在外部工具勾选列表

- **WHEN** 操作员打开专家设置的工具勾选列表
- **THEN** 技能读工具归入技能组，不列为可单独勾选的外部工具
