# Tasks

## 1. 类型与持久化

- [x] 1.1 扩展 `AssetKind` 为含 `music`，`ProjectAsset` / 落库与 `assetNodesFromAssets` 渲染音乐卡；验证：`tests/asset-cards.ts` 或新建用例断言 kind 往返
- [x] 1.2 服务端接受 `assets.kind=music` 与 extra 字段（歌词、时长、引用）；验证：`npm run build:server` 后保存项目 JSON 含 music 卡

## 2. 画布入口与连线

- [x] 2.1 `BoardMenu` 拆分配音/音乐新建、`onAddMusicAsset` 默认值（`promptSource: dialogue`）；验证：纯函数或 UI 断言两入口存在
- [x] 2.2 `assetAcceptsShotPromptRef` 含 `music`，`onConnect` / 删边 / 右键与音频一致；验证：`node verify-asset-shot-prompt-ref.mjs` 增音乐用例

## 3. 生成与模型

- [x] 3.1 实现 `generateAssetMusic`，移除 `generateAssetAudio` 内音乐分支；音频下拉过滤 `!features.music`；验证：`node verify-apimart-music.mjs` + dryRun
- [x] 3.2 增加 `modelPick.music`、`defaults.music`、音乐卡 `CapModelSelect`；验证：手选音乐不影响 `modelPick.audio`（单元或脚本断言）

## 4. Inspector 与出片

- [x] 4.1 音乐 Inspector（prompt、歌词、时长、分镜引用 UI）；音频 Inspector 去掉音乐字段；验证：选中 music 节点展示音乐字段
- [x] 4.2 `collectAudioReferences` / 素材连线含 `kind=music`；验证：现有出片 payload 断言或 `verify-apimart-video-payload.mjs` 音频槽

## 5. 回归

- [x] 5.1 扩展 `verify-asset-shot-prompt-ref.mjs` 覆盖 `buildAssetAudioPrompt` → music sound_prompt 路径；全部相关 verify 脚本通过