# Design

## Context

见 `proposal.md`。实现上，`buildShotVideoRequest` / `collectComposerRefs`（`src/videoPrompt.ts`）在存在 `refImage` 时无条件插入「当前画面构图」；`App.tsx` 的 `generateOne` 在出图成功后将 URL 写入 `refImage` 且通常带 `project` 落盘，但用户未建素材卡即可被视频消费。素材选择器已有「生成图片」类目（`listMedia` / `MediaPicker`）。

## Goals / Non-Goals

**Goals:**

- 出图产物稳定进入项目媒体并在选择器中可见；不自动建卡、不自动 `refIds`。
- 视频附件清单与 API 请求不再读取 `refImage`，仅 `collectShotReferences` + 表情/视频/原生音色。
- 保留 `refImage` 作镜上预览与 Seedream 出图输入（含标注合成、多参考出图）。
- 更新 blocking：`no-image` / `native-no-image` 指向「连线角色或图片素材（或邻镜 token）」。

**Non-Goals:**

- 一键「把 refImage 发布为素材卡」或批量迁移旧镜（可后续变更）。
- 改 `/api/seedance` 协议或 `ShotData` 字段删除。
- 镜头表 `keyframe` 与画布同步策略大改（仍可与 `refImage` 预览对齐）。

## Decisions

1. **预览与视频参考分离（字段复用）**  
   - 决策：继续用 `refImage` / `candidates` 存静帧预览，不在视频拼装中映射为 `kind: current`。  
   - 备选：新增 `previewImage` 字段 —— 增加迁移与双写，否。

2. **出图落盘**  
   - 决策：画布 `generateOne` 生成时 **必须** 传 `project`，确保持久化为 `/project-assets/...`；仍写 `refImage` 便于预览。  
   - 备选：仅写媒体库不写 refImage —— 与用户仍要看镜上候选冲突，否。

3. **首帧模式 / 原生音频**  
   - 决策：去掉 `refImage` 作 `firstFrame` 与 native 空集合兜底；无连线则 blocking。用户若要用静帧，须从选择器把同 URL 挂到素材卡并连线（或邻镜 token）。  
   - 备选：保留 opt-in 开关 —— 用户已选方案 2 全手动，否。

4. **相邻镜**  
   - 决策：`SHOT_PREV` / `SHOT_NEXT` 仍解析邻镜 `refImage` URL，作为 **显式** 相邻参考项进入 `collectShotReferences`，不依赖本镜 `refImage`。  
   - 标签保持「上一镜/下一镜画面」。

5. **指纹与手改**  
   - 决策：`fingerprintOf` 的 `current` 字段可保留记录 `refImage`（影响手改过期提示），但 `refs` 候选列表不再含 current。  
   - 实现时注意预览变更不应假装改变了视频附件。

## Risks / Trade-offs

- **[Breaking] 仅出图未连线的镜无法直接出片** → 文档与面板 blocking 写清；README 示例改流程。  
- **[用户多一步]** 静帧要进视频须建素材卡 → 与方案 2 一致；选择器「生成图片」降低摩擦。  
- **[旧 dataURL refImage]** 仍在预览但不进视频 → 若未落库则无法作素材 URL，用户需重出或上传。  
- **[测试]** `verify-video-ref-api` 等假设图1=当前画面 → 随 tasks 更新断言。

## Migration Plan

- 无自动数据迁移。  
- 发布说明：**BREAKING**——依赖「有 refImage 即可出片」的工作流须改为连线。  
- 回滚：恢复 `collectComposerRefs` 推入 refImage 即可还原行为（单文件域）。

## Open Questions

- Inspector 默认 Tab（有 preview 无连线）是否仍默认「视频」：可保持，blocking 在 Tab 内可见即可。
