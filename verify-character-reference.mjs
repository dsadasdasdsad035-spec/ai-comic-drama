/**
 * 角色参考图的回归：
 * 1) 字段映射：reference_images 只写站内路径（dataURL 被过滤）
 * 2) 身份指纹不受参考图影响（加参考图不让表情总图失效）
 * 3) 分镜参考集合不读取参考图（预算隔离）
 *
 * 跑法：node verify-character-reference.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const outDir = fs.mkdtempSync(path.join(root, '.verify-charref-'))
const esbuild = path.join(root, 'node_modules', '.bin', 'esbuild')
const bundle = (entry, name) => {
  const out = path.join(outDir, `${name}.mjs`)
  execFileSync(esbuild, [entry, '--bundle', '--platform=node', '--format=esm', '--log-level=error', `--outfile=${out}`])
  return out
}

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

const C = await import(bundle('src/charMap.ts', 'charMap'))
const CH = await import(bundle('src/characters.ts', 'characters'))
const R = await import(bundle('src/shotReferences.ts', 'shotReferences'))

// ---------------------------------------------------------------- 字段映射
const sheet = {
  id: '陈默',
  name: '陈默',
  role: '主角',
  lookCn: '方下颌',
  lookEn: 'Chinese man, square jaw',
  palette: '铁灰',
  keywords: ['义肢'],
  image: '/project-assets/p/char-1.png',
  candidates: ['/project-assets/p/char-1.png', '/project-assets/p/char-2.png'],
  referenceImages: ['/project-assets/p/ref-1.png', '/project-assets/p/ref-2.png'],
}
const proj = C.toProject(sheet)
check('写到 project 的字段名是 reference_images', Array.isArray(proj.reference_images), JSON.stringify(Object.keys(proj)))
check('参考图路径原样保留', (proj.reference_images ?? []).length === 2, JSON.stringify(proj.reference_images))
check('三视图 image 不受影响', proj.image === '/project-assets/p/char-1.png')

// dataURL 必须被过滤
const withDataUrl = C.toProject({
  ...sheet,
  referenceImages: ['data:image/png;base64,AAAA', '/project-assets/p/ok.png', 'https://cdn.example.com/x.png'],
})
check(
  'dataURL 与外链被过滤，只留站内路径',
  JSON.stringify(withDataUrl.reference_images) === JSON.stringify(['/project-assets/p/ok.png']),
  JSON.stringify(withDataUrl.reference_images),
)

// 往返
const back = C.toSheet({ ...proj, name: '陈默' })
check('toSheet 读回参考图', (back.referenceImages ?? []).length === 2, JSON.stringify(back.referenceImages))
const noRefs = C.toSheet({ name: '甲', look_cn: '', look_en: '', palette: '', keywords: [] })
check('旧项目没有该字段时为空', noRefs.referenceImages === undefined || noRefs.referenceImages.length === 0)

// ---------------------------------------------------------------- 指纹不受影响
const base = { lookEn: 'man, square jaw', palette: '铁灰', keywords: ['义肢'] }
const fp1 = CH.identityFingerprint(base)
const fp2 = CH.identityFingerprint(base)
check('身份指纹与参考图无关（同输入同输出）', fp1 === fp2, `${fp1} vs ${fp2}`)
check('指纹只由文字锚点组成', fp1 === 'man, square jaw|铁灰|义肢', fp1)
check(
  '改英文锚点才让指纹变化',
  CH.identityFingerprint({ ...base, lookEn: 'man, round jaw' }) !== fp1,
)

// ---------------------------------------------------------------- 预算隔离
const shot = {
  id: 'shot-1',
  type: 'shot',
  position: { x: 0, y: 0 },
  data: { no: 'S01', seconds: 3, size: '中景', move: '固定', dialogue: '', prompt: '', marks: [], refIds: ['char-陈默'] },
}
const characterWithRefs = {
  id: '陈默',
  name: '陈默',
  role: '',
  lookCn: '',
  lookEn: 'man, square jaw',
  palette: '',
  keywords: [],
  image: '/project-assets/p/char-1.png',
  referenceImages: ['/project-assets/p/ref-1.png', '/project-assets/p/ref-2.png', '/project-assets/p/ref-3.png'],
}
const collected = R.collectShotReferences({ node: shot, nodes: [shot], characters: [characterWithRefs] })
check(
  '分镜参考只取三视图',
  collected.refs.length === 1 && collected.refs[0].url === '/project-assets/p/char-1.png',
  JSON.stringify(collected.refs.map((r) => r.url)),
)
check(
  '参考图不进入分镜参考集合',
  !collected.refs.some((r) => String(r.url).includes('ref-')),
  JSON.stringify(collected.refs.map((r) => r.url)),
)
const limited = R.limitReferences(collected.refs, 4)
check('占用预算数与没有参考图时一致', limited.used.length === 1 && limited.omitted.length === 0)

// 不看参考图的角色（无三视图）不会因为参考图而多出参考项
const onlyRefs = { ...characterWithRefs, image: undefined }
const collected2 = R.collectShotReferences({ node: shot, nodes: [shot], characters: [onlyRefs] })
check(
  '只有参考图、没有三视图时不产生参考项',
  collected2.refs.length === 0,
  JSON.stringify(collected2.refs.map((r) => r.url)),
)

fs.rmSync(outDir, { recursive: true, force: true })
console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项未通过`)
process.exit(bad === 0 ? 0 : 1)
