# Spec Delta

## Purpose

让原生工具的一次写入在模型单次输出受限时仍能完成：分批提交、游标续写、按业务键幂等合并，并把「一次提交太大」变成模型可执行的下一条指令，而不是契约校验失败。

## ADDED Requirements

### Requirement: 写入工具接受可选游标与单次条数上限

写入类工具 SHALL 接受可选的 `cursor` 与 `limit` 参数，并在回执中返回 `nextCursor`、`accepted`、`remaining`。`cursor` 缺省时 MUST 等价于从第一批开始；`limit` 缺省时 MUST 使用该工具的默认单批条数。`remaining` 为零或 `nextCursor` 缺省 MUST 表示没有后续批次。

#### Scenario: 分批写回与一次写回等价

- **WHEN** 模型用同一份数据分三批写回，每批带上一批返回的 `nextCursor`
- **THEN** 最终落库结果与一次写回全部数据完全一致，镜号、顺序与字段取值均相同

#### Scenario: 不传游标

- **WHEN** 模型只提交数据、不传 `cursor` 与 `limit`
- **THEN** 系统按默认单批条数处理，并在回执中给出 `remaining` 与后续批次入口

#### Scenario: 最后一批

- **WHEN** 模型提交最后一批后回执中 `remaining` 为零
- **THEN** 回执明确表示写入已完成，模型不需要再发起提交

### Requirement: 分批写入必须按业务键幂等

分批写回 SHALL 按各契约的业务键（如镜号、素材 key）合并，MUST NOT 因批次顺序或重复提交产生重复条目。后续批次 MUST 覆盖同一业务键的字段，MUST NOT 丢弃先前批次已写入的其它字段。

#### Scenario: 重复提交同一批

- **WHEN** 模型因重试再次提交已经写入的同一批数据
- **THEN** 落库条目数量不变，字段取值仍为最后一次提交的内容

#### Scenario: 后续批次修正先前条目

- **WHEN** 第一批写入某镜的 `desc`，第二批只提交该镜的 `video_prompt`
- **THEN** 该镜同时保留第一批的 `desc` 与第二批的 `video_prompt`

### Requirement: 单次提交超限必须给出可执行拆批回执

当一次写入的 payload 超过该工具的单次上限时，系统 SHALL 返回结构化回执，包含失败原因、建议单批条数与下一步调用方式。系统 MUST NOT 以「不符合契约」或「参数不是合法 JSON」结束，MUST NOT 静默丢弃超出部分。

#### Scenario: payload 超过单次上限

- **WHEN** 模型一次提交 30 镜且超过该工具的单次上限
- **THEN** 回执说明单次上限与建议拆批条数，并指示用 `limit` 与 `cursor` 分批提交，不产生任何部分写入

#### Scenario: 模型据回执拆批后成功

- **WHEN** 模型按回执建议拆成多批重新提交
- **THEN** 各批依次写入成功，回执汇总每批的 `accepted` 与最终 `remaining`

### Requirement: 游标必须由宿主签发

`cursor` SHALL 由宿主生成并保持在同一编辑状态内稳定。模型 MUST NOT 自造游标；系统 MUST 拒绝无法识别的游标，并在回执中给出获取合法游标的入口。

#### Scenario: 模型自造游标

- **WHEN** 模型传入一个未被宿主签发过的 `cursor`
- **THEN** 系统拒绝该批并说明如何通过读取工具取得合法游标

#### Scenario: 编辑状态变化后旧游标

- **WHEN** 项目数据在批次之间被用户或其它工具改动，模型继续使用旧游标
- **THEN** 系统拒绝该批并提示重新读取后再继续，不按过期游标写入
