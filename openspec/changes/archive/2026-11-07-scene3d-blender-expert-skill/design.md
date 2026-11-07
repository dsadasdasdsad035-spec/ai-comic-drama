# Design

## 决策

- **只改正文**：加厚 `## 角色与约束`；`scene3d-code-v1` ABI 与工具不变。
- **scene3d v4 为主**：含工作流、分镜映射、失败修复；`scene-code*` v2 为一次性生成/改写的精简同口径。
- **任务模板**：`scene3d` 的 `## 任务` 仍仅 `{{input:requirements}}`，避免破坏 `renderSkillTemplate` 测试与聊天注入形状。

## 不在范围

- 不新增工具、不放宽 `checkSceneCode`、不保证 100% 一次出 MP4。
