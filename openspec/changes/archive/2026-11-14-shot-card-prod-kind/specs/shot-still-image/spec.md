# Spec Delta

## MODIFIED Requirements

### Requirement: 出图产物落入项目媒体

分镜静帧生成成功时，系统 MUST 将结果图片保存到当前项目的媒体目录并返回站内 `/project-assets/...` 地址。生成请求 MUST 携带当前项目标识，使产物可被项目级媒体索引枚举。**静帧生成主路径 MUST 仅对 `prodKind === 'image'` 的镜头开放。**

#### Scenario: 画布出图落盘

- **WHEN** 用户在画布对某 `prodKind === 'image'` 分镜点「生成图片」且生成成功
- **THEN** 至少一张结果 URL 为当前项目的 `/project-assets/` 地址，且该文件在磁盘存在

#### Scenario: 出现在生成图片类目

- **WHEN** 用户在该项目打开素材选择器并浏览「生成图片」
- **THEN** 刚生成的图片 URL 出现在列表中，可被预览与选中

#### Scenario: 出片卡不主出图

- **WHEN** 用户对 `prodKind === 'video'` 的分镜尝试主路径静帧生成
- **THEN** 系统不发起 Seedream 主生成，并提示该镜为出片卡或引导新建生图镜

### Requirement: 镜上预览字段保留

系统 MAY 把静帧生成结果写入该分镜的 `refImage` 与候选列表，用于卡片预览、出图迭代与构图标注输入。该预览 MUST 在规格上视为静帧产线状态，不等同于已连线视频参考。**出片卡上的 `refImage` MUST 视为参考/首帧素材，MUST NOT 仅此即可开通静帧主生成。**

#### Scenario: 卡上可见预览

- **WHEN** 静帧生成成功并写回 `refImage` 于生图卡
- **THEN** 分镜卡在画布上显示该图作为当前画面预览

#### Scenario: 出图仍可使用预览作输入

- **WHEN** 用户对 `prodKind === 'image'` 且已有 `refImage` 的镜头再次出图且开启「参考当前构图」
- **THEN** 出图请求可把该预览作为 Seedream 输入，而不影响视频附件规则

#### Scenario: 出片卡预览不触发主出图

- **WHEN** 出片卡因遗留水合保留 `refImage`
- **THEN** 卡上可显示该图，但主路径仍为出片，不出现生成画面主按钮
