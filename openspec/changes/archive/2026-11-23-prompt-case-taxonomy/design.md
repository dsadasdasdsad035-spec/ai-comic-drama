# Design

## Context

现状（只列影响方案的约束）：

- `prompt_cases` 只有单个自由文本 `category`。`saveCase` 直接截断存储，`listCases` 只做 `category=?` 精确相等，`caseFacets` 用 `GROUP BY category` 计数（`server/prompt-cases.mjs:157-305`）。
- `parseVflowItem` 把 `category` 固定写成空串（`server/prompt-cases.mjs:462-482`），而 vflow 索引里 13665 条案例有 12265 条带多个分类标签（31 个分类、9 个模型）；分类在导入时被丢弃。
- 导入预览接口已支持 `category` 过滤，但 `ImportDialog` 不传该参数、也没有分类下拉（`src/promptCases/ImportDialog.tsx`），分类筛选目前形同虚设。
- 已有一套可复用的受控词：内置运镜库 manifest 的 `mapsToSize`（5 值）/ `mapsToMove`（7 值），`videoPromptVocab.ts` 就是从它派生的；反推结果有 11 个固定的制作方式枚举（`server/rea-video.mjs:83-95`）。
- 词表若前后端各写一份必然会漂移；本项目已有「JSON + 前端 import + 服务端读文件」的先例（`public/presets/camera-moves-whitebox-132/manifest.json` 由 `server/cameraLexicon.mjs` 读取）。
- `prompt-case-library` 的 spec 目前只存在于 `openspec/changes/prompt-case-library/`，尚未归档到 `openspec/specs/`，因此本次不去改它的 delta，而是在其数据模型上新增一个独立能力。

## Goals / Non-Goals

目标：给出 18 轴的完整受控词表、分面存储与来源优先级、确定性的推导规则、分面筛选与计数的精确语义，以及可回滚的迁移路径。

非目标（设计层面显式排除）：不做向量检索；不做 LLM 打标；不做用户自定义轴；不把时长、画幅、模型、来源塞进分面（它们是既有筛选维度，混入会让 18 轴失去边界）；不改案例许可与「应用到镜头」的写回语义。

## Decisions

### D1. 18 轴与固定 id

轴 id 一旦发布不再改名（改名等于迁移），中文名与显示顺序可变。轴的顺序按「内容 → 摄影 → 后期 → 风格」排列，与分镜师从「拍什么」到「怎么拍」的思考顺序一致。

| # | id | 中文 | 词表来源 | 值数 |
|---|---|---|---|---|
| 1 | `genre` | 题材类型 | 电影类型学 + vflow 31 分类 | 34 |
| 2 | `narrative` | 叙事结构 | 剧作学 | 19 |
| 3 | `tone` | 情绪基调 | 类型片情绪谱 | 25 |
| 4 | `period` | 时代地域 | 电影史分期 + 地域 | 26 |
| 5 | `environment` | 场景环境 | 美术/场景设计 | 30 |
| 6 | `subject` | 主体角色 | 人物与主体类型 | 24 |
| 7 | `action` | 动作表演 | 表演与动作设计 | 26 |
| 8 | `props-fx` | 道具特效 | 美术道具 + 特效元素 | 26 |
| 9 | `shot-size` | 景别 | 摄影学 + 运镜库 `mapsToSize` | 11 |
| 10 | `camera-angle` | 机位角度 | 摄影学 | 19 |
| 11 | `camera-move` | 运镜 | 运镜库 `mapsToMove` + 补充 | 17 |
| 12 | `lens` | 镜头光学 | 摄影光学 | 18 |
| 13 | `composition` | 构图 | 构图学 | 16 |
| 14 | `lighting` | 光线 | 照明学 | 27 |
| 15 | `color` | 色彩 | 色彩学/调色 | 22 |
| 16 | `editing` | 剪辑节奏 | 剪辑学 | 19 |
| 17 | `sound` | 声音音乐 | 声音设计 | 17 |
| 18 | `style-medium` | 影像风格与媒介 | 影像风格 + 反推制作方式枚举 | 35 |

备选方案：把「时长/画幅/模型/来源」也做成轴。否决——它们是数值或枚举型单值筛选，做成轴会让「分面」退化成任意筛选条件的集合，也破坏 18 轴的稳定契约。

### D2. 词表单一来源：`public/presets/prompt-taxonomy/v1.json`

结构：

```json
{
  "version": "2026-11-23.1",
  "axes": [
    {
      "id": "shot-size",
      "cn": "景别",
      "en": "shot size",
      "order": 9,
      "values": [
        { "id": "wide", "cn": "远景", "en": "wide shot", "token": "wide shot", "aliases": ["远景", "wide", "大远景"], "mapsToSize": "远景" }
      ]
    }
  ]
}
```

- 前端 `import taxonomy from '../public/presets/prompt-taxonomy/v1.json'`（构建期内联，离线可用，无需额外请求）。
- 服务端运行时读同一文件（与 `server/cameraLexicon.mjs` 读 manifest 同构），读取失败 MUST 抛错而不是用空词表静默运行——空词表会让所有筛选返回空，比报错更难查。
- `version` 用于案例级版本比对；词表校验在服务端启动时执行一次：轴 id 唯一、值 id 轴内唯一、别名轴内唯一、`mapsToSize`/`mapsToMove` 只能指向词表内已有值。

### D3. 存储：`case_facets` 归一表而非 JSON 列

```sql
CREATE TABLE IF NOT EXISTS case_facets (
  case_id          TEXT NOT NULL,
  axis             TEXT NOT NULL,
  value            TEXT NOT NULL,
  source           TEXT NOT NULL,      -- import | derived | manual
  unmapped         INTEGER DEFAULT 0,  -- 1 = 外部原始分类未能映射
  suppressed       INTEGER DEFAULT 0,  -- 1 = 用户隐藏的自动值
  taxonomy_version TEXT DEFAULT '',
  updated_at       TEXT,
  PRIMARY KEY (case_id, axis, value)
);
CREATE INDEX IF NOT EXISTS idx_case_facets_axis_value ON case_facets(axis, value);
CREATE INDEX IF NOT EXISTS idx_case_facets_case ON case_facets(case_id);
```

- 选归一表的原因：按值筛选要 `EXISTS`/`JOIN` + 索引，按值计数要 `GROUP BY value`；JSON 列在 SQLite 里做这两件事要么全表扫描，要么依赖 JSON1 且无法建有效索引。13k 条案例 × 平均 6 个分面 ≈ 8 万行，归一表毫无压力。
- `(case_id, axis, value)` 主键天然实现「同值不重复」；来源冲突用「同一 `(axis,value)` 只保留优先级最高的一条」解决，优先级 `manual > import > derived`。
- `suppressed=1` 记录「用户手工删掉的自动值」：列表与计数查询一律 `suppressed=0`；推导时跳过被隐藏的值，因此刷新、重新导入都不会把它加回来。详情面板能显示「已隐藏」并允许恢复。

备选方案：`prompt_cases.facets` 存 JSON 数组 + 应用层过滤。否决——分页总数、跨轴交集、逐轴计数都得在内存里做，13k 条尚可但会随案例增长线性劣化，且无法与其他筛选条件在 SQL 里合并。

### D4. 来源优先级与写入规则

| 场景 | 写入 | 是否影响既有行 |
|---|---|---|
| 外部导入带分类 | `source='import'` | 只覆盖 `import`/`derived`，不碰 `manual` |
| 规则推导 | `source='derived'` | 已存在 `import`/`manual` 的 `(axis,value)` 不降级 |
| 人工增删 | `source='manual'` | 删除自动值 → 写 `suppressed=1, source='manual'` |
| 词表升版重算 | `derived` 整体替换 | `import` 保留（来源事实不变），`manual` 保留 |

`taxonomy_version` 写在分面行与 `prompt_cases.taxonomy_version` 两处：前者用于精确重算，后者用于「有多少案例停留在旧版本」的一次性统计（避免每次 `MAX()` 聚合）。

### D5. 推导规则（确定性、无模型调用）

按轴独立执行，任一轴已有 `import` 或 `manual` 值时该轴不再推导（避免覆盖更可信的来源）：

1. **先映射，再匹配**：外部分类 → 分面映射表（D6）优先；映射不到的值写 `axis='genre'` 的未映射行（`unmapped=1`），保留原文并可按「未映射」筛出。
2. **词表别名匹配**：对 `title + prompt + tags` 做匹配，中文用子串、英文按词边界；同一轴内同一命中位置取最长别名（`大特写` 命中后 `特写` 不再计数），避免长短词同时推出两个值。跨轴不抢占：`一镜到底` 同时属于叙事结构与剪辑节奏，两边都要有。
3. **短别名不参与推导**：单字中文别名（`走`/`火`/`书`）与 ≤2 字母缩写（`CU`/`MS`）只保留给人工新增分面用，文本推导跳过它们。子串匹配下 `走` 会命中 `走廊`、`火` 会命中 `火车`，而这些值在词表里都另有 2 字以上别名（`行走`/`火焰`/`书本`），过滤几乎无损失。缺失的构词场景靠补别名解决（`雨中`/`雪地`/`火光`/`血泊`/`刀光`/`车流`/`信封`/`伞下`）。
3. **项目已有枚举**：`size`/`move` 字段值经 `mapsToSize`/`mapsToMove` 反查成轴值，保证与画布用词一致。
4. **制作方式**：反推案例的 `shot.kind` 经 11 个枚举映射到 `style-medium`（如 `stop_motion → stop-motion-puppet`，`anim_2d → anime-2d`）。
5. **轴内上限**：单轴最多保留 6 个推导值，按「别名长度 × 出现次数」排序截断；`genre` 可放宽到 8（外部多标签常见 2-4 个）。

推导只依赖案例自身字段与词表版本，因此同输入必然同输出；这也是验收脚本能断言「连续推导两次结果一致」的前提。

### D6. vflow 31 分类映射

`cinematic realistic→style-medium:cinematic-realistic`、`urban→environment:urban`、`vlog→genre:vlog`、`character→genre:character-piece`、`music video→genre:music-video`、`storyboard→style-medium:storyboard`、`3D cartoon→style-medium:3d-render + genre:animation`、`fantasy→genre:fantasy`、`cinematic AI→style-medium:ai-cinematic`、`sports→genre:sports`、`commercial→genre:commercial`、`food→genre:culinary`、`travel→genre:travel`、`anime→style-medium:anime-2d + genre:animation`、`product→genre:product`、`cyberpunk→genre:cyberpunk + style-medium:cyberpunk`、`vintage retro→style-medium:retro-vintage`、`documentary→genre:documentary + style-medium:documentary-style`、`vehicle→subject:vehicle`、`architecture interior→genre:architecture + environment:interior`、`short film→genre:short-film`、`abstract→style-medium:abstract-generative`、`surreal→tone:surreal + style-medium:surreal-collage`、`channel intro→genre:channel-intro`、`animal→subject:animal + genre:animal`、`game cinematic→style-medium:game-cinematic`、`UGC→style-medium:ugc-style`、`stop motion→style-medium:stop-motion-puppet + editing:stop-motion`、`tutorial→genre:tutorial`、`nature→genre:nature`、`chinese ink→style-medium:chinese-ink`。

映射表与词表同文件维护（`sourceMappings` 段），新增来源只需加映射，不改代码。

### D7. 筛选与计数语义

请求：`GET /api/prompt-cases?facet=genre:cyberpunk&facet=lighting:neon&facet=style-medium:cyberpunk`

- 同一轴多值：`EXISTS (SELECT 1 FROM case_facets f WHERE f.case_id=c.id AND f.axis=? AND f.value IN (...) AND f.suppressed=0)`。
- 跨轴：每轴一个 `EXISTS`，用 `AND` 连接。
- 与关键词/来源/模型/收藏：继续用现有 `WHERE` 条件，与分面条件 AND 叠加。
- 非法值：服务端先用词表校验，任何轴或值不存在 → 直接返回空结果 + `invalidFacets` 说明，不降级为忽略。

计数：对轴 A 计算时，WHERE 里**排除轴 A 自身**的分面条件，其余条件全部保留。这样用户在同一轴里多选时，其他候选值的条数不会因为自己的选择而塌成 0；跨轴选择则真实收窄。计数一律 `suppressed=0`。

```sql
SELECT f.value, COUNT(DISTINCT f.case_id) n
FROM case_facets f
JOIN prompt_cases c ON c.id = f.case_id
WHERE f.axis = ? AND f.suppressed = 0 AND f.unmapped = 0
  AND <除本轴外的全部筛选条件>
GROUP BY f.value
```

### D8. 回填与重算

- 新增 `scripts/backfill-prompt-facets.mjs`：`--dry-run` 只统计，`--limit N` 分批，默认处理 `taxonomy_version <> current OR taxonomy_version = ''` 的案例，逐条推导并写入，幂等（重复跑不产生新行）。
- 读路径不做推导：列表接口不触发计算，避免首屏被 13k 条案例拖慢。回填由脚本或导入/反推流程触发。
- 自动触发点：导入提交后、反推入库后，只对本次写入的案例推导。
- 服务启动只做词表校验与表结构补齐，不跑回填。

### D9. UI

- 案例 Tab 新增左侧分面栏（移动端为底部抽屉）：18 轴默认折叠，只展开有条数的轴；每轴显示 Top 6 值 + 「更多」，值为 0 的置灰。
- 已选分面在顶部显示为可删除 chip，与关键词/来源/模型并列；「清空筛选」同时清关键词与分面。
- 详情面板按轴列出分面 chip，chip 上标 `自动` / `导入` / `手动`；可删除、可从词表下拉新增；被隐藏的自动值以浅色显示并带「恢复」。
- 卡片上只显示前 3 个分面（题材优先），其余折叠成 `+N`，避免卡片高度失控。
- 导入弹窗增加分类下拉（数据来自预览返回的 `categories`）与「仅看未映射」；条目行显示映射到的轴值。

### D10. 性能

- 列表查询新增 `EXISTS` 子查询，走 `idx_case_facets_axis_value`；计数按轴分别执行（最多 18 次小聚合），13k 案例下均在毫秒级。
- 若单次请求返回 18 轴计数过重，按「只返回有条数的轴 + 值」裁剪；空轴不返回计数明细。

## Risks / Trade-offs

- **[别名误命中造成脏标注]** → 单轴最多 6 值、同轴最长别名优先、英文按词边界、单字别名不参与推导；验收用例覆盖「雨/雨夜」「特写/大特写」「走廊/行走」「火车/火焰」「一镜到底」五组。派生值可在详情一键删除且不会回弹。否定句（「没有下雨」）仍会误推，靠详情删除，不做句法分析。
- **[18 轴 ≠ 18 个都有数据]** → 事实如此：多数案例只覆盖 6-10 轴。UI 只展开有数据的轴，空轴折叠，不制造「标注缺失」的焦虑。
- **[词表升级导致旧值断层]** → 版本号 + 别名保留旧名；`unmapped` 保留原始分类；重算脚本可分批跑并回滚（`case_facets` 可整表重建，`category` 字段未动）。
- **[导入事实被推导覆盖]** → 来源优先级固定 `manual > import > derived`，且推导跳过已有 import 的轴。
- **[筛选条件互相矛盾导致 0 结果]** → 空状态要显示哪几个条件冲突（各条件单独命中数），而不是只说「没有结果」。
- **[卡片信息过载]** → 卡片最多 3 个分面，详情才是完整标注的地方。

## Migration Plan

1. `server/db.mjs` 建 `case_facets`；`prompt_cases` 增加 `taxonomy_version` 列（`PRAGMA table_info` 判存在后 `ALTER TABLE`，老库兼容）。
2. 发布词表 v1 与映射表；服务启动校验。
3. 导入 / 反推流程开始写分面；旧案例此刻仍无分面。
4. 跑 `node scripts/backfill-prompt-facets.mjs` 回填；观察 `taxonomy_version` 覆盖率与未映射值分布。
5. 回滚：删除 `case_facets` 与 `taxonomy_version` 列即可回到现状，`category`、导入、反推、应用到镜头均不依赖新表；前端在分面接口 404 时隐藏分面栏。

## Open Questions

- 是否支持「排除某值」的负向筛选（`-genre:horror`）：词表、存储、计数都已支持，只差 UI 与查询参数，可后置。
- 是否把分面暴露给 Agent 工具（让模型按轴检索案例）：属于工具层扩展，不影响本次数据模型。
- 词表是否需要运营后台编辑：首版用 JSON 文件 + 版本号，若未来需要热编辑再引入管理界面。
