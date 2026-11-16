# Spec Delta

## ADDED Requirements

### Requirement: 创意会话的出片输入上下文与画布一致

创意会话（Pi）中的出片输入类读取工具 MUST 拿到与画布内聊天同源的上下文：镜头节点、素材卡节点、角色表、缺失媒体集合、当前选中的视频模型与分辨率。适配器提供该上下文时 MUST 原样使用；未提供时系统 MUST 按项目快照重建分镜节点与素材卡节点，使 `shot.refIds` 里的 `asset-<canvasId>` token 仍能解析。

任一读取工具 MUST NOT 因缺少宿主上下文而静默丢弃参考项：无法解析的参考 MUST 要么解析成条目，要么作为缺失项出现在返回值的 omitted 中。

#### Scenario: Pi 会话读到素材卡参考

- **WHEN** 镜头 `refIds` 含 `char-陈默` 与 `asset-cv1`，素材卡 `cv1` 存在于项目 `assets`，创意会话未提供画布节点
- **THEN** `read_shot_video_inputs` 返回两条参考，`asset-cv1` 解析为对应素材卡的标题与用途，MUST NOT 只返回角色一条

#### Scenario: 有宿主上下文时以宿主为准

- **WHEN** 适配器提供了包含未保存画布改动的节点与选中的视频模型
- **THEN** 工具返回的参考顺序、输入模式与秒数与画布内出片预览一致
