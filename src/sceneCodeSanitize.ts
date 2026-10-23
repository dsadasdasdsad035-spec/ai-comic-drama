import { SCENE_CODE_LIMITS } from './types'

export type SceneCodeCheck = {
  ok: boolean
  code: string
  errors: string[]
  warnings: string[]
}

const BLOCKED: { re: RegExp; message: string }[] = [
  { re: /\bimport\s*\(/i, message: '不允许动态 import' },
  { re: /\brequire\s*\(/i, message: '不允许 require' },
  { re: /\bfetch\s*\(/i, message: '不允许 fetch 网络请求' },
  { re: /\bXMLHttpRequest\b/i, message: '不允许 XMLHttpRequest' },
  { re: /\bWebSocket\b/i, message: '不允许 WebSocket' },
  { re: /\bimportScripts\s*\(/i, message: '不允许 importScripts' },
  { re: /document\s*\.\s*cookie/i, message: '不允许访问 Cookie' },
  { re: /\blocalStorage\b/i, message: '不允许访问 localStorage' },
  { re: /\bsessionStorage\b/i, message: '不允许访问 sessionStorage' },
  { re: /\bwindow\s*\.\s*parent\b/i, message: '不允许访问父页面' },
  { re: /\bwindow\s*\.\s*top\b/i, message: '不允许访问顶层页面' },
  { re: /\b(?:parent|top)\s*\.\s*(?:document|location|localStorage|sessionStorage)\b/i, message: '不允许访问父页面/顶层页面' },
  { re: /\bwindow\s*\.\s*open\s*\(/i, message: '不允许打开新窗口' },
]

export function stripCodeFences(raw: string): string {
  let s = String(raw || '').trim()
  const fence = s.match(/^```(?:[a-zA-Z0-9_+-]+)?\s*\n([\s\S]*?)\n```\s*$/)
  if (fence) s = fence[1]
  if (/^~~~/.test(s)) {
    const t = s.match(/^~~~(?:[a-zA-Z0-9_+-]+)?\s*\n([\s\S]*?)\n~~~\s*$/)
    if (t) s = t[1]
  }
  return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
}

function hasEntry(code: string, name: string): boolean {
  return new RegExp(`(?:function\\s+${name}\\s*\\(|(?:const|let|var)\\s+${name}\\s*=|^\\s*${name}\\s*=)`, 'm').test(code)
}

export function checkSceneCode(raw: string, opts: { maxBytes?: number } = {}): SceneCodeCheck {
  const code = stripCodeFences(raw)
  const errors: string[] = []
  const warnings: string[] = []
  if (!code) return { ok: false, code, errors: ['代码为空'], warnings }
  const maxBytes = opts.maxBytes ?? SCENE_CODE_LIMITS.codeBytes
  const bytes = new TextEncoder().encode(code).length
  if (bytes > maxBytes) errors.push(`代码 ${Math.round(bytes / 1024)}KB，超过上限 ${Math.round(maxBytes / 1024)}KB`)
  for (const item of BLOCKED) {
    if (item.re.test(code)) errors.push(item.message)
  }
  for (const name of ['init', 'renderAt']) {
    if (!hasEntry(code, name)) errors.push(`代码必须定义 ${name}`)
  }
  if (!hasEntry(code, 'dispose')) warnings.push('代码没有定义 dispose，运行时会做兜底清理')
  try {
    // 只解析，不执行；真正的运行校验在沙箱里。
    new Function(`${code}\n;return { init: typeof init === 'function', renderAt: typeof renderAt === 'function' }`)
  } catch (e) {
    errors.push(`语法错误：${(e as Error).message}`)
  }
  return { ok: errors.length === 0, code, errors, warnings }
}

export function assertSceneCode(raw: string): string {
  const checked = checkSceneCode(raw)
  if (!checked.ok) throw new Error(checked.errors[0] || '代码不可用')
  return checked.code
}
