# Spec Delta

## REMOVED Requirements

### Requirement: 参考内容按类型可浏览和选择

**Reason**: 3D 工作台的「参考内容」选择面板已删除，分镜不再保存参考选择。

**Migration**: 需要素材时在画布连线角色/素材或把视频素材连到分镜；白模工作台只用项目素材路径，不维护选择清单。

### Requirement: 场景和道具可选择设定与图像

**Reason**: 选择清单整体退役。

**Migration**: 无。场景/道具设定仍可作为画布素材卡参与出图出片。

### Requirement: 图片和视频选择前必须可预览

**Reason**: 选择清单整体退役。

**Migration**: 预览能力保留在素材选择器与画布连线，不在 3D 工作台重复实现。

### Requirement: 镜头文本可按项选择

**Reason**: 文本附件不再注入 3D 代码生成。

**Migration**: 需要把台词或画面描述告诉模型时，直接写进聊天。

### Requirement: 选择结果按镜头持久化

**Reason**: `shot_3d_context` 字段删除。

**Migration**: 旧项目该字段被忽略；不再写入。

### Requirement: 默认选择与沿用上一镜

**Reason**: 选择清单整体退役。

**Migration**: 无。

### Requirement: 选择内容必须真正进入生成和聊天

**Reason**: 选择清单整体退役。

**Migration**: 白模代码生成只接收条目自身的标题、时长、画幅与运行素材。

### Requirement: 选中图片进入媒体理解 brief

**Reason**: 分镜级媒体 brief 不在 3D 链路生成。

**Migration**: 素材简要理解仍服务于创意会话与其它工作台，不进入白模代码。

### Requirement: 选中视频以关键帧进入聊天

**Reason**: 选择清单整体退役。

**Migration**: 需要几何参考时用「几何」页签的 VGGT 分析并把摘要贴进聊天。

### Requirement: 媒体理解能力必须显式配置并可回退

**Reason**: 该要求服务于已删除的引用内容选择。

**Migration**: 视觉模型配置保留在设置页，供其它工作台使用。

### Requirement: 媒体选择有数量、尺寸和隐私边界

**Reason**: 选择清单整体退役。

**Migration**: 素材上限由 `scene-code-runtime` 的「代码资源有明确上限」覆盖。

### Requirement: 选择变化必须可见且不静默改代码

**Reason**: 选择清单整体退役。

**Migration**: 无。

### Requirement: 3D 工作台提供参考视频摄取入口

**Reason**: 摄取入口迁到白模工作台「几何」页签，由 `shot-3d-reference-ingest` 定义。

**Migration**: 见 `shot-3d-reference-ingest`。
