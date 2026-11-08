# Spec Delta

## ADDED Requirements

### Requirement: 视频参考图仅来自显式连线解析

视频出片提交的 `reference_image` 集合 MUST 仅由 `collectShotReferences`（及开启时的表情参考）、视频素材连线与原生音色规则产生。分镜 `refImage` / 静帧预览 MUST NOT 自动加入该集合，MUST NOT 作为原生音频或无连线时的隐式兜底图。

#### Scenario: 有预览无连线
- **WHEN** 镜头有 `refImage` 但 `refIds` 未连任何角色或图片素材，且未连邻镜 token
- **THEN** 出片面板附件清单不含「当前画面构图」，提交前显示需连线参考的阻止原因

#### Scenario: 连线素材后出片
- **WHEN** 用户把含静帧 URL 的素材卡连到该镜并出片
- **THEN** 附件清单列出该素材标签，且请求包含对应 `reference_image`

#### Scenario: 原生音频无隐式静帧
- **WHEN** 镜头开启原生音频且无任何合格图片连线
- **THEN** 面板阻止出片，理由说明需要至少一张连线参考图，而非提示「先出画面」

## MODIFIED Requirements

### Requirement: 出片前可见最终提示词与实际附件

系统 SHALL 在不提交生成请求的前提下展示最终提示词正文、参考图数量、参考视频、音色参考、秒数和分辨率，并逐项列出实际使用的附件槽位、标签和用途。附件 MUST 标注主体身份：角色名、场景名、道具名、相邻镜号、图片素材标题或手工参考；MUST NOT 将仅用于静帧预览的 `refImage` 标为已附加视频参考。

#### Scenario: 打开镜头即看到
- **WHEN** 用户选中一个已连角色或图片素材的分镜镜头
- **THEN** 面板显示最终正文，以及「图1 角色「陈默」外观」「图2 场景「夜市」」等带身份和用途的行，不出现「图1 当前画面构图」除非用户连线了含该用途的素材

#### Scenario: 超过上限的参考
- **WHEN** 候选参考图有 5 张而本次最多使用 4 张
- **THEN** 面板列出 4 张实际使用项，并显式列出被省略的第 5 张及原因

#### Scenario: 阻止出片的原因
- **WHEN** 相邻镜参考缺失、原生音频条件不满足、连线参考不足或 3D 调度已过期
- **THEN** 面板在提交前显示阻止原因，而不是等请求返回错误

### Requirement: 实际附件与提示词正文分离

附件清单 MUST 由镜头连线（参考图与视频素材）和音色参考决定；编辑提示词正文 MUST NOT 改变实际提交的图片、视频或音频集合。仅有 `refImage` 预览 MUST NOT 使附件清单增加条目。正文中的槽位引用由用户负责，面板 MUST NOT 因为正文被改写而隐藏仍然实际附加的参考。

#### Scenario: 删除图注仍发送图片
- **WHEN** 用户在手改正文中删掉某张参考图的图注行并生成
- **THEN** 该图片仍然作为 `reference_image` 提交，面板附件清单仍列出它

#### Scenario: 修改附件不依赖正文
- **WHEN** 用户在画布上增加一条角色参考连线
- **THEN** 面板附件清单立即增加该角色图，正文是否提及由自动拼装或手改决定

#### Scenario: 连线视频素材
- **WHEN** 用户把一个视频素材卡连到分镜
- **THEN** 面板附件清单增加「视频1」及其素材标题，生成时作为 `reference_video` 提交

#### Scenario: 旧 3D 开关不参与
- **WHEN** 一个旧镜头仍保存着 `useScheduleVideoRef` 或 `useScheduleFrames`
- **THEN** 附件清单不因这两个字段增加 3D 调度视频或调度关键帧

### Requirement: 无手改时保持现有请求兼容

对没有旧 3D 参考开关、也没有连线视频素材的项目，在相同镜头输入和模式下，**且镜头已通过连线提供与改动前等价的图片参考集合时**，最终请求的提示词、参考图、参考视频和音色参考 MUST 与改动前一致。仅存在 `refImage` 而无连线的镜头不在此兼容范围内。旧镜头保存的 `useScheduleVideoRef` / `useScheduleFrames` MUST 被忽略，MUST NOT 继续触发送参考视频或调度关键帧。

#### Scenario: 旧项目回归
- **WHEN** 用没有 3D 参考开关、没有视频素材连线、且镜头 refIds 已提供与旧版隐式 refImage 等价的图片参考的旧项目出片
- **THEN** 请求体字段与提示词正文与改动前意图一致（不含未连线的 refImage 项）

#### Scenario: 已连线等价参考
- **WHEN** 旧项目镜头此前仅靠 `refImage` 出片且用户未补连线
- **THEN** 出片被阻止，面板说明需连线参考，行为与改动前不同（显式 BREAKING）

#### Scenario: 旧 3D 参考开关
- **WHEN** 旧镜头保存了 `useScheduleVideoRef: true` 但没有视频素材连线
- **THEN** 本次请求不包含 `reference_video`，面板说明旧开关已停用
