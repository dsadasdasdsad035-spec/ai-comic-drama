# Design

## Context

出片请求目前由 `src/App.tsx` 的 `generateVideoOne` 在点击时拼装：参考图经 `collectShotReferences` 解析、按「当前画面 → 表情 → 角色 → 相邻镜 → 场景/道具 → 手工 → 调度帧」排序后截到 4 张；提示词依次拼运动文本、运镜走位、原生音频段、参考图图注和 3D 视频约束。Inspector 只能编辑 `videoPrompt` 这一个原料，拼装结果不落盘。项目已有多个「结果 + 指纹」的先例（`audioMeta`、`voiceMeta`、`sceneCodeMeta`、转场关键帧里保存的 `prompt`），本设计沿用同一模式。参考规格：`proposal.md`、`specs/shot-video-prompt/spec.md`。

## Goals / Non-Goals

**Goals:**

- 出片前的预览与实际请求由同一份拼装结果产生，结构上不可能漂移。
- 面板同时回答两件事：实际附加了哪些参考（事实），以及最终正文是什么（可改）。
- 手改可持久化、可恢复自动、输入变化后明确提示旧快照。
- 生成成功后能回看当前视频的提示词来源。

**Non-Goals:**

- 不建立 3D 视频里人物与角色的对应关系，不写「替换背景/场景/道具/人物」契约；那是独立的 3D 参考变更。
- 不改变 `/api/seedance`、`/api/apimart` 的请求字段或服务端校验。
- 不做卡片内联编辑、不做每次出片前的确认弹窗。
- 不改变参考图 4 张上限和现有排序，只在面板中显式列出省略项。
- 不改变当前「模型不支持但仍会提交参考视频」的请求行为，只提前警告。

## Decisions

### 1. 新增 `src/videoPrompt.ts` 作为唯一拼装器

`buildShotVideoRequest(input)` 返回一个结构：

```text
{
  prompt,                 // 最终正文，预览与请求共用
  mode,                   // first | ref | video | native
  refs: [{slot,url,label,purpose}],   // 实际提交的前 4 张
  omitted: [{label,reason}],          // 被上限截掉的
  videoRef: {url,label,purpose} | null,
  audioRef: {character,url,label,purpose} | null,
  textSource: 'video_prompt' | 'prompt_fallback',
  warnings: [{level,code,message}],
  blocking: [{code,message}],         // 出片会被阻止的原因
  fingerprint,                        // 输入指纹
}
```

`generateVideoOne` 改为调用它并直接使用返回的 `prompt`、`refs`、`videoRef`、`audioRef`；Inspector 的面板渲染同一个返回值。替代方案是让 Inspector 自己拼一份预览，但那会产生两套逻辑，正是本变更要消灭的漂移。拼装器保持纯函数，不读 DOM、不发请求，可用 `verify-*.mjs` 在页面里动态 import 做单测。

### 2. 预览在 App 计算，Inspector 只负责渲染

Inspector 目前拿不到全部镜头节点，无法解析相邻镜参考。App 已持有 `nodes`、`characters`、`missingMedia`、`sceneLayouts`、`projectAspect`、模型设置，因此用 `useMemo` 对选中镜头计算 `request` 并作为 prop 传给 Inspector。替代方案是把 `nodes` 传进 Inspector 让它自己算，会把参考解析逻辑扩散到 UI 层，不采用。

调度是否就绪的判断目前内联在 `generateVideoOne`，需抽成共享 helper（输入镜头、场景布局、走位、时长、画幅，输出 ready/reason），供拼装器和生成共用。

### 3. 手改是「整段快照」，不做自动打补丁

手改保存为：

```text
videoPromptOverride: {
  text: string,
  fingerprint: string,
  createdAt: string,
}
```

生成时若存在 override，逐字发送 `text`，不再追加任何自动段落；附件仍按当前实际参考提交。替代方案是把手改内容按段落合并回自动拼装（例如只替换图注段），但用户可能重写任意行，自动合并会产生不可预测的文本，不采用。

选择「保存到本镜」而不是「只对下一次生效」：一次手改往往需要多次重试出片，且出片后要能解释当时用了什么；临时修改会丢失。代价是输入变化后需要显式「重新拼装」，用旧快照徽标提示。

状态机：

```text
        点「编辑」并保存                点「恢复自动拼装」
自动拼装 -------------------> 手改快照 ---------------------> 自动拼装
   |                            |
   | 输入变化                    | 输入变化（指纹不匹配）
   v                            v
自动更新                     手改快照 + 旧快照徽标
                              （仍可用于出片）
```

### 4. 指纹覆盖会影响正文的输入

`fingerprint = shortHash(JSON.stringify(...))`，输入包括：

- 实际使用和被省略的参考：URL、标签、顺序、source
- 模式（first / ref / video / native）
- 当前画面 `refImage`
- 运动文本来源与内容（`videoPrompt` 或回退的 `prompt`）
- `motionNote` / `liveMotionNote`、时长、景别、运镜
- 台词逐行（speaker + text）、表演里的 speaks/emotion
- 音色参考（角色 + URL）
- `useScheduleVideoRef`、`useScheduleFrames`

模型 key 不进指纹（换模型不改正文），但会进 `videoMeta`。过期只影响提示，不阻止出片；这样用户保留手改的意图不会被系统否决。

### 5. 实际附件与正文严格分离

面板上半部分是只读事实：`图N=标签 · 用途`、`视频1=…`、`音频1=…`、省略项、模式、秒数、分辨率。下半部分才是正文编辑器。附件集合只由画布连线、3D 开关和音色样本决定；编辑正文不会增删附件。这样用户删掉某行图注时，图片仍会提交，面板也仍会列出它——避免「以为删了图注就不发图」的误解。

用途文案由 `ResolvedShotReference.source` 映射：当前画面=画风/构图，expression=表情，character=人物外观，adjacent=相邻镜连贯，asset scene=场景外观，asset prop=道具外观，extra=手工参考，schedule frame=走位/机位，video=运动关系，audio=音色。

### 6. 手改参与 `handEdited`，但键必须是 `video_prompt_override`

`mergeGenerated` 用 `handEdited` 里的键直接回填 `ProjectShot` 字段，已有用法是 `transition_out`，所以新增键必须是蛇形 `video_prompt_override`，不能写 camelCase。保存手改时加入该键，恢复自动时移除。`bizSignature`、`nodeToShot`、`shotToData` 同步增加 `videoPromptOverride` / `video_prompt_override`，否则只改手改文本不会触发写回。

### 7. `videoMeta` 记录来源，并用 URL 对齐当前视频

生成成功时写入：

```text
videoMeta: { url, prompt, fingerprint, modelKey, createdAt }
```

面板只在 `videoMeta.url === videoUrl` 时展示「当前视频的提示词」；否则显示「未记录」。这比在每个清空 `videoUrl` 的分支里手动清 meta 更稳，手动挂载已有视频、移除画面等路径都不会留下错误来源。`mergeGenerated` 像 `audio_meta` 一样在生成结果缺失时保留旧 `video_meta`。

### 8. 阻止与警告在提交前给出

拼装器返回 `blocking` 与 `warnings`，App 的 `generateVideoOne` 用同一份结果决定是否提前终止并保留现有报错文案；Inspector 在按钮上方显示：

- `blocking`：相邻镜缺画面、原生音频条件不满足、3D 调度过期
- `warning`：模型不支持视频参考/原生音频、参考图超限省略、手改旧快照

「模型不支持视频参考」只警告，不改变请求：当前代码仍会提交并在服务端失败，预览必须如实说明这一点，不能假装会回退。`3d-reference-toggle` 已把「不支持时自动忽略」记为另开变更。

### 9. 修正调度关键帧的互斥句

当前所有参考图共享一句「主体外观、场景与道具必须与参考图一致」，与调度帧图注「只取走位与机位变化」互斥。拼装器改为分组：

```text
参考图：[图1]=角色「陈默」外观，[图2]=3D 调度关键帧：只取走位与机位变化。
人物外观、场景与道具以图1…等外观参考为准；
标注为 3D 调度关键帧的图片只用于走位与机位，不要求外观一致。
```

没有调度帧时保持原句不变，确保旧项目回归只有这一处允许的文本差异。

### 10. 面板位置与交互

放在 Inspector 视频生成区、3D 参考开关之后、`生成视频` 按钮之前。头部常显一行摘要：`本次出片提示词 · 自动拼装 / 已手改 / 旧快照`；正文区可折叠，默认展开，最长约 240px 后滚动。按钮：`编辑` → `保存手改` / `取消`；`恢复自动拼装`；旧快照时显示 `重新拼装`。手改生效期间，「运动提示词」字段下加一行说明「当前使用手改提示词，此修改不会影响出片」，避免两个真相。

## Risks / Trade-offs

- [预览与请求仍可能不一致] 预览用 React 状态、生成用 `nodesRef.current` → 两者都调用同一个纯函数，且评审要求端到端脚本拦截请求体逐字比对。
- [手改过期后用户没注意] 旧快照徽标 + 生成前摘要常显；不阻止出片是刻意取舍，避免系统否决用户意图。
- [项目文件变大] 每镜最多一份提示词快照和一份 meta，量级与现有 `sceneCode`/`audioMeta` 相当 → 可接受，不做压缩。
- [AI 重写与手改冲突] `handEdited` 保证保留，但用户可能忘记手改存在 → 面板和运动提示词字段都提示当前使用手改版本。
- [修正冲突句改变旧项目输出] 只在存在调度关键帧参考时生效；回归脚本对比改动前后请求，确认其余逐字一致。
- [模型不支持时预览仍显示视频参考] 这是当前真实行为 → 用 `warning` 明说「提交后会失败」，而不是伪造回退。

## Migration Plan

无数据迁移。`video_prompt_override`、`video_meta` 均为可选字段；旧项目读取为 `undefined`，走自动拼装和「未记录」。回滚时移除面板与字段读写即可，旧项目不受影响。上线前跑新增的预览验收和现有出片、视频参考、原生音频回归脚本。
