# Proposal

## Why

场景/道具设定卡完全没有图片上传入口，而 UI 文案已经在承诺它：素材页在没有图时提示「先生成或上传这张设定图」，toast 也写了「生成或上传」，但界面上只有「生成设定图」一个按钮。画布素材卡同样只能从已有素材里挑或手填 URL。用户手上有现成的场景参考图、道具设计图时，唯一出路是生成一张不需要的图，再把参考图当角色图塞进别处。

## What Changes

- 场景/道具设定卡增加「上传设定图」：上传后成为当前图并进入候选，可像生成图一样被选中、发布到画布、参与镜头参考。
- 画布素材卡与素材选择器增加本地上传：上传的图片落到项目媒体目录后写回素材卡，与在线素材、生成图同源。
- 上传统一走已有的 `/api/save-image`（落 `projects/<项目>/assets/`，返回 `/project-assets/...`），不新增上传端点、不引入对象存储。
- 上传前做客户端校验：类型白名单（png / jpeg / webp）、单文件大小上限、文件名与尺寸提示；不满足时给出可操作的原因，而不是等请求失败。
- 上传失败的图片 MUST NOT 写回素材卡，MUST NOT 留下孤儿文件引用。
- 不做：视频/音频上传（素材卡已可从在线素材导入与已有素材选择获得）、HEIC 转换、多文件批量上传、图片裁剪与压缩。

## Capabilities

### New Capabilities

（无新能力。上传是既有素材能力的一个来源入口，行为归属现有两个能力。）

### Modified Capabilities

- `scene-prop-design`: 设定卡图片来源新增「本地上传」，与生成图并列；上传图同样可被选为当前图并参与画布发布。
- `asset-media-picker`: 选择器与素材卡新增「本地上传」来源；上传成功后条目立即可选，类型按图片处理。

## Impact

- 前端：`src/AssetBoard.tsx` 的设定卡增加上传按钮与处理函数（复用 `saveImageDataUrl`）；`src/MediaPicker.tsx` 增加上传入口；`src/Inspector.tsx` 的素材卡来源区在无地址时提供上传；新增 `src/mediaUpload.ts` 承载校验与读取（避免在三个组件里复制）。
- 复用现有服务端：`/api/save-image`（`vite.config.ts`）与 `server/media.mjs` 的 `saveProjectImage`；`MAX_REF_BYTES` 为 30MB，格式正则只认 png/jpeg/webp。
- 不改数据结构：`DesignSheet.image` / `candidates` 与素材卡 `url` 已能承载站内路径；`charMap.toProject` 的 `local()` 过滤保证不会把 dataURL 写进项目文件。
- 新增/修改验收：`verify-asset-board.mjs`、`verify-media-picker.mjs`。
