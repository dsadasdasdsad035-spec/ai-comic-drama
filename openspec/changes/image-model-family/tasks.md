# Tasks

## 1. 生图能力谓词

- [x] 1.1 `src/modelCaps.ts`：在 `modelHasCap` 里让 `image` 与 `view` 互相蕴含——模型声明了任一，两个方向都为 true；保留 `videoRef` 的 `supportsVideoRef` 分支与「旧条目无 caps 时回退单一 cap」的语义，其余能力不受影响。注释说明「生图家族」以及它为何不是第二个谓词。
- [x] 1.2 确认 `server/app.ts:164` 仍从 `src/modelCaps` 引用同一实现，没有服务端副本需要同步改。

## 2. 选择列表与默认位

- [x] 2.1 `src/ModelSelect.tsx`：新增 `capModelEntries(settings, cap, caps?, preferKey?)`，列表按 `${provider}\0${model}` 去重，同名条目优先保留 `preferKey` 指向的行（已选键必须留在列表里，否则下拉显示空白），其次保留 `cap` 等于本次能力的行，顺序按首次出现稳定不变；`CapModelSelect` 改用它并传 `value || defaults[cap]` 作为 `preferKey`，`caps` 参数的既有语义不变。设置页默认位（`RoutingPane`）与创意能力托盘（`CapabilityTray`）同样改为走它，避免同一模型在两处以重复项出现。
- [x] 2.2 `src/AssetBoard.tsx:248` 的预过滤从 `m.cap === 'image'` 改为 `modelHasCap(m, 'image') && isRunnableModel(m)`，避免下拉选得到却在生成前被拦；提示文案改为「生图模型」。
- [x] 2.3 给生图位置的下拉补 `caps={IMAGE_CAPS}`：`src/AssetBoard.tsx` 设定图与三视图、`src/CharacterBoard.tsx:154` 三视图模型、`src/Inspector.tsx` 出图模型。`CharacterCard.tsx:1065` 是配音引擎下拉（三视图下拉实际在 `CharacterBoard`，该处由 `viewModel` 透传），不需要改。
- [x] 2.4 确认 `src/settings/useSettingsWorkbench.tsx:584` 的 `invalidDefaults` 与 `src/settings/hubs/pipeline/RoutingPane.tsx:27` 的渠道可用性判断随谓词自动放宽，不再有单独按 `m.cap` 卡生图的地方。
- [x] 2.5 确认 `src/creative/CapabilityTray.tsx:34` 的托盘列表与 `src/creative/tools.ts:87` 的解析落在同一批模型上，创意会话里也能选到全部生图模型。

## 3. 服务端解析与参考图

- [x] 3.1 `server/app.ts` 的 `pickModel`：确认跨能力 key 在放宽后能直接命中，不回落默认位；补一句注释说明生图家族的 key 在两个 cap 下都有效。
- [x] 3.2 `server/app.ts` 图像路由：在分渠道前判定「带参考图且（provider kind 不支持参考图，或 `imgEntry.features?.imageRef === 'none'`）」，命中时返回 `400`、`{ ok: false, message: '模型「X」不支持参考图，请换一个支持参考图的模型', kind: 'unsupported' }`；apimart 分支里重复的同类判断随之删除，两边共用同一条前置校验。
- [x] 3.3 删掉该路径上的 `dropRefs` 收集，以及成功响应里的 `warning` / `droppedRefs` 字段；不带参考图的请求仍走原路径，apimart 的「参考图全部不可用」分支保留。
- [x] 3.4 确认 `src/agent/materialTools.ts` 的三视图 / 表情总图调用拿到的 400 `message` 能透出给用户（`generateImage` 抛错 → 工具 catch 返回 `{ ok: false, error }`），不需要新增分支。

## 4. 验证

- [x] 4.1 `verify-model-caps.mjs`：把「旧图像条目不自动承接三视图」改成本意相反的断言——旧图像条目在 image 与 view 两个方向都算生图能力；同时确认文本 / 视频的旧条目断言不受影响（另加两条：生图族不外溢到文本 / 高质量文本 / 视频）。
- [x] 4.2 新增 `verify-image-model-family.mjs`：用本地 mock 上游 + 真实 `createAppHandler`（临时根目录）端到端验证（a）`ark-image` 这类主声明为图像的条目被选中后能用于 `cap: 'view'`、实际发给上游的是该模型且产物走 char 前缀；（b）`defaults.image` 与 `defaults.view` 指向不同模型时两处各走各的；（c）`gpt-image-1`（`features.imageRef = 'none'`）带参考图返回 400 `unsupported` 且不向上游提交，不带参考图正常出图；（d）下拉去重与已选键保留。
- [x] 4.3 跑验证脚本：`verify-model-caps.mjs`、`verify-model-routing.mjs`、`verify-character-card-ui.mjs`、`verify-expression-ui.mjs`、`verify-character-preview.mjs` 全部通过，去重没有把夹具行挤掉。三个脚本本就停用、与本次改动无关：`verify-providers.mjs` 需要外部 dev server 且会改本机真实设置；`verify-stage-models-ui.mjs`（等「剧本」）与 `verify-expression-sheet-canvas.mjs`（等「镜头表」）按旧导航写死，两个标签已在 `src/shell/nav.ts` 的导航重构中移除。
- [x] 4.4 `npx tsc --noEmit` 无错误；`npx vite build` 通过（仓库没有 lint 脚本与 eslint 配置）。
- [x] 4.5 用独立实例（`SB_PROJECTS_DIR` 指向 tmp）核对三处下拉：设置页「图像 · 出画面」列出 `ark-image / ark-plan-image / ark-turn`（同一个 Seedream 4.5 只出现一条，且含只声明三视图的模型），「图像 · 角色三视图」列出 `ark-view / ark-plan-image / ark-turn`，两者都保留各自已选键；素材页角色板三视图下拉同样是整族且不重复；页面无异常。
