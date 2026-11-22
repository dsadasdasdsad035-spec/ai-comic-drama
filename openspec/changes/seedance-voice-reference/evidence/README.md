# seedance-voice-reference evidence

## 实测：APIMart Seedance 2.5 音频参考

真实任务（用户要求测试后提交，4 秒）：

- `audio_url` 传对象 `{url, role}` → HTTP 400：
  `cannot unmarshal object into Go struct field Alias.audio_url of type string`
- 2 秒视频 → HTTP 400：
  `This model only supports duration 4-30 seconds`
- 4 秒 + 公开版权音频 → 任务创建后失败：内容安全/版权限制
- 4 秒 + 自己生成的 TTS（8.1 秒 mp3，`data:audio/mpeg;base64,...`）→ 完成：
  `task_01M5PNTV4HZ15JBM60HGX9T1MT`
  - 4.064 秒
  - H.264 854x480
  - AAC 32kHz stereo
  - cost 0.3883 / credits 3.883
  - 产物：`seedance-native-audio-test.mp4`

结论：APIMart 实际识别单个 `audio_url` 字符串，`generate_audio:true` 会产出带音频的视频；schema 未列该字段，按实测实现。视频最短 4 秒（含 4 秒），参考音频需走内容安全/版权审核。

## 实测：无音色参考也能开原生音轨（2026-11-22）

真实任务（用户明确同意后提交），payload **不含 `audio_url`**：

```json
{
  "model": "seedance-2.5",
  "prompt": "固定镜头，中景。…他缓缓转头看向镜头，平静地说：\"今天风有点大。\"声音设计：室内安静，…",
  "duration": 4,
  "size": "16:9",
  "resolution": "480p",
  "generate_audio": true,
  "watermark": false
}
```

结果：

- `task_01M81KX9X0DN2JBVBSXS9KCGY1` → `completed`，cost 0.3883
- H.264 854x480 / 4.041667s
- **AAC 32kHz stereo / 4.064s，单音轨**
- `volumedetect`：mean −28.5 dB、max −10.0 dB；`silencedetect noise=-40dB:d=0.3` 无命中
- 产物：`seedance-native-noref-test.mp4`

结论：

1. **`audio_url` 不是 `generate_audio` 的前置条件**。2026-10-24 那批探测从未测过这个组合，实现里的两道门（`server/app.ts` 与 `server/apimart.mjs` 的「生成音频必须有音色参考」）属于保守假设，不是上游限制。
2. **`duration: 4` 合法**。此前把原生门槛实现成「必须大于 4 秒」（`videoSeconds.ts` 抬到 5、`apimart.mjs` 再拒 ≤4），超出实测范围。所有成功任务都恰好是 4.064s。
3. **台词确实被说出来**（人工听感确认，2026-11-22，用户口述「有」）。提示词里写的「今天风有点大」被模型正常念出，声音由模型自行决定、不是静音也不是纯环境声。
   自动化侧只能确认音轨存在且非静音（本机无可用 ASR：`speech_transcribe` 返回 `coding plan is required`，本地无 whisper，模型不支持读视频），台词内容是用户人工听出来的。

## 导出音轨

`/api/assemble` 单 native 镜头测试：4 秒、H.264 + AAC，产物 `native-assemble-test.mp4`。证明服务端从视频输入取音轨，而不是只在前端播放。

## Mock/纯函数验证

```bash
npm run build
node verify-character-voice.mjs
node verify-character-voice-ui.mjs
node verify-native-audio.mjs
node verify-native-audio-ui.mjs
node verify-native-export.mjs
```

- `verify-character-voice.mjs`：项目往返、fingerprint、2-30 秒、失效、旧角色。
- `verify-character-voice-ui.mjs`：生成请求含 `project/purpose/voice/text`、样本落库、试听、改试音稿标 stale。
- `verify-native-audio.mjs`：APIMart 能力、单说话人、4 秒下限、失效样本、提示词、payload 单 `audio_url`/`generate_audio`、2 秒拒绝。
- `verify-native-audio-ui.mjs`：5 秒单说话人可开启并写回 `audio_mode/audio_ref`；2 秒镜头禁用。
- `verify-native-export.mjs`：`buildPlaylist` 的 native/none 选择（`tts` 分支已随 R2 退场）。

`/api/assemble` 还跑了两条混合链路：native 4s + TTS 2s（输出 6.04s，AAC）与 native + 0.5s 叠化 + TTS（输出 5.56s，AAC）；那是 R2 之前的记录，证明服务端能按镜头取音轨。当前连播/导出只认成片音轨。

UI 截图：`character-voice-ui.png`、`native-audio-ui.png`。

## 依赖与状态

- 依赖 `shot-performance-direction` 的 `performance.speaks` 和口型面板；native 与 provider 口型互斥。
- 任务完成 31/40；未完成项是 3 镜真实 A/B 的主观验收（6.4，需用户确认后提交）与第 7 组「无参考原生音频 / 4 秒边界修正」（7.1–7.8，代码尚未改）。

## 未验收 / 限制

- 已生成 3 镜真实 A/B 成片（`evidence/ab/`），每镜 4s、单音轨、成本 0.3883；机器检查通过。**音色相似度、跨镜稳定性和口型仍需要人工听/看**，自动化不能给主观结论。
- 无参考原生音频已验证「任务成功 + 非静音 AAC 单音轨 + 台词被说出」（台词由人工听确认）。**跨镜音色稳定性、口型精度未验证**；无参考时音色由模型每次决定，跨镜一致没有保障。
- 还没有实测 `audio_url` + `image_with_roles(reference_image)` 的组合；首期按参考图模式发送，需真实 A/B 验证。
- 首期只支持单说话人；多人 native 禁用。
- 角色样本生成 UI 使用 mock `/api/voice` 验证；没有跑真实角色 TTS 样本生成（会消耗 TTS 额度）。
- 参考音频必须自己生成/授权；公开版权音频已被 provider 拦截。
