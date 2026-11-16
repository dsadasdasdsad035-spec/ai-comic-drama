# Spec Delta

## ADDED Requirements

### Requirement: 转场出片输入按接缝投影

系统 SHALL 提供只读工具 `read_transition_video_inputs`，按接缝位置返回转场出片请求的实际输入投影。接缝 MUST 由源镜号定位，目标镜优先用调用方显式给出的目标镜号，缺省时取源镜 `transition_out.to`。投影 MUST 由与出片同一处的预览计算派生，MUST NOT 另写一套参考合并、互斥或时长推导逻辑。

源镜不存在、接缝不存在或源镜未配置转场时，工具 MUST 返回可读错误并指出可用的镜号，MUST NOT 用空格或默认值伪造一份输入清单。

#### Scenario: 接缝不存在

- **WHEN** 源镜没有 `transition_out` 或 `transition_out.to` 指向的镜头不存在
- **THEN** 返回 `ok: false` 与可读错误，不返回任何参考列表

#### Scenario: 目标镜可显式指定

- **WHEN** 调用方给出目标镜号且与 `transition_out.to` 不一致
- **THEN** 工具按显式目标镜计算投影，并在返回值中标明所用接缝

### Requirement: 转场输入投影的字段覆盖

投影 MUST 包含 `inputMode`、`bridging`、`submitsLastFrame`、`seconds`、`requestSeconds`、按提交顺序编号的 `refs`（`index` 从 1 起，含 `label`、用途与来源）、`refTotal`、`styleRefs`（含 `submitted`）、`styleOmitted` 与互斥原因、`omitted`、`omittedVideos`、`video`、`audio`、`blocking`、`warnings`、`promptSource`、`promptStale`、`promptEmpty`。

工具 MUST NOT 返回提示词正文本身：正文由调用方用 `read_shot_detail` 读取 `transition_out.generated.prompt` 或手改快照取得。

#### Scenario: 读出有序参考与提交模式

- **WHEN** 源镜与目标镜都连着角色参考，且模型支持尾帧、转场配置为提交尾帧
- **THEN** 返回的 `refs` 按实际提交顺序编号，`styleRefs` 标出被互斥掉的条目与原因，`submitsLastFrame` 为真

#### Scenario: 不返回正文

- **WHEN** 转场已写好 `generated.prompt`
- **THEN** 工具返回 `promptSource` 与 `promptEmpty`，但不返回该正文文本

#### Scenario: 正文为空可被提前发现

- **WHEN** 转场 `generated.prompt` 为空且无手改
- **THEN** 返回 `promptEmpty: true`，并带上 `transition-prompt-empty` 对应的阻断信息
