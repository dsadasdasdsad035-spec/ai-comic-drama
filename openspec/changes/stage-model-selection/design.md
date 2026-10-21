# Design

## Context

设置页已经把模型配置抽象成「能力 → 渠道 + 模型 ID」：`AppSettings.models` 的每条记录带一个 `cap`（`text` / `textPro` / `image` / `view` / `video` / `videoRef` / `audio`），`defaults` 按能力保存默认键，`pickModel(cap, keyOverride)` 在 `vite.config.ts` 里解析。问题在于 `text` 与 `textPro`、`image` 与 `view` 不是不同能力，而是同一能力的不同用途/档位；四个生成环节又是另一种维度（工作负载），当前代码把它们混成了硬编码：

```
剧本 ScriptBoard       [lite|pro] -> /api/text {model:'lite'|'pro'}   // 初始 lite 写死
镜头表 ShotTable       [lite|pro] -> 同上
提示词 PromptTable     [lite|pro] -> 同上
角色 拆角色（App）      无 UI      -> /api/text {model:'pro'}          // 写死 pro
角色 三视图           无 UI      -> cap=view, modelKey=modelPick.view // 从未写入
3D 调度 layoutGen     无 UI      -> /api/text {model:'lite'}          // 写死 lite
```

`/api/text` 还有一条会掩盖配置错误的路径：只要请求带 `modelKey`，`cap` 就被固定为 `'text'`，`pickModel` 找不到 `textPro` 条目时会静默落到 `defaults.text`。因此不能先加 UI，必须先修正解析语义。

设置以 JSON 存在 SQLite 的 settings 表（key=app），没有 schema 迁移；`normalizeSettings` 负责补默认字段。前端已有按能力保存手选模型的 localStorage（`storyboard-model-pick`），可以复用其思路，但环节选择需要单独一组键，避免与 image/video/audio 的能力选择互相覆盖。

## Goals / Non-Goals

**Goals:**

- 环节默认值进入设置（`stageModels`），代码里不再出现具体模型 ID 或固定的 lite/pro 初始值。
- 剧本、镜头表、提示词、拆角色都能在界面上从真实模型表里选择；手选覆盖按环节记住。
- 角色三视图补上可见的 view 模型选择，并复用现有本地选择。
- `/api/text` 对显式 modelKey 精确解析，未知键明确报错，不静默换模型。
- 响应回传实际使用的 modelKey / modelLabel，界面能确认。

**Non-Goals:**

- 不重构 `text` / `textPro`、`image` / `view` 的能力体系；本次只把它们视为同一族。
- 不做按项目保存环节模型；设置是全局的，手选覆盖是浏览器本地偏好。
- 不做自动渠道/模型回退。
- 不把出图、出片、配音全部改成环节选择；只补角色三视图这个明确缺口。

## Decisions

### 1. 用 `stageModels` 映射，而不是给每个环节新增 Cap

```ts
type Stage = 'script' | 'character' | 'shot' | 'prompt'
type AppSettings = {
  // ...
  stageModels?: Partial<Record<Stage, string>> // 值是 ModelEntry.key
}
```

**理由**：环节是工作负载，不是模型能力。给每个环节加 `Cap` 会迫使同一个文本模型在模型表里复制四行，并且让服务端路由、默认值 UI、迁移都变复杂。`stageModels` 只引用现有模型键，模型表保持一行一个真实模型。

**替代方案**：新增 `script` / `character` / `shot` / `prompt` 四个 Cap。选择更直白，但模型表重复、设置页分组爆炸；放弃。

**替代方案**：把环节模型写进 `project.json`。能做项目级差异，但模型配置属于环境而不是内容，且四个工作台都要读写项目文件；本次放弃。

### 2. 服务端增加文本族解析，显式键必须精确命中

新增 `pickTextModel(keyOverride?)`：

- 显式 `modelKey`：在 `cap ∈ {text, textPro}` 的条目里按 key 精确查找；找不到返回 400 `model-key-not-found`，消息包含 key，不调用任何模型。
- 无 `modelKey`：沿用现有 `defaults.text` / `defaults.textPro` 的档位语义；若默认键失效，取该族第一条；若族内没有任何条目，返回 400 `no-text-model`。

`/api/text` 的响应在现有 `model` / `provider` 之外增加 `modelKey` 与 `modelLabel`。`layoutGen` 等旧调用点不带 modelKey 时行为不变。

**理由**：既支持手选 `textPro` 条目，又消灭“选 pro 实际用 lite”的静默替换。无键调用仍保留兼容，不会把所有旧调用都变成必填。

**替代方案**：把 `pickModel` 改成接受 cap 数组。会影响 image/video/audio 的所有调用点；改为新增文本族包装更收敛。

### 3. 解析顺序：手选 > 环节默认 > 文本默认 > 该族第一条

```
per-stage localStorage override
        |
        v
stageModels[stage]
        |
        v
defaults.text
        |
        v
first text/textPro model
        |
        v
error: no-text-model
```

**理由**：手选是本次操作的明确意图；环节默认是持久配置；文本默认让旧设置零迁移可用；族内第一条是最后兜底。所有来源都是用户配置的模型条目，不存在代码内置模型 ID。

手选覆盖存新的 localStorage 键 `storyboard-stage-model-pick`（`{ script?: key, character?: key, ... }`），与现有按能力的 `storyboard-model-pick` 分开。

**替代方案**：把每次手选写回 `stageModels`。会把临时选择变成全局默认，且多个页面同时写设置有覆盖风险；放弃。

### 4. 共享模型下拉组件，App 集中持有设置和手选

把 Inspector 里的 `ModelPicker` 提取为 `src/ModelSelect.tsx`，提供两种用法：

- `CapModelSelect`：沿用现有能力选择（image / view / video / audio），供 Inspector 与角色三视图使用。
- `StageModelSelect`：按环节过滤 `text` + `textPro`，第一项是「默认 · 解析结果」，其余列出全部文本模型。

App 已经加载 `appSettings`，并持有现有 `modelPick`；新增 `stagePick` 状态后，把 `settings`、`stagePick`、`onPickStage` 传给三个文本工作台与角色板。工作台不再各自写死档位，也不再在生成时重复 `getSettings()` 取规则包（直接用 App 传入的设置；Settings 保存后通过回调触发 `reloadSettings`）。

**理由**：四个工作台需要同一套选项与默认标签；App 是唯一同时知道设置、当前项目和手选状态的地方。拆角色发生在 App，必须和角色板的「角色」环节选择读同一份状态。

**替代方案**：每个工作台各自 fetch 设置、各自读写 localStorage。重复三份逻辑，且 App 的拆角色无法感知角色板的选择；放弃。

### 5. 角色三视图复用 view 能力选择，不新增环节

角色板头部放两个选择：

- **拆角色模型**：`StageModelSelect stage="character"`（文本）。
- **三视图模型**：`CapModelSelect cap="view"`，绑定现有 `modelPick.view` / `pickModelKey('view', ...)`。

`CharacterBoard` 目前已经接收 `viewModel`，只是 App 从未写入 `modelPick.view`；补上选择器后这条链路自然接通，`generateImage({ cap: 'view', modelKey: viewModel })` 不用改。

**理由**：view 是图像能力的一个用途，设置页已有「图像 · 角色三视图」默认；再加 `stageModels.characterView` 会形成两套默认值。

### 6. 设置页新增「生成环节默认模型」

四个下拉：剧本 / 角色 / 镜头表 / 提示词。选项来自文本族（text + textPro），空值显示「未绑定 · 用文本默认」。保存进 `stageModels`。

**理由**：这是“默认不写死在代码里”的落点；用户不配也能跑，配了就能按环节区分（例如剧本用 pro、提示词用便宜模型）。

### 7. 3D 调度跟随镜头表环节

`generateLayout` 当前写死 `model: 'lite'`。改为由 App 解析镜头表环节的 modelKey 并传入；没有显式键时 `/api/text` 走文本默认。

**理由**：3D 调度是拆镜后的辅助动作，跟镜头表属于同一环节；单独加一个 `layout` 绑定会让设置页多一个很少人理解的选项。

**权衡**：如果镜头表环节选了昂贵的 pro 模型，调度调用也会用 pro；用户可以把镜头表默认设为便宜模型，或后续再补独立的 `layout` 绑定。

### 8. 错误与可见性

- 显式 modelKey 无效 → 400 `model-key-not-found`；文本族为空 → 400 `no-text-model`。前端 toast 原文，不重试、不换模型。
- 环节默认指向已删除的模型：选择器显示「配置的模型不可用，请重新选择」，生成返回上述 key 错误。这是有意的显式失败，符合“不静默替换”。
- 生成成功的 toast/结果行追加「模型：<modelLabel>」；`callText` 返回 `modelKey` / `modelLabel`。这样即使默认解析有误，用户也能当场发现。
- 没有任何文本模型时，生成按钮禁用并提示去设置页添加。

## Risks / Trade-offs

- **localStorage 手选不跨设备** → 环节默认在设置页，是持久真相源；手选只是本机偏好。选择器的「默认」项始终显示解析结果，可随时退回。
- **text / textPro 条目仍会重复** → 本次明确不重构；`StageModelSelect` 合并两族展示，用户不必理解档位差异。后续若要收敛能力模型，可单独开变更。
- **删除模型导致默认失效** → 显式报错而不是换模型；设置页与工作台都提示重新选择。代价是多一次人工修复，但避免账单和结果对不上。
- **App 设置可能过期** → Settings 保存后通过 `onSaved` 触发 `reloadSettings`；工作台使用 App 传入的最新设置，不在生成时偷偷读一份不同的配置。
- **3D 调度跟随 pro 模型增加费用** → 文档与设置页提示；需要时再拆独立绑定。
- **验证脚本依赖旧 tier 行为** → 检查 `verify-*.mjs` 中直接调 `/api/text` 的用例；无 modelKey 的调用保持兼容，只有显式无效键从静默回退变成 400。

## Migration Plan

1. 扩展服务端 `AppSettings` / `normalizeSettings` / `saveAppSettings`：`stageModels` 默认空对象，旧设置原样可用，无需 bump `presetsVersion`。
2. 实现 `pickTextModel`，改 `/api/text` 解析与响应元数据；保留无键调用的档位兼容。
3. 提取共享 `ModelSelect`，App 增加 `stagePick` 状态与设置下发；Settings 增加保存回调。
4. 设置页增加四个环节默认下拉。
5. 接线：ScriptBoard / ShotTable / PromptTable / App 拆角色 / CharacterBoard 三视图 / layoutGen。
6. 验证：接口脚本覆盖 textPro 精确解析、未知键 400、无文本模型 400；Playwright 覆盖四处默认与手选、三视图选择、刷新后保持。
7. 回滚：删除 `stageModels` 的读取与 UI 即可；服务端的文本族解析可保留（它同时修复了旧的静默回退），无数据库 schema 变更。

## Open Questions

无。
