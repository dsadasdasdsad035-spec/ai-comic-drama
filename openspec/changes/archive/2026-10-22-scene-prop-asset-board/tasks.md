# Tasks

## 1. 设置与素材守则

- [x] 1.1 在 `src/api.ts` 的 `Stage` / `STAGES` 增加 `asset`，并确认 `stageModelKey` / `StagePick` 不需要额外分支；验证：`npm run build` 通过，设置页出现第五个环节下拉。
- [x] 1.2 在 `src/knowledge.ts` 增加 `ASSET_RULES` 默认文本，把 `asset` 加入 `DEFAULT_RULES` 且默认启用；验证：用一个缺少 `asset` 的旧 `rules` 对象调用 `normalizeRules`，返回包含默认素材守则且原有四段文本不变。
- [x] 1.3 在 `src/prompts.ts` 增加 `ASSET_BASE` 与 `assetSys(rules)`，用 `withRule` 拼接可配置规则；验证：停用时只返回基础约束，启用时包含默认素材守则。
- [x] 1.4 在 `src/Settings.tsx` 的 `RULE_META` 增加“素材守则”，`STAGE_META` 增加“素材（拆场景/道具）”；验证：保存后重开设置页，开关、文本和环节模型选择都保持，原有四段规则不受影响。

## 2. 设定数据与项目 API

- [x] 2.1 在 `src/api.ts` 增加 `DesignKind` / `DesignSheet`，给 `ProjectData` 增加 `designs?`、给 `ProjectAsset` 增加 `designId?`；验证：`tsc --noEmit` 通过，旧项目读取不因缺字段报错。
- [x] 2.2 在 `server/db.mjs` 增加 `designs` 表、`designs` 的读写，以及 `assets.design_id` 的补列；验证：用旧库启动后表/列存在，写入再读出一张带 `designId` 的 asset 和一张 design，字段完整。
- [x] 2.3 在 `vite.config.ts` 的 `/api/project` POST 允许 `designs`，`patchProject` 类型支持该字段；验证：POST 一个 designs 数组后重新 GET 能读到，未传 designs 时旧数据保留。
- [x] 2.4 在 `src/data.ts` 的 `AssetNodeType` 增加 `designId?`，并让画布 asset 节点同步/加载 `designId`；验证：构造一个带 `designId` 的 asset 节点，刷新项目后仍能在节点和 `project.assets` 中读到。

## 3. 场景/道具拆解

- [x] 3.1 增加素材摘要与合并模块（`designExtract.ts`）：新增“全部镜头”摘要，不沿用会过滤无 cast/台词的 `digestShots`；验证：无台词、无 cast 但有道具描述的镜头会进入摘要。
- [x] 3.2 实现拆解结果解析与合并：按 `kind + 规范化名称` 去重，refs 取并集，已有非空 `promptEn/image/candidates` 保留，本次未返回的旧卡不删除；验证：连续拆两次不重复，手改锚点和图片不被覆盖。
- [x] 3.3 新建 `src/AssetBoard.tsx`：场景/道具两个页签、从本集拆/从全剧拆、素材环节模型与设定图模型选择；验证：有项目时可拆，没项目/没素材时显示明确提示且不发请求。
- [x] 3.4 素材页加载当前项目的 designs/episodes/shots/style，项目切换时用 epoch 丢弃旧响应，编辑防抖保存 `patchProject({designs})`；验证：A 项目拆完切到 B，B 不显示 A 的设定，A 的数据不被 B 的保存覆盖。
- [x] 3.5 卡片支持编辑名称、英文锚点、关键词，并显示 refs/中文摘要；验证：修改后重新打开项目，修改仍在，重复拆解只补空字段。

## 4. 场景空镜与道具参考图

- [x] 4.1 定义场景空镜后缀、道具多角度后缀和项目画风拼接；场景用 `16:9`，道具用 `1:1`，默认 `n=2`、`cap='image'`；验证：mock `/api/seedream`，请求 prompt 包含 no people / multi-angle / neutral background / 画风锁，且不传角色参考图。
- [x] 4.2 卡片接入生成按钮、运行态、错误态和任务/价格显示；验证：锚点为空或没有图像模型时给出错误且不发请求，成功后写入 2 张候选和当前图。
- [x] 4.3 增加候选图切换，切换后写回 `activeIdx` 和 `image`；验证：重新打开项目保持所选候选，后续发布使用当前图。

## 5. 发布到画布

- [x] 5.1 在 `App.tsx` 增加 `assets` 视图、顶栏“素材”入口、`EpisodeBar` 显示和 `AssetBoard` 渲染；验证：六个主视图可切换，素材页能切集。
- [x] 5.2 实现单卡 `pushDesigns` 与“全部加入画布”：有图卡按 `designId` upsert，无图卡跳过；新卡放独立素材带，已有卡保留位置；验证：连续发布两次卡片数不变，第二次只更新，无图卡有跳过提示。
- [x] 5.3 从画布 asset 节点派生 `onCanvasDesignIds`，素材页显示“已在画布/更新”；验证：删除画布卡后状态回到未发布，重新加入只生成一张。
- [x] 5.4 确认发布后的 scene/prop 卡能被现有镜头参考逻辑选中并用于首帧生成，且不引入 layout 类型；验证：把场景卡/道具卡连到镜头，mock 生图请求包含对应图片 URL。
- [x] 5.5 新增 `verify-asset-board.mjs`（Playwright，mock 文本/生图接口）：覆盖设置默认与旧设置合并、本集拆解去重、空镜/道具请求、单卡/批量幂等、刷新恢复、A/B 项目隔离；验证：脚本全部通过。
- [x] 5.6 更新 README 的素材工作流与验证命令；验证：文档步骤能对应实际按钮，命令可直接运行。
- [x] 5.7 运行 `npm run build` 和现有 `verify-project-scope.mjs`；验证：构建与既有项目隔离回归通过，没有影响 3D 调度/出片链路。
