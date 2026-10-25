# Design

## Context

`Inspector.tsx` 的「3D 调度」区有两个参考开关：`useScheduleVideoRef`（整段 3D 视频作 Seedance 参考）和 `useScheduleFrames`（调度关键帧作参考图）。两者都依赖 `scheduleReady`（调度视频是否与当前代码/选择/时长/画幅一致）和 `canVideoRef`（当前出片模型是否声明支持 `videoRef`）。

当前两个复选框的 `disabled` 条件把“不能勾上”和“不能取消”混在一起：

```tsx
// 视频参考
disabled={!d.scheduleVideo || !canVideoRef || !scheduleReady}
// 关键帧参考
disabled={videoRefOn || !scheduleReady}
```

所以只要视频过期或模型不支持，已勾上的开关就变灰，取消不了。See `proposal.md` for motivation; see the `scene-blocking-3d` delta for the required behavior.

## Goals / Non-Goals

**Goals:**

- 已开启的视频参考/关键帧参考始终可以取消，取消立即持久化，不要求重渲或删视频。
- 未开启且参考不可用时，开关仍禁用并说明原因，避免勾上一个不会被使用的参考。
- 不改变现有参考请求结构、过期规则、视频字段或文件生命周期。

**Non-Goals:**

- 不删除 `scheduleVideo` / `scheduleFrames` / `scheduleMeta` 或 `public/videos` 文件。
- 不改变 `generateVideoOne` 的 `refVideos` / `refImages` 拼装和模型能力判定。
- 不自动在模型切换时清空 `useScheduleVideoRef`；用户仍可手动取消。
- 不改 3D 工作台、聊天或视频渲染流程。

## Decisions

### 1. 禁用条件只限制“开启”，不限制“关闭”

用两个独立状态代替原来的单一 `disabled`：

```text
videoToggleAvailable = Boolean(d.scheduleVideo) && canVideoRef && scheduleReady
videoToggleEnabled   = videoRefOn || videoToggleAvailable

framesToggleAvailable = !videoRefOn && scheduleReady
framesToggleEnabled   = !videoRefOn && (Boolean(d.useScheduleFrames) || scheduleReady)
```

复选框 `disabled = !<toggle>Enabled`。这样：

- `checked = true` 时永远可点击取消；
- `checked = false` 且不可用时保持禁用，不能开启。

替代方案是保留原条件、在过期时自动清空标记；那会在用户没操作时改数据，不采用。

### 2. 提示文案区分“已开启”和“不可开启”

视频参考的 note 按顺序：

```text
!d.scheduleVideo   -> （先生成 3D 调度）
videoRefOn         -> （已开启；取消不需要重渲）
!canVideoRef       -> （当前模型不支持）
!scheduleReady     -> （${scheduleStatus}，先重新渲染）
else               -> （只参考走位/运镜）
```

关键帧参考：

```text
videoRefOn             -> （视频参考优先，抽帧已忽略）
d.useScheduleFrames    -> （已开启；取消不需要重渲）
!scheduleReady         -> （${scheduleStatus}，先重新渲染）
else                   -> （白模可能影响画风）
```

label 的 `dim` class 改为跟随 `<toggle>Enabled`，已开启的开关不再显示成灰色不可用。两处 `title` 补充“已开启时可随时取消”。

### 3. 取消只改标记，复用现有 patch 持久化

`set({ useScheduleVideoRef: false })` / `set({ useScheduleFrames: false })` 已经走 Inspector 的 `patch` → 画布节点 → `mergeProjectShots` 同步，不需要新 API 或新字段。取消后 `scheduleVideo`、`scheduleMeta`、`scheduleFrames` 和文件都保留，状态仍显示“已过期”；只是下一次出片不再带这个参考。若用户重新开启，仍需先重渲（现有 `scheduleReady` 规则不变）。

### 4. 关键帧开关的互斥保持不变

勾视频参考时仍会 `set({ useScheduleVideoRef: true, useScheduleFrames: false })`；取消视频参考不回写关键帧标记。若历史数据里两个都为 true，取消视频参考后关键帧开关会显现为已开启，用户可以继续取消；`generateVideoOne` 在视频参考关闭后才会使用关键帧，行为不变。

## Risks / Trade-offs

- [过期视频仍显示“已过期”] 取消参考不会让状态变“生效”，用户可能误以为需要重渲。→ note 明确“取消不需要重渲”，状态徽标保持真实。
- [模型不支持但标记仍是 true] 用户取消前，`generateVideoOne` 仍可能按旧逻辑发送 `refVideos`。→ 本次只解决“关不掉”；若要让不支持 `videoRef` 的模型在出片时自动忽略或提示，另开变更。
- [关键帧开关在视频参考开启时仍禁用] 这是互斥设计，不是本次要修的“关不掉”；视频参考本身可取消，取消后关键帧开关恢复可用。
- [测试依赖时间] 设置写入项目有短暂延迟。→ 验收脚本轮询 `/api/project`，不依赖固定 sleep 的最终状态。

## Migration Plan

无数据迁移。已有 `useScheduleVideoRef` / `useScheduleFrames` 保持原值；本次只改变开关的可操作性。回滚时恢复原来的 `disabled` 条件和 note 文案即可。上线前跑 `verify-reference-toggle.mjs`、`verify-video-ref-ui.mjs`、`verify-schedule3d.mjs`。
