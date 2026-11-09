# 转场食谱索引（轻量）

`transitionRecipes.json` 提供 Agent 与「智能建议」引用的卡片 id / 意图摘要，命名风格对齐 [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft) 的 `references/shots/`，**不包含** Remotion 实现。

## 从 video-shotcraft 增量同步（可选）

1. `git clone https://github.com/Vincentwei1021/video-shotcraft.git`（或 AtomGit 镜像）
2. 浏览 `references/shots/transitions/*.md` 与需要的 `camera/*.md`
3. 为每张卡片提取：`id`（文件名）、`title`（首行标题）、`intent`（前 120 字摘要）、`tags`
4. 合并进本目录 `transitionRecipes.json`，保持 `category` 为 `transition` 或 `camera`
5. 跑 `node verify-transitions.mjs` 确认建议接口仍能解析 id

本仓库默认只提交精简手写条目，避免 submodule 体积与许可证捆绑。
