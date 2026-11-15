# Design

## Context

单镜出片的时长目前有三处各自算：

- `buildShotVideoRequest`（`src/videoPrompt.ts`）：`const seconds = Math.round(Number(d.seconds) || 0)`，原样进请求。
- 原生音频能力判断：`nativeAudioGateSeconds` 先把秒数抬到 `caps.minVideoSeconds + 1` 再交给 `nativeAudioRef` 判定，所以门禁用的是「抬后值」，请求带的是「未抬值」，两者不一致。
- 界面与成本：`Inspector.tsx` / `OutgoingVideoPromptPanel.tsx` / 成本估算各自写 `Math.min(12, Math.max(2, Math.round(d.seconds)))`，与请求也不完全一致。

可复用的既有件：`types.ts` 的 `effectiveSeconds`（`round` 后夹到 2–12）、`transitionGen.ts` 的 `videoMinSeconds`（按模型族返回下限）和 `transitionRequestSeconds`（转场已在做「下限 + 原生音频 5 秒」）。转场路径已经正确，单镜路径没有跟上。

服务端 `server/video.mjs`（`videoCapsFor`）与 `server/apimart.mjs` 对时长区间和「原生音频须大于 4 秒」是最后兜底，本次不放松。

## Goals / Non-Goals

**Goals:**

- 单镜与转场共用同一个「最终请求秒数」求解函数，返回秒数和抬升原因。
- 原生音频门禁、请求体、面板摘要、成本估算、Agent 提交读同一个值。
- 「出片设置」内可直接改时长，并在秒数被抬升或取整时同时显示镜头时长与请求秒数。

**Non-Goals:**

- 不改变镜头数据模型，不新增字段，不迁移旧项目。
- 不从运镜文案或语义层推导时长（时长仍是显式输入）。
- 不放宽服务端 `> 4 秒` 校验，也不改成本单价公式。
- 不改分镜卡片的秒数展示（仍显示镜头时长），只在 Inspector 与出片面板标注请求秒数。

## Decisions

### 1. 新增纯函数模块 `src/videoSeconds.ts` 作为唯一时长求解入口

```ts
export type RequestSeconds = {
  seconds: number
  /* 抬升原因；null 表示只是四舍五入/夹取，没有额外抬升 */
  floor: { kind: 'model-min' | 'native-audio'; value: number; min: number } | null
}

export function videoMinSeconds(modelId?: string): number
export function videoMaxSeconds(modelId?: string): number
export function shotRequestSeconds(input: {
  seconds: number
  modelId?: string
  nativeAudio?: boolean
  nativeAudioMinVideoSeconds?: number
}): RequestSeconds
```

求解顺序：`round(镜头时长)` → 夹到 2–12 → 不低于 `videoMinSeconds(modelId)` → 原生音频再抬到 `max(下限, minVideoSeconds + 1)`。`nativeAudio` 为真但没有能力信息时只套用模型下限。

放在新模块而不是 `types.ts`，是因为 `transitionGen.ts` 已经从 `types.ts` 取类型，把求解函数塞回 `types.ts` 会让 `types → transitionGen` 形成环。`transitionGen.ts` 的 `videoMinSeconds` / `transitionRequestSeconds` 改为从新模块转出复用，调用方（`App.tsx`、`TransitionPanel.tsx`）不改导入。`nativeAudio.ts` 的 `nativeAudioGateSeconds` 删除，其调用点只保留一处（`videoPrompt.ts`），改由 `shotRequestSeconds` 提供秒数。

替代方案：把抬升写进 `buildShotVideoRequest` 内部。放弃，因为界面要在不拼装请求的前提下显示请求秒数，必须能独立调用。

替代方案：客户端完全不做抬升，让服务端 400 后重试。放弃，因为用户看到的是失败，而且成本确认按 4 秒算、实际按 5 秒出。

### 2. `buildShotVideoRequest` 只求解一次秒数，原生音频门禁读同一值

`ShotVideoRequest.seconds` 改为 `shotRequestSeconds(...).seconds`；`nativeAudioRef` 的 `seconds` 参数直接传该值，不再传 `nativeAudioGateSeconds(...)` 的结果。这样门禁通过就等于请求合法，`floor` 也会作为信息项进入 `warnings`（如「原生音频须大于 4 秒，请求已按 5 秒提交」），不会变成 blocking。

替代方案：把抬升只体现在请求里、不改门禁。放弃，因为门禁继续用抬后值就等于自证，一旦求解逻辑变化又会分叉。

### 3. 秒数进入拼装结果的可见字段

`ShotVideoRequest` 增加 `shotSeconds`（镜头时长原值）与 `secondsFloor`（抬升原因），拼装完成后 UI 与成本一律用 `seconds`。面板摘要措辞：两者相同显示 `6s`；不同显示 `镜头 4.2s → 请求 5s（原生音频须大于 4 秒）`。

### 4. 界面：`出片设置` 内联时长输入，且与「运镜与语义」同源

`Inspector.tsx` 的 `videoSettings` 折叠区在模型/分辨率之后加 `时长（秒）` 数字输入（`step="0.1"`、`min="0.1"`），`onChange` 写 `set({ seconds: ... })`，与「运镜与语义」的字段是同一份 `ShotData.seconds`。摘要行的 `Math.min(12, Math.max(2, Math.round(d.seconds)))` 与 `videoCost(price, Math.round(d.seconds), vidRes)` 全部换成请求秒数。`OutgoingVideoPromptPanel.tsx` 与 `inspectorLayout.ts` 的 chip 同步。

### 5. 越界前置提示，不新增阻止项

客户端 `max` 目前所有登记模型都 ≥ 12，与 2–12 夹取冲突不可达，所以只加 warning：请求秒数超过模型上限时提示「当前模型上限 X 秒」。下限则一律抬升而不阻止——阻止会让「镜头 3 秒 + Seedance 2.5」完全无法出片，抬升并显示差异更符合「一定要能生成」。

## Risks / Trade-offs

- [抬升秒数提高成本] → 成本估算与确认弹窗改用请求秒数；抬升时同时在面板显示镜头时长与请求秒数，用户在点「生成视频」前就能看到。
- [原生音频 `4.0–4.4s` 项目出片结果从 4s 变 5s] → 属于修复而非回归：这些请求此前会被服务端 400。视频指纹包含 `seconds`，出片成功后记录的是新值，不会与旧记录混淆。
- [旧验证脚本按 `Math.round(d.seconds)` 断言] → `verify-native-audio.mjs`、`verify-native-audio-ui.mjs`、`verify-video-prompt-preview.mjs` 按新语义补断言；断言「镜头 4s 时不提交 4s」这条必须新增。
- [`videoMinSeconds` 迁模块导致转场行为变化] → 转场 `transitionRequestSeconds` 保持返回结构与 `trimTo` 语义不变，仅内部改调 `shotRequestSeconds`，并用现有转场验证脚本回归。
- [未登记模型] → `videoMinSeconds` 对未知模型维持返回 2，只做四舍五入与夹取，行为与改动前一致。

## Migration Plan

无数据迁移：`ShotData` 不变，旧项目打开后按新求解逻辑提交。上线即生效，回滚只需还原前端求解与 UI 三处改动；服务端无需同步变更。
