# Design

## Context

导入链路分四层，每层只做一件事：

```
表头别名          行结构           预览差异          合并落库
intake/tableMap   intake/rows      intake/diff      shotSync
ShotColumn 枚举   ImportShotRow    IntakeDiff       SHOT_FIELD_POLICY
```

字段能否落地由最后一层的白名单决定：`SHOT_IMPORT_FIELDS` 目前只有十个字段，`SHOT_AGENT_EXTRA_FIELDS` 已含 `cast`、`performance`、`dialogue_delivery`、`refIds`。也就是说底层能力早就在，缺的是前三层。

一个已存在的隐患：`buildShotsFromImport` 会给缺表演的说话角色补 `neutral/3/speaks:true`，且预览只报总数，不区分「文件写的」与「系统补的」。

参考连线存节点 id（`char-<角色 id>` 与 `asset-<随机 uid>`），解析必须发生在能访问画布素材卡的那一层。

## Goals / Non-Goals

**Goals:**

- 让导出侧新增的四列能被识别、解析并写入镜头，且缺列时行为与今天完全一致。
- 让「解析不到」成为预览里可见的条目，而不是静默丢弃或近似顶替。
- 复用 `storyboard-export-fidelity` 建立的单元格语法模块，不另写解析。

**Non-Goals:**

- 不放开产线字段（`keyframe`、`clip`、`audio_ref` 等）的写入。
- 不在导入时复制或下载运镜库视频文件。
- 不做「按参考名自动创建素材卡」——解析不到就是解析不到。

## Decisions

### D1 四层同步扩，不绕过任何一层

`ShotColumn` 枚举、`ALIASES` 别名表、`ImportShotRow` 结构、`rowsFromTable` 映射四处同时扩出 `cast` / `performance` / `lexicon_ref_key` / `reference`。

**为什么**：跳过任一层都会让字段在某个入口消失（文件导入与粘贴文本走同一套，但压缩包导入走 `BundleDialog`）。四层一起改才能保证三个入口一致。

**替代方案**：只在 `rowsFromTable` 里用 `any` 塞字段。被否——类型层失去保护，越界字段会被静默带进落库。

### D2 扩展 `SHOT_IMPORT_FIELDS`，不切到 `agent` 策略

把这五个字段加进导入白名单：`cast`、`performance`、`dialogue_delivery`、`refIds`、`lexicon_ref_key`。

**为什么**：`agent` 策略还包含 `video_prompt_override`、`handEdited`、`video_prompt_rendered` 这类只该由模型与产线写的字段。直接切策略会让表格导入有权改产线字段，风险远大于收益。

**代价**：白名单变长，`SHOT_IMPORT_FIELDS` 与 `SHOT_AGENT_EXTRA_FIELDS` 出现重叠。接受——重叠的几个字段本来就是业务字段，两套策略都该能写。

### D3 台词被写入时整组重建台词表演

`dialogue_delivery` 是与 `dialogue` 下标平行的数组。文件给了台词但没给标注时，沿用旧数组会让第 3 条表演挂到新的第 3 条台词上。

**为什么**：错位比丢失更危险——错位的表演看起来完全正常，只有配音时才会发现语速对不上人。

**替代方案**：只在下标范围内保留旧值。被否——下标语义已变，保留等于随机配对。

**代价**：用只含台词的九列文件回灌会清掉原有台词表演。由预览的表演补全计数提示。

### D4 参考解析在画布层完成，解析结果按名字传下去

`rowsFromTable` 只产出 `reference: { characters: string[]; assets: string[] }`，不产出节点 id。节点 id 的解析发生在调用方，那里能拿到画布素材卡。

**为什么**：`intake/*` 是纯解析模块，不依赖浏览器状态；让它去查 localStorage 会让单元测试与压缩包导入（无画布上下文）都失效。

**替代方案**：在导入时按标题查 `project.assets` 直接拿 id。被否——`project.assets` 不存节点 id，素材卡的节点 id 只在画布状态里。

### D5 解析不到的项一律跳过并在预览点名，不做近似匹配

角色名与素材标题都要精确匹配（去空白后逐字相等）。没有模糊匹配、没有「最相似的候选自动选中」。

**为什么**：参考连线决定出图取哪张参考图。猜错一张，整镜外观就错了，而且不会报错。

**代价**：用户名字写得略有差别（「林小雨」vs「林小雨 」）会解析失败。缓解：匹配前统一去首尾空白与全角空格。

### D6 表演补全按镜计数而不是按角色计数

预览的表演补全显示「N 镜补了默认表演」，与既有「运镜默认补全 12 镜」同一口径。

**为什么**：既有计数全是按镜，混入按角色的数字会让用户无法对比。具体补了哪些角色放进明细。

## Risks / Trade-offs

- **[九列文件回灌清空台词表演]** 文件没有标注时整组重建为空 → 预览显示表演补全计数，且这批补全集中在有台词无标注的镜，用户能一眼看出。
- **[参考解析依赖画布上下文]** 压缩包导入在没有画布素材卡的场景下所有素材参考都会解析失败 → 预览逐条点名，不让用户以为导入成功了却没连上。
- **[白名单扩容后被合入字段增多]** 未来若有人把产线字段加进 `SHOT_IMPORT_FIELDS`，导入就能改产物 → 在 `SHOT_PIPELINE_FIELDS` 旁保持注释说明二者必须无交集，并加断言测试。
- **[旧文件列顺序假设]** 用户手写的十三列表如果列序与导出不同但表头正确，仍能正确解析（按名识别）；列序错误且表头缺失时会失败 → 失败在缺少镜号列时立刻拒绝，不会写坏数据。

## Migration Plan

- 无数据迁移：新列按名识别，旧文件行为不变。
- 回滚：撤回四处枚举与别名即可；已写入的 `cast`/`performance`/`refIds` 是既有字段，旧代码照常读取。
