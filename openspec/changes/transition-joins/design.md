# Design

## Context

现状与约束（动机见 `proposal.md`，行为契约见 `specs/shot-transitions/spec.md`）：

- 画布连线的 `relation` 只是标签：`src/ShotEdge.tsx` 决定颜色与虚线，`src/App.tsx` 把它写进导出的 JSON；播放与导出按节点/Timeline 顺序排列，`buildAnimatic`（`vite.config.ts:1544`）是单条 `concat` 直链硬切。
- 播放顺序来自节点数组顺序（Timeline 可拖动换序），不是画布连线；相邻参考解析用的是镜号排序，两套顺序并不等价。
- 边存在画布 localStorage；`project.json` 只存镜头。`server/db.mjs` 的 `shots` 表把固定列之外的字段收进 `extra`，读写时展开合并；`src/shotSync.ts` 的 `bizSignature` / `nodeToShot` / `shotToData` 是画布与项目数据的同步通道。
- 本机 ffmpeg 9.0.2 带 `xfade` 与 `acrossfade`；`fade` / `dissolve`、`wipeleft/right/up/down`、`slideleft/right/up/down` 都可用。
- 视频能力有硬边界：方舟 `reference_image` 最多 4 张且与 `first_frame` 互斥、没有 `last_frame`；APIMart Kling v3 只收首尾帧、不收参考图；APIMart Seedance 2.5 支持首 + 尾，但上游禁止尾帧与参考图混用（真实生成实测）。最短生成时长分别是 2s / 3s / 4s。
- 抽帧已有 `/api/frames`，支持传 `times` 精确取首尾帧。
- 预览是 DOM 播放，不可能调用 ffmpeg。

## Goals / Non-Goals

**Goals:**

- 一条边只暴露一个「接缝」概念，效果转场与生成转场共享同一套时间与渲染管线。
- 预览、时间线、导出由同一份剪辑序列派生时间，消除三处各自累加导致的漂移。
- 转场配置与产物在换机、重推镜头、重建节点后仍然可用。
- 生成转场复用现有图像/视频路由与参考解析，不引入新渠道。
- 服务端对旧客户端保持兼容：没有接缝数据时行为与现在完全一致。

**Non-Goals:**

- 不做转场音频、遮罩、alpha 叠加、三镜以上的多人转场。
- 不做生成转场的自动批量或自动选型。
- 不追求擦除/推移在浏览器预览里的逐像素保真。
- 不把转场编辑暴露给 Agent 聊天或 MCP 工具。
- 不新增项目级转场模型设置（沿用项目当前图像/视频模型）。

## Decisions

### 1. 接缝是边数据，转场产物随源镜头持久化

画布边上的 `data.join` 是渲染指令；真正需要跨机器、跨画布重建保留下来的配置与产物写在**源镜头的 `transitionOut`** 里：

```
ShotData.transitionOut = {
  to: <目标 shotId>,                 // 稳定业务标识，不是 node id
  mode: 'effect' | 'generated',
  effect?: { type, dir, seconds },   // 与 generated 并存
  generated?: {
    targetSeconds, prompt, refIds, inheritRefs,
    boundary: { out, in },
    keyframe: { candidates[], activeIdx, image },
    video: { url, modelKey, seconds },
  },
  meta?: { fingerprint, stale, createdAt }
}
```

选择它的理由：`project.json` 的 shots 表已经把未知字段收进 `extra`，不需要加表或改 schema；`mergeShots` 按 `id` 合并，重推镜头不会丢；`bizSignature` 加上这个字段就能触发写回。把转场放在独立的 `transitions` 表也可以，但要新增表、路由字段、合并逻辑和迁移，收益只是语义更纯。

边仍然是用户操作的把手：关系仍存在边的 `data.relation` 里。加载画布时，对每条 `transitionOut` 按 `to` 解析目标镜头，若对应边缺失则按 shotId 对修复/重建一条转场边；这样节点 id 变化不会丢转场。删除边时清除源镜头的 `transitionOut`；如果该转场已有生成产物，删除前需要确认，避免误删花过时间的资产。

替代方案：把转场做成独立节点（A → T → B）。它能让角色/素材直接拖线进来，但播放序列、时间线、导出都要认识新节点，且拆掉了「线就是转场」的心智模型，不采纳。

### 2. 效果转场重叠，生成转场插入 + 两端短叠化

```
cut          A | B                    时长 = A + B
effect       A ~~ B   (重叠 T)        时长 = A + B - T
generated    A ~~ [T片段] ~~ B        时长 = A + T + B - 2f
                    ^ 插入片段 + 两端短叠化 f
```

效果转场直接用 `xfade` 的语义，重叠是它天生的行为。生成转场是一段完整画面，无法在不做遮罩的情况下真正重叠，所以采用插入；两端各 0.2 秒叠化，一是让时间账和效果转场共用 `xfade`，二是隐藏「上一镜尾帧 → 关键帧」之间的切点。

替代方案：让生成片段整段淡入淡出（更像效果）——内容会糊，否决；让它整段硬切插入（不接受跳切）——连续性差，否决；裁掉 A 的尾和 B 的头来腾时间——会破坏关键帧与边界的承接关系，否决。

### 3. 一份剪辑序列作为唯一时间源

新增 `buildEditList(nodes, edges, options)`，输出有序条目与接缝：

```
items: [
  { kind: 'shot', node, duration, joinIn: cut },
  { kind: 'shot', node, duration, joinIn: effect(0.5, fade) },
  { kind: 'transition', edgeId, duration: 1.2, joinIn: effect(0.2, fade) },
  { kind: 'shot', node, duration, joinIn: effect(0.2, fade) },
]
```

- `start` 由折叠得出：`cut` 的起点等于上一段结束；`effect` 的起点等于上一段结束减 T。
- 转场只对播放序列中相邻的两镜生效；不相邻的边被忽略并在结果里带出 `inactive` 列表，供画布标「未参与成片」。
- 配音/字幕的绝对时间一律从镜头条目的 `start` 加用户偏移得出，不再由每处自行累加。
- `Timeline` 的画面轨、`Preview` 的播放列表、导出的 `segments` 全部改读这份结果。

替代方案：在 Timeline、Preview、导出三处各加一次转场累加。改动看似更小，但三套时间账必然漂移，尤其生成转场是加法、效果转场是减法，不采纳。

### 4. 导出按接缝折叠，保持混合链路

`buildAnimatic` 改为接收 `segments`（含转场片段）与可选的 `joins`：

- 每段先做现有的 `scale / pad / fps / format` 归一化。
- 从左到右折叠：`cut` 用 `concat`，`effect` 用 `xfade=transition=<type>:duration=<T>:offset=<前一段结束 - T>`。生成转场本身是普通片段，它与前后镜头的接缝就是两个 0.2 秒的 `effect`。
- 总时长与每段起点来自服务端按真实片长重算后的折叠结果；视频实际时长与名义时长不一致时，接缝时长要再次夹紧。
- 音频继续用现有的绝对延迟 + `amix`：总长改为折叠后的总长，镜头起点改为折叠后的起点；生成片段不参与音频。重叠区天然形成 L/J 切，不需要 `acrossfade`。
- 字幕：有 libass 时在折叠后烧 SRT；没有 libass 时仍按段叠整帧 PNG，过渡区会出现两段字幕短暂交叉，时长 ≤ 0.5 秒，接受。
- `/api/assemble` 的 `joins` 是可选项：不传时走原 `concat` 路径，旧客户端和旧服务端可以各自先上线。

风险点是 `xfade` 与 `concat` 混在一条 filter graph 里。实现时把折叠封装成一个纯函数，用固定片段和真实文件各跑一遍 verify，避免在路由层拼字符串。

### 5. 生成转场：关键帧先行，按模型能力分流

流程：

```
A 尾帧 / B 首帧（/api/frames）
角色 / 素材（A、B 两镜 refIds 并集 + 边上补充）
        |
        +--> 关键帧候选（Seedream，<=10 张参考）
                |
                +--> 转场视频
```

- 边界帧：A 有视频取 `duration - 1/fps`，否则用 A 的当前画面；B 有视频取 `0`，否则用 B 的当前画面。
- 参考：默认继承两镜的 `refIds`（角色/素材），边上可增删；结构参考（A 尾/B 首）优先占位，其余按角色、素材顺序填充到图像模型上限。
- 关键帧提示词可编辑，默认拼上一镜与下一镜的 `videoPrompt`/`prompt`，强调「同一空间、同一人物、过渡瞬间」。
- 视频请求按所选模型能力分流，**关键帧永远作首帧**：
  - 方舟（默认、最可移植）：`first_frame = 关键帧`，不送参考图（方舟的参考图与首帧互斥）。
  - APIMart Seedance 2.5：`first_frame = 关键帧`、`last_frame = B 首`，不送参考图；首尾帧任务的比例必须是 `adaptive`（真实生成实测）。
  - APIMart Kling v3：`first_frame = 关键帧`、`last_frame = B 首`，不收参考图。
- 时长：用户目标默认 1.2 秒、范围 0.8–3 秒。生成时长取「模型下限」与「目标 + 两端叠化 + 余量」的较大者；只有首帧的模型生成后裁掉尾部到目标时长，首尾帧模型保留整段并在界面提示最短时长，避免破坏 B 侧终点。
- 产物静音；关键帧与视频候选都允许重试和切换。

替代方案：不做关键帧直接首尾插值。省一步，但方舟链路没有尾帧，且角色/素材参考进不了视频；关键帧正好把 10 张参考压缩成 1 张视频首帧，所以保留为必经步骤。

### 6. 失效判定用指纹，不自动删除

`meta.fingerprint` 由这些输入做 `shortHash`：A 的 `refImage`/`videoUrl` 本地路径、B 的 `refImage`/`videoUrl`、关键帧 URL、提示词、目标时长、模型键。任一项变化即 `stale`。

- 失效只打标，不删关键帧和视频；用户仍可导出，导出结果报告数量。
- 文件被原地覆盖、URL 不变的情况检测不到；这是已知限制，靠重新出片产生新 URL 覆盖绝大多数场景。

### 7. 交互：保留快速循环，详情进面板

- 点 chip 仍循环四种关系，保留现有肌肉记忆；落到转场时立刻写默认叠化 0.5 秒，chip 显示 `叠化 0.5s`。
- chip 右侧出现小箭头，点开转场面板；面板同时是边选中后的详情面板。
- 面板：接缝模式分段控件；效果网格（叠化/擦除/推移 + 方向 + 时长）；生成区（边界帧缩略图、参考选择器、提示词、关键帧候选、视频、状态、估算成本、失效提示）；底部显示「成片 -0.5s / +0.8s」。
- 「全片统一叠化 0.5s」放看板菜单，只改效果模式的边，跳过生成转场。
- 缺省值在读时兜底：`relation === 'transition'` 且没有接缝数据时，按叠化 0.5 秒解释，不写存档。

### 8. 预览保真度

预览读同一份剪辑序列。叠化用两层媒体叠加透明度，忠实呈现；擦除/推移用 `clip-path` / `transform` 近似，并在面板和播放器上标注「以导出为准」。总长必须与时间线一致。替代方案是用 ffmpeg 预渲染预览，慢且违背预览的用途，不采纳。

## Risks / Trade-offs

- [混合 `concat` + `xfade` 的 filter graph 容易拼错] → 折叠逻辑抽成纯函数，用 fixture 和真实文件各跑一遍 verify；单条接缝失败时降级为硬切并报告。
- [时间漂移] → 只允许 `buildEditList` 产生时间；时间线、预览、导出三处禁止自行累加；verify 对比显示总长与导出总长。
- [生成转场变长、效果转场变短，混用后用户对总长没有预期] → 面板显示每条边的净时长变化，时间线把转场画成真实片段/重叠带。
- [旧客户端/新服务端版本错配] → `joins` 可选，缺失时走原路径；客户端与服务端同批发布。
- [画布边在 localStorage，换机器后没有连线] → 转场配置在镜头数据里；加载时按 shotId 对修复/重建边。
- [相邻判定与镜号排序不一致] → 以 Timeline 的播放顺序为准，不用镜号排序；不相邻显示「未参与成片」。
- [短镜头夹紧后转场失效] → 统一夹紧到短镜 80%、最低 0.2 秒，再短退硬切并提示。
- [预览擦除/推移近似] → 明确标注以导出为准；叠化保持忠实。
- [生成成本与等待] → 逐条手动触发，面板给估算成本；批量动作显式跳过生成转场。
- [字幕在叠化区短暂重叠] → 接受 ≤0.5 秒的交叉；有 libass 时走折叠后的 SRT，避免叠加。

## Migration Plan

- 无破坏性迁移：旧存档的转场边按缺省叠化解释，不写回。
- 新增的 `transitionOut` 走 shots 表的 `extra`，不需要 `ALTER TABLE`；旧项目读出来就是空。
- `/api/assemble` 新增可选 `joins`，不传时行为不变；先发服务端再发前端也能工作。
- 回滚：忽略 `transition_out`，导出退回纯 `concat`；生成的关键帧与视频仍在 `public/` 下，不丢文件。
- 验证：扩展 `verify-export.mjs` 覆盖混合接缝；新增 `verify-transitions.mjs` 覆盖默认叠化、夹紧、插入时长、非相邻、失效与持久化。

## Open Questions

- 是否要给转场单独配置图像/视频模型（而不是跟随项目默认）。当前按项目默认实现，后续可在设置页加一项，不影响规格与任务拆分。
- 擦除/推移在预览里是否需要逐像素保真。规格允许近似并标注，后续若用户要求再升级为 canvas 合成。
