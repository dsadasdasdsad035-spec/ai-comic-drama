# Design

## Context

见 `proposal.md`。已 apply：`canvas-image-only-card`、`canvas-image-only-batch`。`Preview.tsx` 现用 `voiceUrl ? 'tts'` 分支；`Inspector` 四 Tab 含 `audio`；`defaultTabForShot` 有图进 video。

## Goals / Non-Goals

**Goals:**

- `canvasProdMode: 'image' | 'video'` + localStorage。
- 新组件 `ShotImageDock.tsx`：prompt、refs 摘要、ratio/candCount/model（从 App 全局 state 迁入或随选中镜）、onGenerate/onCancel。
- `Inspector.tsx`：动态 `SHOT_TABS`；移除 audio 相关块；台词/表演迁至 `more`；`shotStatusChips` 去掉配音 chip。
- `Preview.tsx` / `Timeline.tsx`：段音频类型仅 `native | none`（有 video 用 native/embedded，无则 none）；不传 `voice` 给 assemble。
- vite assemble 路由：忽略客户端传来的 voice-only 段（防御）。

**Non-Goals:**

- 删除 `/api/voice` 或角色试音；删除 `voiceUrl` 字段（可闲置）。
- LipSync provider UI（随声音 Tab 移除；数据字段可只读保留）。

## Decisions

1. **出片模式卡头「生成」**：禁用并 `title` 说明「切到出图模式」，避免两套工位同时出图。
2. **模式与 Inspector tab**：切换模式时若当前 tab 不可见，自动落到该模式第一个 tab（画面或视频）。
3. **R2 彻底**：不在连播对 legacy `voiceUrl` 做 fallback；时间线去掉配音轨/超时警告或改为仅展示台词文本。
4. **Dock 位置**：画布左上工具条下方或选中栏上方浮动（与 `selbar` 不重叠）；z-index 与现有 `.tm` 一致。
5. **voice-synthesis spec**：归档时改 Purpose 为「角色试音与 TTS 渠道」，删掉镜头合成场景（与 delta 对齐）。

## Risks / Trade-offs

- **[旧项目无声]** → README 说明需重出带音轨视频；旧 TTS 不自动迁移。
- **[验收面大]** → 分 PR：模式+Dock+Inspector 先于 Preview/assemble R2，或一次改完跑四条冒烟。
- **[表演迁更多]** → 用户找台词路径变化，更多 Tab 摘要显示台词预览。

## Migration Plan

前端发布；无 DB 迁移。回滚恢复四 Tab 与 Preview tts 分支。
