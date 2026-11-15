import assert from 'node:assert/strict'
import {
  EXPRESSION_SHEET_EMOTIONS,
  ORBIT_ANGLES,
  ORBIT_SHEET_COLUMNS,
  ORBIT_SHEET_ROWS,
  identityFingerprint,
  isOrbitSheetUsable,
  markOrbitSheetStale,
  orbitIdentityFingerprint,
  type CharacterExpressionSheet,
  type CharacterOrbitSheet,
  type CharacterSheet,
} from '../src/characters.ts'
import { toProject, toSheet } from '../src/charMap.ts'
import { PREVIEW_SCHEMA_VERSION, buildPreviewSnapshot } from '../src/characterPreview/snapshot.ts'
import { escapeHtml, jsonForScript, safeFileName } from '../src/characterPreview/escape.ts'
import { buildPreviewHtml } from '../src/characterPreview/viewer.ts'
import { isFetchableUrl } from '../src/characterPreview/inlineAssets.ts'
import { buildPreviewExport, exportFileName, humanSize } from '../src/characterPreview/export.ts'
import {
  buildOrbitSheetCells,
  orbitCropRect,
  orbitSheetPrompt,
  validateOrbitCells,
} from '../src/characterPreview/orbitSheet.ts'

function check(name: string, fn: () => void) {
  try {
    fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    console.error(`❌ ${name}`, e)
    process.exitCode = 1
  }
}

const base: Pick<CharacterSheet, 'lookEn' | 'palette' | 'keywords' | 'image'> = {
  lookEn: 'chinese man in his early 30s, square jaw, buzz cut',
  palette: 'iron grey + brass',
  keywords: ['mechanical left hand', 'buzz cut'],
  image: '/project-assets/char-turnaround.png',
}

/** 八格：4 列 × 2 行，按 ORBIT_ANGLES 顺序填 */
function cells() {
  return ORBIT_ANGLES.map((angle, i) => ({
    angle,
    x: (i % ORBIT_SHEET_COLUMNS) / ORBIT_SHEET_COLUMNS,
    y: Math.floor(i / ORBIT_SHEET_COLUMNS) / ORBIT_SHEET_ROWS,
    w: 1 / ORBIT_SHEET_COLUMNS,
    h: 1 / ORBIT_SHEET_ROWS,
  }))
}

function sheet(over: Partial<CharacterOrbitSheet> = {}): CharacterOrbitSheet {
  return {
    image: '/project-assets/char-orbit.png',
    columns: ORBIT_SHEET_COLUMNS,
    rows: ORBIT_SHEET_ROWS,
    cells: cells(),
    source: 'generated',
    fingerprint: orbitIdentityFingerprint(base),
    ...over,
  }
}

/** 完整角色卡：用来验证只有参考图/试音变化时指纹不变 */
function character(over: Partial<CharacterSheet> = {}): CharacterSheet {
  return {
    id: 'chenmo',
    name: '陈默',
    role: '主角',
    lookCn: '三十出头',
    lookEn: base.lookEn,
    palette: base.palette,
    keywords: base.keywords,
    image: base.image,
    ...over,
  }
}

check('指纹同输入恒等', () => {
  assert.equal(orbitIdentityFingerprint(base), orbitIdentityFingerprint({ ...base }))
  assert.match(orbitIdentityFingerprint(base), /^[0-9a-f]{16}$/)
})

check('外观锚点变化改变指纹', () => {
  assert.notEqual(orbitIdentityFingerprint(base), orbitIdentityFingerprint({ ...base, lookEn: '短发' }))
})

check('配色变化改变指纹', () => {
  assert.notEqual(orbitIdentityFingerprint(base), orbitIdentityFingerprint({ ...base, palette: '冷白 + 石墨灰' }))
})

check('关键词变化改变指纹', () => {
  assert.notEqual(
    orbitIdentityFingerprint(base),
    orbitIdentityFingerprint({ ...base, keywords: ['机械义眼'] }),
  )
})

check('换三视图改变指纹', () => {
  assert.notEqual(
    orbitIdentityFingerprint(base),
    orbitIdentityFingerprint({ ...base, image: '/project-assets/other.png' }),
  )
})

check('参考图变化不改变指纹', () => {
  const a = character({ referenceImages: ['/project-assets/r1.png'] })
  const b = character({ referenceImages: ['/project-assets/r1.png', '/project-assets/r2.png'] })
  assert.equal(orbitIdentityFingerprint(a), orbitIdentityFingerprint(b))
})

check('试音变化不改变指纹', () => {
  const a = character()
  const b = character({ voiceId: 'male-qn-qingse' })
  assert.equal(orbitIdentityFingerprint(a), orbitIdentityFingerprint(b))
})

check('锚点变化后判失效', () => {
  const stale = sheet()
  const nextIdentity = orbitIdentityFingerprint({ ...base, lookEn: '换了张脸' })
  assert.equal(isOrbitSheetUsable(stale, orbitIdentityFingerprint(base)), true)
  assert.equal(isOrbitSheetUsable(stale, nextIdentity), false)
})

check('参考图变化后仍可用', () => {
  const s = sheet()
  const identity = orbitIdentityFingerprint(
    character({ referenceImages: ['/project-assets/new.png'] }),
  )
  assert.equal(isOrbitSheetUsable(s, identity), true)
})

check('缺图不可用', () => {
  assert.equal(isOrbitSheetUsable(sheet({ image: '' })), false)
  assert.equal(isOrbitSheetUsable(undefined), false)
})

check('标 stale 不可用', () => {
  assert.equal(isOrbitSheetUsable(sheet({ stale: true })), false)
})

check('栅格不匹配不可用', () => {
  assert.equal(isOrbitSheetUsable(sheet({ columns: 3 as never })), false)
})

check('格数不足不可用', () => {
  assert.equal(isOrbitSheetUsable(sheet({ cells: cells().slice(0, 7) })), false)
})

check('角度重复不可用', () => {
  const dup = cells()
  dup[1] = { ...dup[1], angle: dup[0].angle }
  assert.equal(isOrbitSheetUsable(sheet({ cells: dup })), false)
})

check('角度非法不可用', () => {
  const bad = cells()
  bad[3] = { ...bad[3], angle: 30 }
  assert.equal(isOrbitSheetUsable(sheet({ cells: bad })), false)
})

check('几何非法不可用', () => {
  const zero = cells()
  zero[2] = { ...zero[2], w: 0 }
  assert.equal(isOrbitSheetUsable(sheet({ cells: zero })), false)
  const negative = cells()
  negative[0] = { ...negative[0], x: -0.1 }
  assert.equal(isOrbitSheetUsable(sheet({ cells: negative })), false)
})

check('标失效不改原对象', () => {
  const s = sheet()
  const next = markOrbitSheetStale(s)!
  assert.equal(next.stale, true)
  assert.equal(s.stale, undefined)
  assert.equal(markOrbitSheetStale(undefined), undefined)
})

check('orbit_sheet 读→写→读回一致', () => {
  const withCrops = sheet({
    cells: cells().map((cell, i) => ({
      ...cell,
      ...(i === 0
        ? { cropUrl: '/project-assets/orbit-0.png', cropFingerprint: 'abc123' }
        : {}),
    })),
    createdAt: '2026-11-15T04:00:00.000Z',
    modelKey: 'seedream-5-0-pro',
  })
  const saved = toProject(character({ orbitSheet: withCrops }))
  assert.equal(saved.orbit_sheet?.image, withCrops.image)
  assert.equal(saved.orbit_sheet?.cells.length, ORBIT_ANGLES.length)
  assert.equal(saved.orbit_sheet?.cells[0].cropUrl, '/project-assets/orbit-0.png')
  assert.equal(saved.orbit_sheet?.createdAt, withCrops.createdAt)
  const back = toSheet({ name: '陈默', orbit_sheet: saved.orbit_sheet })
  assert.deepEqual(back.orbitSheet, withCrops)
})

check('旧数据缺 orbit_sheet 为 undefined', () => {
  assert.equal(toSheet({ name: '陈默' }).orbitSheet, undefined)
})

check('dataURL 转盘不写进项目文件', () => {
  const saved = toProject(character({ orbitSheet: sheet({ image: 'data:image/png;base64,AAAA' }) }))
  assert.equal(saved.orbit_sheet, undefined)
})

check('不同项目互不串', () => {
  const a = toSheet({ name: 'A', orbit_sheet: sheet({ image: '/project-assets/a.png' }) })
  const b = toSheet({ name: 'B' })
  assert.equal(a.orbitSheet?.image, '/project-assets/a.png')
  assert.equal(b.orbitSheet, undefined)
})

/** 表情总图：八格齐全、每格已裁好、指纹对应当前外观 */
function exprSheet(over: Partial<CharacterExpressionSheet> = {}): CharacterExpressionSheet {
  return {
    image: '/project-assets/expr.png',
    columns: 4,
    rows: 2,
    cells: EXPRESSION_SHEET_EMOTIONS.map((emotion, i) => ({
      emotion,
      x: (i % 4) / 4,
      y: Math.floor(i / 4) / 2,
      w: 1 / 4,
      h: 1 / 2,
      cropUrl: `/project-assets/expr-${emotion}.png`,
      cropFingerprint: `crop-${emotion}`,
    })),
    source: 'generated',
    fingerprint: identityFingerprint(base),
    ...over,
  }
}

/** 八帧都已裁好的转盘总图 */
function orbitReady(over: Partial<CharacterOrbitSheet> = {}): CharacterOrbitSheet {
  return sheet({
    cells: cells().map((cell) => ({
      ...cell,
      cropUrl: `/project-assets/orbit-${cell.angle}.png`,
      cropFingerprint: `crop-${cell.angle}`,
    })),
    ...over,
  })
}

check('快照字段齐全', () => {
  const snap = buildPreviewSnapshot(character(), { now: new Date('2026-11-15T04:00:00.000Z') })
  assert.equal(snap.schemaVersion, PREVIEW_SCHEMA_VERSION)
  assert.equal(snap.generatedAt, '2026-11-15T04:00:00.000Z')
  assert.equal(snap.identityFingerprint, identityFingerprint(base))
  assert.equal(snap.character.name, '陈默')
  assert.equal(snap.character.role, '主角')
  assert.equal(snap.character.desc, '三十出头')
  assert.equal(snap.look.palette, base.palette)
  assert.deepEqual(snap.look.keywords, base.keywords)
  assert.equal(snap.look.turnaroundUrl, base.image)
})

check('缺图缺音降级为文字卡', () => {
  const snap = buildPreviewSnapshot(character({ image: undefined }))
  assert.equal(snap.look.turnaroundUrl, undefined)
  assert.deepEqual(snap.emotions, [])
  assert.equal(snap.voice, undefined)
  assert.equal(snap.orbit, undefined)
  assert.equal(snap.orbitStale, false)
})

check('表情总图进入快照', () => {
  const snap = buildPreviewSnapshot(character({ expressionSheet: exprSheet() }))
  assert.equal(snap.emotions.length, EXPRESSION_SHEET_EMOTIONS.length)
  assert.equal(snap.emotions[0].emotion, 'neutral')
  assert.equal(snap.emotions[0].url, '/project-assets/expr-neutral.png')
})

check('表情总图失效则不进快照', () => {
  const snap = buildPreviewSnapshot(character({ expressionSheet: exprSheet({ stale: true }) }))
  assert.deepEqual(snap.emotions, [])
})

check('可用试音进入快照', () => {
  const snap = buildPreviewSnapshot(
    character({
      voiceSample: {
        url: '/project-assets/voice.mp3',
        text: '试音',
        seconds: 4,
        engine: 'volc-tts',
        voiceId: 'male-qn-qingse',
        fingerprint: 'f',
      },
    }),
  )
  assert.equal(snap.voice?.url, '/project-assets/voice.mp3')
  assert.equal(snap.voice?.seconds, 4)
})

check('失效试音不进快照', () => {
  const snap = buildPreviewSnapshot(
    character({
      voiceSample: {
        url: '/project-assets/voice.mp3',
        text: '试音',
        seconds: 4,
        engine: 'volc-tts',
        voiceId: 'male-qn-qingse',
        fingerprint: 'f',
        stale: true,
      },
    }),
  )
  assert.equal(snap.voice, undefined)
})

check('八帧齐全才进转盘', () => {
  const snap = buildPreviewSnapshot(character({ orbitSheet: orbitReady() }))
  assert.equal(snap.orbit?.frames.length, ORBIT_ANGLES.length)
  assert.equal(snap.orbit?.frames[0].angle, 0)
  assert.equal(snap.orbitStale, false)
})

check('缺一帧裁图则降级', () => {
  const ready = orbitReady()
  const broken = {
    ...ready,
    cells: ready.cells.map((cell, i) => (i === 3 ? { ...cell, cropUrl: undefined } : cell)),
  }
  const snap = buildPreviewSnapshot(character({ orbitSheet: broken }))
  assert.equal(snap.orbit, undefined)
})

check('锚点变化标转盘过期', () => {
  const snap = buildPreviewSnapshot(character({ orbitSheet: orbitReady(), lookEn: '换了张脸' }))
  assert.equal(snap.orbit, undefined)
  assert.equal(snap.orbitStale, true)
})

check('参考图变化不影响转盘可用', () => {
  const snap = buildPreviewSnapshot(
    character({ orbitSheet: orbitReady(), referenceImages: ['/project-assets/new.png'] }),
  )
  assert.equal(snap.orbit?.frames.length, ORBIT_ANGLES.length)
  assert.equal(snap.orbitStale, false)
})

check('快照只含当前角色', () => {
  const a = buildPreviewSnapshot(character({ id: 'a', name: 'A', orbitSheet: orbitReady() }))
  const text = JSON.stringify(a)
  assert.ok(!text.includes('陈曦'))
  assert.ok(!text.includes('鸦'))
})

async function checkAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    console.error(`❌ ${name}`, e)
    process.exitCode = 1
  }
}

await checkAsync('escapeHtml 处理五类字符', async () => {
  assert.equal(escapeHtml(`<b>"x"&'y'</b>`), '&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/b&gt;')
  assert.equal(escapeHtml(undefined), '')
})

await checkAsync('jsonForScript 拦住 </script>', async () => {
  const out = jsonForScript({ desc: '</script><img onerror=1>' })
  assert.ok(!out.includes('</script'))
  assert.ok(!out.includes('<'))
  assert.equal(JSON.parse(out).desc, '</script><img onerror=1>')
})

await checkAsync('jsonForScript 保留表情与换行语义', async () => {
  const out = jsonForScript({ a: '😀', b: 'x\ny' })
  const back = JSON.parse(out)
  assert.equal(back.a, '😀')
  assert.equal(back.b, 'x\ny')
})

await checkAsync('safeFileName 去掉路径字符', async () => {
  assert.equal(safeFileName('陈默/主角:01'), '陈默-主角-01')
  assert.equal(safeFileName('   '), 'character')
  assert.equal(safeFileName('😀'), '😀')
})

await checkAsync('静态卡含角色名与造型图', async () => {
  const snap = buildPreviewSnapshot(character())
  const html = await buildPreviewHtml(snap)
  assert.ok(html.includes('data-preview-root'))
  assert.ok(html.includes('陈默'))
  assert.ok(html.includes(base.image))
  assert.ok(html.includes('三十出头'))
})

await checkAsync('静态卡转义用户文本', async () => {
  const snap = buildPreviewSnapshot(
    character({ name: '<script>alert(1)</script>', lookCn: 'a & b "c"' }),
  )
  const html = await buildPreviewHtml(snap)
  assert.ok(!html.includes('<script>alert(1)</script>'))
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
  assert.ok(html.includes('a &amp; b &quot;c&quot;'))
})

await checkAsync('静态卡渲染表情缩略图', async () => {
  const snap = buildPreviewSnapshot(character({ expressionSheet: exprSheet() }))
  const html = await buildPreviewHtml(snap)
  assert.ok(html.includes('data-preview-emotions'))
  assert.ok(html.includes('/project-assets/expr-neutral.png'))
})

await checkAsync('没有试音不渲染音色区', async () => {
  const snap = buildPreviewSnapshot(character())
  const html = await buildPreviewHtml(snap)
  assert.ok(!html.includes('data-preview-voice'))
})

await checkAsync('有可用试音渲染音色信息', async () => {
  const snap = buildPreviewSnapshot(
    character({
      voiceSample: {
        url: '/project-assets/voice.mp3',
        text: '试音',
        seconds: 4.2,
        engine: 'volc-tts',
        voiceId: 'male-qn-qingse',
        fingerprint: 'f',
      },
    }),
  )
  const html = await buildPreviewHtml(snap)
  assert.ok(html.includes('data-preview-voice'))
  assert.ok(html.includes('4.2s'))
})

await checkAsync('转盘过期显示重生成标记', async () => {
  const snap = buildPreviewSnapshot(character({ orbitSheet: orbitReady(), lookEn: '换了张脸' }))
  const html = await buildPreviewHtml(snap)
  assert.ok(html.includes('data-preview-stale="orbit"'))
  assert.ok(html.includes('转盘需重新生成'))
})

await checkAsync('资源解析失败不炸卡', async () => {
  const snap = buildPreviewSnapshot(character())
  const html = await buildPreviewHtml(snap, () => {
    throw new Error('boom')
  })
  assert.ok(html.includes('placeholder'))
  assert.ok(html.includes('data-preview-root'))
})

await checkAsync('resolveAsset 参与在线渲染', async () => {
  const snap = buildPreviewSnapshot(character())
  const html = await buildPreviewHtml(snap, (url) => `resolved:${url}`)
  assert.ok(html.includes(`resolved:${base.image}`))
})

await checkAsync('isFetchableUrl 只放行站内与 http', async () => {
  assert.equal(isFetchableUrl('/project-assets/a.png'), true)
  assert.equal(isFetchableUrl('https://x/a.png'), true)
  assert.equal(isFetchableUrl('data:image/png;base64,AA'), false)
  assert.equal(isFetchableUrl('file:///etc/passwd'), false)
  assert.equal(isFetchableUrl('javascript:alert(1)'), false)
  assert.equal(isFetchableUrl(''), false)
})

await checkAsync('导出文件名安全化', async () => {
  assert.equal(exportFileName('陈默'), '陈默-角色卡.html')
  assert.equal(exportFileName('a/b:c'), 'a-b-c-角色卡.html')
  assert.equal(exportFileName(''), 'character-角色卡.html')
})

await checkAsync('humanSize 可读', async () => {
  assert.equal(humanSize(0), '0 B')
  assert.equal(humanSize(900), '900 B')
  assert.equal(humanSize(2048), '2.0 KB')
  assert.equal(humanSize(6 * 1024 * 1024), '6.0 MB')
})

await checkAsync('超过软上限判 overLimit', async () => {
  const snap = buildPreviewSnapshot(character())
  const result = await buildPreviewExport(snap, { limit: 1 })
  assert.equal(result.overLimit, true)
  assert.ok(result.bytes > 1)
  assert.equal(result.fileName, '陈默-角色卡.html')
})

await checkAsync('默认阈值下小卡不算超限', async () => {
  const snap = buildPreviewSnapshot(character())
  const result = await buildPreviewExport(snap)
  assert.equal(result.overLimit, false)
})

check('转盘格按顺时针角度铺满 4×2', () => {
  const built = buildOrbitSheetCells()
  assert.equal(built.length, ORBIT_ANGLES.length)
  assert.deepEqual(
    built.map((cell) => cell.angle),
    [...ORBIT_ANGLES],
  )
  assert.equal(built[0].x, 0)
  assert.equal(built[0].y, 0)
  assert.equal(built[4].x, 0)
  assert.equal(built[4].y, 0.5)
  assert.ok(built.every((cell) => Math.abs(cell.w - 0.25) < 1e-9 && Math.abs(cell.h - 0.5) < 1e-9))
})

check('转盘提示词带锚点与八角度描述', () => {
  const prompt = orbitSheetPrompt(base.lookEn)
  assert.ok(prompt.startsWith(base.lookEn))
  assert.ok(prompt.includes('4 columns by 2 rows'))
  assert.ok(prompt.includes('front view 0 degrees'))
  assert.ok(prompt.includes('back view 180 degrees'))
})

check('无锚点时提示词用参考图身份句', () => {
  assert.ok(orbitSheetPrompt('  ').startsWith('same person as reference image'))
})

check('裁切坐标按图片尺寸换算', () => {
  const rect = orbitCropRect({ x: 0.25, y: 0, w: 0.25, h: 0.5 }, 800, 400)
  assert.deepEqual(rect, { sx: 200, sy: 0, sw: 200, sh: 200 })
})

check('越界坐标被钳制在图片内', () => {
  const rect = orbitCropRect({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, 800, 400)
  assert.ok(rect.sx + rect.sw <= 800)
  assert.ok(rect.sy + rect.sh <= 400)
  assert.ok(rect.sw >= 1 && rect.sh >= 1)
})

check('合法格位自检通过', () => {
  assert.deepEqual(validateOrbitCells(buildOrbitSheetCells(), 1600, 900), [])
})

check('格数不足被自检挡下', () => {
  const errors = validateOrbitCells(buildOrbitSheetCells().slice(0, 7), 1600, 900)
  assert.ok(errors.some((e) => e.includes('转盘应有')))
})

check('角度重复被自检挡下', () => {
  const cells = buildOrbitSheetCells()
  cells[1] = { ...cells[1], angle: 0 }
  const errors = validateOrbitCells(cells, 1600, 900)
  assert.ok(errors.some((e) => e.includes('角度重复')))
})

check('坐标非法被自检挡下', () => {
  const cells = buildOrbitSheetCells()
  cells[2] = { ...cells[2], w: -1 }
  const errors = validateOrbitCells(cells, 1600, 900)
  assert.ok(errors.some((e) => e.includes('坐标非法')))
})

check('画布尺寸为 0 被自检挡下', () => {
  assert.deepEqual(validateOrbitCells(buildOrbitSheetCells(), 0, 0), ['总图没有有效尺寸'])
})

check('失效试音标记 voiceStale', () => {
  const snap = buildPreviewSnapshot(
    character({
      voiceSample: {
        url: '/project-assets/voice.mp3',
        text: '试音',
        seconds: 4,
        engine: 'volc-tts',
        voiceId: 'male-qn-qingse',
        fingerprint: 'f',
        stale: true,
      },
    }),
  )
  assert.equal(snap.voice, undefined)
  assert.equal(snap.voiceStale, true)
})

check('没有试音时不标 voiceStale', () => {
  assert.equal(buildPreviewSnapshot(character()).voiceStale, false)
})

await checkAsync('转盘渲染成可拖动滑块', async () => {
  const snap = buildPreviewSnapshot(character({ orbitSheet: orbitReady() }))
  const html = await buildPreviewHtml(snap)
  assert.ok(html.includes('data-orbit'))
  assert.ok(html.includes('data-frames="8"'))
  assert.ok(html.includes('role="slider"'))
  assert.ok(html.includes('拖动旋转'))
  assert.equal((html.match(/class="frame/g) || []).length, 8)
  assert.ok(html.includes('pointerdown'))
})

await checkAsync('没有转盘只渲染静态卡', async () => {
  const snap = buildPreviewSnapshot(character())
  const html = await buildPreviewHtml(snap)
  assert.ok(!html.includes('data-orbit'))
  assert.ok(html.includes('class="stage static"'))
})

await checkAsync('没有图只渲染文字卡', async () => {
  const snap = buildPreviewSnapshot(character({ image: undefined }))
  const html = await buildPreviewHtml(snap)
  assert.ok(html.includes('这个角色还没有造型图'))
  assert.ok(!html.includes('data-orbit'))
})

await checkAsync('试音失效给出说明且没有播放器', async () => {
  const snap = buildPreviewSnapshot(
    character({
      voiceSample: {
        url: '/project-assets/voice.mp3',
        text: '试音',
        seconds: 4,
        engine: 'volc-tts',
        voiceId: 'male-qn-qingse',
        fingerprint: 'f',
        stale: true,
      },
    }),
  )
  const html = await buildPreviewHtml(snap)
  assert.ok(html.includes('data-preview-voice-stale'))
  assert.ok(!html.includes('<audio'))
})

await checkAsync('可用试音渲染播放器且不自动播放', async () => {
  const snap = buildPreviewSnapshot(
    character({
      voiceSample: {
        url: '/project-assets/voice.mp3',
        text: '试音',
        seconds: 4,
        engine: 'volc-tts',
        voiceId: 'male-qn-qingse',
        fingerprint: 'f',
      },
    }),
  )
  const html = await buildPreviewHtml(snap)
  assert.ok(html.includes('<audio controls'))
  assert.ok(html.includes('preload="none"'))
  assert.ok(!html.includes('autoplay'))
})

if (process.exitCode !== 1) console.log('\n全部通过')
