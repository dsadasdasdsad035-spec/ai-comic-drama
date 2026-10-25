# voice-catalog-management evidence

进度：21/25。未勾选 3.2 / 3.5 / 3.6 / 4.3（应用内克隆/设计、创建失败重试、授权成本确认）。

## 已完成

- `/api/voices` 支持 `refresh=1`、provider/model/key 缓存、`voices + capabilities + error`。
- MiniMax 目录：真实 `/v1/get_voice` 返回 8 个预置音色（来源 preset）；没有调用克隆/设计。
- ElevenLabs 动态账号目录；火山预置 + 自定义 speaker；APIMart/macOS 能力边界。
- 设置页「音色」：刷新、分组、试听、添加/删除自定义 voice_id、保存设置。
- 角色下拉按渠道/来源分组；旧 voiceId 保留为未知；选择时记录 provider/model。
- 显式 voiceId 优先；provider 不匹配报错；未指定才用默认。
- 自定义音色可用于角色音色样本和 Seedance native 参考。

## 测试

```bash
npm run build
node verify-voice-catalog.mjs
node verify-voice-catalog-ui.mjs
node verify-voice-provisioning.mjs
node verify-character-voice-ui.mjs
node verify-voice-performance.mjs
node verify-native-audio.mjs
node verify-native-audio-ui.mjs
node verify-lipsync.mjs
node verify-export.mjs
```

`verify-voice-catalog-ui.mjs` 截图：`voice-catalog-ui.png`。

## 未完成/未验收

- MiniMax/ElevenLabs/火山的应用内克隆/设计接口尚未探测和接入；能力标记为 false，不显示假入口。
- 克隆/设计授权、成本和真实试听未执行。
- APIMart `gpt-4o-mini-tts` 没有自定义/克隆能力，保持预置。
- macOS 只能使用系统已安装语音。
- 真实 `/api/voices?modelKey=minimax-tts` 已验证目录返回；没有执行任何克隆/设计付费调用。

## 边界

- 不改 `voice-synthesis` 的渠道合成协议；显式 voice 透传，失败不回退。
- 自定义音色存设置库；项目只保存角色 `voiceId`/provider/model。
- 与 `seedance-voice-reference` 兼容：角色音色样本使用同一 voiceId 解析。
