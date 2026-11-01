# Tasks

## 1. 解析与 API

- [x] 1.1 在 `src/characters.ts` 或 `voiceCatalog.ts` 增加 `resolveCharacterAudioModelKey(character, settings)` 及按 modelKey 取 provider 的辅助函数；在 `tests/` 增加单元用例覆盖「有 voiceModelKey / 仅默认 / 空」三种回落。验证：`npx tsx tests/...` 通过。
- [x] 1.2 扩展 `/api/voice` 多行循环：每行支持可选 `lines[i].modelKey`，缺省用 `body.modelKey`；单句路径不变。验证：对两行不同 modelKey 的 POST 分别命中对应 provider（可用 mock 或日志断言）。
- [x] 1.3 更新 `resolveVoiceForSpeaker`（及调用方）使渠道校验使用 **该行角色** 的模型 provider，而非全局 `audioModelKey`。验证：单元测试 — MiniMax 角色 + 火山全局默认时不应误报（若仍用旧全局逻辑会失败）。

## 2. 镜头配音与 App 状态

- [x] 2.1 重写 `App.generateVoiceOne`：每行解析 `modelKey` 与 voice，请求体带 `lines[].modelKey`；`voiceMeta` 记录实际使用的模型信息。验证：画布两角色两渠道的一镜配音成功且 `voiceUrl` 可播。
- [x] 2.2 调整 App 层 `listVoices`：按 modelKey 缓存；移除或收窄仅服务 Inspector 的全局 `audioModelKey` effect（角色板按需拉取）。验证：切换角色模型时不串其他渠道音色。
- [x] 2.3 `Inspector` 移除「配音模型」手选，改为只读说明（按角色绑定）；无角色映射时仍用 `defaults.audio`。验证：Inspector 无 `CapModelSelect` audio，生成配音仍成功。

## 3. 角色板 UI 与样本

- [x] 3.1 `CharacterCard` 音色页增加 `CapModelSelect cap="audio"`，绑定 `voiceModelKey`；改模型时刷新该卡音色列表并校验 provider。验证：角色板选火山后音色列表仅火山条目。
- [x] 3.2 删除 `CharacterBoard` 向子组件传递 `settings.defaults.audio` 的错误 wiring；样本生成 `generateSample` 使用 `resolveCharacterAudioModelKey`。验证：画布手选与设置默认不一致时，样本请求 modelKey 仍跟角色。
- [x] 3.3 选音色时继续写入 `voiceProvider` / `voiceModelKey`；模型变更导致 stale 时 UI 提示与 spec 一致。验证：改模型后样本显示 stale 警告。

## 4. 文档与回归脚本

- [x] 4.1 更新 README 角色音色小节：模型跟角色、设置页仅默认与音色库。验证：文档描述与 UI 一致。
- [x] 4.2 更新 `verify-providers.mjs` / 相关 UI 脚本：断言角色板配音模型与 per-line modelKey；修复因 Inspector 移除下拉而失败的步骤。验证：`node verify-providers.mjs`（或项目等价命令）通过。
- [x] 4.3 运行 `npm run build` 与 `openspec validate character-per-voice-model --strict`。验证：构建与 strict 校验通过。

## Workflow follow-up

- 用户确认行为后执行 `/opsx-archive` 归档 change。
