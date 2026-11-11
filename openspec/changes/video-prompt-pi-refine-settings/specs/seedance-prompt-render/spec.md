# seedance-prompt-render Delta

## ADDED Requirements

### Requirement: 设置页为唯一模板来源

分镜出片与镜间转场出片的九段渲染说明 SHALL 仅来自设置页技能 **`seedance-prompt-render`** 的「角色与约束」与「任务模板」（含用户覆盖）。系统 MUST NOT 在代码中维护与设置无关的长期独立 system 文案作为默认路径。单镜（`bundle.kind: shot`）与转场（`bundle.kind: transition`）MUST 共用同一技能与同一份设置覆盖。

#### Scenario: 用户覆盖任务模板后一键渲染

- **WHEN** 用户在设置页修改 `seedance-prompt-render` 的任务模板并保存，随后在分镜或转场面板点击「模板渲染」
- **THEN** 送入大模型的 system/task 与设置页当前生效全文一致（标为 override 时与内置不同）

#### Scenario: 恢复默认技能

- **WHEN** 用户在设置页对 `seedance-prompt-render` 点「恢复默认」
- **THEN** 后续渲染使用内置 SKILL 正文，且检查器显示 source 为 builtin

### Requirement: 渲染失败保留上次成功结果

渲染 API 或 Pi 工具失败时，系统 MUST 保留上一次成功的 `rendered_prompt`（若有）。系统 MUST NOT 回退到运行时拼接后缀正文；用户可继续使用已有渲染层、语义层或手改正文出片（依优先级）。

#### Scenario: 渲染超时

- **WHEN** 模板渲染请求超时且存在上次成功 `video_prompt_rendered`
- **THEN** 面板保留上次正文并显示失败原因，出片仍可使用该渲染层（指纹未变时）

### Requirement: 模板变更可追踪

每次渲染 MUST 在 `render_meta` 记录可比对「设置+内置技能 revision」的 `templateVersion`（或等价 digest）。用户修改设置中的 role 或 task 后，旧 `rendered_prompt` MUST 标为模板 stale，直至用户重新渲染或改稿写回。

#### Scenario: 修改设置后 stale

- **WHEN** 用户保存技能覆盖且 digest 与上次渲染 meta 不同
- **THEN** 面板显示模板已更新类警告，并提示重新渲染
