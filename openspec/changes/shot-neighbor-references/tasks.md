# Tasks

## 1. 相邻参考解析与数据

- [x] 1.1 新增共享参考解析器，支持 `shot-prev` / `shot-next`，按同集、镜号数值排序解析当前相邻镜头；验证：Node 用例覆盖 S2/S10 排序、首镜无上一镜、末镜无下一镜、不跨集、不自引用。
- [x] 1.2 实现相邻参考的当前画面解析：优先 `refImage`，没有时取当前候选图；验证：用例覆盖首帧、候选切换、无图、文件缺失。
- [x] 1.3 确认 `refIds` 关系 token 随镜头持久化，刷新/重排后仍解析到当前相邻镜头；验证：保存/重读和插入镜头后的解析用例。
- [x] 1.4 新增 `verify-neighbor-refs.mjs` 的纯函数部分，覆盖 token、排序、缺失、自引用和重排；验证：`node verify-neighbor-refs.mjs` 全部通过。

## 2. 画布与 Inspector 选择

- [x] 2.1 扩展参考候选：只加入同集上一镜/下一镜且已有当前画面；排除目标镜头；素材卡和角色卡保持原行为；验证：画布用例断言只出现相邻两项。
- [x] 2.2 相邻候选显示「上一镜 S01 / 下一镜 S03」和分镜缩略图；下一镜无图置灰并提示；验证：Playwright 覆盖有图/无图/取消。
- [x] 2.3 相邻参考通过 `refIds` 勾选，不新增并行参考边；目标卡片或 Inspector 显示参考摘要；验证：画布边数量不变，摘要随勾选更新。
- [x] 2.4 检查现有 `首帧` 动作对相邻候选可用，且不会把目标镜头自己列出来；验证：点击相邻参考的「首帧」只更新当前镜头。
- [x] 2.5 在 `verify-neighbor-refs.mjs` 增加 UI 用例：手动选择、不自动、下一镜未出图、取消、重开恢复；验证：脚本通过。

## 3. AI 画面生成

- [x] 3.1 `generateOne` 改用共享参考解析器，加入相邻参考；验证：拦截 `/api/seedream` 断言上一镜/下一镜图片进入 `refImages`。
- [x] 3.2 实现 AI 画面 10 张上限、优先级和省略清单；验证：超限时不静默丢图，界面显示未使用参考。
- [x] 3.3 修正 `图N` 编号：先构造最终图片数组，再按最终顺序生成标签；验证：有/无当前 `refImage` 两种请求的编号与图片顺序一致。
- [x] 3.4 在 `verify-neighbor-refs.mjs` 覆盖 AI 画面：相邻参考、超限、遗漏提示、编号、取消参考后不再发送；验证：脚本通过。

## 4. 视频生成与尾帧移除

- [x] 4.1 `collectRefImgs` / `generateVideoOne` 改用共享解析器；相邻参考按“当前画面 → 角色 → 相邻 → 场景/道具 → 调度关键帧”排序，最多 4 张；验证：请求断言和超限提示。
- [x] 4.2 选中相邻参考时明确提示视频进入 `reference_image` 模式；参考视频模式保持 `reference_video` + 1~4 张 `reference_image`；验证：两种模式的请求体断言。
- [x] 4.3 删除 Inspector 尾帧约束开关、尾帧条、上一镜尾帧按钮和相关 props/CSS；验证：Inspector 不再出现 `.tail-row` 或尾帧文字。
- [x] 4.4 删除 `tailLock`、`findNextShot`、`findPrevTail`、`tailToNext`、`prevTailToMe` 及 `generateVideoOne` 中的 `lastFrame` / `returnLastFrame` / `done.tail`；验证：`rg "lastFrame|returnLastFrame|tailImage|tailToNext" src` 不再有生成链路引用。
- [x] 4.5 删除 `ShotData.tailImage`、`ProjectShot.tail_image`、`shotSync` 映射和 `VideoOpts.lastFrame` / `returnLastFrame`；旧 SQLite `tail_image` 不读取不删除；验证：`npx tsc --noEmit` 通过，旧项目打开不崩。
- [x] 4.6 删除服务端 `/api/seedance` 的 `lastFrame` / `returnLastFrame` 解析、`buildVideoPayload` 的 `last_frame` / `return_last_frame` 输出和尾帧下载；验证：`verify-video-api.mjs` 或新 mock 用例断言请求无尾帧字段。
- [x] 4.7 在 `verify-neighbor-refs.mjs` 覆盖视频：相邻参考、4 张上限、省略提示、首帧/参考图/参考视频三模式、请求不含尾帧字段；验证：脚本通过。
- [x] 4.8 新增旧项目兼容用例：带 `tail_image` 的 fixture 打开、保存、出片均不展示/发送尾帧，旧视频保留；验证：脚本通过。

## 5. 文档与回归

- [x] 5.1 更新 README：参考菜单说明手动上一镜/下一镜、视频 4 张优先级、参考视频协议、删除尾帧/接龙和旧数据处理；验证：文档步骤与 UI/请求行为一致。
- [x] 5.2 退役 `verify-tail.mjs` 或改为断言“无尾帧 UI/字段”；更新 `verify-schedule3d.mjs`、`verify-video-api.mjs`、`verify-video-ref-ui.mjs`、`verify-video-ref-api.mjs` 的尾帧断言；验证：相关脚本全部通过。
- [x] 5.3 回归 `verify-code-*`、`verify-schedule3d.mjs`、`verify-video-ref-api.mjs`、`verify-video-ref-ui.mjs`、`verify-project-scope.mjs`、`verify-theme.mjs`；验证：全部通过。
- [x] 5.4 人工检查：有/无相邻图、下一镜未出图、图片 10 张上限、视频 4 张上限、参考视频 + 相邻图、旧项目；验证：截图/视频或检查记录写入变更说明。

## Workflow follow-up

- 实施前先协调 `canvas-video-api`（10/12 tasks）和 `schedule-video-reference`（21/23 tasks）：删除或改写其中的尾帧、`return_last_frame` 和尾帧接龙要求，或先完成/归档它们。否则归档后主 spec 会与本变更冲突。
- 评审通过并完成本变更任务后再归档；归档前确认两个旧变更的尾帧要求已消除。
- 若旧项目仍保存 `tail_image`，保留 SQLite 数据，不做破坏性清理。
