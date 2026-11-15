# Design

## 现状与约束

`image` 与 `view` 在服务端没有行为分叉：

- `pickModel(cap)` 只用 `cap` 去 `modelHasCap` 里比一个布尔值；
- 两者的差异只在三处：默认位 `defaults.image` / `defaults.view`、报错与提示文案、产物子目录（`char/` 与 `design/` 由调用方传的落盘路径决定，与模型无关）。

`src/modelCaps.ts` 的 `modelHasCap` 是唯一闸门，且 `server/app.ts:164` 直接 `import` 同一个函数。所以「放宽生图能力」只要改这一处，前端下拉、设置页默认位校验、素材板预过滤、服务端解析会同步生效。

## 决策

### 决策 1：放宽 `modelHasCap` 本身，不引入第二个「家族」谓词

在 `modelHasCap` 里让 `image` 与 `view` 互相蕴含：只要模型声明了任一，两个方向都返回 true。

理由：`pickVideoModel` 那种「家族」写法是为了处理 `videoRef` 的**额外前置条件**（必须 `supportsVideoRef`），所以需要 `cap` 与 `family` 两个概念并存。生图没有这类前置条件，两个词指同一件事。若另造 `canGenerateImage`，就必须在每个消费点选择用哪一个，`modelHasCap(m,'view') === false` 却能出现在三视图列表里，读代码的人必然要问为什么；也会让 `invalidDefaults` 与列表判断出现两套语义。

代价：`cap` 作为「主声明」仍然保留（用于徽标 `modelCapsLabel`、设置页按能力筛选、默认位键），但它不再等于「这个模型能否用于该能力」。

被否决的替代方案：

- 在 `CapModelSelect` 的调用点传 `caps={['image','view']}` 而谓词不动：能修下拉，但修不了 `pickModel`、`invalidDefaults`、`AssetBoard` 预过滤与 `RoutingPane` 的渠道可用性判断，会出现「下拉里选得到、点生成却回落默认模型」。
- 合并目录条目（删掉 `ark-view` / `ark-plan-view`）：存量 `defaults.view` 会指向已删除的 key，需要迁移，用户删过的预设还可能被加回来。

### 决策 2：两个默认位保持独立

`defaults.image` 与 `defaults.view` 不合并。未手选时各用各的默认位；手选时以手选的 key 为准。`pickModel` 已经实现「显式 key 命中就用手选的」，放宽谓词后跨能力 key 自然命中，不需要额外的选路逻辑。

### 决策 3：下拉按 `provider + modelId` 去重，保留与当前能力匹配的那一行

放宽后 `ark-image` 与 `ark-view` 指向同一个 `doubao-seedream-4-5`，会让两个下拉各出现两条同名模型。在 `CapModelSelect` 组装列表时去重：

- 键为 `${provider}\0${model}`；
- 同一键多行时保留 `cap` 等于本次请求能力的行；若都不等于则保留先出现的那行；
- 顺序按首次出现的行保持稳定。

存量 `defaults.image = 'ark-image'`、`defaults.view = 'ark-view'` 都能各自在自己的下拉里命中并显示为已选，无需迁移。目录条目一行不动。

### 决策 4：参考图不支持时失败，对齐 apimart 分支

`server/app.ts` 的图像路由里，apimart 分支已经实现了期望行为：

```ts
if (featureRef === 'none' && rawRefs.length) {
  res.statusCode = 400
  res.end(JSON.stringify({ ok: false, message: `模型「${imgEntry.label}」不支持参考图`, kind: 'unsupported' }))
  return
}
```

非 apimart 分支（标准方舟 / Agent Plan / OpenAI）现在是 `dropRefs` 静默丢弃并在响应里附一句 `warning`。改成在构造 payload 前判定：带参考图且（provider kind 不支持参考图，或 `imgEntry.features?.imageRef === 'none'`）时，返回同样形状的 400 与同样的文案，并删掉 `dropRefs` 及其在响应里的 `warning` / `droppedRefs` 字段。

不带参考图的请求不受影响；apimart 分支不动（已经正确）。前端不必新增处理：`generateImage` 与创意工具已经把非 2xx 的 `message` 抛给用户。

### 决策 5：验证脚本按新语义校正，并补一个家族专用脚本

- `verify-model-caps.mjs`：`旧图像条目不自动承接三视图` 改成相反断言——旧图像条目在两个方向都算生图能力。
- `verify-model-routing.mjs`：补一条「跨能力 key 命中」。
- `verify-stage-models-ui.mjs` 等取 `cap === 'view'` 的夹具本身仍然有效（单行、单声明），不需要改，但要跑通确认去重没有把夹具行挤掉。
- 新增 `verify-image-model-family.mjs`：以 `node:sqlite` 写入临时设置库，验证（a）`ark-image` 这类主声明为图像的条目选中后能用于 `cap:'view'` 且不回落默认位；（b）两个默认位不同时各走各的；（c）`gpt-image-1` 带参考图返回 400 `unsupported`，不带参考图正常。

## 风险

- 放宽谓词后设置页「按能力筛选」把三视图模型归到图像下、渠道可用性判断变宽，属于预期内变化；若用户想在目录里区分「只给三视图用」，仍可用 `cap` 主声明表达。
- 去重依赖 `provider + model` 唯一；若同一渠道同一模型被刻意配成两条不同 `features` 的条目，下拉会只显示一条。当前目录没有这种配置，且 `features` 差异不影响选路。
- `pickModel` 对完全无关的 key（如文本模型 key）仍是静默回落默认位。这是既有行为，本次不扩大范围。
