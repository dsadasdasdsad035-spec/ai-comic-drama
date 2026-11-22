/**
 * 提示词案例库冒烟：起一个真实服务进程，按层探测能力是否真的可用。
 *
 * 与 verify-prompt-cases.mjs 的分工：
 * - verify 系列用临时库直接调模块，断言细节语义（分页、幂等、许可推导、作业状态机）；
 * - 本脚本起**真实服务进程**，只问「这条链路现在通不通」，并把真实外部依赖
 *   （vflow 网络、rea-video 可执行文件）单独成层，断网或未装工具时不会红。
 *
 * 跑法：
 *   node verify-prompt-cases-smoke.mjs            # 全跑（含真实网络与真实 CLI）
 *   node verify-prompt-cases-smoke.mjs --offline  # 只跑离线层（CI / 无网环境）
 *
 * 退出码只反映「离线层」与「网络层」的失败；真实 CLI 层缺失只提示，不算失败
 * ——它本来就是可选依赖（见 DEPLOY-CHECKLIST 第 4 条）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const OFFLINE_ONLY = process.argv.includes('--offline')

let bad = 0
let skipped = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad += 1
}
const note = (name, why) => {
  console.log(`⚪ ${name} · 跳过：${why}`)
  skipped += 1
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pcl-smoke-'))
const PROJECT = 'smoke'
/**
 * 内部令牌：VLM 中转端点与作业创建都依赖它。
 * 不设的话服务端会随机生成一个，子进程拿不到，反推会被「无可用视觉模型」拦下。
 */
const INTERNAL_TOKEN = 'pcl-smoke-internal-token'

/**
 * 服务进程要用 Node ≥ 24.9（node:sqlite + 创意宿主）。
 *
 * `process.execPath` 在开发机上常常是 22（nvm 默认），直接拿它起服务会立刻退出。
 * 复用 desktop 的解析顺序：SB_DESKTOP_NODE → 随包 desktop/bin/node → 当前进程。
 * 三者都不达标就给一条可操作的说明，而不是把「Node 版本过低」伪装成用例失败。
 */
function resolveNodeForServer() {
  const candidates = [
    process.env.SB_DESKTOP_NODE,
    path.join(ROOT, 'desktop', 'bin', 'node'),
    process.execPath,
  ].filter(Boolean)
  for (const c of candidates) {
    try {
      if (!fs.existsSync(c)) continue
      const v = spawnSync(c, ['--version'], { encoding: 'utf8' })
      const m = String(v.stdout || '').trim().match(/^v(\d+)\.(\d+)/)
      if (!m) continue
      const major = Number(m[1])
      const minor = Number(m[2])
      if (major > 24 || (major === 24 && minor >= 9)) return { bin: c, version: String(v.stdout).trim() }
    } catch {
      /* ignore */
    }
  }
  return null
}
const NODE = resolveNodeForServer()

/** 起真实服务进程；返回 base URL 与停止函数 */
async function startServer(extraEnv = {}) {
  const proc = spawn(NODE.bin, [path.join(ROOT, 'server', 'index.mjs')], {
    cwd: ROOT,
    env: {
      ...process.env,
      SB_PROJECTS_DIR: TMP,
      SB_STATE_ROOT: path.join(TMP, 'state'),
      SB_MEDIA_ROOT: path.join(TMP, 'media'),
      SB_PORT: '0',
      SB_STUDIO_INTERNAL_TOKEN: INTERNAL_TOKEN,
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`服务启动超时：${log.slice(-500)}`)), 60_000)
    proc.stdout.on('data', (chunk) => {
      log += chunk.toString()
      const m = log.match(/\[server\] listening http:\/\/[^:]+:(\d+)/)
      if (m) {
        clearTimeout(timer)
        resolve(Number(m[1]))
      }
    })
    proc.stderr.on('data', (chunk) => {
      log += chunk.toString()
    })
    proc.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`服务提前退出（${code}）：${log.slice(-600)}`))
    })
  })
  return {
    base: `http://127.0.0.1:${port}`,
    log: () => log,
    stop: () => {
      try {
        proc.kill('SIGTERM')
      } catch {
        /* ignore */
      }
    },
  }
}

async function json(url, init) {
  const r = await fetch(url, { credentials: 'include', ...init })
  const body = await r.json().catch(() => ({}))
  return { status: r.status, ...body }
}

const post = (url, body) =>
  json(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

// ---------------------------------------------------------------- 前置数据

fs.mkdirSync(TMP, { recursive: true })
/** 用一个极小的真实 mp4 当源：ffmpeg 可用时生成，否则跳过真实 CLI 层 */
const sampleVideo = path.join(TMP, PROJECT, 'assets', 'sample.mp4')
function makeSampleVideo() {
  fs.mkdirSync(path.dirname(sampleVideo), { recursive: true })
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x568:rate=24:duration=3',
      '-pix_fmt', 'yuv420p', sampleVideo,
    ], { stdio: 'ignore' })
    p.on('error', () => resolve(false))
    p.on('close', (code) => resolve(code === 0 && fs.existsSync(sampleVideo)))
  })
}

// ---------------------------------------------------------------- 主流程

let server
try {
  const projectDir = path.join(TMP, PROJECT)
  fs.mkdirSync(path.join(projectDir, 'assets'), { recursive: true })

  // 先把项目与一镜写进临时库（走真实模块，等价于界面里建项目）
  const { createProject, writeProject } = await import('./server/db.mjs')
  createProject(TMP, PROJECT, { title: 'smoke' })
  writeProject(TMP, PROJECT, {
    shots: [
      {
        id: 'E01-S01',
        episode: 1,
        no: 'S01',
        seconds: 3,
        size: '中景',
        move: '固定',
        desc: '冒烟测试镜',
        keyframe_prompt: '原始画面词',
        dialogue: [],
        cast: [],
      },
    ],
  })

  console.log('=== 起服务 ===')
  if (!NODE) {
    console.log('❌ 找不到 Node ≥ 24.9（服务进程要求）；请装 nvm use 24 或提供 desktop/bin/node')
    process.exit(1)
  }
  console.log(`   Node ${NODE.version} · ${NODE.bin}`)
  server = await startServer()
  check('服务可就绪', (await fetch(`${server.base}/`)).ok, server.base)

  // ---------------- 离线层：路由与空库 ----------------
  console.log('\n=== 离线层：路由 / 空库 / 导入拦截 ===')
  const empty = await json(`${server.base}/api/prompt-cases`)
  check('案例列表可读', empty.ok === true && Array.isArray(empty.cases), `total=${empty.total}`)
  check('facets 随列表返回', Boolean(empty.facets) && typeof empty.facets.total === 'number')

  const sources = await json(`${server.base}/api/prompt-cases/sources`)
  const enabled = (sources.sources || []).filter((s) => s.enabled).map((s) => s.id)
  check('来源清单可读', Array.isArray(sources.sources) && sources.sources.length > 0, `启用：${enabled.join(',') || '无'}`)
  check('只启用 vflow', enabled.length === 1 && enabled[0] === 'vflow', enabled.join(','))
  check('关闭来源带原因', (sources.sources || []).every((s) => s.enabled || s.reason), '')

  const missing = await json(`${server.base}/api/prompt-cases/nope:nope`)
  check('不存在案例返回 404', missing.status === 404, String(missing.status))
  check('404 响应是中文可读原因', /案例不存在/.test(missing.message || ''), missing.message)

  const badImport = await post(`${server.base}/api/prompt-cases/import`, { preview: true, source: 'flatkey' })
  check('未启用来源被拒', badImport.ok === false && /未启用/.test(badImport.message || ''), badImport.message?.slice(0, 40))

  const badToken = await post(`${server.base}/api/prompt-cases/import`, {
    preview: false,
    source: 'vflow',
    token: 'bogus',
    ids: ['x'],
  })
  check('伪造预览令牌被拒', badToken.ok === false && /预览/.test(badToken.message || ''), badToken.message?.slice(0, 40))

  // 作业路由
  const health = await json(`${server.base}/api/prompt-cases/reverse/health?force=1`)
  check('反推健康探针可读', health.ok === true && Boolean(health.health), `ok=${health.health?.ok}`)
  check('档位清单可读', Array.isArray(health.tiers) && health.tiers.length >= 2, (health.tiers || []).map((t) => t.id).join(','))
  const quick = (health.tiers || []).find((t) => t.id === 'quick')
  check('快速档零下载', quick?.downloadMb === 0, String(quick?.downloadMb))
  check(
    '视觉模型候选可读',
    Array.isArray(health.visionModels),
    `${(health.visionModels || []).length} 个${(health.visionModels || []).length ? '' : '（未配置视觉模型时为空）'}`,
  )

  // VLM 中转：必须按请求体里的 model 路由，不能静默回退到默认模型
  // （外部 CLI 只发 model，不发应用内 modelKey）
  const vlmProbe = async (model, withToken = true) => {
    const r = await fetch(`${server.base}/api/prompt-cases/vlm-proxy/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(withToken ? { 'x-studio-internal': INTERNAL_TOKEN } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'reply with exactly: ok' }],
        max_tokens: 2000,
      }),
    })
    return { status: r.status, ...(await r.json().catch(() => ({}))) }
  }
  const visionNames = (health.visionModels || []).map((m) => m.model).filter(Boolean)
  if (OFFLINE_ONLY) {
    note('VLM 中转路由', '--offline')
  } else if (!visionNames.length) {
    note('VLM 中转路由', '未配置视觉模型')
  } else {
    const ok = await vlmProbe(visionNames[0])
    check('中转按 model 路由成功', ok.status === 200 && Boolean(ok.choices), `${visionNames[0]} → ${ok.status}`)
    const bad = await vlmProbe('definitely-not-a-model')
    check('未知模型名被明确拒绝', bad.status === 400 && /找不到模型/.test(bad.message || ''), (bad.message || '').slice(0, 40))
    const noTok = await vlmProbe(visionNames[0], false)
    check('中转拒绝无令牌请求', noTok.status === 403, String(noTok.status))
  }

  const noVideo = await post(`${server.base}/api/prompt-cases/reverse`, {
    project: PROJECT,
    videoUrl: '/project-assets/smoke/missing.mp4',
  })
  check('不存在的源视频被拒', noVideo.ok === false && /不存在|不在项目媒体/.test(noVideo.message || ''), noVideo.message?.slice(0, 40))

  const badProject = await post(`${server.base}/api/prompt-cases/reverse`, {
    project: 'no-such-project',
    videoUrl: '/project-assets/no-such-project/a.mp4',
  })
  check('不存在的项目被拒', badProject.ok === false && /项目不存在/.test(badProject.message || ''), badProject.message?.slice(0, 40))

  // 应用到镜头（服务端侧）
  const { saveCase } = await import('./server/prompt-cases.mjs')
  const seeded = saveCase(TMP, {
    source: 'manual',
    sourceId: 'smoke-case',
    title: '冒烟案例',
    prompt: 'A rainy alley, slow dolly in',
    model: 'seedance-2-5',
  })
  check('手工案例可写入', seeded?.id === 'manual:smoke-case')
  check('手工案例许可为仅参考', seeded?.license === 'reference-only', seeded?.license)

  const listed = await json(`${server.base}/api/prompt-cases?q=dolly`)
  check('关键词命中正文', listed.total === 1, String(listed.total))

  const fav = await json(`${server.base}/api/prompt-cases/${encodeURIComponent(seeded.id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ favorite: true, note: '冒烟备注' }),
  })
  check('收藏与备注可写', fav.case?.favorite === true && fav.case?.note === '冒烟备注')

  // ---------------- 网络层：vflow 真实索引 ----------------
  console.log('\n=== 网络层：vflow 真实索引 ===')
  const ffmpegOk = await makeSampleVideo()
  if (OFFLINE_ONLY) {
    note('vflow 真实预览', '--offline')
  } else {
    const preview = await post(`${server.base}/api/prompt-cases/import`, {
      preview: true,
      source: 'vflow',
      limit: 5,
      model: 'seedance-2-5',
    })
    if (!preview.ok) {
      check('vflow 预览成功', false, preview.message?.slice(0, 80))
    } else {
      check('vflow 预览成功', Array.isArray(preview.items) && preview.items.length > 0, `${preview.items?.length} 条 / 命中 ${preview.total}`)
      check('预览带令牌', typeof preview.token === 'string' && preview.token.length > 10)
      check('预览不落库', (await json(`${server.base}/api/prompt-cases`)).total === 1, `当前 ${(await json(`${server.base}/api/prompt-cases`)).total} 条`)

      // 真导入 3 条
      const ids = (preview.items || []).slice(0, 3).map((i) => i.id)
      const imported = await post(`${server.base}/api/prompt-cases/import`, {
        preview: false,
        source: 'vflow',
        token: preview.token,
        ids,
      })
      check('真实导入成功', imported.ok === true && imported.created === 3, `created=${imported.created} failed=${imported.failed?.length || 0}`)
      check('导入后有提示词正文', (await json(`${server.base}/api/prompt-cases?source=vflow&pageSize=3`)).cases.every((c) => c.prompt.length > 20))

      // 幂等
      const again = await post(`${server.base}/api/prompt-cases/import`, {
        preview: false,
        source: 'vflow',
        token: preview.token,
        ids,
      })
      check('重复导入为更新', again.created === 0 && again.updated === 3, `created=${again.created} updated=${again.updated}`)
    }
  }

  // ---------------- CLI 层：真实 rea-video ----------------
  console.log('\n=== CLI 层：真实 rea-video ===')
  if (OFFLINE_ONLY) {
    note('rea-video 真实拆解', '--offline')
  } else if (!health.health?.ok) {
    note('rea-video 真实拆解', `未安装（${health.health?.reason}）；这是可选依赖，其他功能不受影响`)
  } else if (!ffmpegOk) {
    note('rea-video 真实拆解', 'ffmpeg 不可用，无法生成样例视频')
  } else {
    const job = await post(`${server.base}/api/prompt-cases/reverse`, {
      project: PROJECT,
      videoUrl: `/project-assets/${PROJECT}/sample.mp4`,
      durationSec: 3,
      tier: 'quick',
      title: 'smoke 拆解',
    })
    check('拆解作业可创建', job.ok === true && Boolean(job.job?.id), job.job?.id)

    if (job.ok) {
      const id = job.job.id
      const deadline = Date.now() + 240_000
      let last = null
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000))
        last = await json(`${server.base}/api/prompt-cases/reverse/${id}`)
        const st = last.job?.status
        if (st !== 'running' && st !== 'queued') break
      }
      check('拆解作业完成', last?.job?.status === 'done', `${last?.job?.status} ${last?.job?.error || ''}`)
      check('产物含镜头数', Number(last?.job?.result?.shots) >= 1, `shots=${last?.job?.result?.shots}`)
      check('视觉判定状态透出', typeof last?.job?.result?.vlmStatus === 'string', last?.job?.result?.vlmStatus)

      // 报告预览：必须能拿到可访问的 HTML（Content-Type 必须是 text/html，
      // 否则浏览器把整页当图片处理，界面白屏且标题为空）
      const reportUrl = last?.job?.result?.reportUrl || ''
      check('产物包含报告地址', reportUrl.endsWith('/report.html'), reportUrl.slice(-30))
      if (reportUrl) {
        const rHead = await fetch(`${server.base}${reportUrl}`, { method: 'GET' })
        const ctype = String(rHead.headers.get('content-type') || '')
        check('报告以 text/html 返回', rHead.ok && ctype.includes('text/html'), ctype)
        const html = await rHead.text()
        check('报告不含脚本（沙箱可安全预览）', !/<script/i.test(html), `${html.length} 字节`)
        // 报告引用的同目录资源也要能取到
        const assetOk = await fetch(`${server.base}${reportUrl.replace('report.html', 'storyboard.jpg')}`)
        check('报告资源可访问', assetOk.ok, String(assetOk.status))
      }

      if (last?.job?.status === 'done') {
        const adopted = await post(`${server.base}/api/prompt-cases/reverse/${id}/adopt`, { title: 'smoke 反推案例' })
        check('反推结果可入库', adopted.ok === true && adopted.case?.source === 'reverse-own', adopted.case?.id)
        check('反推案例为自有', adopted.case?.license === 'own', adopted.case?.license)
        const shot = adopted.case?.shots?.[0]
        check('逐镜含制作方式与依据', Boolean(shot?.kind) && Array.isArray(shot?.evidence), `${shot?.kind} / ${shot?.evidence?.length} 条依据`)
        check('逐镜证据帧为站内地址', Array.isArray(shot?.evidenceFrames) && shot.evidenceFrames.every((u) => u.startsWith('/prompt-cases/')), shot?.evidenceFrames?.length + ' 张')
      }
    }
  }

  // ---------------- 浏览器层 ----------------
  if (!OFFLINE_ONLY && process.env.PCL_SMOKE_UI !== '0') {
    console.log('\n=== 浏览器层 ===')
    const ui = spawn(
      process.execPath,
      [path.join(ROOT, 'verify-prompt-cases-ui.mjs'), server.base, PROJECT],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let out = ''
    ui.stdout.on('data', (d) => (out += d))
    ui.stderr.on('data', (d) => (out += d))
    const code = await new Promise((resolve) => ui.on('close', resolve))
    const fails = out.split('\n').filter((l) => l.startsWith('❌'))
    check('浏览器链路', code === 0, fails.length ? fails.slice(0, 2).join(' / ') : '')
    if (code !== 0) console.log(out.split('\n').slice(-14).join('\n'))
  } else {
    note('浏览器链路', OFFLINE_ONLY ? '--offline' : 'PCL_SMOKE_UI=0')
  }
} catch (e) {
  check('冒烟流程未抛错', false, (e?.message || String(e)).slice(0, 300))
} finally {
  server?.stop()
  // 作业目录落临时根，整体删掉即可
  try {
    fs.rmSync(TMP, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

console.log(
  `\n${bad === 0 ? '冒烟通过' : `${bad} 项失败`}${skipped ? ` · ${skipped} 项跳过` : ''}`,
)
process.exit(bad === 0 ? 0 : 1)
