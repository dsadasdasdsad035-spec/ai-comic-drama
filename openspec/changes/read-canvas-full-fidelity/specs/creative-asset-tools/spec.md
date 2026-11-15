# Spec Delta

## MODIFIED Requirements

### Requirement: 范围外数据不得混入

系统 MUST NOT 在 `assets` 分类中返回磁盘媒体目录或分镜成片。`read_shots` 的读取形状与截断契约由 `shot-read-tools` 能力定义，本能力 MUST NOT 对其施加约束。

#### Scenario: 素材分类不含分镜成片

- **WHEN** agent 列出 `assets` 分类
- **THEN** 结果只含 `project.assets` 条目，不含 `shot.clip` 或磁盘 `videos` 目录

### Requirement: 既有细粒度读工具保持不变

系统 SHALL 保留 `read_characters`、`read_designs`、`list_camera_lexicon`、`get_camera_lexicon` 的过滤参数与语义。超限时的装填与截断标记由 `shot-read-tools` 能力定义，本能力 MUST NOT 对其施加约束。

#### Scenario: 既有工具仍可批量过滤

- **WHEN** agent 调用 `read_designs` 并传入 `kind` 与 `names`
- **THEN** 过滤结果与该能力引入前一致，仅截断标记形式按 `shot-read-tools` 处理
