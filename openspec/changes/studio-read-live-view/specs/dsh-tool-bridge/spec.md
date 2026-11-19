# Spec Delta: dsh-tool-bridge

## ADDED Requirements

### Requirement: 创意读工具每次执行重新加载落库项目

创意宿主（DSH）路径下，每一个只读平台工具的执行 MUST 独立触发一次当前项目的落库数据加载，MUST NOT 复用同一进程内上一次只读工具执行留下的内存项目副本，MUST NOT 用桥接侧 `getSnapshot` 短路跳过 HTTP。同一工具实现若多次取项目，在创意路径下每一次取数 MUST 视为新的加载（不共享 `snapshotPromise`）。

#### Scenario: 同轮连续两次 read_shots

- **WHEN** 模型在同一回合连续两次调用 `read_shots`，且两次之间项目未写入
- **THEN** 两次执行各自完成一次落库加载，第二次结果不得来自第一次缓存的项目对象

#### Scenario: 两次读之间发生落库

- **WHEN** 第一次 `read_shot_detail` 与第二次之间用户或写工具修改了项目并落库
- **THEN** 第二次返回反映最新落库字段

### Requirement: 画布实况带 revision 且不得盖住新落库

浏览器推送的画布实况 MUST 携带与项目一致的 `projectRevision` 及单调递增的 `canvasRevision`。读工具在合并画布节点到镜头记录前 MUST 校验实况的 `projectRevision` 等于本次落库加载得到的 revision；不相等时 MUST 仅返回落库数据，MUST NOT 用实况节点覆盖。写工具成功递增项目 revision 后、浏览器尚未推送新实况前，读详情 MUST 以落库为准。

#### Scenario: 专家写回后立即 read_shot_detail

- **WHEN** `submit_shots` 或镜级写工具成功写回项目，随后立刻调用 `read_shot_detail`，且浏览器尚未推送含新 revision 的实况
- **THEN** 返回字段与刚落库的项目一致，不被旧画布节点覆盖

#### Scenario: 手改未落库且 revision 一致

- **WHEN** 用户修改画布镜头字段尚未防抖落库，实况 `projectRevision` 与 GET 的 revision 一致，且节点含新 `desc`
- **THEN** `read_shot_detail` 返回的 `desc` 与画布节点一致

#### Scenario: revision 不一致时不 merge

- **WHEN** 服务端项目 revision 已升高，内存实况仍携带较低 `projectRevision`
- **THEN** `read_shots` 返回纯落库集合，不包含该过期实况中的手改字段

### Requirement: 写回成功后须立即刷新画布实况

平台写工具成功修改项目数据后，应用壳 MUST 尽快重新加载该项目并以无防抖推送更新 `canvas-context`，且推送的 `projectRevision` MUST 与刚落库的 revision 一致。

#### Scenario: 写回后实况对齐

- **WHEN** 写工具成功返回后用户再次手改前，专家调用 `read_shot_detail`
- **THEN** 在推送到达后，手改字段可通过 overlay 进入读结果；推送前读结果仅为落库