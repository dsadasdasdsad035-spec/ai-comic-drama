# Design

## Context

市场安装（`/api/skillhub/install`）与 zip 上传（`/api/skills/upload-zip`）都走 `parseSkillPackage` → `writeInstalledSkill`，附件落盘本身已经完整。详见 proposal.md - Why。

两个待修点及其现状：

1. `parseSkillPackage` 的文件循环里有 `if (!data?.length) continue`。fflate 的 `filter` 已排除目录条目（`name.endsWith('/')`）与 `__MACOSX` / `.DS_Store`，所以这一行实际只筛掉「合法的 0 字节文件」。读取端 `listSkillAttachments` → `collectFiles` 只看 `entry.isFile()` 与 `statSync`，0 字节文件本可正常列出，`readSkillSubFile` 也能返回空字符串——即「能存、能列、能读」的链路只被解压这一处卡住。

2. 修复前产生的安装记录只有 `skill_installs.text`，没有 `installed-skills/<id>/`。`/api/skills` 的 `attachmentsFor(id)` 从磁盘扫描结果（`listSkillFiles`）取附件，目录不存在就得到空清单。当前回执里没有任何字段区分「目录缺失」与「目录存在但没有附件」。

现状数据：live DB 的 `skill_installs` 为 0 行，`installed-skills/` 为空，20 个技能全部来自仓库内置目录且各自带附件。所以第 2 点目前是预防性的，不是正在发生的故障。

## Goals / Non-Goals

**Goals:**

- zip 内 0 字节文件安装后仍然存在，且出现在附件清单里。
- 「记录在、目录不在」可被 API 与模型识别，且不误伤纯文本上装的包。
- 判定逻辑只有一处，避免 API 与工具层各写一遍。

**Non-Goals:**

- 不自动补文件：读取路径不发网络请求重下 zip；不做后台修复任务。
- 不改 `skill_installs` 表结构，不新增列，不加迁移。
- 不改市场安装的上游协议，也不改大小上限（1MB / 256KB 继续 fail-closed）。
- 不处理「二进制附件被当文本读」的问题，那是另一个读取语义议题。

## Decisions

### 1. 只删一行过滤，不动解压其它分支

`if (!data?.length) continue` 直接移除。理由：目录条目与垃圾文件在该行之前已被两条规则排除，这一行没有其它职责；保留它会迫使后续为「空文件」加特例。

需要同步确认的点（实现时必须验收，不是假设）：

- `writeInstalledSkill` 用 `Buffer.from(f.data)` 写盘，0 字节得到空 Buffer，`fs.writeFileSync` 正常创建文件。
- `total` 累加对 0 无影响，总量上限语义不变。
- `!files.length` 的总量守卫仍保留：一个只含空目录的 zip 依然会被拒绝。

备选方案：把空文件单独收集后补写。否决——只是为了绕开一行多余判断，制造第二套写盘路径。

### 2. 缺文件判定放在服务端，用「目录存在性」

在 `server/skills.mjs` 增加一个只读判定：`hasInstalledSkillDir(appRoot, id)`，内部 `fs.existsSync(installedSkillDir(...))` 并确认是目录。

`server/app.ts` 的 `asRecord` 在 `source` 为 `skillhub` / `upload` 时计算一次 `filesMissing = !hasInstalledSkillDir(root, id)`，写进回执。

关键取舍：**不能用 `attachments.length === 0` 判定**。纯文本接口 `/api/skills/upload` 会落一个只含 `SKILL.md` 的目录，附件本来就该是 0；用它判缺会让这类包永久挂一个错误警告。

备选方案：在 `skill_installs` 加 `files_present` 列。否决——需要迁移，且这列会在目录被人为删除后立刻失真；磁盘存在性永远是当场可判的事实。

### 3. 标记沿用到工具层与界面，但只有一处来源

- 客户端类型 `SkillTextRecord` 增加可选 `filesMissing?: boolean`（服务端新字段）。
- `skillSummaryRow`（`list_installed_skills` 的行）带上 `filesMissing`，让模型能转述「该技能正文可用，但包内文件缺失，需要重装」。
- 设置页技能详情在 `filesMissing` 为真时显示一行说明，不再只显示「无附加文件」。

三个展示点共用服务端字段，前端不各自推断。

### 4. 缺文件不阻断任何既有能力

`read_skill_text` 仍返回正文；`read_skill_file` 仍按「文件不存在」失败并附现有清单（此时清单为空）。技能仍可作创意宿主。把缺文件当成硬错误会连带毁掉「正文还能用」这个事实。

## Risks / Trade-offs

- **[0 字节文件进入清单，可能被误读成有内容]** → 清单项带 `bytes: 0`，模型与用户都能看出是空文件；`read_skill_file` 返回空字符串而不是错误。
- **[zip 里大量空文件撑大清单]** → 只影响展示条数，不占空间；上传端没有文件数上限，如需限制另开变更。
- **[`filesMissing` 被误用于「附件不全」]** → 该字段语义严格限定为「安装目录不存在」，命名与文档都要写死；目录存在但少几个文件的情况本次不覆盖（无法可靠判断，需重下 zip 比对）。
- **[历史记录永远显示缺失]** → 这是事实而非 bug；文案要给出可执行动作（重新安装），不要让用户以为是应用出错。
- **[删除那一行后，某些既有验收脚本依赖「空文件被跳过」]** → 实现时先跑 `verify-skill-upload-zip.mjs` 与 `verify-skills-unit.mjs`；若有断言依赖旧行为，按新规格更新断言而不是恢复过滤。

## Migration Plan

无迁移。合并后：

1. 新安装的包含空文件时，磁盘结构与 zip 一致。
2. 既有安装记录（当前 0 行）若某环境仍有，回执立刻开始带 `filesMissing`，用户重装即可消除。
3. 回滚只需还原 `server/skillZip.mjs` 一行与 `server/app.ts` / `skills.mjs` 的新增判定，无持久化状态需要清理。

## Open Questions

无。是否要在列表里对 `filesMissing` 的技能降权或隐藏，属于后续产品决策，不影响本次行为。
