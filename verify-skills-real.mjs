/**
 * 五个阶段的真实模型 smoke：用技能文件组装 system/task，调本地代理一次，校验 JSON 形状。
 * 不写项目、不写线程；设置从现有 projects/storyboard.sqlite 复制到临时目录。
 * 跑法：node verify-skills-real.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const ROOT = process.cwd()
const PORT = 5328
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-real-'))
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

function readRealSettings() {
  const file = path.join(ROOT, 'projects', 'storyboard.sqlite')
  if (!fs.existsSync(file)) throw new Error('找不到 projects/storyboard.sqlite')
  const db = new DatabaseSync(file, { readOnly: true })
  const row = db.prepare("SELECT value FROM settings WHERE key='app'").get()
  db.close()
  if (!row?.value) throw new Error('设置里没有 app')
  return JSON.parse(row.value)
}

function sections(text) {
  const fmEnd = text.indexOf('\n---', 4)
  const body = fmEnd >= 0 ? text.slice(fmEnd + 4) : text
  const roleStart = body.indexOf('## 角色与约束')
  const taskStart = body.indexOf('## 任务')
  if (roleStart < 0 || taskStart < 0) throw new Error('技能缺少两节')
  const role = body
    .slice(roleStart + '## 角色与约束'.length, taskStart)
    .replace(/^\r?\n/, '')
    .replace(/\r?\n+$/, '')
  const task = body
    .slice(taskStart + '## 任务'.length)
    .replace(/^\r?\n/, '')
    .replace(/\r?\n+$/, '')
  return { role, task }
}

function render(template, inputs) {
  return template.replace(/\{\{input:([A-Za-z0-9_]+)\}\}/g, (_m, key) => {
    const v = inputs[key]
    return v == null ? '' : String(v)
  })
}

function skillPrompt(id, inputs) {
  const text = fs.readFileSync(path.join(ROOT, 'skills', id, 'SKILL.md'), 'utf8')
  const { role, task } = sections(text)
  return { system: role, prompt: render(task, inputs) }
}

const real = readRealSettings()
const models = Array.isArray(real.models) ? real.models : []
const pick = (stage) => {
  const direct = real.stageModels?.[stage]
  if (direct) return direct
  if (real.defaults?.text) return real.defaults.text
  const m = models.find((x) => x.cap === 'text' || x.cap === 'textPro')
  return m?.key || ''
}

const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP }, stdio: 'ignore' },
)
const api = async (p, init) => (await fetch(`${APP}${p}`, init)).json()

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

try {
  await api('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(real),
  })

  const cases = [
    {
      stage: 'script',
      id: 'script',
      inputs: {
        source: '一个雨夜的追捕故事：女警在霓虹街口追捕一名义体人，最后发现他是自己的旧搭档。',
        epCount: 1,
        targetSeconds: 45,
        style: '近未来科幻写实',
      },
      check: (j) => Array.isArray(j?.episodes) && j.episodes.length >= 1,
      shape: 'episodes[]',
      maxTokens: 3000,
    },
    {
      stage: 'character',
      id: 'character',
      inputs: {
        scopeLabel: '第 1 集的剧本场次与分镜',
        sceneText: '【第 1 集 雨夜】\n- 街口｜城市街口｜夜\n  女警追捕义体人\n  出场：林岚、陈默',
        shotBlock: '\n\n【本集分镜出场与台词】\nS01 出场：林岚、陈默 台词：站住！',
      },
      check: (j) => Array.isArray(j?.characters) && j.characters.length >= 1,
      shape: 'characters[]',
      maxTokens: 3000,
    },
    {
      stage: 'asset',
      id: 'asset',
      inputs: {
        scopeLabel: '第 1 集的剧本场次与分镜',
        sceneText: '【第 1 集 雨夜】\n- 街口｜城市街口｜夜\n  雨夜霓虹街口，追捕',
        shotBlock: '\n\n【镜头摘要】\nE01-S01 出场：林岚、陈默 画面：雨夜街口',
      },
      check: (j) => Array.isArray(j?.scenes) || Array.isArray(j?.props),
      shape: 'scenes[]/props[]',
      maxTokens: 3000,
    },
    {
      stage: 'shot',
      id: 'shotlist',
      inputs: {
        style: '近未来科幻写实',
        aspect: '16:9',
        brief: '场景 1｜街口｜城市街口｜夜｜林岚追捕陈默｜在场：林岚、陈默',
        target: 12,
      },
      check: (j) => Array.isArray(j?.shots) && j.shots.length >= 1,
      shape: 'shots[]',
      maxTokens: 3000,
    },
    {
      stage: 'prompt',
      id: 'prompt',
      inputs: {
        style: '近未来科幻写实',
        bible: '陈默：a lean man with short black hair, dark trench coat, scar over left eyebrow',
        briefJson: JSON.stringify([
          { no: 'S01', seconds: 3, size: '中景', move: '固定', desc: '雨夜街口，林岚追捕陈默', dialogue: [] },
        ]),
      },
      check: (j) => Array.isArray(j?.shots) && j.shots.length >= 1 && j.shots[0].keyframe_prompt && j.shots[0].video_prompt,
      shape: 'shots[].keyframe_prompt/video_prompt',
      maxTokens: 2500,
    },
  ]

  for (const c of cases) {
    const key = pick(c.stage)
    if (!key) {
      check(`${c.stage} 有可用模型`, false, '设置里没有文本模型')
      continue
    }
    const { system, prompt } = skillPrompt(c.id, c.inputs)
    const t0 = Date.now()
    const r = await api('/api/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system,
        prompt,
        json: true,
        maxTokens: c.maxTokens,
        temperature: 0.3,
        modelKey: key,
      }),
    })
    const secs = Math.round((Date.now() - t0) / 1000)
    if (!r.ok) {
      check(`${c.stage} 真实调用`, false, String(r.message || r.kind || '').slice(0, 160))
      continue
    }
    check(`${c.stage} 真实调用`, true, `${r.modelLabel || key} · ${secs}s`)
    check(`${c.stage} 输出 ${c.shape}`, c.check(r.json), JSON.stringify(r.json).slice(0, 160))
  }
} finally {
  child.kill()
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
