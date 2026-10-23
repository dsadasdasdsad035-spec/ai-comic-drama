# Spec Delta

## Purpose

让镜头通过手动选择同集上一镜/下一镜画面获得可预测的参考，并移除旧的视频尾帧约束与尾帧接龙，使 AI 画面和视频出片都围绕同一份显式参考选择工作。

## ADDED Requirements

### Requirement: 相邻镜头参考必须手动选择

镜头参考界面 SHALL 只提供同集上一镜和下一镜两个相邻候选；系统 MUST NOT 自动把相邻镜头加入参考。用户未勾选时 MUST NOT 使用相邻镜头画面。非相邻镜头 MUST NOT 出现在该参考入口。

#### Scenario: 勾选上一镜

- **WHEN** 用户在 S02 的参考菜单勾选上一镜 S01
- **THEN** S01 的当前生成画面进入 S02 的参考集合

#### Scenario: 勾选下一镜

- **WHEN** 用户在 S02 的参考菜单勾选下一镜 S03
- **THEN** S03 的当前生成画面进入 S02 的参考集合

#### Scenario: 不自动参考

- **WHEN** 用户打开 S02 但没有任何相邻参考选择
- **THEN** S01 和 S03 的画面都不进入 S02 的生成请求

#### Scenario: 非相邻镜头

- **WHEN** 画布上有 S01、S02、S03、S04，用户查看 S02 的相邻参考
- **THEN** 只出现 S01 和 S03，不出现 S04

### Requirement: 相邻参考解析为当前生成画面

上一镜和下一镜参考 MUST 解析为对应镜头当前的生成画面（首选 `refImage`，没有时取当前候选图），MUST NOT 使用尾帧、视频文件或历史废弃图。解析结果 MUST 固定到当前相邻镜头，不跨集。

#### Scenario: 上一镜有当前画面

- **WHEN** S01 已有当前生成画面并作为 S02 的上一镜参考
- **THEN** 请求使用 S01 的当前画面

#### Scenario: 下一镜有当前画面

- **WHEN** S03 已有当前生成画面并作为 S02 的下一镜参考
- **THEN** 请求使用 S03 的当前画面

#### Scenario: 当前候选切换

- **WHEN** 用户切换了上一镜的当前候选图
- **THEN** 下一次生成使用切换后的当前候选图

#### Scenario: 不跨集

- **WHEN** 当前镜是某集第一镜，上一集最后一镜有画面
- **THEN** 上一集镜头不会成为该镜的相邻参考

### Requirement: 下一镜没有画面时不可选

相邻候选 MUST 显示是否有可用画面；没有画面的上一镜/下一镜 MUST 置灰或显示缺失状态，MUST NOT 被加入参考；生成时素材文件缺失 MUST 返回可读错误，MUST NOT 静默跳过。

#### Scenario: 下一镜未出图

- **WHEN** S03 还没有生成画面
- **THEN** S02 的下一镜参考不可选，并提示未出图

#### Scenario: 已有选择后图片丢失

- **WHEN** 已选中的 S01 画面文件后来被删除
- **THEN** 生成前提示 S01 参考图缺失，不使用坏路径

#### Scenario: 没有上一镜

- **WHEN** 当前镜是本集第一镜
- **THEN** 只显示下一镜候选，上一镜显示无

### Requirement: 相邻参考按关系持久化

相邻参考 SHALL 以关系 token `shot-prev` / `shot-next` 写入目标镜头的参考集合，并随项目持久化；MUST NOT 锁定具体 shot id。刷新、重开项目和镜头重排后，token MUST 继续解析到当前的上一镜/下一镜。

#### Scenario: 刷新恢复

- **WHEN** 用户保存了下一镜参考并刷新项目
- **THEN** 下一镜参考仍然选中

#### Scenario: 镜头重排

- **WHEN** 在 S02 前插入一个新镜头，S02 的上一镜变化
- **THEN** S02 的 `shot-prev` 参考解析到新的上一镜

#### Scenario: 取消参考

- **WHEN** 用户再次点击已选中的上一镜
- **THEN** `shot-prev` 从参考集合移除，生成不再使用它

### Requirement: 相邻参考同时进入画面和视频

同一份相邻参考选择 SHALL 同时用于 AI 画面生成和视频出片；MUST NOT 只在画面生成生效而在视频出片静默忽略。两种生成 MUST 使用相同的上一镜/下一镜解析结果。

#### Scenario: AI 画面使用

- **WHEN** S02 选择上一镜并生成 AI 画面
- **THEN** 图像请求包含 S01 当前画面作为参考

#### Scenario: 视频出片使用

- **WHEN** S02 选择上一镜并生成视频
- **THEN** 视频请求包含 S01 当前画面作为 `reference_image`

#### Scenario: 取消后两种生成都不用

- **WHEN** 用户取消上一镜参考后重新生成画面和视频
- **THEN** 两个请求都不再包含 S01

### Requirement: AI 画面参考总数有明确上限

AI 画面生成 SHALL 继续使用 Seedream 的参考图能力，参考图总数 MUST NOT 超过 10 张。当前镜画面、角色、素材和相邻分镜的总数超过上限时 MUST 提示用户并阻止或明确列出未使用项，MUST NOT 静默把编号与请求顺序错开。

#### Scenario: 十张以内

- **WHEN** 当前画面、角色、素材和相邻参考合计不超过 10 张
- **THEN** 所有参考按实际请求顺序进入生成

#### Scenario: 超过十张

- **WHEN** 参考合计超过 10 张
- **THEN** 生成前提示超出上限，并列出未使用项或要求取消部分参考

#### Scenario: 编号一致

- **WHEN** 请求包含当前画面和多个额外参考
- **THEN** 提示词中的图 N 编号与实际提交的图片顺序一致

### Requirement: 视频参考图上限与优先级

视频出片 SHALL 最多使用 4 张 `reference_image`。参考优先级 MUST 为当前镜画面、角色图、相邻分镜、场景/道具、3D 调度关键帧；超过 4 张时 MUST 明确列出被省略的参考，MUST NOT 静默截断。

#### Scenario: 四张以内

- **WHEN** 当前画面、一个角色和上一镜合计 3 张参考
- **THEN** 三张都进入视频请求

#### Scenario: 超过四张

- **WHEN** 当前画面、两个角色、上一镜、下一镜和场景图合计超过 4 张
- **THEN** 按优先级取前 4 张，并显示哪些参考未使用

#### Scenario: 相邻参考被省略

- **WHEN** 相邻分镜因 4 张上限未进入视频请求
- **THEN** 界面明确提示该相邻参考未参与视频出片

### Requirement: 视频模式与参考协议保持明确

视频生成 SHALL 只在没有任何参考图时使用首帧模式；有任意参考图时 MUST 使用 `reference_image` 模式；有参考视频时 MUST 使用 `reference_video` + 可选 `reference_image` 的全模态参考模式。`reference_image` / `reference_video` 的请求结构和 `@图像N` / `@视频N` 语义 MUST 保持不变。

#### Scenario: 只有首帧

- **WHEN** 镜头没有角色、素材或相邻参考
- **THEN** 视频使用 `first_frame` 模式

#### Scenario: 有相邻参考

- **WHEN** 镜头选择了上一镜画面
- **THEN** 视频使用 `reference_image` 模式，上一镜作为其中一张参考图

#### Scenario: 参考视频加图片

- **WHEN** 镜头开启 3D 调度视频参考并同时选择相邻分镜
- **THEN** 请求包含 `reference_video` 和相邻分镜的 `reference_image`，图片编号连续

### Requirement: 删除视频尾帧约束与尾帧接龙

视频生成 MUST NOT 再提供「以下一镜画面作尾帧约束」，MUST NOT 发送 `last_frame` 或 `return_last_frame`，MUST NOT 保存、展示或提供「设为下一镜首帧 / 用上一镜尾帧作首帧」的尾帧接龙动作。旧尾帧字段 MUST 不再参与新请求或新 UI。

#### Scenario: 出片请求无尾帧

- **WHEN** 用户生成视频
- **THEN** 请求体不包含 `lastFrame`、`last_frame` 或 `returnLastFrame`

#### Scenario: Inspector 无尾帧入口

- **WHEN** 用户查看镜头 Inspector
- **THEN** 看不到尾帧约束开关、尾帧预览或尾帧接龙按钮

#### Scenario: 服务端不请求尾帧

- **WHEN** 服务端提交视频任务
- **THEN** 请求体不包含 `return_last_frame`，任务完成后不下载尾帧

### Requirement: 旧尾帧数据保留但不参与新链路

旧项目里的 `tail_image` / `tailImage` 数据 MUST 不再被读取、展示或写入新请求，但 MUST NOT 被主动删除；删除尾帧功能 MUST NOT 清空旧视频、首帧、参考图或其他镜头字段。旧项目仍 MUST 可正常打开和出片。

#### Scenario: 打开旧项目

- **WHEN** 项目镜头带有旧 `tail_image`
- **THEN** 项目正常打开，尾帧不在 UI 出现，也不影响新的视频请求

#### Scenario: 保存旧项目

- **WHEN** 用户保存一个带旧尾帧字段的镜头
- **THEN** 旧视频与首帧保持，尾帧字段不再被新代码写入或使用

#### Scenario: 旧视频仍可播放

- **WHEN** 旧镜头已有视频和尾帧文件
- **THEN** 视频仍可播放，尾帧文件不被删除

### Requirement: 相邻参考不新增重复的参考边

相邻镜头之间已有 `cut` / `transition` 叙事边时，系统 MUST NOT 再绘制一条并行的参考边；相邻参考状态 MUST 通过右键勾选、Inspector 参考摘要或镜头卡片徽标表达。

#### Scenario: 上一镜参考状态

- **WHEN** S02 勾选上一镜 S01
- **THEN** 画布不出现第二条 S01→S02 的参考线，S02 显示参考上一镜状态

#### Scenario: 取消参考状态

- **WHEN** 用户取消上一镜参考
- **THEN** 参考徽标/摘要消失，叙事边保持不变

### Requirement: 相邻参考必须有明确错误状态

系统 MUST 阻止镜头参考自己；相邻参考缺失、未出图、跨集或无法读取时 MUST 给出明确状态，MUST NOT 把空值或坏路径提交给生成接口。

#### Scenario: 目标镜头自己

- **WHEN** 用户查看当前镜头的相邻候选
- **THEN** 当前镜头不会作为自己的参考

#### Scenario: 相邻参考文件缺失

- **WHEN** 已选中的上一镜画面文件不存在
- **THEN** 生成前返回可读错误并保留其他有效参考

#### Scenario: 跨集边界

- **WHEN** 当前镜是某集最后一镜
- **THEN** 下一镜显示无，不使用下一集镜头
