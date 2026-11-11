# seedance-prompt-render Delta

## ADDED Requirements

### Requirement: 结构化 bundle 驱动模板渲染

系统 SHALL 提供将 `PromptRenderBundle`（`schemaVersion`、`kind` 为 `shot` 或 `transition`）与固定九段中文模板一并送入大模型的渲染能力。渲染输出 MUST 为单条可直接提交给 Seedance 的 `rendered_prompt` 字符串；MUST NOT 在出片请求的同步拼装路径内调用大模型。

#### Scenario: 单镜渲染成功

- **WHEN** 用户为某分镜触发「模板渲染」，且 bundle 与当前附件指纹一致
- **THEN** 系统持久化 `rendered_prompt` 与 `render_meta`（含 `fingerprint`、`templateVersion`、`renderedAt`、所用模型）

#### Scenario: 转场渲染成功

- **WHEN** 用户为一条生成转场边触发「模板渲染」，bundle 含 `transition.inputMode` 与 A/B 镜摘要
- **THEN** 系统持久化到该边 `generated.rendered_prompt`，且正文中 MUST NOT 声称不存在的首尾帧锚点（纯文本模式时）

### Requirement: bundle 与面板附件一致

构建 bundle 时，§2 资产列表 MUST 与出片面板将提交或显式省略的附件一一对应（含 `submitted`、`omitReason`、`inherit` 语义）。bundle MUST 纳入表演、台词、运镜走位、原生音频策略与 Seedance 规则摘要字段，供模型填写模板 §3–§9。

#### Scenario: 省略参考写入 bundle

- **WHEN** 候选参考图超过上限，第 5 张被省略
- **THEN** bundle 中该资产 `submitted: false` 且带省略原因，渲染正文 MUST 不要求模型使用未提交的槽位

### Requirement: 渲染失败不破坏出片

渲染 API 或技能失败时，系统 MUST 保留上一次成功的 `rendered_prompt`（若有），并 MUST 允许用户继续使用机械拼装回退路径出片。

#### Scenario: 渲染超时

- **WHEN** 模板渲染请求超时
- **THEN** 面板显示失败原因，出片仍可用未渲染或上次渲染结果/回退正文（依指纹与字段是否存在）

### Requirement: 模板版本可追踪

每次渲染 MUST 记录 `templateVersion`（如 `seedance-2.5-cn-9`）。模板升级后旧 `rendered_prompt` MUST 标为过期，直至用户重新渲染。

#### Scenario: 模板升级

- **WHEN** 宿主升级内置模板版本号
- **THEN** 所有 `render_meta.templateVersion` 落后于内置版本的镜头显示「模板已更新」类 stale 提示
