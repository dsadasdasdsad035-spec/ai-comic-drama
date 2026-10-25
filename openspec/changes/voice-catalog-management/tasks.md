# Tasks

## 1. 统一音色目录与渠道 adapter

- [x] 1.1 在 `src/api.ts` 增加 `VoiceSource`、`VoiceEntry`、`VoiceCapabilities`，扩展 `VoiceOption`/`VoiceList` 并保持旧 `{id,label}` 调用兼容；验证：`npm run build` 通过，旧 `voiceId` 读写不受影响。
- [x] 1.2 在 `vite.config.ts` 把 `/api/voices` 改成 adapter 分发：返回 `{provider, providerKind, modelKey, voices, capabilities, error?}`，支持 `refresh=1`、按 provider+model+key 指纹缓存；验证：`verify-voice-catalog.mjs` mock 覆盖成功/刷新/缓存/鉴权失败/空目录。
- [x] 1.3 新增 MiniMax speaker adapter：调 `/v1/get_voice` 合并 system/voice_cloning/voice_generation，映射来源；接口失败时回退现有 4 个预置并带错误；验证：mock 覆盖三类音色、401、空账号。
- [x] 1.4 新增 ElevenLabs adapter：保留 `/v1/voices`，补 provider/model/source/capabilities（list、custom、clone、design、preview）；验证：mock 覆盖账号音色、无 Key、401。
- [x] 1.5 新增火山 speaker adapter：有列表接口时列出 speaker，没有时允许“自定义 speaker id/未验证”；移除 `server/volc-tts.mjs` 对显式自定义 speaker 的强制回落；验证：mock 列表/空账号/自定义 id/供应商拒绝。
- [x] 1.6 为 APIMart 和 macOS 返回能力描述：APIMart 只列预置、`supportsCustomVoiceId/Clone/Design=false`；macOS 只列本机语音、不可创建；验证：mock 断言能力标记和空态文案。
- [x] 1.7 更新 `README`/`docs` 的音色渠道能力矩阵；验证：文档与 `/api/voices` 返回一致。

## 2. 自定义音色与角色选择

- [x] 2.1 在 `AppSettings` 增加 `customVoices`，服务端 `normalizeSettings`/`saveAppSettings`/设置页 hash 完整往返；验证：`verify-voice-catalog.mjs` 覆盖新增/删除/重载/旧设置无字段。
- [x] 2.2 设置页新增「音色管理」：按渠道筛选、刷新、来源分组、添加/删除自定义条目、试听；不支持自定义的渠道隐藏新增入口并显示原因；验证：`verify-voice-catalog-ui.mjs` 覆盖添加/删除/刷新/无 Key/不支持。
- [x] 2.3 `CharacterBoard` 音色下拉改为 `<optgroup>` 合并目录、自定义和旧 `voiceId`；旧值不在目录时保留为“未知/保留原值”；选择时保存 `voiceId` 和可选 `voiceProvider`/`voiceModelKey`；验证：UI 用例覆盖预置/自定义/旧值/切渠道。
- [x] 2.4 `App.generateVoiceOne` 与 server TTS 改为显式音色不回落：自定义/账号音色原样发送；provider/model 不匹配时明确报错；只有未指定音色时用默认；验证：`verify-voice-catalog.mjs` 覆盖有/无显式 id、provider 不匹配、供应商拒绝。
- [x] 2.5 角色音色样本与 Seedance native 参考复用同一音色解析：自定义音色生成的样本可用于 native；验证：`verify-character-voice.mjs`/`verify-native-audio.mjs` 回归，样本 voiceId 与目录一致。
- [x] 2.6 更新 README 角色/音色管理说明；验证：按文档能添加一个自定义 id、选中角色并试听。

## 3. 音色创建能力

- [x] 3.1 定义 `supportsClone`/`supportsDesign` 能力门：UI 只在 true 时显示克隆/设计入口；APIMart/macOS 显示“不支持应用内创建”；验证：`verify-voice-provisioning.mjs` mock 能力矩阵。
- [ ] 3.2 MiniMax 克隆/设计 adapter：先做能力探测（端点、样本时长/格式、计费），支持克隆/设计后刷新目录并标来源；真实提交前确认和授权；验证：mock 成功/401/超时/未授权，不产生真实调用。
- [x] 3.3 ElevenLabs 创建边界：若当前接口支持应用内创建/克隆则接入；否则只给账号控制台说明；验证：mock 覆盖“有创建接口/只有列表”两种。
- [x] 3.4 火山 speaker/克隆边界：能列 speaker 就动态列出；支持克隆时走授权流程；否则允许自定义 speaker id 并标“未验证”；验证：mock 列表/克隆/自定义/失败。
- [ ] 3.5 创建失败/超时/权限错误保持目录不变，显示重试；成功后刷新目录；验证：UI/纯函数用例覆盖失败不新增、成功后出现。
- [ ] 3.6 授权与成本：克隆/设计提交前展示样本/描述、渠道、成本或耗时，记录来源/授权；不在批量配音或后台自动提交；验证：UI 用例断言确认前任务数为 0。

## 4. 测试与文档

- [x] 4.1 新增 `verify-voice-catalog.mjs`（纯函数/服务端 adapter mock）覆盖目录、能力、缓存、自定义、显式不回落。
- [x] 4.2 新增 `verify-voice-catalog-ui.mjs` 覆盖音色管理、角色下拉分组、刷新、添加/删除、未知旧值。
- [ ] 4.3 新增 `verify-voice-provisioning.mjs` 覆盖各渠道创建/不支持/失败/授权确认，全部 mock。
- [x] 4.4 运行 `npm run build`、`node verify-voice-performance.mjs`、`node verify-character-voice*.mjs`、`node verify-native-audio*.mjs`、`node verify-lipsync*.mjs`、`node verify-export.mjs`；验证：全部通过，旧预置音色和默认回落路径不回退。
- [x] 4.5 更新 evidence/README：目录能力矩阵、mock 证据、真实探测/创建未执行项、授权和回滚说明。
- [x] 4.6 写清楚与 `voice-synthesis`/`seedance-voice-reference` 的边界：本变更不改合成协议；自定义音色需同时可用于角色音色样本。

## 未完成项

- 3.2 / 3.5 / 3.6 / 4.3 保持未勾选：应用内 MiniMax 克隆/设计、创建失败重试、授权成本确认尚未接入。`verify-voice-provisioning.mjs` 只覆盖能力门和不支持分支，不伪造创建成功。
- 当前 21/25；未验证的克隆/设计接口不会把 `supportsClone/supportsDesign` 标成 true。

## Workflow follow-up

- 真实 MiniMax/ElevenLabs/火山音色列表与克隆/设计接口必须先探测；未验证的接口不要把 `supportsClone` 标成 true。
- 真实克隆/设计/试听可能产生费用或涉及授权，自动化测试只使用 mock；提交前按现有付费确认规则执行。
- 归档前运行 `openspec validate voice-catalog-management --strict`，同步 `voice-catalog` / `voice-provisioning` 主 specs。
