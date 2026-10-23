# Spec Delta

## REMOVED Requirements

### Requirement: 场景布局按集场次持久化并复用

**Reason**: 3D 空间改为每镜独立拥有 `ShotScene`，场次不再作为共享布局键；同场镜头共享空间会导致跨镜编辑互相污染。

**Migration**: 旧 `sceneLayouts` 保留为迁移来源；首次打开镜头时复制成本镜独立的 `ShotScene`，见「旧场次布局迁移为每镜副本」。

### Requirement: 镜头必须归属场次并可手动改绑

**Reason**: `sceneNo` 仍用于剧本上下文和上一镜查找，但不再决定共享布局；编辑器改场次只改变生成上下文，不改变其他镜头的空间。

**Migration**: 新要求「每镜拥有独立 3D 空间」明确 `sceneNo` 只作上下文；旧镜头按本集第 1 场或已有 sceneNo 继续显示，不删除空间。

### Requirement: 参考图只作人工对照

**Reason**: 新链路要求当前分镜的参考图参与视觉理解；旧要求禁止把像素发送给模型，与目标行为直接冲突。

**Migration**: 参考图改为进入参考板/视觉 brief；只有配置了 `vision` 能力时才发送，未配置时回退文本-only 并明确标注，见「参考板包含当前分镜的完整图像资源」和「视觉能力必须显式配置并可回退」。

## MODIFIED Requirements

### Requirement: 场景布局生成使用场次与设定文本

每镜 3D 空间生成 SHALL 使用当前场次的剧本 beats、地点、时间、在场人物、冲突强度、基调、相关镜头摘要、关联场景设定卡，以及同集同场上一镜的 ShotScene 作为空间种子。有种子时 MUST 保留未被当前画面否定的墙体/门洞/固定物；只有用户明确要求重建空间时才替换。

#### Scenario: 有完整场次上下文

- **WHEN** 用户为一个有场次 beats 和场景设定卡的镜头生成空间
- **THEN** 生成请求包含地点、时间、在场人物、场次内容、相关镜头、场景卡文本和上一镜种子

#### Scenario: 没有场景设定卡

- **WHEN** 当前场次没有关联场景设定卡
- **THEN** 系统仍可仅凭剧本场次、相关镜头和其他文本生成空间，并标明缺少场景卡文本

#### Scenario: 已有布局时生成

- **WHEN** 当前镜头已有 ShotScene，用户触发重新生成
- **THEN** 系统把现有空间作为约束，只有用户明确确认“重建空间”才替换；同场首镜没有种子时按场景卡/场次文本从零生成并标明来源

### Requirement: 走位生成使用镜头、台词与标注上下文

镜头走位生成 SHALL 使用镜头 prompt、videoPrompt、台词与说话人、cast、景别、运镜、秒数、画面标注覆盖摘要、角色外观锚点、当前镜 ShotScene 和涉及的场景/道具设定文本。对话说话人 MUST 优先进入在场角色，画面标注 MUST 以区域摘要参与构图判断，而不是被忽略；有视觉 brief 时 MUST 作为构图/遮挡的软约束。

#### Scenario: 台词影响站位

- **WHEN** 一个镜头有两人对话且说话人明确
- **THEN** 生成结果包含两名说话角色的站位与朝向，并让机位能看到对话关系

#### Scenario: 标注参与构图

- **WHEN** 镜头画面上的标注集中在左侧和上方
- **THEN** 走位生成请求包含该区域摘要，用于决定主体画面位置与机位取舍

#### Scenario: 时长与运镜参与

- **WHEN** 同一段走位描述分别属于 3 秒推镜和 8 秒跟镜
- **THEN** 两次生成使用不同秒数与运镜约束，不产生相同的固定 3 秒运动

### Requirement: 全屏编辑器提供场景与走位两种模式

镜头 Inspector 和右键菜单 MUST 能打开全屏 3D 调度编辑器。编辑器 SHALL 提供“本镜空间”和“镜头走位”两种模式；空间模式编辑当前镜头独立的 ShotScene，走位模式编辑当前镜关键帧。切换模式 MUST 保留未保存编辑，关闭或离开 MUST 提示未保存改动。

#### Scenario: 打开编辑器

- **WHEN** 用户在 Inspector 点击“编辑 3D 调度”
- **THEN** 全屏编辑器打开当前镜头的 ShotScene 与当前镜头走位

#### Scenario: 切换模式

- **WHEN** 用户在空间模式修改墙体后切到走位模式
- **THEN** 墙体修改仍在，走位模式基于修改后的本镜空间显示

#### Scenario: 未保存离开

- **WHEN** 用户有未保存修改并尝试关闭编辑器
- **THEN** 系统提示保存、放弃或继续编辑，不静默丢弃修改

### Requirement: 编辑器保存必须限定当前项目与镜头

保存 MUST 只写入当前项目和当前镜头的 ShotScene 与走位，并刷新该镜调度视频与运镜文案的过期状态。取消或关闭未保存 MUST 恢复进入编辑器的数据。保存失败 MUST 保留编辑会话并显示错误。

#### Scenario: 保存成功

- **WHEN** 用户在编辑器点击保存
- **THEN** 当前镜 ShotScene 和走位写入当前项目，重新打开后恢复

#### Scenario: 取消修改

- **WHEN** 用户修改后点击取消
- **THEN** 进入编辑器前的本镜空间和走位恢复

#### Scenario: 保存失败

- **WHEN** 保存请求失败
- **THEN** 编辑器不关闭、修改不丢失，并显示失败原因

## ADDED Requirements

### Requirement: 每镜拥有独立 3D 空间

系统 SHALL 按镜头持久化 `ShotScene`，包含场地尺寸、墙体与洞口、固定物、分区、轴线及可选场景设定卡。同一项目内不同镜头 MUST NOT 共享同一布局对象；修改一个镜头的空间 MUST NOT 改变其他镜头。`sceneNo` 只用于剧本分组和生成上下文，MUST NOT 再作为共享布局键。

#### Scenario: 两个镜头各自有空间

- **WHEN** 同场 S01 和 S02 都生成了 3D 空间
- **THEN** 两者各自保存一份布局，修改 S01 的墙不影响 S02

#### Scenario: 项目隔离

- **WHEN** 项目 A 和项目 B 都有 S01
- **THEN** 各自只读取自己项目的 S01 空间

#### Scenario: 没有空间的新镜头

- **WHEN** 一个镜头从未生成过 3D 空间
- **THEN** 编辑器按缺失处理并准备生成，不自动引用其他镜头的布局对象

### Requirement: 旧场次布局迁移为每镜副本

读取旧项目时，系统 SHALL 把镜头缺失的 `ShotScene` 从其集/场次对应的旧 `sceneLayouts` 复制生成，并保留旧布局数据；多个镜头 MUST 得到互不共享的副本。旧布局不存在时 MUST 使用兜底空间。迁移 MUST NOT 删除旧视频或旧布局。

#### Scenario: 旧项目迁移

- **WHEN** 打开只有场次布局的旧项目
- **THEN** 每个相关镜头获得独立的 shotScene 副本，旧 sceneLayouts 仍保留

#### Scenario: 迁移后编辑一个镜头

- **WHEN** 用户修改迁移后的 S01 空间
- **THEN** S02 的迁移副本保持不变

#### Scenario: 没有旧布局

- **WHEN** 镜头没有 shotScene 且没有对应场次布局
- **THEN** 使用兜底空间并明确标注来源

### Requirement: 默认继承同场上一镜作为空间种子

为一个没有 shotScene 的镜头生成空间时，系统 SHALL 优先使用同集同场、镜头顺序在前的最近一个有 shotScene 的镜头作为种子；没有同场上一镜时才使用场景卡或场次文本从零生成。种子 MUST 只作为空间参考，生成结果仍写入当前镜头的独立副本。

#### Scenario: 有同场上一镜

- **WHEN** S02 没有空间，S01 有同场空间
- **THEN** S02 生成时把 S01 空间作为种子，保留未被当前画面否定的结构

#### Scenario: 不同场次

- **WHEN** 上一镜属于另一个场次
- **THEN** 不使用它作为种子

#### Scenario: 上一镜也没有空间

- **WHEN** 同场上一镜没有 shotScene
- **THEN** 回退到场景卡/场次文本或兜底空间

### Requirement: 相邻镜空间差异必须提示

生成、聊天修改或手动保存后，系统 SHALL 将当前 shotScene 与同集同场上一镜比较场地尺寸、墙段、门洞和主要固定物；差异超过阈值时 MUST 显示警告并给出“继承上一镜 / 保留当前 / 查看差异”。检查 MUST NOT 阻断保存或渲染。

#### Scenario: 差异过大

- **WHEN** S02 的门位置或场地尺寸相对 S01 大幅变化
- **THEN** 显示空间不一致警告，但允许保存或渲染

#### Scenario: 正常差异

- **WHEN** 只增加当前镜头可见的小道具
- **THEN** 不显示结构性差异警告

#### Scenario: 没有上一镜

- **WHEN** 当前镜头是场次首镜
- **THEN** 跳过相邻镜检查

### Requirement: 参考板包含当前分镜的完整图像资源

系统 SHALL 为每镜生成带标签的参考板，至少包含当前首帧、关联场景卡、出场角色图和关联道具图；缺失项 MUST 用占位标识。参考板必须让模型能区分“当前构图”“场景”“角色”“道具”，不得把多张图无标签堆在一起。

#### Scenario: 资源齐全

- **WHEN** 镜头有首帧、场景卡、两名角色和一个道具
- **THEN** 参考板包含四个带角色/场景/道具标签的区域

#### Scenario: 缺少首帧

- **WHEN** 镜头还没有首帧图
- **THEN** 参考板显示“当前帧缺失”，仍用场景卡和文本生成

#### Scenario: 图片损坏

- **WHEN** 某张参考图无法读取
- **THEN** 该项显示占位，不影响其他图片进入参考板

### Requirement: 视觉模型只输出感知锚点

系统 SHALL 让视觉模型输出 `VisualBrief`，描述主体 2D 位置、前后遮挡、可见墙门/固定物、景别与机位线索、构图重心。VisualBrief MUST NOT 被直接当作米制坐标或最终 SceneLayout；空间坐标 MUST 由后续文本/几何步骤结合场景布局生成。

#### Scenario: 生成视觉 brief

- **WHEN** 参考板送入视觉模型
- **THEN** 返回带主体屏幕位置、遮挡和可见建筑的结构化 brief

#### Scenario: brief 缺少坐标

- **WHEN** 视觉模型只给出 2D 关系，没有米制坐标
- **THEN** 文本/几何步骤仍能据此生成合法 ShotScene

#### Scenario: brief 越权

- **WHEN** 视觉模型输出墙体的“米制绝对坐标”
- **THEN** 系统不直接采用，仍交给几何校验和场景种子处理

### Requirement: 视觉能力必须显式配置并可回退

系统 SHALL 在模型能力中提供 `vision`，只有声明支持视觉的模型才能接收参考板；未配置视觉模型时 MUST 回退为文本生成，并在生成结果上明确标记“参考图未参与推理”，MUST NOT 把图片发给非视觉模型。

#### Scenario: 已配置视觉模型

- **WHEN** 用户配置了支持视觉的模型并生成 3D
- **THEN** 参考板进入视觉调用，结果标记使用了视觉 brief

#### Scenario: 没有视觉模型

- **WHEN** 项目没有可用的视觉模型
- **THEN** 仍可用文本生成，界面和结果标记参考图未参与

#### Scenario: 视觉调用失败

- **WHEN** 视觉模型报错或超时
- **THEN** 可回退文本-only 或提示重试，不伪造“看过图”的结果

### Requirement: 3D 生成使用当前镜头的完整资源

生成 ShotScene/ShotBlocking 时，系统 SHALL 使用当前镜头的 prompt、videoPrompt、台词与说话人、cast、景别、运镜、秒数、标注摘要、场景/道具设定、关联素材和参考板。完整资源 MUST 以结构化清单提供给编排层，图片 MUST 只通过参考板/视觉输入传递，MUST NOT 把图片字节塞进文本字段。

#### Scenario: 完整资源请求

- **WHEN** 当前镜头有 prompt、台词、标注、角色和场景卡
- **THEN** 生成编排包含这些资源的清单和参考板

#### Scenario: 只有文本

- **WHEN** 当前镜头没有任何图片
- **THEN** 仍用 prompt/台词/场景卡生成，不报“缺图”

#### Scenario: 图片不进入文本

- **WHEN** 生成请求记录日志或持久化
- **THEN** 文本上下文中不出现 dataURL 或 base64 图片

### Requirement: 每镜空间与走位必须联合生成并校验

一次生成 SHALL 同时产出当前镜头的 ShotScene 与 ShotBlocking；结果 MUST 校验角色名单、关键帧、墙/固定物碰撞、路径和视锥。校验失败 MUST 带错误修复一次；仍失败 MUST 不覆盖有效旧数据，首次无数据时 MAY 使用带来源标记的兜底。

#### Scenario: 联合生成成功

- **WHEN** 用户生成一个没有空间的镜头
- **THEN** 同一次编排返回本镜空间和走位，并可直接预览

#### Scenario: 修复一次

- **WHEN** 首次结果把角色放进墙里
- **THEN** 系统带错误请求修复一次，修复通过才保存

#### Scenario: 二次失败

- **WHEN** 修复后仍穿墙或缺少角色
- **THEN** 保留旧数据并显示具体错误，不写入非法结果

### Requirement: 打开 3D 即准备生成，一键完成

打开某镜的 3D 编辑器时，如果该镜没有 ShotScene 或 ShotBlocking，系统 SHALL 自动启动一次生成编排；已有结果时 MUST 直接展示，不重复生成。用户 MUST 能通过一个“生成 3D 预演”动作重新生成；MP4 渲染 SHALL 仍需用户显式触发。

#### Scenario: 首次打开空镜头

- **WHEN** 用户打开一个没有 3D 数据的镜头
- **THEN** 编辑器自动开始生成空间和走位并显示进度

#### Scenario: 已有数据

- **WHEN** 用户打开已有 shotScene/blocking 的镜头
- **THEN** 直接显示预览，不自动发起模型调用

#### Scenario: 一键重生成

- **WHEN** 用户点击“生成 3D 预演”
- **THEN** 只触发一个编排动作，不要求分别点击场景和走位

### Requirement: 聊天只修改当前镜头的 3D

编辑器 SHALL 提供聊天面板，聊天中的修改 MUST 只作用于当前镜头的 ShotScene/ShotBlocking，MUST NOT 自动修改上一镜、下一镜或同场其他镜头。

#### Scenario: 改当前机位

- **WHEN** 用户说“机位再远一点”
- **THEN** 只修改当前镜头当前关键帧的机位

#### Scenario: 改当前墙体

- **WHEN** 用户说“把门挪到左边”
- **THEN** 只修改当前镜头的门洞或墙体

#### Scenario: 其他镜头不变

- **WHEN** 当前镜头通过聊天改了墙
- **THEN** 上一镜和下一镜的 shotScene 不变

### Requirement: 聊天必须返回受限 patch 并可撤销

聊天模型 MUST 返回受限的 3D 操作集合（机位、角色、墙体、洞口、固定物、分区、重新生成等），不得直接返回任意 JSON 覆盖整个空间。客户端 MUST 校验 patch 后再应用，失败 MUST 保留原数据；每次成功应用 MUST 进入撤销栈。

#### Scenario: 合法 patch

- **WHEN** 聊天返回“机位 y 改成 0.86”的合法操作
- **THEN** 客户端应用并刷新预览，撤销可恢复

#### Scenario: 非法 patch

- **WHEN** patch 把角色放进墙里或引用不存在的墙
- **THEN** 拒绝应用，保留原空间并说明原因

#### Scenario: 模型输出自由 JSON

- **WHEN** 聊天模型返回不符合操作集合的 JSON
- **THEN** 系统拒绝执行，不直接覆盖当前场景

### Requirement: 聊天可按图重新理解，普通修改不重复调用视觉

当聊天明确引用当前画面/参考图时，系统 SHALL 使用或刷新 VisualBrief；纯文本修改（如“拉远机位”）MUST 复用当前缓存，不重复调用视觉模型。参考板或视觉 brief MUST 按当前镜资源指纹缓存。

#### Scenario: 按图修改

- **WHEN** 用户说“按当前画面把机位放到门边”
- **THEN** 系统使用当前视觉 brief，必要时重新生成后再改机位

#### Scenario: 纯文本修改

- **WHEN** 用户说“FOV 改成 50”
- **THEN** 不触发视觉模型调用，只应用参数 patch

#### Scenario: 资源未变化

- **WHEN** 参考板和文本资源没有变化，用户再次聊天
- **THEN** 复用缓存的 VisualBrief

### Requirement: 每镜过期与渲染只看本镜空间

渲染指纹 SHALL 基于当前镜头的 shotScene、ShotBlocking、有效时长、画幅和渲染模式。修改一个镜头的空间/走位 MUST 只让该镜的视频过期，MUST NOT 影响其他镜头；干净 POV、审阅视频和参考视频限制继续沿用。

#### Scenario: 改本镜后过期

- **WHEN** 用户修改 S01 的墙
- **THEN** S01 的调度视频标过期，S02 保持原状态

#### Scenario: 重渲恢复

- **WHEN** 用户用当前 S01 空间重新渲染
- **THEN** S01 恢复生效，其他镜头不受影响

#### Scenario: 下游参考

- **WHEN** 用户把过期或审阅视频用于出片参考
- **THEN** 仍按既有规则拦截

### Requirement: 生成来源和视觉使用必须可见

界面 SHALL 显示当前空间来源（上一镜继承 / 场景卡 / 文本 / 兜底）以及视觉 brief 是否参与。发生连续性警告时 MUST 显示与上一镜的差异摘要。

#### Scenario: 从上一镜继承

- **WHEN** 生成结果以上一镜为种子
- **THEN** 编辑器显示“继承自 S01 / 同场上一镜”

#### Scenario: 视觉参与

- **WHEN** VisualBrief 成功进入生成
- **THEN** 界面显示“已使用参考板视觉 brief”

#### Scenario: 文本-only

- **WHEN** 视觉模型不可用
- **THEN** 界面显示“参考图未参与推理”

### Requirement: 图片发送和缓存有边界

系统 MUST 只向已配置的视觉模型发送缩放后的参考板，MUST 限制图片数量和尺寸；缓存键 MUST 包含当前镜头的图片资源指纹。项目文件 MUST NOT 保存临时图片 URL、dataURL 或模型原始响应。

#### Scenario: 图片上限

- **WHEN** 一个镜头关联很多角色和道具
- **THEN** 参考板按资源优先级合成，不无限增加图片数量

#### Scenario: 缓存命中

- **WHEN** 同一镜头的 prompt、角色、场景和道具资源未变化
- **THEN** 复用视觉 brief，不重复上传图片

#### Scenario: 不落临时数据

- **WHEN** 视觉调用结束并保存项目
- **THEN** 项目文件只保存 brief 摘要/指纹，不保存临时 dataURL

### Requirement: 旧项目和旧视频保持可打开

读取没有 shotScene/VisualBrief 的旧项目时 MUST 不报错；旧 shared scene、旧视频和旧 blocking 仍可读取。旧视频没有新指纹时 MUST 标为过期；迁移只补齐当前镜头空间，不覆盖已有图片、视频或手改字段。

#### Scenario: 旧镜头打开

- **WHEN** 打开只有旧 layout/blocking 的镜头
- **THEN** 迁移出本镜 shotScene，旧视频仍可播放但标过期

#### Scenario: 旧项目没有视觉配置

- **WHEN** 旧项目没有视觉模型设置
- **THEN** 用文本兜底生成，不阻塞打开

#### Scenario: 重复打开

- **WHEN** 用户再次打开已迁移项目
- **THEN** 不重复覆盖已存在的 shotScene 或手改字段
