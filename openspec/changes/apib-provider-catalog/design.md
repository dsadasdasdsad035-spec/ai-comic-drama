# Design

## Context

设置数据存在 SQLite 的 `settings` 表（key=`app`），结构为 `Provider[] + ModelEntry[] + defaults + stageModels + presetsVersion`。请求分发集中在 `vite.config.ts` 的 dev server 中间件里：`pickModel` / `pickVideoModel` / `pickVisionModel` 按能力解析模型，`providerKey` 解析渠道 Key；`server/video.mjs` 是方舟视频任务客户端，`server/volc-tts.mjs` 是火山 TTS 客户端。

现有约束：

- `ProviderKind` 是固定枚举：`ark | ark-plan | openai | minimax | elevenlabs | volc-tts`。
- 图像第三方路径只认同步 `data[].url` / `b64_json`；视频只支持方舟 `contents/generations/tasks`；视觉与视频理解有渠道白名单。
- 设置页把渠道按用途重复渲染，模型表按 9 个能力分组；同一模型要服务多个能力时必须重复登记。
- APIMart 的文本响应外层包 `{code, data}`，图像/视频是异步任务，配音是二进制响应；视频请求体跨厂商不统一。
- 当前提供的 APIMart Key 余额为 0，`GET /v1/models` 也返回 402，因此本期设计必须允许用 mock 完成实现验收，真实生成验收单独列为充值后的步骤。

## Goals / Non-Goals

**Goals:**

- 把 APIMart 作为一等渠道接入，覆盖文本、视觉、图像、视频、配音五条现有请求路径。
- 用目录同步解决“模型很多、不能硬编码”的问题，并让模型能力在 UI 中可见、可筛选。
- 用一个模型行 + `caps[]` 表达多能力，消除文本/高质量、图像/三视图、视频/视频参考的重复登记。
- 把设置页从“纵向长表单 + 重复卡片”改成“分组导航 + 唯一渠道卡 + 模型库 + 两级默认路由”。
- 保持旧设置、旧默认模型和旧调用方行为不变；不新增 npm 依赖。

**Non-Goals:**

- 不实现 Whisper 转写、Suno/Flow Music、内容审核；它们没有对应的产品入口。
- 不做 schema 驱动的全视频族通用 payload；本期只接 Seedance 2.5 与 Kling v3，其余目录登记但运行不可选。
- 不为 APIMart 声明原生 tool calls；统一 chat 文档没有 `tools` 契约，实测前继续 JSON action。
- 不解决本地参考视频的公网托管；APIMart 没有文档化的视频上传接口，`videoRef` 只接受公网 URL。
- 不把设置页迁到 Tailwind/shadcn，也不改生成工作台的交互。

## Decisions

### D1. 新增 `ProviderKind = 'apimart'`，不复用 `openai`

`openai` 渠道的语义是“文本 + 同步图像”，`capsOfKind` 也只给 text/image；APIMart 需要视频、音频和异步图像，复用它会让所有分发点都靠 `baseUrl` 或模型名猜协议。

替代方案是引入通用的 `openai-compatible` + 每能力协议标记，灵活但会把现有 6 种 kind 的分发改成矩阵，超出本次范围。先加一个明确的 `apimart` kind，等第二个同构网关出现再抽象。

### D2. `ModelEntry` 增加可选 `caps?: Cap[]`，`cap` 保留为兼容字段

读写规则：

```ts
function modelHasCap(m: ModelEntry, cap: Cap): boolean {
  if (m.caps?.length) return m.caps.includes(cap)
  return m.cap === cap          // 旧数据行为完全不变
}
```

- 目录同步/预设写 `caps`，一个模型一行：
  - 对话模型：`['text','textPro']`，有视觉标签时再加 `'vision'`
  - 图像模型：`['image','view']`
  - 视频模型：`['video']`，`supportsVideoRef` 决定能否服务 `videoRef`
  - 配音模型：`['audio']`
- `pickModel`、`pickVisionModel`、`pickVideoModel`、`pickVideoVisionModel` 都改为 `modelHasCap`。
- `textModels`、`byCap`、设置页筛选、Inspector 的 `CapModelSelect` 共用同一谓词，避免 UI 与服务端判定不一致。
- 不做一次性数据迁移；旧行没有 `caps` 时行为与现在完全一致。

替代方案是彻底改成 `family + features`，更干净，但要同时改默认路由、所有调用方和测试；`caps[]` 是低风险中间态，后续可以再演进。

### D3. 目录拉取放服务端，同步合并放客户端草稿

服务端新增 `POST /api/provider-catalog`，请求体 `{ id, provider }`，用草稿里的 `baseUrl` / `apiKey`（而不是已保存值）拉取 `GET {base}/models?expand=category`，返回：

```ts
type CatalogEntry = {
  id: string
  category: 'chat' | 'image' | 'video' | 'audio' | 'unknown'
  tags: string[]
  suggestedCaps: Cap[]
  runtime: 'ready' | 'catalog-only'
  reason?: string
}
```

为什么不直接在浏览器拉：避免 CORS、避免把 Key 放进新窗口、错误映射与现有 `testProvider` 保持一致。为什么不直接写库：设置页已有“草稿 → 保存”模型，同步必须先预览、可取消，不能绕过保存按钮。

目录结果只存在客户端内存，不新增数据库表；需要重新拉取时再请求。

### D4. 异步任务适配器独立成 `server/apimart.mjs`

职责：

```ts
fetchCatalog({ baseUrl, apiKey, signal })
uploadImage({ baseUrl, apiKey, filePath | buffer, mime, filename })
submitImage({ baseUrl, apiKey, payload })
submitVideo({ baseUrl, apiKey, family, payload })
pollTask({ baseUrl, apiKey, taskId, signal, timeoutMs, onProgress })
downloadResult({ url, signal })
synthesizeSpeech({ baseUrl, apiKey, text, voice, model })
```

统一错误类型：

```ts
class ApimartError extends Error {
  kind: 'auth' | 'billing' | 'rate-limit' | 'timeout' | 'cancelled' | 'unsupported' | 'api'
  status?: number
  taskId?: string
}
```

不继续堆在 `vite.config.ts`：那里已经同时承担设置、文本、视觉、图像、视频、导出等路由；独立模块可以用 mock `fetch` 做纯 Node 验证，也方便以后给图像/视频复用轮询逻辑。

### D5. 视频用统一 schema 适配，保留专用族与工具模型边界

APIMart 的 `/v1/models/{id}/schema` 对全部视频模型返回同一组字段：`prompt`、`duration`、`resolution`、`aspect_ratio`、`first_frame_image`、`last_frame_image`、`image_urls`、`image_with_roles`、`video_urls`、`generate_audio`。因此除 Seedance 2.5 / Kling v3 的专用 payload 外，其余生成型视频模型走一套通用 builder：

```json
{
  "model": "wan2.6",
  "prompt": "...",
  "duration": 5,
  "resolution": "480p",
  "aspect_ratio": "16:9",
  "first_frame_image": "https://...",
  "last_frame_image": "https://...",
  "image_urls": ["https://..."],
  "video_urls": ["https://..."],
  "generate_audio": false
}
```

- 首帧用 `first_frame_image`，尾帧用 `last_frame_image`，多参考图用 `image_urls`，参考视频用 `video_urls`；本地图片先上传换 URL，本地参考视频仍只接受公网 URL。
- Seedance 2.5 保留 `image_with_roles` / `video_urls` / `size` 专用字段；Kling v3 保留首尾帧 `image_urls` + `mode`。两族继续用已验证的 builder。
- `Omni-Flash-Ext` 的 resolution 枚举只接受 360p/720p/1080p/4k，480p 自动取 720p。
- 6 个非生成型视频模型保持 `catalog-only`：`MiniMax-H3-Context-IR`、`MiniMax-H3-Regeneration`、`wan2.7-videoedit`、`kling-v2-6-motion-control`、`kling-v3-motion-control`、`veo3.1-lite`；它们需要源视频/源任务或属于提示词增强，直接给首帧没有意义。
- 完成时把结果下载到 `public/videos`（或项目媒体目录），不把临时 URL 存进项目数据。

替代方案是逐族手写 payload；schema 已经统一，通用 builder 覆盖 51 个生成型模型，维护成本更低。模型特有的时长/分辨率上限仍由上游校验并返回可读错误。

### D6. 图像走统一的异步任务流程，参考图先上传

所有 APIMart 图像模型共用：

```text
resolve refs -> upload local files -> POST /images/generations
              -> poll /tasks/{id} -> download result -> saveProjectImage/public
```

- `n` 仍按现有“n 次独立请求”实现，不依赖模型的 `n` 上限；Seedream 5 Pro 只允许 1 张，正好匹配。
- `size` 传比例字符串（`16:9` 等），不传方舟的像素值；APIMart 的图像模型普遍接受比例，精确像素只在模型明确要求时使用。
- 参考图数量由 `features.imageRef` / 模型族决定：`none` 拒绝，`single` 截断为 1 张并提示，`multi` 按模型上限截断；未声明时尝试提交并把上游错误透出。
- 结果 URL 有 24h/72h 过期时间，下载失败时返回 `download` 错误，不把临时 URL 返回给画布。

### D7. 文本协议做“双形态”解析，不改现有 OpenAI 路径

- 非流式：`const payload = j?.data?.choices ? j.data : j`，后续读取 `choices[0].message.content`。
- 流式：在 `ChatStreamParser` 之前加一层归一化：

```ts
function normalizeChunk(obj: any) {
  if (Array.isArray(obj?.choices)) return obj
  if (Array.isArray(obj?.data?.choices)) return obj.data
  if (obj?.data?.delta || obj?.data?.message) {
    return { choices: [{ delta: obj.data.delta, message: obj.data.message, finish_reason: obj.data.finish_reason }] }
  }
  return null
}
```

- `thinking` 不发给 APIMart：现有 `deepSeekThinking` 只匹配 `ark-plan` / `deepseek` / `deepseek.com`，APIMart 不会命中；不要给 APIMart 加例外。
- 视觉继续用 OpenAI content parts，只在模型 `caps` 含 `vision` 时允许；`videoVision` 暂不加入 APIMart 白名单。
- 原生工具：`src/agent/toolCapabilities.ts` 不新增 APIMart 条目；`auto` 落回 JSON。

### D8. 配音走 `/audio/speech`，音色与未知音色回落都在 APIMart 内

- 请求：`{ model, input, voice, response_format: 'mp3', speed: 1 }`。
- 音色：`alloy, echo, fable, onyx, nova, shimmer`；默认 `alloy`。
- 响应是二进制；先检查 `content-type`，如果是 JSON 就按错误解析，避免把错误 JSON 写成 mp3。
- 未知音色回落到 `alloy`，不回落到 MiniMax 的 `male-qn-qingse`；`listVoices` 按 `provider.kind === 'apimart'` 返回 APIMart 列表。
- `speech_rate` / `rate` 暂不映射到 `speed`，保持 1.0；后续需要时再加。

### D9. 设置页用“草稿 + 分组面板”，保留全局 CSS

信息架构：

```text
SettingsPage
  +-- status bar (缺 Key / 余额不足 / 失效默认)
  +-- left nav: 渠道 | 模型 | 默认路由 | 高级(Agent/计价/技能/数据)
  +-- 渠道: ProviderCard[] + AddProviderMenu
  +-- 模型: ModelLibrary (search/filter/table) + CatalogSyncDialog
  +-- 默认路由: capability table (provider -> model) + stage table
```

- 新建 `src/settings/` 子目录，保留 `src/Settings.tsx` 作为默认导出入口，`App.tsx` 不用改 import。
- 所有面板共享页面级 `draft` 状态；`dirty = JSON.stringify(draft) !== JSON.stringify(baseline)`；保存仍走现有 `saveSettings`。
- 渠道卡每个 `provider.id` 只渲染一次；用途 chips 直接编辑 `caps`。
- 添加渠道先弹预设菜单，选中后预填 `kind/baseUrl/caps`，不立即写库。
- 模型库一行一个模型，展示 `caps`、`source`、`runtime`；`runtime` 由服务端或客户端纯函数判定，APIMart 的非接入族显示“未接入运行时”。
- 默认路由分两级：先选渠道，再选该渠道下 `modelHasCap(cap)` 且 `runtime === 'ready'` 的模型；切换渠道时重置模型。
- 目录同步弹窗用 `POST /api/provider-catalog`，展示 `suggestedCaps` 与 `runtime`；勾选后合并到 `draft.models`，保存前不落库。
- 状态条需要知道环境变量 Key 是否存在：`/api/settings` 响应增加只读 `keyAvailable?: boolean`（服务端用 `providerKey` 计算，不返回 Key 本身），保存时忽略该字段。
- 保留现有 `.st-*` 类名到等价元素上，新增 `data-settings-*` 钩子；这样 `verify-providers.mjs` 等脚本可以逐步迁移，而不是一次性全改。

不迁移 Tailwind：`src/chat-ui` 的 Tailwind 是 scoped 的，设置页全局 CSS 有完整的 Cinema Dark token；混用会引入 `--muted` 之类的主题变量冲突（项目已有先例）。

### D10. 预置与迁移

- `CURRENT_PRESETS_VERSION = 9`，用 `mergeApimartPresets` 只追加 `apimart` 渠道与一组只包含“已接入运行时”的模型键。开发库在实现期间被写成 6/7/8 但没有合并 APIMart，v9 作为一次性修复步；正常升级与全新实例同样走这一步。
- `mergePresets` 只做一次追加，不覆盖已有默认值；用户删除的预置不会反复加回。
- 预置模型使用 APIMart 短 ID（`gpt-5.1`、`claude-sonnet-4-6`、`gemini-3.5-flash`、`deepseek-v4-flash`、`seedream-5-0-pro`、`seedance-2.5`、`kling-v3`、`gpt-4o-mini-tts`），不抄方舟的 `doubao-*` ID。
- `normalizeSettings` 读取并清洗 `caps`、`features`、`source`；写回时保留未知字段，避免旧版本回滚丢配置。
- 旧 `apiKey` 字段、`skillsMigrated`、`agentLimits` 等保持原样。

## Risks / Trade-offs

- **余额为 0 阻塞真实验收** → 实现阶段全部用 mock `fetch` 验证协议与 UI；真实文本/图像/视频/配音 smoke 单独列为“充值后执行”，不把 402 当成代码失败。
- **chat SSE 包装形态未文档化** → 归一化层同时接受顶层 `choices`、`data.choices`、`data.delta`；用三组 fixture 覆盖；无法确认的分片按可读错误透出，不吞掉。
- **视频厂商字段差异** → 只接两个族，注册表精确匹配；其他模型 `catalog-only`，直接传键返回 `unsupported`，不用近似 payload 冒险。
- **本地参考视频无法提交** → 在设置页与生成错误里明确“只接受公网视频 URL”；这是相对方舟的能力倒退，写入验收说明。
- **参考图上传增加延迟与失败点** → 每个请求只上传一次，失败按参考图逐个报告；上传 URL 72h 过期，生成后立即下载结果，不缓存上游 URL。
- **目录 402 导致无法演示“全量模型”** → 弹窗显示余额不足与充值提示，预置模型仍可手工添加；充值后同一入口无需改代码。
- **`caps[]` 与服务端谓词不一致** → 把 `modelHasCap` 放在共享 TS 模块，服务端通过同一逻辑的 JS 镜像（或直接复制纯函数）使用；加单元测试覆盖 `cap` 旧数据与 `caps` 新数据。
- **设置页改版破坏 9 个 `.st-*` 验证脚本** → 保留等价类名与 `data-settings-*` 钩子，先改脚本再删旧类名；把脚本更新列入任务，不留给“以后”。
- **APIMart 统一 chat 可能不支持 image content parts** → 视觉能力只在模型声明后开放；若实测失败，UI 把 APIMart 视觉模型标为不可用，文本路径不受影响。

## Migration Plan

1. 代码合入后首次读取设置时，`mergePresets` 追加 APIMart 渠道与预置模型，`presetsVersion` 写为 9；不改变 `defaults`。
2. 旧模型行没有 `caps`，按 `cap` 原行为路由；旧渠道没有 `caps`，按 `capsOfKind` 推断。
3. 回滚：删除 APIMart 渠道/模型即可；代码回滚后新字段被忽略，设置 JSON 仍可读。`presetsVersion` 9 在旧代码里只会被当作“无需合并”，不会破坏旧数据。
4. 不新增数据库表、不做字段重命名；无需数据迁移脚本。

## Open Questions

- APIMart 的视觉 chat 是否接受标准 `image_url` content parts，需充值后实测；若不接受，本期把 APIMart 视觉模型标记为未验证，不阻塞文本/图像/视频。
- Kling v3 的精确模型 ID 与参考图上限以 `/v1/models` 返回为准；预置先用文档的 `kling-v3`，同步后以目录条目校正。
- 是否需要在下一期把其余视频族接入 schema 驱动 builder；不影响本期任务拆分。
