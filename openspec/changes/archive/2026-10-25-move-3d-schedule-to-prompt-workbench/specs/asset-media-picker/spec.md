# Spec Delta

## ADDED Requirements

### Requirement: 3D 调度渲染的视频可被选为素材

素材选择器的视频分类 SHALL 包含本机 3D 调度渲染并保存到项目视频目录的 MP4，MUST NOT 要求用户先执行额外的「发布/导入」动作。视频条目 MUST 支持预览、确认和取消；确认后素材类型 MUST 变为 `video`，MUST NOT 自动修改镜头或自动建立连线。

#### Scenario: 渲染后出现在视频分类

- **WHEN** 用户在提示词工作台完成一次 3D 调度渲染并打开素材选择器
- **THEN** 视频分类出现该 MP4，按修改时间排序，可播放预览

#### Scenario: 确认成视频素材

- **WHEN** 用户选中该 MP4 并点击「使用这张」
- **THEN** 素材卡来源和预览更新为该视频，类型变为 `video`

#### Scenario: 取消不写入

- **WHEN** 用户预览该 MP4 后取消或按 Esc
- **THEN** 素材卡保持原来的 URL、类型和标题

#### Scenario: 文件缺失

- **WHEN** 项目里记录的渲染 MP4 已被删除
- **THEN** 选择器不把它作为可用条目，或显示明确错误并禁用确认
