# Spec Delta

## MODIFIED Requirements

### Requirement: 出片 Tab 区块顺序

对出片镜，`出片` Tab 内区块 MUST 按下列顺序自上而下排列：就绪条、附件与槽位（与出片提示词面板一体或紧邻）、本次出片提示词正文区、运镜与语义（镜号、时长、景别、运镜与镜头语言库）、出片设置（模型与分辨率等）。附件与槽位区在默认首次进入时 MUST 为展开状态。

#### Scenario: 默认看见附件

- **WHEN** 用户首次选中出片镜并位于出片 Tab
- **THEN** 附件与槽位列表无需额外点击即可见（有附件或显式空态）

#### Scenario: 运镜与语义不含正文输入

- **WHEN** 用户展开出片 Tab 的运镜与语义区块
- **THEN** 该区块只提供镜号、时长、景别、运镜与镜头语言库，不出现正文输入框或正文查看区

### Requirement: 无模板渲染过期提示

当镜头仅存 `video_prompt_rendered` 而与当前输入不一致时，面板 MUST NOT 显示「模板渲染与当前输入不一致，请点模板渲染更新」或 `renderStale` / `templateStale` 等价文案，MUST NOT 提供「重新拼装」「用字段重填」类按钮。用户改连线、表演或附件后正文 MUST NOT 被自动改写，因为正文只由人或 Agent 写入。

#### Scenario: 改参考无黄字

- **WHEN** 用户为出片镜新增一条角色参考连线
- **THEN** 面板无过期警告，正文保持不变，附件清单更新

#### Scenario: 无不可点动作

- **WHEN** 用户展开出片提示词正文区
- **THEN** 不存在仅存在于文案中、界面上无对应按钮的「点模板渲染」或「重新拼装」主操作

#### Scenario: 无第二份正文入口

- **WHEN** 用户在出片 Tab 内查找正文编辑位置
- **THEN** 只有出片提示词面板内的正文区可编辑，运镜与语义区块无正文输入框

## ADDED Requirements

### Requirement: 正文来源徽章

出片镜「本次出片提示词」面板 MUST 以徽章区分正文来源：人工编辑过的正文标为已手改；来自 `video_prompt` 且未被人工编辑的正文标为正文；存量 `video_prompt_override` 标为旧版本正文。MUST NOT 出现「语义层」「脚本拼装」「模板渲染」作为默认主路径徽章，MUST NOT 出现「旧快照」过期徽章。

#### Scenario: 人工编辑徽章

- **WHEN** 该镜 `video_prompt` 在 `handEdited` 中
- **THEN** 徽章标出正文已由人工编辑

#### Scenario: 普通正文徽章

- **WHEN** 正文来自 `video_prompt` 且该字段不在 `handEdited` 中
- **THEN** 徽章标出正文来源为镜头正文

#### Scenario: 存量快照徽章

- **WHEN** 该镜存在非空 `video_prompt_override`
- **THEN** 徽章标出这是旧版本保存的正文

## REMOVED Requirements

### Requirement: 出片提示词来源徽章

**Reason**: 原徽章集合（已手改 / 语义层 / 脚本拼装）对应已删除的自动拼装层；新模型没有「语义层」与「脚本拼装」两种正文来源。

**Migration**: 见「正文来源徽章」。存量镜头的 `video_prompt` 内容与出片请求不变，仅徽章文案收敛。
