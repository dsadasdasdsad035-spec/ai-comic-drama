# Spec Delta

## ADDED Requirements

### Requirement: 参考视频摄取不构成调度真相

参考视频摄取（平台链接或上传）的成功、失败或进行中，系统 MUST NOT 写入或覆盖当前镜头的 `sceneCode`、`schedule_video`、`scheduleMeta` 或等价调度字段。摄取仅准备 `Shot3DContext` 草稿中的站内视频 URL。

#### Scenario: 摄取后不自动渲染

- **WHEN** 摄取完成并加入参考
- **THEN** 不触发 `run_render`，调度视频状态不变

#### Scenario: 摄取失败保留调度

- **WHEN** 摄取失败
- **THEN** 已有代码、调度视频与参考选择（除用户显式改动的草稿部分外）保持有效

### Requirement: 摄取与 VGGT 串联的界面边界

工作台 MUST 区分「下载参考视频」「几何分析（实验）」「渲染调度视频」三者的语义；摄取不得暗示已保存调度或已通过验收。

#### Scenario: 文案区分

- **WHEN** 用户完成平台下载
- **THEN** 界面不出现「已更新调度视频」类表述，仅提示已加入参考（未保存）或可进行 VGGT
