# Spec Delta

## REMOVED Requirements

### Requirement: 空提示词时脚本拼装正文

**Reason**: 脚本拼装是运行时按画布上下文机械生成正文的路径，与「分镜正文只能由 Agent 或用户写入」直接冲突。正文为空改为阻断后，冷启动填充不再由系统代劳，改由创意会话读取字段后写入。

**Migration**: 存量双空分镜升级后出片被 `shot-prompt-empty` 阻断，需通过 Inspector 或创意会话补写 `video_prompt`。此前依赖脚本拼装得到的正文不会自动迁移，也不再可复现。

### Requirement: 脚本正文纳入附件与场域上下文

**Reason**: 该 Requirement 要求拼装正文反映参考图槽位、参考视频、音色参考、景别运镜、台词表演与邻镜约束。这正是本次要移除的「机械拼接字段进正文」行为，其信息改由 `read_shot_video_inputs` 与 `read_shot_detail` 提供给 Agent。

**Migration**: Agent 应改为先读 `read_shot_video_inputs` 取得有序参考列表与出片模式，再读 `read_shot_detail` 取得景别、运镜、台词与表演，自行组织语言写入 `video_prompt`。

### Requirement: 脚本拼装与预览请求一致

**Reason**: 该 Requirement 约束的是脚本拼装产物与请求 `prompt` 的一致性。拼装路径删除后此约束无对象；「面板正文与请求逐字一致」这一性质由 `shot-video-prompt` 的 `自动正文优先级` 继续保证。

**Migration**: 无需迁移，一致性保证由 `shot-video-prompt` 承接。
