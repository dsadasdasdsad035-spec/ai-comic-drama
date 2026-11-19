# Spec Delta: creative-shot-video-harness

## ADDED Requirements

### Requirement: 镜级出片开关可由 Agent 写回且与画布一致

系统 SHALL 提供动作工具 `set_shot_video_options`，按镜号（与可选集号）写回下列字段之一项或多项：`useExpressionRef`（布尔）、`audioMode`（`native` 或 `off`）、`prod_kind`（`image` 或 `video`）。写回后 `read_shot_video_inputs` 的投影 MUST 与画布 Inspector 在相同字段值下一致。开启 `audioMode: native` 时，若该镜不满足原生音频就绪条件（无单一说话人、无有效音色样本等），MUST 拒绝写入并返回与面板相同的可读原因。

#### Scenario: 开启表情参考

- **WHEN** agent 对某出片镜调用 `set_shot_video_options` 且 `useExpressionRef: true`
- **THEN** 该镜保存为开启；后续 `read_shot_video_inputs` 的 warnings/参考列表与画布勾选后一致

#### Scenario: 原生音频条件不足

- **WHEN** agent 对无可用音色样本的镜调用 `audioMode: native`
- **THEN** 返回 `ok: false`，不写任何字段

#### Scenario: 工位切换

- **WHEN** agent 将 `prod_kind` 设为 `image`
- **THEN** 该镜工位与生图路径一致；`generate_keyframe` 可接受、`generate_clip` 按既有规则拒绝

### Requirement: 手改出片正文可由 Agent 保存与清除

系统 SHALL 提供动作工具 `set_shot_video_override`：保存时 MUST 写入 `video_prompt_override`（正文 + fingerprint + 时间戳），清除时 MUST 移除 override 并更新 `handEdited` 标记，语义与画布「手改 / 恢复拼装」一致。保存前 MUST 对当前镜调用与 `read_shot_video_inputs` 同源的请求指纹计算；调用方传入的 fingerprint 若与当前请求指纹不一致，MUST 拒绝保存并提示先 `read_shot_video_inputs` 再写。

#### Scenario: 保存手改正文

- **WHEN** agent 传入非空 `text` 且 fingerprint 与当前出片请求一致
- **THEN** 保存后 `read_shot_video_prompt` 的 `source` 为 override，正文逐字等于 `text`

#### Scenario: 清除手改

- **WHEN** agent 调用 `clear: true`
- **THEN** override 被移除，后续正文来源回到 `video_prompt`

### Requirement: 手工参考 URL 可由 Agent 增删

系统 SHALL 提供动作工具 `set_shot_ref_extras`：对 `refExtras` 做 add/remove（并集语义，与 `link_shot_refs` 一致）。每一项 URL MUST 属于当前项目媒体清单；外链或未知地址 MUST 整批拒绝。无画布上下文时，写回仍 MUST 落到项目镜头字段，并在下一次画布水合后参与 `buildShotVideoRequest`。

#### Scenario: 添加项目内参考图

- **WHEN** agent 以 `action: add` 提交已在项目媒体中的图片地址
- **THEN** `refExtras` 增加该项，且 `read_shot_video_inputs` 在素材解析后体现为参考候选

#### Scenario: 拒绝外链

- **WHEN** agent 提交 `https://` 且不在项目媒体清单
- **THEN** 不写入，返回可读错误

### Requirement: 邻镜参考可由 Agent 配置

系统 SHALL 提供动作工具 `set_shot_neighbor_refs`，对镜号添加或移除 `SHOT_PREV` / `SHOT_NEXT` 邻镜参考 token（与画布邻镜连线等价）。目标邻镜不存在或不在画布上时 MUST 拒绝并说明可用镜号。

#### Scenario: 添加下一镜参考

- **WHEN** agent 对镜 S03 调用 `add` 且 `neighbor: next`
- **THEN** `refIds` 含下一镜 token，出片模式在满足其他条件时可进入多参考图路径

### Requirement: 生成出片可单次覆盖模型与分辨率

系统 SHALL 允许 `generate_clip` 接收可选 `modelKey` 与 `resolution`（`480p` | `720p`）。提供时 MUST 仅作用于该次 `startVideo` 调用；省略时 MUST 沿用当前创意会话的画布出片模型与分辨率选择。无效 modelKey 或模型不支持视频参考时 MUST 在执行前失败，不扣费。

#### Scenario: 单次试用另一模型

- **WHEN** agent 调用 `generate_clip` 并传入设置页存在的 `modelKey`
- **THEN** 任务使用该模型提交，且不改变顶栏默认出片模型

#### Scenario: 省略会话默认

- **WHEN** agent 不传 `modelKey` 与 `resolution`
- **THEN** 与用户在画布出片设置中选择的模型与分辨率一致