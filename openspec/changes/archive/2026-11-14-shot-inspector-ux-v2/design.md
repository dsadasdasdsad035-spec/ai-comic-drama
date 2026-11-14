# Design

## Context

- 实现：`Inspector.tsx`、`inspectorLayout.ts`、`ShotInspectorTab = 'visual' | 'video' | 'more'`。
- 产品：`shot-card-prod-kind` 控制可见 Tab；`verify-shot-inspector.mjs` 已覆盖折叠、吸底、偏好。
- 前序：`shot-inspector-cockpit` 变更未归档主 spec，本次以 **ux-v2** 落地工位分叉布局。

## Goals / Non-Goals

**Goals**

- 出片路径：附件 → 正文 → 旋钮；音画与元数据分离。
- 生图路径：预览与提示词在上，参考与出图在下。
- 头部回答「能不能点生成」。

**Non-Goals**

- 新后端字段、新生成 API。
- 素材卡 Inspector 改版。
- 恢复画布全局出图/出片模式。

## Decisions

### D1：Tab 标识与迁移

```ts
type ShotInspectorTab =
  | 'visual'      // 生图：画面
  | 'narrative'   // 生图：叙事（原 more 子集）
  | 'outgoing'    // 出片：出片（原 video 主区）
  | 'audio'       // 出片：音画
  | 'meta'        // 出片：元数据

// localStorage 迁移
// video → outgoing, more + prodKind video → meta
// more + prodKind image → narrative
```

`visibleShotTabsForProdKind`：

| prodKind | tabs |
|----------|------|
| image | visual, narrative |
| video | outgoing, audio, meta |

### D2：头部结构

```
[thumb] 镜号 + 工位徽章(生图|出片)
        场次 · 景别 · 时长
就绪条: 模式标签 | blocking 首条（可点击展开附件）
chips（过滤后） + ⋯ 菜单
  - 切换镜头类型 (image/video)
  - 复制稳定 ID / 删除
```

`shotStatusChips` 按 `prodKind` 过滤：生图镜无视频/提示词(出片) chip；出片镜无「画面 OK」chip（可选灰显仅有 refImage 预览）。

### D3：出片 Tab 内容树

挂载顺序（`data-shot-tab="outgoing"`）：

1. `SiReadinessBar` ← `videoRequest.blocking/warnings/mode`
2. `ShotVideoPromptPanel` 的附件 Fold **默认 open**
3. `OutgoingVideoPromptPanel` 正文区
4. `InspectorSection` 运镜与语义：`motionPrompt` + `ShotLexiconRefBlock` + 镜头参数摘要链
5. Fold `videoSettings`：模型/分辨率/原生音频 **移除**、挂载视频
6. 成片预览 `videoUrl` 保留在设置 Fold 上或独立小块

### D4：音画 Tab

- `dialogue` textarea + 可选解析预览（说话人列表）
- `PerformanceEditor` section
- `useExpressionRef` toggle
- `NativeAudioPanel` 全宽

### D5：元数据 Tab

- `refExtras` 手工 URL（原 advanced section）
- 稳定 ID / 场次 / 节点 ID / 坐标（只读）
- 孤儿警告

### D6：生图 Tab

**画面**：`si-frame`、prompt、refs（修正文案）、gen-box、marks  
**叙事**：dialogue、performance（无表情参考、无视频 字段）

### D7：样式

- `.si-readiness` 单行，错误色 `--warn`/`--error`
- `.si-badge-prod` 工位色区分
- Tab 标签中文：出片 / 音画 / 元数据 / 画面 / 叙事
- 默认宽度 380px（偏好键 bump 版本 `storyboard-inspector-v2` 可选）

### D8：无障碍与状态

- Tab `role=tablist` 不变；隐藏 tab `hidden` + 不卸载（保留草稿）
- 非活动 tab 内 `audio/video` 暂停（现有逻辑扩展 tab id）

## Risks

| 风险 | 缓解 |
|------|------|
| 脚本依赖 Tab 文案「视频」「更多」 | 更新 verify + `data-shot-tab` 选择器 |
| 用户习惯两 Tab | 发布说明；chip 跳转 |
| 偏好 tab 失效 | 迁移函数 in `loadInspectorPrefs` |

## Migration

- 纯 UI；旧 `ShotData` 不变。
- localStorage tab 字符串一次性映射。
