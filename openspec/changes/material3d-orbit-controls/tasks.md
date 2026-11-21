# Tasks

## 1. 相机状态通道

- [x] 1.1 `createEngine.ts` 暴露 `applyCameraPose(host, pose)` 与 `readCameraPose(host)` 两个纯函数（pose = alpha/beta/radius/target xyz），供面板与同步逻辑共用；验证：单元调用 `readCameraPose` 后 `applyCameraPose` 原样写回，六项值不变。
- [x] 1.2 `createEngine.ts` 把 `lowerRadiusLimit` / `upperRadiusLimit` 从常量改为模块级可变函数 `setRadiusLimits(host, min, max)`，默认仍为 2 / 40；验证：调用后 `camera.lowerRadiusLimit` 与 `upperRadiusLimit` 等于入参。
- [x] 1.3 `createEngine.ts` 增加滚轮精度分级：监听画布 `wheel`，`|deltaY| < 40 && deltaMode === 0` 视为触控板并设 `wheelPrecision = 12`，否则设回 40；验证：派发两种 wheel 事件后读取 `camera.wheelPrecision` 分别为 12 与 40。

## 2. 视角参数面板

- [x] 2.1 `Material3dCameraPanel.tsx` 新增「视角」区块，位于环境面板之后、机位书签之前，含六条滑杆（方位角 0–360°、仰角 0–89°、距离、目标 XYZ）与三个按钮（适应视图 / 俯视 / 正视），复用 `.m3d-env-row` 布局；验证：切到「分镜」页签能看到六条滑杆与三个按钮。
- [x] 2.2 实现角度换算：`alpha` 弧度 ↔ 角度、仰角 ↔ `beta`（仰角 = `90 - beta * 180/pi`，`beta` 下限 `π/180`）；验证：`alpha = π/2` 显示 90°，`beta = π/2` 显示仰角 0°，仰角推满时 `beta > 0`。
- [x] 2.3 距离与目标坐标显示米、保留一位小数；验证：`radius = 12.04` 显示 `12.0m`。
- [x] 2.4 滑杆拖动实时写相机（不必松手才生效）；验证：拖动距离滑杆过程中连续采样 `camera.radius`，出现多个不同值。

## 3. 双向绑定仲裁

- [x] 3.1 `Material3dWorkbench.tsx` 用 `scene.onBeforeRenderObservable` 同步相机 → React state，逐项 epsilon `1e-4` 比较，无变化不 setState；验证：静止 3 秒内面板不因同步重渲染（可用渲染计数或 React DevTools 观察）。
- [x] 3.2 引入 `sliderActive` 标记：滑杆 `pointerdown` 置位、`pointerup`/`pointercancel`/`blur` 清空，置位期间跳过相机 → state 回写；验证：快速拖动方位角滑杆，滑杆位置不跳回。
- [x] 3.3 滑杆 `pointerdown` 时 `camera.detachControl()`，`pointerup`/`pointercancel`/`blur` 时 `attachControl(canvas, true)`，组件卸载时强制 attach 一次；验证：拖滑杆期间在画布上拖拽不改变视角，松手后画布恢复可拖拽。
- [x] 3.4 同步订阅在组件卸载时 `observable.remove(callback)`，避免泄漏；验证：切走「分镜」页签再切回，面板仍能跟随鼠标（未残留双重订阅导致的两倍速）。

## 4. 适应视图与快捷视角

- [x] 4.1 实现 `fitViewToContent(host)`：用 `scene.getWorldExtends(m => m.metadata?.material3dObjectId)` 取包围盒，`target = center`、`radius = diag * 0.62`、`beta = 0.9`、`alpha` 保持；验证：对 12×10m 餐厅与 6.8×8.4m 一室一厅分别调用，后者的 radius 明显更小。
- [x] 4.2 空场景或退化包围盒（`diag < 0.01`）时不动相机并 toast 提示；验证：空场景点适应视图，`camera.radius` 与 `target` 不变且出现提示文案。
- [x] 4.3 适应视图时先 `setRadiusLimits` 再设 radius，避免被旧 limit 截断；验证：从一室一厅切到餐厅后点适应视图，`radius` 不被旧上限卡住。
- [x] 4.4 「俯视」保留 `alpha`、把 beta 置为接近 0（如 `0.3`）；「正视」把 beta 置为 `π/2`、alpha 归到 `-π/2`；验证：方位角 45° 时点俯视，`alpha` 仍为 45°。

## 5. 套用预设后自动取景

- [x] 5.1 `Material3dWorkbench.tsx` 增加 `autoFitPendingRef`：场景 id 变化时置 true，首次 `onAfterSync` 后消费并执行一次 fit；验证：套用任一预设后画面显示整个户型。
- [x] 5.2 自动 fit 不修改 `sceneDoc.cameras`；验证：套用带 5 个书签的预设后，书签数与内容不变，点书签能回到预设视角。
- [x] 5.3 自动 fit 失败（包围盒为空）时不阻塞后续同步；验证：模型加载异常时只在 toast 提示，对象数仍按预设更新。

## 6. 画布提示

- [x] 6.1 画布底部提示行补上平移操作（中键拖拽 / Ctrl+左键）；验证：提示文案同时包含旋转、缩放、平移三种操作。

## 7. 回归与验收

- [x] 7.1 新增 `verify-m3d-orbit-controls.mjs`：纯函数层校验角度换算与 `fitViewToContent` 的取景数学；Playwright 层校验滑杆出现、拖滑杆改相机、拖后不抖动、适应视图对不同户型给不同距离、空场景不崩；验证：脚本退出码 0。
- [ ] 7.2 回归 `verify-material-3d-studio.mjs`（Tab/新建/书签/持久化）；验证：退出码 0，书签保存与恢复语义未变。
- [x] 7.3 回归 `verify-m3d-presets.mjs`（五套预设结构 + 真跑）；验证：退出码 0，对象数与机位数断言不受自动取景影响。
- [ ] 7.4 真机手验触控板：双指滑动一次产生可感知缩放，鼠标滚轮一格幅度不变；验证：两种输入手感差异可感知且鼠标侧未变快。**需物理触控板，无法自动化**；代码侧已实现分级（`wheelPrecision` 40/12，阈值 |deltaY|<40 且 deltaMode=0）。
- [x] 7.5 `npm run build` 与 `npx tsc --noEmit` 退出码 0。

## Workflow follow-up

- 归档前跑 `openspec validate material3d-orbit-controls --strict`。
- 归档后确认 `openspec/specs/material3d-orbit-controls/` 已生成，且 Purpose 与实现一致。
