# shot-transition-video-prompt Delta

## ADDED Requirements

### Requirement: 转场模板与单镜共用设置技能

转场「模板渲染」与改稿弹窗 MUST 使用与分镜相同的 `seedance-prompt-render` 设置模板；bundle `kind: transition` MUST 携带 `inputMode`、首尾帧策略、食谱提示等字段供模型遵守，不得在代码中维护第二套转场专用九段 system。

#### Scenario: 纯文本转场渲染

- **WHEN** 转场 `inputMode` 为 text 且用户触发模板渲染
- **THEN** 渲染正文 MUST NOT 包含不存在的首尾帧锚点表述，且使用的 task 模板与分镜渲染相同来源

### Requirement: 转场改稿弹窗

生成转场面板 SHALL 提供与分镜一致的 Pi 改稿弹窗与上下文检查器；写回 MUST 更新该边 `generated.renderedPrompt` 与 `render_meta`。

#### Scenario: 改稿写回转场

- **WHEN** 用户在转场改稿会话中成功写回
- **THEN** 转场预览正文更新，且与后续 `/api/seedance` 请求 prompt 一致（经现有 finalize 结构锚点规则时仍逐字一致）
