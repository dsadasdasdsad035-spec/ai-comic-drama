# Tasks

## 1. 数据字段与映射

- [x] 1.1 在 `src/characters.ts` 的 `CharacterSheet` 增加 `referenceImages?: string[]`；在 `src/charMap.ts` 的 `ProjectChar` 增加 `reference_images?: string[]`，`toSheet` 与 `toProject` 双向映射并让写入过 `local()` 过滤。在 `verify-chars.mjs` 增加段：含 dataURL 的参考图不写进 `project.json`，站内路径可往返。
- [x] 1.2 确认 `identityFingerprint` 的输入不变（仍只有 `lookEn` / `palette` / `keywords`）。在 `verify-expression.mjs` 或 `verify-expression-sheet.mjs` 增加断言：新增参考图后 `identityFingerprint` 不变、表情总图不标 stale。

## 2. 角色卡参考图区

- [x] 2.1 在 `src/CharacterCard.tsx` 的三视图页增加参考图区：缩略图列表、删除、上传按钮（`accept="image/png,image/jpeg,image/webp"`，复用 `mediaUpload`）、上限 4 张的提示与禁用。运行 `node verify-character-card-ui.mjs`，确认上传后列表出现新图且 `onPersist` 被调用。
- [x] 2.2 增加「设为三视图」按钮：点击后更新 `candidates`（追加该 URL）、`activeIdx` 指向它、`image` 更新，参考图列表保留该条并标记「已在候选」。在 `verify-character-card-ui.mjs` 增加段：提升后 `image` 为该 URL，`referenceImages` 长度不变。
- [x] 2.3 处理失败路径：类型/大小校验失败、读取失败、保存失败都只显示错误不改状态。在 `verify-character-card-ui.mjs` 增加断言。

## 3. 生成调用接入参考图

- [x] 3.1 改 `generateTurnaround`：提示词不变，请求加上 `refImages: referenceImages`（非空时）。在 `verify-chars.mjs` 增加段：有参考图时请求体包含 `refImages` 且长度正确。
- [x] 3.2 改 `generateSheet`：`refImage` 仍为 `c.image`，`refImages` 为参考图；提示词补一句说明「图 1 是当前三视图，其余是同一角色的其他参考，不要当成不同人物」。在 `verify-expression-sheet.mjs` 增加断言确认 `refImages` 与 `refImage` 同时出现。
- [x] 3.3 确认没有参考图时请求体不出现 `refImages` 字段（不传空数组）。在 `verify-chars.mjs` 增加断言。

## 4. 分镜预算隔离

- [x] 4.1 确认 `collectShotReferences` 不读取 `referenceImages`，分镜参考集合与预算计算不变。在 `verify-refs.mjs` 增加段：角色有三张参考图时，该镜参考集合仍只含三视图，`used` 数量与没有参考图时一致。
- [x] 4.2 确认出片附件清单不出现参考图。运行 `node verify-video-prompt-preview.mjs` 与 `node verify-video-ref-ui.mjs`，并按需在脚本中增加断言。

## 5. 集成与回归

- [x] 5.1 运行 `npx tsc --noEmit` 与 `npm run build`，修复类型问题。
- [x] 5.2 运行 `node verify-all.mjs`。新增 `verify-character-reference` 与扩展后的 `verify-character-card-ui` 全绿；`verify-media-persistence` 因角色卡多了一个 file input 而失败，已把选择器收窄到三视图那个并修复。全量跑相对基线无新增失败。
- [x] 5.3 手工验证完整链路：上传两张参考图 → 生成三视图（请求带参考图）→ 设为三视图 → 分镜出图（参考集合含该图、不含参考图列表）→ 刷新后参考图仍在。
- [x] 5.4 在 `README.md` 的角色环节说明处补一段：参考图只用于生成三视图与表情总图，不进入分镜参考预算；要进分镜需先「设为三视图」。
