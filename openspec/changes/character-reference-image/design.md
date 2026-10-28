# Design

## Context

参见 `proposal.md` — Why。当前实现约束：

- `CharacterSheet`（`src/characters.ts`）承载外观：`image` 是选定的三视图，`candidates` + `activeIdx` 是候选，`lookEn` 是英文锚点。`identityFingerprint()` 只由 `lookEn` + `palette` + `keywords` 决定，用来判断表情总图是否失效。
- `ProjectChar`（`src/charMap.ts`）是落库形状，字段为蛇形（`look_en` / `expression_sheet` / `voice_sample`）。`toProject` 里的 `local()` 只接受以 `/` 开头且不以 `/api` 开头的路径——dataURL 会破坏 `project.json`，这是显式约束。
- 分镜参考只认 `c.image`：`collectShotReferences`（`src/shotReferences.ts`）按 `char-<id>` token 或 `cast` 回退取角色图，取的就是 `image` 这一张。
- 生成调用：`generateTurnaround` 用 `cap: 'view'`，提示词是 `${lookEn}, ${TURNAROUND_SUFFIX}`；`generateSheet` 额外把 `c.image` 作为 `refImage`。`/api/seedream` 支持 `refImage` 与 `refImages`（数组，最多 10 张）。
- 上传已有实现：`CharacterCard.tsx` 用 `readFile` + `saveImageDataUrl(dataUrl, { project, prefix })`。

## Goals / Non-Goals

**Goals:**

- 参考图与三视图的职责边界在数据结构、UI、生成调用三层都清晰。
- 参考图的引入不改变任何既有分镜出图行为（预算、附件清单、指纹）。
- 落库安全：只写站内路径，绝不写 dataURL。

**Non-Goals:**

- 按镜头选用不同参考图（那是 `refIds` / 连线的职责）。
- 参考图自动裁切、角度识别、人脸对齐、多图融合。
- 表情总图与参考图合并成一张索引图。

## Decisions

### 决策 1：新增 `referenceImages: string[]`，不复用 `candidates`

`candidates` 的语义是「同一张图的多个候选版本，选一个作为 `image`」。参考图是「不同的图，都用」，语义不同。混用会让「切换候选」与「增删参考」两类操作互相干扰，也会让 `activeIdx` 失去意义。

`ProjectChar` 对应字段 `reference_images`，`toSheet` / `toProject` 双向映射，写入前过 `local()` 过滤。

### 决策 2：参考图只进「生成三视图/表情总图」，不进分镜

```
参考图 ──(生成输入)──> 三视图 ──(每镜参考)──> 分镜出图
   │                    ^
   └──(显式设为三视图)──┘
```

这是本次最关键的边界。理由是分镜参考预算固定为 4 张（`limitReferences`），`collectShotReferences` 的排序已经明确「表情 → 角色 → 相邻 → 素材」，多角色镜头本来就紧张。让参考图直接进预算会挤掉场景/道具，且与三视图表达同一件事（这张脸长什么样），属于重复占位。

替代方案：参考图与三视图一起进分镜。否决理由——预算冲突无法解释，用户看到「参考图 N/4」里有两张同一个人的图会认为是 bug。

### 决策 3：生成时的参考图顺序为「三视图在前，参考图在后」

`refImage`（单张）放三视图，`refImages`（数组）放参考图。理由是服务端对 `refImage` 与 `refImages` 的合并顺序是 `[image, ...refImages]`（`vite.config.ts`），三视图作为已定型的外观基准应该排第一。

**代价**：生成表情总图时三视图会同时出现在 `refImage` 和「已有三视图」的语义里，需要在提示词里说明「图 1 是当前三视图，其余是同一角色的其他参考」，避免模型把不同参考当成不同人。

### 决策 4：「设为三视图」是显式动作，且不移除参考图

提升后该图同时存在于 `candidates`（作为当前 `image`）与 `referenceImages`。不去重，因为：参考图列表是用户的输入记录，删除它会让「我上传过什么」消失；而候选列表是产出物的选择器。

替代方案：提升时把该图从参考图移到候选。否决理由——用户可能想保留原始上传记录，且移出会让「参考图 N 张」的计数跳变，看起来像丢图。

### 决策 5：参考图上限 4 张

服务端 `/api/seedream` 的多图上限是 10 张，但三视图生成时 `refImage` 已占一张，且参考图过多会让模型在「多个人」之间摇摆。4 张足以覆盖正脸、侧脸、全身、表情，与分镜预算的数字一致，便于解释。

**代价**：用户可能想传更多。上限在 UI 上明示，不做静默截断。

### 决策 6：参考图变化不触发失效

`identityFingerprint` 不改。它现在的输入（`lookEn` / `palette` / `keywords`）已经完整表达了「文字锚点是否变了」。参考图是输入素材而非锚点定义，变化不该让已有产出失效——否则用户每加一张参考图就要重新生成全部表情。

## Risks / Trade-offs

- **参考图被误认为会进分镜** → UI 上参考图区必须写明「只用于生成三视图，不进入分镜参考」。
- **提升为三视图后同一张图出现两处** → 两处都要标注「已在候选」，避免用户以为重复上传。
- **多张参考图风格不一致会让三视图漂移** → 不自动处理；在参考图区提示「建议同一角色、同一画风的图」。
- **`reference_images` 写进 project.json 会增加文件体积** → 只存路径不存内容，单条几十字节，可忽略。
- **删除参考图时文件是否删除** → 不删文件。项目媒体目录的清理归 `scripts/cleanup-orphan-media.mjs`，避免删除仍被候选或其他角色引用的同一文件。

## Migration Plan

无数据迁移。旧项目没有 `reference_images` 字段，`toSheet` 视作空数组。

回滚：撤掉参考图区与 `refImages` 传参即可；已有字段留在 `project.json` 里不影响读取。
