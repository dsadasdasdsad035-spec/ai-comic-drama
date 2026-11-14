import { defineConfig, type Plugin } from 'vite'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createAppHandler, runServerShutdownTasks, runServerStartupTasks } from './server/app.ts'

/**
 * 接口实现全部在 server/app.ts；这里只保留 vite 侧的装配。
 * 独立入口（server/index.mjs）调用同一个 createAppHandler，两个模式行为一致。
 */
function appServerPlugin(): Plugin {
  return {
    name: 'storyboard-app-server',
    configureServer(server) {
      const root = server.config.root
      runServerStartupTasks(root)
      server.httpServer?.on('close', () => {
        runServerShutdownTasks()
      })
      server.middlewares.use(createAppHandler({ root }))
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), appServerPlugin()],
  resolve: {
    alias: { '@': path.resolve(process.cwd(), 'src') },
  },
  server: {
    port: 5273,
    host: '127.0.0.1',
    // ngrok / 反代 / 局域网访问时 Vite 默认按 Host 头拦请求（403 text/plain）。
    // 这里显式放开，否则公网只能通 /api/*，页面和模块全被挡。
    allowedHosts: true,
    watch: {
      // 验收脚本、OpenSpec 产物、渲染作业与项目数据不属于前端模块；
      // 监听它们会在生成/渲染过程中触发整页刷新，把 agent 运行和 Playwright 流程打断。
      ignored: [
        '**/openspec/**',
        '**/verify-*.mjs',
        '**/.blender-jobs/**',
        '**/.vggt-jobs/**',
        '**/.scene-drafts/**',
        '**/fixtures/**',
        '**/projects/**',
        '**/public/videos/**',
        '**/public/generated/**',
        '**/public/voices/**',
        '**/public/exports/**',
      ],
    },
  },
  build: {
    // 运行时媒体不再被拷进产物：dist 只放前端代码，媒体由 SB_MEDIA_ROOT 决定。
    // 只读资产（public/presets）由独立入口的静态层兜底。
    copyPublicDir: false,
  },
})

