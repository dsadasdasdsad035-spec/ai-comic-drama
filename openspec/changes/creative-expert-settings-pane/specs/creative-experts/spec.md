# Spec Delta

## ADDED Requirements

### Requirement: 专家管理入口在应用设置页

系统 SHALL 在应用的设置页提供创意专家的管理界面：列出内置与自定义专家，并支持新建自定义专家、编辑 Soul、勾选技能与工具、删除自定义专家。内置专家 MUST 只读；编辑内置 MUST 以「另存为自定义副本」的方式生成新 id，不得改动仓库内的内置定义。

#### Scenario: 列表与新建

- **WHEN** 操作员打开「设置 → 创意专家」
- **THEN** 看到按名称排序的内置与自定义专家，并可新建一个自定义专家

#### Scenario: 编辑内置专家

- **WHEN** 操作员打开某个内置专家尝试修改 Soul 或白名单
- **THEN** 界面只提供「另存为自定义」，保存后产生新 id 的自定义专家，内置专家保持不变

#### Scenario: 保存后生效

- **WHEN** 操作员保存一个自定义专家
- **THEN** 专家的 preset 被重新编译，且宿主正在运行时被重启以加载新 preset

### Requirement: 工具白名单不强制注入技能目录

系统 MUST 只把 `list_experts` 作为专家工具白名单的强制项。`list_installed_skills` MUST NOT 被强制加入：仅当专家 `toolIds` 显式包含它时才可见。两者 MUST NOT 出现在可勾选工具列表中，`list_experts` 始终常开、`list_installed_skills` 由专家勾选。

#### Scenario: 专家未勾选技能目录

- **WHEN** 专家 `toolIds` 不含 `list_installed_skills`
- **THEN** 该专家的创意会话里不出现技能目录工具，但 `list_experts` 仍可用

#### Scenario: 专家勾选技能目录

- **WHEN** 专家 `toolIds` 含 `list_installed_skills`
- **THEN** 该专家的创意会话里可调用技能目录工具

## MODIFIED Requirements

### Requirement: 专家目录与持久化

系统 SHALL 把每个创意专家表达为宿主的一份 preset 与 persona：等价字段仍包含 `id`、`name`、`description`、`soul`、`skillIds`、`toolIds`。内置专家 SHALL 来自仓库 `experts/<id>/` 并在启动时同步到宿主配置；自定义专家 SHALL 持久化在宿主配置目录。同一 `id` 时自定义 MUST NOT 覆盖内置 id。

#### Scenario: 列举专家

- **WHEN** 操作员打开应用的「设置 → 创意专家」
- **THEN** 显示内置与自定义合并后的列表，按名称排序

#### Scenario: 保存自定义

- **WHEN** 操作员在应用设置中保存一个自定义专家
- **THEN** 再次打开设置可见该专家，且创意会话可选用

#### Scenario: 内置 id 不可覆盖

- **WHEN** 尝试写入与内置专家同 `id` 的自定义定义
- **THEN** 写入被拒绝，内置定义保持不变

### Requirement: 会话绑定专家

系统 SHALL 在会话创建时记录该会话使用的专家 preset 标识。空白会话 MUST 允许切换 preset；已开始过任务的会话 MUST NOT 再切换，并 SHOULD 持续显示创建时的专家显示名。专家选择 MUST 以宿主 preset 的身份存在，不额外维护独立的会话级专家字段。

#### Scenario: 绑定与清空

- **WHEN** 操作员在一个尚未发送消息的会话里选择专家或清空选择
- **THEN** 再次打开这个空白会话时专家选择与上次一致，开跑前可继续切换

#### Scenario: 空白会话切换

- **WHEN** 操作员在一个尚未发送消息的会话里切换专家
- **THEN** 该会话按新 preset 启动，后续任务使用新专家的 soul、技能与工具

#### Scenario: 已开始会话不可切换

- **WHEN** 会话已经产生过任务，操作员尝试切换专家
- **THEN** 切换不生效，会话继续使用创建时的 preset

#### Scenario: 会话列表标注

- **WHEN** 会话列表中某会话创建时选用了专家 preset
- **THEN** 该行显示对应专家的显示名
