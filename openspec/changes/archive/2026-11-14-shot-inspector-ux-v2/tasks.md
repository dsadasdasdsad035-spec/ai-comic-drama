# Tasks

## 1. Tab 与偏好

- [x] 1.1 扩展 `ShotInspectorTab` 与 `visibleShotTabsForProdKind`（image: visual/narrative；video: outgoing/audio/meta）
- [x] 1.2 `loadInspectorPrefs` 迁移旧 tab 值；`coerceShotTab` 按工位校正
- [x] 1.3 更新 Tab 中文标签与 `data-shot-tab` 钩子

## 2. 头部与就绪

- [x] 2.1 工位徽章 + 溢出菜单内镜头类型切换（移出页底）
- [x] 2.2 `shotStatusChips` 按 `prodKind` 过滤
- [x] 2.3 `SiReadinessBar` 组件（出片 Tab 顶，接 `videoRequest`）

## 3. 出片 Tab 重排

- [x] 3.1 区块顺序：就绪 → 附件默认展开 → 出片提示词 → 运镜语义 → 出片设置
- [x] 3.2 原生音频迁至音画 Tab；从 `videoSettings` Fold 移除
- [x] 3.3 镜头参数 / `ShotLexiconRefBlock` 归入运镜语义区

## 4. 音画 / 叙事 / 元数据

- [x] 4.1 音画 Tab：台词、表演、表情、原生音频
- [x] 4.2 叙事 Tab：台词、表演（生图镜）
- [x] 4.3 元数据 Tab：refExtras、k-v 只读字段

## 5. 生图 Tab 文案与样式

- [x] 5.1 参考区 Seedream 文案；去掉视频出片主说明
- [x] 5.2 `theme.css`：就绪条、徽章、Tab 间距

## 6. 验收

- [x] 6.1 扩展 `verify-shot-inspector.mjs`（Tab 集、chip、附件展开、菜单内镜头类型）
- [x] 6.2 `openspec validate shot-inspector-ux-v2 --strict`
- [x] 6.3 README Inspector 小节更新工位分页说明
