# Design

## Context

见 `proposal.md`。现状：`buildShotVideoRequest` 与 `finalizeTransitionPromptText` 为纯函数拼接；`skills/prompt` / `cinematic-transition` 产出较短正文字段。产品已要求预览与实际 `prompt` 逐字一致（`shot-video-prompt`）。

## Goals / Non-Goals

**Goals:**

- 用**单次 LLM 调用**按固定九段模板生成可提交的 Seedance 2.5 风格正文（含资产映射、时间轴、连续性、结束帧/衔接条件）。
- 渲染输入由**与拼装器相同的结构化真相**组装（附件清单、用途、省略项、blocking 除外或标注为未送）。
- 异步渲染 + 持久化；出片路径同步只读已渲染结果或回退，不阻塞在 API 上。
- 转场渲染感知 `inputMode`（首尾帧 / 纯文本等），与 `cinematic-transition` 禁令一致。

**Non-Goals:**

- 替换首帧 `keyframe_prompt` 流水线。
- 在 `buildShotVideoRequest` 内热调 LLM。
- 首期强制全项目批量重渲染。

## Decisions

### D1：两层字段分工

| 字段 | 职责 | 消费者 |
|------|------|--------|
| `video_prompt` | 镜头表语义层（短运动句），人读、技能迭代 | `prompt` / `shotlist` |
| `video_prompt_rendered` | 出片用完整模板正文 | `buildShotVideoRequest`（优先） |
| `video_prompt_render_meta` | `{ fingerprint, model, templateVersion, renderedAt }` | 面板 stale 判定 |

转场：`transition_out.generated.prompt` 保留 Agent 桥接语义；新增 `generated.rendered_prompt` + `render_meta`。自动 UI 优先 `rendered_prompt`。

**备选**：只存一份 `video_prompt` 并由 LLM 直接写九段 —— 破坏手改与表内可读性，不采用。

### D2：渲染触发与指纹

`renderFingerprint` = `shortHash(JSON.stringify(bundle))`，bundle 见下文 Schema。指纹变化 → 标 stale，不删已渲染正文；用户点「重新渲染（模板）」或工作台技能批量提交时更新。

手改 `VideoPromptOverride` 仍短路全部自动来源（含 `rendered`）。

### D3：拼装器与模板边界

**方案 A（推荐）**：LLM 输出**完整**可提交正文（含 §2 资产映射文字）；运行时**仅在手改/回退路径**追加 `buildReferenceImagesPromptHint` 等后缀，避免双写。

**方案 B**：LLM 输出不含 @ 映射，运行时始终追加 hint —— 易与 §2 冲突，不采用。

渲染完成后做一次**校验**：若 bundle 声明 `submittedAttachments` 与正文 `@图像N` 不一致，面板 warning，不阻止出片（与现有手改图注行为一致）。

### D4：技能与宿主

- 技能 `seedance-prompt-render`：`tools: [read_shots, read_characters, submit_prompt_renders]`（契约名设计时对齐现有 submit 模式）。
- 系统提示内嵌：**九段模板全文** + Seedance 2.5 四段式规则摘要（链接见 proposal 参考资料）。
- 用户消息 = `PromptRenderBundle` JSON（`kind: "shot" | "transition"`）。

画布「重新渲染」：调宿主已有聊天动作或轻量 `POST /api/prompt-render`（复用设置页环节模型）。

### D5：与现有后缀模块的关系

回退路径保留：`performanceVideoPromptBlock`、`nativeAudioPrompt`、`motionNote` 拼接。

渲染路径：要求 LLM 在模板 §4/§7 吸收表演、对白、原生音频策略；**不再**追加 `performanceBlock`（避免重复）。`motionNote` 仍有 3D 调度时：写入 bundle `schedule.motionNote`，由 LLM 并入 §4 运镜。

过渡策略：无 `rendered` 时行为与今日 100% 相同。

## PromptRenderBundle Schema（v1）

```ts
type PromptRenderBundle = {
  schemaVersion: 1
  kind: 'shot' | 'transition'
  templateVersion: 'seedance-2.5-cn-9' // 对应用户九段模板修订号

  // §1 视频基本信息
  video: {
    type: string           // 图生视频 / 转场桥接 / …
    durationSec: number
    aspectRatio: string
    visualStyle: string    // 项目 style 锁
    shotCount: number      // shot=1；transition=桥接内逻辑镜数
  }

  // §2 参考素材（与面板附件一致）
  assets: {
    slot: 'image' | 'video' | 'audio'
    index: number
    label: string
    purpose: string        // 角色外貌 / 场景 / 运动参考 / 音色 …
    inherit: 'strict' | 'motion_only' | 'audio_only' | 'style_only'
    mustNotInherit?: string[]
    submitted: boolean
    omitReason?: string
  }[]

  // §3 角色与场景（来自 shot / 双镜）
  scene: {
    subjects: string[]
    castStates: string
    location: string
    environment: string
    weather?: string
    timeOfDay?: string
    lighting?: string
  }

  // §4–§7 语义输入（非成稿）
  creative: {
    desc: string
    keyframePrompt?: string
    videoPromptBrief?: string   // 表内 video_prompt
    size: string
    move: string
    cameraHint?: string
    performance?: unknown[]     // 与 performanceFingerprint 同源
    dialogue?: string
    dialogueDelivery?: unknown
    motionNote?: string
    nativeAudio?: { mode: 'off' | 'native'; character?: string }
    soundDesign?: string        // 转场
  }

  // 转场专用
  transition?: {
    bridging: 'morph' | 'match'
    inputMode: 'boundary' | 'first-frame' | 'reference' | 'video-reference' | 'text' | 'none'
    sourceShotNo: string
    targetShotNo: string
    sourceEndCondition?: string
    targetStartCondition?: string
    recipeHints?: string[]
    recipePitfalls?: string[]
    handoffYaml?: string
  }

  // §8 连续性（单镜可含 neighborSummary）
  continuity: {
    identityLocks: string[]
    spatialRules: string[]
    forbidden: string[]         // 无字幕、无水印、禁止跳变 …
    neighborSummary?: string    // 若勾选相邻参考
  }

  // §9 结束帧 / 衔接
  endFrame: {
    subjectPose: string
    composition: string
    focus: string
    nextShotLink?: string
  }

  seedanceRulesDigest: string   // 宿主注入固定短文，非用户编辑
}
```

**LLM 输出契约（技能）**：

```json
{
  "rendered_prompt": "……单条中文，可直接作为 Seedance prompt……",
  "negative_constraints": ["……可选，合并进正文或仅元数据"],
  "warnings": ["假设：……"]
}
```

模板章节标题可保留在正文中（便于人读）或压缩为连续段落 —— **首期允许带标题**，验收以 API 长度与模型效果为准。

## Risks / Trade-offs

- **[成本/延迟]** 每镜渲染一次 LLM → 批量按钮 + 指纹 stale，避免每次出片都调。
- **[正文过长]** 九段 + 附件映射可能超模型上下文 → bundle 对大字段截断策略 + `videoPromptBrief` 优先。
- **[预览=请求]** 渲染后若用户改连线未重渲染 → 依赖 fingerprint stale；面板必须显眼。
- **[双写回归]** 回退与渲染两路径 → 验收脚本双轨断言。

## Migration Plan

1. 加字段与技能，默认不渲染。
2. 面板加「模板渲染」按钮；设置页模型。
3. 文档说明；可选「本集批量渲染」工作台动作。
4. 稳定后考虑把 `prompt` 技能默认改为只写 brief，由渲染出终稿（非首期）。

## Open Questions

- `submit_prompt_renders` 与现有 `submit_prompts` 合并还是新契约（实现时看工具数量）。
- 转场是否在单次渲染中合并 `cinematic-transition`（减少两次 Agent）—— 可二期把 director handoff 直接进 bundle。
