# Spec Delta

## MODIFIED Requirements

### Requirement: 顶栏仍提供拆集参数

剧本视图上下文带的设置段 SHALL 继续提供集数与环节模型选择；MUST NOT 再提供「全剧一个每集目标时长」作为唯一时长参数。每集目标时长 MUST 在分集结构上按集展示与编辑（`targetSeconds`），并随剧本保存写入项目。拆集 Agent 输入 MAY 仍包含节奏提示，但 shotlist 与进度对齐 MUST 使用各集持久化的 `targetSeconds`。

#### Scenario: 调整集数后拆集

- **WHEN** 用户修改顶栏集数后从 Agent 运行「生成分集」
- **THEN** 请求使用更新后的集数参数

#### Scenario: 顶栏无全剧时长

- **WHEN** 用户查看剧本视图上下文带设置段
- **THEN** 不出现单独的「每集目标时长」数字框表示全剧统一值

#### Scenario: 分集卡片有时长

- **WHEN** 项目已有分集且某集 `targetSeconds` 为 75
- **THEN** 剧本主区域该集可见可编辑的目标时长为 75

## ADDED Requirements

### Requirement: 分集展示目标时长

剧本主区域 SHALL 为每个分集提供目标时长（秒）的展示与编辑，写入该集 `targetSeconds`；保存剧本 MUST 持久化到项目 `episodes`。

#### Scenario: 编辑单集时长

- **WHEN** 用户将第 2 集目标时长改为 90 并保存剧本
- **THEN** 项目第 2 集 `targetSeconds` 为 90
