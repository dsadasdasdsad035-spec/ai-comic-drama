# Spec Delta

## MODIFIED Requirements

### Requirement: 自动正文优先级

在无手改层时，出片自动正文 MUST 逐字等于镜头 `video_prompt` 字段。系统 MUST NOT 在该字段之外追加任何由 `size`、`move`、`lexiconRefKey`、`motionNote`、`dialogue`、`performance`、`dialogueDelivery`、`audioMode`、`refIds` 或参考视频推导出的段落。`prompt`（首帧正文）与 `video_prompt_rendered` 及 `video_prompt_render_meta` MUST NOT 参与该正文来源，也 MUST NOT 作为 `video_prompt` 为空时的回落。`video_prompt` 为空时系统 MUST 以 blocking 阻断出片，MUST NOT 用任何兜底正文顶替。

#### Scenario: 忽略陈旧九段层

- **WHEN** 镜头存有 `video_prompt_rendered` 且 `video_prompt` 非空
- **THEN** 出片正文为 `video_prompt` 逐字内容，面板不显示「模板渲染过期」类警告

#### Scenario: 正文逐字等于 video_prompt

- **WHEN** 镜头 `video_prompt` 为「雨夜追车，镜头推进」，且该镜有景别、运镜、台词、表演与三张参考图
- **THEN** 请求 `prompt` 与面板正文都逐字等于「雨夜追车，镜头推进」，MUST NOT 出现 `【运镜】`、`【台词】`、`【表演方向】`、`声音：`、`参考图：`、`@视频1` 或 `【约束】`

#### Scenario: 双空走脚本

- **WHEN** 镜头无手改、`video_prompt` 与 `prompt` 皆空
- **THEN** 面板显示 `shot-prompt-empty` 阻止项并给出补写入口，主按钮禁用，MUST NOT 以脚本拼装或硬编码文案顶替

#### Scenario: 手改优先

- **WHEN** 镜头存在有效 `video_prompt_override`
- **THEN** 出片正文为手改全文，`video_prompt` 与任何推导段落均不覆盖

### Requirement: 手改提示词保存到本镜并逐字使用

系统 SHALL 允许把最终提示词正文改为手写版本并按镜头保存；保存后生成 MUST 逐字发送该版本，刷新页面和重新打开项目后 MUST 仍保留。用户 MUST 能清除手改并恢复自动正文，自动正文即镜头 `video_prompt` 的逐字内容（见「自动正文优先级」）；清除手改后若该字段为空，系统 MUST 以 `shot-prompt-empty` 阻断而非回落到任何拼装结果。

#### Scenario: 手改后生成

- **WHEN** 用户编辑正文并保存，然后点生成
- **THEN** 请求的 `prompt` 等于用户保存的全文，不再追加自动拼装的任何段落

#### Scenario: 重新打开项目

- **WHEN** 用户保存手改版本后刷新页面或重新打开项目
- **THEN** 该镜头仍显示手改版本和「已手改」状态

#### Scenario: 恢复自动拼装

- **WHEN** 用户点「恢复自动拼装」
- **THEN** 手改版本被清除，正文回到 `video_prompt` 的逐字内容；该字段为空时显示 `shot-prompt-empty` 阻断

#### Scenario: 旧镜头

- **WHEN** 镜头没有手改记录
- **THEN** 出片使用 `video_prompt` 的逐字内容；为空时同一阻断生效

## REMOVED Requirements

### Requirement: 恢复自动拼装含脚本路径

**Reason**: 脚本拼装（`shotAutoScriptPrompt`）是运行时按画布上下文机械生成正文的路径，与「正文只能由人/Agent 写入」直接冲突。正文为空改为阻断后，不再需要「回落到脚本拼装而非空字符串」这条保证。

**Migration**: 清除手改后若 `video_prompt` 为空，面板改为显示阻断项而非脚本拼装正文；用户需通过 Inspector 或创意会话写入 `video_prompt`。存量空正文分镜在升级后会被阻断，需补写一次。

## ADDED Requirements

### Requirement: 正文只由 Agent 或用户写入

分镜出片正文 MUST 只有两个来源：镜头 `video_prompt` 字段，或已保存的手改正文 `video_prompt_override.text`。系统 MUST NOT 在运行时把 Inspector 可编辑字段机械转换为句式追加进正文，MUST NOT 在服务端对正文做任何追加或兜底。字段（景别、运镜、镜头语言、动作备注、台词、表演、台词表演、原生音频、参考图、参考视频）MUST 作为**数据**供创意会话读取，由 Agent 自行组织语言写入 `video_prompt`。

#### Scenario: 服务端零改写

- **WHEN** 前端提交正文「雨夜追车，镜头推进」且该镜带一条参考视频
- **THEN** 服务端送入模型的 `prompt` 与提交值逐字相同，MUST NOT 追加 `@视频1` 约束段

#### Scenario: 服务端不兜底空正文

- **WHEN** 直接调用接口且 `prompt` 为空
- **THEN** 请求以参数错误拒绝，MUST NOT 注入任何默认文案

#### Scenario: 字段不进入正文

- **WHEN** 用户在 Inspector 修改景别、运镜或表演强度但未改 `video_prompt`
- **THEN** 出片正文不变，面板明确提示这些字段不参与正文、需由创意会话或手写并入

### Requirement: 出片输入对 Agent 可见

系统 MUST 提供只读工具返回某镜本次出片的全部输入，除正文之外至少包含：按实际提交顺序排列的参考图列表（每项含标签、用途与槽位）、被上限或规则省略的参考项及原因、出片模式、镜头秒数与请求秒数。参考图顺序 MUST 与出片请求实际提交顺序一致，MUST NOT 只返回 `refIds` 原始 token 由 Agent 自行推断。

#### Scenario: 读取有序参考

- **WHEN** 某镜连线两名角色与一张素材，其中一名角色开启表情参考
- **THEN** 工具返回按提交顺序排列的参考列表，表情参考项标注用途，Agent 可据此写出 `[图1]=…` 映射

#### Scenario: 省略项可见

- **WHEN** 参考图数量超过上限
- **THEN** 工具列出未提交的项及原因，MUST NOT 静默丢弃

#### Scenario: 无参考

- **WHEN** 某镜没有任何参考图与参考视频
- **THEN** 工具返回空列表与对应出片模式，Agent 据此判断正文只能写字面描述

### Requirement: 出片面板显示提交目标与实际正文

出片面板 MUST 在正文旁显示本次提交的模型名称、模型 ID、渠道、出片模式、秒数、分辨率与画幅，并 MUST 明确声明正文逐字提交。视频任务成功后，系统 MUST 记录服务端回报的实际 `prompt`，用户 MUST 能查看当前视频对应的那次提交正文；没有记录的旧视频仍显示未记录。

#### Scenario: 打开出片 Tab

- **WHEN** 用户选中 `prodKind === 'video'` 的镜头
- **THEN** 面板显示「提交给 <模型>」与参数行，正文下方声明逐字提交

#### Scenario: 服务端回报正文

- **WHEN** 视频提交被接受
- **THEN** 服务端返回的 `prompt` 写入该镜 `video_meta.prompt`，面板「当前视频的提示词」显示该值
