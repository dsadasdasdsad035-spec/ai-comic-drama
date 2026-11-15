# Design

## 目标

让 Agent 的 `generate_keyframe` / `generate_clip` 与画布按钮生成**共用同一套参考解析结果**，不新增第二套规则。

## 1. 上下文通道

工具层需要三样画布状态：

| 字段 | 用途 | 缺失后果 |
|---|---|---|
| `nodes` | `asset-<uid>` 按节点查图、`shot-prev/next` 找相邻镜 | 素材与相邻参考全部解析不到 |
| `characters` | `char-<id>` 查三视图、表情参考 | 角色参考解析不到 |
| `missingMedia` | 坏链集合，避免把 404 地址当有效参考 | 把坏图发出去 |

```ts
getCanvasContext?: () => {
  nodes: ShotNodeType[]
  characters: CharacterSheet[]
  missingMedia: Set<string>
}
getSelectedVideoModel?: () => VideoModelInput | null
getVideoResolution?: () => string
```

宿主 `App.tsx` 传 `nodesRef.current` / `charactersRef.current` / `missingMedia` 与 `selectedVideoModel` / `vidRes`。模型与分辨率也必须透传：`buildShotVideoRequest` 用它们判断 `native` 音频与支持能力，`startVideo` 用 `modelKey` 决定实际渠道；不传就会「画布出的片和 Agent 出的片不是一个模型」。

**为什么不用 `getCanvasAssets` 顶替 `nodes`**：它只有 `id/title/url`，没有 `kind`，而解析要按 `kind` 过滤（表情总图、视频、音频不参与图片参考），还要靠节点满足 `shot-prev/next` 的相邻匹配。

## 2. 首帧：`generate_keyframe`

与画布 `refMode=false`（默认）时同构：

1. `collectShotReferences({ node, nodes, characters, missingMedia, strict: true })`
2. `missing.length > 0` → 在 `requireCost` **之前**返回错误，不花钱
3. `limitReferences(collected.refs, 10)`
4. prompt 追加 `\n\n参考图说明：图1=<label>，图2=<label>…。对应主体必须与参考图保持一致。`
5. `generateImage({ prompt, ratio, refImages: used.map(r=>r.url), n: 1, project })`

不启用 `refMode`：那是「拿旧首帧当构图参考」的画布全局开关，语义是复刻上一张图，不是参考连线。Agent 出首帧的职责是画出来，由 `refIds` 决定长相。

## 3. 出片：`generate_clip`

完全复用画布那段映射（`App.tsx` `generateVideoOne`）：

```ts
const request = buildShotVideoRequest({ data, nodeId, nodes, characters, missingMedia, model, resolution })
if (request.blocking.length) return { ok: false, error: request.blocking[0].message }
const effective = effectiveVideoPrompt(request, data.videoPromptOverride)
const imageUrls = request.refs.map(r => r.url)
startVideo({ ...按 request.mode 映射..., prompt: effective.text, seconds: request.seconds, ... })
```

`request.omitted` / `omittedVideos` 通过返回值 `notes` 带出，让用户知道哪几张没送出去，而不是静默减配。

正文优先级随之从工具自己的 `video_prompt_rendered || video_prompt || keyframe_prompt || desc` 换成 `effectiveVideoPrompt`（`video_prompt` → `prompt_fallback` → 脚本拼装）。这是刻意的行为变更：画布预览显示什么，Agent 就发什么，否则「预览和成片不一致」会在 Agent 路径上重现。

## 4. strict 解析

`collectShotReferences` 增加 `strict?: boolean`。strict 下把这些**显式 token** 的失败记进 `missing`：

- `char-<id>` / `char-miss-<name>`：角色不在角色库 / 角色还没有三视图
- `asset-<uid>`：画布上没有这张卡 / 卡上没有图片 / 卡是视频或音频

**仍然静默**（与画布一致，且是有意的产品行为）：

- 表情参考：没选表情图或没有表情总图 → 回退文字表演，不阻塞
- 生图镜上的 `shot-prev/next` 残留 token → 出片才用邻镜，不报错
- 素材是视频/音频且画布未开 strict → 跳过

画布不传 `strict`，因此「画布按钮生成」的行为一字不变；这是把严格度作为一个显式选项，而不是全站收紧。

## 5. 无画布降级

创意工作室可以在没挂载画布的视图下运行。此时：

- `nodes = buildShotNodes([], project.shots)`（`shotToData` 已带 `refIds`，`char-` / `shot-prev/next` 都能解析）
- `characters = readCharacters(project.characters)`
- `missingMedia = new Set()`

`asset-` token 必然解析不到（画布节点 id 是运行时生成的），strict 下报「素材卡不在画布上，请在画布里重新连线或改用角色/相邻镜参考」。宁可报错也不静默出一张没参考的图。

## 6. 不变量

- 生成工具仍不写 `refIds`、不建素材卡。
- 成本确认仍在发起任何请求之前；参考解析失败发生在成本确认之前，用户不会为一次注定失败的生成付费。
- `startVideo` 仍只提交不等待。
