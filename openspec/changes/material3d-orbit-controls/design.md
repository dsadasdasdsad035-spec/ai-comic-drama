# Design

## Context

见 `proposal.md`。这里只记录动手前必须定下的技术选择。

现状有四件事决定做法：

1. **相机状态不在 React 里**：`createEngine.ts` 创建 `ArcRotateCamera` 并 `attachControl`，之后鼠标直接改 Babylon 对象，React 侧完全不感知。`snapshotCamera()` 只在保存机位时读一次。要做双向绑定，必须建立一条相机 → React 的通道。
2. **`onViewMatrixChangedObservable` 有重入警告**：Babylon 类型声明原文写着 "Beware of reentrance! Some methods like Camera.getViewMatrix and Camera.getWorldMatrix can trigger the onViewMatrixChangedObservable observable, so using them inside an observer will require additional logic to avoid a stack overflow error." 用它做同步源会踩进「写相机 → 触发观察 → 读相机 → 写相机」的循环。
3. **侧栏可纵向滚动**：`.m3d-rail-body` 是 `overflow: auto`，`.m3d-env-row` 已是成熟的「标签 + range + 数值」行式布局，六条滑杆沿用同一套样式不会撑破布局。
4. **场景包围盒可现算**：`Scene.getWorldExtends(predicate)` 返回所有网格的世界空间 min/max。预设里虽然存了 `footprint`，但用户手工拖过家具后就不准了，用实际包围盒更可靠。

## Goals / Non-Goals

**Goals**

- 视角参数可读、可写、不抖动。
- 套用预设后立刻看到整间屋，不依赖用户先找到「户型俯视」。
- 不同户型下都能既贴近看清单件家具、又拉远看全貌。
- 触控板可用。

**Non-Goals**

- 不引入自由相机、第一人称相机或正交投影。
- 不做机位之间的插值动画。
- 不改 `Material3dBookmark` 的数据结构，不改机位导出格式。
- 不把相机参数写进项目存档（视角只在保存机位时快照）。

## Decisions

### D1 · 同步源用 `scene.onBeforeRenderObservable`，不用 `onViewMatrixChangedObservable`

`onViewMatrixChanged` 会在读矩阵时被触发，而同步回调里必然要读相机参数（`alpha`/`beta`/`radius`/`target`）——直接构成重入。`onBeforeRender` 是场景渲染循环里的固定一跳，每帧一次，与相机是否被读取无关。

代价是每帧都跑一次比较。用 epsilon 抑制：

```
读 camera 四个值 -> 与 React state 逐项比 -> 任一差 > 1e-4 才 setState
```

静止时（画布无人操作）比较结果恒等，不产生 setState，因此不引发重渲染。

### D2 · 用「控制来源」标记仲裁，而不是靠比较跳过

如果只靠「值相同就跳过」，拖动滑杆时会出现这样的序列：

```
用户拖滑杆 -> setState(alpha=1.20)
  -> effect 写 camera.alpha=1.20
  -> 下一帧 onBeforeRender 读到 1.20
  -> 与 state 相等 -> 跳过（看起来没问题）
```

这个看起来能自洽。但实际会抖，原因是滑杆的 `onChange` 与渲染帧不同频：一帧内可能触发 3 次 `onChange`，`setState` 被批处理，而相机写入发生在 effect 里，于是中间帧读到的相机值落后于滑杆显示值，回写后又覆盖滑杆。

因此显式记录来源：

```
type SliderKey = 'alpha' | 'beta' | 'radius' | 'tx' | 'ty' | 'tz'
sliderActive: SliderKey | null

pointerdown on slider  -> setSliderActive(key)
pointerup / blur       -> setSliderActive(null)

onBeforeRender:
  if (sliderActive !== null) return   // 滑杆在控制，不回写
  ...读相机、比 epsilon、必要时 setState
```

### D3 · 拖动滑杆期间 detachControl，松手 attachControl

`camera.attachControl()` 会让相机持续消费画布上的指针事件。用户拖滑杆时指针在滑杆上，理论上画布收不到事件，但存在两个真实干扰：

- 滑杆与画布之间存在 hover/leave 时序空隙，快速拖动会漏事件。
- `wheelPrecision` 让滚轮在整页可用，拖滑杆时误滚滚轮会同时改距离。

在滑杆 `pointerdown` 时 `detachControl()`、`pointerup`/`pointercancel` 时 `attachControl(canvas, true)`，把两条输入通道彻底分开。注意 `detachControl` 后必须保证一定重新 attach —— 用 `pointerup` + `pointercancel` + `blur` 三处都兜。

### D4 · 仰角显示为 `90 - beta * 180/pi`

Babylon 的 `beta`：0 是目标正上方，π/2 是水平。用户直觉是「仰角越大越抬头」，而抬头看天在轨道相机里对应「相机低于目标」，实际不可用。

采用**俯角**语义：「仰角 90° = 从正上方往下看，0° = 平视」。这与用户说「俯视」时的理解一致，也让滑杆方向自然（拖右变大 = 更俯视）。

滑杆范围 `0..89`，映射回 `beta = (90 - elevation) * pi / 180`，`beta` 最小 `π/180 ≈ 0.017`，避开 0 处的万向锁。

### D5 · 适应视图用 `getWorldExtends` + 球面拟合，空场景不动

```
min/max = scene.getWorldExtends(m => m.metadata?.material3dObjectId)
center  = (min + max) / 2
size    = max - min
diag    = |size|
radius  = diag * 0.62         // 经验系数：让对角线完整落在 FOV 内有余量
beta    = 0.9                 // 略俯视，不顶到天顶
alpha   = 当前 alpha 保持      // 不打乱用户朝向
target  = center（y 抬到 size.y/2 附近，避免贴地）
```

`getWorldExtends` 的 predicate 只认带 `material3dObjectId` metadata 的网格，这样会排除宿主地面（`__m3d_ground`）与灯光辅助体。

空场景的判定：`getWorldExtends` 返回的 extent 为 `null` 或范围退化（`diag < 0.01`）时不动相机，`toast` 提示。

**替代方案**：直接用预设的 `footprint`。否决——用户在场景里加了一件家具、或删掉半面墙之后就不准了；而且它把「适应视图」和「预设」绑死，没有预设的场景用不了。

### D6 · 半径限制按内容浮动，仍设硬边界

`lowerRadiusLimit` 从常量 2 改为 `min(1.2, diag * 0.12)`，`upperRadiusLimit` 从 40 改为 `max(30, diag * 2.2)`。硬边界保留，避免用户滚到 0 或 1e9 造成 NaN 与画面丢失。

在适应视图时同步更新这两个 limit —— 不同户型切换后上下限随之改变。

### D7 · 滚轮精度按 pointer 类型分级

Babylon 的 `wheelPrecision` 是「滚动多少格 = 走一单位距离」的倒数关系里的一环，值越大越慢。触控板的一次双指滑动 delta 远小于鼠标一格滚轮。

做法：监听画布的 `wheel` 事件，从事件里判断 `deltaMode` 与 `deltaY` 量级：

```
|deltaY| < 40 且 deltaMode === 0  -> 视为触控板，wheelPrecision = 12
否则                              -> 鼠标，wheelPrecision = 40（保持现值）
```

不改 Babylon 内部输入，只在事件里调 `camera.wheelPrecision`。

### D8 · 套用预设后自动 fit，但书签不变

`Material3dStudio` 在 `createFromPreset` 里把场景交给 `Material3dWorkbench`。自动 fit 的时机是「对象同步完成」——即 `syncSceneFromDoc` 的 `onAfterSync` 回调里，且仅在本次场景是「刚套用预设」时执行一次。

实现上给 `Material3dScene` 加一个瞬时字段不划算（会进存档）。改用一个 ref：`autoFitPendingRef`，在场景 id 变化时置 true，首次 `onAfterSync` 完成后消费它。

**这样做的理由**：直接在 `createFromPreset` 里 fit 会早于模型加载完成，包围盒是空的。

### D9 · 相机参数不进存档

`Material3dBookmark` 已能完整表达一个视角（`alpha`/`beta`/`radius`/`target`）。当前视角是运行时状态，不存 `Material3dScene`。理由：存档只应该记录「用户刻意保存的东西」，随手滚动一下不应该改项目数据，否则每次拖动都会触发写回与 revision 增长。

## Risks / Trade-offs

- **每帧比较的开销** → 四次浮点比较 + 一次对象比对，量级远小于一帧渲染。可接受。
- **`detachControl` 后忘记 attach 会导致画布彻底不能操作** → 三处兜底（pointerup / pointercancel / blur），并在组件卸载时强制 attach 一次。
- **`getWorldExtends` 在模型未加载完时返回空** → 自动 fit 放在 `onAfterSync` 之后；用户手动点「适应视图」时若为空则提示而不是把相机推到 NaN。
- **触控板判定可能误判**（小幅滚轮被当成触控板）→ 影响只是这一步缩放更快，不会破坏状态；阈值取 40 是经验值，若实测偏差大可调。
- **半径 limit 浮动后，用户在极限位置切户型可能被 `clamp`** → 这是期望行为（新户型该有新的合理范围），但要在 fit 时先放宽 limit 再设 radius，否则会被旧 limit 截断。
- **六条滑杆占侧栏高度** → 「分镜」页签本来就有环境 + 书签两块，加上视角块后 5 个书签的预设需要滚动。接受：滑杆区做成可折叠，默认展开。

## Migration Plan

1. 不涉及数据迁移：相机参数不入存档，旧项目行为不变。
2. 部署顺序无要求：纯前端改动。
3. 回滚：恢复代码即回滚；已保存的机位书签格式未变，可继续使用。

## Open Questions

无。影响规格与任务拆分的选择已在 D1–D9 定案。
