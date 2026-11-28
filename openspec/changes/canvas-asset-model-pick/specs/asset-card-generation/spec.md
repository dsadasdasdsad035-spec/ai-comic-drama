# Spec Delta

## Purpose

画布上的图片与音频素材卡可按提示词生成媒体，并在生成前让用户选择或确认将使用的模型。

## ADDED Requirements

### Requirement: 图片素材卡 Inspector 可选择图像模型

用户选中画布上的图片素材卡时，系统 MUST 在 Inspector 中提供图像能力模型下拉。未手选时 MUST 使用设置页 `image` 能力默认模型；手选 MUST 写入本机会话级覆盖并与素材页设定图、批量出图共用。

#### Scenario: 未手选时使用设置默认

- **WHEN** 用户未手选图像模型且设置页已配置 image 默认
- **THEN** 下拉首项展示该默认，出图请求使用该 modelKey

#### Scenario: 手选后出图与批量共用

- **WHEN** 用户在图片素材卡 Inspector 手选某图像模型后执行出图或批量出图（素材卡）
- **THEN** 请求使用同一 modelKey

### Requirement: 音频素材卡 Inspector 可选择音频模型

用户选中画布上的音频素材卡时，系统 MUST 在 Inspector 中提供音频能力模型下拉。用户 MUST 能在生成前看到当前将使用的模型（手选或默认）。

#### Scenario: 手选已接入模型后生成

- **WHEN** 用户填写提示词、在音频卡 Inspector 选择已接入的音频模型并请求生成
- **THEN** 系统用该 modelKey 与提示词提交，且界面没有旁白/音乐模式开关

#### Scenario: 未手选但存在默认

- **WHEN** 用户未手选音频模型且设置页已配置 audio 默认，该条目已接入
- **THEN** 生成请求使用默认 modelKey，不要求用户必须先打开下拉

### Requirement: 未接入的音频模型不能提交

用户选择当前未接入的音频模型时，系统 MUST NOT 提交生成，并说明该模型尚未接入。

#### Scenario: 选择未接入条目

- **WHEN** 用户在音频素材卡 Inspector 选择目录中未接入的音频模型并请求生成
- **THEN** 系统不提交请求，并说明该模型尚未接入

### Requirement: 不可运行的图像模型不能提交

用户当前生效的图像模型不可运行（未接入或配置无效）时，系统 MUST NOT 提交图片素材卡出图，并给出可读原因。

#### Scenario: 无可用图像模型

- **WHEN** 设置页没有可运行的 image 能力模型，用户对图片素材卡请求出图
- **THEN** 系统不提交请求，并提示先配置或选择可用模型