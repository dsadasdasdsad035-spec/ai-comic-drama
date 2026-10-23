/**
 * 把沙箱运行时（含 Three.js core）打成单文件 IIFE。
 * 产物由父页面动态 ?raw 导入并内联进 srcdoc，避免主 bundle 变大。
 */
import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outfile = path.join(root, 'src/sandbox/runtime.generated.js')

await build({
  entryPoints: [path.join(root, 'src/sandbox/runtime.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  outfile,
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': '"production"' },
})

console.log(`sandbox runtime -> ${path.relative(root, outfile)}`)
