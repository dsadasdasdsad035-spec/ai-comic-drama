# Spec Delta

## Purpose

让画布的视频生成可以使用 Seedance 2.5 的原生音频，并把一个角色的 TTS 音色样本作为**可选**音色参考；模型重新发声和生成嘴型，参考音频不会被原样播放。没有可用样本时仍可开原生音轨，声音由模型决定。首期只支持单说话人镜头。

## ADDED Requirements

### Requirement: 原生音频只对已确认支持的模型开放

每个镜头 SHALL 保存 `off`（静音）或 `native`（原生音频）模式，旧镜头默认 `off`。只有声明了 `audioOut` 且通过实际音频参考探测的视频模型 MUST 允许 `native`；其他模型 MUST 隐藏或禁用入口并说明原因。

#### Scenario: 旧镜头

- **WHEN** 打开一个没有音频模式字段的旧项目
- **THEN** 镜头按 `off` 读取，视频请求保持静音，不出现 `generate_audio`

#### Scenario: 不支持的模型

- **WHEN** 当前视频模型没有 `audioOut` 或未通过音频参考探测
- **THEN** 原生音频开关禁用，不提交任何带 `generate_audio` 的请求

#### Scenario: 切换模型

- **WHEN** 用户从一个支持原生音频的模型切到不支持的原生音频模型
- **THEN** 已保存的原生音频模式保留但显示不可用，不静默改写模式

### Requirement: APIMart 使用单个 audio_url 字符串

当前 APIMart Seedance 2.5 的原生音频参考 MUST 使用单个 `audio_url` 字符串，值为公网 URL 或 `data:audio/<格式>;base64,...`。MUST NOT 发送对象 `{url, role}`、`reference_audio`、`audio_urls` 或 `audio_with_roles`；这些形状在当前渠道未验证，发送会得到参数错误。

#### Scenario: 公网 URL

- **WHEN** 角色样本有可访问的公网音频 URL
- **THEN** 请求把该 URL 作为 `audio_url` 字符串提交

#### Scenario: 本地样本

- **WHEN** 角色样本只有本地项目路径
- **THEN** 系统把音频编码成 data URL 后作为 `audio_url` 字符串提交，或在上传不可用时明确阻止

#### Scenario: 错误形状

- **WHEN** 调用方传入对象或数组形式的音频参考
- **THEN** 在本地请求层拒绝，不把错误形状发给 APIMart

### Requirement: 原生音频首期只支持单说话人

一个 `native` 镜头 MUST 只有一个真正说话的角色。镜头有两个或更多说话人时 MUST 禁用 native，提示拆成单人镜或改用 `off`（静音视频）；MUST NOT 把多个角色混成一个 `audio_url` 或冒充多参考。

#### Scenario: 单说话人

- **WHEN** 镜头只有陈默一句台词，陈默有有效音色样本
- **THEN** native 可用，`audio_url` 使用陈默样本

#### Scenario: 双人对话

- **WHEN** 镜头里陈默和林岚都有台词
- **THEN** native 禁用并说明“首期只支持单说话人”，`off` 仍可用

#### Scenario: 画外音

- **WHEN** 画面内只有一个人说话，另一句是画外音
- **THEN** 只有画面内说话人进入 `audio_url`；画外音不驱动 native

### Requirement: 原生音频的音色参考是可选增强

`native` 镜头提交视频时 MUST 设置 `generate_audio: true`。有可用音色样本时 MUST 把该说话角色的样本作为 `audio_url` 提交；没有可用样本时 MUST NOT 阻止提交，也 MUST NOT 伪造或复用一个无关的 `audio_url`，MUST 在该镜与请求预览里标明「无音色参考，声音由模型决定」。

音色参考只约束音色；MUST NOT 把参考音频说成会原样播放或保证逐字口型。

台词不进入运行时拼装：出片正文只由人/Agent 写入（见 `shot-prompt-agent-authored`）。系统 MUST NOT 为了原生音频自动追加声音段或改写正文；正文缺少本镜台词时 MUST 给出软提示说明「模型可能只出声不说话」，但 MUST NOT 拦截出片。

#### Scenario: 单说话人且样本有效

- **WHEN** 陈默说“你来了。”且陈默样本有效
- **THEN** 请求带 `generate_audio:true` 和 `audio_url`，提示词由人/Agent 自行写出角色与逐字台词

#### Scenario: 没有样本

- **WHEN** 说话角色没有有效音色样本
- **THEN** 请求仍带 `generate_audio:true` 但不带 `audio_url`，任务照常提交；UI 标「声音由模型决定」，不得假装已绑定参考

#### Scenario: 失效样本

- **WHEN** 样本已失效或文件缺失
- **THEN** 视同「没有样本」处理，MUST NOT 静默使用旧音频

#### Scenario: 正文缺台词

- **WHEN** 已开 native，但出片正文里没有任何一句本镜台词
- **THEN** 面板给出「正文没写台词，模型可能只出声不说话」软提示，出片不被阻止，正文不被自动改写

### Requirement: 原生音频视频最短 4 秒（含 4 秒）

`native` 镜头 MUST 使用 Seedance 2.5 支持的视频时长。实测边界是 4-30 秒：**恰好 4 秒合法**，2 秒会被 provider 拒绝。镜头时长短于 4 秒时 MUST 禁用 native 并提示加长镜头或改用 `off`；镜头时长 ≥4 秒时 MUST NOT 再额外抬高请求时长。

#### Scenario: 2 秒镜头

- **WHEN** 镜头只有 2 秒时长，用户切到 native
- **THEN** 开关禁用并提示“原生音频最短 4 秒”

#### Scenario: 恰好 4 秒

- **WHEN** 镜头为 4 秒，其他条件满足
- **THEN** 请求 `duration: 4` 直接提交，不抬到 5 秒（2026-11-22 实测 `task_01M81KX9X0DN2JBVBSXS9KCGY1` 成功）

#### Scenario: 模型决定的时长

- **WHEN** 用户选择 provider 支持的 `-1` 自动时长
- **THEN** 只在 provider 明确支持时允许，不静默使用

### Requirement: 原生音频使用参考图模式而不是首尾帧

当前 Seedance 2.5 文档把首帧/首尾帧与音频参考列为互斥场景。`native` 镜头 MUST 使用参考图模式携带关键帧，MUST NOT 同时提交 `first_frame_image`/`last_frame_image` 与 `audio_url`，直到渠道实测确认可以混用。

#### Scenario: 已有首帧

- **WHEN** 镜头已有关键帧并切到 native
- **THEN** 关键帧作为 reference_image 发送，不作为 first_frame_image

#### Scenario: 首尾帧任务

- **WHEN** 镜头使用首尾帧模式
- **THEN** native 入口禁用，提示改用参考图模式或 off

#### Scenario: 未探测的混用

- **WHEN** 渠道没有明确确认首尾帧 + 音频可混用
- **THEN** 不发送该组合，不把上游 400 当成成功

### Requirement: 音频参考必须可读取且通过内容审核

系统 SHALL 在提交前确认音频可被 provider 读取；公网 URL 或 data URL 不可访问时 MUST 阻止提交并给出可读错误。参考音频仍受 provider 内容安全/版权限制，失败时 MUST 显示原始原因，不自动降级成无参考。

#### Scenario: data URL 成功

- **WHEN** 自己生成/授权的 TTS 样本编码为 data URL 提交且通过审核
- **THEN** 任务创建成功，最终视频包含原生音轨

#### Scenario: 版权音频

- **WHEN** 参考音频触发版权/内容安全限制
- **THEN** 任务失败并显示 provider 原因，不自动重试或换音频

#### Scenario: 不可访问

- **WHEN** 公网 URL 返回 404 或超时
- **THEN** 本地阻止提交，提示上传或换可访问地址

### Requirement: 原生音频镜头的最终音轨不使用该镜 TTS

`native` 镜头成功出片后，预览和导出 MUST 使用视频自带音轨，MUST NOT 再混入该镜 `voiceUrl`；字幕仍使用台词文本。`off` 镜头同样不混 `voiceUrl`（连播/导出只认成片音轨，见 `canvas-prod-modes-no-voice` 的 R2）；切回 `off` MUST 只改变后续出片请求的音频模式，旧视频与旧 TTS 文件均保留。

#### Scenario: 原生镜头导出

- **WHEN** 一个 native 镜头出片并导出
- **THEN** 成片该段使用视频音轨，不出现第二层 TTS 人声，字幕仍按台词生成

#### Scenario: 切回静音

- **WHEN** 用户把镜头从 native 切回 off
- **THEN** 该镜不再贡献任何音轨；旧 native 视频保留，可再次切回 native

#### Scenario: 混合项目

- **WHEN** 一集里既有 native 镜头也有 off 镜头
- **THEN** 每个镜头按自己的模式选音轨，统一响度，不跨镜串音

### Requirement: 原生音频与 provider 口型互斥

同一镜头 MUST NOT 同时启用原生音频和外部 provider 口型。`native` 模式下 provider 口型入口 MUST 禁用并说明“原生音频已包含声画”；切回 `off` 后才允许 provider 口型。已有 provider 口型结果 MUST 保留，不自动删除。

#### Scenario: native 下点口型

- **WHEN** 镜头已启用 native，用户查看 provider 口型入口
- **THEN** 入口禁用并说明原生音频已包含声画

#### Scenario: 切回 off

- **WHEN** 用户关闭 native
- **THEN** provider 口型入口恢复，已有结果仍可查看/采用

#### Scenario: 已有口型结果

- **WHEN** 镜头已有 provider 口型结果后启用 native
- **THEN** 不自动删除口型结果，但预览/导出按 native 音轨执行

### Requirement: native 失败不自动降级

原生音频请求失败、参考音频不可用或 provider 返回不支持时，系统 MUST 显示错误并保留原视频，MUST NOT 自动改成 `off` 后重新提交，也不得静默丢弃参考。

#### Scenario: provider 不支持

- **WHEN** provider 返回音频参考不支持或字段错误
- **THEN** 显示错误、保留原视频，用户可手动切回 off

#### Scenario: 超时

- **WHEN** 原生音频任务超时
- **THEN** 标记失败并保留已有视频，不自动换模型或重提

### Requirement: 原生音频产物可判定失效

系统 SHALL 记录 native 视频依赖的音频模式、参考样本、台词和模型指纹；其中任一项变化时，MUST 把该视频标记为需要重生成，但 MUST NOT 删除已有视频。

#### Scenario: 改参考样本

- **WHEN** 角色重新生成音色样本后，镜头仍引用旧样本
- **THEN** 该镜视频标记需要重生成，旧视频仍可播放

#### Scenario: 改台词

- **WHEN** 用户改了 native 镜头的台词文本
- **THEN** 视频标记需要重生成，提示台词与原生音轨已不一致

#### Scenario: 未变化

- **WHEN** 音频模式、样本、台词和模型都没有变化
- **THEN** 视频保持有效，不要求无意义重生成

### Requirement: 真实原生音频调用必须人工确认

真实 Seedance 2.0+ 的原生音频任务 MUST 逐次或按明确批次获得用户确认；确认前 MUST 展示模型、镜头数、参考音频、预计时长和估算成本。MUST NOT 在批量出片或后台任务中自动提交真实原生音频任务。

#### Scenario: 单镜确认

- **WHEN** 用户点“生成原生音频视频”
- **THEN** 先展示本次任务参数和成本，确认后才提交

#### Scenario: 批量出片

- **WHEN** 用户批量重生成一集
- **THEN** 不会自动提交 native 任务

#### Scenario: 测试

- **WHEN** 自动化测试覆盖 native 请求
- **THEN** 只使用 mock/dryRun，不产生真实 Seedance 调用
