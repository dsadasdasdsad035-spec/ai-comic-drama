# Spec Delta

## ADDED Requirements

### Requirement: scene3d 内置预演技术导演技能

内置 `scene3d` 技能角色层 SHALL 指导 agent：用户以自然语言描述画面与运镜即可，agent SHALL 在锁定 ABI 内完成场景实现，并 SHALL 经 adopt（或 set_scene_code）、run_render、抓帧、验收与 finish 完成本轮。技能 MUST NOT 削弱既有工具门禁或安全规则。

#### Scenario: 用户只描述想法

- **WHEN** 用户在 3D 聊天发送口语化分镜描述而未写 bpy 细节
- **THEN** agent 依据技能预演标准编写 job 内脚本并走完整渲染与结束门禁
