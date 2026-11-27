/**
 * dsh 宿主插件：会话头部的知识库选择器（node 半边）。
 *
 * 这个半边没有宿主行为 —— 与官方 `@deepseek-ai/dsh-client-ui-agent-preset`
 * 同一形态：`apply()` 是空的，作用只是让这一行出现在 cordis 插件树里，
 * 这样 `dsh-client-modules` 才会把它扫描进浏览器 roster，加载 `./client`
 * （见 package.json 的 `dsh.client` 声明与 `exports["./client"]`）。
 *
 * 浏览器半边做的事：在 `conversation.session.header.actions` 插槽里注册一个
 * 下拉，列出所有知识库，选中后写 `/api/knowledge/session-kb`。作用域是
 * `session`，所以组件 props 里带着当前对话的 `sessionId` —— 与工具桥透传给
 * 知识库工具的是同一个值，两边不会漂移。
 */

/** 宿主侧无需任何行为。 */
export function apply() {}

export const name = 'knowledge-ui'
