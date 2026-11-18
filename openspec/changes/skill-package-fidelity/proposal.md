# Proposal

## Why

市场安装与 zip 上传已共用「全量解压 + 逐文件落盘」管线，`references/` 等附件确实能保留。但解压阶段有一条静默丢弃：`if (!data?.length) continue` 会跳过所有 0 字节文件，导致包内的 `references/.keep`、`scripts/__init__.py`、空 `config.yaml` 安装后不存在且无任何提示——这与已归档的 `skill-packages` 要求「安装后的目录结构 MUST 与 zip 内一致」直接冲突。

同时，修复前产生的安装记录只有正文、没有安装目录。这类技能在 `/api/skills` 上与「本包确实没有附件」表现完全一致（`attachments: []`、`fileCount: 0`），用户与模型都无法判断是「没有附件」还是「附件从未落盘」。

## What Changes

- **空文件不再被丢弃**：解压时只过滤目录条目与系统垃圾文件，0 字节的普通文件照常进入写盘列表；安装后磁盘结构与 zip 一致。
- **缺文件可被识别**：`skill_installs` 有记录但安装目录不存在时，`/api/skills` 的对应条目带上可读标记（例如 `filesMissing: true`），说明「该包正文来自安装记录，包内文件不在磁盘上」。
- **标记只在真缺目录时置位**：判定依据是安装目录是否存在，而不是「附件数为 0」。纯文本上装的包（`/api/skills/upload`）目录里有 `SKILL.md` 且附件本来就为 0，不得被误报为缺文件。
- **模型可见**：`list_installed_skills` 的技能行带上同一标记，使模型能向用户解释「这个技能的 references 需要重装才能补齐」，而不是反复调用 `read_skill_file` 猜测。
- **不自动修复**：读取路径不做网络重下。缺文件的记录只能通过重新安装补齐；本次只保证这件事是**可见**的。

## Capabilities

### New Capabilities

无。本次是既有安装与目录能力的行为修正，不引入新能力。

### Modified Capabilities

- `skill-packages`: 「安装保存包内全部文件」补充「0 字节文件同样必须保留」；新增一条要求，规定「安装记录存在但安装目录缺失」必须在技能列表回执中可见，且不得与「本包无附加文件」混淆。

## Impact

- 解压：`server/skillZip.mjs`（`parseSkillPackage` 的空文件过滤）。
- 目录与记录：`server/skills.mjs`（安装目录存在性判定）、`server/app.ts`（`/api/skills` 的 `attachmentsFor` 与条目字段）。
- 客户端类型与展示：`src/skills/types.ts`（记录字段）、`src/agent/stageTools.ts`（`skillSummaryRow` 行字段）、设置页技能详情可显示该状态。
- 验收：新增空文件回归用例；市场安装端到端用例补一条「含空文件的包安装后磁盘一致」断言。
- 无数据迁移：历史记录不改写，只是多一个可见标记。
