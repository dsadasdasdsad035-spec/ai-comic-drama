/**
 * Agent 项目快照缓存回归（纯函数，无浏览器、无真实网络）。
 *
 * 背景：`builtinPlatformTools` 曾有一个模块级 `projectCache`（只按项目名 key）。
 * 宿主的写入（画布改镜头、角色落库、导入分镜）都不会让它失效，于是同一页面
 * 会话里第二轮及以后的工具会读到第一轮的旧数据；写工具还会拿旧快照整条回写，
 * 用 `mergeShots` 的「incoming 覆盖已定义字段」把用户刚改的内容覆盖掉。
 *
 * 断言点：
 * 1) 新一轮构造的工具读到的是当下的项目数据，不是上一轮的快照；
 * 2) 同一套工具内多次读取只发一次项目请求（去掉缓存不能变成 N 次请求）；
 * 3) 写工具（submit_shots）以刚取到的快照为合并基准，旧快照不参与。
 *
 * 跑法：node verify-agent-project-cache.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-project-cache-'))
const bundle = path.join(tmp, 'bundle.mjs')
execFileSync(path.join(root, 'node_modules', '.bin', 'esbuild'), [
  path.join(root, 'src/agent/builtinPlatformTools.ts'),
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--log-level=error',
  `--outfile=${bundle}`,
])

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

/** 假后端：projectVersion 变了就是「用户在界面上改了项目」 */
let projectVersion = 1
let projectReads = 0
const posts = []
const project = () => ({
  name: 'p1',
  title: 'p1',
  episodes: [{ no: 1, title: 'EP1' }],
  characters: [],
  designs: [],
  assets: [],
  shots: [
    { id: `E01-S0${projectVersion}`, episode: 1, no: `S0${projectVersion}`, desc: `v${projectVersion}`, dialogue: [], cast: [] },
  ],
})

globalThis.fetch = async (url, init = {}) => {
  const href = String(url)
  const method = String(init.method || 'GET').toUpperCase()
  if (method === 'GET' && href.includes('/api/project?name=')) {
    projectReads++
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ ok: true, project: project() }),
      text: async () => '',
    }
  }
  posts.push({ href, body: init.body ? JSON.parse(String(init.body)) : null })
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => ({ ok: true, shots: [], characters: [], savedAt: 'now' }),
    text: async () => '',
  }
}

const mod = await import(bundle)
const input = () => ({ projectName: 'p1', epNo: 1, confirm: async () => true })
const toolOf = (set, name) => {
  const t = set.find((x) => x.name === name)
  if (!t) throw new Error(`没有工具 ${name}`)
  return t
}

// ---------------------------------------------------------------- 1. 跨轮次
const firstTurn = mod.createBuiltinPlatformTools(input())
const r1 = await toolOf(firstTurn, 'read_shots').run({}, {})
check('第一轮读到 S01', JSON.stringify(r1).includes('E01-S01'), JSON.stringify(r1.shots?.[0]))

// 用户在画布上删掉 S01、改了 S02 —— 宿主写入不经过工具，旧缓存无法感知
projectVersion = 2
const secondTurn = mod.createBuiltinPlatformTools(input())
const r2 = await toolOf(secondTurn, 'read_shots').run({}, {})
check('第二轮读到界面改动后的 S02', JSON.stringify(r2).includes('E01-S02'), JSON.stringify(r2.shots?.[0]))
check('第二轮不再返回已删除的 S01', !JSON.stringify(r2).includes('E01-S01'))

// ---------------------------------------------------------------- 2. 同轮次只取一次
projectReads = 0
const sameTurn = mod.createBuiltinPlatformTools(input())
await toolOf(sameTurn, 'read_shots').run({}, {})
await toolOf(sameTurn, 'read_episodes').run({}, {})
await toolOf(sameTurn, 'read_shot_detail').run({ shotId: `E01-S0${projectVersion}` }, {}).catch(() => null)
check('同一套工具内多次读取只发一次项目请求', projectReads === 1, `GET ${projectReads} 次`)

// ---------------------------------------------------------------- 3. 写工具合并基准
projectVersion = 3
posts.length = 0
const writeTurn = mod.createBuiltinPlatformTools(input())
const submit = toolOf(writeTurn, 'submit_shots')
const payload = {
  shots: [
    {
      no: 'S03',
      episode: 1,
      scene_no: 1,
      scene_slug: 'SC01',
      seconds: 3,
      size: '中景',
      move: '固定',
      desc: '新写的第三镜',
      dialogue: [],
      cast: [],
      keyframe_prompt: '雨夜街头',
      video_prompt: '雨夜街头，推镜头',
    },
  ],
}
const wrote = await submit.run(payload, {})
check('提交镜头成功', wrote.ok === true, JSON.stringify(wrote).slice(0, 120))
const merged = posts.find((p) => p.body?.shots)
check(
  '写回载荷只带本次改动，不含旧快照',
  Boolean(merged) && merged.body.shots.every((s) => s.desc !== 'v1' && s.desc !== 'v2'),
  JSON.stringify(merged?.body?.shots ?? null).slice(0, 160),
)

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(bad === 0 ? 0 : 1)
