/**
 * 项目生命周期：删除前预览、快照、级联清理。
 *
 * 为什么独立成模块而不是塞进 db.mjs：
 * - publish-jobs.mjs 已经依赖 db.mjs，删除要读活动任务状态；写进 db.mjs 会形成循环导入。
 * - 删除是跨 13 张表 + 文件系统的操作，和「项目读写」不是同一层职责。
 *
 * 关键约束：
 * - 快照先落盘，写不进去就不删；快照只含数据库行，不含媒体文件。
 * - 事务提交成功后才删文件；文件删不掉只记 warning，不假装成功。
 * - 共享产物池（public/exports 等）一律不动，响应里固定说明。
 */
import fs from 'node:fs'
import path from 'node:path'
import { openDatabase, safeProjectName } from './db.mjs'
import { listJobs } from './publish-jobs.mjs'

/** 删除快照目录，位于项目根下，不随项目目录一起删 */
export const DELETED_DIR = '.deleted'

/**
 * 项目域表清单。project_id 表按主键关联，其余按项目名字符串关联。
 * publish_events 没有 project 列，按 job_id 子查询；必须排在 publish_jobs 之前删。
 */
export const PROJECT_CASCADE = [
  { table: 'shots', column: 'project_id', key: 'id' },
  { table: 'characters', column: 'project_id', key: 'id' },
  { table: 'assets', column: 'project_id', key: 'id' },
  { table: 'designs', column: 'project_id', key: 'id' },
  { table: 'scenes', column: 'project_id', key: 'id' },
  { table: 'episodes', column: 'project_id', key: 'id' },
  { table: 'scene_layouts', column: 'project_id', key: 'id' },
  { table: 'stock_imports', column: 'project_id', key: 'id' },
  { table: 'chat_threads', column: 'project', key: 'name' },
  {
    table: 'publish_events',
    column: 'job_id',
    key: 'job_subquery',
    where: 'job_id IN (SELECT id FROM publish_jobs WHERE project = ?)',
  },
  { table: 'publish_jobs', column: 'project', key: 'name' },
  { table: 'publish_intents', column: 'project', key: 'name' },
  { table: 'deliverables', column: 'project', key: 'name' },
]

function argsFor(item, projectId, name) {
  return item.key === 'id' ? [projectId] : [name]
}

function whereFor(item) {
  return item.where || `${item.column} = ?`
}

function countSql(item) {
  return `SELECT COUNT(*) AS n FROM ${item.table} WHERE ${whereFor(item)}`
}

function selectSql(item) {
  return `SELECT * FROM ${item.table} WHERE ${whereFor(item)}`
}

function deleteSql(item) {
  return `DELETE FROM ${item.table} WHERE ${whereFor(item)}`
}

function jobSummary(jobs) {
  return jobs.map((j) => ({
    id: j.id,
    platform: j.platform,
    state: j.state,
    deliverableId: j.deliverableId,
    createdAt: j.createdAt,
  }))
}

/** 递归统计目录字节数；符号链接不计入、不跟随 */
function dirBytes(dir) {
  let total = 0
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) total += dirBytes(full)
    else if (entry.isFile()) {
      try {
        total += fs.statSync(full).size
      } catch {
        /* 读不到就跳过 */
      }
    }
  }
  return total
}

function snapshotStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

/**
 * 把项目主表行与全部级联表行写成一个 JSON 快照。
 * 先写同目录临时文件再 rename，失败会把临时文件清掉并抛错。
 */
function writeSnapshot(root, name, projectRow, tables) {
  const dir = path.join(root, DELETED_DIR)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${name}-${snapshotStamp()}.json`)
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  const payload = {
    version: 1,
    projectsRoot: root,
    deletedAt: new Date().toISOString(),
    project: projectRow,
    tables,
  }
  try {
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8')
    fs.renameSync(tmp, file)
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      /* 临时文件清理失败不掩盖原始错误 */
    }
    throw e
  }
  return file
}

/**
 * 删除影响预览：只读。项目不存在时返回 exists=false，不抛错。
 */
export function previewProjectDelete(root, name) {
  const n = safeProjectName(name)
  const db = openDatabase(root)
  try {
    const project = db.prepare('SELECT * FROM projects WHERE name = ?').get(n)
    if (!project) {
      return { ok: true, name: n, exists: false, counts: {}, mediaBytes: 0, activeJobs: [] }
    }
    const counts = {}
    for (const item of PROJECT_CASCADE) {
      const row = db.prepare(countSql(item)).get(...argsFor(item, project.id, n))
      counts[item.table] = Number(row?.n) || 0
    }
    const activeJobs = jobSummary(listJobs(root, { project: n, active: true }))
    return {
      ok: true,
      name: n,
      exists: true,
      counts,
      mediaBytes: dirBytes(path.join(root, n)),
      activeJobs,
    }
  } finally {
    db.close()
  }
}

/**
 * 批量预览：一次连接算完所有项目，避免前端为几百个选中项各发一次请求。
 * 单个项目失败只影响它自己（该条带 message），不中断整批。
 */
export function previewProjectDeletes(root, names) {
  const raw = Array.isArray(names) ? names : [names]
  if (!raw.length) throw new Error('没有要预览的项目')
  const db = openDatabase(root)
  try {
    const items = raw.map((value) => {
      let n
      try {
        n = safeProjectName(value)
      } catch (e) {
        return {
          ok: false,
          name: String(value ?? ''),
          exists: false,
          counts: {},
          mediaBytes: 0,
          activeJobs: [],
          message: e?.message || String(e),
        }
      }
      const project = db.prepare('SELECT * FROM projects WHERE name = ?').get(n)
      if (!project) {
        return { ok: true, name: n, exists: false, counts: {}, mediaBytes: 0, activeJobs: [] }
      }
      const counts = {}
      for (const item of PROJECT_CASCADE) {
        const row = db.prepare(countSql(item)).get(...argsFor(item, project.id, n))
        counts[item.table] = Number(row?.n) || 0
      }
      return {
        ok: true,
        name: n,
        exists: true,
        counts,
        mediaBytes: dirBytes(path.join(root, n)),
        activeJobs: jobSummary(listJobs(root, { project: n, active: true })),
      }
    })
    return { ok: true, items }
  } finally {
    db.close()
  }
}

/**
 * 删除单个项目。返回带 code 的结果对象而不是抛错，方便批量逐项报告。
 * code: not_found | active_jobs | snapshot_failed | delete_failed
 */
export function deleteProject(root, name, opts = {}) {
  const n = safeProjectName(name)
  const db = openDatabase(root)
  let snapshotPath = ''
  try {
    const project = db.prepare('SELECT * FROM projects WHERE name = ?').get(n)
    if (!project) {
      return { name: n, ok: false, code: 'not_found', message: `项目不存在：${n}` }
    }

    const active = listJobs(root, { project: n, active: true })
    if (active.length) {
      return {
        name: n,
        ok: false,
        code: 'active_jobs',
        message: '项目还有进行中的发布任务，先处理或取消后再删除',
        jobs: jobSummary(active),
      }
    }

    const tables = {}
    for (const item of PROJECT_CASCADE) {
      tables[item.table] = db.prepare(selectSql(item)).all(...argsFor(item, project.id, n))
    }
    try {
      snapshotPath = writeSnapshot(root, n, project, tables)
    } catch (e) {
      return {
        name: n,
        ok: false,
        code: 'snapshot_failed',
        message: `删除快照写入失败，项目未删除：${e?.message || String(e)}`,
      }
    }

    db.exec('BEGIN IMMEDIATE')
    try {
      for (const item of PROJECT_CASCADE) {
        db.prepare(deleteSql(item)).run(...argsFor(item, project.id, n))
      }
      db.prepare('DELETE FROM projects WHERE name = ?').run(n)
      db.exec('COMMIT')
    } catch (e) {
      try {
        db.exec('ROLLBACK')
      } catch {
        /* 事务已结束 */
      }
      return {
        name: n,
        ok: false,
        code: 'delete_failed',
        message: `删除事务失败，项目未删除：${e?.message || String(e)}`,
      }
    }

    // 事务已提交：从这里开始只清理文件，失败不影响数据一致性
    const warnings = []
    const projectDir = path.join(root, n)
    let filesRemoved = false
    if (fs.existsSync(projectDir)) {
      try {
        fs.rmSync(projectDir, { recursive: true, force: true })
        filesRemoved = true
      } catch (e) {
        warnings.push(`项目目录未删除：${e?.message || String(e)}`)
      }
    }
    const appRoot = String(opts.appRoot || process.cwd())
    const draftsDir = path.join(appRoot, '.scene-drafts', n)
    if (fs.existsSync(draftsDir)) {
      try {
        fs.rmSync(draftsDir, { recursive: true, force: true })
      } catch (e) {
        warnings.push(`3D 草稿目录未删除：${e?.message || String(e)}`)
      }
    }

    return {
      name: n,
      ok: true,
      snapshot: path.relative(root, snapshotPath),
      filesRemoved,
      sharedFilesKept: true,
      warnings,
    }
  } finally {
    db.close()
  }
}

/**
 * 批量删除：逐个执行，单项失败不中断、不回滚已完成项。
 * 名字先去重并逐个校验；非法名字直接抛错（由路由返回 400）。
 * 不设数量上限——一次清掉几百个测试项目是正常用法，调用方只管把名字交过来。
 */
export function deleteProjects(root, names, opts = {}) {
  const raw = Array.isArray(names) ? names : [names]
  const clean = []
  for (const value of raw) {
    const n = safeProjectName(value)
    if (!clean.includes(n)) clean.push(n)
  }
  if (!clean.length) throw new Error('没有要删除的项目')

  const results = clean.map((n) => {
    try {
      return deleteProject(root, n, opts)
    } catch (e) {
      return { name: n, ok: false, code: 'error', message: e?.message || String(e) }
    }
  })
  return {
    ok: true,
    results,
    deleted: results.filter((r) => r.ok).map((r) => r.name),
    sharedFilesKept: true,
  }
}
