# Design

## Context

当前出片链路只把调度信息当“图片参考”用：`src/App.tsx` 在勾选 `useScheduleFrames` 时把 `scheduleFrames` 塞进 `refImages`，`server/video.mjs` 的 `buildVideoPayload` 只会拼 `image_url`；`scheduleVideo` 本身只在 Inspector 里预览。模型默认是 Seedance 1.0 pro / 1.0 lite i2v，`videoCapsFor` 也只登记了 1.0 / 1.5。

方舟视频任务接口的事实（创建视频生成任务 API）：

- 只有 Seedance 2.0 系列 / 2.5 支持 `reference_video`。
- 视频入参为 `{ type: "video_url", video_url: { url }, role: "reference_video" }`；`url` 只接受公网 URL 或 `asset://<ASSET_ID>`，视频不支持 Base64。
- 全模态参考生视频与首帧 / 首尾帧是互斥场景；图片用 `reference_image`。
- 2.0 系列限制：0~9 张图 + 0~3 段视频 + 0~3 段音频，单段 2~15 秒、总时长 ≤15 秒、单段 ≤200MB、24~60fps、mp4/mov。
- 2.5 限制更宽：0~30 张图 + 0~10 段视频 + 0~10 段音频，视频单段 2~30 秒；可用 `omni_reference_task_type=reference` 显式指定任务类型。

本项目是本地 Vite dev server，没有公网地址；现有渠道只有 Bearer API Key，没有 TOS / AK-SK 配置。方舟 Files API（`POST /api/v3/files`）支持二进制上传，文件 `active` 后返回预签名 `download_url`，这条能力可以用现有 Key 把本地视频变成方舟可访问的地址。

## Goals / Non-Goals

**Goals:**

- 在 localhost、零新增凭据的前提下，把本镜的 `scheduleVideo` 作为 `reference_video` 提交给 Seedance 2.0/2.5。
- 1.0 / 首帧 / 多图参考 / 抽帧通路保持原样，默认不产生任何行为变化。
- 模型能力、模式互斥、上传失败都在提交前或提交时有明确、可读的失败，不静默换模型或退回抽帧。
- 自动化验证不消耗 Seedance 2.0 额度；真实 2.0 只做一次人工冒烟。

**Non-Goals:**

- 不做镜头视角 POV 参考片的渲染（现有 3D 动画是“高空俯视飞入机位”的审片视角）。
- 不做 TOS / S3 上传、`CreateAsset` / `asset://`、公网 tunnel。
- 不做参考音频、真人素材、多个参考视频。
- 不做按镜头自动切换模型；模型仍由用户选。
- 不做方舟文件的长期复用 / 跨项目素材库。

## Decisions

### 1. 用 Files API 的 `download_url` 作为本地视频的桥

流程：

```text
public/videos/schedule-xxx.mp4
  -> POST {baseUrl}/files  (Bearer, multipart, purpose=user_data)
  -> { id: "file-xxx", status: "processing" }
  -> GET {baseUrl}/files/{id} 轮询到 status=active
  -> download_url（预签名 TOS 公网地址）
  -> content: { type: "video_url", video_url: { url: download_url }, role: "reference_video" }
```

**为什么不用其他路：**

| 方案 | 不可行 / 不合适的原因 |
| --- | --- |
| `CreateAsset` + `asset://` | 只接受公网 URL，且只支持 AK/SK V4 签名；仍然要先有公网地址，还多一套鉴权 |
| 视频 Base64 | 官方只对图片/音频提供 Base64，视频明确只收 URL / asset ID |
| 公网 tunnel | 依赖 ngrok/反代常驻，免费 ngrok 可能用警告页挡住方舟抓取 |
| TOS / S3 | 需要对象存储凭据与 bucket 配置，MVP 不引入 |
| Files API 的 `file_id` 直接当 URL | 生成接口文档只认 URL / asset ID，不认 `file-` 前缀 |

Files API 使用现有 Bearer Key，默认托管空间单文件 ≤512MB，上传/管理免费；3 秒 960×540 的白模视频约 1MB。文件默认保留 7 天，本设计上传时设为较短有效期（≥1 天），避免托管空间堆积。

### 2. 新增 `server/files.mjs` 纯客户端模块

保持 `server/video.mjs` 只做视频任务协议，Files API 单独成模块，便于 mock：

```ts
uploadFile({ baseUrl, apiKey, filePath, fetchImpl })
getFile({ baseUrl, apiKey, fileId, fetchImpl })
waitFileActive({ baseUrl, apiKey, fileId, intervalMs = 1000, timeoutMs = 60_000, ... })
```

- 用 Node 18 的 `FormData` / `Blob`，不新增依赖。
- 上传失败、文件 `failed`、轮询超时都抛 `FileError`，路由映射为 400/502，并带上阶段（上传 / 处理 / 超时）。
- 轮询建议 1 秒；3 秒视频通常几秒内 `active`。超时 60 秒足够。

**缓存：**

- 内存 `Map`，key 为 `绝对路径|size|mtimeMs`。
- value 只存 `{ fileId, expireAt }`；每次出片用 `GET /files/{id}` 刷新 `download_url`，避免预签名地址过期。
- 文件 404 / 过期 / `failed` 时删除缓存并重新上传。
- 不把 `fileId` / `download_url` 写进 SQLite 或 `project.json`；dev server 重启后重新上传即可（成本很低）。
- `download_url` 含临时签名，禁止写日志；错误信息里也只报文件名与阶段，不回显完整 URL。

**视频前置校验：**

- 只接受 `.mp4` / `.mov`；如果是 webm（`saveScheduleVideo` 的 ffmpeg 转码失败兜底），先用现有 `runFfmpeg` 转 mp4，再上传；转码失败则明确报错。
- 用 `ffprobe` 校验时长 2~15 秒（2.0）/ 2~30 秒（2.5）、大小 ≤200MB；3D 调度视频固定 3 秒、30fps、960×540，天然满足。
- 2.x 不接受参考素材里的真实人脸；当前胶囊人安全，未来换写实人物模型时需要在文档里提示。

### 3. `buildVideoPayload` 增加独立的参考视频模式

新增入参 `referenceVideos: string[]`：

```ts
const refVideos = (referenceVideos ?? []).map(String).filter(Boolean).slice(0, 3)

if (refVideos.length > 0) {
  // 全模态参考模式：text + reference_image* + reference_video*
  for (const url of refs) content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' })
  for (const url of refVideos) content.push({ type: 'video_url', video_url: { url }, role: 'reference_video' })
  // 不发送 first_frame / last_frame / camera_fixed
} else {
  // 现有首帧 / 参考图逻辑完全不变
}
```

- `return_last_frame` 继续保留：参考模式成功后仍能拿尾帧，供下一镜接龙。
- `camera_fixed` 在参考模式不发。固定机位的意思改由提示词承担（现有 fallback 已包含“机位固定不动”）。
- 参考视频为空时，函数行为与改动前逐字节一致，避免影响 1.0 回归。
- 2.5 通过模型条目的 `videoRefTaskType` 显式追加 `omni_reference_task_type: "reference"`；2.0 不传。**不靠模型 ID 正则猜版本。**

### 4. 模型能力与解析

`ModelEntry` 增加：

```ts
supportsVideoRef?: boolean
/** 仅 2.5 需要；2.0 留空 */
videoRefTaskType?: 'reference'
```

- 预置新增 `ark-video-2-0`（`doubao-seedance-2-0-260128`，`supportsVideoRef: true`）与 `ark-video-2-5`（`doubao-seedance-2-5-260628`，`supportsVideoRef: true`、`videoRefTaskType: 'reference'`）。模型 ID 可在设置页改。
- `CURRENT_PRESETS_VERSION` 升到 3，`mergePresets` 增加 V3 合并：只补新增的视频模型键，不覆盖用户已改的条目。
- 设置页对 `video` / `videoRef` 条目增加「支持视频参考」勾选与「任务类型」下拉（仅 2.5 需要）。自定义 2.0 模型必须显式勾选，系统不猜。
- 解析改为 `pickVideoModel(keyOverride, { needVideoRef })`：
  - 显式 key：在 `cap ∈ {video, videoRef}` 里精确查；找不到 → 400 `model-key-not-found`；需要视频参考但条目没有能力 → 400 `video-ref-unsupported`。
  - 无 key：保留现有默认语义（首帧模式用 `defaults.video`，多参考模式用 `defaults.videoRef`），不改变 1.0 行为。
- 这同时修掉当前 `pickModel('videoRef', wantKey)` 的静默回退：用户显式选中的 `video` 键不会被 `videoRef` 默认的 1.0 lite 覆盖。

**UI 选择器：** Inspector 现在只列 `cap=video`。新增一个视频族选择器（或给 `CapModelSelect` 增加 `caps` 参数），同时列出 `video` 与 `videoRef`，并在选项后标注「视频参考」。这样 2.0 条目无论放在哪个 cap 下都能选到。

### 5. 数据、请求契约与 UI

**数据字段：**

- `ShotData.useScheduleVideoRef?: boolean`（默认 false）。
- `ProjectShot.use_schedule_video_ref?: boolean`。
- `shotSync.bizSignature` / `nodeToShot` / `shotToData` 同步该字段；`localPath` 仍只持久化本地 `schedule_video`。
- `VideoOpts` 增加 `refVideos?: string[]`；`startVideo` 原样转发。

**Inspector：**

- 在 3D 调度预览下新增勾选框：「用 3D 调度视频作参考（Seedance 2.0+）」。
- 没有 `scheduleVideo` 或当前模型未声明 `supportsVideoRef` 时禁用，并显示原因。
- 勾选后：
  - 禁用「带调度关键帧作参考」（视频参考优先，抽帧通路忽略）；
  - 禁用「以下一镜画面作尾帧约束」，提示“视频参考模式下不再有首帧/尾帧硬锁”；
  - 提示参考视频来自本镜 `scheduleVideo`，重生成调度视频后会自动用新的。
- 默认关闭；旧项目读不到字段按 false。

**出片分支（`generateVideoOne`）：**

```ts
const useVideoRef = Boolean(node.data.useScheduleVideoRef && node.data.scheduleVideo)
if (useVideoRef) {
  // refImages = 连线图 + refImage（keyframe）；不传 image / lastFrame
  // refVideos = [scheduleVideo]
  // cameraFixed 不传
  // prompt 使用 @视频1 与 @图像N
} else {
  // 现有逻辑完全不变
}
```

- `refImage`（本镜画面）作为 `reference_image` 保留，用来锚定人物外观与画风；没有画面时只靠视频参考 + 提示词，并在 UI 提醒画风可能受白模影响。
- `motionNote` 继续拼进 prompt，作为文字兜底；它和视频参考不冲突。
- `useScheduleFrames` 与 `useScheduleVideoRef` 同时为 true 时，视频参考优先，抽帧忽略；UI 上不会让它们同时可勾。

### 6. 提示词

视频参考模式使用官方素材指代方式：

```text
{motion / videoPrompt}
【运镜与走位】{motionNote}

参考 @视频1 的机位运动、人物走位与相对位置；
画面风格、人物外观、场景以 @图像1 为准（没有图像参考时改为“以文字描述为准”）；
不要出现白模、网格、视锥、几何体材质、文字标签。
```

- 图片提示从现有的 `[图N]` 改为 `@图像N`，只在视频参考模式下生效；非视频模式保持 `[图N]`，不改变 1.0 的既有行为。
- 2.x 的参考视频只描述“怎么动、谁在哪”，不描述“长什么样”；这句范围约束是防止白模风格污染的关键。
- 第一版直接使用现有审片视频（3 秒、俯视飞入机位）。如果冒烟发现模型学的是俯冲而不是本镜运镜，再单开变更做按 `move` 驱动的 POV 参考片；本次不实现。

### 7. 验证策略

| 层 | 做法 | 是否花钱 |
| --- | --- | --- |
| Files API | 本地 mock `/files`（上传 + 轮询 + download_url），断言缓存与失败分支 | 0 |
| 请求体 | `/api/seedance` dryRun，断言 `video_url` / `role` / `@视频1` / 无首尾帧 / 无 camera_fixed | 0 |
| 模型校验 | dryRun：1.0 键 + 视频参考 → 400；2.0 键 → 通过；不存在的键 → 400 | 0 |
| 回归 | 现有 1.0 首帧 / 多图 / 尾帧 / 抽帧脚本保持不变 | 按现有 |
| 真实 2.0 | 手动一条 480p 短片，验证 3D 视频对运镜/走位的作用与白模污染 | 一条 |

真实 2.0 冒烟不进入 `verify-all.mjs`；脚本里只保留 mock 与 dryRun。这样“测试用 1.0”的约束成立，同时新能力有可重复的请求体断言。

## Risks / Trade-offs

- **Files API 的 `download_url` 能否直接作为 `reference_video` 没有官方逐字示例** → 机制上就是公网 URL；用一次 2.0 冒烟确认。若被拒，退回 TOS / tunnel，不改上层契约。
- **预签名地址有时效** → 每次提交前用 `GET /files/{id}` 刷新，提交后立即使用；不持久化、不写日志。
- **模式互斥导致本镜失去首帧/尾帧硬锁** → UI 提前禁用并说明；输出仍可 `return_last_frame`，下一镜接龙是单向保留的。
- **审片视频的相机路径不是本镜运镜** → 第一版 prompt 限定“只参考走位/机位关系”；若效果不对，再评估 POV 参考片。
- **白模风格污染** → prompt 明确排除白模/网格/标签；仍可能发生，作为冒烟重点观察。必要时后续做“干净参考渲染”。
- **Files API 异步处理延迟或失败** → 60 秒超时 + 阶段化错误；3 秒视频通常很快。失败不退回抽帧，避免用户以为用的是视频。
- **自定义渠道不实现 Files API** → 上传会明确失败；视频参考只对方舟协议渠道开放，和现有 `provider.kind !== 'ark'` 校验一致。
- **2.0/2.5 费用高于 1.0** → 默认关闭、只在显式勾选时走；回归继续用 1.0；冒烟只跑一条。
- **模型表自定义条目没有能力标记** → 设置页提供勾选；没勾时 UI 禁用、服务端 400，不猜模型 ID。
- **方舟托管空间配额** → 单文件小、上传时设 1 天有效期；缓存只存 fileId，不堆积本地副本。
- **2.x 对参考素材的真实人脸限制** → 当前 3D 胶囊人安全；未来若换写实人物模型，需要在文档与 UI 提示。

## Migration Plan

1. 类型与设置：`ModelEntry` 增加能力字段；`normalizeSettings` 保留/补默认；预置版本升到 3，合并 2.0/2.5 两个模型条目（不改 `defaults.video`，默认仍是 1.0）。
2. 新增 `server/files.mjs` 与 mock 验证脚本；先独立验证上传、轮询、缓存、失败。
3. 扩展 `buildVideoPayload` 与 `/api/seedance` 路由：`refVideos`、模式互斥、模型解析、Files API 调用。
4. 数据类型与 UI：`useScheduleVideoRef`、Inspector 开关、互斥提示、模型选择器。
5. 验证：1.0 全量回归 → mock/dryRun 新用例 → 手动 2.0 冒烟。
6. 文档：README 与 DEPLOY-CHECKLIST 补充 Files API 与视频参考模式；更新 `src/schedule3d.ts` 顶部“Seedance 只吃图片”的过时注释。
7. 回滚：关闭 Inspector 开关并恢复路由分支即可；无数据库 schema 变更，Files API 缓存是内存态，重启即清空。

## Open Questions

无。POV 参考片、TOS 上传、`asset://` 长期素材库都明确是后续变更，不影响本次实现。
