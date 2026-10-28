/**
 * 项目数据层：project.json 的读写与镜头合并。
 * 纯函数 + 文件 IO，不依赖 vite，可单独用 node 测试。
 */
import fs from 'node:fs'
import path from 'node:path'

const NAME_RE = /^[a-zA-Z0-9_-]{1,40}$/

/** 项目名只允许字母数字下划线短横，挡掉 ../ 之类的路径穿越 */
export function safeProjectName(name) {
  const v = String(name ?? '').trim()
  if (!NAME_RE.test(v)) throw new Error(`项目名不合法：${v}`)
  return v
}

/**
 * 项目根目录，按优先级：
 *   1. SB_PROJECTS_DIR 环境变量
 *   2. 同仓库的 manga-pipeline/projects（沿用 CLI 的既有数据）
 *   3. <stoyboard-canvas>/projects（新克隆的落点，自动创建）
 */
export function resolveRoot(appRoot) {
  const env = process.env.SB_PROJECTS_DIR
  if (env) return path.resolve(env)
  const sibling = path.resolve(appRoot, '..', 'manga-pipeline', 'projects')
  if (fs.existsSync(sibling)) return sibling
  const local = path.resolve(appRoot, 'projects')
  fs.mkdirSync(local, { recursive: true })
  return local
}

export function listProjects(root) {
  let names = []
  try {
    names = fs.readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && NAME_RE.test(d.name))
      .map((d) => d.name)
  } catch {
    return []
  }
  return names
    .map((name) => {
      const file = path.join(root, name, 'project.json')
      if (!fs.existsSync(file)) return null
      try {
        const d = JSON.parse(fs.readFileSync(file, 'utf8'))
        const shots = Array.isArray(d.shots) ? d.shots : []
        return {
          name,
          title: d.name || name,
          style: d.style || '',
          aspect: d.aspect || '16:9',
          episodes: (d.episodes || []).length,
          shots: shots.length,
          seconds: Math.round(shots.reduce((a, s) => a + Number(s.seconds || 0), 0) * 10) / 10,
        }
      } catch {
        return { name, title: name, style: '', aspect: '16:9', episodes: 0, shots: 0, seconds: 0, broken: true }
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function readProject(root, name) {
  const n = safeProjectName(name)
  const file = path.join(root, n, 'project.json')
  if (!fs.existsSync(file)) throw new Error(`项目不存在：${n}`)
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!Array.isArray(data.shots)) data.shots = []
  if (!Array.isArray(data.characters)) data.characters = []
  if (!Array.isArray(data.episodes)) data.episodes = []
  return data
}

/**
 * 落盘。两条铁律，都是为了不能丢数据：
 *   1. **永远与磁盘上的现有内容合并**，传进来没有的字段一律保留。
 *      早期版本直接 `{...data}` 覆盖，一次只传 shots 的写入就把 episodes/characters 清空了。
 *   2. 写之前留一份 `project.json.bak`，覆盖错误还有回头路。
 */
export function writeProject(root, name, data) {
  const n = safeProjectName(name)
  const dir = path.join(root, n)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'project.json')

  let cur = {}
  if (fs.existsSync(file)) {
    try {
      cur = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      cur = {}
    }
    try {
      fs.copyFileSync(file, path.join(dir, 'project.json.bak'))
    } catch {
      /* 备份失败不阻断主流程 */
    }
  }

  const payload = { ...cur, ...data }
  payload.name = data?.name || cur.name || n
  if (!Array.isArray(payload.shots)) {
    throw new Error('shots 必须是数组 —— 拒绝写入会丢掉镜头列表的内容')
  }
  payload.created_at = cur.created_at || new Date().toISOString()
  payload.updated_at = new Date().toISOString()

  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8')
  fs.renameSync(tmp, file)
  return payload
}

/**
 * 字段级合并：只更新 incoming 里出现的字段，未出现的保持原样。
 * 不在 incoming 里的现有镜头**保留并标 orphan**，不静默删。
 *
 * 注意：handEdited 的手改保护**不在这里做**。保存是人的意图，必须生效；
 * 保护只该拦「LLM 重新生成」，那是生成时的责任（见 ShotTable 的生成后合并）。
 */
export function mergeShots(existing = [], incoming = []) {
  const byId = new Map()
  for (const s of existing) if (s && s.id) byId.set(s.id, s)
  const out = []
  const touched = new Set()

  for (const inc of incoming) {
    if (!inc || !inc.id) continue
    const old = byId.get(inc.id)
    touched.add(inc.id)
    if (!old) {
      out.push({ ...inc })
      continue
    }
    const merged = { ...old }
    for (const [k, v] of Object.entries(inc)) {
      if (k === 'handEdited') continue
      if (v === undefined) continue
      merged[k] = v
    }
    // handEdited 只增不减：一旦手改过就永久留痕
    const hand = new Set([...(old.handEdited || []), ...(Array.isArray(inc.handEdited) ? inc.handEdited : [])])
    if (hand.size) merged.handEdited = [...hand]
    delete merged.orphan
    out.push(merged)
  }

  for (const s of existing) {
    if (!s || !s.id || touched.has(s.id)) continue
    out.push({ ...s, orphan: true })
  }
  return out
}

/**
 * 显式删除镜头：只删传入的 id。
 *
 * 与 mergeShots 的 orphan 语义分开：缺席是「保护性保留」（模型少给一行时
 * 不能静默删数据），只有明确点名才是删除意图。
 */
export function deleteShots(existing = [], ids = []) {
  if (!Array.isArray(ids) || ids.length === 0) return { shots: existing, removed: 0 }
  const drop = new Set(ids.map((x) => String(x)))
  const shots = existing.filter((s) => !s || !s.id || !drop.has(String(s.id)))
  return { shots, removed: existing.length - shots.length }
}

/**
 * 兜底清理悬空转场：transition_out.to 指向已不存在的镜头时清除，
 * 避免导入/手改 JSON 等路径留下指向空处的转场配置。
 */
export function pruneDanglingTransitions(shots = []) {
  const ids = new Set(shots.filter((s) => s && s.id).map((s) => String(s.id)))
  let cleared = 0
  const out = shots.map((s) => {
    const to = s?.transition_out?.to
    if (!s || !to) return s
    // to 可能是 shotId 或画布节点 id；只在它明显是个 shotId 且查不到时清
    if (!String(to).startsWith('E') || ids.has(String(to))) return s
    cleared++
    return { ...s, transition_out: null }
  })
  return { shots: out, cleared }
}

/** 集内镜号唯一性：重复会让 E{集}-{镜号} 的 id 碰撞，是数据损坏级隐患 */
export function findDuplicateShotNos(shots = []) {
  const seen = new Map()
  const dups = []
  for (const s of shots) {
    if (!s || !s.id || s.orphan) continue
    const no = String(s.no ?? '').trim()
    if (!no) continue
    const key = `${Number(s.episode) || 1}:${no}`
    if (seen.has(key)) dups.push({ episode: Number(s.episode) || 1, no, ids: [seen.get(key), String(s.id)] })
    else seen.set(key, String(s.id))
  }
  return dups
}

/** 新建项目：目录 + 空 project.json 骨架。已存在则报错（不覆盖） */
export function createProject(root, name, init = {}) {
  const n = safeProjectName(name)
  const dir = path.join(root, n)
  const file = path.join(dir, 'project.json')
  if (fs.existsSync(file)) throw new Error(`项目已存在：${n}`)
  fs.mkdirSync(dir, { recursive: true })
  return writeProject(root, n, {
    schema: 1,
    name: String(init.title || n),
    logline: '',
    source: '',
    style: String(init.style || ''),
    aspect: String(init.aspect || '16:9'),
    characters: [],
    episodes: [],
    shots: [],
  })
}
