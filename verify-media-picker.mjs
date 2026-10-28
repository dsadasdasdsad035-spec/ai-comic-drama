/**
 * 素材卡来源选择器验证（自起临时 dev server + 项目媒体 fixture）：
 * 1) 归一化：空 URL 过滤、重复 URL 去重、按 mtime 排序、类型/标题推导
 * 2) 选择器：分类、搜索、图片/视频预览、确认/取消、当前来源
 * 3) 写回：视频自动切 video、场景保持、默认标题不覆盖手改
 * 4) 空/坏素材、键盘焦点、390px
 * 跑法：node verify-media-picker.mjs
 */
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = 5304
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'media-picker-'))
const PROJECT = 'media-test'
const PROJECT_MEDIA = path.join(TMP, PROJECT, 'assets')
const GEN_IMG = path.join(ROOT, 'public', 'generated', 'picker-generated.png')
const VIDEO = path.join(ROOT, 'public', 'videos', 'picker-test.mp4')
const AUDIO = path.join(PROJECT_MEDIA, 'picker-audio.mp3')
const AUD = `/project-assets/${PROJECT}/picker-audio.mp3`
const A = `/project-assets/${PROJECT}/picker-a.png`
const B = `/project-assets/${PROJECT}/picker-b.png`
const BROKEN = `/project-assets/${PROJECT}/missing.png`
const G = '/generated/picker-generated.png'
const V = '/videos/picker-test.mp4'
const VIDEO2 = path.join(ROOT, 'public', 'videos', 'picker-test-2.mp4')
const V2 = '/videos/picker-test-2.mp4'

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}
const api = (p, init) =>
  fetch(`${APP}${p}`, init).then(async (r) => {
    const j = await r.json().catch(() => ({}))
    return { status: r.status, ...j }
  })

const ffmpeg = process.env.FFMPEG || 'ffmpeg'
const makePng = (file, color) => {
  execFileSync(
    ffmpeg,
    ['-y', '-f', 'lavfi', '-i', `color=c=${color}:s=320x180`, '-frames:v', '1', file],
    { stdio: 'ignore' },
  )
}
const makeAudio = (file) => {
  execFileSync(
    ffmpeg,
    ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libmp3lame', file],
    { stdio: 'ignore' },
  )
}
const makeVideo = (file) => {
  execFileSync(
    ffmpeg,
    ['-y', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10', '-t', '1', '-pix_fmt', 'yuv420p', file],
    { stdio: 'ignore' },
  )
}

const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP }, stdio: 'ignore' },
)

const waitServer = async () => {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`${APP}/api/health`)
      if (r.ok) return true
    } catch {
      /* 继续等 */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

const assetData = (page, id) =>
  page.evaluate((id) => {
    const p = JSON.parse(localStorage.getItem('storyboard-canvas-v1:media-test') || '{}')
    return (p.nodes || []).find((n) => n.id === id)?.data ?? null
  }, id)

let browser
try {
  fs.mkdirSync(PROJECT_MEDIA, { recursive: true })
  fs.mkdirSync(path.dirname(GEN_IMG), { recursive: true })
  fs.mkdirSync(path.dirname(VIDEO), { recursive: true })
  makePng(path.join(PROJECT_MEDIA, 'picker-a.png'), '0x2563eb')
  makePng(path.join(PROJECT_MEDIA, 'picker-b.png'), '0xb45309')
  makePng(GEN_IMG, '0x15803d')
  makeVideo(VIDEO)
  makeVideo(VIDEO2)
  makeAudio(AUDIO)

  if (!(await waitServer())) throw new Error('临时 dev server 启动失败')

  await api(`/api/project?name=${PROJECT}&create=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '素材选择器验证' }),
  })
  await api(`/api/project?name=${PROJECT}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      assets: [
        { kind: 'scene', title: '地下井道', url: A },
        { kind: 'prop', title: '同图道具', url: A },
        { kind: 'image', title: '空素材', url: '' },
        { kind: 'image', title: '坏图', url: BROKEN },
        { kind: 'video', title: '项目视频', url: V },
        { kind: 'video', title: '项目视频二', url: V2 },
        { kind: 'video', title: '坏视频', url: '/videos/missing-picker.mp4' },
        { kind: 'audio', title: '环境雨声', url: AUD },
      ],
    }),
  })

  browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(APP, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)

  // ---- 纯函数：归一化 / 去重 / 类型与标题 ----
  const pure = await page.evaluate(async ({ A, B, G, V, V2, BROKEN, AUD }) => {
    const m = await import('/src/mediaPick.ts')
    const media = {
      assets: [
        { kind: 'scene', title: '地下井道', url: A },
        { kind: 'prop', title: '同图道具', url: A },
        { kind: 'image', title: '空素材', url: '' },
        { kind: 'image', title: '坏图', url: BROKEN },
        { kind: 'video', title: '项目视频', url: V },
        { kind: 'video', title: '项目视频二', url: V2 },
        { kind: 'video', title: '坏视频', url: '/videos/missing-picker.mp4' },
        { kind: 'audio', title: '环境雨声', url: AUD },
      ],
      images: [
        { name: 'picker-a.png', url: A, size: 100, mtime: 10 },
        { name: 'picker-b.png', url: B, size: 200, mtime: 20 },
        { name: 'picker-generated.png', url: G, size: 300, mtime: 30 },
      ],
      videos: [{ name: 'picker-test.mp4', url: V, size: 400, mtime: 40 }],
    }
    const items = m.buildPickItems(media, { url: '', kind: 'image' })
    const a = items.find((i) => i.url === A)
    const video = items.find((i) => i.url === V)
    const generated = items.find((i) => i.url === G)
    return {
      count: items.length,
      aCount: items.filter((i) => i.url === A).length,
      aTitle: a?.title,
      aKind: a?.kind,
      emptyPresent: items.some((i) => i.title === '空素材'),
      videoKind: video ? m.pickKind(video, 'image') : '',
      sceneKind: a ? m.pickKind(a, 'image') : '',
      generatedKind: generated ? m.pickKind(generated, 'prop') : '',
      autoTitle: generated ? m.pickTitle(generated, '新素材') : '',
      keptTitle: generated ? m.pickTitle(generated, '我的标题') : '',
      videoTab: video ? m.pickerTabOf(video) : '',
      audioKind: (() => {
        const a = items.find((i) => i.url && i.kind === 'audio')
        return a ? m.pickKind(a, 'image') : ''
      })(),
      audioTab: (() => {
        const a = items.find((i) => i.url && i.kind === 'audio')
        return a ? m.pickerTabOf(a) : ''
      })(),
    }
  }, { A, B, G, V, V2, BROKEN, AUD })
  check('空 URL 素材被过滤', !pure.emptyPresent && pure.count === 8, JSON.stringify(pure))
  check('重复 URL 只保留一条且项目素材优先', pure.aCount === 1 && pure.aTitle === '地下井道' && pure.aKind === 'scene')
  check('视频自动推导为 video', pure.videoKind === 'video')
  check('场景素材保持 scene', pure.sceneKind === 'scene')
  check('普通图保留/回落规则', pure.generatedKind === 'prop')
  check('默认标题自动填、手改标题保留', Boolean(pure.autoTitle) && pure.keptTitle === '我的标题', JSON.stringify(pure))
  check('视频进入视频页签', pure.videoTab === 'video')
  check('音频自动推导为 audio', pure.audioKind === 'audio')
  check('音频进入音频页签', pure.audioTab === 'audio')

  // ---- 添加素材卡并打开选择器 ----
  await page.locator('.btn-mini').filter({ hasText: '+ 素材' }).first().click()
  await page.waitForTimeout(600)
  const assetId = await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('storyboard-canvas-v1:media-test') || '{}')
    const list = (p.nodes || []).filter((n) => n.type === 'asset')
    return list[list.length - 1]?.id ?? ''
  })
  check('素材卡 Inspector 打开', (await page.locator('.asset-source').count()) === 1)
  await page.locator('.asset-source').click()
  await page.waitForTimeout(700)
  const dialog = page.locator('.mp-dialog')
  check('选择器打开', (await dialog.count()) === 1)
  check('当前素材卡没有 URL 时不写坏地址', (await assetData(page, assetId))?.url === '')

  const projectTab = page.locator('.mp-tabs button').filter({ hasText: '项目素材' })
  const genTab = page.locator('.mp-tabs button').filter({ hasText: '生成图片' })
  const videoTab = page.locator('.mp-tabs button').filter({ hasText: '视频' })
  check('项目素材页签计数存在', /项目素材\s*3/.test(await projectTab.innerText()), await projectTab.innerText())
  check('生成图片页签计数存在', /生成图片/.test(await genTab.innerText()), await genTab.innerText())
  check('视频页签计数存在', /视频/.test(await videoTab.innerText()), await videoTab.innerText())
  check('空素材不在选择器里', (await dialog.getByText('空素材', { exact: true }).count()) === 0)
  check('同图道具被去重', (await dialog.getByText('同图道具', { exact: true }).count()) === 0)
  check('坏素材仍可见', (await dialog.getByText('坏图', { exact: true }).count()) === 1)

  // 搜索
  const search = page.getByLabel('搜索素材')
  await search.fill('地下')
  await page.waitForTimeout(250)
  check('搜索过滤图片', (await dialog.locator('.mp-tile').count()) === 1, String(await dialog.locator('.mp-tile').count()))
  await search.fill('zzz-no-match')
  await page.waitForTimeout(200)
  check('搜索无结果显示空状态', (await page.locator('.mp-empty').innerText()).includes('没有匹配'))
  await search.fill('')
  await page.waitForTimeout(200)

  // 选中图片并确认
  await dialog.locator(`[data-pick-key="${A}"]`).click()
  await page.waitForTimeout(400)
  check('图片详情预览出现', (await page.locator('.mp-detail-preview img').count()) === 1)
  check('确认按钮可用', !(await page.getByRole('button', { name: '使用这个' }).isDisabled()))
  await page.getByRole('button', { name: '使用这个' }).click()
  await page.waitForTimeout(500)
  check('确认后选择器关闭', (await page.locator('.mp-dialog').count()) === 0)
  let data = await assetData(page, assetId)
  check('确认写回 URL / 类型 / 默认标题', data?.url === A && data?.kind === 'scene' && data?.title === '地下井道', JSON.stringify(data))

  // 取消不写回
  await page.locator('.asset-source').click()
  await page.waitForTimeout(600)
  check('重新打开显示当前来源', (await page.locator('.mp-current-badge').count()) === 1)
  await page.locator(`[data-pick-key="${B}"]`).click()
  await page.waitForTimeout(250)
  await page.getByRole('button', { name: '取消' }).click()
  await page.waitForTimeout(300)
  data = await assetData(page, assetId)
  check('取消不修改素材卡', data?.url === A && data?.kind === 'scene', JSON.stringify(data))

  // 坏图：确认禁用
  await page.locator('.asset-source').click()
  await page.waitForTimeout(600)
  await page.locator('.mp-tile').filter({ hasText: '坏图' }).first().click()
  await page.waitForTimeout(500)
  check('坏图显示详情错误', (await page.locator('.mp-detail-error').count()) === 1)
  check('坏图不能确认', await page.getByRole('button', { name: '使用这个' }).isDisabled())
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  check('Esc 关闭并把焦点还给来源按钮', await page.evaluate(() => document.activeElement?.classList.contains('asset-source')))

  // 视频
  await page.locator('.asset-source').click()
  await page.waitForTimeout(600)
  await page.locator('.mp-tabs button').filter({ hasText: '视频' }).click()
  await page.waitForTimeout(300)
  check('视频页签包含项目视频', (await page.locator(`[data-pick-key="${V}"]`).count()) === 1)
  // 坏视频加载失败后渲染成错误占位、不再有 <video>，所以按 key 定位两条可播放视频
  const videoTile = page.locator(`[data-pick-key="${V}"]`)
  const videoTile2 = page.locator(`[data-pick-key="${V2}"]`)
  await videoTile.locator('video').hover()
  await page.waitForTimeout(300)
  check('hover 视频进入播放状态', (await videoTile.locator('.mp-play-badge').innerText()).includes('❚'))
  await videoTile2.locator('video').hover()
  await page.waitForTimeout(300)
  check(
    '同时只播放一条视频',
    (await videoTile.locator('.mp-play-badge').innerText()).includes('▶') &&
      (await videoTile2.locator('.mp-play-badge').innerText()).includes('❚'),
  )
  await page.getByLabel('搜索素材').hover()
  await page.waitForTimeout(200)
  check('移开后视频暂停', (await videoTile2.locator('.mp-play-badge').innerText()).includes('▶'))
  await page.locator('.mp-tile').filter({ hasText: '坏视频' }).first().click()
  await page.waitForTimeout(500)
  check('坏视频显示详情错误', (await page.locator('.mp-detail-error').count()) === 1)
  check('坏视频不能确认', await page.getByRole('button', { name: '使用这个' }).isDisabled())
  await videoTile.click()
  await page.waitForTimeout(300)
  check('视频详情 controls 出现', (await page.locator('.mp-detail-preview video[controls]').count()) === 1)
  await page.getByRole('button', { name: '使用这个' }).click()
  await page.waitForTimeout(500)
  data = await assetData(page, assetId)
  check('选择视频自动切 video', data?.kind === 'video' && data?.url === V, JSON.stringify(data))
  check('画布素材卡按视频渲染', (await page.locator('.asset-node video').count()) >= 1)

  // 音频
  await page.locator('.asset-source').click()
  await page.waitForTimeout(600)
  await page.locator('.mp-tabs button').filter({ hasText: '音频' }).click()
  await page.waitForTimeout(300)
  check('音频页签有 fixture', (await page.locator(`[data-pick-key="${AUD}"]`).count()) === 1)
  await page.locator(`[data-pick-key="${AUD}"]`).click()
  await page.waitForTimeout(500)
  check('音频详情播放器出现', (await page.locator('.mp-detail-preview audio').count()) === 1)
  check('音频详情标注为音频', (await page.locator('.mp-detail-kind').innerText()) === '音频')
  await page.getByRole('button', { name: '使用这个' }).click()
  await page.waitForTimeout(500)
  data = await assetData(page, assetId)
  check('选择音频自动切 audio', data?.kind === 'audio' && data?.url === AUD, JSON.stringify(data))
  check('画布素材卡按音频渲染', (await page.locator('.asset-node audio').count()) >= 1)

  // 音频取消不写回
  await page.locator('.asset-source').click()
  await page.waitForTimeout(600)
  await page.locator('.mp-tabs button').filter({ hasText: '生成图片' }).click()
  await page.waitForTimeout(300)
  await page.locator(`[data-pick-key="${G}"]`).click()
  await page.waitForTimeout(200)
  await page.getByRole('button', { name: '取消' }).click()
  await page.waitForTimeout(400)
  data = await assetData(page, assetId)
  check('音频卡取消不写回', data?.kind === 'audio' && data?.url === AUD, JSON.stringify(data))

  // 生成图片
  await page.locator('.asset-source').click()
  await page.waitForTimeout(600)
  await page.locator('.mp-tabs button').filter({ hasText: '生成图片' }).click()
  await page.waitForTimeout(300)
  check('生成图片页签有 fixture', (await page.locator(`[data-pick-key="${G}"]`).count()) === 1)
  await page.locator(`[data-pick-key="${G}"]`).click()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: '使用这个' }).click()
  await page.waitForTimeout(500)
  data = await assetData(page, assetId)
  check('视频卡换普通图回落 image', data?.kind === 'image' && data?.url === G, JSON.stringify(data))

  // 手填地址：坏地址禁用，好地址可确认
  await page.locator('.asset-source').click()
  await page.waitForTimeout(600)
  await page.locator('.mp-tabs button').filter({ hasText: '手填地址' }).click()
  await page.waitForTimeout(250)
  const manual = page.locator('.mp-manual-input')
  await manual.fill('/project-assets/media-test/missing.png')
  await page.waitForTimeout(500)
  check('手填补坏地址显示错误', (await page.locator('.mp-detail-error').count()) === 1)
  check('手填坏地址不能确认', await page.getByRole('button', { name: '使用这个' }).isDisabled())
  await manual.fill(B)
  await page.waitForTimeout(500)
  check('手填好地址可预览', (await page.locator('.mp-detail-preview img').count()) === 1)
  await page.getByRole('button', { name: '使用这个' }).click()
  await page.waitForTimeout(500)
  data = await assetData(page, assetId)
  check('手填地址写回', data?.url === B, JSON.stringify(data))

  // 键盘：方向键移动 + Enter 选择 + 焦点返回
  await page.locator('.asset-source').click()
  await page.waitForTimeout(600)
  const tiles = page.locator('.mp-tile')
  await tiles.first().focus()
  const firstKey = await tiles.first().getAttribute('data-pick-key')
  await page.keyboard.press('ArrowRight')
  const secondFocus = await page.evaluate(() => document.activeElement?.getAttribute('data-pick-key'))
  check('方向键移动网格焦点', Boolean(secondFocus) && secondFocus !== firstKey, `${firstKey} -> ${secondFocus}`)
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: '使用这个' }).focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  check('键盘可完成选择', (await page.locator('.mp-dialog').count()) === 0)
  check('确认后焦点回到来源按钮', await page.evaluate(() => document.activeElement?.classList.contains('asset-source')))

  // ---- 本地上传：先落盘成条目，仍需确认才写回 ----
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
  const beforeUpload = await assetData(page, assetId)
  await page.locator('.asset-source').click()
  await page.waitForTimeout(600)
  check('选择器有上传入口', (await page.locator('[data-mp-upload]').count()) === 1)
  await page.locator('[data-mp-upload]').click()
  await page.locator('.mp-dialog input[type=file]').setInputFiles({
    name: 'picker-upload.png',
    mimeType: 'image/png',
    buffer: pngBytes,
  })
  await page.waitForTimeout(1400)
  const uploadedKey = await page.evaluate(() => {
    const tile = document.querySelector('.mp-tile')
    return tile?.getAttribute('data-pick-key') || ''
  })
  check('上传后条目排在最前', String(uploadedKey).startsWith('/project-assets/media-test/'), uploadedKey)
  check('上传后自动选中', (await page.locator('.mp-detail-preview img').count()) === 1)
  check('上传后尚未写回素材卡', JSON.stringify(await assetData(page, assetId)) === JSON.stringify(beforeUpload))
  await page.getByRole('button', { name: '使用这个' }).click()
  await page.waitForTimeout(600)
  const afterUpload = await assetData(page, assetId)
  check('确认后写回上传地址', afterUpload?.url === uploadedKey, JSON.stringify({ url: afterUpload?.url, key: uploadedKey }))
  check('上传图按图片渲染', (await page.locator('.asset-node img').count()) >= 1)

  // 上传取消：素材卡不变
  const beforeCancel = await assetData(page, assetId)
  await page.locator('.asset-source').click()
  await page.waitForTimeout(600)
  await page.locator('[data-mp-upload]').click()
  await page.locator('.mp-dialog input[type=file]').setInputFiles({
    name: 'picker-upload-2.png',
    mimeType: 'image/png',
    buffer: pngBytes,
  })
  await page.waitForTimeout(1400)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  check('上传后取消不写回', JSON.stringify(await assetData(page, assetId)) === JSON.stringify(beforeCancel))
  check('Esc 关掉选择器但保留画布选中', (await page.locator('.asset-source').count()) === 1)

  // 不支持的格式：报错且不生成条目
  await page.locator('.asset-source').click()
  await page.waitForTimeout(600)
  const tilesBeforeBad = await page.locator('.mp-tile').count()
  await page.locator('[data-mp-upload]').click()
  await page.locator('.mp-dialog input[type=file]').setInputFiles({
    name: 'IMG_0001.HEIC',
    mimeType: 'image/heic',
    buffer: Buffer.from('not-a-real-heic'),
  })
  await page.waitForTimeout(700)
  const pickerUploadError = await page.locator('.mp-upload-error').innerText().catch(() => '')
  check('选择器拒绝 HEIC 并说明格式', /png \/ jpeg \/ webp/.test(pickerUploadError), pickerUploadError)
  check('拒绝后不新增条目', (await page.locator('.mp-tile').count()) === tilesBeforeBad, String(await page.locator('.mp-tile').count()))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // 390px
  await page.setViewportSize({ width: 390, height: 900 })
  await page.waitForTimeout(250)
  await page.locator('.asset-source').click()
  await page.waitForTimeout(600)
  // 只量选择器自身：画布本体在窄屏本来就会横向滚动，不属于选择器溢出
  const mobile = await page.evaluate(() => {
    const el = document.querySelector('.mp-dialog')
    const d = el?.getBoundingClientRect()
    return {
      sw: el?.scrollWidth ?? 0,
      cw: el?.clientWidth ?? 0,
      width: d?.width ?? 0,
      dialogRight: d?.right ?? 0,
      tabs: document.querySelectorAll('.mp-tabs button').length,
      foot: document.querySelector('.mp-foot')?.getBoundingClientRect().bottom ?? 0,
    }
  })
  check('390px 选择器无横向溢出', mobile.sw <= mobile.cw + 1 && mobile.dialogRight <= 390, JSON.stringify(mobile))
  check('390px 页签和底部操作可见', mobile.tabs === 6 && mobile.foot <= 900, JSON.stringify(mobile))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)

  // 夜间主题下选择器仍用主题 token
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.locator('[data-theme-mode="night"]').click()
  await page.waitForTimeout(200)
  await page.locator('.asset-source').click()
  await page.waitForTimeout(600)
  const nightBg = await page.locator('.mp-dialog').evaluate((el) => getComputedStyle(el).backgroundColor)
  check('夜间选择器使用夜间面板色', nightBg === 'rgb(14, 22, 32)', nightBg)
  await page.keyboard.press('Escape')

  await ctx.close()
} catch (e) {
  check('集成测试执行', false, (e && e.message) || String(e))
} finally {
  await browser?.close().catch(() => {})
  child.kill()
  fs.rmSync(TMP, { recursive: true, force: true })
  fs.rmSync(GEN_IMG, { force: true })
  fs.rmSync(VIDEO, { force: true })
}

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`)
process.exit(bad === 0 ? 0 : 1)
