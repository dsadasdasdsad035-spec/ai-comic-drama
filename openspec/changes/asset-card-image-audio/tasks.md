# Tasks

## 1. 素材与项目扩展字段

- [x] 1.1 在 `server/db.mjs` 为 `assets` 与 `projects` 增加 `extra` JSON 列，旧库启动时补列；读写展开 `prompt`、`refIds` 与 `imageShotsToAssetCards`。验证：新增 `node verify-asset-card-extra.mjs`，写入后再读出提示词、参考 id 和迁移标记，未传 `extra` 的旧行读作空对象。
- [x] 1.2 扩展 `ProjectAsset` 与 `assetsPayloadOf`，往返 `prompt` 与 `refIds`，空地址允许保存。验证：同一脚本断言画布载荷里的提示词和参考 id 进入项目素材，再水合回节点后不变。
- [x] 1.3 改完 `server/` 后运行 `npm run build:server`。验证：`server-build/app.mjs` 的修改时间晚于 `server/db.mjs`。

## 2. 生图镜迁出

- [x] 2.1 实现迁移计划纯函数：只处理 `prod_kind === 'image'`；`keyframe_prompt` 或 `desc` 成为提示词，`keyframe` 成为地址；角色与图片参考改记到新卡；邻镜 token 丢弃；其他镜头里指向该镜的参考 id 改写成新卡；台词写入备注；候选图、秒数、运镜不复制；镜号不重排；指向该镜的接缝清除；新卡不连到相邻出片镜。验证：`node verify-image-shot-migration.mjs` 覆盖标明生图、仅静帧、再次执行、S01/S03 留号、接缝清除这几条。
- [x] 2.2 在打开项目时，标记未置位则执行计划并同一次写回素材、镜头和 `imageShotsToAssetCards`。写回失败不置标记。已有相同 `canvasId` 的卡不重复创建。验证：脚本用失败的写回桩断言标记仍为假；成功写回后第二次计划不再产生新卡。

## 3. 素材卡生成

- [x] 3.1 画布可新建 `kind` 为 `image` 或 `audio` 的素材卡，不分配镜号，不增加当前集镜数。验证：`node verify-asset-card-generation.mjs` 断言新建后的镜号集合与镜数不变。
- [x] 3.2 图片卡在提示词为空时不提交出图；无参考时请求只有提示词；连入的角色、场景、道具或图片素材进入参考图；相邻镜头不进入。成功后地址写回本卡且不另建卡。验证：同一脚本断言这四种请求体和写回结果。
- [x] 3.3 音频卡只把提示词交给已接入的音频模型，界面没有旁白/音乐开关，连入媒体不进入请求。未接入模型不提交并说明原因。成功后地址写回本卡。验证：同一脚本断言请求体、未接入模型的拒绝文案，以及写回后不新增节点。
- [x] 3.4 已有地址的图片卡连到出片镜时进入图片参考；音频卡只进入单条音频参考，不进入图片或视频参考。验证：扩展 `verify-audio-slot.mjs` 或本变更脚本，断言两类请求的字段。

## 4. 镜头不再出图

- [x] 4.1 新增与插入固定为出片镜，去掉生图/出片选择。验证：`node verify-shot-prod-kind.mjs` 断言新镜头 `prod_kind` 为 `video`，且不出现生图选项。
- [x] 4.2 缺少工位且只有静帧的镜头水合为出片镜；`prod_kind === 'image'` 的镜头不进入序列。Inspector 不显示生图页、生成画面或类型切换。顺序边为实线。验证：同一脚本断言水合结果、Inspector 上不存在生成画面控件，以及顺序边没有虚线。
- [x] 4.3 Agent 提交 `prod_kind: image` 时拒绝该字段，不创建生图镜。验证：同一脚本对 `shotVideoHarnessTools` 的写入计划断言被拒绝。
- [x] 4.4 对镜头触发批量出图时队列为空。验证：同一脚本断言入队镜数为 0。

## 5. 串联检查

- [x] 5.1 运行 `npx tsc --noEmit`、`node verify-asset-card-extra.mjs`、`node verify-image-shot-migration.mjs`、`node verify-asset-card-generation.mjs`、`node verify-shot-prod-kind.mjs`。验证：五条命令都通过。不发起真实的图片、音频或 Seedance 生成。

## Workflow follow-up

- 实现完成后再归档本变更。
- 若 `shot-outgoing-slots-only` 仍未归档，合并时不要把生图页或镜头类型切换加回去。
