/**
 * 桌面端主进程入口。
 *
 * 职责边界（见 design.md 决策 2）：
 * 主进程只做「拉起服务进程 → 读 stdout 握手 → 把窗口指向该地址 → 退出时收尸」。
 * 它不实现任何业务接口，也不碰数据；服务端代码在 dev / 独立进程 / 桌面端三种
 * 形态下共用同一份实现。
 */
import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { resolveDataRoots } from './data-roots.mjs'
import { startService, bundledRuntimeEnv } from './service.mjs'

/** 应用根：打包后在 Resources/app（服务端与前端产物都在这里），开发时是仓库根 */
const APP_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'app')
  : path.resolve(import.meta.dirname, '..', '..')
const RENDERER_DIR = path.join(import.meta.dirname, '..', 'renderer')

/**
 * 打包版默认共用的线上账号服务。
 *
 * 桌面端自带的那套账本（`<state>/data/billing.sqlite`）是单机的，用户在网页上充的
 * 积分在桌面端看不到。打包版因此默认把「账号 + 钱包」接口转给公网部署，做到同一账号
 * 同一份积分；开发态仍然用本地账本，避免 `npm run desktop:dev` 把本地调试数据写到线上。
 *
 * 覆盖方式：启动前设 `SB_BILLING_BASE=https://其他域名`，或设 `local` 强制回本地账本。
 */
const DEFAULT_BILLING_BASE = 'https://rechargeai.cn'

function resolveBillingBase() {
  const raw = String(process.env.SB_BILLING_BASE || '').trim()
  if (raw) return raw
  return app.isPackaged ? DEFAULT_BILLING_BASE : ''
}

/**
 * 固定 userData 目录名。
 *
 * 默认值是 productName，一旦改产品名，用户数据就会「消失」（其实是换了目录）。
 * 显式钉住让升级与改名都不影响既有数据；也让开发版与打包版共用同一份数据，
 * 便于在打包产物上复跑既有验收脚本。
 */
const USER_DATA_NAME = 'storyboard-canvas'

/** @type {import('electron').BrowserWindow | null} */
let win = null
/** @type {Awaited<ReturnType<typeof startService>> | null} */
let service = null
/** 是否正在退出：避免退出流程里把「主动停止」误判成崩溃 */
let quitting = false
/** 当前窗口指向的 origin，用于导航白名单 */
let allowedOrigin = ''
/** 崩溃前所在的「路径 + 查询 + hash」，重启后据此回到同一页 */
let lastRoute = ''

// ---------------------------------------------------------------- 单实例

// userData 决定单实例锁的位置与 Chromium 缓存的落点，必须在任何 app API 之前钉住。
// 固定目录名让升级与改产品名都不丢用户数据，也让开发版与打包版共用同一份数据。
// SB_USER_DATA_DIR 仅供验收/多开调试：换目录 = 换一把单实例锁，桌面端开着也能跑验收。
const USER_DATA_OVERRIDE = String(process.env.SB_USER_DATA_DIR || '').trim()
app.setPath(
  'userData',
  USER_DATA_OVERRIDE ? path.resolve(USER_DATA_OVERRIDE) : path.join(app.getPath('appData'), USER_DATA_NAME),
)

// 第二个实例直接退出并聚焦已有窗口。重复启动会拉两个服务进程，
// 两边同时对同一个 SQLite 写入是数据损坏风险，不是体验问题。
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
  boot()
}

function boot() {
  app.whenReady().then(() => {
    installMenu()
    createWindow()
    void ensureService()
  })

  // macOS：点 Dock 图标且没有窗口时重建窗口（服务仍然留在后台）
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
      void ensureService()
    }
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('before-quit', (event) => {
    if (quitting || !service) return
    // 先拦一次，等子进程真正退出后再放行，避免留下孤儿监听进程
    event.preventDefault()
    quitting = true
    const dying = service
    service = null
    dying.stop().finally(() => app.quit())
  })
}

// ---------------------------------------------------------------- 菜单

/**
 * 应用菜单：只保留 macOS 上必需的两项能力。
 *
 * 「第三方组件说明」是合规入口（specs/desktop-app-packaging「第三方组件说明」）：
 * 用户或审查者要能在应用内找到随包组件的版本、来源与许可证，而不是只能翻安装包目录。
 * 直接用系统默认应用打开 markdown 源文件，避免为此引入 markdown 渲染依赖。
 */
function installMenu() {
  const appName = app.getName()
  const openNotices = () => {
    const file = path.join(APP_ROOT, 'THIRD-PARTY-NOTICES.md')
    if (!fs.existsSync(file)) {
      // 开发态文件在仓库 root/desktop 下，打包后由 extraResources 放到 app/ 根
      const devFile = path.resolve(import.meta.dirname, '..', 'THIRD-PARTY-NOTICES.md')
      void shell.openPath(fs.existsSync(devFile) ? devFile : file)
      return
    }
    void shell.openPath(file)
  }
  const template = [
    {
      label: appName,
      submenu: [
        { role: 'about', label: `关于 ${appName}` },
        { type: 'separator' },
        { label: '第三方组件说明', click: openNotices },
        { type: 'separator' },
        { role: 'hide', label: `隐藏 ${appName}` },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: `退出 ${appName}` },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '进入全屏幕' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { role: 'front', label: '前置全部窗口' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ---------------------------------------------------------------- 窗口

/**
 * 标题栏样式。
 *
 * macOS 26（Tahoe）对「自定义 styleMask」的窗口有事件命中回归：把 .titled 去掉后，
 * 窗口某些区域会收不到鼠标事件（表现是单击无反应、双击才行、拖一下窗口就好了）。
 * 用 hiddenInset/hidden 时窗口正好走这条自定义路径，因此默认改用原生标题栏；
 * 想回到自绘顶栏可传 SB_TITLEBAR=hidden。
 */
const TITLEBAR_STYLE = process.env.SB_TITLEBAR || 'default'

function createWindow() {
  const winOptions = {
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#101012',
    // macOS 默认会把「窗口未激活时」的第一次点击吞掉，用来激活窗口：
    // 用户从别的应用切回来单击按钮毫无反应，必须再点一次才生效，体感就是“单击失效、双击才行”。
    // 打开后第一次点击直接落进页面，与浏览器行为一致。
    acceptFirstMouse: true,
    webPreferences: {
      // 渲染进程不碰 Node，所有能力通过 preload 白名单暴露
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 窗口被其他窗口遮住时不要让 Chromium 停止绘制：Tahoe 上停止绘制会连带
      // 丢掉鼠标事件命中，恢复绘制前点击全部无效。
      backgroundThrottling: false,
      preload: path.join(import.meta.dirname, '..', 'preload', 'preload.cjs'),
    },
  }
  if (TITLEBAR_STYLE !== 'default') {
    winOptions.titleBarStyle = TITLEBAR_STYLE
    // 自绘顶栏时把红绿灯摆到与 hiddenInset 接近的位置
    winOptions.trafficLightPosition = { x: 14, y: 16 }
  }
  win = new BrowserWindow(winOptions)

  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => {
    win = null
  })

  // 导航白名单：窗口只允许停在本地服务上，外链交给系统浏览器
  win.webContents.on('will-navigate', (event, url) => {
    if (!allowedOrigin || !url.startsWith(allowedOrigin)) {
      event.preventDefault()
      openExternal(url)
    }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })

  // 记住应用内的路由，崩溃后重启能回到同一页；只在本地服务 origin 上记录，
  // 否则切到 splash/error 时会把 file:// 地址也记进去。
  const rememberRoute = () => {
    try {
      const u = new URL(win?.webContents.getURL() || '')
      if (allowedOrigin && u.origin === allowedOrigin) lastRoute = `${u.pathname}${u.search}${u.hash}`
    } catch {
      /* ignore */
    }
  }
  win.webContents.on('did-navigate', rememberRoute)
  win.webContents.on('did-navigate-in-page', rememberRoute)

  return win
}

function openExternal(url) {
  // 只放行 http(s)，挡掉 file:// 与自定义协议
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
}

/** 停在启动画面 */
function showSplash(win) {
  void win.loadFile(path.join(RENDERER_DIR, 'splash.html'))
}

/** 展示失败页；detail 会显示在可滚动的日志区 */
function showError(win, title, detail) {
  const params = new URLSearchParams({ title, detail })
  void win.loadFile(path.join(RENDERER_DIR, 'error.html'), { search: `?${params}` })
}

/** 断连页：服务在运行中意外退出 */
function showDisconnected(win, detail) {
  const params = new URLSearchParams({ title: '本地服务已断开', detail, mode: 'restart' })
  void win.loadFile(path.join(RENDERER_DIR, 'error.html'), { search: `?${params}` })
}

// ---------------------------------------------------------------- 服务

async function ensureService() {
  if (!win) return
  showSplash(win)

  let roots
  try {
    roots = resolveDataRoots(app.getPath('userData'))
  } catch (e) {
    showError(win, '无法准备数据目录', `数据目录创建失败：${e?.message || String(e)}`)
    return
  }

  try {
    service = await startService({
      root: APP_ROOT,
      // 外部二进制显式注入；存在与否都不影响服务启动，缺了只是对应功能报可读错误
      env: {
        ...roots.env,
        ...bundledRuntimeEnv(APP_ROOT),
        // 账号与钱包的去向：打包版默认线上共用，开发态默认本地账本
        SB_BILLING_BASE: resolveBillingBase(),
      },
      onExit: ({ code, signal }) => {
        // 主动退出时不提示；其它情况一律当作崩溃，把选择权交给用户
        if (quitting || !win) return
        showDisconnected(win, `服务进程已退出（code=${code}, signal=${signal ?? '无'}）\n\n${serviceTail()}`)
      },
    })
    allowedOrigin = service.origin
    // 有记住的路由就回到那一页，否则落到应用首页
    await win.loadURL(`${service.origin}${lastRoute || '/'}`)
  } catch (e) {
    service = null
    showError(win, '本地服务启动失败', String(e?.message || e))
  }
}

function serviceTail() {
  try {
    return service?.logTail?.() || ''
  } catch {
    return ''
  }
}

// 「重启服务」：停掉当前进程后重新握手，成功后重新加载界面
ipcMain.handle('desktop:restart-service', async () => {
  const dying = service
  service = null
  if (dying) {
    try {
      await dying.stop()
    } catch {
      /* 已经死了就继续重启 */
    }
  }
  await ensureService()
  return Boolean(service)
})

// 启动自检失败时不要弹系统对话框把用户困住，统一走错误页
app.on('render-process-gone', (_e, _wc, details) => {
  if (quitting || !win) return
  showError(win, '界面进程异常退出', JSON.stringify(details))
})

// 开发时把未捕获异常打到 stdout，避免窗口白屏后无线索
process.on('uncaughtException', (e) => {
  console.error('[desktop] 未捕获异常：', e)
  if (win) showError(win, '应用内部错误', String(e?.stack || e))
})
process.on('unhandledRejection', (e) => {
  console.error('[desktop] 未处理的 Promise 拒绝：', e)
})
