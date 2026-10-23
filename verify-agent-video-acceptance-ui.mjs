/**
 * 视频验收 UI 验收：真实浏览器渲染 4 秒 MP4，真实保存/抽帧，mock 文本与视觉响应。
 * 验证：finish → MP4 → MP4 抽帧 → 视频验收 → 保存；项目代码哈希/视频元数据一致。
 * 跑法：APP_URL=http://127.0.0.1:5280 node verify-agent-video-acceptance-ui.mjs
 */
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const URL = process.env.APP_URL || 'http://127.0.0.1:5280'
const REJECT = process.env.VIDEO_TEST_REJECT === '1'
const NO_VISION = process.env.VIDEO_TEST_NO_VISION === '1'
const STALE = process.env.VIDEO_TEST_STALE === '1'
const REAL = process.env.REAL === '1'
const SECONDS = Number(process.env.SHOT_SECONDS) || 4
const EXPECTED_FRAMES = SECONDS > 6 ? 9 : 5
const SUFFIX = process.env.EVIDENCE_SUFFIX || (SECONDS > 6 ? `-long-${SECONDS}s` : '')
const NAME = `agent-video-ui-${Date.now()}`
const REQUIREMENTS = ['主体可见', '镜头运动连续']
const FIXTURE = fs.readFileSync(path.join(process.cwd(), 'fixtures/agent-duel-scene.js'), 'utf8').trim()
const EVIDENCE = process.env.EVIDENCE_DIR || fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'agent-video-evidence-'))
const CHANGE_EVIDENCE = path.join(process.cwd(), 'openspec/changes/agent-video-acceptance/evidence')
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}
const api = async (p, init) => (await fetch(`${URL}${p}`, init)).json()
fs.mkdirSync(EVIDENCE, { recursive: true })

await api(`/api/project?name=${encodeURIComponent(NAME)}&create=1`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: NAME, aspect: '16:9' }),
})
await api(`/api/project?name=${encodeURIComponent(NAME)}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    episodes: [{ no: 1, title: '验收', scenes: [{ no: 1, slug: '山顶', place: '山顶', time: '日', characters: ['阿青', '阿白'] }] }],
    characters: [],
    shots: [{
      id: 'E01-S01', episode: 1, no: 'S01', scene_no: 1, scene_slug: '山顶', seconds: SECONDS, size: '全景', move: '环绕',
      cast: ['阿青', '阿白'], dialogue: '阿青：看剑\n阿白：来',
      keyframe_prompt: '山体背景，一名男人和一名女人持剑对打，镜头环绕并正对两人',
      scene_code: { version: 1, abiVersion: 1, code: FIXTURE, codeHash: sha(FIXTURE), source: 'manual', updatedAt: new Date().toISOString() },
      shot_3d_context: {
        version: 1, characterIds: [], designIds: [], assetUrls: [], imageUrls: [], videoUrls: [], sceneKeys: ['E01-SC01'],
        text: { prompt: true, videoPrompt: false, dialogue: 'all', cast: true, marks: false, sizeMove: true },
        updatedAt: new Date().toISOString(),
      },
    }],
  }),
})

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
page.setDefaultTimeout(30000)
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error' && !/favicon|404|Failed to load resource|Expected static flag/i.test(m.text())) errors.push('console: ' + m.text())
})

let calls = [
  { name: 'run_sandbox', args: {} },
  { name: 'capture_frames', args: { times: [0, 1, 2, 3, 4] } },
  { name: 'review_frames', args: { requirements: REQUIREMENTS } },
  { name: 'finish', args: { summary: '代码阶段完成' } },
]
let index = 0
let visionCalls = 0
await page.route('**/api/text', (route) => {
  if (REAL) return route.continue()
  const call = calls[index++]
  return route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      json: { content: call ? '' : '已完成', tool_calls: call ? [call] : [] },
      text: '',
      model: 'video-ui-code',
      modelKey: 'video-ui-code',
      modelLabel: 'Video UI Code',
    }),
  })
})
await page.route('**/api/vision', (route) => {
  if (REAL) return route.continue()
  visionCalls++
  if (NO_VISION) {
    return route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, message: '未配置视觉模型' }),
    })
  }
  const fail = REJECT && visionCalls >= 2
  return route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      json: {
        summary: fail ? '视频帧未通过' : '视频帧通过',
        items: REQUIREMENTS.map((label, i) => ({
          label,
          ok: fail ? i !== 0 : true,
          reason: fail && i === 0 ? '未看到主体' : '可见',
        })),
      },
      text: '',
      model: 'video-ui-vision',
      modelKey: 'video-ui-vision',
      modelLabel: 'Video UI Vision',
    }),
  })
})

let panel = ''
let shot = null
let videoUrl = ''
try {
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.locator('.topbar-project select').selectOption(NAME)
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: '镜头表', exact: true }).click()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: '生成到画布' }).click()
  await page.waitForTimeout(1000)
  await page.getByRole('button', { name: '画布', exact: true }).click()
  await page.waitForTimeout(600)
  const id = await page.evaluate((name) => {
    const s = JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(name)}`) || '{}')
    return (s.nodes || []).find((x) => x.data?.shotId === 'E01-S01')?.id
  }, NAME)
  check('镜头进入画布', Boolean(id), String(id))
  await page.evaluate((nid) => {
    const el = document.querySelector(`[data-id="${nid}"]`)
    const o = { bubbles: true, button: 0, view: window }
    for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, o))
  }, id)
  await page.waitForTimeout(300)
  await page.locator(`[data-id="${id}"]`).dispatchEvent('contextmenu', { clientX: 700, clientY: 420, button: 2 })
  await page.waitForTimeout(250)
  await page.locator('.ctx-action', { hasText: '编辑 3D 调度' }).click()
  await page.locator('.cw-shell').waitFor({ timeout: 15000 })
  const input = page.locator('[data-chat-input]')
  await input.waitFor({ timeout: 10000 })
  await input.fill('运行当前场景，不要重新生成代码')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelector('[data-chat-root]')?.getAttribute('data-running') === 'false',
    null,
    { timeout: 240000 },
  )
  panel = await page.locator('[data-chat-root]').innerText()
  check('finish 显示代码阶段完成', panel.includes('代码阶段完成'), panel.slice(-1000))
  check('视频阶段已启动', panel.includes('开始 MP4 视频验收'), panel.slice(-1000))
  check('聊天出现 MP4 卡片', (await page.locator('[data-chat-video]').count()) === 1)
  const videoStatus = await page.locator('[data-chat-video]').getAttribute('data-status')
  check('聊天出现 MP4 播放器', (await page.locator('[data-chat-video-player]').count()) === 1)
  const frameCount = await page.locator('[data-chat-video-frames] img').count()
  check('MP4 帧数符合镜头时长', frameCount === EXPECTED_FRAMES, `${frameCount}/${EXPECTED_FRAMES}`)
  if (!NO_VISION) {
    check('聊天出现 MP4 帧验收卡', (await page.locator('[data-chat-video-review]').count()) === 1)
  }
  check('没有提前宣称场景完成', !panel.includes('场景完成'), panel.slice(-800))
  check('页面无未捕获异常', errors.length === 0, errors[0] || '')

  videoUrl = await page.locator('[data-chat-video-player]').getAttribute('src') || ''
  const project = await api(`/api/project?name=${encodeURIComponent(NAME)}`)
  shot = project?.project?.shots?.find((s) => s.id === 'E01-S01') || null
  check('代码已写入镜头', Boolean(shot?.scene_code?.code), String(shot?.scene_code?.codeHash || '').slice(0, 12))
  check('代码哈希与 fixture 一致', shot?.scene_code?.codeHash === sha(FIXTURE), String(shot?.scene_code?.codeHash || '').slice(0, 12))

  if (NO_VISION) {
    check('无视觉模型转人工', videoStatus === 'needs_human', String(videoStatus))
    const noVisionReview = page.locator('[data-chat-video-review]')
    check(
      '无视觉验收卡标记需人工',
      (await noVisionReview.count()) === 1 && (await noVisionReview.getAttribute('data-status')) === 'needs_human',
      String(await noVisionReview.getAttribute('data-status')),
    )
    check('提供人工采用入口', (await page.getByRole('button', { name: '人工采用并保存', exact: true }).count()) >= 1)
    check('无视觉最终文字要求人工', /人工检查|人工验收/.test(panel), panel.slice(-900))
    check('人工采用前未写入项目视频', !shot?.schedule_video, String(shot?.schedule_video || 'none'))
    await page.getByRole('button', { name: '人工采用并保存', exact: true }).click()
    await page.waitForTimeout(1500)
    const adopted = await api(`/api/project?name=${encodeURIComponent(NAME)}`)
    const adoptedShot = adopted?.project?.shots?.find((s) => s.id === 'E01-S01') || null
    const adoptedPanel = await page.locator('[data-chat-root]').innerText()
    check('人工采用后写入项目视频', adoptedShot?.schedule_video === videoUrl, `${adoptedShot?.schedule_video || ''} vs ${videoUrl}`)
    check('人工采用后代码哈希一致', adoptedShot?.scene_code?.codeHash === sha(FIXTURE), String(adoptedShot?.scene_code?.codeHash || '').slice(0, 12))
    check('人工采用后标记已保存', /已人工采用并保存|已保存/.test(adoptedPanel), adoptedPanel.slice(-900))
    await page.screenshot({ path: path.join(EVIDENCE, 'ui-no-vision.png'), fullPage: false })
    fs.writeFileSync(
      path.join(EVIDENCE, 'ui-no-vision.json'),
      JSON.stringify({
        project: NAME,
        panelTail: adoptedPanel.slice(-2000),
        videoStatus,
        videoUrl,
        scheduleVideo: adoptedShot?.schedule_video || null,
        sceneCodeHash: adoptedShot?.scene_code?.codeHash,
      }, null, 2),
    )
    check('人工采用证据已保存', fs.existsSync(path.join(EVIDENCE, 'ui-no-vision.png')) && fs.existsSync(path.join(EVIDENCE, 'ui-no-vision.json')))
  } else if (REJECT) {
    check('视频验收未通过', videoStatus === 'rejected', String(videoStatus))
    check('MP4 帧验收卡未通过', (await page.locator('[data-chat-video-review]').getAttribute('data-status')) === 'rejected')
    check('最终文字说明未保存', /未保存|旧视频/.test(panel), panel.slice(-900))
    check('失败卡提供继续修复', (await page.getByRole('button', { name: '继续修复', exact: true }).count()) >= 1)
    await page.getByRole('button', { name: '继续修复', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('[data-chat-message="user"]').length >= 2, null, {
      timeout: 5000,
    })
    const repairText = await page.locator('[data-chat-message="user"]').last().innerText()
    check('继续修复发起新一轮', /视频验收未通过/.test(repairText), repairText.slice(0, 160))
    await page.getByRole('button', { name: '取消', exact: true }).click().catch(() => {})
    await page.waitForTimeout(400)
    check('失败不写入项目视频', !shot?.schedule_video, String(shot?.schedule_video || 'none'))
    check('失败不改写代码哈希', shot?.scene_code?.codeHash === sha(FIXTURE), String(shot?.scene_code?.codeHash || '').slice(0, 12))
    await page.screenshot({ path: path.join(EVIDENCE, 'ui-rejected.png'), fullPage: false })
    fs.writeFileSync(
      path.join(EVIDENCE, 'ui-rejected.json'),
      JSON.stringify({
        project: NAME,
        panelTail: panel.slice(-2000),
        videoStatus,
        videoUrl,
        sceneCodeHash: shot?.scene_code?.codeHash,
        scheduleVideo: shot?.schedule_video || null,
      }, null, 2),
    )
    check('拒绝证据已保存', fs.existsSync(path.join(EVIDENCE, 'ui-rejected.png')) && fs.existsSync(path.join(EVIDENCE, 'ui-rejected.json')))
  } else {
    check('视频验收通过', videoStatus === 'passed', String(videoStatus))
    check('MP4 帧验收通过', (await page.locator('[data-chat-video-review]').getAttribute('data-status')) === 'passed')
    check('最终文字说明已保存', /MP4 帧验收.*通过/.test(panel) && panel.includes('已保存'), panel.slice(-800))
    check('最终文字包含 MP4 地址', /\/videos\/schedule-/.test(panel))
    check('视频元数据代码哈希一致', shot?.scene_code_meta?.codeHash === shot?.scene_code?.codeHash, `${shot?.scene_code_meta?.codeHash || ''}`)
    check('视频地址与元数据一致', Boolean(shot?.schedule_video) && shot.schedule_video === videoUrl, `${shot?.schedule_video || ''} vs ${videoUrl}`)
    check('视频元数据时长正确', Number(shot?.scene_code_meta?.duration) === SECONDS, String(shot?.scene_code_meta?.duration))
    check('调度元数据时长正确', Number(shot?.schedule_meta?.duration) === SECONDS, String(shot?.schedule_meta?.duration))

    const file = path.join(process.cwd(), 'public', videoUrl.replace(/^\//, ''))
    check('MP4 文件存在', fs.existsSync(file), file)
    if (fs.existsSync(file)) {
      const probe = JSON.parse(execFileSync('ffprobe', [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'format=duration:stream=nb_frames,width,height',
        '-of', 'json',
        file,
      ]).toString())
      const duration = Number(probe?.format?.duration)
      const frames = Number(probe?.streams?.[0]?.nb_frames)
      check('MP4 时长约等于镜头时长', duration >= SECONDS - 0.2 && duration <= SECONDS + 0.3, String(duration))
      check('MP4 帧数足够', frames >= Math.round(SECONDS * 20), String(frames))
      await page.screenshot({ path: path.join(EVIDENCE, `ui-pass${SUFFIX}.png`), fullPage: false })
      fs.writeFileSync(
        path.join(EVIDENCE, `ui-pass${SUFFIX}.json`),
        JSON.stringify({
          project: NAME,
          panelTail: panel.slice(-2000),
          videoUrl,
          shot: {
            codeHash: shot?.scene_code?.codeHash,
            metaCodeHash: shot?.scene_code_meta?.codeHash,
            metaDuration: shot?.scene_code_meta?.duration,
            scheduleVideo: shot?.schedule_video,
          },
          probe,
          checks: { frameCount, bad },
        }, null, 2),
      )
      check('证据已保存', fs.existsSync(path.join(EVIDENCE, `ui-pass${SUFFIX}.png`)) && fs.existsSync(path.join(EVIDENCE, `ui-pass${SUFFIX}.json`)))

      if (STALE) {
        const newCode = `${FIXTURE}\n// stale-test-v2`
        const newHash = sha(newCode)
        calls = [
          { name: 'set_scene_code', args: { code: newCode } },
          { name: 'run_sandbox', args: {} },
          { name: 'capture_frames', args: { times: [0, 1, 2, 3, 4] } },
          { name: 'review_frames', args: { requirements: REQUIREMENTS } },
          { name: 'finish', args: { summary: '新代码阶段完成' } },
        ]
        index = 0
        visionCalls = 0
        await page.locator('[data-chat-input]').fill('修改代码并重新验收')
        await page.getByRole('button', { name: '发送', exact: true }).click()
        try {
          await page.waitForFunction(
            () => document.querySelector('[data-chat-root]')?.getAttribute('data-running') === 'false',
            null,
            { timeout: 90000 },
          )
        } catch (e) {
          const stuck = await page.locator('[data-chat-root]').innerText().catch(() => '')
          console.log('STALE_TIMEOUT_PANEL', stuck.slice(-2500))
          console.log('STALE_TIMEOUT_DEBUG', JSON.stringify({ index, visionCalls, callCount: calls.length }))
          throw e
        }
        const videos = page.locator('[data-chat-video]')
        const reviews = page.locator('[data-chat-video-review]')
        check('第二次生成新视频卡', (await videos.count()) === 2, String(await videos.count()))
        check('旧视频卡标记过期', (await videos.first().getAttribute('data-stale')) === 'true')
        check('新视频卡未过期', (await videos.last().getAttribute('data-stale')) === 'false')
        check('新视频卡通过', (await videos.last().getAttribute('data-status')) === 'passed')
        check('旧验收卡标记过期', (await reviews.first().getAttribute('data-stale')) === 'true')
        check('新验收卡未过期', (await reviews.last().getAttribute('data-stale')) === 'false')
        const lastVideoUrl = await page.locator('[data-chat-video-player]').last().getAttribute('src')
        const after = await api(`/api/project?name=${encodeURIComponent(NAME)}`)
        const afterShot = after?.project?.shots?.find((s) => s.id === 'E01-S01') || null
        check('新代码哈希写入镜头', afterShot?.scene_code?.codeHash === newHash, String(afterShot?.scene_code?.codeHash || '').slice(0, 12))
        check('新视频写入镜头', afterShot?.schedule_video === lastVideoUrl, `${afterShot?.schedule_video || ''} vs ${lastVideoUrl}`)
        check('重渲后最近视频生效', (await page.locator('[data-video-status]').getAttribute('data-video-status')) === '生效')
        await page.getByRole('button', { name: '代码', exact: true }).click()
        await page.waitForTimeout(200)
        const codeArea = page.locator('textarea[aria-label="Three.js 代码"]')
        await codeArea.fill(`${await codeArea.inputValue()}\n// dirty-video-test`)
        await page.waitForTimeout(400)
        check('未保存代码后最近视频过期', (await page.locator('[data-video-status]').getAttribute('data-video-status')) === '已过期')
        await page.getByRole('button', { name: '聊天', exact: true }).click()
        await page.screenshot({ path: path.join(EVIDENCE, 'ui-stale.png'), fullPage: false })
        fs.writeFileSync(
          path.join(EVIDENCE, 'ui-stale.json'),
          JSON.stringify({
            project: NAME,
            newHash,
            lastVideoUrl,
            oldVideoUrl: videoUrl,
            savedVideoUrl: afterShot?.schedule_video,
            staleFlags: {
              oldVideo: await videos.first().getAttribute('data-stale'),
              newVideo: await videos.last().getAttribute('data-stale'),
              oldReview: await reviews.first().getAttribute('data-stale'),
              newReview: await reviews.last().getAttribute('data-stale'),
            },
          }, null, 2),
        )
        check('过期证据已保存', fs.existsSync(path.join(EVIDENCE, 'ui-stale.png')) && fs.existsSync(path.join(EVIDENCE, 'ui-stale.json')))
      }
    }
  }
} finally {
  await browser.close()
  try {
    fs.mkdirSync(CHANGE_EVIDENCE, { recursive: true })
    for (const file of fs.readdirSync(EVIDENCE)) {
      fs.copyFileSync(path.join(EVIDENCE, file), path.join(CHANGE_EVIDENCE, file))
    }
  } catch {
    /* 证据目录不可写时保留 /tmp 结果 */
  }
}

console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
