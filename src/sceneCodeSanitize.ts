import { SCENE_CODE_LIMITS } from './types'

export type SceneCodeCheck = {
  ok: boolean
  code: string
  errors: string[]
  warnings: string[]
}

/**
 * 静态准入是尽力而为的第一道门，不是沙箱。
 * 真正的隔离边界见 design.md「安全：如实降级」：本机进程 + 一次性工作目录 + 只读素材。
 */
const BANNED_IMPORTS =
  /(^|\n)[ \t]*(?:import|from)[ \t]+(os|sys|subprocess|socket|shutil|urllib|http|httpx|requests|ctypes|importlib|pkgutil|pathlib|glob|tempfile|webbrowser|ftplib|telnetlib|smtplib|multiprocessing|pty|resource)\b/

const BLOCKED: { re: RegExp; message: string }[] = [
  { re: BANNED_IMPORTS, message: '不允许导入进程、网络或文件系统模块' },
  { re: /\b__import__\s*\(/, message: '不允许 __import__' },
  { re: /\beval\s*\(/, message: '不允许 eval' },
  { re: /\bexec\s*\(/, message: '不允许 exec' },
  { re: /\bcompile\s*\(/, message: '不允许 compile' },
  { re: /\bopen\s*\(/, message: '不允许直接打开文件；素材请用 ctx.asset(key)' },
  { re: /\binput\s*\(/, message: '不允许交互式输入' },
  { re: /\b__builtins__\b|\b__globals__\b|\b__subclasses__\b|\b__class__\b/, message: '不允许访问解释器内部对象' },
  { re: /\bbpy\.ops\.wm\./, message: '不允许调用 bpy.ops.wm（保存/打开工程）' },
  { re: /\bbpy\.ops\.(?:export|import|script|preferences|file|image)\./, message: '不允许调用导出/导入/脚本/偏好设置类操作' },
  { re: /\bbpy\.data\.libraries\b/, message: '不允许从外部文件加载数据块' },
  { re: /\bbpy\.app\b/, message: '不允许访问 bpy.app（退出码/路径/版本等运行时状态）' },
  { re: /\bbpy\.utils\b/, message: '不允许访问 bpy.utils' },
  { re: /\bbpy\.path\b/, message: '不允许访问 bpy.path' },
  { re: /\bsys\.exit\b/, message: '不允许退出渲染进程' },
  { re: /\b(?:http|https):\/\//i, message: '不允许在代码中出现网络地址' },
  {
    re: /\bbpy\.ops\.mesh\.primitive_capsule_add\b/,
    message: 'Blender 4.2–6.0 没有 primitive_capsule_add；四肢请用 primitive_cylinder_add（或 uv_sphere）组合',
  },
  {
    re: /\bprimitive_cube_add\s*\([^)]*\bsize\s*=\s*\(/,
    message: 'primitive_cube_add 的 size 只能是数字；要长方体请用 size=1 再设 obj.scale',
  },
]

export function stripCodeFences(raw: string): string {
  let s = String(raw || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  // 模型经常在代码前后带说明；取第一个 fenced block，而不是要求整段就是围栏。
  const fence = s.match(/```(?:[a-zA-Z0-9_+-]+)?[ \t]*\n([\s\S]*?)\n```/)
  if (fence) {
    s = fence[1]
  } else {
    const tilde = s.match(/~~~(?:[a-zA-Z0-9_+-]+)?[ \t]*\n([\s\S]*?)\n~~~/)
    if (tilde) s = tilde[1]
  }
  // 少数模型只写一行语言名，没有围栏。
  const first = s.split('\n', 1)[0].trim().toLowerCase()
  if (['python', 'python3', 'py'].includes(first)) s = s.split('\n').slice(1).join('\n')
  return s.trim()
}

/** 旧 Three.js 代码的典型特征；命中就拒绝，避免送进 Blender 才报语法错误。 */
const THREE_SIGNATURES = [
  /\bfunction\s+init\s*\(/,
  /\brenderAt\s*\(/,
  /\bnew\s+THREE\./,
  /\bctx\.THREE\b/,
  /\bconst\s+THREE\s*=/,
  /\blet\s+S\s*;/,
]

function looksLikeThreeCode(code: string): boolean {
  return THREE_SIGNATURES.some((re) => re.test(code))
}

function hasEntry(code: string, name: string): boolean {
  return new RegExp(`(^|\\n)[ \\t]*def[ \\t]+${name}[ \\t]*\\(`, 'm').test(code)
}

/**
 * 模块顶层（非缩进）出现的 ctx 引用。
 * 宿主 exec 代码时命名空间里没有 ctx，只有调用 build(ctx) 时才注入；
 * 顶层引用会直接抛 [init] NameError，提前拦下比让 Blender 报错更清楚。
 */
function topLevelCtxLines(code: string): number[] {
  const lines = code.split('\n')
  const hits: number[] = []
  let triple: '"""' | "'''" | null = null
  let blockBodyIndent: number | null = null
  let pendingBlock = false
  const indentOf = (line: string) => (line.match(/^[ \t]*/) || [''])[0].length
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (triple) {
      if (line.includes(triple)) triple = null
      continue
    }
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    // 模块级文档字符串里常写 build(ctx)，整段跳过
    const docOpen = line.match(/("""|''')/)
    if (docOpen && !line.slice(line.indexOf(docOpen[1]) + 3).includes(docOpen[1])) {
      triple = docOpen[1] as '"""' | "'''"
      if (pendingBlock) {
        blockBodyIndent = indentOf(line)
        pendingBlock = false
      }
      continue
    }
    const indent = indentOf(line)
    if (pendingBlock) {
      blockBodyIndent = indent
      pendingBlock = false
    }
    if (blockBodyIndent !== null && indent < blockBodyIndent) blockBodyIndent = null
    const moduleLevel = indent === 0 || blockBodyIndent !== null
    const bare = line
      .replace(/"""(?:[\s\S]*?)"""|'''(?:[\s\S]*?)'''/g, '')
      .replace(/(["'])(?:\\.|(?!\1).)*\1/g, '')
      .replace(/#.*$/, '')
    if (
      moduleLevel &&
      /\bctx\b/.test(bare) &&
      !/^\s*def\s+\w+\s*\(\s*ctx\s*[,)]/.test(bare) &&
      !/^\s*def\s+build\s*\(\s*ctx\s*\)/.test(bare)
    ) {
      hits.push(i + 1)
    }
    // 顶层 if/try/for/while/with 的缩进块仍属于模块级；def/class 不算
    if (indent === 0 && /:\s*$/.test(bare) && !/^(def|class)\b/.test(bare)) pendingBlock = true
  }
  return hits
}

export function checkSceneCode(raw: string, opts: { maxBytes?: number } = {}): SceneCodeCheck {
  const code = stripCodeFences(raw)
  const errors: string[] = []
  const warnings: string[] = []
  if (!code) return { ok: false, code, errors: ['代码为空'], warnings }
  if (/^(?:```|~~~)/.test(code)) {
    errors.push('代码包含未闭合的 Markdown 围栏；请只返回纯代码')
  }
  if (looksLikeThreeCode(code)) {
    errors.push('这看起来是旧 Three.js 代码；请改成 build(ctx)/pose(t, mode)/dispose() 的 Blender Python')
  }
  const maxBytes = opts.maxBytes ?? SCENE_CODE_LIMITS.codeBytes
  const bytes = new TextEncoder().encode(code).length
  if (bytes > maxBytes) errors.push(`代码 ${Math.round(bytes / 1024)}KB，超过上限 ${Math.round(maxBytes / 1024)}KB`)
  for (const item of BLOCKED) {
    if (item.re.test(code)) errors.push(item.message)
  }
  for (const name of ['build', 'pose']) {
    if (!hasEntry(code, name)) errors.push(`代码必须定义 ${name}() 入口`)
  }
  const topCtx = topLevelCtxLines(code)
  if (topCtx.length) {
    errors.push(
      `第 ${topCtx.slice(0, 3).join('、')} 行在模块顶层引用了 ctx；宿主加载代码时没有 ctx，` +
        '请把建场景逻辑放进 build(ctx)，由宿主调用，不要在 import 时执行',
    )
  }
  if (!hasEntry(code, 'dispose')) warnings.push('代码没有定义 dispose，运行时会做兜底清理')
  return { ok: errors.length === 0, code, errors, warnings }
}

export function assertSceneCode(raw: string): string {
  const checked = checkSceneCode(raw)
  if (!checked.ok) throw new Error(checked.errors[0] || '代码不可用')
  return checked.code
}
