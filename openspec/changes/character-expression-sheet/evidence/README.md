# character-expression-sheet evidence

## 实现

- 一个角色一张 4×2 表情总图；一次生成 1 张，不再默认 2 张候选。
- 有角色三视图时作为生成参考；没有时用 `lookEn` 并标注“无身份图参考”。
- 生成/上传后按固定八格顺序裁出单格，缓存到项目媒体目录。
- 分镜按 `performance[].emotion` 使用单格；整张总图不进入参考。
- 旧 `expressions` 单图保留只读回退，新 UI 不再逐情绪生成。
- 画布发布一张 `expression-sheet` 素材卡，重复发布更新、改名同步、删角色清卡。
- 视频表情参考默认关闭；显式开启后最多一张说话角色单格，4 张预算先保当前画面/身份/场景。
- 角色卡改为三页签、摘要行、单一主操作、编辑抽屉、44px 表情格、成本/参考预算 chip。

## Mock 证据

`mock-e2e.log` 是完整 mock 链路，全部通过：

```bash
node verify-expression-sheet.mjs
node verify-expression-sheet-refs.mjs
node verify-expression-sheet-ui.mjs
node verify-expression-sheet-canvas.mjs
node verify-video-expression-budget.mjs
node verify-character-card-ui.mjs
node verify-expression-ui.mjs
```

覆盖：

- 格序/坐标/指纹/旧图选择/项目往返；
- 一次生成、身份图参考、8 格裁剪、抽屉保存/取消、`lookEn` 变化标 stale；
- 画布发布/重复发布/改名/删除/刷新持久化/右键连线；
- 视频默认关闭、说话角色单格、4 张预算、身份超限阻止、面板槽位；
- 角色卡默认页签、状态主操作、44px 格、键盘预览、330px/900px 布局；
- 旧逐情绪图只读兼容。

## 回归

以下既有用例通过：

```bash
node verify-expression.mjs
node verify-performance.mjs
node verify-performance-skills.mjs
node verify-performance-ui.mjs
node verify-character-voice.mjs
node verify-character-voice-ui.mjs
node verify-native-audio.mjs
node verify-native-audio-ui.mjs
node verify-native-export.mjs
node verify-lipsync.mjs
node verify-lipsync-ui.mjs
node verify-export.mjs
```

## 截图

- `expression-sheet-ui.png`：总图生成、8 格、成本、抽屉后的 stale 状态。
- `character-card-ui.png`：空/就绪/缺图三种角色卡，就绪卡表情格。
- `expression-sheet-canvas.png`：画布表情素材卡。
- `video-expression-budget.png`：Inspector 表情开关与参考槽位。
- `expression-legacy-ui.png`：旧表情只读回退。

## 预算样例（mock）

- 单角色：当前画面 + 身份 + 说话角色表情 = `3/4`，表情单格进入请求。
- 双角色 + 场景：当前画面 + 2 张身份 + 场景 = `4/4`，表情被省略并给出原因；身份不被挤掉。
- 当前画面 + 4 张身份：`5 > 4`，提交前阻止，不静默截断身份。
- 总图只生成 1 张；按示例单价 ¥0.22 估算，实际以设置页/渠道账单为准。

## 成本与边界

- 成本按一次 1 张图估算；默认单价示例 ¥0.22，实际以设置页/渠道账单为准。
- **没有调用真实图片模型或视频模型**；所有生图、裁剪保存、画布和视频请求均为 mock。
- 没做单格局部重绘；单格不满意只能重生成整张或上传替换。
- 浏览器裁剪依赖同源总图；跨域/加载失败时回退文字表演并在 UI 提示。
- 4×2 格子分辨率取决于 view 模型；没有真实模型画质验收。
- 视频 4 张上限未改；当前画面 + 身份图超过 4 张会在提交前阻止。
- 归档前仍需先处理 `shot-performance-direction`；本变更没有改真实 provider 协议。

## 回滚

- 关闭总图入口并继续读旧 `expressions` 即可回到旧表情；已有总图/裁剪是可选字段。
- 视频 `use_expression_ref` 默认 false，回滚不会删除任何媒体或项目数据。
