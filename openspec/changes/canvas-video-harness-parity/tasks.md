# Tasks

## 1. 修正 generate_clip 正文与可选会话参数

- [x] 1.1 `builtinPlatformTools.ts` 中 `generate_clip`：按 override → 参数 `prompt` → `request.prompt` 选择提交正文；更新 zod `description` 写明优先级；验证：`tests/platform-generate-tools.ts` 增用例「无 override + 传 prompt → 请求正文等于 prompt」
- [x] 1.2 同函数增加可选 `modelKey`、`resolution`（`480p`|`720p`）传入 `startVideo`；非法 key 在执行前 `ok: false`；验证：mock `startVideo` 断言单次覆盖、省略时用 `getSelectedVideoModel`/`getVideoResolution`
- [x] 1.3 `verify-creative-builtin-tools.mjs` 更新 `generate_clip` 的 smoke 期望（若正文链变化）

## 2. 镜级写工具实现

- [x] 2.1 `set_shot_video_options`：`useExpressionRef` / `audioMode` / `prod_kind` 单镜写回；`native` 写前走与 `NativeAudioPanel` 同条件的就绪校验；验证：`tests/shot-video-harness-tools.ts`
- [x] 2.2 `set_shot_video_override`：保存 `text`+`fingerprint` 或 `clear:true`；fingerprint 与 `buildShotVideoRequest` 一致；验证：保存后 `read_shot_video_prompt` source=override；指纹不符拒绝
- [x] 2.3 `set_shot_ref_extras`：add/remove，URL 须 `isProjectMediaUrl`；验证：外链拒绝、add 后读 inputs 有反映
- [x] 2.4 `set_shot_neighbor_refs`：add/remove `SHOT_PREV`|`SHOT_NEXT`；验证：token 写入 refIds 且与画布邻镜连线等价
- [x] 2.5 在 `createBuiltinPlatformTools` 注册四工具并加入 `PLATFORM_ACTION_TOOL_NAMES`；`createMaterialTools` 导出工厂

## 3. 读侧与文档

- [x] 3.1 （可选但推荐）`read_shot_video_inputs` 响应增加 `fingerprint` 字段，供 override 工具使用；验证：读回与 `buildShotVideoRequest` 一致
- [x] 3.2 `docs/creative-studio.md` 增补「画布出片参数 ↔ 工具」表（含本次新工具与 `generate_clip` 参数）
- [x] 3.3 `KNOWN_TOOL_IDS`、`expertToolGroups.ts`、`DEFAULT_EXPERT_PLATFORM_TOOLS`、`experts/expert-omni*/manifest.json` 与 soul 一句指引

## 4. 集成验收

- [x] 4.1 `node tests/shot-video-harness-tools.ts` 全绿并纳入 `verify-skills-unit.mjs` 或 `test:studio` 子集
- [x] 4.2 `npm run test:studio` 无回归
- [ ] 4.3 手测：DSH 会话内 `read_shot_video_inputs` → `set_shot_video_options` → `generate_clip` 路径与画布按钮 blocking/附件一致

## Workflow follow-up

- 归档后合并 delta 至 `creative-shot-video-harness`（主 spec 新建）、`dsh-tool-bridge`、`shot-video-prompt`。