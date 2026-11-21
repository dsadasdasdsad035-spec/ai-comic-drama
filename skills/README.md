# 技能作者指南

仓库**附带平台默认技能**，位于 `skills/<id>/SKILL.md`，随安装自动可用（`source: builtin`，只读）。
安装 SkillHub / 本地上传的同名技能包会覆盖内置版本，卸载后回退到内置正文。

当前内置技能（共 13 个，含 `byted-sol-seedance-prompt`）：

- 短剧系列：`short-drama`、`short-drama-develop`、`short-drama-write`、`short-drama-breakdown`、`short-drama-storyboard`、`short-drama-assets`、`short-drama-image-prompts`、`short-drama-video-prompts`、`short-drama-produce`、`short-drama-edit`、`short-drama-review`、`short-drama-novel-analyze`
- 视频提示词：`byted-sol-seedance-prompt`

**平台 `read_*` / `submit_*` 为应用内置工具**，不在 SKILL 里声明；写回时宿主内建契约校验。

本地验收：`node verify-skill-upload-zip.mjs`、`node verify-skills-api.mjs`、`node verify-skills-unit.mjs`

## 目录布局：整包落盘

一个技能包 = 一个目录，`SKILL.md` 与附件同级存放：

```text
skills/<id>/                 # 内置：随代码分发，只读
├── SKILL.md
├── references/*.md          # 规则细则，模型按需逐个读
├── scripts/*                # 仅随包保存，平台不执行
└── assets/*                 # 图片等素材（≤1MB/个）

installed-skills/<id>/       # 安装/上传：可写状态根，同结构
```

- 安装根是 `<stateRoot>/installed-skills/`；dev 模式下 `SB_STATE_ROOT` 未设置时回退仓库根，因此该目录已 gitignore，不会污染被跟踪的 `skills/`。
- **逐文件优先级**：同名路径先看 `installed-skills/<id>/`，没有才回退 `skills/<id>/`。所以覆盖装只替换你带上来的文件，没带的仍用内置那份。
- 安装是原子替换：先写临时目录，旧目录改名为 `.bak`，成功后才 rename 到位；任一步失败回滚旧目录，不会出现「正文新、附件旧」的半份状态。
- 卸载（`DELETE /api/skill-installs/<id>`）同时删目录与记录；对仅内置的 id 会拒绝，内置文件不受影响。

## 附件清单与 `read_skill_file`

`SKILL.md` 只放规则，细则放进 `references/`。模型不会自动看到附件内容，流程是：

1. `list_installed_skills` → 每行带 `files`（该包附件相对路径）与 `fileCount`；
2. `read_skill_file(id, "references/xxx.md")` 逐个读取需要的文件。

边界（全部返回 `ok:false`，不返回半份内容）：

| 情况 | 行为 |
|---|---|
| 路径含 `..` 或绝对路径 | 拒绝，说明路径不合法 |
| 符号链接指向技能目录之外 | 拒绝（zip 内的 symlink 条目在安装期就被拒） |
| 文件不存在 | 拒绝，并附该包现有文件清单，便于一次改对路径 |
| 文本文件 > 256KB | 拒绝，说明超限；安装期同样拒绝，避免「装得下但读不到」 |

设置页技能详情会列出包内文件与大小；只有一个 `SKILL.md` 的包会明确显示「无附加文件」——正文若引用不存在的文件，从这里能立刻看出来。

**平台不执行包内脚本。** `scripts/` 只是随包保存的文本，`allowed-tools` 仅用于展示与审计。要让模型遵守细则，就把细则写成 `references/` 里的 markdown 并在正文里链接它。

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
- 安装后：设置 → 智能与扩展 → 技能；创意顶栏选为宿主。

## 平台内置工具（非技能）

| 写工具 | 契约 |
|--------|------|
| submit_characters | characters-v1 |
| submit_designs | designs-v1 |
| submit_shots | shots-v1 |
| submit_prompts | prompts-v1 |
| submit_joins | joins-v1 |

`submit_joins` 只写效果接缝（预设 + 时长）；生成式转场已退役，`joins-v1` 不再接受 `mode: generated`。

另有 read_source、read_shots、read_skill_text、read_skill_file 等。创意 Pi **默认绑定**；写回须顶栏已选项目。

## 3D 运行时例外

若存在 `skills/scene3d/SKILL.md`（旧 manifest 形态），仅供 **3D 场景 Agent** 读取；与创意宿主无关。它的附件同样走 `read_skill_file`，但正文解析仍按旧 manifest。

## 接口

- `GET /api/skills`：已安装列表（每项含 `attachments` 与 `fileCount`）
- `GET /api/skills/<id>/files?path=references/x.md`：读包内单个文件
- `POST /api/skills/upload-zip`：上传技能包（全量落盘）
- `POST /api/skills/upload`：纯文本上传（只有 `SKILL.md`）
- `DELETE /api/skill-installs/<id>`：卸载（删目录 + 记录；内置 id 拒绝）
- SkillHub：`/api/skillhub/install`