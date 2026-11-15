# 技能正文 fixture

工作台技能（`script` / `character` / `asset` / `shotlist` / `prompt` / `scene3d` / `scene-code*`）已改为从 SkillHub 安装，仓库不再发布这些 `SKILL.md`。但有几组单元测试要对**旧版正文**做逐字比对（角色层等于旧 SYS、BASE 未被拆开、任务模板等于旧 inline prompt、旧规则包迁移后逐字等于旧 SYS），所以把当时的正文钉在这里。

约定：

- 这些文件只给测试用，运行时不装载（技能扫描只看仓库根的 `skills/`）。
- 正文内容不再演进：要改行为就改 `skills/` 下的现行技能，并同步更新对应测试。
- frontmatter 里过期的字段按现行枚举对齐过：`script` 环节已从 `STAGES` 移除，`script` fixture 暂用 `stage: character` 占位，仅用于解析；`shotlist` 的 `tools` 补上了当前宿主实际绑定的 `read_source` / `read_episodes`。
