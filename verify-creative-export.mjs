/**
 * 创意导出与晋升验收：JSON/文本导出、晋升新项目、晋升现有项目保留手改、失败不留半成品。
 * 跑法：node verify-creative-export.mjs
 */
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const ROOT = process.cwd()
const PORT = 5344
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-export-'))
const PROJECTS = path.join(TMP, 'projects')
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

fs.mkdirSync(PROJECTS, { recursive: true })

// 端口被占用时直接失败：否则会连到上一个崩溃留下的孤儿 dev server
try {
  await fetch(`${APP}/api/health`, { signal: AbortSignal.timeout(800) })
  console.error(`端口 ${PORT} 已被占用（可能是上次崩溃留下的 dev server），请先结束它`)
  process.exit(1)
} catch {
  /* 端口空闲 */
}

const pack = {
  source: { platform: 'douyin', url: 'https://v.douyin.com/demo', duration: 3.6, width: 320, height: 240 },
  global_style: 'neon rainy night, teal and orange',
  shots: [
    {
      index: 1, start: 0, end: 1.2, size: 'close-up', camera: 'eye level',
      subject: '一只玻璃杯', action: '杯子被推向前', environment: '湿漉漉的木桌',
      lighting: '霓虹侧光', color: '青橙', audio: '雨声',
      keyframe_prompt: 'a glass cup on a wet wooden table, close-up, neon rim light',
      video_prompt: 'the cup slides forward, dolly in 20cm',
      evidence_frames: ['/creative/demo/frames/f1.jpg'], confidence: 0.82,
    },
    {
      index: 2, start: 1.2, end: 2.4, size: 'medium shot', camera: 'pan',
      subject: '一个人', action: '抬头看向窗外', environment: '室内',
      lighting: '暖色台灯', color: '暖橙', audio: '无',
      keyframe_prompt: 'a person looking out of the window, medium shot, warm lamp light',
      video_prompt: 'slow pan right, 15 degrees',
      evidence_frames: ['/creative/demo/frames/f2.jpg'], confidence: 0.7,
    },
  ],
  negative_prompt: 'text, watermark',
  notes: '第二镜背景看不清',
}

// 预置一个已有项目，含一条手改过的镜头，用来验证晋升不覆盖
const seedScript = path.join(TMP, 'seed.mjs')
fs.writeFileSync(
  seedScript,
  `import { createProject, writeProject } from ${JSON.stringify(path.join(ROOT, 'server', 'db.mjs'))}
createProject(${JSON.stringify(PROJECTS)}, 'existing', { title: '已有项目' })
writeProject(${JSON.stringify(PROJECTS)}, 'existing', {
  shots: [{ id: 'keep-me', episode: 1, no: 'S01', seconds: 2, size: '中景',
            desc: '人工写的镜头', keyframe_prompt: '手写首帧提示词', video_prompt: '手写运动提示词',
            handEdited: ['keyframe_prompt'] }],
})
`,
)
execFileSync(process.execPath, [seedScript], { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: PROJECTS } })

const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: PROJECTS }, stdio: 'ignore' },
)

const api = async (p, init) => {
  const r = await fetch(`${APP}${p}`, init)
  let json = null
  try {
    json = await r.json()
  } catch {
    /* ignore */
  }
  return { status: r.status, json }
}
const post = (p, body) =>
  api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

let up = false
for (let i = 0; i < 80; i++) {
  try {
    const r = await fetch(`${APP}/api/health`)
    if (r.ok) {
      up = true
      break
    }
  } catch {
    /* wait */
  }
  await new Promise((r) => setTimeout(r, 400))
}
if (!up) {
  console.error('临时 dev server 启动失败')
  child.kill()
  process.exit(1)
}

const sessionRes = await post('/api/creative/sessions', { mode: 'reverse' })
const session = sessionRes.json?.session?.id
if (!session) {
  console.error('创建会话失败：', JSON.stringify(sessionRes))
  child.kill()
  process.exit(1)
}
console.log('session =', session)

// 用存储层直接落一个产物（模拟 submit_reverse_pack 的结果）
const seedArtifact = path.join(TMP, 'seed-artifact.mjs')
fs.writeFileSync(
  seedArtifact,
  `import { saveArtifact } from ${JSON.stringify(path.join(ROOT, 'server', 'creative.mjs'))}
saveArtifact(${JSON.stringify(PROJECTS)}, ${JSON.stringify(session)}, {
  id: 'art-demo', kind: 'reverse', title: '抖音拆解', payload: ${JSON.stringify(pack)}, modelLabel: 'vision-demo',
})
`,
)
try {
  execFileSync(process.execPath, [seedArtifact], { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: PROJECTS }, stdio: 'inherit' })

  // 1) 导出 JSON + 文本
  const exp = await post('/api/creative/export', { artifactId: 'art-demo' })
  check('导出成功', exp.json?.ok === true, exp.json?.message)
  check('导出带 payload', Array.isArray(exp.json?.payload?.shots) && exp.json.payload.shots.length === 2)
  const text = String(exp.json?.text || '')
  check('导出文本含镜头分组', text.includes('## 镜头 1') && text.includes('## 镜头 2'))
  check('导出文本含两段提示词', text.includes('首帧提示词：') && text.includes('运动提示词：'))
  check('导出文本不含内部 id', !text.includes('art-demo') && !text.includes('keep-me'))
  check('导出文本不含文件路径滥用', !/\.\.\//.test(text))

  // 2) 晋升为新项目
  const created = await post('/api/creative/promote', {
    artifactId: 'art-demo', target: 'new', projectName: 'promoted', title: '复刻项目', aspect: '9:16',
    sourceUrl: 'https://v.douyin.com/demo',
  })
  check('晋升新项目成功', created.json?.ok === true, created.json?.message)
  check('新项目镜头数', created.json?.shots === 2, String(created.json?.shots))

  const proj = await api('/api/project?name=promoted')
  const shots = proj.json?.project?.shots || []
  check('项目里有两个镜头', shots.length === 2)
  const s1 = shots[0]
  check('首帧提示词映射', s1?.keyframe_prompt === pack.shots[0].keyframe_prompt)
  check('运动提示词映射', s1?.video_prompt === pack.shots[0].video_prompt)
  check('时长取时间差', Math.abs(Number(s1?.seconds) - 1.2) < 0.01, String(s1?.seconds))
  check('景别与机位映射', s1?.size === 'close-up' && s1?.move === 'eye level')
  check('描述合并主体与动作', String(s1?.desc || '').includes('玻璃杯') && String(s1?.desc || '').includes('推向前'))
  check('证据帧写入镜头扩展字段', JSON.stringify(s1 || {}).includes('f1.jpg'))
  check('来源链接写入镜头扩展字段', JSON.stringify(s1 || {}).includes('v.douyin.com'))
  check('稳定 shotId', String(s1?.id || '').startsWith(`${session}-001`), String(s1?.id))

  // 3) 晋升到现有项目：保留手改镜头
  const merged = await post('/api/creative/promote', {
    artifactId: 'art-demo', target: 'existing', projectName: 'existing',
  })
  check('晋升现有项目成功', merged.json?.ok === true, merged.json?.message)
  const existing = await api('/api/project?name=existing')
  const exShots = existing.json?.project?.shots || []
  const keep = exShots.find((s) => s.id === 'keep-me')
  check('手改镜头仍在', Boolean(keep))
  check('手改提示词未被覆盖', keep?.keyframe_prompt === '手写首帧提示词', String(keep?.keyframe_prompt))
  check('手改标记仍在', Array.isArray(keep?.handEdited) && keep.handEdited.includes('keyframe_prompt'))
  check('新增了两个创意镜头', exShots.length === 3, String(exShots.length))

  // 4) 重复晋升不产生重复镜头
  await post('/api/creative/promote', { artifactId: 'art-demo', target: 'existing', projectName: 'existing' })
  const again = await api('/api/project?name=existing')
  check('重复晋升镜头数不变', (again.json?.project?.shots || []).length === 3, String((again.json?.project?.shots || []).length))

  // 5) 失败路径：不存在的产物 / 缺项目名 / 不存在的项目
  const noArtifact = await post('/api/creative/promote', { artifactId: 'art-nope', target: 'new', projectName: 'x' })
  check('不存在的产物返回 404', noArtifact.status === 404)
  const noName = await post('/api/creative/promote', { artifactId: 'art-demo', target: 'new', projectName: '' })
  check('缺项目名被拒绝', noName.status === 400, noName.json?.message)
  const noProject = await post('/api/creative/promote', { artifactId: 'art-demo', target: 'existing', projectName: 'nope' })
  check('不存在的项目被拒绝', noProject.status === 400, noProject.json?.message)
  const names = (await api('/api/project')).json?.projects?.map((p) => p.name) || []
  check('失败路径没留下半成品项目', !names.includes('x') && !names.includes('nope'), names.join(','))

  // 6) 重名项目：createProject 报错，不覆盖已有项目
  const dup = await post('/api/creative/promote', { artifactId: 'art-demo', target: 'new', projectName: 'existing' })
  check('重名新建被拒绝', dup.status === 400 && /已存在/.test(String(dup.json?.message)), dup.json?.message)
  const stillThere = await api('/api/project?name=existing')
  check('已有项目未被覆盖', (stillThere.json?.project?.shots || []).length === 3)

  // 7) 空镜头列表被拒绝
  fs.writeFileSync(
    seedArtifact,
    `import { saveArtifact } from ${JSON.stringify(path.join(ROOT, 'server', 'creative.mjs'))}
saveArtifact(${JSON.stringify(PROJECTS)}, ${JSON.stringify(session)}, { id: 'art-empty', kind: 'reverse', payload: { shots: [] } })
`,
  )
  execFileSync(process.execPath, [seedArtifact], { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: PROJECTS }, stdio: 'inherit' })
  const empty = await post('/api/creative/promote', { artifactId: 'art-empty', target: 'new', projectName: 'empty-proj' })
  check('空提示词包被拒绝', empty.status === 400 && /没有镜头/.test(String(empty.json?.message)), empty.json?.message)
} finally {
  child.kill()
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
