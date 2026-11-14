# Spec Delta

## ADDED Requirements

### Requirement: 画布当前集只从项目存档恢复

系统 SHALL 在用户打开某项目时，将画布「当前集」`epNo` 恢复为该项目的画布 localStorage 存档中所记录的 `epNo`（若存在且在项目集号范围内）。系统 MUST NOT 用未绑定项目名的全局画布存档覆盖该值。集号范围 MUST 由 `episodes[]` 与 `shots[].episode` 的并集确定。

#### Scenario: 项目 B 的停留集不被项目 A 污染

- **WHEN** 用户曾在项目 A 的集 3 工作，随后打开项目 B（存档记录集 2）
- **THEN** 顶栏与画布当前集为 2，而非 3

#### Scenario: 存档集号超出范围时钳制

- **WHEN** 项目仅有 1–2 集，存档中 `epNo` 为 5
- **THEN** 系统打开后当前集钳制到合法范围（例如 2），并仍能显示该集镜头

### Requirement: 画布可见镜头按 episode 过滤

画布 SHALL 仅显示 `episode` 等于当前集 `epNo` 的正式镜头节点；无 `shotId` 的实验卡 MUST 始终显示。切换当前集后 MUST 立即更新可见节点集与集级摘要，并 SHOULD 将视口对焦到当前集镜头。

#### Scenario: 切集隐藏其他集

- **WHEN** 用户从集 1 切到集 2
- **THEN** 画布只显示集 2 的正式镜头（及无 shotId 的卡），集 1 卡片不可见

#### Scenario: 实验卡不受集过滤

- **WHEN** 画布存在无 `shotId` 的节点
- **THEN** 该节点在任意当前集下仍可见

### Requirement: 分镜卡集标与 episode 一致

分镜卡头上展示的集标签 MUST 格式化为 `E` + 两位集号，且 MUST 与节点 `data.episode`（缺省按 1）一致。系统 MUST NOT 单独截取 `shotId` 前缀且不与 `episode` 交叉校验。

#### Scenario: 一致时显示

- **WHEN** `shotId` 为 `E02-S03` 且 `episode` 为 2
- **THEN** 卡头集标签显示 `E02`

#### Scenario: 漂移时以 episode 为准

- **WHEN** `shotId` 前缀为 `E01` 但 `episode` 为 2
- **THEN** 卡头集标签显示 `E02`，并在落库路径上修复 `id` 为 `E02-{镜号}`（见正式镜头标识不变式）

### Requirement: 正式镜头标识与集号不变式

对每个 `project.shots` 条目，若存在 `id` 与 `no` 且 `episode` 为正整数，系统 MUST 维持 `id === E{pad(episode)}-{no}`。在水合画布、写回项目或改镜号/改集时若检测到不一致，系统 SHALL 按 `episode` 与 `no` 重建 `id` 并同步节点 `shotId`，MUST NOT 静默保留分裂状态。

#### Scenario: 导入后不变式成立

- **WHEN** 向集 2 导入或新增镜头 `S05`
- **THEN** 写入项目的 `id` 为 `E02-S05` 且 `episode` 为 2

#### Scenario: 改集后 id 跟随

- **WHEN** 用户把镜头改到集 3（合法路径）
- **THEN** `episode` 更新为 3，`id` 更新为 `E03-{镜号}`，画布节点 `shotId` 同步
