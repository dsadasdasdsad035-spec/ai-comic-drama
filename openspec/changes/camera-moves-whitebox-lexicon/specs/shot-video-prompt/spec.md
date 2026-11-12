# Spec Delta

## ADDED Requirements

### Requirement: 提示词引用 catalog 术语

写 `video_prompt` 时，若镜头存在 `lexiconRefKey` 或命中主参照，拼装层 MUST 在运镜句中使用对应 catalog `en` 字段；若无参照，仍使用镜头 `move`/`size` 文本。

#### Scenario: 有 lexicon 参照的运镜句

- **WHEN** 镜头 `lexiconRefKey=01_dolly_in` 且生成运动提示词
- **THEN** 正文包含「Dolly In」或等价英文运镜短语

#### Scenario: 无参照回退

- **WHEN** 无 `lexiconRefKey` 且 move=推
- **THEN** 拼装仍生成可读的推镜头描述，不失败
