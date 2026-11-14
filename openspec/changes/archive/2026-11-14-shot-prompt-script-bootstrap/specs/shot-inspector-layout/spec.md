# Spec Delta

## ADDED Requirements

### Requirement: 出片提示词来源徽章

出片镜「本次出片提示词」面板 MUST 以徽章区分正文来源：`已手改`、`语义层`、`脚本拼装`。MUST NOT 将「模板渲染」作为默认主路径徽章；存量 LLM 九段字段不参与来源判定。

#### Scenario: 脚本拼装徽章

- **WHEN** 用户选中出片镜且正文来自脚本拼装
- **THEN** 徽章文案为「脚本拼装」

#### Scenario: 语义层徽章

- **WHEN** 正文来自 `video_prompt` 或 `prompt` 回退
- **THEN** 徽章文案为「语义层」

### Requirement: 无模板渲染过期提示

当镜头仅存 `video_prompt_rendered` 而与当前输入不一致时，面板 MUST NOT 显示「模板渲染与当前输入不一致，请点模板渲染更新」或 `renderStale` / `templateStale` 等价文案。用户改连线、表演或附件后，若未手改，正文 MUST 随自动优先级更新而无额外模板操作。

#### Scenario: 改参考无黄字

- **WHEN** 用户为出片镜新增一条角色参考连线且无手改层
- **THEN** 面板无「模板渲染」过期警告，正文随脚本或语义层更新

#### Scenario: 无不可点动作

- **WHEN** 用户展开出片提示词正文区
- **THEN** 不存在仅存在于文案中、界面上无对应按钮的「点模板渲染」主操作
