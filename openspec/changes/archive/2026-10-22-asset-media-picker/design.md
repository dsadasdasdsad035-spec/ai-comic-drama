# Design

## Context

素材卡 Inspector 的来源字段目前是一个原生 `<select>`：

```
[图片来源]  shot-1792635743325-486ee6.jpg      <-- 只有文件名
[预览]     选中后才出现一张图
```

真实项目 `a` 的 `/api/media` 返回：`assets` 3 条（其中 3 条 URL 为空）、`images` 69 张（主要是 `project-assets/a/...`）、`videos` 8 段。原生 select 无法渲染缩略图，选项只能显示字符串；用户在选择前无法判断是哪张图。另一个现有缺陷：从「生成的视频」选择时只写 `url`，没有把 `kind` 切成 `video`，素材卡仍按图片渲染。

Inspector 宽度约 300px，69 张图 + 8 段视频放不下；因此选择过程需要独立空间。

## Goals / Non-Goals

**Goals:**

- 打开选择器就能看到缩略图/视频首帧，分类、搜索、按时间排序。
- 图片、视频、项目素材、外部/数据 URL 都有统一预览。
- 点选只预览，确认才写回；取消不改变卡片。
- 选择后自动修正素材类型和默认标题。
- 过滤空 URL、按 URL 去重，坏资源不写回。
- 键盘可用、390px 可用，不阻塞现有 Inspector/画布。

**Non-Goals:**

- 不生成服务端视频封面；不做素材文件夹、多选、拖拽排序。
- 不改素材卡数据结构、项目 DB 或 `/api/media` 协议。
- 不做图片编辑、裁剪或上传管理。

## Decisions

### 1. 选择器用居中弹窗，而不是 300px Inspector 内嵌

新增 `MediaPicker`，由 AssetPanel 的「选择素材」按钮打开：

```
+---------------------- 选择素材 -----------------------+
| [项目素材 12] [生成图片 69] [视频 8] [手填地址]       |
| 搜索 [____________________]          按时间倒序       |
|                                                       |
| +--------+  +--------+  +--------+                    |
| | 缩略图 |  | 缩略图 |  | 视频帧 |                    |
| | 场景   |  | 图     |  | 视频   |                    |
| +--------+  +--------+  +--------+                    |
|                                                       |
| +---------------------------------------------------+ |
| | 大图 / video controls / 尺寸 / 时长 / 文件名       | |
| +---------------------------------------------------+ |
|                              [取消]  [使用这张]       |
+-------------------------------------------------------+
```

- 桌面：居中弹窗，宽约 760px，网格 3–4 列 + 右侧或下方详情区。
- 窄屏：占满可用宽度/高度的单列布局，网格在上、详情在下，确认按钮固定可达。
- 使用 `role="dialog"`、`aria-modal`、可访问标题；打开时聚焦搜索框或第一个条目，Esc 关闭，关闭后焦点回到「选择素材」按钮。
- 不使用原生 `<dialog>` 作为唯一方案，保持与现有 Preview/ContextMenu 的样式与关闭语义一致；焦点陷阱在组件内实现。

**理由**：Inspector 的 300px 宽度无法同时容纳 69 个条目和大图/视频；弹窗让选择器独立滚动，不挤压画布布局。

**替代方案**：在 Inspector 下面塞一个缩略图列表。改动小，但视频详情和搜索会非常挤；放弃。

### 2. 先把媒体归一化成统一的 PickItem

新增 `src/mediaPick.ts`（纯函数，便于测试）：

```ts
type PickSource = 'asset' | 'project-image' | 'generated-image' | 'video' | 'manual'

type PickItem = {
  key: string          // 去重键，通常是 url
  source: PickSource
  kind: AssetKind      // scene | prop | image | video
  title: string        // 可读标题；没有标题时用日期/文件名
  url: string
  name?: string
  size?: number
  mtime?: number
  mediaType: 'image' | 'video'
}
```

归一化规则：

- `assets`：跳过 `url` 为空的占位项；`kind` 沿用 scene/prop/image/video；标题用 `title`。
- `images`：按 URL 前缀分类：`/project-assets/` → 项目图片；`/generated/` 或 `/videos/` 之外 → 生成图片。没有标题时用 `生成图 · MM-DD HH:mm`，文件名保留为次要信息。
- `videos`：`mediaType='video'`，`kind='video'`；标题用 `视频 · MM-DD HH:mm`，文件名作为次要信息。
- 按 URL 去重：项目素材优先于原始图片记录；同 URL 保留一个有标题/类型的条目。
- 排序：有 `mtime` 的按时间倒序；没有 mtime 的项目素材按原顺序或标题排序，放在同类前面。

**理由**：当前三类数据字段不一致、存在空 URL 和重复 URL；在进入 UI 前统一，组件只处理一种 `PickItem`。

**替代方案**：在组件里分别渲染三类列表。分支多、去重和空值处理容易散落；放弃。

### 3. 缩略图 + 详情预览，视频只播放一个

- 网格条目：`<img loading="lazy">` 或 `<video preload="metadata" muted playsInline>`；条目显示类型徽标、标题、尺寸/时长/大小。
- 图片详情：`object-fit: contain` 的大图，显示 `naturalWidth × naturalHeight` 和文件大小。
- 视频详情：`<video controls playsInline>`；条目 hover/键盘聚焦时静音播放，移开/失焦暂停；同一时间只允许一个视频播放。
- 视频首帧不保证可靠时，条目用深色占位 + 播放徽标 + 时长；hover 后播放真实画面。列表不为每段视频拉取完整文件。
- 加载失败：条目显示 broken 状态，详情显示错误，确认按钮禁用。
- 大量图片：懒加载 + 网格滚动；不把所有媒体一次性解码。

**理由**：8 段视频同时 autoPlay 会占用解码资源；悬停播放和选中 controls 让预览可控。

### 4. 点选预览，确认才写回

选择器维护 `selected: PickItem | null`，不直接调用素材卡 `patch`：

- 单击/键盘选中：只更新详情预览。
- 双击或「使用这张」：`onConfirm(item)` 才写回。
- 取消/Esc/关闭：丢弃 `selected`，素材卡不变。
- 当前 URL 不在素材库时，作为 `manual/current` 条目显示，能预览就预览；仍可选择保留。

**理由**：选图是破坏性变更（会替换素材卡来源），给一次确认机会，避免误点。

### 5. 类型和标题的写回规则

`onConfirm` 构造补丁：

```ts
kind =
  item.mediaType === 'video' ? 'video'
  : item.source === 'asset' ? item.kind
  : current.kind === 'scene' || current.kind === 'prop' ? current.kind
  : 'image'

title =
  current.title && current.title !== '新素材' ? current.title
  : item.title
```

- 视频强制 `video`，修复当前“视频仍按图片渲染”的缺陷。
- 场景/道具素材沿用自身 kind；普通图片保留场景/道具语义。
- 用户改过的标题不覆盖；默认「新素材」才自动填。
- 地址为空、broken 或无法识别类型时禁用确认。
- 手动 URL：扩展名 `.mp4/.webm/.mov` 判视频，图片扩展名判图片；未知扩展名保留当前类型并提示。

### 6. 分类、搜索和排序

- 页签：项目素材 / 生成图片 / 视频 / 手填地址；每个页签显示数量。
- 搜索：标题、文件名、kind 文本；大小写不敏感；无结果空状态。
- 默认按 mtime 倒序；项目素材没有 mtime 时按原顺序。
- 「当前来源」固定在项目素材/生成图片中匹配到的那一条；找不到时单独显示。
- 空 URL 项不进入任何列表。

### 7. 无障碍与响应式

- 网格条目是原生 `<button>`，`aria-pressed`/`aria-selected` 表示选中；`aria-label` 包含标题、类型、尺寸/时长。
- 搜索框有 label；弹窗打开时焦点进入，Tab 循环在弹窗内，Esc 关闭，关闭后恢复触发按钮焦点。
- 390px 下弹窗变全宽单列；确认/取消按钮保持可见或在底部固定。
- 触控目标 ≥44px；图片/视频缩略图本身可点击。
- 主题使用现有 token，日间/夜间都由主题变量控制。

### 8. 组件集成

- `AssetPanel` 增加 `pickerOpen` 状态；把当前 `url/kind/title` 传给 `MediaPicker`；确认时调用现有 `set`/`patch`。
- 保留 Inspector 下方的「预览」区，作为选择后的最终确认。
- 「手动填地址」仍保留，但改为打开「手填地址」页签并实时预览，而不是一个独立输入框。
- 删除/类型按钮/标题输入不变。
- 选择器只读 `/api/media`，不触发新的网络写入；确认才修改画布素材卡并走现有项目级持久化。

## Risks / Trade-offs

- **69 张图首次打开卡顿** → 懒加载缩略图、网格滚动、搜索；只加载可见项；详情图单独加载。
- **视频首帧不显示** → 用占位 + 播放徽标 + 时长；hover/选中时播放真实视频，不依赖首帧截图。
- **视频同时播放过多** → 只允许一个 hover/选中播放，失焦/移开立即暂停。
- **重复 URL/空素材** → 归一化阶段过滤和去重；项目素材优先；测试固定覆盖。
- **误替换素材卡** → 点选只预览，确认才写回；取消/Esc 不变。
- **类型仍不匹配** → 确认时按 mediaType/source/current.kind 统一推导，视频强制 video；手动 URL 按扩展名判断。
- **弹窗遮住画布** → 这是明确的选择动作；关闭后恢复原焦点，Inspector 预览仍保留。
- **主题不一致** → 选择器只用现有语义 token，不写死深色/浅色。

## Migration Plan

1. 先新增 `mediaPick.ts` 纯函数与单元/脚本测试，不动 UI。
2. 新增 `MediaPicker` 弹窗和缩略图/详情预览，用现有 `listMedia` 数据接入。
3. 把 AssetPanel 的来源 select 替换为「选择素材」按钮，保留手动地址页签。
4. 加确认写回、类型/标题推导、空/坏资源保护和回归测试。
5. 回滚：恢复 AssetPanel 的旧 select 即可；没有数据库/API 迁移，素材卡数据不变。
