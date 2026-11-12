# Spec Delta

## REMOVED Requirements

### Requirement: 生成失败不得覆盖有效调度

**Reason**: 该要求约束的是分镜级 3D 调度会话；白模工作台的失败保留行为由 `scene-code-runtime` 承担。

**Migration**: 失败、超时、取消不得清空已有代码与视频，改由 `scene-code-runtime` 的「代码失败不得覆盖上一版」保证。

### Requirement: 编辑器保存必须限定当前项目与镜头

**Reason**: 白模不再按镜头保存，保存对象是项目级镜头语言条目。

**Migration**: 保存只写当前项目的白模条目，不触碰任何分镜字段。

### Requirement: 渲染时长与画幅匹配出片有效参数

**Reason**: 合并进 `scene-code-runtime` 的同名规则，不再声称「出片时长」。

**Migration**: 白模条目自带时长，渲染时长与画幅按条目时长与项目画幅执行。

### Requirement: 渲染输出区分干净预演与审阅标注

**Reason**: 并入 `scene-code-runtime` 的「渲染使用条目有效时长和画幅」中的 clean/review 约束。

**Migration**: 导出仍固定 `clean`，预览可用 `review` 并标注仅审阅。

### Requirement: 渲染过期由输入指纹判定并阻止静默复用

**Reason**: 并入 `scene-code-runtime` 的「代码与素材指纹决定过期」，且不再有「3D 调度视图」承载状态。

**Migration**: 过期状态在白模条目卡片与工作台命令栏显示。

### Requirement: 旧调度数据与下游参考通路保持兼容

**Reason**: 分镜上的旧调度字段整体废弃，系统不再读取它们。

**Migration**: 旧项目里的 `shot_scene` / `shot_blocking` / `schedule_video` 留在库中但被忽略；需要运镜参照时改用白模渲染的视频素材卡。

### Requirement: 旧场次布局迁移为每镜副本

**Reason**: 项目级 `sceneLayouts` 与「转换为 Blender 代码」入口一并移除。

**Migration**: 不再提供旧布局到代码的迁移；白模从空白模板或模型生成开始。

### Requirement: 打开 3D 即准备生成，一键完成

**Reason**: 不再有「打开某镜的 3D 工作台」这个动作。

**Migration**: 白模工作台从新建条目打开，首次不自动生成代码。

### Requirement: 聊天只修改当前镜头的 3D

**Reason**: 聊天作用域从镜头改为白模条目。

**Migration**: 聊天只改当前白模条目的代码，不影响其他条目与任何分镜。

### Requirement: 生成来源和视觉使用必须可见

**Reason**: 该要求包含「参考内容选择」与「视觉 brief 参与」两部分，参考选择已退役；来源与试运行可见性并入 `scene-code-runtime`。

**Migration**: 命令栏继续显示代码来源、哈希与试运行状态；不再显示选中参考。

### Requirement: 旧项目和旧视频保持可打开

**Reason**: 旧结构化镜头与旧调度视频不再是可打开对象。

**Migration**: 旧项目打开时忽略这些字段，不显示只读说明或转换入口。

### Requirement: 3D 调度以每镜 Blender Python 代码为场景真相

**Reason**: 代码归属改为项目级白模条目。

**Migration**: 见 `scene-code-runtime` 的「条目代码是唯一场景真相」。

### Requirement: 工作台采用参考内容、预览和聊天/代码三栏布局

**Reason**: 左栏参考内容已删除，布局改为预览主栏 + 工作侧栏三页签。

**Migration**: 工作台只有「舞台预览」与「对话 / 代码 / 几何」侧栏。

### Requirement: 聊天返回完整代码并可试运行

**Reason**: 行为不变，但归属从镜头改为白模条目，并入 `scene-agent-chat-ui` 与 `scene-code-runtime`。

**Migration**: 聊天仍返回完整代码，试运行通过后才应用。

### Requirement: 旧结构化镜头只读并可显式转换

**Reason**: 旧结构化数据不再读取，转换入口删除。

**Migration**: 无。旧数据留在库中不再使用。

### Requirement: 结构性校验缺失必须明确提示

**Reason**: 该提示属于工作台行为，随白模工作台保留在实现层，不再作为按镜调度要求。

**Migration**: 工作台脚注继续说明纯代码模式不做名单、碰撞或连续性校验。

### Requirement: 已开启的 3D 参考开关可以随时取消

**Reason**: `useScheduleVideoRef` / `useScheduleFrames` 开关随字段删除。

**Migration**: 需要运镜参照时把白模视频发布成素材卡并显式连线。

### Requirement: 3D 调度顶栏视图入口

**Reason**: 顶栏「3D 调度」视图已删除。

**Migration**: 入口改为「素材 → 镜头语言 → 自定义白模」。

### Requirement: 3D 调度视图显示状态与预览

**Reason**: 该视图不存在。

**Migration**: 条目卡片显示是否有 MP4，工作台内回看视频。

### Requirement: 3D 调度列表只展示调度域字段

**Reason**: 该视图不存在。

**Migration**: 无需迁移。

### Requirement: Agent 宿主探索不单独构成调度真相

**Reason**: 描述对象是镜头调度字段。

**Migration**: 白模工作台仍是「显式保存或 finish 采纳」才更新条目代码与视频。

### Requirement: 参考视频摄取不构成调度真相

**Reason**: 该要求提到的 `Shot3DContext` 草稿已删除。

**Migration**: 见 `shot-3d-reference-ingest` 的摄取边界。

### Requirement: 摄取与 VGGT 串联的界面边界

**Reason**: 界面位置迁到白模工作台「几何」页签。

**Migration**: 见 `shot-3d-reference-ingest`。
