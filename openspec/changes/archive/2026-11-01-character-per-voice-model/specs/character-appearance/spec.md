# Spec Delta

## ADDED Requirements

### Requirement: 角色绑定配音模型

角色卡 SHALL 在音色区域提供配音模型选择，选项来自设置中可运行的 audio 能力模型；选择 MUST 写入项目角色数据（`voice_model_key`，并同步渠道 id 供校验）。新建或未配置角色 MUST 默认使用设置页默认配音模型；用户更改后以角色保存值为准。

#### Scenario: 选择配音模型

- **WHEN** 用户在角色卡音色页选择「火山 Seed TTS 2.0」
- **THEN** 角色保存对应模型键，音色下拉刷新为该渠道目录

#### Scenario: 新建角色默认

- **WHEN** 用户新建角色且未改配音模型
- **THEN** 角色使用设置页默认配音模型键，音色列表对应该默认模型

#### Scenario: 持久化与切换项目

- **WHEN** 用户为角色 A 绑定 MiniMax 后保存项目并重新打开
- **THEN** 角色 A 仍显示 MiniMax 与之前选择的 voiceId（若仍属于该渠道）

#### Scenario: 选音色同步元数据

- **WHEN** 用户在当前配音模型下选择一条音色
- **THEN** 系统保存 voiceId 并记录与当前模型一致的 provider 与 modelKey 元数据
