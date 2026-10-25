# Spec Delta

## ADDED Requirements

### Requirement: 外壳上沿在两套主题下保持层级

两套主题下，全局带与视图上下文带 MUST 使用不同的表面色并可区分，二者之间以及外壳与内容之间 MUST 有可见边界。日间主题 MUST NOT 让上沿与内容连成一片。

#### Scenario: 日间上沿

- **WHEN** 用户在日间主题下打开任一项目视图
- **THEN** 全局带与上下文带呈现不同的浅色表面，且下边界清晰可见

#### Scenario: 夜间上沿

- **WHEN** 用户在夜间主题下打开任一项目视图
- **THEN** 全局带保持最高层级表面，上下文带与其区分，内容区不被误认为同一条带

## MODIFIED Requirements

### Requirement: 提供夜间与日间两套主题

系统 SHALL 提供 Night 与 Day 两套主题；Night MUST 保持当前 Cinema Dark 的视觉与布局，Day MUST 使用暖纸底与深色文字而非简单反色。全局带、集选择器、视图上下文带、画布、分镜卡、Inspector、时间线、菜单和 Toast MUST 从同一套语义主题取值。

#### Scenario: 夜间保持现状

- **WHEN** 用户处于夜间主题
- **THEN** 主要表面、文字、强调色和布局与当前深色工作台一致

#### Scenario: 日间覆盖全界面

- **WHEN** 用户切到日间主题
- **THEN** 全局带、集选择器、上下文带、画布、卡片、Inspector、时间线和浮层都变为浅色表面，不残留深色区块
