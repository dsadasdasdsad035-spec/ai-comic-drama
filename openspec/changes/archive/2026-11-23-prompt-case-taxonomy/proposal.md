# Proposal

## Why

提示词案例库现在只有「来源 / 模型 / 收藏」三个筛选维度，唯一的分类字段 `category` 是自由文本：`parseVflowItem` 直接写入空串，导入面板又不提供分类选择，于是外部案例入库后分类全空；而索引本身其实带着 31 个分类标签（13665 条里有 12265 条是多标签），这些信息在导入这一步被丢掉了。用户想按「赛博朋克」「水墨」「打斗」「长镜头」找参考时，只能靠关键词盲搜正文，搜不到就以为库里没有。

要让案例库变成能用的「影像语言词典」，分类必须是**多轴、受控、可计数**的：一条案例同时属于「赛博朋克 × 夜景 × 低角度 × 推镜 × 霓虹光 × 高对比」而不只属于一个字符串。

## What Changes

- **引入 18 轴受控分类体系**（题材、叙事结构、情绪基调、时代地域、场景环境、主体角色、动作表演、道具特效、景别、机位角度、运镜、镜头光学、构图、光线、色彩、剪辑节奏、声音音乐、影像风格与媒介），每轴一套中英对照受控词表 + 别名，覆盖电影专业从剧作到摄影、剪辑、声音、风格的知识面。
- **新增 `case_facets` 分面表**：一条案例在每轴可有 0..N 个值，带来源标记（导入继承 / 规则推导 / 人工修正）与词表版本号；人工修正的值在重新导入时不被覆盖。
- **导入不再丢分类**：vflow 索引的分类与多标签写入分面；导入预览可按分类筛选并显示命中分类。**BREAKING**：`parseVflowItem` 的 `category: ''` 行为被替换为「映射到分面 + 保留原始分类」。
- **历史案例回填**：已有记录按标题、正文、标签、模型、时长、制作方式推导分面，可重跑；回填幂等且不覆盖人工修正。
- **列表按分面筛选与计数**：同一轴内多选取并集，跨轴取交集；分面面板显示当前结果集下每个值的条数，点选后即时收窄。
- **详情可查看与修正分面**：每个分面标注来源（自动 / 手动），用户可增删并覆盖自动值。
- **分类体系独立版本化**：词表带 `taxonomyVersion`，新增/重命名值时可知哪些案例的推导结果已过期。

不在本次范围：不做 LLM 自动打标（首版只用可复现的规则与别名匹配）；不改许可、来源、应用到镜头的语义；不做跨用户的分类共享；不替换 `camera-lexicon-presets` 的 catalog，只消费它的 `mapsToMove` / `mapsToSize`。

## Capabilities

### New Capabilities

- `prompt-case-taxonomy`: 18 轴受控分类体系的词表定义与版本、案例分面的存储与来源标记、导入与反推产物的分面落库、历史案例回填、按分面筛选与计数、人工修正的优先级，以及词表演进时的版本一致性。

### Modified Capabilities

无。`prompt-case-library` 的变更（浏览 / 导入 / 应用 / 收藏）尚未归档为正式 spec，本次不修改其行为契约，只用新能力在其数据上增加分面维度。

## Impact

- 数据库：`server/db.mjs` 新增 `case_facets`（`case_id, axis, value, source, taxonomy_version`，主键 `(case_id, axis, value)`）与 `(axis, value)`、`(case_id)` 索引；老库走 `CREATE TABLE IF NOT EXISTS` 自动补建。
- 服务端：新增 `server/prompt-taxonomy.mjs`（词表加载、别名归一、规则推导、分面读写与计数）；`server/prompt-cases.mjs` 的 `saveCase` / `parseVflowItem` / `listCases` / `caseFacets` 增加分面处理；`server/app.ts` 的 `/api/prompt-cases` 增加 `facet` 查询参数与 `PATCH /api/prompt-cases/:id/facets`。
- 词表数据：新增 `public/presets/prompt-taxonomy/v1.json`（轴、值、中英标签、别名、父轴），前端构建时直接 import，服务端运行时读取同一份文件，避免两端各写一套。
- 前端：`src/promptCases/` 增加分面筛选面板与详情分面编辑器；`PromptCaseGrid` / `PromptCaseDetail` 显示分面徽标与来源；`ImportDialog` 增加分类筛选并回显条目分类。
- 迁移：新增一次性回填脚本与启动时惰性补算（仅当案例 `taxonomy_version` 低于当前版本）；回填不阻塞启动。
- 验收：扩展 `verify-prompt-cases.mjs` 增加分面层（归一、幂等、人工优先、跨轴交集、计数）；新增 `verify-prompt-cases-taxonomy.mjs` 覆盖词表完整性（每轴无重复值、别名不冲突、18 轴齐全）。
