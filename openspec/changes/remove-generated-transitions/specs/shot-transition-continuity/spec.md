# Spec Delta

## REMOVED Requirements

### Requirement: 自动正文追加衔接约束

**Reason**: 该约束的唯一用途是拼装生成转场的出片正文。生成转场退役后不存在转场正文这一对象。

**Migration**: 旧 `generated.prompt` 中由系统追加的衔接段保留在历史数据里、不再展示或发送。相邻两镜的衔接意图改由分镜正文自身表达。

### Requirement: 手改正文优先

**Reason**: 没有转场正文就没有「手改正文优先」这条规则。

**Migration**: 旧 `generated.videoPromptOverride` 不再读取；分镜自身的视频提示词手改行为保持不变。

### Requirement: 效果转场不受影响

**Reason**: 该要求的作用是守住效果转场不被生成转场的衔接逻辑污染；生成转场删除后，效果转场成为唯一的接缝形态，这条保护性要求失去对立面，其内容已被 `shot-transition-seams` 完整覆盖。

**Migration**: 无。效果转场的叠化、擦除、推移与拼接行为不变。
