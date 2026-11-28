# Tasks

## 1. 模型与连线

- [x] 1.1 `sourceShotIds` 落库与 `onConnect`/`refEdges`/删边逻辑，验证：`verify-asset-shot-prompt-ref.mjs`

## 2. 音频生成

- [x] 2.1 `buildAssetAudioPrompt` + `generateAssetAudio` 合并文案，验证：纯函数断言请求文本

## 3. 与字幕卡集成

- [x] 3.1 字幕填充读取 `sourceShotIds`（依赖 `canvas-subtitle-card` 面板），验证：同一 verify 脚本或联调场景