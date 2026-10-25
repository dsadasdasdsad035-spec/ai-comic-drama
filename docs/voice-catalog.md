# 音色目录与自定义音色

## 渠道能力

| 渠道 | 动态目录 | 自定义 voice id | 应用内克隆/设计 |
|---|---|---|---|
| MiniMax | `/v1/get_voice`（system / clone / design） | 支持 | 未接入（先探测） |
| ElevenLabs | `/v1/voices` | 支持 | 账号侧创建；应用内未接入 |
| 火山 Seed TTS | 预置 speaker + 自定义 | 支持（标未验证） | 未接入（先探测） |
| APIMart | OpenAI 兼容预置 | 不支持 | 不支持 |
| macOS say | 本机已安装语音 | 不支持 | 不支持；去系统语音管理安装 |

`/api/voices` 返回 `voices + capabilities`；UI 只按 `supportsCustomVoiceId`/`supportsClone`/`supportsDesign` 显示入口。APIMart/macOS 不显示新增入口。

## 添加自定义音色

1. 设置 → 音色 → 选择当前音频模型（如 MiniMax）。
2. 点“刷新音色”读取账号/预置目录。
3. 在“添加自定义音色”填显示名、`voice_id`、备注，点添加。
4. 保存设置。
5. 角色板 → 音色下拉 → 对应渠道/“自定义”分组选择；保存角色。

自定义条目只存设置库，不写项目；角色只保存 `voiceId`（以及可选的 provider/model 校验信息）。

## 显式音色不回落

角色/镜头明确选了 `voiceId` 时，配音直接使用该 id；供应商拒绝会显示错误，不会静默换成默认音色。只有没有显式音色时才用当前渠道默认。

## 克隆/设计

当前 `/api/voices` 对 MiniMax/ElevenLabs/火山返回 `supportsClone/supportsDesign: false`，表示尚未完成接口探测与授权流程。需要克隆/设计时，先在供应商控制台创建，再把 voice_id 作为自定义音色加入。未验证接口不会被标成可用。

- ElevenLabs：设置页直接给出 [VoiceLab](https://elevenlabs.io/app/voice-lab) 入口。
- 火山：自定义 speaker 会在角色下拉里标“自定义 speaker，未验证”；供应商拒绝时显式报错，不回落默认。
- MiniMax：只读取账号里已有的克隆/设计音色，不在应用内提交克隆/设计任务。

## 自检

```bash
node verify-voice-catalog.mjs
node verify-voice-catalog-ui.mjs
node verify-voice-provisioning.mjs
```

真实 `/api/voices?modelKey=minimax-tts` 已返回 MiniMax 目录（8 个预置，来源 preset）；没有调用克隆/设计。
