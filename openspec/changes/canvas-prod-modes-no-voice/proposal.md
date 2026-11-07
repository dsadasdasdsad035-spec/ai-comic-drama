# Proposal

## Why

画布出图与出片虽已从卡脚/批量入口拆开，但用户仍要在同一 Inspector 里切换「画面 / 视频 / 声音」，默认有图即进视频，且镜头 TTS 与成片音轨双线并存。产品决策为：**画布用「出图 | 出片」两种模式分离工位**；**去掉镜头 TTS（声音 Tab）**；连播与导出 **R2：只使用成片视频音轨**（含 Seedance 原生音频），不再混 `voiceUrl`。

## What Changes

- **画布生产模式**：顶栏/画布工具条提供 `出图 | 出片` 切换（可持久化）；出图模式显示 **Image Dock**（画面提示词、参考摘要/选图、画幅/张数/模型、生成/取消）；出片模式隐藏 Dock。
- **Inspector 随模式显隐**：出图模式仅 `画面` + `更多`；出片模式仅 `视频` + `更多`；**移除 `声音` Tab**、配音 chip、吸底「生成配音」及口型/provider 镜头 UI。
- **台词与表演**：从原声音 Tab 迁至 **`更多`**（编辑台词、表演方向仍影响出片提示词与字幕文本；不再触发 TTS）。
- **播放与导出 R2**：连播与时间线 **MUST NOT** 播放或优先 TTS；导出 `assemble` **MUST NOT** 将 `voiceUrl` 作为音轨；每镜有声仅来自 `videoUrl`（含 native）。旧项目仅存 `voiceUrl` 而无视频时按无声处理。
- **保留**：角色卡声线/试音（供 native 参考）；视频 Tab 原生音频与出片；`generateVoiceOne` API/后端可保留供角色试音或遗留脚本，但镜头工作台无入口。
- **不做**：顶栏第三模式「声音」；D3 卡面去掉视频预览；镜头表批量 TTS。

## Capabilities

### New Capabilities

- `canvas-prod-mode`：画布出图/出片模式切换、Image Dock、Inspector Tab 显隐契约。
- `shot-playback-audio`：连播/导出音轨来源（仅成片视频；R2 明确禁止镜头 TTS）。

### Modified Capabilities

- `voice-synthesis`：范围收窄为角色试音与渠道配置；移除「镜头 Inspector 生成台词配音」相关 MUST。
- `storyboard-shot-card`：与模式、Dock 一致（卡头出图与 Dock 配置同源）。

## Impact

- 前端：`App.tsx`、`ShotImageDock`（新）、`Inspector.tsx`、`inspectorLayout.ts`、`Preview.tsx`、`Timeline.tsx`、`CharacterCard.tsx` 文案、`ShotNode` 可选去掉 `shot-voice` 角标或改为无关 TTS。
- 服务端：导出/assemble 路径忽略 TTS 段（若在前端已不传则后端防御性忽略）。
- 文档：`README` 连播/配音章节重写；`DEPLOY-CHECKLIST` 若引用镜头 TTS 验收则更新。
- 验收：`verify-shot-inspector`、`verify-voice`、`verify-preview-captions`、`verify-export` 等批量调整。
- 依赖：建议 `canvas-image-only-card`、`canvas-image-only-batch` 已 apply 后再做，减少冲突。

## 用户已确认

- D2（模式切换），非 D1-only Dock。
- 删声音 Tab；R2 连播/导出不用 TTS；成片自带声音为主路径。
