/**
 * 3D 参考视频摄取：上传 → project-assets，不写 sceneCode。
 * 跑法：node verify-shot-3d-reference-ingest.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ingestShot3dReference } from './server/shot3d-ingest.mjs'
import { submitVggtAnalyze, isVggtAvailable } from './server/vggt.mjs'
import { resolveRoot, safeProjectName, readProject } from './server/db.mjs'
import { createProject } from './server/db.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const NAME = `verify-shot3d-ingest-${Date.now()}`
let bad = 0
const check = (n, c, e = '') => {
  console.log(`${c ? '✅' : '❌'} ${n}${e ? ' | ' + e : ''}`)
  if (!c) bad++
}

const fixture = path.join(root, 'fixtures/evidence-scene3d-chat-mp4/output.mp4')
check('fixture 存在', fs.existsSync(fixture))

const rootDir = resolveRoot(root)
createProject(rootDir, NAME, { title: NAME })

const b64 = fs.readFileSync(fixture).toString('base64')
const result = await ingestShot3dReference(
  root,
  {
    projectName: NAME,
    shotId: 'E01-S01',
    adapter: 'upload',
    name: 'sample.mp4',
    data: `data:video/mp4;base64,${b64}`,
  },
  { ingest: {} },
)

check('返回站内 URL', result.videoUrl.startsWith(`/project-assets/${encodeURIComponent(NAME)}/`))
check('probe 有时长', Number(result.probe?.duration) > 0)

const projBefore = readProject(rootDir, NAME)
const shot = projBefore?.shots?.[0]
const codeBefore = shot?.scene_code?.code || shot?.sceneCode?.code || ''

await ingestShot3dReference(
  root,
  { projectName: '___no_such_project___', url: 'https://example.com/x.mp4' },
  { ingest: {} },
).then(
  () => check('不存在项目应失败', false),
  () => check('不存在项目应失败', true),
)

const projAfter = readProject(rootDir, NAME)
const shotAfter = projAfter?.shots?.[0]
const codeAfter = shotAfter?.scene_code?.code || shotAfter?.sceneCode?.code || ''
check('摄取未改 sceneCode', codeBefore === codeAfter)

const videoAsset = (projAfter?.assets || []).find(
  (a) => a.kind === 'video' && String(a.url || '').includes(encodeURIComponent(NAME)),
)
check(
  '登记 project.assets 视频',
  Boolean(videoAsset) && videoAsset.url === result.videoUrl.split('?')[0],
  JSON.stringify(projAfter?.assets || []),
)

if (isVggtAvailable()) {
  try {
    const job = submitVggtAnalyze(root, {
      videoRef: result.videoUrl.split('?')[0],
      sourceKind: 'reference',
      projectAspect: '16:9',
      effectiveSeconds: 4,
      maxFrames: 4,
    })
    check('已登记视频可提交 VGGT', Boolean(job?.id), job?.id || '')
  } catch (e) {
    check('已登记视频可提交 VGGT', false, e?.message || String(e))
  }
} else {
  console.log('⏭ VGGT Worker 未配置，跳过 analyze 断言')
}

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ shot-3d 参考摄取校验通过')
process.exit(bad ? 1 : 0)
