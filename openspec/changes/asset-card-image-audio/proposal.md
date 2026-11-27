# Proposal

## Why

画布上的出图仍然是一种镜头：占镜号、算时长、和出片镜抢同一条序列。用户要的是出图和出音频都变成可连线的素材，序列里只留下能出片的镜头。

## What Changes

- **BREAKING**：镜头不再有生图工位。新建与插入一律是出片镜，不再询问生图或出片，Inspector 不再提供「生成画面」或镜头类型切换。
- **BREAKING**：打开项目时，把 `prod_kind` 明确为 `image` 的镜头拆出序列，写成图片素材卡，并落库。只做一次。未写明类型、仅有静帧的旧镜头留在序列里当出片镜，静帧仍在镜上，但不能从镜头出图。
- 图片素材卡用提示词出图，也可以把角色或其他图片素材连到这张卡上当参考。成功后文件写回这张卡自己的地址，再连到出片镜当参考图。
- 音频素材卡与出图同一形状：一段提示词进，一条音频出。语音模型与音乐模型共用这张卡，不区分旁白和音乐。产物连到出片镜时只作为现有音频参考（`audio_url`），不成为时间线上单独的音乐轨。
- 拆出的镜头带走提示词、当前预览图和原来连到该镜的参考；台词写入素材备注。候选图、时长、运镜、接缝不带走。留下的镜号不重排。指向被拆镜头的接缝清除，相邻出片镜直接相接。新素材卡不自动连到相邻镜头。

## Capabilities

### New Capabilities

- `asset-card-generation`: 图片与音频素材卡可按提示词生成文件，结果就是这张卡的地址，并能作为其他卡或出片镜的参考。

### Modified Capabilities

- `shot-card-prod-kind`: 镜头只有出片工位；标明生图的镜头在加载时离开序列。
- `shot-still-image`: 静帧主生成从镜头上移除。
- `canvas-shots-workbench`: 新增镜头不再选择工位；顺序边不再按生图镜画虚线。
- `shot-inspector-layout`: 去掉生图 Tab、生图说明和镜头类型切换。
- `stock-media-library`: 音频素材可以进入出片镜的音频参考槽，仍不进入画面参考，也不单独成为成片音轨。

## Impact

- 画布与镜头：`src/App.tsx`、`src/Inspector.tsx`、`src/canvasShotOps.ts`、`src/shotProdKind.ts`、`src/shotRows.ts`、`src/canvasProdMode.ts`、`src/inspectorLayout.ts`、`src/types.ts`、`src/data.ts`、`src/shotReferences.ts`。
- 项目素材：`ProjectAsset` 需要能保存提示词，以及图片素材卡自己的参考名单；参考连线今天只写在目标镜头的 `refIds` 上。
- Agent：`builtinPlatformTools.ts`、`shotVideoHarnessTools.ts` 里创建或改写 `prod_kind: image` 的路径要关掉。
- 出图仍走现有图片模型与 `/api/seedream`；音频仍走已接入的语音合成。目录里标成未接入的音乐模型保持不可用，接入后仍用同一张音频卡。
- 与进行中的 `shot-outgoing-slots-only` 叠加：出片镜继续只保留出片槽位；本变更删掉生图工位徽章和类型切换。`canvas-prod-modes-no-voice` 里仍按生图/出片分 Tab 的条款以本变更为准。
