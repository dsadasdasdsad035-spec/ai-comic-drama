# Proposal: shot-clip-frame-assets

## Why

转场链路已能从两镜成片抽取首尾帧，但结果只写在转场 `generated.boundary` 的临时 `/generated/sched-*.jpg` 上，无法作为画布素材卡参与分镜 `refIds` 与连线参考。邻镜 token `shot-prev` / `shot-next` 仍解析静帧/关键帧，不能表达「上一镜成片尾帧」的连续性。用户需要在分镜侧把成片首/尾帧物化为素材卡，并让下一镜一键引用上一镜尾帧，且成片重出后同一溯源槽位自动覆盖而非堆积过期卡。

## What Changes

- 分镜检查器（有成片时）提供「抽首帧 / 抽尾帧 → 素材卡」，走与现有手工素材相同的 `ProjectAsset` + 画布 `asset-<canvasId>` 落库路径。
- 同一镜、同一角色（`sourceShotId` + `frameRole: head|tail`）最多一张溯源素材卡；再次抽取或成片更新后 **覆盖** 该卡图片 URL 与指纹，保留画布位置与 `canvasId`。
- 「引用上一镜尾帧」：从同集上一镜成片抽尾帧（或复用已存在的同源卡），将对应 `asset-*` 写入本镜 `refIds`（可选自动连线）；**不**改变 `shot-prev` 仍表示上一镜静帧/关键帧的语义。
- 抽帧实现复用 `/api/frames` 与转场侧首尾帧逻辑（含近黑非阻断提示）；转场 boundary 行为不变（本变更不强制与素材卡 URL 共用）。
- Agent（可选 P1）：与画布等价的「发布成片帧素材 / 链接上一镜尾帧」内置工具。

非 **BREAKING**：不修改 `shot-prev`/`shot-next` 解析规则；不修改转场出片输入契约；`ProjectAsset` 仅增可选字段。

## Capabilities

### New Capabilities

- `shot-clip-frame-assets`：从分镜成片抽取首帧或尾帧并发布为画布素材卡；溯源幂等与覆盖；下一镜引用上一镜尾帧为素材参考。

### Modified Capabilities

- `asset-canvas-publishing`：扩展「发布必须幂等」的适用面——成片帧溯源卡（`sourceShotId` + `frameRole`）与设定卡 `designId` 同级，重复发布 MUST 更新而非新增。
- `shot-inspector-layout`：成片预览区增加成片帧素材操作入口及状态/错误展示。

## Impact

- `src/transitionGen.ts` 或新建共享模块：抽出 `videoFrames` 供分镜与转场共用。
- `src/App.tsx`：`newAssetCard` / `ensureAssetCanvasIds` / `patchProject` 扩展溯源字段；`refIds` 写入。
- `src/Inspector.tsx`（或成片区块子组件）：抽帧按钮、上一镜尾帧引用、近黑提示。
- `src/api.ts`：`ProjectAsset` 类型可选字段。
- `src/agent/builtinPlatformTools.ts` 或 `shotVideoHarnessTools.ts`（可选）：Agent  parity。
- 测试：`verify-*` 或 Vitest 覆盖幂等覆盖、`refIds` 写入、无成片/无上一镜拒绝。