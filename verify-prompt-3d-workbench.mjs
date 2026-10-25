/**
 * 提示词工作台 3D 调度入口验收（Playwright）：
 * - 3D 列状态与打开入口
 * - 未上画布镜头也能打开 3D 工作台
 * - 画布右击 / Inspector 不再有 3D 入口
 * - 关闭 3D 不丢提示词草稿；保存提示词不会被 3D 字段覆盖
 * 跑法：先启动 dev server，再 node verify-prompt-3d-workbench.mjs
 *   APP_URL 默认 http://127.0.0.1:5280
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const URL = process.env.APP_URL || 'http://127.0.0.1:5280'
const NAME = `verify-prompt-3d-${Date.now()}`
const DRAFT = `视频指令草稿-${Date.now()}`
let bad = 0
const check = (n, c, e = '') => {
  console.log(`${c ? '✅' : '❌'} ${n}${e ? ' | ' + e : ''}`)
  if (!c) bad++
}

// 3D-only 写回补丁：只含 3D 字段，绝不能带提示词/描述
const PATCH_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-3d-patch-'))
const patchEntry = path.join(PATCH_TMP, 'entry.ts')
fs.writeFileSync(patchEntry, `export * from ${JSON.stringify(path.join(ROOT, 'src/shot3dPatch.ts'))}\n`)
const patchBundle = path.join(PATCH_TMP, 'bundle.mjs')
execFileSync(path.join(ROOT, 'node_modules', '.bin', 'esbuild'), [
  patchEntry,
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--log-level=error',
  `--outfile=${patchBundle}`,
])
const patchLib = await import(patchBundle)
const savePatch = patchLib.shot3DSavePatch({
  sceneCode: { version: 2, abiVersion: 2, runtime: 'blender', engineVersion: '5', code: 'x', codeHash: 'h', source: 'manual' },
  shot3DContext: { version: 1 },
})
const renderPatch = patchLib.shot3DRenderPatch({
  sceneCode: { version: 2, abiVersion: 2, runtime: 'blender', engineVersion: '5', code: 'x', codeHash: 'h', source: 'manual' },
  shot3DContext: { version: 1 },
  video: '/videos/x.mp4',
  scheduleMeta: { version: 1 },
  frames: ['/generated/f.jpg'],
  existingMotionNote: '旧运镜',
})
check(
  '3D 保存补丁不带提示词/描述/表演',
  !('keyframe_prompt' in savePatch) &&
    !('video_prompt' in savePatch) &&
    !('desc' in savePatch) &&
    !('performance' in savePatch) &&
    !('dialogue' in savePatch),
  JSON.stringify(Object.keys(savePatch)),
)
check(
  '3D 保存补丁只含 3D 字段',
  'scene_code' in savePatch && 'shot_3d_context' in savePatch,
  JSON.stringify(Object.keys(savePatch)),
)
check(
  '3D 渲染补丁带视频/元数据/运镜',
  renderPatch.schedule_video === '/videos/x.mp4' &&
    renderPatch.motion_note === '旧运镜' &&
    Array.isArray(renderPatch.schedule_frames) &&
    !('keyframe_prompt' in renderPatch) &&
    !('video_prompt' in renderPatch),
  JSON.stringify(Object.keys(renderPatch)),
)
const { mergeShots } = await import('./server/data.mjs')
const merged = mergeShots(
  [
    {
      id: 'E01-S01',
      keyframe_prompt: 'KEEP-K',
      video_prompt: 'KEEP-V',
      desc: 'KEEP-D',
      performance: [{ character: 'A' }],
      use_schedule_video_ref: true,
    },
  ],
  [{ id: 'E01-S01', ...savePatch }],
)[0]
check(
  '部分合并保留提示词/描述/表演/旧开关',
  merged.keyframe_prompt === 'KEEP-K' &&
    merged.video_prompt === 'KEEP-V' &&
    merged.desc === 'KEEP-D' &&
    merged.performance?.[0]?.character === 'A' &&
    merged.use_schedule_video_ref === true &&
    merged.scene_code === savePatch.scene_code,
  JSON.stringify({ k: merged.keyframe_prompt, v: merged.video_prompt, d: merged.desc, s: Boolean(merged.scene_code) }),
)
const allShots = mergeShots(
  [
    { id: 'A', keyframe_prompt: 'KA' },
    { id: 'B', keyframe_prompt: 'KB' },
  ],
  [{ id: 'A', ...savePatch }, { id: 'B', keyframe_prompt: 'KB' }],
)
check(
  '完整镜头列表写回不标 orphan',
  allShots.every((s) => !s.orphan) && allShots[0]?.keyframe_prompt === 'KA',
  JSON.stringify(allShots.map((s) => ({ id: s.id, orphan: s.orphan, k: s.keyframe_prompt }))),
)
fs.rmSync(PATCH_TMP, { recursive: true, force: true })
const api = (p, init) => fetch(`${URL}${p}`, init).then((r) => r.json())

await api(`/api/project?name=${encodeURIComponent(NAME)}&create=1`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: NAME, aspect: '16:9' }),
})
await api(`/api/project?name=${encodeURIComponent(NAME)}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    episodes: [{ no: 1, title: '测试集', scenes: [{ no: 1, slug: '房间', place: '房间', time: '夜' }] }],
    shots: [
      {
        id: 'E01-S01',
        episode: 1,
        no: 'S01',
        scene_no: 1,
        scene_slug: '房间',
        seconds: 3,
        size: '中景',
        move: '固定',
        desc: '人物站在窗边，冷光照在侧脸',
        keyframe_prompt: 'medium shot, a person stands by the window, cool light',
        video_prompt: 'static camera, the person turns their head slowly',
        dialogue: [],
        cast: [],
      },
      {
        id: 'E01-S02',
        episode: 1,
        no: 'S02',
        scene_no: 1,
        scene_slug: '房间',
        seconds: 3,
        size: '中景',
        move: '固定',
        desc: '已有渲染的镜头',
        keyframe_prompt: 'medium shot, an empty room',
        video_prompt: '',
        dialogue: [],
        cast: [],
        schedule_video: '/videos/schedule-test.mp4',
        motion_note: '固定机位',
        use_schedule_video_ref: true,
        use_schedule_frames: true,
      },
    ],
  }),
})

const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1680, height: 1100 } })
const errors = []
p.on('pageerror', (e) => errors.push(e.stack || e.message))
let textCalls = 0
await p.route('**/api/text', (route) => {
  textCalls++
  return route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: false, message: '测试环境不调用文本模型' }),
  })
})
await p.route('**/api/blender/health*', (route) =>
  route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      ok: false,
      path: null,
      version: null,
      min: '4.2',
      max: '6',
      reason: 'test',
      message: '测试环境禁用 Blender',
      defaults: {
        engine: 'BLENDER_EEVEE_NEXT',
        trialFps: 30,
        proxyFps: 15,
        finalFps: 30,
        trialSamples: 8,
        proxySamples: 16,
        finalSamples: 32,
      },
    }),
  }),
)

await p.goto(URL, { waitUntil: 'networkidle' })
await p.locator('.topbar-project select').selectOption(NAME)
await p.waitForTimeout(900)
await p.getByRole('button', { name: '提示词', exact: true }).click()
await p.waitForTimeout(900)

check('出现 3D 列', (await p.locator('.pt-table thead th', { hasText: '3D' }).count()) === 1)
const cell = p.locator('.pt-table tbody tr').first().locator('.pt-3d')
check('未渲染状态', (await cell.innerText()).includes('未渲染'), await cell.innerText())
check('有打开按钮', (await cell.locator('button', { hasText: '打开' }).count()) === 1)
check('已渲染镜头有查看链接', (await p.locator('.pt-3d a', { hasText: '查看' }).count()) === 1)
check('查看链接指向渲染视频', (await p.locator('.pt-3d a', { hasText: '查看' }).first().getAttribute('href')) === '/videos/schedule-test.mp4')

const videoArea = p.locator('.pt-table tbody tr').first().locator('textarea').nth(1)
await videoArea.fill(DRAFT)
await p.waitForTimeout(200)

// 未推到画布就开始 3D，验证项目镜头可直接打开
await cell.locator('button', { hasText: '打开' }).click()
await p.waitForTimeout(1800)
const dialog = p.locator('[aria-label="3D 代码工作台"]')
check('3D 工作台打开', (await dialog.count()) === 1)
check('未触发代码生成', textCalls === 0, String(textCalls))
check('显示 Blender 不可用', (await dialog.innerText()).includes('Blender'), (await dialog.innerText()).slice(0, 120))
check('编辑器没有渲染后抽帧', !(await dialog.innerText()).includes('渲染后抽帧'))

// 改一行代码制造 dirty，再切顶栏，验证离开保护
await dialog.getByRole('button', { name: '代码', exact: true }).click()
await p.waitForTimeout(200)
await dialog.locator('textarea[aria-label="场景代码"]').fill('# dirty for leave guard\n')
await p.waitForTimeout(400)
let asked = 0
p.once('dialog', async (d) => {
  asked++
  await d.dismiss()
})
await p.evaluate(() => {
  ;[...document.querySelectorAll('header button')]
    .find((b) => b.textContent?.trim() === '镜头表')
    ?.click()
})
await p.waitForTimeout(700)
check('离开提示词页会确认 3D 修改', asked === 1, String(asked))
check(
  '取消后仍在提示词页且编辑器还开着',
  (await p.locator('.pt-table').count()) === 1 &&
    (await p.locator('[aria-label="3D 代码工作台"]').count()) === 1,
)

await dialog.getByRole('button', { name: '关闭' }).click()
await p.waitForTimeout(300)
const closeAsk = p.locator('.cw-close-ask')
if ((await closeAsk.count()) > 0) {
  await closeAsk.getByRole('button', { name: '放弃修改' }).click()
}
await p.waitForTimeout(500)
check('关闭后提示词草稿还在', (await videoArea.inputValue()) === DRAFT, await videoArea.inputValue())

await p.locator('.wb-foot button', { hasText: '保存到 project.json' }).click()
await p.waitForTimeout(800)
const saved = (await api(`/api/project?name=${encodeURIComponent(NAME)}`)).project.shots.find(
  (s) => s.id === 'E01-S01',
)
check('提示词保存成功', saved?.video_prompt === DRAFT, saved?.video_prompt)
check('3D 未保存时不写 scene_code', !saved?.scene_code, JSON.stringify(saved?.scene_code))
const saved2 = (await api(`/api/project?name=${encodeURIComponent(NAME)}`)).project.shots.find(
  (s) => s.id === 'E01-S02',
)
check(
  '旧 3D 开关字段保留',
  saved2?.use_schedule_video_ref === true && saved2?.use_schedule_frames === true,
  JSON.stringify({ v: saved2?.use_schedule_video_ref, f: saved2?.use_schedule_frames }),
)

// 推画布：右击菜单和 Inspector 都不应再有 3D 入口
await p.locator('.wb-foot button', { hasText: '推到画布' }).click()
await p.waitForTimeout(700)
await p.getByRole('button', { name: '画布', exact: true }).click()
await p.waitForTimeout(900)
const nodeId = await p.evaluate(
  ({ name }) => {
    const s = JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(name)}`) || '{}')
    return (s.nodes || []).find((x) => x.data?.shotId === 'E01-S01')?.id
  },
  { name: NAME },
)
check('找到画布节点', Boolean(nodeId), String(nodeId))
await p.locator(`[data-id="${nodeId}"]`).dispatchEvent('contextmenu', { clientX: 700, clientY: 420, button: 2 })
await p.waitForTimeout(300)
const actions = await p.locator('.ctx-action').evaluateAll((els) => els.map((e) => e.textContent || ''))
check('右击没有 3D 动作', !actions.some((t) => /3D 调度|调度视频|调度关键帧/.test(t)), actions.join(' | '))
await p.keyboard.press('Escape')
await p.waitForTimeout(200)
await p.locator(`[data-id="${nodeId}"]`).click()
await p.waitForTimeout(500)
check('Inspector 没有 3D 区块', (await p.locator('.sched-head, .sched-row').count()) === 0)
check('Inspector 没有打开 3D 入口', !(await p.locator('.inspector').innerText()).includes('打开 3D 调度'))
check('页面无运行时异常', errors.length === 0, errors.slice(0, 2).join(' | '))

await b.close()
console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
