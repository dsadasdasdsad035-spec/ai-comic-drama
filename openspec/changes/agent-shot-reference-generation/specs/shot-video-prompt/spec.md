# Spec Delta

## ADDED Requirements

### Requirement: Agent 出片与画布共用统一拼装

Agent 的出片工具 MUST 使用与画布出片同一个拼装入口（`buildShotVideoRequest`），按解析结果决定参考图、参考视频、音频参考与首帧，并按请求的 `mode` 映射到出片接口参数。它 MUST NOT 只把首帧图片发出去而忽略 `refIds` 指向的其他参考。

拼装的阻塞项（如没有首帧、原生音频缺条件）MUST 让工具在提交前失败并给出与画布一致的原因；被客户端上限省略的参考 MUST 在返回结果中列出。

出片正文 MUST 走与画布相同的优先级（`effectiveVideoPrompt`）：有手改覆盖时逐字使用，否则用请求拼装出的正文。工具 MUST 沿用宿主当前选中的视频模型与分辨率，避免同一镜在画布与 Agent 两条路径上落到不同渠道。

出片工具仍 MUST 只提交不等待，成功时返回任务 id，MUST NOT 直接写入该镜的成片字段。

#### Scenario: 相邻镜与素材一起送出

- **WHEN** 出片镜 `S02` 的 `refIds` 含 `shot-prev` 与一个素材图，且上镜已有首帧
- **THEN** 提交请求的 `refImages` 同时包含上镜首帧与素材图，返回结果不含阻塞项

#### Scenario: 无手改时正文来自拼装

- **WHEN** 该镜有 `video_prompt` 且没有手改覆盖
- **THEN** 提交的 `prompt` 等于 `buildShotVideoRequest` 拼装出的正文，而不是工具自行挑选的字段

#### Scenario: 手改正文逐字使用

- **WHEN** 该镜保存了 `video_prompt_override.text`
- **THEN** 提交的 `prompt` 与手改内容逐字相同

#### Scenario: 阻塞项不提交

- **WHEN** 请求拼装返回阻塞项（如出片镜没有首帧且不支持参考模式）
- **THEN** 工具返回失败并给出该阻塞原因，不调用出片接口

#### Scenario: 未提供视频模型时使用宿主默认

- **WHEN** 宿主没有注入当前视频模型
- **THEN** 工具仍能提交请求，接口按服务端默认模型处理，且不因此静默丢弃参考

## MODIFIED Requirements

（无）

## REMOVED Requirements

（无）
