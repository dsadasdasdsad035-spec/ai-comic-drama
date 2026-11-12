# Spec Delta

## ADDED Requirements

### Requirement: 景别运镜参照预览

镜头表或分镜 Inspector 在编辑 `size` 与 `move` 时 SHALL 展示当前 catalog 主参照或用户选定的 `lexiconRefKey` 对应视频预览，并允许更换为 catalog 内其他条目。

#### Scenario: 默认推镜头预览

- **WHEN** 镜头 `move=推` 且未设置 `lexiconRefKey`
- **THEN** 预览区展示 `01_dolly_in` 对应视频

#### Scenario: 更换参照不改枚举

- **WHEN** 用户将参照从主参照换为 `49_kubrick_push`
- **THEN** `move` 字段 MUST 保持「推」不变，仅更新 `lexiconRefKey`

### Requirement: 一键发布参照到画布

用户 MAY 从景别/运镜预览区将当前参照发布为画布视频素材卡；发布 MUST NOT 默认建立与分镜的参考连线。

#### Scenario: 发布参照卡

- **WHEN** 用户点击「发布参照到画布」
- **THEN** 画布新增一张 `video` 素材卡，标题含 catalog `cn` 或 `en`
