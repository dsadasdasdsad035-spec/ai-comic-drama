# Spec Delta

## MODIFIED Requirements

### Requirement: 自动正文优先级

在无手改层时，出片自动正文 SHALL 按下列顺序择一作为正文底座：`video_prompt` 非空 → 使用该字段；否则 `prompt` 非空 → 使用该字段；否则使用脚本拼装结果。`video_prompt_rendered` 及 `video_prompt_render_meta` MUST NOT 参与该优先级链。选定底座后，系统 MUST 把右侧尚未进入正文的字段作为方向性指令块追加到正文末尾。

#### Scenario: 忽略陈旧九段层

- **WHEN** 镜头存有 `video_prompt_rendered` 且 `video_prompt` 非空
- **THEN** 出片正文底座为 `video_prompt`，面板不显示「模板渲染过期」类警告

#### Scenario: 双空走脚本

- **WHEN** 镜头无手改、`video_prompt` 与 `prompt` 皆空
- **THEN** 出片正文为脚本拼装，来源标识为脚本拼装

#### Scenario: 手改优先

- **WHEN** 镜头存在有效 `video_prompt_override`
- **THEN** 出片正文为手改全文，脚本拼装与语义层均不覆盖，也不追加任何自动指令块

## ADDED Requirements

### Requirement: 自动正文覆盖右侧全部出片字段

无手改时，自动正文 MUST 覆盖下列右侧可编辑字段，已存在的同类段落 MUST NOT 重复追加：

- 景别、运镜与镜头语言条目（`size` / `move` / `lexiconRefKey` / `motionNote`）→ `【运镜】`
- 台词本体 → `【台词】`（原生音频模式下由声音段承载，不重复）
- 表演逐角色：情绪、强度、动作、视线、是否本镜说话 → `【表演方向】`
- 台词表演逐行：情绪、语速、音量、重音 → 并入 `【表演方向】`
- 原生音频：说话角色、台词、音色参考 → `声音：`
- 参考图槽位：按实际提交顺序生成 `@图像N=标签`（无参考视频时用 `[图N]=标签`），表情参考 MUST 标注用途 → `参考图：`
- 参考视频：`@视频1` 只继承机位运动、走位与相对位置，不照搬白模材质 → 参考视频范围约束
- 全局负向约束：无字幕、无水印、无文字 UI、身份与服装连续 → `【约束】`

#### Scenario: 只填了运动提示词

- **WHEN** 镜头有 `video_prompt`，同时填了表演强度、视线与台词语速
- **THEN** 正文以 `video_prompt` 开头，随后出现 `【运镜】`、`【表演方向】`（含强度、视线、语速）与 `【约束】`

#### Scenario: 景别运镜不被运动提示词挤掉

- **WHEN** 镜头有自定义 `video_prompt` 但没有写景别与运镜
- **THEN** 正文仍补出 `【运镜】` 段，包含景别、运镜与镜头语言条目

#### Scenario: 参考视频

- **WHEN** 镜头连线上一条视频素材并自动拼装正文
- **THEN** 正文出现 `@视频1` 且只描述运动范围约束，不要求外观与视频一致

#### Scenario: 手改正文不追加

- **WHEN** 用户保存了手改正文
- **THEN** 请求的 `prompt` 与手改全文逐字一致，不追加 `【运镜】`、`【表演方向】` 等自动段

### Requirement: 出片面板显示提交目标与实际正文

出片面板 MUST 在正文旁显示本次提交的模型名称、模型 ID、渠道、出片模式、秒数、分辨率与画幅，并 MUST 明确声明正文逐字提交。视频任务成功后，系统 MUST 记录服务端回报的实际 `prompt`，用户 MUST 能查看当前视频对应的那次提交正文；没有记录的旧视频仍显示未记录。

#### Scenario: 打开出片 Tab

- **WHEN** 用户选中 `prodKind === 'video'` 的镜头
- **THEN** 面板显示「提交给 <模型>」与参数行，正文下方声明逐字提交

#### Scenario: 服务端回报正文

- **WHEN** 视频提交被接受
- **THEN** 服务端返回的 `prompt` 写入该镜 `video_meta.prompt`，面板「当前视频的提示词」显示该值

#### Scenario: 服务端不再二次改写

- **WHEN** 正文已包含 `@视频1`
- **THEN** 服务端 MUST NOT 再追加范围约束；未包含时只追加一次
