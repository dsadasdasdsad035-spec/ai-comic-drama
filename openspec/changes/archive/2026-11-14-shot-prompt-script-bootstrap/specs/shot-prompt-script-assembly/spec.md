# Spec Delta

## Purpose

在分镜出片的运动/画面提示词为空时，用参考附件与镜表字段确定性拼装可读的中文正文，作为冷启动填充；不调用文本模型、不持久化独立「模板层」。

## ADDED Requirements

### Requirement: 空提示词时脚本拼装正文

当镜头无有效手改层，且 `video_prompt` 与 `prompt`（画面提示词）经裁剪后均为空时，系统 MUST 调用确定性脚本拼装器生成出片正文。拼装 MUST 同步完成、同输入同输出，MUST NOT 调用 LLM 或外部渲染 API。

#### Scenario: 有运动提示词时不拼装

- **WHEN** 镜头 `video_prompt` 非空且无手改层
- **THEN** 出片正文为该字段内容，来源标识为语义层

#### Scenario: 仅画面提示词时不拼装

- **WHEN** 镜头 `video_prompt` 为空但 `prompt` 非空且无手改层
- **THEN** 出片正文为 `prompt` 回退路径，来源标识为语义层

#### Scenario: 双空时拼装

- **WHEN** 镜头 `video_prompt` 与 `prompt` 皆空、无手改层，且存在至少一张可提交的参考图或参考视频或原生音频所需连线
- **THEN** 出片正文由脚本拼装器生成非空中文正文，来源标识为脚本拼装

### Requirement: 脚本正文纳入附件与场域上下文

脚本拼装 MUST 反映当前 `buildShotVideoRequest` 同级输入：实际提交的参考图槽位与标签、参考视频（仅运动）、音色参考、景别/运镜/时长、台词与表演摘要、邻镜连续性约束（若有）。MUST NOT 在拼装正文中声称附加了面板未列出的参考。

#### Scenario: 参考图映射

- **WHEN** 镜头连线两张角色参考图并双空提示词
- **THEN** 拼装正文包含与「图1」「图2」一致的主体称谓或用途说明

#### Scenario: 视频参考限定

- **WHEN** 镜头连线一条视频素材且双空提示词
- **THEN** 拼装正文说明该视频仅参考运动/机位/节奏，外观以参考图与文字为准

#### Scenario: 输入变化即时反映

- **WHEN** 用户在音画 Tab 修改台词或表演后仍双空提示词
- **THEN** 再次打开出片面板时正文随当前输入更新，且 MUST NOT 要求用户「重新模板渲染」

### Requirement: 脚本拼装与预览请求一致

脚本拼装产出的正文 MUST 作为 `buildShotVideoRequest` 返回的 `prompt` 字段值；面板展示 MUST 与该值逐字一致。

#### Scenario: 生成前预览

- **WHEN** 用户满足出片条件且正文来自脚本拼装
- **THEN** 点「生成视频」时 API `prompt` 与面板 `pre` 正文完全相同
