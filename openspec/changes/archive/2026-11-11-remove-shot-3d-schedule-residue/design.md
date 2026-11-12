# Design

## Context

见 `proposal.md - Why`。当前实现里有两套并存的「3D」概念：

1. **分镜级调度**（待删）：`ShotData.sceneCode/scheduleVideo/...` + `resolveShotSchedule` + legacy 几何模块。UI 已无写入方，但数据映射、提示词拼装和 spec 仍在引用它。
2. **项目级白模**（保留）：`project.lexiconWhitebox` + `SceneCode`/`SceneCodeMeta`/`ScheduleMeta` + `sceneCodeFreshness`，入口在素材 → 镜头语言。

两者唯一的结构性耦合是 `lexiconSheetToNode()`：它把白模伪装成 `ShotNodeType` 交给工作台，工作台再从 `node.data.sceneCode/scheduleVideo/scheduleMeta` 取数据。

## Goals / Non-Goals

**Goals**

- 分镜数据模型里不再有任何 3D 字段，读写映射、类型、prompt 参数同步收敛。
- 白模工作台不再依赖分镜类型，改为显式条目入参。
- 删除不可达的 legacy 几何栈，保留其唯一被复用的纯函数 `renderSize`。

**Non-Goals**

- 不改白模的存储结构、渲染管线、指纹算法与过期判定语义。
- 不动 VGGT、运镜库、画布连线与出片链路。
- 不做旧项目数据迁移或库表清理。

## Decisions

### 1. 白模工作台改为条目入参，而不是继续伪装镜头

`SceneCodeWorkbench` 需要的分镜字段实际只有 `no / seconds / size / move`（渲染上下文与提示文案）以及代码/元数据/视频。改为：

```ts
type EntryInput = {
  id: string
  title: string
  seconds: number
  code?: SceneCode
  codeMeta?: SceneCodeMeta
  video?: string
  scheduleMeta?: ScheduleMeta
}
```

工作台内部用它拼出渲染所需的 `shot` 摘要，不再引入 `ShotNodeType`。

**替代方案**：保留一个精简的「伪镜头」类型。被否决——那等于把刚删掉的耦合换个名字留下，且会继续诱导后续代码向分镜字段靠拢。

### 2. `renderSize` 单独抽出，其余几何模块整体删除

`renderSize` 被 App、工作台和素材链路用于计算像素尺寸，与几何校验无关。抽到 `src/renderSize.ts` 后，`scheduleGeometry` / `shotScene` / `scheduleAI` / `scheduleContext` / `layoutGen` / `scheduleStatus` 全部删除。

**替代方案**：只删调用点、保留模块。被否决——留下的都是零引用代码，会持续污染搜索与重构。

### 3. 运镜文案只来自 `motionNote`

`videoPrompt` 现在的兜底是 `motionNoteOf(scene, blocking, duration, move) || d.motionNote`。删掉几何层后改为直接读 `d.motionNote`（含白模条目自带的运镜说明）。

**代价**：旧项目里从未写过 `motion_note`、只有结构化走位数据的镜头，出片提示词会少一句自动运镜描述。可接受——该描述本质是从已废弃的走位数据推导出来的。

### 4. 旧字段「读时忽略、写时不再产生」

`shotSync` 只映射仍需保留的字段；`ProjectShot` 类型里删除对应声明。旧项目 JSON 里的键保持原样、不被读取，也不主动清洗。

**替代方案**：写入时置空（像上一轮 `shot_3d_context: null`）。被否决——字段本身消失后没有必要保留「剥除」逻辑，那会长期留在映射函数里。

### 5. 线程键 `surface: 'lexicon'` 取代 `scene3d`

白模聊天已在迁移时使用 `surface: 'lexicon'` + 条目 id。本次把 `SceneAgentChat` 的 `threadKey` 类型收紧为单一形态，删除 `scene3d` 分支；旧 `scene3d` 线程留在库里不再展示。

## Risks / Trade-offs

- [删除 `ShotData` 字段会让部分验收脚本编译失败] → 先删依赖已移除模块的脚本（`verify-schedule3d*` 已删），再跑 `tsc --noEmit` 全量确认无遗漏。
- [`scheduleGeometry` 里可能藏着被间接使用的纯函数] → 删除前逐个 grep 导出符号的引用；只搬 `renderSize`。
- [工作台入参重构可能影响白模渲染的时长/画幅] → 用现有白模条目回归：新建 → 生成/手写代码 → 运行 → 渲染，确认时长与画幅来自条目而非默认值。
- [旧项目 `motion_note` 缺失导致提示词变短] → 出片面板仍显示最终正文，用户可手改；不静默补造运镜描述。

## Migration Plan

1. 前端一次性删除（无服务端结构变更）。旧数据保留，回滚只需回滚前端。
2. 部署后首次打开旧项目：忽略旧 3D 字段，不提示、不报错。
3. 若需回滚：恢复前端版本即可，旧字段仍在库中，未被破坏。

## Open Questions

- 无。旧数据清洗策略已确定为「忽略且不清洗」。
