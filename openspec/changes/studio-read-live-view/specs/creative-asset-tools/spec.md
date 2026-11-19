# Spec Delta: creative-asset-tools

## ADDED Requirements

### Requirement: 创意会话素材读工具合并画布素材卡实况

创意宿主会话中，`read_asset_inventory` 与 `read_asset_detail` 在读取落库 `project.assets`（及既有五类物料规则）之外，当存在与当前项目匹配的 `canvas-context` 且 `projectRevision` 校验通过时，MUST 将画布上的素材卡节点纳入计数与行列表：仅存在于画布尚未落库的卡 MUST 出现在 `assets` 计数与 `includeRows` 结果中；落库与节点并存的卡 MUST 以节点标题、kind、url 覆盖展示字段，使 `key` 与 `read_asset_detail` 仍可解析。`projectRevision` 不一致时 MUST 仅读落库，行为与无实况推送时相同。

#### Scenario: 未落库新素材卡出现在 inventory

- **WHEN** 用户在画布新增素材卡但未等防抖落库，浏览器已推送 revision 一致的实况，专家调用 `read_asset_inventory` 且 `category: assets`、`includeRows: true`
- **THEN** 返回行中包含该卡的标题与可用于 `read_asset_detail` 的 key

#### Scenario: 写回素材后不被旧节点名录盖住

- **WHEN** 专家或用户通过写工具改动了 `project.assets` 中某条的标题并落库，实况 revision 滞后
- **THEN** `read_asset_detail` 返回落库标题，而不是过期实况中的旧标题

#### Scenario: 无实况时行为不变

- **WHEN** 未推送 `canvas-context` 或项目名不匹配
- **THEN** `read_asset_inventory` 与 `read_asset_detail` 仅反映 SQLite 项目数据，与变更前一致