/**
 * 最小 preload：只暴露版本号与「重启服务」一个动作。
 *
 * 为什么不暴露 ipcRenderer 本体：渲染进程虽然是我们自己的前端，但它渲染的
 * 内容来自本地 HTTP 服务，一旦有注入就能顺着 preload 摸到主进程。白名单式
 * 暴露把可调用面压到最小。
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  /** 请求主进程重启本地服务；返回 Promise<boolean>，成功为 true */
  restartService: () => ipcRenderer.invoke('desktop:restart-service'),
})
