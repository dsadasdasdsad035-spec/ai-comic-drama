# Spec Delta

## RENAMED Requirements

- FROM: `### Requirement: 3D 调度以每镜 Three.js 代码为场景真相`
- TO: `### Requirement: 3D 调度以每镜 Blender Python 代码为场景真相`

## MODIFIED Requirements

### Requirement: 生成失败不得覆盖有效调度

AI 生成、聊天改写或重新运行代码时，系统 MUST 保留当前有效代码、参考选择和已渲染视频，直到新代码通过渲染试运行。无既有代码时 MAY 使用内置空白模板，但 MUST 标明来源。失败、超时或取消 MUST NOT 清空已有代码、选择或视频。

#### Scenario: 重生成失败

- **WHEN** 一个已有代码的镜头重新生成时模型报错或代码渲染失败
- **THEN** 当前代码、预览和调度视频保持不变，界面显示失败原因

#### Scenario: 用户取消

- **WHEN** 用户在代码生成、试运行或渲染过程中取消
- **THEN** 已保存的数据不被改动

#### Scenario: 首次生成失败

- **WHEN** 一个还没有代码的镜头首次生成失败
- **THEN** 系统显示空白或兜底模板并标明来源，不伪装成模型生成结果

### Requirement: 渲染过期由输入指纹判定并阻止静默复用

每次渲染 SHALL 记录输入指纹，覆盖代码哈希、运行时标识、引擎版本、ABI 版本、参与渲染的素材指纹、有效时长和画幅。当前输入与记录不一致时，调度视频 MUST 显示为过期，并在作为 Seedance 参考视频或抽帧参考前提示重新渲染，MUST NOT 静默复用旧视频。

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

升级后旧 `shotScene` / `shotBlocking` / `layout` MUST 仍可读取并标记为旧结构化只读，但 MUST NOT 再渲染 3D 画面；系统 MUST NOT 自动把它们改写成代码。旧 `scheduleVideo` MUST 保留可播放，但不得被视为与新代码匹配的有效结果。代码调度视频仍 MUST 是本地可访问的 mp4，并继续支持抽帧、视频参考与 Inspector 预览。

#### Scenario: 旧单帧布局

- **WHEN** 打开一个只有旧 layout 或 shotBlocking 的镜头
- **THEN** 系统显示旧结构化只读说明和转换入口，不再渲染 3D 预览

#### Scenario: 旧调度视频

- **WHEN** 项目里已有旧 3 秒调度视频
- **THEN** 视频仍可播放，但因输入指纹缺失或不同而标记过期

#### Scenario: 下游通路

- **WHEN** 用户用新渲染的视频开启 Seedance 视频参考或抽帧参考
- **THEN** 现有参考视频模式、模型能力判定和请求结构保持不变

### Requirement: 旧场次布局迁移为每镜副本

旧 `sceneLayouts` 只作为显式转换为代码时的迁移来源；系统 MUST NOT 自动写入 `sceneCode`，也 MUST NOT 再为旧镜头渲染 3D 预览。转换时 SHALL 为每个镜头解析独立副本，多个镜头 MUST 得到互不共享的副本；没有旧布局时 MAY 使用兜底空间作为转换输入。迁移 MUST NOT 删除旧视频、旧布局或已有代码。

#### Scenario: 旧项目迁移

- **WHEN** 打开只有场次布局的旧项目
- **THEN** 每个相关镜头显示只读说明，旧 sceneLayouts 仍保留

#### Scenario: 迁移后编辑一个镜头

- **WHEN** 用户把迁移后的 S01 转成代码并修改
- **THEN** S02 的旧结构化数据和代码保持不变

#### Scenario: 没有旧布局

- **WHEN** 镜头没有代码、shotScene 和对应场次布局
- **THEN** 转换使用兜底空间作为输入并明确标注来源

### Requirement: 打开 3D 即准备生成，一键完成

打开某镜的 3D 工作台时，系统 MUST 先检查本机 Blender 可用性；不可用时 MUST 禁用代码生成与渲染并显示安装或版本指引。可用且没有 `sceneCode`、也没有 legacy 结构化数据时，系统 SHALL 自动启动一次代码生成；已有 `sceneCode` MUST 直接展示，不重复生成。只有 legacy 数据时 MUST 展示只读说明和“转换为 Blender 代码”入口，不自动覆盖。用户 MUST 能一键重新生成代码；视频渲染 SHALL 仍需用户显式触发。

#### Scenario: 首次打开空镜头

- **WHEN** 用户打开一个没有任何 3D 数据的镜头且 Blender 可用
- **THEN** 编辑器自动开始生成代码并显示进度

#### Scenario: 已有数据

- **WHEN** 用户打开已有 sceneCode 的镜头
- **THEN** 直接显示代码和代理预览，不自动发起模型调用

#### Scenario: 一键重生成

- **WHEN** 用户点击“生成 3D 代码”
- **THEN** 只触发一次代码生成，不要求分别生成空间和走位

#### Scenario: Blender 不可用

- **WHEN** 本机没有受支持的 Blender
- **THEN** 生成与渲染入口被禁用并显示安装指引，已有代码和视频仍可查看

#### Scenario: 旧结构化镜头

- **WHEN** 用户打开只有 legacy 数据的镜头
- **THEN** 显示只读说明和转换入口，不自动生成

### Requirement: 3D 调度以每镜 Blender Python 代码为场景真相

3D 调度工作台 SHALL 以每镜 Blender Python `SceneCode` 作为新镜头的场景真相；用户 MUST NOT 再通过拖拽结构化墙体、角色或固定物来编辑场景，MUST NOT 在浏览器内运行另一套 3D 场景代码。代码、参考内容选择和渲染元数据 MUST 按镜头保存，MUST NOT 在同场其他镜头之间共享可变对象。

#### Scenario: 新镜头

- **WHEN** 用户新建或首次打开一个没有结构化数据的镜头
- **THEN** 工作台准备生成代码，不要求先建场景布局或走位

#### Scenario: 代码优先

- **WHEN** 用户修改代码并保存
- **THEN** 该镜预览以代码为准，不写回 shotScene 或 shotBlocking

#### Scenario: 旧镜头

- **WHEN** 用户打开只有结构化数据的旧镜头
- **THEN** 显示只读说明和转换入口，不把旧字段当作新代码

### Requirement: 聊天返回完整代码并可试运行

聊天 SHALL 返回完整 Blender Python 代码和一句说明；编辑器 MUST 在渲染试运行成功后才应用新代码，失败 MUST 保留旧代码。成功应用 MUST 进入撤销栈。聊天 MUST NOT 只返回无法执行的片段或结构化 patch。

#### Scenario: 重写场景

- **WHEN** 用户说“用选中的场景图做背景，重写整个空间”
- **THEN** 聊天返回完整代码，试运行成功后预览标脏并提示重渲

#### Scenario: 只改一个参数

- **WHEN** 用户说“把相机 FOV 改成 50”
- **THEN** 聊天返回包含该修改的完整代码，而不是只返回一个 JSON 参数

#### Scenario: 运行失败

- **WHEN** 聊天返回的代码试运行失败
- **THEN** 旧代码继续有效，聊天显示错误，不写入项目

### Requirement: 旧结构化镜头只读并可显式转换

旧 `shotScene` / `shotBlocking` 镜头 SHALL 以只读说明打开，MUST NOT 再渲染 3D 预览；工作台 MUST 提供显式的“转换为 Blender 代码”动作。转换 MUST 先试运行成功并经用户确认后才写入 `sceneCode`；旧结构化数据 MUST 保留，取消 MUST NOT 改变已有字段、图片或视频。

#### Scenario: 打开旧镜头

- **WHEN** 用户打开只有 shotScene/shotBlocking 的镜头
- **THEN** 显示只读说明和转换入口，不自动生成或覆盖代码

#### Scenario: 显式转换

- **WHEN** 用户点击“转换为 Blender 代码”并确认
- **THEN** 系统用旧结构化数据和当前选择生成代码，试运行成功后写入 sceneCode

#### Scenario: 取消转换

- **WHEN** 用户在转换确认或试运行阶段取消
- **THEN** 旧结构化数据和已有视频保持不变

### Requirement: 旧项目和旧视频保持可打开

读取没有 `sceneCode` 的旧项目时 MUST 不报错；旧 `shotScene`、`shotBlocking`、`sceneLayouts`、旧视频和旧 blocking 仍可读取，但旧结构化数据 MUST NOT 再渲染 3D 画面。旧视频没有新指纹时 MUST 标为过期；迁移只补齐只读说明和转换入口，不覆盖已有代码、图片、视频或手改字段。

#### Scenario: 旧镜头打开

- **WHEN** 打开只有旧 layout/blocking 的镜头
- **THEN** 显示只读说明和转换入口，旧视频仍可播放但标过期

#### Scenario: 旧项目没有视觉配置

- **WHEN** 旧项目没有代码模型或视觉模型
- **THEN** 不阻塞打开；用户可手写代码或用纯文本生成，并明确标注回退

#### Scenario: 重复打开

- **WHEN** 用户再次打开已迁移项目
- **THEN** 不重复覆盖已存在的代码、选择和手改字段
