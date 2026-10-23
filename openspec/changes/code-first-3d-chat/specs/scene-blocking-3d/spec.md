# Spec Delta

## REMOVED Requirements

### Requirement: 场景布局包含可渲染空间要素

**Reason**: 新镜头以 Three.js 代码为唯一场景真相，不再维护结构化墙体、固定物和分区清单。

**Migration**: 代码直接创建几何；旧 ShotScene 保留为 legacy 只读渲染，见「旧结构化镜头只读并可显式转换」。

### Requirement: 镜头走位由时间关键帧与机位路径组成

**Reason**: 运镜和角色运动由代码的 `renderAt(t, mode)` 直接决定，不再维护时间关键帧。

**Migration**: 旧 ShotBlocking 继续由 legacy 渲染器读取；新镜头用代码表达运动。

### Requirement: 场景布局生成使用场次与设定文本

**Reason**: 场景生成改为基于选中上下文的代码生成，不再生成结构化布局。

**Migration**: 场次文本仍可被选中并进入代码生成；旧布局生成入口移除。

### Requirement: 走位生成使用镜头、台词与标注上下文

**Reason**: 走位不再是独立生成产物，而是代码的一部分。

**Migration**: 台词、标注和镜头文本通过参考内容选择器进入代码生成。

### Requirement: 生成结果必须校验并有限修复

**Reason**: 纯代码模式无法做角色名单、墙体碰撞和关键帧校验；只保留代码语法、沙箱运行和资源校验。

**Migration**: 代码准入与试运行规则见 `scene-code-runtime`；旧结构化结果不再自动修复。

### Requirement: 全屏编辑器提供场景与走位两种模式

**Reason**: 编辑器改为参考内容、预览、聊天/代码三栏，不再有场景/走位模式。

**Migration**: 旧结构化镜头以只读 legacy 视图打开，转换入口见「旧结构化镜头只读并可显式转换」。

### Requirement: 编辑器支持直接操作、数值精修与撤销

**Reason**: 纯代码模式不提供角色/墙体/固定物拖拽和数值精修；撤销作用于代码版本。

**Migration**: 代码修改通过聊天或代码页签完成，成功运行后进入代码撤销栈。

### Requirement: 3D 渲染复现场景、走位和真实机位

**Reason**: 渲染由代码自行创建场景和相机，系统不再从结构化数据重建。

**Migration**: 代码运行时负责画面；旧结构化数据由 legacy 渲染器预览。

### Requirement: 运镜文案由实际路径生成

**Reason**: 代码没有可供系统解析的路径语义，系统不能声称从几何自动推导运镜。

**Migration**: `motionNote` 改由代码生成结果或用户编辑提供，界面明确其不是几何推导。

### Requirement: 每镜拥有独立 3D 空间

**Reason**: 每镜独立代码取代每镜独立 ShotScene；代码是场景真相。

**Migration**: 旧 ShotScene 保留，但新镜头不再写入该字段。

### Requirement: 默认继承同场上一镜作为空间种子

**Reason**: 没有结构化空间可继承；上一镜代码只能作为文本参考，不能作为语义种子。

**Migration**: 用户可在工作台选择“参考上一镜代码”，但系统不合并空间结构。

### Requirement: 相邻镜空间差异必须提示

**Reason**: 代码不可结构化比较，系统无法可靠判断墙体、门洞和固定物差异。

**Migration**: 移除自动连续性警告；用户需自行对照上一镜代码或渲染。

### Requirement: 参考板包含当前分镜的完整图像资源

**Reason**: 参考板由用户选择的参考内容取代，不再固定收集当前首帧、场景、角色和道具。

**Migration**: 见 `shot-3d-context` 的选择、预览和媒体 brief 要求。

### Requirement: 视觉模型只输出感知锚点

**Reason**: 代码生成需要媒体描述，不再受“只输出感知锚点、不输出坐标”的旧约束。

**Migration**: 媒体 brief 的输入输出边界见 `shot-3d-context`；brief 仍不得直接冒充代码或结构化坐标。

### Requirement: 视觉能力必须显式配置并可回退

**Reason**: 视觉和视频理解能力统一由参考内容能力管理。

**Migration**: 见 `shot-3d-context` 的「媒体理解能力必须显式配置并可回退」。

### Requirement: 3D 生成使用当前镜头的完整资源

**Reason**: 生成输入改为用户明确选择的参考内容，不再自动使用镜头全部资源。

**Migration**: 见 `shot-3d-context` 的选择与默认上下文要求。

### Requirement: 每镜空间与走位必须联合生成并校验

**Reason**: 代码同时表达空间与运动，没有独立的空间/走位生成步骤。

**Migration**: 代码生成后在沙箱中试运行；失败不覆盖旧代码。

### Requirement: 聊天必须返回受限 patch 并可撤销

**Reason**: 聊天改为返回完整 Three.js 代码，不再受限于机位/墙体/固定物 patch。

**Migration**: 新规则见「聊天返回完整代码并可试运行」和 `scene-code-runtime`。

### Requirement: 聊天可按图重新理解，普通修改不重复调用视觉

**Reason**: 图片和视频理解由选中参考内容的媒体 brief 统一处理。

**Migration**: 见 `shot-3d-context` 的媒体 brief 与视频关键帧要求。

### Requirement: 每镜过期与渲染只看本镜空间

**Reason**: 过期判断已由代码与素材指纹统一覆盖，无需单独的结构化空间规则。

**Migration**: 见「渲染过期由输入指纹判定并阻止静默复用」。

### Requirement: 图片发送和缓存有边界

**Reason**: 图片边界由参考内容选择器和媒体 brief 缓存统一管理。

**Migration**: 见 `shot-3d-context` 的数量、尺寸、隐私与缓存要求。

## MODIFIED Requirements

### Requirement: 生成失败不得覆盖有效调度

AI 生成、聊天改写或重新运行代码时，系统 MUST 保留当前有效代码、参考选择和已渲染视频，直到新代码通过沙箱试运行。无既有代码时 MAY 使用内置空白模板，但 MUST 标明来源。失败、超时或取消 MUST NOT 清空已有代码、选择或视频。

#### Scenario: 重生成失败

- **WHEN** 一个已有代码的镜头重新生成时模型报错或代码运行失败
- **THEN** 当前代码、预览和调度视频保持不变，界面显示失败原因

#### Scenario: 用户取消

- **WHEN** 用户在代码生成、试运行或渲染过程中取消
- **THEN** 已保存的数据不被改动

#### Scenario: 首次生成失败

- **WHEN** 一个还没有代码的镜头首次生成失败
- **THEN** 系统显示空白或兜底模板并标明来源，不伪装成模型生成结果

### Requirement: 编辑器保存必须限定当前项目与镜头

保存 MUST 只写入当前项目和当前镜头的代码、代码元数据、参考内容选择与渲染元数据，并刷新该镜视频的过期状态。取消或关闭未保存 MUST 恢复进入编辑器时的代码和选择。保存失败 MUST 保留编辑会话并显示错误。

#### Scenario: 保存成功

- **WHEN** 用户在编辑器点击保存
- **THEN** 当前镜代码、选择和相关元数据写入当前项目，重新打开后恢复

#### Scenario: 取消修改

- **WHEN** 用户修改代码或选择后点击取消
- **THEN** 进入编辑器前的代码和选择恢复

#### Scenario: 保存失败

- **WHEN** 保存请求失败
- **THEN** 编辑器不关闭、修改不丢失，并显示失败原因

### Requirement: 渲染时长与画幅匹配出片有效参数

调度视频时长 MUST 等于该镜的有效出片时长（当前为 2~12 秒），画幅 MUST 跟随项目画幅。镜头秒数被夹取到有效范围时，界面 MUST 标明使用的实际时长，并把实际时长和宽高传给代码运行时。

#### Scenario: 六秒镜头

- **WHEN** 镜头秒数为 6 秒
- **THEN** 调度视频近似 6 秒，而不是固定 3 秒

#### Scenario: 竖屏项目

- **WHEN** 项目画幅为 9:16
- **THEN** 调度视频为竖屏，代码收到对应的宽高和画幅

#### Scenario: 超出范围

- **WHEN** 镜头秒数为 1 秒或 20 秒
- **THEN** 视频按 2 秒或 12 秒渲染，并在界面显示已夹取的实际时长

### Requirement: 渲染输出区分干净预演与审阅标注

最终导出 MUST 使用 `clean` 模式，MUST NOT 包含编辑器 UI、时间轴、选中框或运行时辅助线。编辑器 MAY 用 `review` 模式预览并显示运行时网格或辅助线，但 MUST 标记为仅审阅，MUST NOT 作为 Seedance 参考或抽帧参考。代码自身绘制的内容由代码负责。

#### Scenario: 默认干净导出

- **WHEN** 用户直接渲染调度视频
- **THEN** 视频使用 clean 模式，不包含编辑器控件或运行时辅助线

#### Scenario: 审阅标注

- **WHEN** 用户开启审阅模式预览
- **THEN** 预览可显示运行时辅助线，但标记为仅审阅，不能用于参考视频或抽帧参考

#### Scenario: 标注不遮挡

- **WHEN** 导出视频
- **THEN** 编辑器 UI 和选中框不出现在画面中

### Requirement: 渲染过期由输入指纹判定并阻止静默复用

每次渲染 SHALL 记录输入指纹，覆盖代码哈希、ABI 版本、参与渲染的素材指纹、有效时长和画幅。当前输入与记录不一致时，调度视频 MUST 显示为过期，并在作为 Seedance 参考视频或抽帧参考前提示重新渲染，MUST NOT 静默复用旧视频。

#### Scenario: 修改场景后打开

- **WHEN** 用户修改了代码但还没有重新渲染
- **THEN** 镜头 Inspector 的调度视频显示“已过期”，并提示重渲

#### Scenario: 重新渲染后恢复

- **WHEN** 用户用当前代码和当前素材重新渲染
- **THEN** 过期标记消失，参考视频和抽帧恢复可用

#### Scenario: 使用过期参考

- **WHEN** 调度视频已过期且用户开启视频参考或抽帧参考
- **THEN** 系统提示先重新渲染，不静默把旧视频提交

### Requirement: 旧调度数据与下游参考通路保持兼容

升级后旧 `shotScene` / `shotBlocking` / `layout` MUST 仍可读取并由 legacy 渲染器预览，但 MUST 标记为旧结构化只读；系统 MUST NOT 自动把它们改写成代码。旧 `scheduleVideo` MUST 保留可播放，但不得被视为与新代码匹配的有效结果。代码调度视频仍 MUST 是本地可访问的 mp4（转码失败可退回 webm），并继续支持抽帧、视频参考与 Inspector 预览。

#### Scenario: 旧单帧布局

- **WHEN** 打开一个只有旧 layout 或 shotBlocking 的镜头
- **THEN** 系统用 legacy 渲染器显示只读预览，并保留角色与机位信息

#### Scenario: 旧调度视频

- **WHEN** 项目里已有旧 3 秒调度视频
- **THEN** 视频仍可播放，但因输入指纹缺失或不同而标记过期

#### Scenario: 下游通路

- **WHEN** 用户用新渲染的视频开启 Seedance 视频参考或抽帧参考
- **THEN** 现有参考视频模式、模型能力判定和请求结构保持不变

### Requirement: 旧场次布局迁移为每镜副本

旧 `sceneLayouts` 只作为 legacy 渲染的迁移来源；系统 SHALL 在读取旧镜头时为 legacy 视图解析独立副本，MUST NOT 自动写入 `sceneCode`。多个镜头 MUST 得到互不共享的 legacy 副本；没有旧布局时 legacy 视图使用兜底空间。迁移 MUST NOT 删除旧视频、旧布局或已有代码。

#### Scenario: 旧项目迁移

- **WHEN** 打开只有场次布局的旧项目
- **THEN** 每个相关镜头获得独立的 legacy 预览副本，旧 sceneLayouts 仍保留

#### Scenario: 迁移后编辑一个镜头

- **WHEN** 用户把迁移后的 S01 转成代码并修改
- **THEN** S02 的 legacy 副本和代码保持不变

#### Scenario: 没有旧布局

- **WHEN** 镜头没有代码、shotScene 和对应场次布局
- **THEN** legacy 视图使用兜底空间并明确标注来源

### Requirement: 打开 3D 即准备生成，一键完成

打开某镜的 3D 工作台时，如果没有 `sceneCode` 且没有 legacy 结构化数据，系统 SHALL 自动启动一次代码生成；已有 `sceneCode` MUST 直接展示，不重复生成。只有 legacy 数据时 MUST 展示只读 legacy 预览和“生成代码版本”入口，不自动覆盖。用户 MUST 能一键重新生成代码；视频渲染 SHALL 仍需用户显式触发。

#### Scenario: 首次打开空镜头

- **WHEN** 用户打开一个没有任何 3D 数据的镜头
- **THEN** 编辑器自动开始生成代码并显示进度

#### Scenario: 已有数据

- **WHEN** 用户打开已有 sceneCode 的镜头
- **THEN** 直接显示代码预览，不自动发起模型调用

#### Scenario: 一键重生成

- **WHEN** 用户点击“生成 3D 代码”
- **THEN** 只触发一次代码生成，不要求分别生成空间和走位

### Requirement: 聊天只修改当前镜头的 3D

编辑器 SHALL 提供聊天面板，聊天产生的代码 MUST 只作用于当前镜头，MUST NOT 自动修改上一镜、下一镜、同场其他镜头、当前参考内容选择或旧结构化数据。

#### Scenario: 改当前机位

- **WHEN** 用户说“机位再远一点”
- **THEN** 只修改当前镜头代码中的相机

#### Scenario: 改当前墙体

- **WHEN** 用户说“把门挪到左边”
- **THEN** 只修改当前镜头代码中的门或墙体几何

#### Scenario: 改当前场景

- **WHEN** 用户说“把整个场景换成雨夜街道”
- **THEN** 只重写当前镜头代码，不修改其他镜头

#### Scenario: 其他镜头不变

- **WHEN** 当前镜头通过聊天改了代码
- **THEN** 上一镜和下一镜的代码、选择和视频状态不变

### Requirement: 生成来源和视觉使用必须可见

界面 SHALL 显示当前代码来源（AI 生成 / 手改 / 旧结构化转换 / 空白兜底）、代码哈希与最近一次试运行状态、参与生成的选中内容，以及图片、视频关键帧或原生视频 brief 是否参与。回退时 MUST 显示原因，MUST NOT 声称已经理解未读取的素材；结构化校验缺失 MUST 显式提示。

#### Scenario: 从上一镜继承

- **WHEN** 用户选择参考上一镜代码并生成成功
- **THEN** 编辑器显示“参考上一镜代码”，但不声称继承了结构化空间

#### Scenario: 视觉参与

- **WHEN** 图片或视频关键帧 brief 成功进入生成
- **THEN** 界面显示“已使用选中素材的媒体 brief”及具体素材

#### Scenario: 文本-only

- **WHEN** 视觉模型不可用
- **THEN** 界面显示“素材未参与理解”，仍允许文本生成

### Requirement: 旧项目和旧视频保持可打开

读取没有 `sceneCode` 的旧项目时 MUST 不报错；旧 `shotScene`、`shotBlocking`、`sceneLayouts`、旧视频和旧 blocking 仍可读取。旧视频没有新指纹时 MUST 标为过期；迁移只补齐 legacy 视图，不覆盖已有代码、图片、视频或手改字段。

#### Scenario: 旧镜头打开

- **WHEN** 打开只有旧 layout/blocking 的镜头
- **THEN** 显示 legacy 只读预览，旧视频仍可播放但标过期

#### Scenario: 旧项目没有视觉配置

- **WHEN** 旧项目没有代码模型或视觉模型
- **THEN** 不阻塞打开；用户可手写代码或用纯文本生成，并明确标注回退

#### Scenario: 重复打开

- **WHEN** 用户再次打开已迁移项目
- **THEN** 不重复覆盖已存在的代码、选择和手改字段

## ADDED Requirements

### Requirement: 3D 调度以每镜 Three.js 代码为场景真相

3D 调度工作台 SHALL 以每镜 `SceneCode` 作为新镜头的场景真相；用户 MUST NOT 再通过拖拽结构化墙体、角色或固定物来编辑场景。代码、参考内容选择和渲染元数据 MUST 按镜头保存，MUST NOT 在同场其他镜头之间共享可变对象。

#### Scenario: 新镜头

- **WHEN** 用户新建或首次打开一个没有结构化数据的镜头
- **THEN** 工作台准备生成代码，不要求先建场景布局或走位

#### Scenario: 代码优先

- **WHEN** 用户修改代码并保存
- **THEN** 该镜预览以代码为准，不写回 shotScene 或 shotBlocking

#### Scenario: 旧镜头

- **WHEN** 用户打开只有结构化数据的旧镜头
- **THEN** 显示 legacy 只读视图，不把旧字段当作新代码

### Requirement: 工作台采用参考内容、预览和聊天/代码三栏布局

桌面工作台 MUST 提供左侧参考内容、中间预览与时间轴、右侧聊天/代码三个区域；顶部 MUST 显示镜号、时长、画幅、代码状态和保存/渲染入口。窄屏 MUST 改为抽屉或上下堆叠，MUST NOT 出现横向溢出；MUST NOT 继续显示 SVG 平面编辑区。

#### Scenario: 桌面布局

- **WHEN** 用户在宽屏打开 3D 调度
- **THEN** 参考内容、预览和聊天/代码同时可见，预览占据主要空间

#### Scenario: 窄屏布局

- **WHEN** 用户在窄屏打开工作台
- **THEN** 参考内容和聊天可折叠或堆叠，预览和时间轴仍可用

#### Scenario: 旧平面移除

- **WHEN** 用户打开新工作台
- **THEN** 看不到墙体/角色拖拽平面，场景修改通过代码或聊天完成

### Requirement: 聊天返回完整代码并可试运行

聊天 SHALL 返回完整 Three.js 代码和一句说明；编辑器 MUST 在沙箱试运行成功后才应用新代码，失败 MUST 保留旧代码。成功应用 MUST 进入撤销栈。聊天 MUST NOT 只返回无法执行的片段或结构化 patch。

#### Scenario: 重写场景

- **WHEN** 用户说“用选中的场景图做背景，重写整个空间”
- **THEN** 聊天返回完整代码，试运行成功后预览更新

#### Scenario: 只改一个参数

- **WHEN** 用户说“把相机 FOV 改成 50”
- **THEN** 聊天返回包含该修改的完整代码，而不是只返回一个 JSON 参数

#### Scenario: 运行失败

- **WHEN** 聊天返回的代码试运行失败
- **THEN** 旧代码继续有效，聊天显示错误，不写入项目

### Requirement: 旧结构化镜头只读并可显式转换

旧 `shotScene` / `shotBlocking` 镜头 SHALL 以只读 legacy 预览打开；工作台 MUST 提供显式的“生成代码版本”动作。转换 MUST 先试运行成功并经用户确认后才写入 `sceneCode`；旧结构化数据 MUST 保留，取消 MUST NOT 改变已有字段、图片或视频。

#### Scenario: 打开旧镜头

- **WHEN** 用户打开只有 shotScene/shotBlocking 的镜头
- **THEN** 显示 legacy 预览和只读状态，不自动生成或覆盖代码

#### Scenario: 显式转换

- **WHEN** 用户点击“生成代码版本”并确认
- **THEN** 系统用旧结构化数据和当前选择生成代码，试运行成功后写入 sceneCode

#### Scenario: 取消转换

- **WHEN** 用户在转换确认或试运行阶段取消
- **THEN** 旧结构化数据和已有视频保持不变

### Requirement: 结构性校验缺失必须明确提示

工作台 MUST 明确说明纯代码模式不提供角色名单校验、穿墙/碰撞校验、空间连续性比较或自动运镜文案；MUST NOT 显示旧结构化校验状态或伪造连续性警告。用户 MUST 能查看代码、运行错误和当前素材缺失状态。

#### Scenario: 没有碰撞校验

- **WHEN** 用户把角色放进墙里
- **THEN** 系统不声称已校验碰撞，只显示代码运行结果

#### Scenario: 没有连续性检查

- **WHEN** 当前镜与上一镜空间差异很大
- **THEN** 系统不生成结构性差异警告，用户需自行对照

#### Scenario: 运镜文案来源

- **WHEN** 界面显示 motionNote
- **THEN** 标明它来自代码生成或用户编辑，不是从几何自动推导
