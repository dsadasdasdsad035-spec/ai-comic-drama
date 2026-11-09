# Cinematic Transition Skills（双技能组合）

来源包：`transition-director` + `cinematic-transition`（已迁入本仓库 `skills/` 并改 frontmatter）。

1. **transition-director**：判断相邻镜转场类型，输出决策与 YAML handoff，可 `submit_joins` 写决策字段。
2. **cinematic-transition**：根据 handoff 生成桥接视频提示词等，经 `submit_joins` 写入 `generated.prompt` / `sound_prompt`。

推荐顺序（镜头表聊天）：

1. 默认 **shotlist** 拆镜 → `submit_shots`
2. 内置「镜间转场决策」→ **transition-director** → 复制 YAML
3. 内置「转场视频提示词」→ 在 handoff 框粘贴 YAML → **cinematic-transition** → `submit_joins`

`transition-planner` 仍为单步合并技能，可在设置里手动选用，但镜头表默认走上述双技能链。

原始通用格式说明见用户目录 `~/Downloads/cinematic-transition-skills/README.md`。
