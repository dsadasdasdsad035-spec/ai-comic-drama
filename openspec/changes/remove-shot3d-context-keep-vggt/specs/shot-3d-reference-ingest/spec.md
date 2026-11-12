# Spec Delta

## REMOVED Requirements

### Requirement: 项目镜头参考摄取 API

**Reason**: 能力合并进 `scene-blocking-3d` 的 VGGT 摄取条款；不再服务镜头 context。

**Migration**: 继续调用同名或等价 ingest 路由，仅落盘 assets 并供 VGGT 会话使用。

### Requirement: 摄取产物为项目内持久资产

**Reason**: 行为保留但不再由本 capability 单独定义。

**Migration**: 见 `scene-blocking-3d` 中 VGGT 摄取需求。

### Requirement: 摄取结果默认不自动写入调度真相

**Reason**: 同上。

**Migration**: 摄取仍不得写 `sceneCode` / `schedule_video`；不得写 `shot_3d_context`。

### Requirement: 与 VGGT 分析衔接

**Reason**: 同上。

**Migration**: 摄取 URL 仅进入 VGGT 分析下拉，不进入素材选择器或 context。
