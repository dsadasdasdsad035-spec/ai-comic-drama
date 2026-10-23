# Design

## Context

当前画布参考链路：

```text
右击分镜
  -> refCards = 角色卡 + 非视频素材卡
  -> refIds  = char-<角色> / asset-<素材节点> / 手工 refExtras
  -> generateOne() 只解析 char- / asset-
```

视频链路额外有两套尾帧机制：

- `tailLock` + 下一镜 `refImage` 作为 `lastFrame` 约束；
- 服务商返回 `last_frame_url`，保存到 `tailImage`，再提供「设为下一镜首帧 / 用上一镜尾帧作首帧」。

`canvas-video-api` 和 `schedule-video-reference` 这两个在途变更仍把 `last_frame` / `return_last_frame` 写进要求，因此本变更在 proposal 中声明取代它们的尾帧部分，实施前必须先协调归档。

## Goals / Non-Goals

**Goals:**

- 用户手动决定是否参考上一镜/下一镜，画面与视频使用同一份选择。
- 相邻参考解析为当前生成画面，按关系而不是固定 shot id 持久化。
- 相邻参考不破坏现有 `cut/transition` 边的视觉语义。
- 视频在 4 张参考图上限下做确定性优先级，并明确省略项。
- 删除视频尾帧约束、尾帧接龙和 `last_frame` / `return_last_frame` 请求。
- 旧 `tail_image` 数据不丢、不展示、不影响新链路。

**Non-Goals:**

- 不开放任意非相邻镜头或跨集参考。
- 不自动加相邻参考，不做递归生成。
- 不删除磁盘上的旧尾帧图片，也不重写旧项目数据。
- 不改变 `reference_image` / `reference_video` 的请求结构或 `@图像N` / `@视频N` 语义。
- 不在本变更中重构整套参考图模型；只增加相邻 token 和统一解析。

## Decisions

### 1. 相邻参考使用关系 token，不锁定 shot id

在目标镜头的 `refIds` 中增加：

```text
shot-prev
shot-next
```

而不是 `shot-<shotId>`。

理由：

- “上一镜/下一镜”是关系语义；插入或重排镜头后，用户预期它继续指向新的相邻镜头。
- 不需要在项目数据中维护一个“已不相邻”的旧 id。
- 仍复用现有 `refIds`、右键多选和持久化，不需要新字段。

**替代方案：** 存具体 `shot-<shotId>`。优点是固定住用户当时选中的那一镜；缺点是重排后容易留下不相邻引用，需要额外失效逻辑。本次不采用。

### 2. 相邻解析使用同集、按镜号数值排序

新增一个共享解析器：

```ts
type ResolvedRef = {
  token: string
  source: 'current' | 'character' | 'adjacent' | 'asset' | 'schedule-frame'
  url: string
  label: string
  kind: 'image' | 'schedule-frame'
}

resolveRefToken(token, shot, context): ResolvedRef | null
```

规则：

- 只比较同 `episode` 的镜头。
- 排序必须按镜号数值，不能用普通字符串排序；现有 `findNextShot` 的 `localeCompare` 需要改成 numeric-aware，避免 `S10` 排在 `S2` 前。
- `shot-prev` 找当前镜前一个，`shot-next` 找后一个；没有则返回 `null`。
- 源图取 `refImage`，缺失时取当前候选图；不使用 `tailImage`、视频文件或历史废弃图。
- 当前镜自身永远不进入候选；跨集不解析。

### 3. 画面和视频共用同一份参考解析，但各自上限不同

新增共享函数 `collectShotReferenceImages(shot, options)`，返回有序的 `ResolvedRef[]`，再由两个生成入口决定上限：

```text
AI 画面:   当前 refImage + 有序参考，最多 10 张
视频出片:  当前 refImage + 有序参考，最多 4 张
```

参考优先级：

```text
1. 当前镜 refImage（当前画面）
2. 角色图
3. shot-prev / shot-next
4. 场景 / 道具 / 普通素材
5. 3D 调度关键帧（仅用户显式勾选）
```

理由：

- 视频的人物一致性和当前构图比相邻分镜更关键；相邻分镜是构图/连续性补充。
- 画面生成上限更宽，可以尽量带上所有选择。
- 同一份解析器避免 `generateOne` 与 `collectRefImgs` 继续各自实现一份 char/asset 逻辑。

超过上限时返回 `used` / `omitted` 两部分；UI 必须显示省略项，不能只在内部截断。

### 4. 相邻参考不新增参考边

相邻镜头之间已有 `cut/transition` 边；再画 `ref-` 边会重叠。

- `refEdges` 只为角色/素材参考继续画边。
- `shot-prev` / `shot-next` 通过以下方式表达：
  - 右键参考菜单的勾选；
  - Inspector 的参考摘要；
  - 目标镜头卡片上的小徽标（如「↑S01 / ↓S03」）。
- 叙事边保持原样，不参与参考状态判断。

**替代方案：** 为相邻参考画第二条曲线。视觉上会和叙事边重叠，且用户难以区分“剪辑关系”和“参考关系”；不采用。

### 5. 视频模式收敛为三种，不再有尾帧分支

```text
无参考图、无参考视频:  first_frame
有 1~4 张参考图:       reference_image
有 reference_video:    reference_video + 可选 1~4 张 reference_image
```

- 首帧模式只使用 `first_frame`，不再有 `last_frame` 约束。
- 参考图/参考视频模式不再需要与尾帧互斥判断。
- `camera_fixed` 的现有规则不变；参考视频模式继续不发送它。
- `return_last_frame` 不再发送，成功后不下载尾帧。

相邻参考会像角色/素材一样把镜头推入 `reference_image` 模式；这是显式选择的结果，不是隐式切换。Inspector 应在选中相邻参考时提示“本次出片使用参考图模式”，避免用户误以为仍是首帧模式。

### 6. 参考图编号以实际请求顺序为准

当前 `generateOne` 的 `图N` 编号在“没有当前 refImage”时容易从 2 开始，加入相邻参考后会放大错误。

规则：

- 先构建最终图片数组，再按数组下标生成标签。
- AI 画面：`refImage` 在数组第 1 位时，额外参考从 `图2` 开始；没有 `refImage` 时从 `图1` 开始。
- 视频：按实际 `reference_image` 顺序生成 `[图N]` 或 `@图像N`；相邻参考必须带明确语义，例如「分镜 S01 画面」。
- 超出上限被省略的参考不进入编号，也不出现在提示词里。

### 7. 尾帧功能完整移除

客户端：

- 删除 `tailLock`、`findNextShot`、`findPrevTail`、`tailToNext`、`prevTailToMe`。
- 删除 Inspector 的尾帧约束开关、尾帧预览、接龙按钮、相关 props/CSS。
- 删除 `generateVideoOne` 的 `wantLock`、`tailConstraint`、`useTailConstraint`、`lastFrame`、`returnLastFrame`、`done.tail` 写入和尾帧 toast。

数据/类型：

- 删除 `ShotData.tailImage`、`ProjectShot.tail_image` 的新读写和 `shotSync` 映射。
- 旧 `tail_image` 继续留在 SQLite `shots.extra`，不主动清理；新代码不读取、不展示。
- 删除 `VideoOpts.lastFrame` / `returnLastFrame`。

服务端：

- `/api/seedance` 不再解析 `lastFrame` / `returnLastFrame`。
- `buildVideoPayload` 删除 `lastFrame` / `returnLastFrame` 参数和 `return_last_frame` 输出。
- 任务完成只下载视频；不再保存尾帧。`downloadVideoArtifacts` 的尾帧参数和返回字段删除。
- 不改变 `reference_image` / `reference_video` 的 content 结构。

### 8. 在途变更协调

`canvas-video-api`：

- spec 的「尾帧约束与参考图互斥」、终态返回尾帧、尾帧下载要求需要删除或改写。
- tasks 里的 `verify-tail.mjs`、尾帧落盘验收需要移除。

`schedule-video-reference`：

- spec 中「仍返回尾帧」「下一镜接龙」的要求需要删除。
- design 中 `return_last_frame` 保留说明需要更新。

本变更不直接修改这两个变更目录；tasks 把“先修订/归档这两个变更”作为实施前置。否则它们归档后生成的 `video-generation` / `schedule-video-reference` 主 spec 会与本变更冲突。

## Risks / Trade-offs

- **相邻关系随重排变化** → 这是关系语义的选择；用户如果希望锁定某一镜，应使用角色/素材卡片或后续单独设计固定 id 参考。UI 文案明确“上一镜/下一镜”而不是具体镜号锁定。
- **下一镜常常还没出图** → 置灰并提示；批量出图不会递归生成下游镜头。
- **视频 4 张上限导致相邻图被省略** → 固定优先级 + 明确列出 omitted，不能静默截断。
- **选中相邻参考会切换视频模式** → Inspector 提示当前出片使用 reference_image；用户可取消相邻参考回到首帧模式。
- **旧尾帧数据留在 SQLite** → 不读取、不删除；下次保存不会重写该字段，回滚时仍可找回。
- **在途变更冲突** → 这是本变更最大的流程风险；实施前必须先修订/归档两个旧变更，否则主 spec 会发生矛盾。
- **参考图 label 与请求顺序错位** → 统一“先构建数组、再生成标签”的顺序，测试覆盖无当前 refImage 和有当前 refImage 两种情况。

## Migration Plan

1. 先协调 `canvas-video-api` 和 `schedule-video-reference`：删除尾帧要求，或先归档后在新变更中修订主 spec。
2. 加共享参考解析器和 `shot-prev` / `shot-next` token；旧 `refIds` 数据无需迁移。
3. 接右键菜单、勾选/徽标/Inspector 摘要；下一镜未出图置灰。
4. 接 `generateOne` 和 `generateVideoOne`，实现 10/4 上限、优先级和 omitted 提示。
5. 删除视频尾帧 UI、数据字段、请求字段和服务端下载；保留旧 SQLite 数据。
6. 退役/更新尾帧测试，新增相邻参考、无尾帧请求、参考视频模式、旧项目兼容回归。
7. 完成后归档本变更；若旧变更尚未处理，先完成协调再归档。

回滚：旧尾帧数据未被删除；恢复旧代码后仍可读取 `tail_image`。新增的 `shot-prev` / `shot-next` token 对旧代码是未知 refIds，会被忽略，不破坏镜头数据。

## Open Questions

无。视频参考优先级和尾帧删除范围已确定；在途变更的协调作为实施前置，不改变本设计。
