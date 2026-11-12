# Spec Delta

## REMOVED Requirements

### Requirement: 参考内容按类型可浏览和选择

**Reason**: 3D 工作台不再提供按镜头持久化的「参考内容」选择器。

**Migration**: 使用 3D 聊天、VGGT 摘要粘贴与 Blender 代码编辑；分镜出片参考仍通过画布素材连线。

### Requirement: 场景和道具可选择设定与图像

**Reason**: 同上。

**Migration**: 同上。

### Requirement: 图片和视频选择前必须可预览

**Reason**: 同上。

**Migration**: 同上。

### Requirement: 镜头文本可按项选择

**Reason**: 同上。

**Migration**: 将需要的台词或描述手动输入聊天。

### Requirement: 选择结果按镜头持久化

**Reason**: 移除 `shot_3d_context` 持久化。

**Migration**: 重要参考通过聊天线程或项目 assets 自行管理。

### Requirement: 默认选择与沿用上一镜

**Reason**: 同上。

**Migration**: 无自动默认；每镜打开工作台不恢复参考勾选。

### Requirement: 选择内容必须真正进入生成和聊天

**Reason**: 代码生成与聊天不再消费 `Shot3DContext`。

**Migration**: 依赖用户消息与当前 `sceneCode`。

### Requirement: 选中图片进入媒体理解 brief

**Reason**: 移除基于选择的媒体 brief 管线。

**Migration**: 可选在聊天中上传图片（会话级）若产品启用 unified 附件。

### Requirement: 选中视频以关键帧进入聊天

**Reason**: 同上。

**Migration**: VGGT 仅分析调度片或摄取 MP4，摘要以文本进聊天。

### Requirement: 媒体理解能力必须显式配置并可回退

**Reason**: 与选择器 brief 绑定，随能力移除。

**Migration**: 设置中视觉环节仍可供其他工作台使用。

### Requirement: 媒体选择有数量、尺寸和隐私边界

**Reason**: 同上。

**Migration**: 聊天会话附件沿用全局聊天上限（若启用）。

### Requirement: 选择变化必须可见且不静默改代码

**Reason**: 无参考选择即无「上下文已变化」语义。

**Migration**: 代码变更仅来自用户保存、渲染或 Agent 采纳。

### Requirement: 3D 工作台提供参考视频摄取入口

**Reason**: 摄取保留在 VGGT 面板，不再作为「参考内容」入口。

**Migration**: 使用工作台 VGGT 区的链接/上传摄取。
