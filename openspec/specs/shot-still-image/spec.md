# shot-still-image Specification

## Purpose
定义分镜静帧生成（画布/Inspector 出图）如何把产物写入项目媒体并与视频出片参考解耦。

## Requirements

### Requirement: 出图产物落入项目媒体

分镜静帧生成成功时，系统 MUST 将结果图片保存到当前项目的媒体目录并返回站内 `/project-assets/...` 地址。生成请求 MUST 携带当前项目标识，使产物可被项目级媒体索引枚举。

#### Scenario: 画布出图落盘
- **WHEN** 用户在画布对某分镜点「生成图片」且生成成功
- **THEN** 至少一张结果 URL 为当前项目的 `/project-assets/` 地址，且该文件在磁盘存在

#### Scenario: 出现在生成图片类目
- **WHEN** 用户在该项目打开素材选择器并浏览「生成图片」
- **THEN** 刚生成的图片 URL 出现在列表中，可被预览与选中

### Requirement: 出图不自动成为画布素材或连线

静帧生成成功 MUST NOT 自动创建画布素材卡，MUST NOT 自动向该分镜 `refIds` 追加节点 id，MUST NOT 自动把生成图作为视频 `reference_image` 提交。

#### Scenario: 无新素材卡
- **WHEN** 用户对一镜完成静帧生成且生成前画布上无对应新卡
- **THEN** 画布节点数量不因该次生成而增加素材卡

#### Scenario: refIds 不变
- **WHEN** 用户对一镜完成静帧生成且生成前 `refIds` 为空
- **THEN** 生成后 `refIds` 仍为空，直至用户手动连线

### Requirement: 镜上预览字段保留

系统 MAY 把静帧生成结果写入该分镜的 `refImage` 与候选列表，用于卡片预览、出图迭代与构图标注输入。该预览 MUST 在规格上视为静帧产线状态，不等同于已连线视频参考。

#### Scenario: 卡上可见预览
- **WHEN** 静帧生成成功并写回 `refImage`
- **THEN** 分镜卡在画布上显示该图作为当前画面预览

#### Scenario: 出图仍可使用预览作输入
- **WHEN** 用户对已有 `refImage` 的镜头再次出图且开启「参考当前构图」
- **THEN** 出图请求可把该预览作为 Seedream 输入，而不影响视频附件规则
