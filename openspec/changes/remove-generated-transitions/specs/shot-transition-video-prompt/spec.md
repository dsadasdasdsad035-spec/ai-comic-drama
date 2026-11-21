# Spec Delta

## REMOVED Requirements

### Requirement: 转场出片只有一个拼装结果

**Reason**: 生成转场整条链路退役，不存在「转场出片请求」这一对象，也不再有需要保证逐字一致的最终提示词。两镜之间的过渡只由效果预设与时长定义。

**Migration**: 旧数据里的 `transition_out.generated`（含 `prompt`、`soundPrompt`、`videoPromptOverride`）保留可读但不再参与任何渲染或请求；用户修改该连线时写回只保留 `effect`。需要两镜之间的生成画面时，改为在分镜上单独出片，或在两镜之间插入一个独立镜头。

### Requirement: 结构锚点可见且可校正

**Reason**: 首帧与尾帧槽位只为图生视频转场存在，生成转场退役后没有消费方。

**Migration**: 已保存的 `generated.boundary` 保留在旧数据中、不再展示；镜头级的首帧/尾帧素材能力与抽帧接口继续可用，不受影响。

### Requirement: 风格参考可继承、排除与增补

**Reason**: 参考图与参考视频只用于生成转场的视频请求，随生成链一起去掉。

**Migration**: 旧 `generated.refIds` / `excludeRefIds` 不再读取。需要给镜头提供参考时，改为给相邻镜头本身连线角色或素材卡。

### Requirement: 提示词分层与手改全文

**Reason**: 没有生成转场就没有转场提示词，分层文本、手改快照与旧快照提示失去对象。

**Migration**: 旧 `generated.videoPromptOverride` 与 `renderedPrompt` 保留在历史数据里不再展示；镜头自身的视频提示词分层与手改行为完全不变。

### Requirement: 条件过期提示

**Reason**: 「失效」的判定对象是生成产物与相邻镜边界的关系；转场不再产出视频，也就没有可失效的产物。

**Migration**: 旧 `transition_out.meta.fingerprint` 保留但不再比较、不再显示「需要重生成」。连线状态只剩「已参与成片」与「未参与成片」两种。

### Requirement: 转场共用分镜出片提示词面板

**Reason**: 转场面板不再有出片区，共享提示词面板在转场侧没有承载物。

**Migration**: 分镜视频 Tab 的「本次出片提示词」面板保持原样。

### Requirement: 转场生成前校验与反馈对齐分镜

**Reason**: 生成入口被删除，提交前校验链一并消失。

**Migration**: 无。旧数据无需迁移。

### Requirement: 转场 blocking 与 warning 结构

**Reason**: blocking / warning 是对出片请求的前置判定，随出片入口一起移除。

**Migration**: 无。旧数据无需迁移。

### Requirement: 手改时分层输入 footnote

**Reason**: 层分输入字段本身已删除，footnote 无处附着。

**Migration**: 无。旧数据无需迁移。

### Requirement: 转场参考与边界高级编辑

**Reason**: 参考继承开关、排除增补、边界手填与「抽取两镜成片帧」全部服务于生成请求。

**Migration**: 「抽取两镜成片帧」入口消失；镜头首帧/尾帧素材的抽取与引用能力保留。

### Requirement: 转场出片底栏主操作

**Reason**: 接缝设置不再有底栏与主生成按钮，取消生成这一例外行为不复存在。

**Migration**: 正在生成的转场任务在升级后不再可取消；远端任务若仍在跑，其产物不会被写回任何位置。

### Requirement: 出片信息分区顺序

**Reason**: 被排序的分区（估价、成片预览、模型行、原生音频、提示词面板）已全部从接缝设置移除。

**Migration**: 无。旧数据无需迁移。

### Requirement: blocking 可执行引导

**Reason**: 没有 blocking 就没有引导。

**Migration**: 无。旧数据无需迁移。

### Requirement: 生成不自动覆盖手选边界

**Reason**: 边界帧不再被提交，也就不存在自动抽帧覆盖用户选择的风险。

**Migration**: 无。旧数据无需迁移。

### Requirement: 首尾帧槽位显示来源

**Reason**: 槽位与来源标签随生成区一起移除。

**Migration**: 旧 `generated.boundary.outFrom` / `inFrom` 保留在数据里、不再展示，MUST NOT 被改写。

### Requirement: 抽取两镜成片帧

**Reason**: 该动作的唯一用途是为转场视频提供首尾帧。

**Migration**: 需要某一镜的画面帧时，改用镜头自身的首帧/尾帧素材功能（`clipBoundaryFrames` 抽帧接口保留）。

### Requirement: 输入模式降级链

**Reason**: 降级链（首尾帧 → 单首帧 → 参考图 → 参考视频 → 纯文本）是对转场视频请求的输入选择，请求已不存在。

**Migration**: 无。旧数据无需迁移。

### Requirement: 纯文本模式的能力门禁

**Reason**: 门禁保护的是纯文本转场生成，该模式已删除。

**Migration**: 无。旧数据无需迁移。

### Requirement: 请求时长按实际提交的帧决定

**Reason**: 没有转场视频请求，就没有需要按锚点计算的请求时长。

**Migration**: 旧 `generated.targetSeconds` 与 `generated.video.seconds` 不再读取；该接缝按保存的效果时长参与成片。

### Requirement: 参考图与尾帧的互斥按实际提交判断

**Reason**: 参考图与尾帧都不再提交，互斥规则失去判定对象。

**Migration**: 无。旧数据无需迁移。
