## MODIFIED Requirements

### Requirement: AI 重写不覆盖手改提示词

手改记录 MUST 作为镜头的手改字段参与重新拆镜和提示词重写合并；模型重新生成 `video_prompt` 时 MUST 保留手改正文，直到用户主动恢复自动拼装。

#### Scenario: 重新生成提示词

- **WHEN** 用户在镜头表或通过 Inspector 关联的出片流程重新生成该镜头的 `video_prompt`
- **THEN** 该镜头的手改正文保持不变，面板继续显示手改版本
