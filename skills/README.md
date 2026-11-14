# 技能作者指南

仓库**附带平台默认技能**，位于 `skills/<id>/SKILL.md`，随安装自动可用（`source: builtin`，只读）。
安装 SkillHub / 本地上传的同名技能包会覆盖内置版本，卸载后回退到内置正文。

当前内置技能（19 个）：

- 短剧系列：`short-drama`、`short-drama-develop`、`short-drama-write`、`short-drama-breakdown`、`short-drama-storyboard`、`short-drama-assets`、`short-drama-image-prompts`、`short-drama-video-prompts`、`short-drama-produce`、`short-drama-edit`、`short-drama-review`、`short-drama-novel-analyze`
- 小说系列：`novel-outline`、`novel-characters`、`novel-script`、`novel-staging`、`novel-storyboard`、`novel-art`
- 角色参考：`character-refs`

**平台 `read_*` / `submit_*` / `validate_contract` 为应用内置工具**，不在 SKILL 里声明。

本地验收：`node verify-skill-upload-zip.mjs`

## Agent 技能包（唯一安装形态）

```markdown
---
name: my-skill
description: |
  一句话或长说明（支持多行）
allowed-tools:
  - Read
metadata:
  version: 1.0.0
---
## my-skill
操作说明（任意结构；Pi 用 read_skill_text 读全文）
```

- `name` 必须与 zip 目录 / 安装 id 一致（小写+连字符）。
- **不要**写 `stage`、`tools`、`submit_*`、`## 角色与约束` / `## 任务` —— 旧 **workbench 形态已停用**。
- 安装后：设置 → 已安装；创意顶栏选为宿主。

## 平台内置工具（非技能）

| 写工具 | 契约 |
|--------|------|
| submit_characters | characters-v1 |
| submit_designs | designs-v1 |
| submit_shots | shots-v1 |
| submit_prompts | prompts-v1 |
| submit_joins | joins-v1 |

另有 read_source、read_shots、read_skill_text、validate_contract 等。创意 Pi **默认绑定**；写回须顶栏已选项目。

## 3D 运行时例外

若本地存在 `skills/scene3d/SKILL.md`（旧 manifest），仅供 **3D 场景 Agent**；与 SkillHub 宿主无关。

## 接口

- `GET /api/skills`：已安装列表
- `POST /api/skills/upload-zip`：仅 Agent 包
- SkillHub：`/api/skillhub/install`