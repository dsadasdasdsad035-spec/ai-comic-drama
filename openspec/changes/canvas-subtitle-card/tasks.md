# Tasks

## 1. 数据与类型

- [x] 1.1 扩展 `AssetKind` / `ProjectAsset` / 落库映射以支持 `subtitle` 与 `extra.cues`，验证：`verify-asset-card-extra.mjs` 或新脚本读写往返

## 2. 画布与连线

- [x] 2.1 新建字幕卡入口与节点渲染；接入 `asset-shot-prompt-ref` 的 `sourceShotIds`，验证：纯函数或 UI 断言派生边存在

## 3. Inspector

- [x] 3.1 字幕面板：cue 列表编辑、文本模型选择、从分镜规则填充与 LLM 生成、导出 SRT，验证：`verify-subtitle-card.mjs` + `npx tsc --noEmit`

## 4. 回归

- [x] 4.1 确认「导出本集字幕」行为不变；`node verify-subtitle-card.mjs` 与现有 `verify-asset-card-generation.mjs` 通过