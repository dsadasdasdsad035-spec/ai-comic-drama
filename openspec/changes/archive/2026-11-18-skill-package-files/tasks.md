# Tasks

## 1. 解压层返回全量条目

- [x] 1.1 在 `server/skillZip.mjs` 抽出「zip → 归一化条目数组」的私有步骤，导出新函数返回 `{ path, text, files }`；保留 `extractSkillMdFromZip` 返回 `{ path, text }` 供现有调用方与验收脚本使用。验证：`node verify-skill-upload-zip.mjs` 的既有断言全部通过。
- [x] 1.2 归一化条目时拒绝 zip 内的符号链接条目，并对每条路径做 `path.relative` 越界校验（不能只依赖 `cleanZipPath` 的剥离）。验证：在 `verify-skill-upload-zip.mjs` 增加用例——含 `../escape.md` 路径的 zip 与含 symlink 条目的 zip 都安装失败，且错误信息指明具体条目。
- [x] 1.3 新增断言：含 `references/guide.md` 的 fixture zip 解压后 `files` 同时包含 `SKILL.md` 与 `references/guide.md`，字节与源一致。验证：`node verify-skill-upload-zip.mjs` 新增用例通过。

## 2. 磁盘布局与文件解析

- [x] 2.1 在 `server/skills.mjs` 增加安装目录根（`<stateRoot>/installed-skills`）与「安装优先、内置回落」的单文件解析函数；读取时用 `realpath` 校验结果落在该技能目录内。验证：新增单元断言覆盖三种情况——仅内置、仅安装、两者都有时命中安装。
- [x] 2.2 `listSkillFiles` 扩展为扫描两个根，返回每个技能的附件清单（相对路径 + 字节数）与计数；正文解析顺序与 2.1 一致。验证：`node verify-skills-api.mjs` 中新增断言——同一 id 在两处都存在时来源与附件来自安装目录。
- [x] 2.3 把 `installed-skills/` 加入 `.gitignore`，并确认服务启动时创建该目录（缺失即建）。验证：`git status` 在写入一个测试文件到 `installed-skills/` 后保持干净；启动服务后目录存在。

## 3. 安装端点落盘与卸载清理

- [x] 3.1 `POST /api/skillhub/install` 与 `POST /api/skills/upload-zip` 改用新解压函数，按「临时目录 → 原子替换 → 写 DB 记录」顺序落盘；覆盖安装失败时回滚到旧目录。验证：`node verify-skill-upload-zip.mjs` 的 mock SkillHub 用例安装后，安装目录内存在 `references/guide.md`，且 `GET /api/skills` 返回的附件清单包含它。
- [x] 3.2 纯文本上传（`POST /api/skills/upload`）保持可用：落盘只有 `SKILL.md`，附件计数为 0。验证：`node verify-skill-upload-zip.mjs` 现有文本上传用例通过且附件计数断言为 0。
- [x] 3.3 `DELETE /api/skill-installs/<id>` 同时删除安装目录与记录；对仅内置的 id 返回 `ok:false` 且内置文件不受影响。验证：`node verify-skill-upload-zip.mjs` 新增用例——卸载后目录不存在、再 GET 该 id 回落到 `builtin`；对 `byted-sol-seedance-prompt` 发起卸载被拒绝。
- [x] 3.4 在 `skill_installs.meta` 写入目录、附件计数、总字节数与安装来源代次标识。验证：安装后直接查询 `projects/storyboard.sqlite` 的 `meta` 字段，四项均存在。

## 4. 附件清单可见

- [x] 4.1 `GET /api/skills` 与 `GET /api/skills/<id>` 返回附件清单与计数，列表路径只读 DB 不 stat 磁盘。验证：`node verify-skills-api.mjs` 断言响应含清单字段，且对不存在附件的包返回空数组而非缺字段。
- [x] 4.2 设置页技能详情展示附件清单；无附件时显示明确的「无附加文件」提示。验证：浏览器打开设置 → 智能与扩展 → 技能 → 任一技能详情，清单与 `GET /api/skills/<id>` 一致。

## 5. `read_skill_file` 工具

- [x] 5.1 在 `src/agent/stageTools.ts` 实现 `read_skill_file(id, path)`：限定技能目录、越界与符号链接拒绝、单文件上限（超限直接失败不截断）、文件不存在时返回现有文件清单。验证：单元断言覆盖成功读取、`../` 越界、symlink、不存在、超限五种情况。
- [x] 5.2 把技能读工具清单收敛为一个导出常量，替换 `src/skills/tools.ts`、`src/creative/expertToolGroups.ts`、`src/creative/expertTools.ts`、`src/creative/creativeTurnPayload.ts` 四处硬编码。验证：`npx tsc --noEmit` 通过；`verify-skills-unit.mjs` 中断言四处取得的工具集合都包含三个读工具且完全一致。
- [x] 5.3 专家白名单对 `read_skill_file` 生效：非白名单 id 返回 `ok:false`，`skillIds` 含 `*` 时放行。验证：新增断言分别以受限专家与通配专家调用同一技能的文件读取，前者被拒、后者成功。
- [x] 5.4 更新 `src/creative/creativeTurnPayload.ts` 的 system 提示，说明「先看附件清单，再按需读单个文件」，并把 `read_skill_file` 写入可用工具列表。验证：打开「发送预览」，system 文本含该指引与工具名。

## 6. 数据迁移（以磁盘包为权威）

- [x] 6.1 把 19 条 `provider=upload` 安装记录（`skill_id`、`text`、`installed_at`）导出到 `<stateRoot>/skill-installs-backup-<时间戳>.json`，并在迁移说明里写明回滚方式。验证：文件存在且可被 `JSON.parse`，条目数为 19。
- [x] 6.2 清理这 19 条记录。验证：`GET /api/skills` 中这 19 个 id 的 `source` 全部为 `builtin`，且 `skills/<id>/SKILL.md` 与返回正文逐字节一致（对比其中至少 3 个原本不一致的技能：`short-drama`、`short-drama-video-prompts`、`short-drama-assets`）。
- [x] 6.3 复核链接完整性：统计当前生效正文里的本地链接总数与磁盘缺失数，缺失数必须为 0。验证：运行链接检查脚本输出「缺失 0」；迁移前该数字为 56。

## 7. 集成验收

- [x] 7.1 端到端：从 mock SkillHub 安装一个含 `references/` 的包 → `read_skill_file` 读到该文件内容 → 卸载后目录消失、`read_skill_file` 返回不存在。验证：把这条链路写进 `verify-skill-upload-zip.mjs` 并通过。
- [x] 7.2 回归：`node verify-skills-api.mjs`、`node verify-skills-unit.mjs`、`node verify-skill-settings.mjs`、`node verify-skill-migration.mjs` 全部通过。（后两条原本测的是已下线的「技能规则包」UI 与迁移，本次一并改写到当前行为：settings 验证「智能与扩展 → 技能」目录 + 详情只读与附件清单；migration 验证旧规则包迁移只写标记、不再产生覆盖。）
- [x] 7.3 在技能作者指南 `skills/README.md` 补充安装目录位置、附件清单语义与 `read_skill_file` 用法；写明本 change 不做脚本执行。验证：按文档描述手动核对安装目录与工具行为一致。

## Workflow follow-up

- 迁移完成后归档本 change。
- 归档后确认 `openspec/specs/skill-packages/spec.md` 的 Purpose 已正确落位。
