# Design

## Context

- 当前阻塞链有三处（见 `proposal.md - Why`）：`buildTransitionVideoPreview` 缺边界即 blocking、`generateTransitionVideo` 缺边界即 throw、`vite.config.ts` 的 `transitionMode` 只看「两帧都有」。
- `transitionRefSubmitAllowed` 与 `styleRefOmitReason` 把「首尾直变 + 支持尾帧 + 有尾帧」当作参考图互斥条件，本质上是「本次是否真的送尾帧」。
- `transitionRequestSeconds` 用 `supportsLastFrame`（模型能力）决定是否裁剪，而裁剪应取决于本次是否提交尾帧。
- 服务端已有两条通道：方舟 `buildVideoPayload` 在没有 `refs`/`vids`/`first` 时抛「缺少首帧图片或参考图」；APIMart 的 `buildApimartVideoPayload` 允许只带 prompt（generic / seedance / kling 都不要求图）。

## Goals / Non-Goals

**Goals:**

- 首尾帧变成可选输入，不阻塞生成。
- 提交模式由实际输入决定，前后端一致。
- 纯文本生成只在模型声明能力时放行。

**Non-Goals:**

- 不实现「自动生成过渡关键帧」的新产线（现有 keyframe 旧数据仍只读兼容）。
- 不改 APIMart / 方舟的 payload 字段名。
- 不猜测哪些模型支持文生视频；只认 `features.textToVideo`。

## Decisions

### 1. 单一「输入模式」推导函数

**决策：** 在 `transitionGen.ts` 新增 `resolveTransitionInputMode({ boundary, refs, video, features })` 返回 `'boundary' | 'first-frame' | 'reference' | 'video-reference' | 'text' | 'none'`，预览、请求、面板摘要、服务端都调用同一套判定顺序。

**备选：** 三处各自 if/else。否决：当前 bug 的根因就是三处规则不一致。

### 2. 纯文本门禁放在能力位，不放在模型名

**决策：** `ModelFeatureSet` 增加 `textToVideo?: boolean`。只有显式声明的模型在 `text` 模式可生成；其余在无其他输入时 blocking。

**备选：** 按模型族硬编码（seedance 系列一律允许）。否决：APIMart 目录里有多少模型真的能吃纯文本没有逐个验证过，硬编码会在真实调用时失败，且失败信息来自上游、对用户不可读。

### 3. 裁剪由「是否提交尾帧」决定

**决策：** `transitionRequestSeconds(target, model, submitsLastFrame, opts)` 第三参数语义从「模型支持尾帧」改为「本次真的提交尾帧」。调用方传 `mode === 'boundary'`。

**备选：** 保持模型能力语义。否决：只选首帧时仍会按不裁剪处理，导致成片比目标长。

### 4. 参考互斥按实际提交判断

**决策：** `transitionRefSubmitAllowed` / `styleRefOmitReason` 的入参改为 `submitsLastFrame`（布尔）而非 `(bridging, supportsLastFrame, hasIn)` 三元组。

**备选：** 保留三元组，在调用处预先算好。否决：签名继续鼓励调用方各自推理，容易再漂移。

### 5. 服务端模式推导与客户端对齐

**决策：** `vite.config.ts` 把 `transitionMode` 拆成 `boundaryMode | firstFrameMode | refMode | textMode`，按同一顺序判定；`rawTransition && !transitionMode` 的 400 分支删除，改为仅当「没有任何图片输入且模型不支持纯文本」时报错。

**备选：** 客户端算好传 `mode` 给服务端。否决：服务端仍需自校验，否则直连接口可绕过；两边各算一遍但用同一份规则文档约束。

### 6. 方舟通道的纯文本支持

**决策：** `buildVideoPayload` 在无 `refs`/`vids`/`first` 时不再抛错，改为只发 text content。仅当调用方显式声明 `textToVideo` 时允许走到这条分支。

**备选：** 方舟通道拒绝纯文本。否决：方舟 Seedance 2.0/2.5 支持文生视频，拒绝会白丢能力。

## Risks / Trade-offs

- **[Risk] 纯文本转场与分镜内容脱节** → 提示词仍由两镜景别/运镜/台词拼装（`autoTransitionVideoPrompt`），不是裸文本。
- **[Risk] 上游拒纯文本** → 只在声明能力的模型放行；失败时错误来自上游并原样透出。
- **[Risk] 单首帧时成片变短** → `trimTo` 明确裁到目标时长，面板显示「裁到 X 秒」。
- **[Risk] 用户误以为没抽帧就不能生成** → 摘要显示当前输入模式，面板文案说明可选。

## Migration Plan

- 无数据迁移。已存 boundary 继续走 `boundary` 模式。
- 模型能力位新增字段，旧模型条目缺省为 `false`（即不支持纯文本），行为不会突然放宽。
- 回滚：恢复三处 blocking 与 400 分支即可。
