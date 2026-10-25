# Design

## Context

当前 `src/Inspector.tsx` 是一个约 1050 行的分镜 Inspector，`InspectorBody` 直接按数据字段顺序输出全部区块；`src/theme.css` 把 `.inspector` 固定为 300px 宽并整体滚动。出片提示词面板（`VideoPromptPanel`）在视频区内部，依赖 `videoRequest` 和 `effectiveVideoPrompt`。素材卡走 `AssetPanel`，与分镜共用 `.inspector` 类。See `proposal.md` 和 `specs/shot-inspector-layout/spec.md` for the required behavior; this document covers the layout and state approach.

## Goals / Non-Goals

**Goals:**

- 用固定头部、四个 tab、固定底部操作栏和单一滚动区替代一列长表单。
- 保留所有现有字段、动作和生成链路，只改变呈现与分组。
- 让切换 tab 不丢草稿，让宽度/折叠/tab 偏好可持久化。
- 让出片提示词面板在有画面的镜头上默认可见；用户记住其他页签时，头部提示词入口仍能一键到达。

**Non-Goals:**

- 不拆分或重写 `PerformanceEditor`、`NativeAudioPanel`、`LipSyncPanel`、`VideoPromptPanel` 的内部实现。
- 不改变 `ShotData` / `ProjectShot` / 生成 API。
- 不做批量 Inspector、移动端底部抽屉或新的生成能力。
- 不改素材卡 Inspector 的结构。

## Decisions

### 1. 分镜 Inspector 使用 shell + 单一滚动区

`InspectorBody` 输出：

```text
<aside class="inspector shot-inspector" style="width: <w>px">
  <div class="si-resize" />          <- 左边缘拖拽把手
  <header class="si-head"> ... </header>
  <nav class="si-tabs" role="tablist"> ... </nav>
  <div class="si-scroll">
    <section role="tabpanel" hidden={tab !== 'visual'}> ... </section>
    <section role="tabpanel" hidden={tab !== 'video'}> ... </section>
    <section role="tabpanel" hidden={tab !== 'audio'}> ... </section>
    <section role="tabpanel" hidden={tab !== 'more'}> ... </section>
  </div>
  <footer class="si-foot"> ... </footer>
</aside>
```

`.shot-inspector` 改成 `display:flex; flex-direction:column; overflow:hidden`，只有 `.si-scroll` 滚动；头部和操作栏不参与滚动。`.inspector` 继续作为素材卡和分镜共享的基础类，新增 `.shot-inspector` 覆盖布局。替代方案是把 tab 内容拆成四个独立组件文件，但那会把 `InspectorBody` 里的十几个状态和 handler 拆成大量 props；本次保持单文件，先完成布局，后续再按需拆分。

### 2. 四个 tab 的内容映射

| tab | 内容 |
|---|---|
| `画面` | 镜头参数（时长/景别/运镜）、当前画面与候选、画面提示词、参考汇总与添加、出图设置（比例/张数/模型/参考开关）、构图标注 |
| `视频` | 当前视频与保存、运动提示词、出片提示词面板、3D 调度（状态/预览/编辑/两个参考开关/运镜文案）、原生音频、出片设置（分辨率/模型）、挂载已有视频 |
| `声音` | 台词/音效、表演、配音（音色/语速/模型/生成/试听）、口型 |
| `更多` | 镜头 ID/场次/稳定 ID、手工参考 URL、3D 上下文入口、孤儿状态、节点坐标 |

台词和表演放 `声音`，因为它们同时驱动配音与表情；画面 tab 只保留一行摘要或依赖角色 chip，不重复完整编辑器。原生音频继续放 `视频`，因为它属于视频请求，且未归档的 `seedance-voice-reference` 仍把入口定义在视频生成面板；口型放 `声音`。

### 3. 默认 tab：自动直到用户第一次手动选择

偏好对象：

```text
{ width: number, tab: 'auto' | 'visual' | 'video' | 'audio' | 'more',
  collapsed: { shotParams: bool, performance: bool, schedule: bool, refs: bool, advanced: bool } }
```

`tab === 'auto'` 时按镜头状态计算：有 `refImage` → `video`，否则 `visual`。用户点击任意 tab 后写成具体值并持久化，之后切镜头保持该 tab。这样既满足「有画面打开就能看到出片提示词」，也不会让用户每次切镜头都被强制跳回某个页。

### 4. 所有 tab 面板挂载、仅隐藏非活动页

四个 `<section>` 始终挂载，用 `hidden` 控制显示。这样 `VideoPromptPanel` 的 `editing/draft`、`PerformanceEditor` 的局部输入、候选选择等状态不会因切 tab 丢失。非活动页的 `audio`/`video` 通过一个 effect 暂停：

```text
tab 变化 -> 找到非活动 tabpanel 里的 audio/video -> pause()
```

头部缩略图只用 `refImage` 的静态图（没有画面时占位），不在头部自动播放视频；视频预览只在 `视频` tab 可见时播放。替代方案是条件渲染 tab 内容，但那会丢草稿，不采用。

### 5. 可拖宽：左边缘 pointer 拖拽 + 本地持久化

拖拽把手放在 `.shot-inspector` 左边缘，宽 6px，`cursor: col-resize`。`pointerdown` 记录起始 X 和宽度并 `setPointerCapture`；`pointermove` 按 `startWidth - (clientX - startX)` 计算并夹到 320–520；`pointerup` 写入偏好并释放。双击复位 360px。拖拽期间给 `body` 加 `user-select:none`，避免选中文本。

宽度用内联 `style={{ width, flexBasis: width }}`，不写回项目数据；`localStorage` key 例如 `storyboard-inspector-v1`，读取失败时回退默认值。替代方案是只做 CSS resize，但 `resize: horizontal` 在 flex 布局里兼容性差且无法双击复位。

### 6. 长区块折叠，折叠后保留摘要

新增 `InspectorSection` 局部组件（标题 + 右侧摘要 + 展开按钮），受控于偏好里的 `collapsed`。默认：镜头参数折叠、表演折叠、3D 调度折叠、参考展开、高级折叠。摘要示例：

- 镜头参数：`5.0s · 中景 · 推`
- 表演：`陈默 · 惊 · 4 / 林岚 · 克制 · 2`
- 3D 调度：`生效 · 5.0s · 720p`
- 参考：`3 项 · 视频用 4/4`
- 高级：`ID · 手工 URL · 构图标注`

折叠只影响显示，不卸载子组件；`PerformanceEditor` 等长表单保持状态。

### 7. 状态 chip 由纯函数推导

新增 `src/inspectorLayout.ts`：

```text
type InspectorPrefs = { width, tab, collapsed }
loadInspectorPrefs() / saveInspectorPrefs()
clampInspectorWidth(n)
defaultTabForShot(hasImage)
shotStatusChips(data, request) -> [{ id, label, tone, tab }]
```

chip 至少包含：画面（有无/候选数）、视频（有无/时长）、配音（有无/时长/是否超时或过期）、提示词（自动/已手改/旧快照）、原生音频（开/关）。点击 chip 切 tab；提示词 chip 指向 `视频`，配音 chip 指向 `声音`。纯函数便于在验证脚本里直接断言，不依赖 DOM。

### 8. 固定操作栏复用现有 handler

按 tab 映射：

```text
visual -> onGenerate / onCancelGenerate，费用 imageCost(price, candCount)
video  -> onGenerateVideo，费用 videoCost(price, seconds, vidRes)
audio  -> onVoice，显示配音引擎
more   -> 不显示生成主操作，只显示「修改会自动保存」说明
```

运行中：图片沿用 `genState`，显示「取消生成」；视频和配音保留现有状态文案（出片中/配音中），按钮禁用，不新增取消能力（那会改变生成链路）。不可执行原因直接显示在按钮下方，例如「先填写画面提示词」「先出画面」。

### 9. 警告去重并靠近区块

删除 `Inspector.tsx` 中重复出现的第二段「配音超过镜头时长」警告。其余警告保留在原区块：配音超时在配音区、3D 过期在 3D 区、提示词旧快照在提示词面板、参考省略在参考摘要。新增的 issue 汇总不做，v1 只保证不重复。

### 10. 无障碍

tab 列表使用 `role="tablist"`，每个按钮 `role="tab"`、`aria-selected`、`aria-controls`，面板 `role="tabpanel"`、`aria-labelledby`。roving tabIndex，左右方向键移动并激活，Home/End 到首尾；非活动面板用 `hidden`，从辅助技术和 tab 顺序中移除。吸底按钮保留可读文本和 focus-visible 样式。

### 11. 素材卡不受影响

`AssetPanel` 继续返回 `<aside className="inspector">`，不添加 `shot-inspector` 类、tab、状态 chip 或吸底栏。分镜专用样式全部挂在 `.shot-inspector` 下。

## Risks / Trade-offs

- [移动控件造成肌肉记忆断裂] → 用明确的 tab 名、状态 chip 和 `更多` 兜底；保留所有原有字段和按钮文案，不做二次改名。
- [隐藏 tab 的媒体继续播放] → tab 切换 effect 主动 `pause()`；头部不放自动播放视频。
- [隐藏 tab 增加 DOM 和渲染成本] → 单镜头面板，成本可控；非活动页的媒体由 effect 暂停，折叠区保持挂载但内容轻量。
- [拖宽影响画布布局] → 夹到 320–520；画布容器由 flex 自适应，React Flow 自身监听尺寸；拖拽期间禁用文本选择。
- [localStorage 偏好跨项目共享] → 宽度/tab/折叠是用户习惯而非项目数据，跨项目共享可接受；读取失败回退默认。
- [默认 tab 让无画面镜头看不到提示词] → 头部提示词 chip 常显，点击直接到 `视频`；有画面镜头默认就是 `视频`。
- [测试脚本依赖旧 DOM] → 更新 `verify-video-prompt-preview.mjs` 先切 tab；新增 `verify-shot-inspector.mjs` 覆盖布局本身。
- [素材卡共用 `.inspector`] → 所有新样式限定 `.shot-inspector`，AssetPanel 不改。

## Migration Plan

无数据迁移。`localStorage` 新增一个带版本号的偏好键，旧值不存在时使用默认宽度/`auto` tab/默认折叠。回滚时移除 `.shot-inspector` 相关 JSX/CSS 和偏好读取即可，镜头数据与生成请求不受影响。上线前跑 `verify-shot-inspector.mjs`、更新后的 `verify-video-prompt-preview.mjs`，以及 `verify-video-prompt.mjs`、`verify-native-audio.mjs`。
