# Design

## Context

参见 `proposal.md` — Why。当前实现约束：

- 生成图落盘走 `/api/save-image`（`vite.config.ts`）：只认 `data:image/(png|jpeg|jpg|webp);base64`，超过 `MAX_REF_BYTES`（30MB，`server/media.mjs`）拒绝，带 `project` 时落 `projects/<项目>/assets/` 并返回 `/project-assets/...`，不带时落 `public/generated/`。
- `saveImageDataUrl(dataUrl, { project, prefix })`（`src/api.ts`）是前端唯一封装；角色三视图与表情总图已经用它上传本地图片。
- 设定卡当前图与候选是 `DesignSheet.image` / `candidates` / `activeIdx`；画布发布按「有 `image` 才可发布」判断，与图片来源无关。
- `charMap.toProject` 的 `local()` 只接受站内路径，dataURL 不会写进 `project.json`；`DesignSheet` 走的是 `patchProject({ designs })` 整表替换，没有过滤，所以必须在写回前就把地址换成站内路径。
- 画布素材卡的数据来自 `AssetNodeType`（`title / kind / url`），通过 `patch(node.id, ...)` 更新，节点数据随画布 localStorage 与 `assets` 表持久化。
- 已有的上传实现分散在 `CharacterCard.tsx`（三视图、表情总图）、`Inspector.tsx`（参考图，仅 FileReader 成 dataURL）、`PublishBoard` / `CreativeComposerBar`（视频），校验逻辑各写各的。

## Goals / Non-Goals

**Goals:**

- 一条上传实现服务设定卡、画布素材卡、素材选择器三处，校验与错误文案一致。
- 上传得到的图与生成图在数据结构上完全等价，下游（发布、参考、Inspector）不需要区分来源。
- 失败不留脏数据：地址只在保存成功后写入。

**Non-Goals:**

- 视频/音频本地上传（素材卡已有在线导入与已有素材选择两条路）。
- 图片预处理（裁剪、压缩、HEIC 转码、生成缩略图）。
- 为上传单独建服务端端点或改动 `/api/save-image` 的能力边界。

## Decisions

### 决策 1：抽出 `src/mediaUpload.ts`，三处共用

导出 `pickImageFile(file) → { ok, reason }` 与 `uploadImageFile(file, { project, prefix }) → { url }`。前者只做类型/大小校验，后者读成 dataURL 再调 `saveImageDataUrl`。

替代方案：在三个组件里各自 `new FileReader()`。否决理由——现有代码已经有四处各写一遍 FileReader，错误文案不一致（「读取图片失败」/「请选择图片文件」/静默返回），再添三处只会加剧。

### 决策 2：保留 `/api/save-image`，不新增端点

它已经做了格式白名单、30MB 上限、项目媒体落盘与站内地址返回；新增端点只会重复这些校验。

**代价**：`accept` 属性必须与正则一致。HEIC 与 GIF 会在服务端被拒（错误信息是「dataUrl 格式不对」，对用户不友好），所以客户端先挡，给出「只支持 png / jpeg / webp」的明确文案。这也意味着必须写清拒绝原因，不能把服务端消息直接透出。

### 决策 3：设定卡上传把图并入候选，而不是替换候选

上传后：`candidates = [...(旧候选), newUrl]`，`activeIdx` 指向新图。这样生成图仍可切回，符合现有「候选图选择影响后续使用」的行为。

替代方案：上传即替换整个候选列表。否决理由——用户可能是想拿上传图对比生成图，替换会不可逆地丢掉生成结果（除非重新花钱生成）。

### 决策 4：素材卡上传走「先保存、后写入」

```
选择文件 → 校验类型/大小 → FileReader 成 dataURL → /api/save-image
      → 成功：patch({ url })  失败：只显示错误，不 patch
```

`Inspector.tsx` 现有的参考图上传是「直接 set dataURL」，那是画布本地状态、可以容忍；素材卡会落库，所以必须等保存成功。

### 决策 5：选择器上传作为条目而不是新页签

上传后把结果作为一条 `PickItem`（`source: 'project-image'`）插入列表首位并自动选中，用户仍需点「使用这张」才写回——这与「点选只预览、确认才写回」的既有语义一致。

替代方案：增加「本地上传」页签。否决理由——上传是一个动作不是分类；增加页签会让本来就六项的分类栏更挤，且上传后用户想看的是这一张图，不是一个只有一张图的分类。

### 决策 6：不改 `AssetKind`

上传的图按当前素材卡类型渲染：场景卡仍是场景，道具卡仍是道具，其他情况回落 `image`。这与 `pickKind` 的既有规则一致（选择普通图片时保留场景/道具类型）。

## Risks / Trade-offs

- **30MB 上限对手拍照片可能不够** → 客户端先校验并显示文件大小，让用户知道要压缩；不在本期做自动压缩。
- **HEIC 被拒会被理解为「功能坏了」** → 错误文案明确写出支持的三种格式与「iPhone 照片请先导出为 JPEG」。
- **上传图混进候选后不易区分来源** → 候选条目前只有圆点。本期不引入来源标记，因为 `candidates` 是纯字符串数组；写在 design 的非目标里，避免顺手改数据结构。
- **`/api/save-image` 无并发保护** → 文件名带时间戳与随机后缀，同名冲突概率可忽略。
- **上传大小上限与生产部署的请求体限制** → 40MB 的 `/api` 请求体上限高于 30MB 图片上限，留有余量；但 dataURL 的 base64 膨胀约 33%，30MB 原图会超过 40MB。因此客户端校验应按「编码后大小」判断，或把上限降到 25MB。

## Migration Plan

无数据迁移。已有设定卡与素材卡不受影响。

回滚：撤掉三处入口即可；已上传的文件留在项目媒体目录，不影响读取。
