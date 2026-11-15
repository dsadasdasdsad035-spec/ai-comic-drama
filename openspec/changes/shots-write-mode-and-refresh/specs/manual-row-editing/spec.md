# Spec Delta

## MODIFIED Requirements

### Requirement: 画布可删除镜头

画布 SHALL 提供「删除此镜」。删除 MUST 是显式动作并需要确认；确认后该镜 MUST 从项目镜头数据中移除，MUST NOT 仅被标记为 `orphan`。删除 MUST 提交显式删除意图，MUST NOT 依赖「列表里少了一镜」推断删除。

#### Scenario: 删除一镜

- **WHEN** 用户删除第 3 镜并确认
- **THEN** 重新读取项目后该镜不存在，`project.json` 的 `shots` 里也没有它

#### Scenario: 删除需要确认

- **WHEN** 用户点删除
- **THEN** 系统先确认；取消时项目与画布都不变

#### Scenario: 删除有产物的镜头

- **WHEN** 被删的镜头已有首帧图、成片或配音
- **THEN** 确认框明确列出这些产物，删除后项目数据不引用它们，媒体文件保留由既有清理脚本处理

#### Scenario: 不通过缺席推断删除

- **WHEN** 整表写回缺少某镜，且没有显式删除意图
- **THEN** 该镜仍被标记为 `orphan` 并保留，不被删除

#### Scenario: 局部写回不产生孤儿

- **WHEN** 一次写回只提交部分镜头，且未声明是整表提交
- **THEN** 未提交的镜头保持原样、不被删除，且不带 `orphan` 标记

## ADDED Requirements

### Requirement: 镜头写回区分局部与整表

写回镜头的请求 MUST 声明本次提交是局部还是整表，缺省 MUST 按局部处理。局部写回 MUST NOT 给未提交的镜头加任何标记；整表写回 MUST 保留未提交的镜头并标记为 `orphan`（保护性保留，不删除）。

#### Scenario: 单镜写回不波及其他镜头

- **WHEN** `link_shot_refs` 只提交一镜的参考连线
- **THEN** 该镜 `refIds` 更新，其余镜头的字段与标记都不变

#### Scenario: 画布单镜编辑的防抖写回

- **WHEN** 用户在画布只改了一镜的时长
- **THEN** 只有该镜被写回，其余镜头不带 `orphan`

#### Scenario: 整表写回仍保护缺席镜头

- **WHEN** 整表写回声明为整表，但列表里少了一镜，且没有显式删除该镜
- **THEN** 该镜被保留并标记 `orphan`，不被删除

#### Scenario: 导入只影响文件覆盖的集

- **WHEN** 导入的分镜表只包含第 1 集
- **THEN** 第 2 集及以后的镜头保持原样，不带 `orphan`

### Requirement: 历史孤儿标记一次性清理

系统 MUST 一次性清除升级前已存在的镜头 `orphan` 标记，并以持久标记记录清理已执行；该清理 MUST 幂等。清理执行后由整表写回新产生的 `orphan` MUST 保留，不被重复清理。

#### Scenario: 升级后旧标记消失

- **WHEN** 升级后首次读取任一项目
- **THEN** 升级前带 `orphan` 的镜头不再带该标记，重复读取结果相同

#### Scenario: 清理不影响新标记

- **WHEN** 清理已执行过，随后一次整表写回缺了一镜
- **THEN** 该镜仍被标记 `orphan`
