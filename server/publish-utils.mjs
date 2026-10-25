/**
 * 发布链路的环境探测与错误处理小工具。
 *
 * 这里刻意不碰 cookie：浏览器会话只存在于 profile 目录里，
 * 任何进入数据库、任务台账或界面的文本都必须先过 sanitizeError。
 */
import fs from 'node:fs'
import path from 'node:path'

/** 系统 Chrome 的常见位置；本项目验证脚本统一用 channel: 'chrome' */
const CHROME_CANDIDATES = [
  process.env.PUBLISH_CHROME_PATH || '',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]

export function resolveChrome() {
  for (const p of CHROME_CANDIDATES) {
    if (!p) continue
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
    } catch {
      /* continue */
    }
  }
  return ''
}

export function chromeAvailable() {
  return Boolean(resolveChrome())
}

/**
 * 清洗错误文本：去掉 URL 查询串、Bearer/token 样式片段，
 * 并截断到 500 字符。数据库与 API 都只使用清洗后的结果。
 */
export function sanitizeError(input) {
  let s = ''
  if (input instanceof Error) s = input.message || input.name || '未知错误'
  else if (input == null) s = ''
  else s = String(input)
  s = s.replace(/([?&][^=\s]+)=([^&\s]*)/g, '$1=***')
  s = s.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 ***')
  s = s.replace(/\b(token|secret|password|cookie|sessionid|access_token|refresh_token)\b\s*[:=]\s*[^\s,;]+/gi, '$1=***')
  s = s.replace(/(?:^|[\s"'(])\/(?:Users|home|root)\/[^\s"')]+/g, ' [path]')
  s = s.replace(/\s+/g, ' ').trim()
  return s.slice(0, 500)
}

/** 站内 URL 允许根：发布相关文件只认这几类 */
export const ALLOWED_URL_PREFIXES = [
  '/exports/',
  '/videos/',
  '/generated/',
  '/project-assets/',
]

/**
 * 站内 URL → 绝对路径，并确认解析结果仍在允许根内。
 * 同时检查符号链接：目标必须在允许根之内，防止用一个链接把任意文件带出去。
 *
 * appRoot 是静态资源根（仓库根，public/* 在这里）；
 * projectsRoot 是项目数据根（可能被 SB_PROJECTS_DIR 改到别处），默认 appRoot/projects。
 */
export function resolvePublishFile(appRoot, url, opts = {}) {
  const raw = String(url || '').split('?')[0].split('#')[0]
  if (!raw) throw new Error('文件地址为空')
  if (/^[a-z]+:\/\//i.test(raw)) throw new Error('不接受远程地址')
  if (raw.includes('\0')) throw new Error('文件地址非法')
  const normalized = raw.startsWith('/') ? raw : `/${raw}`
  if (normalized.split('/').includes('..')) throw new Error('文件地址越界')
  const prefix = ALLOWED_URL_PREFIXES.find((p) => normalized.startsWith(p))
  if (!prefix) throw new Error(`不允许的文件位置：${normalized.slice(0, 80)}`)

  const rel = normalized.slice(prefix.length)
  const baseDir = prefix === '/project-assets/'
    ? String(opts.projectsRoot || path.join(appRoot, 'projects'))
    : path.join(appRoot, 'public', prefix.replace(/^\/|\/$/g, ''))
  const full = path.join(baseDir, rel)
  const inside = path.relative(baseDir, full)
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) throw new Error('文件地址越界')

  let real = full
  try {
    real = fs.realpathSync(full)
  } catch {
    throw new Error(`文件不存在：${normalized.slice(0, 120)}`)
  }
  let realBase = baseDir
  try {
    realBase = fs.realpathSync(baseDir)
  } catch {
    /* base 不存在则直接用字面值比较 */
  }
  const realInside = path.relative(realBase, real)
  if (!realInside || realInside.startsWith('..') || path.isAbsolute(realInside)) {
    throw new Error('文件链接指向允许目录之外')
  }
  return { path: real, url: normalized }
}

/** 工作目录：profile 与发布包都在项目根下，且不进仓库 */
export function profilesRoot(appRoot) {
  return path.join(appRoot, '.publish-profiles')
}

export function packagesRoot(appRoot) {
  return path.join(appRoot, 'public', 'publish-packages')
}
