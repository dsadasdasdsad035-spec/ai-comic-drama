# Tasks

## 1. 布局模块

- [x] 1.1 新建 `src/canvasLayout.ts`：定义分镜带、角色带、素材带的起始坐标与行间距常量，导出各类型节点的保守估算尺寸（分镜随 `cardWidth(seconds)`）与默认间距
- [x] 1.2 实现 `placeNewNode(kind, existing, opts)`：按类型把候选矩形与同类型已有矩形做碰撞判定，返回第一个不重叠的槽位
- [x] 1.3 实现 `arrangeAll(nodes, opts)`：按区域与栅格重排传入节点，返回 `id -> position`，不修改入参
- [x] 1.4 实现落位用的镜号比较（数值优先、再本地化字符串、最后按 id），与 `compareShots` 兜底一致

## 2. 分镜落位

- [x] 2.1 `src/canvasShots.ts` 的 `buildShotNodes`：把 `col/row` 累加改为按「集号升序 + 镜号」的落位序列推进
- [x] 2.2 同文件：列 `x` 由 `col * (自身宽度 + gap)` 改为「前一张的 x + 前一张宽度 + gap」，行宽不固定
- [x] 2.3 保留既有「按 shotId 认领旧节点」「集内镜号重复去重」「演示卡退场」逻辑不变

## 3. 素材卡落位

- [x] 3.1 `src/App.tsx` 的 `addAsset` 改用 `placeNewNode`，去掉硬编码 `{ x: 120, y: 220 }`
- [x] 3.2 设定图发布路径（`syncAssetsFromDesigns` 附近创建素材卡处）改用 `placeNewNode`
- [x] 3.3 `addAssetCardFromStock` 与表情总图发布处改用 `placeNewNode`
- [x] 3.4 首次加载恢复素材卡的 effect（`y: 220` 处）改用素材带常量，使恢复与运行时新增落在同一区域

## 4. 角色卡落位

- [x] 4.1 角色卡默认位置改用布局模块的角色带常量，保留 `charPos` 已有位置优先
- [x] 4.2 确认拖拽写回 `storyboard-char-pos` 的行为不变

## 5. 整理画布

- [x] 5.1 画布工具条增加「整理画布」入口，与既有适配视图入口并列
- [x] 5.2 实现重排：分镜与素材卡位置写入 `nodes`，角色卡位置写入 `charPos` 与 `localStorage['storyboard-char-pos']`，两处同一次动作内完成
- [x] 5.3 重排后 `fitView` 到全部节点

## 6. 验证

- [x] 6.1 新增 `verify-canvas-layout.mjs`：用 esbuild 打包布局模块，断言「宽窄混排不重叠」「新卡避让不重合」「三区不交叉」「镜号顺序不随数组顺序漂移」「已有位置不被改写」
- [x] 6.2 `npm run build` 通过（含 `tsc --noEmit`）
- [ ] 6.3 人工验收：连续三次添加素材卡、长镜后接短镜、单镜写回后新增镜头、点「整理画布」后回位并保持可再手动拖动
