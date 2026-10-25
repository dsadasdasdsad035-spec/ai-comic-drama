# APIMart（APIB）渠道

APIMart 是 OpenAI 兼容网关，文档站 `docs.apib.ai`，网关 `https://api.apimart.ai/v1`。本项目的渠道类型为 `apimart`。

## 配置

- Base URL：`https://api.apimart.ai/v1`
- Key：设置页「渠道 → APIMart」填入，或使用环境变量：
  - `APIB_API_KEY`
  - `APIMART_API_KEY`
- Key 优先取设置库，其次取环境变量；**不会回退到方舟 Key**。
- Key 不写入仓库。设置保存在 SQLite 的 `settings` 表。

## 余额与错误

网关在余额不足时对所有请求（包括 `GET /v1/models`）返回：

```json
{"error":{"code":"","message":"insufficient balance ...","type":"apimart_error"}}
```

HTTP 402。设置页会把它显示为「余额不足」，不是 Key 无效。401/403 才是鉴权失败。

## 已接入运行时

| 能力 | 协议 | 说明 |
|---|---|---|
| 文本 / 高质量文本 | `POST /chat/completions` | 兼容 `{code,data}` 外层与裸 OpenAI 响应；流式两种分片都能解析 |
| 视觉 | `POST /chat/completions` + `image_url` | 仅模型声明视觉能力时可用 |
| 图像 / 三视图 | `POST /images/generations` → `GET /tasks/{id}` | 异步任务；参考图先 `POST /uploads/images` 换 URL |
| 视频 | `POST /videos/generations` → `GET /tasks/{id}` | 通用 schema 适配：首帧/尾帧/参考图/参考视频 |
| 配音 | `POST /audio/speech` | `gpt-4o-mini-tts`，6 个音色 |

目录同步：`GET /models?expand=category`。一个模型只登记一行，能力写在 `caps` 里。

## 视频族边界

APIMart 的 `/videos/generations` 对全部视频模型暴露同一组字段，项目用一套通用适配器提交：

- `prompt`、`duration`、`resolution`、`aspect_ratio`
- 首帧 `first_frame_image`、尾帧 `last_frame_image`
- 多参考图 `image_urls`、参考视频 `video_urls`
- 本地参考图先上传 `/uploads/images`；参考视频只接受公网 URL

Seedance 2.5 与 Kling v3 仍走各自的专用 payload（首尾帧角色、参考视频任务类型）。以下 6 个模型不是“给首帧就出片”的生成模型，保持「未接入」：`MiniMax-H3-Context-IR`、`MiniMax-H3-Regeneration`、`wan2.7-videoedit`、`kling-v2-6-motion-control`、`kling-v3-motion-control`、`veo3.1-lite`；它们需要源视频/源任务或属于提示词增强。

## 已知限制

- 参考图上传上限 20MB，返回 URL 有效期 72 小时；生成结果会立即下载到本地。
- APIMart 没有文档化的参考视频上传接口，视频参考只接受公网 URL；本地 3D 调度视频不能直接提交。
- 图像/视频结果 URL 有 24–72 小时有效期，系统生成后立即下载。
- 配音只接 `gpt-4o-mini-tts`；`tts-1` / `tts-1-hd` 实测返回 404。Whisper 转写、Suno/Flow Music、音频对话、嵌入与内容审核属于后续能力，本期未接入。

## 手工验证

```bash
# 目录（余额不足会返回 402）
curl -sS -H "Authorization: Bearer $APIB_API_KEY" \
  'https://api.apimart.ai/v1/models?expand=category'

# 1-token 文本
curl -sS -H "Authorization: Bearer $APIB_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"gpt-5.1","messages":[{"role":"user","content":"ping"}],"max_tokens":1,"stream":false}' \
  'https://api.apimart.ai/v1/chat/completions'
```

充值后运行 `node verify-apimart-live.mjs` 做文本/图像/视频/配音 smoke。
