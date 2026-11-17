# Tasks

## 1. 服务端抽帧：尾帧取解码输出末帧

- [x] 1.1 改 `server/app.ts` 的 `/api/frames` 负时间分支：去掉 `-frames:v 1`、改为 `['-y','-sseof',String(tn),'-i',local,'-update','1','-q:v','2',out]`，正时间分支保持 `-ss` + `-frames:v 1` 不动，并在分支上方补中文注释说明「`-sseof` 只定窗口起点，`-update 1` 才是取末帧的关键」。验证：用 ffmpeg 生成「每帧亮度 = 帧号」的测试片（30fps/60 帧、24fps/29 帧、0.6 秒短片三种，`-g 250` 让全片只有一个关键帧），对三者分别跑新命令，用 `ffprobe -f lavfi -i "movie=<jpg>,signalstats"` 读 `YAVG` 反推帧号，断言都等于 N-1；再用旧命令跑同一批片，确认会落到 N-2/N-3（证明差异真实存在）。
- [x] 1.2 新增帧亮度探测：在 `server/app.ts` 里加一个复用 `ffProbe()` 的 `frameLuma(file)`，对每个成功写出的帧取 `signalstats` 的 `YAVG`，任何失败都只返回 `undefined`、不抛错、不影响抽帧结果。验证：对一张正常 jpg 与一个损坏文件分别调用，前者返回 0–255 的数值、后者返回 `undefined`，且损坏文件的抽帧请求仍返回 `ok: true`。

## 2. 服务端响应契约：`stats` 随帧返回

- [x] 2.1 `/api/frames` 成功响应在 `urls`/`times` 之外追加 `stats: [{ yavg, dark }]`，与 `urls` 按下标对齐（抽帧失败的帧不进任何一个数组），`dark` 用常量阈值判定；阈值集中成单个常量并注释「约 7% 亮度」。验证：用 1.1 的测试片请求该接口，断言 `stats.length === urls.length === times.length`；对一段以纯黑收尾的测试片断言尾帧 `stats[0].dark === true`，对正常片断言 `false`。
- [x] 2.2 新建 `verify-boundary-frames.mjs`（沿用 `verify-lib.mjs` 的 `requireServer` 约定）：用 ffmpeg 把 1.1 的三种测试片写到 `public/generated/`，通过 `/generated/<name>` 逐片请求 `/api/frames`，断言首帧是第 0 帧、尾帧是该片末帧（帧号由 `YAVG` 反推）、`stats` 与 `urls` 对齐，跑完删除测试片。验证：`APP_URL=<dev server> node verify-boundary-frames.mjs` 全绿，且 `public/generated/` 无残留 `verify-boundary-*` 文件。

## 3. 前端抽帧链路：透传亮度与近黑判定

- [x] 3.1 `src/api.ts` 的 `extractFrames` 返回结构补 `stats?: { yavg: number; dark: boolean }[]`，缺字段时按空数组处理，既有调用方（`src/videoFrames.ts`、`TransitionPanel`）无需改动即可编译。验证：`npx tsc --noEmit` 通过，且不改动 `src/videoFrames.ts` 仍有正确类型推断。
- [x] 3.2 `src/transitionGen.ts`：`frameCache` 的值扩展为同时保存首尾帧的 `YAVG`；`videoFrames` 把 `extractFrames` 的 `stats` 映射进缓存；`ensureTransitionBoundary` 返回 `{ boundary, warnings, notices }`，近黑写入 `notices`（上镜尾帧近黑 / 下镜首帧近黑各一条），抽取失败与缺成片仍只进 `warnings`。同时修正现有两条写反的缺片文案（上镜缺成片 → 尾帧、下镜缺成片 → 首帧）。验证：在 `verify-transitions-ui.mjs` 的 `/api/frames` 假响应里分别给出 `dark: true` 与 `dark: false`，断言前者只产生 `notices`、后者 `notices` 为空，且两种情况下 `warnings` 都为空、`generated.boundary.out/in` 都被写入。

## 4. 面板提示落位与文案

- [x] 4.1 `src/TransitionPanel.tsx`：新增 `extractNotices` state，接收 `ensureTransitionBoundary` 的 `notices` 并渲染在 `extractError` 同一提示位点但带独立 class（如 `boundary-dim-note`），文案说明「该帧接近黑场、连续性参考有限」，MUST 不进入禁用逻辑。验证：`verify-transitions-ui.mjs` 断言近黑时提示可见、生成按钮仍 `enabled`，正常帧时提示不存在。
- [x] 4.2 `src/OutgoingReferencePickerModal.tsx`：把说明文案从「上一镜成片的最后一帧 / 下一镜成片的第一帧」改成明确的「上镜成片解码输出的最后一帧 / 下镜成片的第 0 帧」，并在抽取按钮旁留出近黑提示的展示位（与 `TransitionPanel` 一致）。验证：`verify-transitions-ui.mjs` 断言弹窗文案包含「最后一帧」与「第 0 帧」，且不出现旧措辞。

## 5. 集成验收

- [x] 5.1 回归既有转场验收，确认本改动没有改到"生成时不重抽边界""输入模式降级链""首尾帧可选"等既有行为：跑 `node verify-transitions.mjs`、`node verify-transitions-ui.mjs`、`node verify-video-prompt-preview.mjs`、`node verify-tail.mjs`，全部通过。
- [x] 5.2 端到端手验一次真实项目：对一个已有两镜成片的转场点「抽取两镜成片帧」，肉眼确认首帧是上镜最后一个画面、尾帧是下镜第一个画面；再对一个淡出黑场收尾的上镜重复一次，确认黑帧照常写入槽位且提示出现、生成仍可用。验证：截屏保存前后对比，并在转场面板确认 `generated.boundary.out/in` 指向新抽的 `sched-*.jpg`。
