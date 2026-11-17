# Design

## Context

动机见 `proposal.md - Why`，行为契约见 `specs/skill-packages/spec.md` 与 `specs/creative-experts/spec.md`。这里只记录落地所需的现状约束。

现状的三个写入/读取点，各自都只认「一份正文」：

- `server/skillZip.mjs` 的 `extractSkillMdFromZip()` 用 `fflate` 的 `unzipSync` 把全包读进内存，`normalized` 已经是完整条目列表，但函数最后只 `pick` 一个 `SKILL.md` 返回 `{ path, text }`。
- `server/app.ts` 的两处调用（`/api/skillhub/install`、`/api/skills/upload-zip`）都写 `const { text } = extractSkillMdFromZip(...)`，随后 `upsertSkillInstall({ ..., text })`。
- `server/db.mjs` 的 `skill_installs` 只有 `text` 与 `meta` 两列正文位，没有文件表；`deleteSkillInstall` 只删行。
- `server/skills.mjs` 的 `listSkillFiles()` 只遍历 `<appRoot>/skills/`，`readSkillFile()` 只拼 `skills/<id>/SKILL.md`。
- 读取侧 `src/agent/stageTools.ts` 的 `read_skill` / `read_skill_text` 都只回 `text`，没有任何文件读能力。

可写根已有现成设施：`server/paths.mjs` 的 `resolveStateRoot` / `statePath` / `ensureStateDir`。`SB_STATE_ROOT` 未设置时回退 `appRoot`，这正是为什么要用 `installed-skills/` 作为子目录名（见决策 1）。

## Goals / Non-Goals

**Goals**

- 安装技能包时，包内全部文件落到可写状态根，结构不被重写。
- Pi 能按需读取包内单个文件，内置技能与安装技能走同一条读取入口。
- 卸载不残留；安装失败不产生可被误认为「已安装」的半份状态。

**Non-Goals**

- 不执行包内脚本。`allowed-tools` 在本项目里只是展示与审计（`src/skills/agentPack.ts` 的注释明确「不自动绑定 Codex 壳」），创意会话里没有 Bash 类工具。落盘只兑现 `references/*.md` 这类文本可读。
- 不改 SkillHub 接口语义，不引入新的市场协议。
- 不做多版本共存（同一 id 只保留一份安装）。

## Decisions

### 决策 1：安装目录名用 `installed-skills/`，不用 `skills/`

dev 模式下 `SB_STATE_ROOT` 未设置时 `resolveStateRoot` 回退 `appRoot`。若安装目录取名 `skills/`，开发环境会把用户安装的技能直接写进仓库里被 git 跟踪的内置技能目录，造成内置与安装混写、`git status` 脏乱、卸载时可能误删内置。

选 `installed-skills/`，并且该目录必须在 `.gitignore` 中，保证无论在哪种根下都不会进版本库。

替代方案：DB 加 `skill_files` 表存二进制。放弃原因：`character-refs` 这类包的设计前提是「目录里有可执行脚本」，DB 存二进制让 `{baseDir}` 语义彻底失效；且 sqlite 会随附件膨胀，而项目库已经跟着备份走。

### 决策 2：解压层返回全量条目，保留旧函数做兼容

`extractSkillMdFromZip` 改为内部复用一个「解析 zip → 归一化条目数组」的私有步骤，导出两个函数：新的返回 `{ path, text, files }`，旧的保持返回 `{ path, text }` 供现有验收脚本继续使用。

归一化要维持现状已有的三件事：剥掉公共顶层目录、过滤 `__MACOSX`/`.DS_Store`/目录条目、`cleanZipPath` 挡掉 `..`。新增一件事：条目里的路径在写盘前必须再做一次 `path.relative` 越界校验，因为 `cleanZipPath` 只剥离而不拒绝，`a/../../b` 这类输入归一化后可能仍产出可疑路径。

替代方案：在调用方各自解压一次。放弃原因：两次解压同一份 buffer 既慢又要维护两条路径校验逻辑，容易一边收紧一边漏。

### 决策 3：正文仍存 DB，附件只存磁盘

`skill_installs.text` 继续保存 `SKILL.md` 正文，磁盘保存全量文件。理由：现有 `GET /api/skills` 列表、`listSkillFiles`、覆盖（override）机制、前端技能详情全部以 `text` 为契约，改成「只读磁盘」会连带重写这几处；而正文读 DB 与读磁盘的差异对调用方不可见。

代价是同一份 `SKILL.md` 在两处各存一份，覆盖安装时要保证两处同批次更新（见决策 5）。

### 决策 4：读取优先级 = 安装目录 > 内置目录，逐文件回落

`resolveSkillFile(appRoot, id, relPath)` 依次尝试 `installed-skills/<id>/<rel>`、`skills/<id>/<rel>`，命中即返回。不采用「按目录整体二选一」，因为 spec 要求「仅在安装目录缺失该文件时才回落内置目录」。

这个「逐文件」语义有一个需要正视的后果：若安装包是旧一代、内置是新一代，逐文件回落会把两代的文件拼在一起。本 change 用数据迁移消除这种混合（见 Migration Plan），并把 `meta.origin` 记下安装来源代次，详情页据此显示附件清单，让混合状态至少是可见的。

替代方案：整体二选一（安装目录存在就完全屏蔽内置）。更保守，但在「安装包比内置少一个文件」时会莫名丢能力。选择逐文件回落 + 可见清单。

### 决策 5：落盘采用「临时目录 + 原子替换」

写入顺序：解压校验（`name` 与 id 一致、有 `SKILL.md`、单文件与总量限额）→ 写到 `installed-skills/.tmp-<id>-<rand>/` → `rename` 覆盖 → 最后写 DB 记录。

覆盖已有安装时，先把旧目录改名为 `.bak-<id>-<rand>/`，替换成功再删 `.bak`；替换失败则把 `.bak` 改回，保证「要么全新，要么全旧」。DB 写在磁盘成功之后，失败则回滚目录，避免出现「记录说有附件、磁盘没有」。

替代方案：直接 `rm -rf` 再写。放弃原因：中途失败会留下半份目录，且旧版本已删无法恢复。

### 决策 6：新工具只做单文件读 + 清单，不做整包展开

新增 `read_skill_file(id, path)`；`read_skill_text` 保持只回正文。附件的发现靠 `GET /api/skills` 返回的清单（同一份数据也给 `list_installed_skills` 用），模型先看清单再按需读单个文件。

不选「读正文时把 references 全量拼接」：`short-drama` 系的 references 合计可达数百 KB，全量拼接会挤掉对话上下文，且大部分轮次只需要其中一个文件。

单文件读取要有上限（建议 256KB），超限直接 `ok:false` 而**不截断**：截断的引用文件会让模型按半份规则执行，比读不到更危险。错误信息里附该包现有文件清单，让模型一次就能改对路径。

### 决策 7：技能读工具的登记点收敛到一处常量

目前「技能读工具」这个概念散在四处：`src/skills/tools.ts` 的已知工具表、`src/creative/expertToolGroups.ts` 的技能分组、`src/creative/expertTools.ts` 的 `SKILL_READ_TOOLS`、`src/creative/creativeTurnPayload.ts` 的 `names.add(...)` 硬编码。新增一个工具要改四处，漏一处就是「注册了但专家模式用不了」。

本次把清单提取为一个导出常量（如 `SKILL_READ_TOOL_NAMES`），四处引用同一常量。这是一次小重构，但它把「新增技能读工具」从 4 处降至 1 处，是防止同类缺口复发的结构性修复，而不是顺手美化。

## Risks / Trade-offs

- **[旧安装记录与新布局不一致]** 现存 19 条 `provider=upload` 记录只有正文、磁盘无目录。→ 迁移时清理这批记录使其回落到 `builtin`；清理前导出 `skill_id + text` 快照到状态根，便于回滚。
- **[两代正文混用]** 磁盘包与已上传正文存在 12 个技能的差异，附件代次也不同。→ 以磁盘包为权威（已确认），迁移后 `builtin` 正文与内置附件自洽；详情页展示附件清单与来源，混合状态可见。
- **[写入可写根失败]** 只读文件系统或磁盘满会让安装失败。→ 决策 5 的原子替换保证旧安装可用；错误信息区分「路径不可写」与「包内容不合法」。
- **[单文件上限卡住合法的包]** 现有 `MAX_FILE_BYTES = 1MB`，带大图的包会整体安装失败。→ 保持 1MB 但错误信息指明是哪个文件超限；若实际遇到，再单独评估放宽或改成分文件跳过。
- **[attachments 清单拖慢列表]** 每次 `GET /api/skills` 都 stat 全包文件。→ 清单在安装时写入 `meta`，列表只读 DB；仅在详情页按需校验磁盘一致性。
- **[符号链接逃逸]** 攻击者构造 zip 内的符号链接指向目录外。→ 写盘前拒绝 zip 中的 symlink 条目，读取时用 `realpath` 校验落在技能目录内。

## Migration Plan

1. 先在服务启动时创建 `installed-skills/`（缺失即建），避免首次安装与并发读互相等目录。
2. 导出并清理 19 条 `upload` 安装记录：把 `skill_id`、`text`、`installed_at` 写入 `<stateRoot>/skill-installs-backup-<时间戳>.json`，再删除记录。清理后 `GET /api/skills` 这 19 个 id 的来源应变为 `builtin`。
3. 校验落位：确认这 19 个 id 的正文与 `skills/<id>/SKILL.md` 一致，且附件清单非空。
4. 回滚：把备份 JSON 逐条 `upsertSkillInstall` 回库即可恢复原状；删除 `installed-skills/` 不影响内置技能。

迁移是一次性数据操作，不写自动迁移代码——留着自动清理逻辑反而会让「用户主动重装旧包」被反复抹掉。

### 执行记录（2026-11-17）

- 迁移脚本：`openspec/changes/archive/2026-11-18-skill-package-files/migrate-upload-installs.mjs`（默认预览，`--apply` 才写库；每个 id 缺磁盘 `SKILL.md` 时直接拒绝，避免删记录等于删技能）。
- 结果：19 条 `provider=upload` 记录已备份到 `skill-installs-backup-2026-11-17T16-07-08-524Z.json`（仓库根，已 gitignore）并删除；`GET /api/skills` 的 20 个技能来源全部为 `builtin`，正文与 `skills/<id>/SKILL.md` 逐字节一致。
- 链接完整性：`check-skill-links.mjs` 迁移前 **122 处链接 / 缺失 56 处**，迁移后 **缺失 0**。
- 回滚：`node openspec/changes/archive/2026-11-18-skill-package-files/migrate-upload-installs.mjs --restore <备份文件>`，已有同 id 记录会跳过，不覆盖新装内容。

### 实现与原计划的差异

- 附件清单改为每次 `GET /api/skills` 从磁盘 stat，而不是安装时写进 `meta` 再读。原因：spec 要求「清单 MUST 与实际磁盘一致」，`meta` 在包被外部增删文件后会失真；当前规模（20 个技能、数百个文件）下 stat 成本可忽略，且 `listSkillFiles` 本来就要读全部 `SKILL.md`。`meta.dir/fileCount/totalBytes/origin` 仍写入，供诊断与排障。
- 单文件上限统一为 256KB：读工具与安装期校验引用同一个常量（`skillZip.mjs` 的 `MAX_READABLE_FILE_BYTES`）。只放行图片/音视频这类不经读工具的素材到 1MB，避免「装得下但读不到」。

## Open Questions

- `MAX_FILE_BYTES` 是否要随本次一起放宽（例如 4MB），还是先维持 1MB 等真实包撑爆再调？两种都不改 spec，可等实现阶段按实测决定。
- 附件清单是否需要在设置页支持逐个预览（点开看文件内容），还是只列路径即可？属于 UI 增量，不改变 spec 与任务分解。
