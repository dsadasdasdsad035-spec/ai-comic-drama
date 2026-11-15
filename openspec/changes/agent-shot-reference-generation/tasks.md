# Tasks

## 1. 共享解析器加 strict

- [x] 1.1 `collectShotReferences` 入参加 `strict?: boolean`；strict 下 `char-` 角色不存在、角色无三视图记入 `missing`（语气与既有文案一致：`角色「X」还没有三视图`）。
- [x] 1.2 strict 下 `asset-` token 无对应节点 / 无图片 / 非图片类型记入 `missing`；非 strict 保持 `continue`。
- [x] 1.3 验证：不传 strict 时既有画布用例结果不变（表情/相邻/素材的静默分支仍静默）。

## 2. 上下文通道

- [x] 2.1 `BuiltinPlatformCtx` 新增 `getCanvasContext`、`getSelectedVideoModel`、`getVideoResolution`。
- [x] 2.2 `MaterialToolDeps` 同步（`generate_keyframe` 在 material tools 之外的 builtin 侧，只需 ctx）。
- [x] 2.3 `CreativeStudio` 的 `materialHost` 类型与透传补上三项。
- [x] 2.4 `App.tsx` 注入 `nodesRef.current`、`charactersRef.current`、`missingMedia`、`selectedVideoModel`、`vidRes`。
- [x] 2.5 验证：组件类型检查通过；`getCanvasContext` 缺省时工具走降级路径而不是崩溃。

## 3. 首帧接参考

- [x] 3.1 新增 `shotNodeFor(shot, project, canvasCtx)`：优先画布节点（按 `data.shotId` 找），否则 `buildShotNodes([], project.shots)` 里找。
- [x] 3.2 `generate_keyframe` 在成本确认前调用 `collectShotReferences(..., strict: true)`，`missing` 非空直接返回可读错误。
- [x] 3.3 通过后用 `limitReferences(refs, 10)` 传 `refImages`，并按画布格式追加「参考图说明」到 prompt。
- [x] 3.4 验证：`tests/platform-generate-tools.ts` 断言 `/api/seedream` 请求体含角色三视图 URL 与参考图说明；角色无图时 `ok:false` 且 `fetch` 调用数为 0。

## 4. 出片接统一拼装

- [x] 4.1 `generate_clip` 改用 `buildShotVideoRequest`，`blocking` 非空直接返回错误。
- [x] 4.2 按 `request.mode` 映射 `refImages` / `refVideos` / `audioRef` / `generateAudio` / `image`，补 `cameraFixed`、`resolution`、`modelKey`。
- [x] 4.3 正文改用 `effectiveVideoPrompt(request, data.videoPromptOverride)`；返回值带 `notes` 说明被省略的参考。
- [x] 4.4 验证：有相邻镜连线时请求体 `refImages` 含上镜首帧；`mode='native'` 时带 `generateAudio` 与 `audioRef`；提交仍只返回 `jobId`、不写 `clip`。

## 5. 回归

- [x] 5.1 更新 `tests/platform-generate-tools.ts` 夹具（角色补三视图，否则 strict 会按新规则拒绝）。
- [x] 5.2 跑 `node --test` / 项目既有测试入口，全绿。
- [x] 5.3 手工验一遍：画布连角色 → Agent `link_shot_refs` → `generate_keyframe` → 检查请求体与出图一致性。
