# Proposal

## Why

角色卡现在只有一个图片入口：三视图（`image` / `candidates`）。用户手上已有的角色设定图、真人定妆照、或者一张别人做好的角色图，没有地方放。想用它就得先花一次生图把它「重新画一遍」，而生成的图未必比原图准。同时三视图既是「外观锚点」又是「每镜参考」，两种用途挤在一个字段上，导致「我想用这张图来生成三视图」和「我想让这张图直接进分镜」无法区分。

## What Changes

- 角色卡增加「参考图」：可上传多张本地图片，作为**身份输入**使用——生成三视图、生成表情总图时作为参考图提交，帮助模型锁定长相。
- 参考图 MUST NOT 自动进入分镜参考池。分镜出图仍只发定型后的三视图（或表情单格），沿用现有 4 张预算，不因新增参考图而挤掉场景/道具。
- 参考图可被显式提升为三视图：用户确认后，某张参考图成为 `image`（并从候选列表进入），此后它就是每镜的外观锚点。这是上传图进入分镜的唯一路径。
- 参考图与三视图一起按项目保存，切换项目互不可见；`project.json` 只写站内路径，不写 dataURL。
- 删除或替换参考图 MUST NOT 静默改动三视图；三视图失效判断（身份指纹）MUST NOT 因参考图变化而触发。
- 不做：参考图的自动视角裁切、人脸对齐、多图融合成一张、按镜头指定不同参考图。

## Capabilities

### New Capabilities

- `character-appearance`: 角色卡的外观输入——参考图与三视图两种来源的关系、参考图作为生成输入、参考图提升为三视图的唯一路径、以及参考图不进入分镜参考预算的边界。

### Modified Capabilities

（无。角色三视图与表情总图的现有行为不变；`character-extraction` 只管拆角色，不涉及外观图片。）

## Impact

- 前端：`src/characters.ts` 的 `CharacterSheet` 增加 `referenceImages?: string[]`；`src/charMap.ts` 的 `ProjectChar` 增加 `reference_images` 并在 `toSheet` / `toProject` 双向映射（必须过 `local()` 过滤）；`src/CharacterCard.tsx` 的三视图页增加参考图区（上传、预览、删除、设为三视图）；`src/App.tsx` 的角色落库路径不变。
- 生成调用：`CharacterCard.generateTurnaround` 与 `generateSheet` 增加 `refImages`，与三视图共存时如何排序需要定；复用现有 `/api/seedream` 的多参考图能力（上限 10 张）。
- 不改服务端路由：`/api/save-image` 与 `/api/seedream` 的多图字段都已具备。
- 新增验收：`verify-character-card-ui.mjs` 增加参考图段；`verify-chars-canvas.mjs` 确认参考图不影响画布节点。
