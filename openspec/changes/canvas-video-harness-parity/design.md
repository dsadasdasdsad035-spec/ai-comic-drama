# Design

## Context

画布出片真源是 `buildShotVideoRequest` + `effectiveVideoPrompt`；创意 harness 经 `StudioToolBridge` 执行 `createBuiltinPlatformTools`。镜级「小步写回」已落在 `materialTools.ts`（`link_shot_refs`、`set_shot_camera_lexicon`），生成类在 `builtinPlatformTools.ts`。当前缺口集中在：**写工具未覆盖 Inspector 开关**、**`generate_clip.prompt` 与提交脱节**、**模型/分辨率绑死 UI 会话**。

## Goals / Non-Goals

**Goals:**

- 让探索阶段「参数对照表」里标记为「只能画布」的项，除明确排除外，都有对应工具或 `generate_clip` 参数。
- 修正 `generate_clip` 正文优先级，使 schema、描述、行为与 `read_shot_video_prompt` 一致。
- 新工具复用 `writeShot` / `writeShotBack` 单镜写回，与 `link_shot_refs` 相同 fail-closed 风格。

**Non-Goals:**

- 不改 `buildShotVideoRequest` 拼装规则（模式推导、参考上限、native 互斥仍由现有纯函数决定）。
- 不提供构图 `marks`、首帧候选索引、挂载已有 mp4、全局设置页改默认模型。
- 不在此变更注册 `submit_prompt_renders`。

## Decisions

1. **新写工具放在 `materialTools.ts`**  
   与 `link_shot_refs` 共用 `MaterialToolDeps` / `writeShot`；`generate_clip` 改动留在 `builtinPlatformTools.ts`。  
   *替代方案：扩展 `submit_shots` 全字段*——模型易误覆盖整镜，且无法表达 add/remove refExtras；保留专用动作工具更清晰。

2. **`set_shot_video_override` 强制 fingerprint 校验**  
   保存 override 时必须附带当前 `buildShotVideoRequest` 的 `fingerprint`（工具内可调 `generationContext` 计算，或由 agent 从 `read_shot_video_inputs` 旁路读取——实现时可在读工具响应中增加 `fingerprint` 字段）。  
   *替代方案：不校验 fingerprint*——手改会在参考变化后静默 stale，面板已有 stale 提示，应对齐。

3. **`generate_clip` 正文优先级**  
   `override.text` → 参数 `prompt`（trim 非空）→ `request.prompt`（来自 `videoPrompt`）。移除仅用参数 `prompt` 做非空检查却不提交的现逻辑。  
   *替代方案：参数 `prompt` 总是覆盖*——会破坏手改契约，拒绝。

4. **单次 `modelKey` / `resolution`**  
   仅传入 `startVideo`，不写回设置页 pick 状态；校验 key 属于 `listStudioModels()` 视频族且支持当前 mode（如无 `supportsVideoRef` 时不带 ref video）。  
   *替代方案：新工具 `set_session_video_model`*——易与多用户/多标签会话混淆；单次参数更窄。

5. **`set_shot_neighbor_refs`**  
   直接读写 `shot.refIds` 中的 `SHOT_PREV` / `SHOT_NEXT` token（与 `shotReferences` 常量一致），不新建 HTTP。  
   *替代方案：画布拖线仿真*——超出 harness 范围。

6. **专家分组**  
   四个新工具归入 `expertToolGroups` 的 `project`（与 `link_shot_refs` 并列）。

## Risks / Trade-offs

- **[Risk] Harness 无实时画布时 fingerprint/节点数据旧** → 写 override 前应用 `ensureProjectLoaded` + 快照重建节点（与 `generate_clip` 相同 `generationContext`）；读工具文档继续提示「未保存画布改动可能不在内」。  
- **[Risk] `audioMode: native` 写后仍 blocking** → 规格要求写前校验；与面板禁用「开启」一致。  
- **[Trade-off] 单次 modelKey 不改变 UI** → Agent 需知晓用户肉眼看到的仍是旧模型；回执 `summary` 写明实际 modelKey。

## Migration Plan

1. 实现工具与 `generate_clip` 修正 → `npm run build:server` → `test:studio` 与子集 harness 测试。  
2. 更新 expert manifest / soul 一段话。  
3. 无数据迁移；旧项目无 override 行为不变。

## Open Questions

- 是否在 `read_shot_video_inputs` 响应中正式暴露 `fingerprint`（便于 agent 不必二次计算）——实现阶段若已有内部计算，建议 **ADD** 只读字段，不另开工具。