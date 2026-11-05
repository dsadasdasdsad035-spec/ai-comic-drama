# Spec Delta

## ADDED Requirements

### Requirement: 自动拼装包含镜头表演

当镜头存在至少一条有效的 `performance` 条目（含角色名）时，自动拼装的视频出片正文 MUST 追加 **【表演方向】** 段落，内容 MUST 来源于该镜头当前的 `performance` 与 `dialogue_delivery`（与镜头表、Inspector 同源），并描述各角色的情绪、强度、可见动作、视线与是否说话。该段落 MUST 出现在参考图/参考视频的图注句之前或之后，但 MUST 与 `motionNote`、原生音频说明等同属自动正文的一部分。

#### Scenario: 有表演时面板与请求一致
- **WHEN** 镜头有多条 performance 且用户未手改出片提示词
- **THEN** 出片提示词面板正文包含【表演方向】，且 `/api/seedance` 的 `prompt` 逐字相同

#### Scenario: 空表演不追加
- **WHEN** 镜头的 performance 为空或未定义
- **THEN** 自动拼装正文 MUST NOT 包含【表演方向】段落

#### Scenario: 参考视频模式仍只约束运动
- **WHEN** 镜头连线了视频素材且存在 performance
- **THEN** 请求仍提交 `reference_video`，【表演方向】只出现在文字正文，不改变视频附件


### Requirement: 表演变化影响手改快照指纹

手改出片提示词保存时的输入指纹 MUST 纳入 performance 与 dialogue_delivery 的稳定序列化；表演或逐行台词表演变化后，若用户未点「重新拼装」，面板 MUST 显示旧快照警告。

#### Scenario: 改表演后旧快照
- **WHEN** 用户手改保存后又在镜头表修改某角色的动作或情绪
- **THEN** 面板显示旧快照警告，手改正文保留


### Requirement: 出片面板摘要标明表演

出片提示词面板的摘要行 MUST 标明当前镜头是否有表演数据已并入自动正文（例如「表演 2 人」或「无表演」），与附件清单并列展示。

#### Scenario: 摘要可见
- **WHEN** 用户打开带 performance 的镜头出片面板
- **THEN** 摘要行显示表演条目数量或等价文案


## MODIFIED Requirements

### Requirement: 无手改时保持现有请求兼容

对没有旧 3D 参考开关、也没有连线视频素材的项目，在相同镜头输入和模式下，且镜头 **performance 与 dialogue_delivery 均为空**，最终请求的提示词、参考图、参考视频和音色参考 MUST 与改动前一致。旧镜头保存的 `useScheduleVideoRef` / `useScheduleFrames` MUST 被忽略，MUST NOT 继续触发送参考视频或调度关键帧。当镜头存在非空 performance 时，自动拼装正文 MAY 增加【表演方向】段落，该增加不视为兼容破坏。

#### Scenario: 旧项目回归
- **WHEN** 用没有 3D 参考开关、没有视频素材连线、且各镜头无 performance 的旧项目和相同模型出片
- **THEN** 请求体字段与提示词正文与改动前逐字相同

#### Scenario: 旧 3D 参考开关
- **WHEN** 旧镜头保存了 `useScheduleVideoRef: true` 但没有视频素材连线
- **THEN** 本次请求不包含 `reference_video`，面板说明旧开关已停用

#### Scenario: 有表演的旧镜头
- **WHEN** 旧镜头已保存 performance 但此前出片未带表演段落
- **THEN** 自动拼装正文包含【表演方向】，附件集合与模式与相同输入下改动前一致
