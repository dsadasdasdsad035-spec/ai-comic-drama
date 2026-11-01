# 浏览器打包体积记录

`npm run build` 产物对比。目的：确认「所有聊天共用 pi 运行时」之后首屏体积的实际变化。

## 本次（单引擎 + 原生工具调用）

| 产物 | 原始 | gzip |
|---|---|---|
| `index-*.js`（主包，含 pi 运行时） | 2,035.37 kB | 640.90 kB |
| `SceneAgentChat-*.js` | 68.21 kB | 22.76 kB |
| `SkillChat-*.js` | 27.23 kB | 10.50 kB |
| `PublishChatPanel-*.js` | 22.71 kB | 8.96 kB |
| `index-*.css` | 222.19 kB | 37.63 kB |
| 全部 JS 合计 | 约 2.1 MB | — |

## 升级前（同机上一次构建）

| 产物 | 原始 | gzip |
|---|---|---|
| `index-*.js` | 2,035.29 kB | 640.88 kB |
| `SceneAgentChat-*.js` | 67.97 kB | 22.69 kB |
| `SkillChat-*.js` | 27.21 kB | 10.50 kB |
| `PublishChatPanel-*.js` | 22.71 kB | 8.96 kB |

## 结论

- 主包 **+0.08 kB 原始 / +0.02 kB gzip**，可视为噪声：pi 运行时原本就因 3D 聊天默认走 pi 而在包内，新增的只是把同一份代码给工作台聊天复用。
- 删除 `@langchain/core` 与 `@langchain/langgraph` 后安装体积减少 18 个包（约 19 MB 解包），未带来可测的产物反弹。
- 聊天入口仍按界面懒加载（`SkillChat` / `PublishChatPanel` / `SceneAgentChat` 均为独立 chunk），首屏不受聊天体积影响。

## 后续可选优化

pi 运行时位于主包而非聊天 chunk。若要进一步压首屏，可把 `src/agent/pi/` 的运行时改为聊天入口内的动态 import；
当前体积增量不构成做这件事的理由。
