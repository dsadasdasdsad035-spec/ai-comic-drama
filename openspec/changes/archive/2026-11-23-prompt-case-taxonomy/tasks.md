# Tasks

## 1. 词表与校验

- [x] 1.1 新增 `public/presets/prompt-taxonomy/v1.json`，按 design D1 写满 18 轴、约 410 个受控值（含 `id`/`cn`/`en`/`token`/`aliases`/`mapsToSize`/`mapsToMove`）与 `sourceMappings` 映射段，验证：`node -e "JSON.parse(fs.readFileSync(...))"` 可解析且轴数为 18
- [x] 1.2 新增 `server/prompt-taxonomy.mjs`：加载词表、构建 `axis→value` 与 `axis→alias→value` 索引、暴露 `listTaxonomy()` / `normalizeFacetValue()` / `validateFacetPairs()`，验证：单测断言 5 个景别别名与 7 个运镜别名都能解析到唯一主值
- [x] 1.3 在 `server/prompt-taxonomy.mjs` 实现词表自检（轴 id 唯一、值 id 轴内唯一、别名轴内唯一、映射目标存在），验证：临时构造重复别名的 fixture 时加载抛错并指出冲突项
- [x] 1.4 在 `package.json` 增加 `test:taxonomy` 脚本并接入 `verify-all.mjs`，验证：`npm run test:taxonomy` 退出码为 0

## 2. 存储与迁移

- [x] 2.1 `server/db.mjs` 新增 `case_facets` 表与两个索引，按 design D3 定义 `source`/`unmapped`/`suppressed`/`taxonomy_version`，验证：老库启动后 `PRAGMA table_info(case_facets)` 返回 8 列
- [x] 2.2 `server/db.mjs` 为 `prompt_cases` 补 `taxonomy_version` 列（`PRAGMA table_info` 判断后 `ALTER TABLE`），验证：连续启动两次不报「duplicate column」
- [x] 2.3 `server/prompt-cases.mjs` 增加分面读写：`setCaseFacets` / `getCaseFacets` / `deleteCaseFacet` / `listStaleFacetCases`，验证：单测覆盖同 `(case,axis,value)` 重复写入只留一行
- [x] 2.4 在 `server/prompt-cases.mjs` 落实来源优先级 `manual > import > derived` 与 `suppressed` 语义，验证：单测先写 derived 再写 manual，值来源保持 manual；删除自动值后写入 `suppressed=1` 且查询默认不返回
- [x] 2.5 扩展 `verify-prompt-cases.mjs --unit` 覆盖分面 CRUD、来源优先级、suppressed 过滤与重复写入，验证：`node verify-prompt-cases.mjs --unit` 全绿

## 3. 推导与映射

- [x] 3.1 在 `server/prompt-taxonomy.mjs` 实现 `deriveFacets(caseRow)`：先映射外部分类、再别名匹配（中文子串 / 英文词边界 / 最长优先）、再读 `size`/`move` 与反推 `kind`，验证：fixture 案例「雨中巷口，女子中景回头，缓慢推镜」推导出 `environment:alley`、`shot-size:medium`、`camera-move:push-in`
- [x] 3.2 实现单轴上限（默认 6，`genre` 为 8）与稳定排序（别名长度 × 出现次数），验证：构造 12 个题材关键词的文本，推导结果恰为 8 个且顺序稳定
- [x] 3.3 实现 `sourceMappings` 应用与未映射降级（原文保留 + `unmapped=1`），验证：传入词表外的分类 `neon-dreamcore` 后可按未映射筛出，且不影响同条案例其他分面
- [x] 3.4 把 11 个反推制作方式映射到 `style-medium`（`live_action`/`ai_video`/`avatar`/`cg_3d`/`code_render`/`screen_capture`/`still_motion`/`static_hold`/`anim_2d`/`stop_motion`/`film_footage`），验证：单测逐项断言映射目标存在且唯一
- [x] 3.5 新增推导单测（`verify-prompt-cases-taxonomy.mjs` 或并入 `verify-prompt-cases.mjs`）断言同输入连续推导两次结果一致、已有的 `import`/`manual` 轴不被覆盖，验证：脚本退出码 0

## 4. 导入与反推接入

- [x] 4.1 修改 `parseVflowItem`：保留原始分类与多标签，输出可映射的分类列表，不再固定 `category: ''`，验证：用真实索引中的一条多标签条目断言分类非空
- [x] 4.2 `saveCase` 接受并落库分面参数（导入来源标记 `import`），`importCasesFromSource` 返回分面写入条数，验证：`node verify-prompt-cases.mjs --import` 断言导入后 `case_facets` 行数 > 0
- [x] 4.3 反推入库（`server/rea-video.mjs` 产物解析到案例的部分）写入逐镜制作方式分面，验证：mock 反推产物入库后 `style-medium` 存在对应值
- [x] 4.4 导入预览透出每个条目的分类与映射结果，供弹窗展示与筛选，验证：预览响应中每条含 `categories` 与 `facets` 摘要
- [x] 4.5 导入提交后只对本次写入案例执行推导（D8），验证：重复导入同一批条目后分面行数不增长

## 5. 查询接口

- [x] 5.1 `/api/prompt-cases` 支持重复 `facet=axis:value` 参数：同轴 OR、跨轴 AND，与关键词/来源/模型/收藏叠加，验证：单测断言「题材 2 值 OR」的条数 ≥ 任一单值，「题材 + 光线」的条数 ≤ 任一单值
- [x] 5.2 非法轴或非法值返回空结果 + `invalidFacets` 说明，不回落全库，验证：请求 `facet=genre:不存在的值` 返回 `total=0` 且带说明
- [x] 5.3 `/api/prompt-cases/facets` 返回逐轴逐值计数，计算某轴时排除该轴自身条件、保留其余条件与 `suppressed=0`，验证：先选题材再取计数，光线计数只统计选题材后的结果
- [x] 5.4 增加 `PATCH /api/prompt-cases/:id/facets`（增/删/恢复被隐藏值），服务端校验轴与值，验证：curl 依次增删后 `GET` 详情反映变更、非法值返回 400
- [x] 5.5 列表与详情响应附带分面（含 `source`/`unmapped`/`suppressed`），验证：`verify-prompt-cases.mjs` 断言详情含来源标注

## 6. 前端分面筛选

- [x] 6.1 新增 `src/promptCases/taxonomy.ts` 从 JSON 派生轴定义、标签与别名，验证：`tsc` 通过且 18 轴顺序与 design D1 一致
- [x] 6.2 新增 `src/promptCases/FacetFilterRail.tsx`：18 轴默认折叠、只展开有条数的轴、每轴 Top 6 + 更多、0 值置灰、选中态可取消，验证：`verify-prompt-cases-ui.mjs` 断言初始只渲染有数据的轴
- [x] 6.3 已选分面以 chip 显示在列表顶部，与关键词/模型并列，可单删与「清空筛选」，验证：脚本点选两个轴后断言 chip 数与列表条数同时收窄
- [x] 6.4 空状态显示冲突条件与各条件单独命中数，并提供清除入口，验证：构造互斥组合后断言文案含条件名
- [x] 6.5 移动端抽屉形态与桌面侧栏共用同一数据源，验证：窄视口下脚本能打开抽屉并完成一次筛选

## 7. 卡片与详情分面

- [x] 7.1 `PromptCaseGrid` 卡片最多显示 3 个分面（题材优先）+ `+N`，验证：脚本断言带 6 个分面的案例卡片只出现 3 个徽标与 `+3`
- [x] 7.2 `PromptCaseDetail` 按轴展示全部分面并标注来源（导入/自动/手动），验证：脚本断言 `data-facet-source` 与来源一致
- [x] 7.3 详情支持从词表下拉新增分面、删除分面；删除自动值写成隐藏并可「恢复」，验证：手删自动值后刷新仍在且默认不显示，点恢复后重新出现
- [x] 7.4 分面变更后列表与计数同步刷新（不整页重载），验证：脚本改一个分面后断言筛选中该案例出现/消失

## 8. 导入弹窗

- [x] 8.1 `ImportDialog` 增加分类下拉（来自预览返回的 `categories`）并真正传给预览接口，验证：选择分类后请求带 `category`，结果条数 ≤ 不选时
- [x] 8.2 预览条目展示映射到的轴值，未映射分类带「未映射」标记，验证：脚本断言未映射条目的标记与筛选入口存在
- [x] 8.3 支持「仅看未映射」筛选，验证：勾选后列表只剩未映射条目

## 9. 回填脚本与文档

- [x] 9.1 新增 `scripts/backfill-prompt-facets.mjs`，支持 `--dry-run` / `--limit` / `--only-stale`，逐条推导并写 `taxonomy_version`，验证：`--dry-run` 不写库、行数不变；实跑后 `SELECT COUNT(*) FROM case_facets` 增长
- [x] 9.2 回填幂等与不覆盖人工值，验证：连续跑两次总行数与人工值保持不变
- [x] 9.3 在 `README.md` 增加「提示词分类体系」小节：18 轴清单、词表位置与版本、回填命令、如何新增映射，验证：按文档命令复制执行可跑通
- [x] 9.4 在 `docs/` 补一页轴与值的完整对照表（由 JSON 生成，避免手写漂移），验证：生成脚本输出与 JSON 值数一致

## 10. 集成验收

- [x] 10.1 扩展 `verify-prompt-cases.mjs` 增加 `--facets` 层（推导、筛选、计数、人工优先、未映射），验证：`node verify-prompt-cases.mjs --facets` 全绿
- [x] 10.2 扩展 `verify-prompt-cases-ui.mjs` 覆盖分面栏、chip、卡片徽标、详情编辑与移动端抽屉，验证：脚本全绿
- [x] 10.3 运行 `verify-prompt-cases-smoke.mjs --offline` 确认现有链路未回归，验证：退出码 0
- [x] 10.4 运行 `npm run build` 与 `verify-all.mjs`，验证：构建成功、无新增失败项
- [x] 10.5 用真实 vflow 索引跑一次「预览 → 导入 24 条 → 回填 → 按 3 个轴筛选」，记录未映射分类清单，验证：3 个轴均能筛出结果且未映射值可枚举

## Workflow follow-up

- 归档前把 `prompt-case-library` 的 delta 与本次新增能力的关系在归档说明里写清，避免两个 spec 对「筛选」各说一半。
- 词表版本升级时同步更新 `docs/` 对照表与回填命令示例。
