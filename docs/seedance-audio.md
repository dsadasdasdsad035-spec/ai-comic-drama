# Seedance 2.5 音频参考（APIMart 实测）

> 实测日期：2026-10-24。只读 schema 与一次 4 秒真实任务；不包含 3 镜 A/B。

## 字段

APIMart 的 `GET /v1/models/seedance-2.5/schema` **没有列出** `audio_url`，但实际接口接受：

```json
{
  "model": "seedance-2.5",
  "prompt": "... 音色参考音频1 ...",
  "duration": 4,
  "resolution": "480p",
  "aspect_ratio": "16:9",
  "generate_audio": true,
  "audio_url": "https://... 或 data:audio/mpeg;base64,..."
}
```

- `audio_url` 必须是**字符串**；传 `{url, role}` 会 400：`cannot unmarshal object ... type string`。
- 当前只验证了**单个**音频参考；`reference_audio`/`audio_urls`/`audio_with_roles` 没有验证，不要发送。
- `generate_audio: true` 才会生成音轨；`false` 是静音视频。

## 限制

- 视频时长：4-30 秒；2 秒会被拒绝。
- 音频参考：本次实测 8.1 秒 mp3 可用；官方 Seedance 2.5 文档写 2-30 秒、最多 10 段/总 30 秒，但 APIMart 只验证了单段。
- 音频可通过公网 URL 或 `data:audio/...;base64,...` 提交；本地 `/voices`、`/project-assets` 需要服务端转 data URL。
- 参考音频会经过内容安全/版权审核；公开版权音频测试失败，自己生成的 TTS 通过。
- 首帧/首尾帧与音频参考按官方文档互斥；当前项目 native 模式把关键帧改为 reference_image，不送 first/last frame。

## 真实任务记录

```text
audio_url 对象 -> 400
duration=2 -> 400
duration=4 + 公开版权音频 -> failed（内容安全/版权）
duration=4 + 自己生成 TTS data URL -> completed
  task_01M5PNTV4HZ15JBM60HGX9T1MT
  4.064s / 854x480 / H.264 + AAC
  cost 0.3883
```

产物：`openspec/changes/seedance-voice-reference/evidence/seedance-native-audio-test.mp4`。

## 自检

```bash
node verify-seedance-audio-probe.mjs
```

只读 schema，不提交视频任务，不打印 Key。
