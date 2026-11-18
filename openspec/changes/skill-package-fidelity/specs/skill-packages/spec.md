# Spec Delta

## MODIFIED Requirements

### Requirement: 安装保存包内全部文件

技能包安装 SHALL 保存 zip 内所有文件，不得只保留 `SKILL.md`。安装后的目录结构 MUST 与 zip 内（剥离公共顶层目录后）一致，层级与文件名不做重写。0 字节文件同样是包内文件，MUST 照常落盘，MUST NOT 因内容为空被跳过。

#### Scenario: 市场安装保留 references

- **WHEN** 客户端 `POST /api/skillhub/install` 且该包 zip 含 `references/guide.md`
- **THEN** 安装目录内存在 `references/guide.md`，内容与 zip 内字节一致

#### Scenario: 上传 zip 保留子目录

- **WHEN** 客户端 `POST /api/skills/upload-zip` 提交含 `scripts/run.py` 与 `assets/a.json` 的包
- **THEN** 安装目录内两个文件都存在，且安装响应列出这两个路径

#### Scenario: 纯文本上传仍可安装

- **WHEN** 客户端以纯文本（非 zip）提交一个只有 `SKILL.md` 的包
- **THEN** 安装成功，该包目录内只有 `SKILL.md`，附加文件数为 0

#### Scenario: 空文件保留

- **WHEN** 安装的包内含 0 字节文件（如 `references/.keep`、`scripts/__init__.py`、空 `config.yaml`）
- **THEN** 安装目录内存在同名文件，大小为 0，且附件清单列出该路径

#### Scenario: 空 SKILL.md 仍被拒绝

- **WHEN** 包内 `SKILL.md` 为 0 字节或仅含空白
- **THEN** 安装被拒绝，错误说明 SKILL.md 为空，不落盘半份目录

## ADDED Requirements

### Requirement: 缺文件的安装记录可见

当 `skill_installs` 存在某技能记录、但该技能的安装目录不存在时，技能列表回执 SHALL 标明「正文来自安装记录，包内文件不在磁盘上」。该标记 MUST 依据安装目录是否存在判定，MUST NOT 以附件数为 0 判定——纯文本上传的包目录存在且附件本就为 0，不得被误报。

#### Scenario: 旧记录缺目录

- **WHEN** `skill_installs` 有某 id 的记录，且 `installed-skills/<id>/` 不存在
- **THEN** `GET /api/skills` 与该技能详情回执带缺文件标记，`list_installed_skills` 的技能行同样带该标记

#### Scenario: 纯文本包不误报

- **WHEN** 通过纯文本接口安装的包在磁盘上只有 `SKILL.md`
- **THEN** 回执不带缺文件标记，附件数为 0 仍如实展示

#### Scenario: 正常安装不误报

- **WHEN** 市场安装或 zip 上传成功且安装目录存在
- **THEN** 回执不带缺文件标记，附件清单来自该目录
