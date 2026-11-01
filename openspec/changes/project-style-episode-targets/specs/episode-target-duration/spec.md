# Spec Delta

## Purpose

让每集成片目标时长持久化在分集对象上、集与集可不同，并在剧本、镜头表与 Agent 拆镜中使用同一字段。

## ADDED Requirements

### Requirement: 每集持久化目标时长

系统 SHALL 在每集分集对象上存储 `targetSeconds`（正数，单位秒）。各集 MAY 取值不同；MUST NOT 依赖单一「全剧每集时长」顶栏 state 作为 shotlist 的唯一来源。

#### Scenario: 两集不同时长

- **WHEN** 第 1 集 `targetSeconds` 为 45、第 2 集为 90 且用户保存项目
- **THEN** 重新加载后两集字段仍分别为 45 与 90

### Requirement: 剧本与镜头表编辑同一字段

系统 SHALL 允许用户在剧本分集视图与镜头表顶栏（当前集）编辑该集的 `targetSeconds`；两处 MUST 读写同一分集字段，保存后 MUST 一致。

#### Scenario: 在剧本改时长后在镜头表查看

- **WHEN** 用户在剧本页将第 3 集目标时长改为 72 并保存
- **THEN** 用户切换到镜头表第 3 集时顶栏目标时长显示 72

#### Scenario: 在镜头表改时长后在剧本查看

- **WHEN** 用户在镜头表第 2 集将目标时长改为 55 并保存到项目分集数据
- **THEN** 剧本页第 2 集卡片上显示 55

### Requirement: 分镜 Agent 使用当前集目标时长

系统 SHALL 在镜头表 Agent 组装 `shotlist` 任务输入时，将 `target` 设为当前集 `targetSeconds`（经统一解析）；底部「总时长 / 目标 Xs」中的 X MUST 与同一解析结果一致。

#### Scenario: 当前集 88 秒

- **WHEN** 用户在第 2 集镜头表打开 Agent 且该集 `targetSeconds` 为 88
- **THEN** 本轮任务卡包含「目标总时长 88 秒」且进度条目标线为 88

### Requirement: 拆集输出可带每集时长

系统 SHALL 在从零拆集或改稿合并时，允许每集 JSON 携带 `targetSeconds`。Agent 拆集 SHOULD 为每集估算并输出该字段；集与集 MAY 不同。

#### Scenario: 拆集后每集有时长

- **WHEN** 用户通过 script Agent 成功拆出 3 集且模型返回每集均含 `targetSeconds`
- **THEN** 剧本主区域三集均显示各自目标时长

### Requirement: 合并时保留已有分集时长

系统 SHALL 在合并剧本草稿按集替换时，若 incoming 集对象未提供 `targetSeconds`，MUST 保留 current 中该集已有 `targetSeconds`，MUST NOT 静默清空。

#### Scenario: 改稿未带时长字段

- **WHEN** 第 1 集已有 `targetSeconds` 60，模型 submit 只更新场次未带 `targetSeconds`
- **THEN** 合并后第 1 集仍为 60

### Requirement: 缺失字段的读取默认

系统 MAY 在分集缺少 `targetSeconds` 时于 UI 与解析使用单一产品默认（如 60）以便编辑与展示；该默认 MUST NOT 写入持久数据，直到用户显式编辑或保存带出该字段。

#### Scenario: 老项目无字段

- **WHEN** 加载的项目分集无 `targetSeconds`
- **THEN** 界面显示可编辑的默认目标时长，用户未改且未保存前 project 文件仍无该键
