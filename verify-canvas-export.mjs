import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const URL = process.env.APP_URL || 'http://127.0.0.1:5273/'
const candidates = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  chromium.executablePath(),
].filter(Boolean)
const executablePath = candidates.find((path) => existsSync(path))

if (!executablePath) throw new Error('找不到 Chrome；可用 CHROME_PATH 指定可执行文件')

const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage({ viewport: { width: 1560, height: 940 }, acceptDownloads: true })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

try {
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)

  const button = page.getByRole('button', { name: '导出 PNG' })
  await button.waitFor()
  const downloadPromise = page.waitForEvent('download')
  await button.click()
  const download = await downloadPromise
  const file = await download.path()
  if (!file) throw new Error('浏览器没有生成下载文件')

  const png = await readFile(file)
  const signature = png.subarray(0, 8).toString('hex')
  if (signature !== '89504e470d0a1a0a') throw new Error(`不是有效 PNG：${signature}`)

  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  if (width < 1280 || height < 720) throw new Error(`导出尺寸过小：${width}x${height}`)
  if (errors.length) throw new Error(`页面错误：${errors.join('; ')}`)

  console.log(`画布 PNG 导出通过：${width}x${height}，${png.length} bytes`)
} finally {
  await browser.close()
}
