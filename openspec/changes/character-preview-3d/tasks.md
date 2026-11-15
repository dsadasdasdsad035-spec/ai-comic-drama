# Tasks

## 1. 数据模型与快照

- [x] 1.1 在 `src/characters.ts` 增加 `CharacterOrbitSheet` 类型（4×2 格子、归一化坐标、`fingerprint`、`stale`、`createdAt`、`modelKey`）与可用性/失效函数；验证：新增 `tests/character-preview.ts`，覆盖指纹计算、锚点变化标 stale、参考图变化不失效、不可用判定
- [x] 1.2 在 `src/charMap.ts` 增加 `orbit_sheet` 读写映射，旧数据缺字段时为 undefined；验证：单测覆盖读→写→读回一致，且不同项目互不串
- [x] 1.3 新增 `src/characterPreview/snapshot.ts` 的 `buildPreviewSnapshot(character)` 纯函数，输出 `schemaVersion / generatedAt / identityFingerprint / character / look / orbit? / emotions[] / voice? / glbUrl?`；验证：单测覆盖字段齐全、缺图缺音时的降级、不读取其他角色
- [x] 1.4 在 `verify-skills-unit.mjs` 登记 `tests/character-preview.ts`；验证：`node verify-skills-unit.mjs` 全部通过

## 2. Viewer 与预览页签

- [x] 2.1 新增 `src/characterPreview/escape.ts`：统一 `escapeHtml` 与安全 JSON 注入（`<` → `\u003c`）；验证：单测覆盖引号、尖括号、`</script>`、表情符号与换行
- [x] 2.2 新增 `src/characterPreview/viewer.ts` 的 `buildPreviewHtml(snapshot, resolveAsset)`，先只实现静态合成卡（图 + 文案 + 表情 + 音色信息）；验证：单测断言输出包含角色名与图片地址、不包含未转义文本
- [x] 2.3 在 `src/CharacterCard.tsx` 增加第四页签 `preview`（`type Tab` 与页签栏），用 `<iframe sandbox="allow-scripts" srcdoc>` 渲染；验证：新增 `verify-character-preview.mjs` 断言页签存在、iframe 渲染出角色名、打开页签期间无生图/语音请求
- [x] 2.4 在 `README.md` 角色卡章节补充预览页签说明与"不触发生成"的边界；验证：文档描述与页签实际行为一致

## 3. 单文件导出

- [x] 3.1 实现导出用的 `resolveAsset`（fetch → canvas → WebP，`toDataURL` 不支持 WebP 时回退 JPEG）；验证：单测或 e2e 断言导出字符串中不出现 `/project-assets/` 原始路径
- [x] 3.2 实现导出入口、文件名 sanitize（含角色名）与体积预估 + 超阈值确认弹窗；验证：`verify-character-preview.mjs` 触发下载，检查文件名合法、取消时不产生文件
- [x] 3.3 校验导出文件的离线可用性：用 `file://` 打开下载的文件，确认图片/音频内联且无外部请求；验证：e2e 中监听 request，断言除文件自身外无网络请求，图片可见
- [x] 3.4 校验导出范围与安全：断言文件内不含其他角色名、本机绝对路径，含 `schemaVersion` 与生成时间；验证：同脚本内字符串断言

## 4. 转盘总图生成与栅格裁切

- [x] 4.1 新增转盘总图提示词与生成入口（显示价格、显式点击才提交、走任务中心与计费）；验证：e2e mock 生图接口，断言请求包含该角色三视图与参考图、不包含其他角色图片，未点击时无请求
- [x] 4.2 新增独立栅格裁切函数（按归一化坐标从一张总图裁出 8 格，含边界与异常格自检），不改 `src/expressionCrop.ts`；验证：单测覆盖坐标换算、越界、空指令，并断言既有表情总图裁切行为未变（既有表情相关单测全绿）
- [x] 4.3 生成结果写回 `orbitSheet` 并记录指纹；验证：单测覆盖成功写入、失败不覆盖旧图、锚点变化后 `stale` 为真
- [x] 4.4 预览页显示转盘失效状态与"需重新生成"说明；验证：e2e 改锚点后断言标记出现，重新生成后消失

## 5. 转盘交互与降级链

- [x] 5.1 在 viewer 内实现拖动角度插值与 0–360 循环，pointer 事件统一鼠标与触屏，松手停住；验证：`verify-character-preview.mjs` 拖动断言画面角度变化、松手后不再继续变化、越界回绕无空白
- [x] 5.2 实现降级链：有转盘走转盘、无转盘走静态卡、无图走文字卡；无可用试音时不渲染播放按钮；验证：e2e 用三种角色数据（全有/仅静态/仅文字）分别断言
- [x] 5.3 实现试音播放（用户手势触发、不自动播放、失效时不可播且给出说明）；验证：e2e 断言打开页签时无播放、点击后可播、失效样本不出现播放按钮

## 6. 集成验收

- [x] 6.1 补全 `verify-character-preview.mjs` 为首尾一致的完整流程（页签 → 静态卡 → 生成转盘 → 拖动 → 播放 → 导出 → 离线打开 → 改锚点失效），并确认能被 `verify-all.mjs` 自动发现；验证：`node verify-character-preview.mjs` 全绿
- [x] 6.2 全量类型与构建检查；验证：`npm run build` 通过，且 `git diff package.json` 为空（确认未新增依赖）
- [x] 6.3 回归表情总图与三视图链路；验证：`node verify-character-card-ui.mjs`、`node verify-character-voice-ui.mjs`、`node verify-charextract.mjs` 全绿

## Workflow follow-up

- 按项目评审要求通过后归档本 change，并确认归档后的 spec 落位到 `openspec/specs/character-preview/` 与 `openspec/specs/character-card-export/`。
- 归档后复跑 `verify-character-preview.mjs` 确认归档未改变行为。
