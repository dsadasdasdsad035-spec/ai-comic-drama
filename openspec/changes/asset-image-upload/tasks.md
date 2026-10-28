# Tasks

## 1. 共用上传实现

- [x] 1.1 新建 `src/mediaUpload.ts`：`MAX_UPLOAD_BYTES`、`ACCEPTED_TYPES`（png/jpeg/webp）、`pickImageFile(file)` 返回 `{ ok, reason }`、`uploadImageFile(file, { project, prefix })` 读成 dataURL 后调 `saveImageDataUrl`。用 `verify-media.mjs` 增加分段（或新建 `verify-media-upload.mjs`），覆盖类型拒绝、超限拒绝、正常返回站内路径、无项目时拒绝。
- [x] 1.2 在 `uploadImageFile` 加入 base64 膨胀校验：按 `Math.ceil(size * 4 / 3)` 估算编码后大小，超过 40MB 请求体上限时提前拒绝并说明原因。在验收脚本中断言一个 31MB 文件被拒、一个 28MB 文件通过校验。
- [x] 1.3 把 `CharacterCard.tsx` 的两处上传（三视图、表情总图）改用 `mediaUpload`，删除本地 `readFile`。运行 `node verify-character-card-ui.mjs` 与 `node verify-expression-sheet-ui.mjs`，确认行为不变。

## 2. 设定卡上传

- [x] 2.1 在 `src/AssetBoard.tsx` 的 `DesignCard` 增加「上传设定图」按钮与隐藏 file input（`accept="image/png,image/jpeg,image/webp"`），处理函数在成功后把新图并入 `candidates`、`activeIdx` 指向新图、`image` 更新。运行 `node verify-asset-board.mjs`，确认上传后卡片显示新图且可「加入画布」。
- [x] 2.2 处理失败路径：校验失败、读取失败、保存失败三种情况都只显示错误、不改 `designs`；`pushOne` 在无图时的提示保持「先生成或上传这张设定图」。在 `verify-asset-board.mjs` 增加段：模拟保存失败后 `designs` 的 `image` 与 `candidates` 保持不变。
- [x] 2.3 确认无英文锚点时上传可用（不触发「先补锚点」提示），且上传后 `promptEn` 仍为空不影响发布与连线参考。在 `verify-asset-board.mjs` 增加断言。

## 3. 画布素材卡与选择器上传

- [x] 3.1 在 `src/Inspector.tsx` 的素材来源区增加上传按钮：保存成功后 `set({ url, kind: pickKind(...) })`，失败只显示错误。运行 `node verify-media-picker.mjs`，确认素材卡地址更新并正常预览。
- [x] 3.2 在 `src/MediaPicker.tsx` 增加上传入口：上传成功后把结果作为一条 `source: 'project-image'` 的 `PickItem` 插入列表首位并选中，仍需点「使用这张」才写回。在 `verify-media-picker.mjs` 增加段：上传后条目可预览、取消后素材卡不变。
- [x] 3.3 确认上传得到的素材卡可被连线到分镜并在出图时作为参考图提交。运行 `node verify-refs.mjs` 与 `node verify-video-ref-api.mjs`，确认参考集合包含该 URL。

## 4. 集成与回归

- [x] 4.1 运行 `npx tsc --noEmit` 与 `npm run build`，修复类型问题。
- [x] 4.2 运行 `node verify-all.mjs`。本次相关四个脚本全绿（`verify-media-upload` / `verify-media-upload-real` / `verify-media-picker` / `verify-asset-board`），全量跑无新增失败（相对改动前基线）。仓库里另有 60+ 历史脚本过期（等已删除的 3D 右键菜单、旧 localStorage 键名、缺预制产物），已单列跟踪，不在本变更范围。
- [x] 4.3 手工验证：上传一张 PNG 到场景卡 → 加入画布 → 连线到分镜 → 出图请求的参考图包含它；再上传一个 HEIC，确认被拒且设定卡不变。
- [x] 4.3b 用真实拍摄照片验收上传链路（`github.com/dsadasdasdsad035-spec/cat` 的 9 张猫咪参考照：7 张 1536×2048 JPEG + 1 张 941×1672 PNG，共 7.4MB，中文文件名）：新增 `verify-media-upload-real.mjs`，覆盖客户端校验放行、真实 `/api/save-image` 往返且落盘字节逐字节一致、站内地址读回一致、UI 里上传进设定卡后渲染真实分辨率、加画布连线后出图请求带上该图。运行 `node verify-media-upload-real.mjs` 全绿；目录不存在时跳过不报错。
- [x] 4.4 在 `README.md` 的素材环节说明处补一句：设定卡与素材卡都支持本地上传 png/jpeg/webp（原图 ≤30MB，且 base64 编码后需在 40MB 请求体上限内），不支持 HEIC/GIF。
