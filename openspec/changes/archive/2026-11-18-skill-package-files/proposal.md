# Proposal

## Why

技能包的正文（`SKILL.md`）里大量引用同包的 `references/`、`scripts/`、`assets/` 文件，但当前存储模型只保留一份正文：解压时 `extractSkillMdFromZip` 只挑出 `SKILL.md`，其余条目丢弃；`skill_installs` 表只有 `text` 一列；内置技能只从 `skills/<id>/SKILL.md` 读正文。结果是模型拿到的正文里 122 个本地链接中有 56 个指向磁盘上不存在或不可读的文件，等于给出了无法兑现的指引。

市场安装、本地 zip 上传、仓库内置三条来源都受影响，且问题不在市场接口，而在存储与读取两侧都只有「一个正文位」。

## What Changes

- 技能包安装 SHALL 保存全部文件，而不只是 `SKILL.md`：解压结果整体落到可写状态根的 `installed-skills/<id>/`，目录结构与 zip 内一致。
- 新增只读工具 `read_skill_file(id, path)`，让 Pi 按需读取包内某个文件，而不是把整包塞进上下文。
- 技能文件解析统一走「安装目录优先、内置目录回落」，使仓库内置技能的 `references/` 也能被读到，而不只是躺在仓库里。
- 卸载技能 SHALL 连目录一起删除，不留孤儿文件。
- 内置技能与安装技能的文件读取 SHALL 共用同一套路径校验（拒绝 `..`、绝对路径、符号链接逃逸）。
- **BREAKING**（数据层，非接口）：以仓库 `skills/` 包为准，清理 19 条 Nov 14 的 `provider=upload` 安装记录——这些记录是另一代会话上传的纯文本，其 `references/` 本机已不存在，且与磁盘包正文不一致（12 个技能的正文与磁盘版本不同）。清理后这 19 个技能回落到 `builtin`，正文与附件自洽。
- 技能详情 SHALL 显示该包有哪些附加文件、共多少个，让「本包无附件」是可见状态而不是静默缺失。

不在本次范围：在创意会话里执行技能包自带的脚本（`scripts/*.mjs`）。落盘只兑现文件可读，脚本执行需要单独的受限执行工具，另案处理。

## Capabilities

### New Capabilities

- `skill-packages`: 技能包的安装、磁盘布局、目录优先级、子文件读取与卸载清理。

### Modified Capabilities

- `creative-experts`: 专家技能白名单（`skillIds`）的约束范围需要覆盖新增的 `read_skill_file`，否则专家模式下会出现「工具已注册但被白名单拦掉」的缺口。

## Impact

- `server/skillZip.mjs`：解压返回值从单文件改为全量条目。
- `server/skills.mjs`：目录扫描与单文件读取支持两个根（`installed-skills/<id>/` 与 `skills/<id>/`）。
- `server/app.ts`：`/api/skillhub/install`、`/api/skills/upload-zip` 落盘；`DELETE /api/skill-installs/<id>` 清目录；`/api/skills` 增加附件清单字段。
- `server/db.mjs`：`skill_installs.meta` 记录目录、文件数、字节数；删除时联动清理。
- `src/agent/stageTools.ts`：新增 `read_skill_file`；技能读工具清单在 `src/skills/tools.ts`、`src/creative/expertToolGroups.ts`、`src/creative/expertTools.ts`、`src/creative/creativeTurnPayload.ts` 四处同步登记。
- `src/settings/SkillInstalledCatalog.tsx` / `SkillInstalledDetailDialog.tsx`：展示附件清单。
- 验收脚本：`verify-skill-upload-zip.mjs` 的 fixture 需带 `references/` 文件，断言落盘与可读；`verify-skills-api.mjs` 增加目录优先级断言。
- 数据迁移：一次性清理 19 条 `upload` 安装记录，需在实现阶段执行并留可回滚说明。
