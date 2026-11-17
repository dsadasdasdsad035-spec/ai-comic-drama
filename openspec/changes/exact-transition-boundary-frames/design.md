# Design

## Context

当前抽帧链路：`TransitionPanel`（及 `OutgoingReferencePickerModal`）→ `ensureTransitionBoundary` → `videoFrames(url)` → `extractFrames(url, 2, undefined, [0])` 与 `[TAIL_FRAME_SSEOF_SEC = -0.1]` → `POST /api/frames` → `server/app.ts` 按时间正负选择 `ffmpeg -ss` 或 `-sseof`。

约束与已确认事实（详见 proposal.md）：

- 正时间分支（`-ss 0`）实测取到第 0 帧，准确，不动。
- 负时间分支 `-sseof -0.1 -i <v> -frames:v 1` 取到的是「片尾前 100ms 起的第一帧」，随帧率与关键帧间隔漂移（实测 30fps 落第 57/60 帧，24fps 落第 27/29 帧）。
- `-sseof -1 -i <v> -frames:v 1` **不能**用来「跳远一点再多取」：它取到的是片尾前 1 秒那一帧（实测第 30/60 帧）。
- `frameCache` 只在首尾都成功时缓存，`/api/frames` 单帧失败静默跳过。
- 既有 `probeDuration` 只用 `format=duration`，没有逐帧信息。

## Goals / Non-Goals

**Goals:**

- 尾帧落到解码器输出的最后一帧，且与帧率、关键帧间隔、片长无关。
- 首尾帧亮度可被判定，近黑只提示不拦截。
- 既有调用方零改动即可继续工作（`/api/frames` 只加字段）。

**Non-Goals:**

- 不做边界帧与成片 `videoUrl` 的版本绑定，不做「成片重出后强制重抽」（B 档）。
- 不做出片成功后的自动重抽（C 档）。
- 不改首帧抽取命令、不改输入模式降级链、不改 `generated.boundary` 结构与来源类别。
- 不做画面级重复帧检测（如两帧像素差阈值判断"是否真的连续"）。

## Decisions

### 1. 尾帧用「解码到片尾 + 覆盖写同一文件」，而不是更小的 `-sseof`

负时间分支改为：

```
ffmpeg -y -sseof <t> -i <video> -update 1 -q:v 2 <out.jpg>
```

即去掉 `-frames:v 1`，让 ffmpeg 从窗口起点一直解码到片尾，每解出一帧就覆盖写同一个 jpg，最终留在磁盘上的必然是最后一帧。

**为什么是 `-update 1` 而不是 `-sseof` 微调**：`-sseof` 只决定解码起点，任何固定窗口都会随帧率漂移；调到 `-0.03` 这类让 30fps 刚好命中末帧的值，在 24fps 或短片子上会直接越过片尾导致抽帧失败。`-update 1` 把「取第几帧」交给解码器自然结束的位置，与 fps/GOP 解耦。

**为什么不保留 `-frames:v 1`**：`-frames:v 1` 与 `-update 1` 组合会在窗口起点就停，等于退回现状。

**窗口大小取多少**：`-sseof -0.1` 仍可用（实测 -0.1/-0.5/-1/-1.5 在 `-update 1` 下结果一致），保留 `TAIL_FRAME_SSEOF_SEC = -0.1` 可让解码只跑片尾一小段；其语义由「时间点」改为「解码窗口起点」，注释同步更新。

**替代方案（未采用）**：

- `ffprobe -count_packets` / 按 PTS 精确定位末帧再 `-ss`：需要额外两次探测，且 PTS 运算在 VFR 片上更易出错，收益不抵复杂度。
- `select='eq(n\,<last>)'`：同样要先知道总帧数，且要整片解码。

### 2. 亮度检测放在服务端，用 `ffprobe` + `signalstats` 读抽到的 jpg

对每个成功写出的帧跑一次：

```
ffprobe -v error -f lavfi -i "movie=<file>,signalstats" \
  -show_entries frame_tags=lavfi.signalstats.YAVG -of default=nw=1:nk=1
```

取 `YAVG`（0–255 平均亮度，Y 平面）。

**为什么在服务端**：`/api/frames` 已经握着抽帧后的落盘路径与 `ffProbe()` 封装；放到前端要做 canvas 取像素，跨域与解码时序都更脆，且无法在接口验收脚本里断言。

**为什么用 `signalstats` 而不是 `scale=1:1` 取均值**：`signalstats` 直接输出 `YAVG` 标量，不需要解析像素；且本机与部署环境的 ffmpeg 都自带该滤镜（`drawtext` 缺失的 keg-only 环境同样有它）。

**为什么首帧也测**：下镜黑场淡入同样让尾锚点失去参考价值，规格要求两侧对称。

### 3. `/api/frames` 响应追加 `stats` 数组，与 `urls` 按下标对齐

```
{ ok: true, urls: [...], duration, times: [...], stats: [{ yavg: number, dark: boolean }] }
```

`stats[i]` 对应 `urls[i]`。抽帧失败的帧既不进 `urls` 也不进 `stats`，所以两个数组等长；调用方可用 `times[i]` 反查该帧是首帧还是尾帧。

**为什么不用 `frames: [{url, t, yavg}]` 合并结构**：`urls` 是既有契约，改成对象数组会打断 `src/videoFrames.ts` 等既有调用方；追加平行数组是纯增量。

**阈值**：`YAVG < 18`（约 7% 亮度）判为 `dark: true`。取 18 而不是更高值，是因为 18 以下基本只剩黑场与极暗夜景；真实夜景转场本来就该提示有限参考，不做特判。

### 4. 近黑提示走独立的非阻断通道，不复用 `extractError`

`ensureTransitionBoundary` 的返回从 `{ boundary, warnings }` 扩展为 `{ boundary, warnings, notices }`：

- `warnings`：抽取失败、缺成片——沿用现在的 `setExtractError`（`.gen-note.vp-field-note`）。
- `notices`：近黑——新增 state，渲染在同一个 `.gen-note` 位点但带独立 class（如 `gen-note vp-field-note boundary-dim-note`），不参与禁用逻辑。

**为什么不合并进 `warnings`**：现在 `warnings` 会被 `join('；')` 后塞进 `extractError`，语义是「抽取没成功」。近黑是「抽取成功但参考价值有限」，混在一起会让用户以为要重抽；而且后续若把 `extractError` 接到 blocking 或重试入口，近黑会误伤。

**为什么不新增 blocking**：规格明确近黑 MUST NOT 拦截生成。真帧优先是本能力的第一原则——宁可拿一张黑帧配提示，也不静默换帧或回退静帧。

### 5. `videoFrames` 缓存保持「首尾都成功才缓存」，但缓存值带上亮度

`frameCache` 的值从 `{ start?, end? }` 变为 `{ start?, end?, startYavg?, endYavg? }`，命中缓存时近黑判定使用缓存里的亮度，不再重跑 `ffprobe`。

**为什么不缓存近黑布尔**：阈值属于展示策略，缓存放原始 `YAVG` 才能在改阈值时不被旧缓存污染。

### 6. 修正两条写反的缺片文案

`ensureTransitionBoundary` 中上镜缺成片时提示「无法抽取首帧」（应为尾帧）、下镜缺成片时提示「无法抽取尾帧」（应为首帧）。直接改文案，不改返回结构与调用方。

## Risks / Trade-offs

- [片尾含多帧黑场或淡出黑场] → 这是「真末帧」，本能力按规格照用并提示近黑；不静默跳过黑帧去找"最后一张有画面的帧"，否则抽取结果不再可预测。
- [`-update 1` 在极短片上行为] → 实测 0.6s/18 帧片能正确取到末帧；若源片零帧或损坏，走既有单帧失败跳过逻辑，整次抽取不至于失败。
- [窗口内解码帧数变多，抽帧变慢] → 0.1s 窗口最多解 3–4 帧，相对现状增加可忽略；不扩大窗口到 1s 是为了避免解码开销。
- [新增 ffprobe 调用] → 每帧一次，最多两次；失败时只让 `stats[i].yavg` 缺失、`dark` 为 false，不让整次抽帧失败。
- [阈值 18 在产品上偏严/偏松] → 阈值集中在单处常量，改它不改契约；`notices` 是纯提示，误报代价低。
- [纯黑成片本身没参考价值] → 提示文案要说明"可考虑重出上镜或改接缝"，但不提供一键替换，避免绕过"只从成片抽帧"的原则。

## Migration Plan

无数据迁移：`generated.boundary` 结构与来源类别不变，已保存的旧边界继续可用；重抽才会拿到真末帧。回滚只需把负时间分支恢复为 `-frames:v 1` 并忽略 `stats`，前端 `notices` 为空即无提示。

## Open Questions

- 近黑提示文案最终措辞与是否要顺带给出「重出上镜」跳转入口——不影响规格与任务拆分，实现时按现有 blocking 文案风格定。
