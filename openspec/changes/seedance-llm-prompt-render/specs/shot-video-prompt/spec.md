# shot-video-prompt Delta

## ADDED Requirements

### Requirement: 自动正文可来自模板渲染结果

当镜头存在与当前输入指纹匹配的 `video_prompt_rendered` 时，自动出片正文 MUST 使用该渲染结果作为拼接主文案；MUST NOT 再追加与模板已覆盖内容重复的表演段、原生音频段或参考图注（回退路径除外）。预览与实际请求的 `prompt` MUST 仍逐字一致。

#### Scenario: 有新鲜渲染结果

- **WHEN** 镜头有 `video_prompt_rendered` 且 `render_meta.fingerprint` 与当前拼装指纹匹配
- **THEN** 面板正文等于该渲染结果（手改除外），生成请求 `prompt` 与面板相同

#### Scenario: 无渲染结果回退

- **WHEN** 镜头没有 `video_prompt_rendered`
- **THEN** 自动正文行为与引入本能力前一致（`video_prompt` + 规则后缀）

#### Scenario: 渲染过期

- **WHEN** 指纹不匹配但 `video_prompt_rendered` 仍存在
- **THEN** 面板显示渲染过期警告；默认可继续用过期渲染出片，或用户点「重新渲染」更新

### Requirement: 模板渲染与机械拼装按钮分离

面板 MUST 提供「重新渲染（模板）」与「恢复机械拼装」（清除渲染并回到 `video_prompt` + 后缀）两类操作。「重新拼装」在存在渲染层时 MUST 指清除手改并采用当前优先来源（渲染或机械），语义 MUST 在 UI 文案中区分。

#### Scenario: 清除手改后采用渲染

- **WHEN** 用户在手改状态点「恢复自动」且存在新鲜 `video_prompt_rendered`
- **THEN** 正文恢复为渲染结果而非机械后缀拼装

## MODIFIED Requirements

### Requirement: 手改快照在输入变化后标记过期

手改版本保存时 MUST 记录当时输入的指纹。参考集合或顺序、出片模式、台词、运动提示词、运镜走位、音色参考、有效时长或模板渲染指纹变化后，若指纹不再匹配，面板 MUST 显示「旧快照」警告，MUST NOT 静默覆盖或删除手改正文，也 MUST NOT 阻止用户继续用手改版本出片。

#### Scenario: 新增参考图

- **WHEN** 手改保存后用户在画布上新增一张角色参考图
- **THEN** 面板显示旧快照警告，正文仍是手改版本

#### Scenario: 新增视频素材

- **WHEN** 手改保存后用户在画布上新增或更换一条视频素材连线
- **THEN** 面板显示旧快照警告，正文仍是手改版本

#### Scenario: 继续使用旧快照

- **WHEN** 用户看到旧快照警告后直接点生成
- **THEN** 请求使用手改正文，并仍按当前实际附件提交参考图与视频

#### Scenario: 重新拼装清除旧快照

- **WHEN** 用户在旧快照状态点「重新拼装」
- **THEN** 正文更新为当前输入的自动结果（优先模板渲染，否则机械拼装），手改记录被清除

#### Scenario: 渲染后未重渲

- **WHEN** 手改保存后用户仅触发模板渲染成功，未改手改
- **THEN** 面板仍显示手改版本；渲染结果可供「恢复自动」时采用

### Requirement: AI 重写不覆盖手改提示词

手改记录 MUST 作为镜头的手改字段参与重新拆镜和提示词重写合并；模型重新生成 `video_prompt` 时 MUST 保留手改正文，直到用户主动恢复自动拼装。重新生成 `video_prompt` MUST NOT 自动覆盖 `video_prompt_rendered`，除非用户显式触发模板渲染或批量渲染动作。

#### Scenario: 重新生成提示词

- **WHEN** 用户在镜头表或通过 Inspector 关联的出片流程重新生成该镜头的 `video_prompt`
- **THEN** 该镜头的手改正文保持不变，面板继续显示手改版本；`video_prompt_rendered` 仅标过期，不静默删除
