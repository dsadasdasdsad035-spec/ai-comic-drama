/**
 * 服务进程的桌面端启动壳。
 *
 * 为什么不直接 spawn server/index.mjs（见 specs/desktop-app-host「退出顺序与孤儿进程」）：
 * 需求要求「主进程被系统强杀时，本地服务不能长期继续监听」。强杀时主进程没有任何
 * 机会执行清理代码，所以只能由子进程自己发现父进程没了。
 *
 * 做法：本文件加载服务端入口（stdout 握手与 SIGTERM 处理都在里面，行为完全不变），
 * 再挂一个父进程看门狗。看门狗是桌面端代码，服务端实现保持平台无关、也不需要知道
 * 自己被谁拉起。
 *
 * 为什么放在 server/ 而不是 desktop/main/：打包后 desktop/main 会被打进 asar，
 * 而 asar 内的文件对 spawn 出来的纯 Node 子进程不可见。放在 server/ 下与 index.mjs
 * 同级，打包时随 server/ 一起进 Resources/app/server/，开发与打包两种形态路径一致。
 */
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const HERE = import.meta.dirname
const PARENT_PID = Number(process.env.SB_DESKTOP_PARENT_PID || 0)

await import(pathToFileURL(path.join(HERE, 'index.mjs')).href)

if (Number.isInteger(PARENT_PID) && PARENT_PID > 0) {
  const check = () => {
    try {
      // signal 0 只探测存在性，不发信号
      process.kill(PARENT_PID, 0)
    } catch {
      // 父进程没了：直接退出，别让端口继续被占
      console.error(`[desktop] 父进程 ${PARENT_PID} 已退出，服务随之结束`)
      process.exit(0)
    }
  }
  const timer = setInterval(check, 2000)
  // 不因为这个定时器阻止事件循环退出；监听中的 server 才是保活的那一方
  timer.unref?.()
}
