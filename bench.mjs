import fs from 'node:fs'
import { readProject, resolveRoot } from './server/data.mjs'

const ROOT = resolveRoot(process.cwd())
const p = readProject(ROOT, 'recycle')
const chars = p.characters || []
const PROMPT_SYS = fs.readFileSync('/tmp/prompt_sys.txt', 'utf8')
const bible = chars.filter((c) => c.look_en).map((c) => `${c.name}：${c.look_en}`).join('\n')

const expand = (text) => {
  let out = String(text || '')
  for (const c of chars) {
    for (const k of [`{{${c.name}}}`, `{{${c.name}.look_en}}`]) out = out.split(k).join(c.look_en || '')
  }
  return out
}
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }

async function run(label, model, size) {
  const groups = chunk(p.shots, size)
  const t0 = Date.now()
  let charsOut = 0
  const res = await Promise.all(groups.map(async (g, gi) => {
    const brief = g.map((x) => ({ no: x.no, seconds: x.seconds, size: x.size, move: x.move, desc: x.desc, dialogue: x.dialogue }))
    const r = await fetch('http://localhost:5273/api/text', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system: PROMPT_SYS, model, json: true, maxTokens: 4096,
        prompt: `画风锁：${p.style}\n\n角色外观锚点：\n${bible}\n\n分镜：\n${JSON.stringify(brief)}\n\n` +
          `输出要求：\n1. 每一镜都要给 keyframe_prompt 与 video_prompt，no 必须与输入一致\n` +
          `2. keyframe_prompt 里凡出现角色，一律用 {{角色名}} 占位代替整段 look_en（例如 {{陈默}}），由我在保存前原样替换回原文 —— 不要自己展开那整段描述\n3. 只输出 JSON`,
      }),
    })
    const j = await r.json()
    if (!j.ok) { console.log(`  批${gi} 失败: ${j.message?.slice(0, 60)}`); return [] }
    const raw = JSON.stringify(j.json?.shots || [])
    charsOut += raw.length
    return (j.json?.shots || []).map((x) => ({ ...x, keyframe_prompt: expand(x.keyframe_prompt) }))
  }))
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  const flat = res.flat()
  const kfLen = flat.reduce((a, x) => a + (x.keyframe_prompt || '').length, 0)
  // 锚点校验
  let miss = 0
  for (const x of flat) {
    const s = p.shots.find((z) => z.no === x.no)
    const sp = [...new Set((s?.dialogue || []).map((d) => d.speaker).filter(Boolean))]
    for (const n of sp) {
      const c = chars.find((z) => z.name === n)
      if (c?.look_en && !(x.keyframe_prompt || '').includes(c.look_en)) miss++
    }
  }
  const leftover = flat.filter((x) => /\{\{[^}]{1,20}\}\}/.test(x.keyframe_prompt || '')).length
  console.log(`${label}  模型=${model} 批=${groups.length}×${size}镜 → ${secs}s | 返回 ${flat.length} 镜 | 原始输出 ${charsOut} 字符 | 展开后 keyframe ${kfLen} 字符 | 缺锚点 ${miss} | 残留占位符 ${leftover}`)
  return { secs: +secs, flat }
}

console.log('基线（旧做法，单请求全部 15 镜）: 277.6s / 输出 ~10958 字符')
console.log()
const a = await run('A', 'pro', 5)
const b = await run('B', 'lite', 5)
const c = await run('C', 'pro', 3)
fs.writeFileSync('/tmp/opt-best.json', JSON.stringify((b.flat.length >= 15 ? b : a).flat, null, 2))
