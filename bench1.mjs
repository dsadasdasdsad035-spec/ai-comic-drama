import fs from 'node:fs'
import { readProject, resolveRoot } from './server/data.mjs'
const [label, model, size] = [process.argv[2], process.argv[3], Number(process.argv[4])]
const ROOT = resolveRoot(process.cwd())
const p = readProject(ROOT, 'recycle')
const chars = p.characters || []
const PROMPT_SYS = fs.readFileSync('/tmp/prompt_sys.txt', 'utf8')
const bible = chars.filter((c) => c.look_en).map((c) => `${c.name}：${c.look_en}`).join('\n')
const expand = (t) => { let o = String(t || ''); for (const c of chars) for (const k of [`{{${c.name}}}`, `{{${c.name}.look_en}}`]) o = o.split(k).join(c.look_en || ''); return o }
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }
const groups = chunk(p.shots, size)
console.log(`${label}: ${groups.length} 批 × ${size} 镜，并发发出…`)
const t0 = Date.now()
let charsOut = 0
const res = await Promise.all(groups.map(async (g, gi) => {
  const brief = g.map((x) => ({ no: x.no, seconds: x.seconds, size: x.size, move: x.move, desc: x.desc, dialogue: x.dialogue }))
  try {
    const r = await fetch('http://localhost:5273/api/text', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system: PROMPT_SYS, model, json: true, maxTokens: 4096,
        prompt: `画风锁：${p.style}\n\n角色外观锚点：\n${bible}\n\n分镜：\n${JSON.stringify(brief)}\n\n输出要求：\n1. 每一镜都要给 keyframe_prompt 与 video_prompt，no 必须与输入一致\n2. keyframe_prompt 里凡出现角色，一律用 {{角色名}} 占位代替整段 look_en（例如 {{陈默}}），由我在保存前原样替换回原文 —— 不要自己展开那整段描述\n3. 只输出 JSON` }),
    })
    const j = await r.json()
    if (!j.ok) { console.log(`  批${gi} 失败: ${String(j.message).slice(0, 70)}`); return [] }
    charsOut += JSON.stringify(j.json?.shots || []).length
    return (j.json?.shots || []).map((x) => ({ ...x, keyframe_prompt: expand(x.keyframe_prompt) }))
  } catch (e) { console.log(`  批${gi} 异常: ${e.message.slice(0, 60)}`); return [] }
}))
const secs = ((Date.now() - t0) / 1000).toFixed(1)
const flat = res.flat()
const kfLen = flat.reduce((a, x) => a + (x.keyframe_prompt || '').length, 0)
let miss = 0
for (const x of flat) {
  const s = p.shots.find((z) => z.no === x.no)
  for (const n of [...new Set((s?.dialogue || []).map((d) => d.speaker).filter(Boolean))]) {
    const c = chars.find((z) => z.name === n)
    if (c?.look_en && !(x.keyframe_prompt || '').includes(c.look_en)) miss++
  }
}
const leftover = flat.filter((x) => /\{\{[^}]{1,20}\}\}/.test(x.keyframe_prompt || '')).length
console.log(`→ ${secs}s | ${flat.length} 镜 | 原始输出 ${charsOut} 字符 | keyframe 展开后 ${kfLen} 字符 | 缺锚点 ${miss} | 残留占位符 ${leftover}`)
fs.writeFileSync(`/tmp/bench-${label}.json`, JSON.stringify(flat, null, 2))
