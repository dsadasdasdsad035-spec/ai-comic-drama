# Design

## Context

参见 `proposal.md`。当前实现约束：

- 应用是单进程：前端由 Vite 提供，API 路由集中在 `vite.config.ts` 的 middleware 里；数据存 `projects/storyboard.sqlite`，项目媒体存 `projects/<项目>/assets/`，站内地址是 `/project-assets/<项目>/<文件>`。
- 素材选择器（`src/MediaPicker.tsx`）只认四个本地来源，条目模型是 `PickItem`（`src/mediaPick.ts`），媒体类型只有图片/视频。
- 画布素材卡是 `assets` 表的视图：`src/App.tsx` 在卡片变化后整表 `DELETE` + 重插，只带 `kind/title/url/designId/characterName`。任何新增到 `assets` 表的列都会在同步时丢失。
- 已有可复用的 SSRF 防护 `server/ingest.mjs#assertPublicUrl`，以及带超时/流式读写的直链下载实现。
- 素材类型 `AssetKind` 在 `src/data.ts`；多处按「非视频即图片」处理（`shotReferences`、`shot3dContextCatalog`、`App` 的上下文标签、`mediaPick`、`AssetNode`）。
- 设置存 SQLite 的 `settings.app`，读时归一化、写时剥离只读字段；创意会话的 DTK Key 已有「只回传是否保存」的脱敏模式。

## Goals / Non-Goals

**Goals:**

- 一套来源适配器契约，新增来源不改检索/导入 API 与 UI。
- 检索全部在服务端完成；客户端拿不到来源 Key，也不能指定下载地址。
- 导入后的文件、来源、作者、许可证可追溯，且不受画布素材表整表回写影响。
- 音频作为一等素材类型可预览、可入库，但明确不参与画面参考和成片音轨。
- 所有验收默认离线可跑。

**Non-Goals:**

- BGM/音效轨混音、镜头音频参考、TTS 音色样本接入。
- 外链热用、对象存储、私有素材服务的具体实现。
- 多来源聚合检索与跨来源统一分页；首期一次只检索一个来源。
- 许可合规的强制拦截（只展示与留档，不做使用限制判断）。
- 视频裁剪/转码以适配 Seedance 参考视频时长限制。

## Decisions

### D1 来源用适配器注册表，检索结果统一归一化

新增 `server/stock.mjs`，每个来源是一个纯对象：

```js
{
  id: 'pexels',
  label: 'Pexels',
  requiresKey: true,
  mediaTypes: ['image', 'video'],
  defaultBaseUrl: 'https://api.pexels.com',
  availability({ enabled, apiKey, baseUrl }) -> { ok, reason? },
  async search({ query, mediaType, page, perPage, orientation, minDuration, apiKey, baseUrl, fetchImpl })
    -> { items: NormalizedItem[], total?, hasMore }
}
```

`NormalizedItem` 是前后端唯一的结果契约：

```js
{
  provider, itemId, mediaType,            // image | video | audio
  title, author, authorUrl, sourceUrl,
  license: { name, url, attribution, requiresAttribution },
  thumbnailUrl, previewUrl,
  variants: [{ url, mime, width?, height?, duration?, bytes? }],
  width?, height?, duration?, tags?
}
```

首期三个来源的映射：

| 来源 | 媒体类型 | 鉴权 | 备注 |
| --- | --- | --- | --- |
| Pexels | 图片 / 视频 | `Authorization: <key>` | 照片用 `large2x` 作为下载候选，视频取 ≤1080p 的最高清变体 |
| Pixabay | 图片 / 视频 | `key` 查询参数 | 检索带 `lang=zh`、`safesearch=true`；无按 id 查询详情接口 |
| Openverse | 图片 / 音频 | 可选 Bearer | 匿名可用但额度很低；音频 `duration` 按毫秒返回，归一化时除以 1000 |

替代方案：客户端直连来源。被否，原因是 Key 会进浏览器、跨域不可控、额度无法集中缓存，也无法做下载校验。替代方案：客户端提交下载 URL 由服务端直接下载。被否，原因是等于开放代理与 SSRF 入口。

### D2 导入凭服务端令牌，客户端不提交下载地址

检索响应里每条结果带一个随机令牌，服务端在内存 `Map<token, { item, provider, createdAt }>` 保存完整条目；令牌 TTL 30 分钟，最多 1000 条，超出按最旧淘汰。

```
search  ──> { items: [ { ...item, token: "stk_xxx" } ] }
import  ──> { project, token, target }  // 只有令牌，没有 URL
```

替代方案：把条目内容编码进令牌或签名。被否，原因是仍要维护签名密钥，且导入时还得重新校验；服务端 Map 更简单。代价是进程重启后令牌失效，用户重新检索即可，符合单进程现状。

Pixabay 没有按 id 查询详情的接口，令牌方案同时解决了它的二次解析问题。

### D3 检索缓存与显式提交

相同 `provider + mediaType + query + page + perPage + orientation + minDuration` 的检索结果缓存 10 分钟，缓存上限 200 条。缓存命中直接返回并标记 `cached: true`，不请求来源。

前端只在回车或点「搜索」时请求，不做输入防抖检索。来源返回 429 时映射为 `kind: 'rate-limit'`，界面提示稍后重试，不显示成空结果。

### D4 导入流水线：令牌 → 校验 → 临时文件 → 落库 → 重命名

```
token 校验
  -> 选择下载变体（按媒体类型与大小上限）
  -> assertPublicUrl(下载地址)
  -> fetch（120s 超时，跟随重定向）
  -> 校验最终响应 URL 仍为公网
  -> 校验 Content-Type 与流式累计大小
  -> 写入 .part 临时文件
  -> 服务端校验扩展名与 MIME
  -> 重命名为 stock-<provider>-<itemId>.<ext>
  -> upsert stock_imports
```

任何一步失败都删除 `.part`；只有在文件就绪后才写来源记录。已经存在同项目、同来源、同条目的记录且文件存在时直接返回旧地址并标记 `reused: true`。

大小上限：图片 30MB（与 `MAX_REF_BYTES` 一致）、音频 30MB、视频 200MB（与创意摄取上限一致）。Content-Type 白名单：图片 `image/png|jpeg|webp|gif`，视频 `video/mp4|quicktime|webm`，音频 `audio/mpeg|wav|ogg|mp4|aac|flac`；`application/octet-stream` 时回退到扩展名判断。服务端的 `mimeOf` 需补 `ogg`、`flac`。

替代方案：先在内存里读完再判断大小。被否，原因是 200MB 视频会整段驻留内存；改为流式读取并在超限时中止。

### D5 来源元数据放侧表，不放 `assets` 表

新增 `stock_imports`：

```sql
CREATE TABLE IF NOT EXISTS stock_imports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL,
  provider    TEXT NOT NULL,
  item_id     TEXT NOT NULL,
  asset_url   TEXT NOT NULL,
  media_type  TEXT,
  title       TEXT,
  author      TEXT,
  author_url  TEXT,
  source_url  TEXT,
  license     TEXT,
  license_url TEXT,
  attribution TEXT,
  width       INTEGER,
  height      INTEGER,
  duration    REAL,
  bytes       INTEGER,
  created_at  TEXT,
  UNIQUE(project_id, provider, item_id)
);
```

理由：画布同步会整表替换 `assets`，新增列会被抹掉；侧表按 `asset_url + project` 查询，卡片拖动、重载都不丢。备选方案是把来源字段塞进素材卡 `data` 并参与画布持久化，但这会让画布状态承担业务元数据，且旧卡迁移麻烦。

`server/db.mjs` 增加 `upsertStockImport`、`getStockImportByItem`、`findStockImportByUrl`、`listStockImports`。`stock_imports` 在 `SCHEMA` 里建表，老库打开时由 `db.exec(SCHEMA)` 自动补建，不需要 ALTER。

### D6 媒体类型统一用一个解析函数

新增 `assetMediaType(kind, url)`（放在 `src/mediaPick.ts`，导出给其它模块）返回 `image | video | audio`：

- `kind === 'audio'` 或扩展名是 mp3/wav/m4a/ogg/aac/flac → `audio`
- `kind === 'video'` 或扩展名是 mp4/mov/webm/m4v → `video`
- 其余 → `image`

所有原先「非视频即图片」的位置改为三态判断：

| 文件 | 改动 |
| --- | --- |
| `src/shotReferences.ts` | 图片参考跳过 `audio`；视频参考只收 `video`；音频卡连线不产生参考 |
| `src/shot3dContextCatalog.ts` | 图片清单排除 `video` 和 `audio` |
| `src/App.tsx` | 上下文标签、去重与分类增加音频；音频不进入图片计数 |
| `src/contextManifest.ts` | 单独统计音频，不混进图片 |
| `src/AssetNode.tsx` | 音频卡渲染播放器与音频徽标 |
| `src/Inspector.tsx` | 类型按钮、来源标签、预览支持音频 |
| `src/mediaPick.ts` | `PickItem.mediaType` 扩为三态，`pickKind` 返回 `audio` |

不新增 `shot3dContextCatalog` 的音频分类：本期音频不参与 3D/镜头上下文，避免多一条无消费方的链路。

### D7 两个入口共用一个浏览组件

新增 `src/stock/StockBrowser.tsx`，两种模式：

- `mode="picker"`：嵌在素材选择器的「在线素材」页签里。确认后先导入，成功再把本地地址交给 `MediaPicker` 的 `onConfirm`，类型按 `assetMediaType` 修正。
- `mode="library"`：素材页工具栏按钮打开的弹窗。导入前选择落点：
  - 图片：项目素材卡（`image` / `scene` / `prop`）或场景/道具设定卡
  - 视频：视频素材卡
  - 音频：音频素材卡

`src/stock/api.ts` 负责 `/api/stock/*` 调用与错误归一化；`src/stock/types.ts` 与 `src/stock/stockFormat.ts` 放类型、许可标签、署名文本、尺寸/时长格式化等纯函数，便于用 esbuild 做单元测试。

素材页新增 `onAddAssetCard` 回调（由 `App` 提供），用于把导入结果直接变成画布素材卡；场景/道具设定落点走现有的 `designs` 合并与保存逻辑，`id` 用 `uid()`，`refs` 为空，`promptEn` 留空并提示补锚点。

### D8 设置结构与密钥边界

`AppSettings` 增加：

```ts
stock?: {
  providers?: Partial<Record<'pexels' | 'pixabay' | 'openverse', {
    enabled?: boolean
    apiKey?: string
    baseUrl?: string
  }>>
}
```

- 缺省全部关闭；`baseUrl` 缺省用官方地址。
- 归一化、脱敏与环境兜底放在 `server/stock-settings.mjs` 纯模块里，由 `vite.config.ts` 引入；这样可以直接单测，不必为了测设置去起 dev server。
- 环境变量兜底：`PEXELS_API_KEY`、`PIXABAY_API_KEY`、`OPENVERSE_API_KEY`（可选）。Openverse 无 Key 时按匿名模式可用。
- 读取设置时把 `apiKey` 换成 `hasApiKey`，与创意 DTK 的处理一致；保存时空 Key 保留旧值，避免「留空即清空」误操作。
- Key 不进入错误文本、日志或前端状态；来源返回 401/403 时只提示「凭据无效」。

设置页新增「素材库」分区（`section === 'stock'`），每个来源一行：启用、Key（password，已保存时占位提示）、Base URL、状态徽标、检测按钮。检测只发起一次最小检索。

### D9 路由与错误形状

| 路由 | 方法 | 作用 |
| --- | --- | --- |
| `/api/stock/providers` | GET | 来源列表、媒体类型、可用性与 Key 来源 |
| `/api/stock/search` | GET | 检索；参数 `provider/type/q/page/perPage/orientation/minDuration` |
| `/api/stock/import` | POST | `{ project, token, target? }` |
| `/api/stock/meta` | GET | `?project=&url=` 查来源元数据 |

统一 `{ ok, message?, kind? }`；`kind` 取值 `auth | rate-limit | network | provider | bad-request | too-large | unsupported-type | not-found`。搜索参数非法返回 400，不请求来源；来源错误返回 502，但保留 `kind` 让前端给可操作提示。

### D10 验收策略

- `verify-stock-api.mjs`：直接导入 `server/stock.mjs`，用本地 mock HTTP 服务与注入的 `fetchImpl` / `assertPublic` 覆盖三个来源的归一化、缓存命中、令牌过期、下载成功、去重、类型/大小拒绝、失败清理；另用真实 `assertPublicUrl` 验证 localhost 被拒。
- 路由级验收：起临时 Vite + 临时项目库，保存来源设置（Base URL 指向本地 mock），验证检索、设置脱敏、未配置 Key/限流的错误映射；不依赖真实外网。
- `verify-stock-ui.mjs`：Playwright + `page.route` 拦截 `/api/stock/*`，验证设置分区、选择器在线页签、显式检索、图片/视频/音频预览、授权信息、导入后素材卡/场景设定落点、音频卡不进入参考、390px 与 Esc/焦点。
- `tests/stock.ts`：`assetMediaType`、`pickKind`、许可标签/署名文本、结果分页与令牌字段等纯函数，挂到 `verify-skills-unit.mjs`。
- 扩展 `verify-media-picker.mjs`：项目素材里加入音频条目，验证音频预览、确认后类型变为 `audio`、取消不写回。

## Risks / Trade-offs

- **画布同步会抹掉 `assets` 表的新列** → 来源元数据放侧表，按 URL 查询；不往 `assets` 加列。
- **音频类型污染画面参考** → 统一 `assetMediaType` 三态解析，所有参考收集显式排除音频，并用单元测试覆盖。
- **令牌与缓存在内存，重启即失效** → 单进程现状下可接受；失效时提示重新检索，不返回坏地址。
- **来源限流或地区不可达** → 服务端缓存 + 显式检索 + 可配置 Base URL；错误区分限流/鉴权/网络，不伪装成空结果。
- **Openverse 下载地址可能指向任意第三方站点** → 导入前做公网校验、最终 URL 复核、类型与大小限制、超时；不接受客户端地址。
- **在线视频可能超过 Seedance 参考视频时长或体积限制** → 本期只把它当普通视频素材，不自动裁剪；界面显示时长，后续单独做裁剪/转码。
- **许可证展示不等于合规使用** → 显示许可与署名文本并留档；是否可用由用户判断，不把 CC-BY 内容标成免署名。
- **多进程部署会破坏令牌/缓存一致性** → 当前是单进程本地应用；若以后多实例，需要把令牌与缓存迁到共享存储。

## Migration Plan

- 升级后首次打开数据库自动建 `stock_imports`；不迁移旧数据。
- 设置里没有 `stock` 字段时按「全部来源关闭」处理，用户需在设置页启用并填 Key。
- 回滚：移除 `/api/stock/*` 路由与 UI；已导入文件仍是普通项目素材，`stock_imports` 表可保留或删除，不影响素材卡与画布。
- 已导入文件不写入 git（`projects/*/assets/` 已在 `.gitignore`）。

## Open Questions

- 是否在结果卡片上标出「已导入」并直接跳到对应素材卡？可在后续小改中基于 `stock_imports` 增加，不影响本期契约。
- 音频是否在后续变更中接入成片 BGM 轨？本期只做素材入库，音轨需要独立设计与时间线 UI。
