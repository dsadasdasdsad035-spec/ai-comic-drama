# Proposal

## Why

用户不懂 Blender，希望只靠 3D 聊天描述想法即可获得可运行预演与 MP4。内置 `scene3d` 角色层过薄，模型易犯构图/相机/准入错误，增加 `run_render` 失败轮次。

## What

- 加厚内置 `skills/scene3d/SKILL.md`（v4）：预演技术导演人设、分镜映射、灯光构图默认值、失败修复顺序。
- 对齐 `scene-code` / `scene-code-chat`（v2）一次性生成与改码口吻。
- 不改 ABI、工具集或渲染宿主协议。

## Capabilities

- `scene-agent-runtime`：MODIFIED — agent 技能正文承载预演专业准则（行为期望，非新工具）。
