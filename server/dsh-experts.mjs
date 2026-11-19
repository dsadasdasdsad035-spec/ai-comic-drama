/**
 * 专家 → dsh preset 编译器。
 *
 * 专家的唯一来源仍是 `experts/<id>/manifest.json` + `soul.md`（自定义专家存在设置里）。
 * 这里把它们翻译成宿主能读的三样东西：
 * 1. **preset 行**：一行 `@deepseek-ai/dsh-agent-preset`，子插件列表决定该会话能用什么；
 * 2. **persona 行**：`soul` 原文作为该会话的完整系统提示词（`complete: true`），
 *    不拼接默认模式的通用说明 —— 否则「预览的 system」和「实际跑的 system」会不一致；
 * 3. **专家闸门插件 + 技能根**：只有 `toolIds` 里的工具可见，技能读不到白名单外的 id。
 *
 * 落盘方式：宿主 profile 的用户层 patch 只能覆盖已有行，新增 preset 必须是
 * `insert` 补丁。所以这里生成一份独立 patch 文件，由宿主以 `--patch` 叠加
 * （见 server/creative-host.mjs 的 buildArgs）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { stringify as stringifyYaml } from 'yaml'
import { listAllExperts } from './experts.mjs'
import { listSkillFiles, resolveSkillDir } from './skills.mjs'

/** 预设 id 前缀：与专家 id 一一对应，会话保存的就是这个值 */
export const EXPERT_PRESET_PREFIX = 'expert-'
/**
 * 始终可用的工具：只有列举专家。
 *
 * `list_installed_skills` 不在这里：它由专家自己在工具白名单里勾选。
 * 强制注入会让「专家没勾技能目录」变成一句空话，也会让模型列出
 * 白名单外、读时会被闸门拒绝的技能。技能读工具（read_skill*）不靠这里，
 * 它们本来就只能通过 `toolIds` 勾选进入可见集。
 */
export const ALWAYS_ON_TOOLS = ['list_experts']
/** 技能读工具：勾选归入「技能」组，不列为可单独勾选的外部工具 */
export const SKILL_READ_TOOLS = ['read_skill', 'read_skill_text', 'read_skill_file', 'list_installed_skills']

export function presetIdForExpert(expertId) {
  return `${EXPERT_PRESET_PREFIX}${String(expertId || '').trim()}`
}

/** 反向解析：拿 preset id 找回专家 id（会话列表据此显示专家名） */
export function expertIdFromPreset(presetId) {
  const v = String(presetId || '').trim()
  return v.startsWith(EXPERT_PRESET_PREFIX) ? v.slice(EXPERT_PRESET_PREFIX.length) : ''
}

/**
 * 专家的内容指纹。
 *
 * 只覆盖会影响宿主行为的六个字段，并且对白名单排序：
 * - 不能只拼个数——改 `soul`、或用同数量的工具/技能替换，个数都不变，
 *   而宿主会继续跑旧 persona，表现为「界面改了、会话里没改」；
 * - 不整体 `JSON.stringify(expert)`——`iconUrl`、`imageDescription`、`source`
 *   这些字段不影响 preset，算进去会造成无意义的重启。
 *
 * 落在这里而不是调用方：指纹必须和「真正写进 patch 的内容」同源，
 * 两处各算一份迟早漂移。
 */
export function expertFingerprint(expert) {
  const toolIds = Array.isArray(expert?.toolIds) ? expert.toolIds.map(String).sort() : []
  const skillIds = Array.isArray(expert?.skillIds) ? expert.skillIds.map(String).sort() : []
  const payload = JSON.stringify({
    id: String(expert?.id || ''),
    name: String(expert?.name || ''),
    description: String(expert?.description || ''),
    soul: String(expert?.soul || ''),
    toolIds,
    skillIds,
  })
  return createHash('sha256').update(payload).digest('hex').slice(0, 16)
}

/**
 * 技能白名单 → 实际技能 id 列表。
 * `["*"]` 表示「技能根内全部技能」：不逐个挂载，直接指向共享根。
 */
export function resolveSkillWhitelist(skillIds, availableIds) {
  const list = Array.isArray(skillIds) ? skillIds.map((s) => String(s).trim()).filter(Boolean) : []
  if (list.includes('*')) return { wildcard: true, ids: [...availableIds].sort() }
  const known = new Set(availableIds)
  return { wildcard: false, ids: [...new Set(list)].filter((id) => known.has(id)).sort() }
}

/** 工具子集：`toolIds` ∩ 运行时真实存在的工具，再加始终可用的那几个 */
export function resolveToolSubset(toolIds, registeredNames) {
  const registered = new Set(registeredNames)
  const list = Array.isArray(toolIds) ? toolIds.map((t) => String(t).trim()).filter(Boolean) : []
  const out = new Set()
  for (const name of list) if (registered.has(name)) out.add(name)
  for (const name of ALWAYS_ON_TOOLS) if (registered.has(name)) out.add(name)
  for (const name of SKILL_READ_TOOLS) if (list.includes(name) && registered.has(name)) out.add(name)
  return [...out].sort()
}

/** 专家 id → 技能白名单（与 syncExpertSkillRoot / preset 闸门同源） */
export function resolveExpertSkillAllowlist(expertId, root) {
  const id = String(expertId || '').trim()
  if (!id) return { wildcard: false, ids: [] }
  const expert = listAllExperts().find((e) => e.id === id)
  if (!expert) return { wildcard: false, ids: [] }
  const available = listSkillFiles(root).skills.map((s) => s.id)
  return resolveSkillWhitelist(expert.skillIds, available)
}

/** 专家 id → 允许调用的工具名集合；无专家或未知专家返回 null（不限制） */
export function resolveExpertToolNames(expertId, registeredNames) {
  const id = String(expertId || '').trim()
  if (!id) return null
  const expert = listAllExperts().find((e) => e.id === id)
  if (!expert) return null
  return new Set(resolveToolSubset(expert.toolIds, registeredNames))
}

/**
 * 为某专家生成 per-expert 技能根。
 *
 * 为什么用目录而不是拦截读工具：宿主自己的技能发现也要按根扫，
 * 只拦读工具会让「模型在候选列表里看得见却读不到」，反而误导。
 * 白名单外的技能根本不出现在根里，模型自然发现不到。
 *
 * 为什么增量而不是删掉重建：宿主的文件监听盯着这个根，整棵子树消失再出现
 * 会让监听器看到一次大批量事件，且窗口期内技能全部不可见。这里只补缺、
 * 只删多余，新增项先建到临时名再原子 rename——监听器最多看到一次「出现」。
 */
export function syncExpertSkillRoot({ dshHome, expert, root, log = () => {}, available: availableIds }) {
  const expertId = String(expert.id || '')
  if (!expertId) throw new Error('专家缺少 id')
  const base = path.join(dshHome, 'experts', expertId, 'skills')

  // 技能清单由调用方给：一次进创意会为每个专家各同步一次，
  // 每次重新扫技能根等于把「读全部 SKILL.md + 附件」重复几十遍。
  const available = availableIds || listSkillFiles(root).skills.map((s) => s.id)
  const whitelist = resolveSkillWhitelist(expert.skillIds, available)

  /** 白名单内、且磁盘上真的存在的技能 → 真实目录 */
  const desired = new Map()
  for (const id of whitelist.ids) {
    const found = resolveSkillDir(root, id)
    if (found) desired.set(id, found.dir)
  }

  // 先删多余的：白名单收窄或技能被卸载时，根里不能留着读不到/不该看到的条目
  let removed = 0
  /** 一次列举拿全，后续判定都用集合查（旧实现每项各查一次） */
  const existing = new Set()
  try {
    for (const name of fs.readdirSync(base)) existing.add(name)
  } catch {
    /* 根还没建：没有多余条目可删 */
  }
  for (const name of existing) {
    if (desired.has(name)) continue
    // 临时目录残留也一并清掉，避免 rename 中途崩溃后留下垃圾
    fs.rmSync(path.join(base, name), { recursive: true, force: true })
    existing.delete(name)
    removed += 1
  }

  // 再补缺失的
  let linked = 0
  for (const [id, dir] of desired) {
    if (existing.has(id)) continue
    // 只在真的要挂载时才建根：无差异调用连一次 mkdir 都不产生
    fs.mkdirSync(base, { recursive: true })
    const dest = path.join(base, id)
    const tmp = path.join(base, `.${id}.tmp`)
    fs.rmSync(tmp, { recursive: true, force: true })
    try {
      // 软链而不是复制：技能是可热改的，复制会让改完的 SKILL.md 读不到
      fs.symlinkSync(dir, tmp, 'dir')
    } catch {
      // 不支持软链的平台退化成复制，功能可用但不热更
      try {
        fs.cpSync(dir, tmp, { recursive: true })
      } catch (e2) {
        log(`[studio-experts] 技能 ${id} 挂载失败：${e2?.message || String(e2)}`)
        fs.rmSync(tmp, { recursive: true, force: true })
        continue
      }
    }
    try {
      // 同文件系统内 rename 是原子的：监听器看不到半成品
      fs.renameSync(tmp, dest)
      linked += 1
    } catch (e) {
      log(`[studio-experts] 技能 ${id} 落位失败：${e?.message || String(e)}`)
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  }

  return { dir: base, wildcard: whitelist.wildcard, ids: whitelist.ids, linked, removed }
}

/** 旧版 soul 占位符 → 编译进 DSH 时的静态文案（DSH 只接受小写 snake_case 的 `{{var}}`，且须注册变量） */
function formatSkillIdsForSoul(skillIds) {
  const list = Array.isArray(skillIds) ? skillIds.map(String).filter(Boolean) : []
  if (list.includes('*')) return '全部已安装技能（*）'
  if (list.length === 0) return '（无）'
  return list.join('、')
}

/**
 * 去掉 soul 中的 `{{…}}` 占位符，避免 dsh-system-prompt 在 `deployment:persona-prefix` 渲染失败。
 * 自定义专家若仍保留旧模板，也会在编译 preset 时生效。
 */
export function materializeExpertSoul(expert) {
  const row = expert && typeof expert === 'object' ? expert : {}
  let soul = String(row.soul || '')
  const replacements = [
    ['{{expertName}}', String(row.name || row.id || '创意专家')],
    ['{{expertId}}', String(row.id || '')],
    ['{{projectName}}', '当前项目'],
    ['{{epNo}}', '当前集'],
    ['{{skillIds}}', formatSkillIdsForSoul(row.skillIds)],
  ]
  for (const [token, value] of replacements) soul = soul.split(token).join(value)
  return soul.replace(/\{\{[^{}]*\}\}/g, '')
}

/**
 * 编译单个专家 → preset 插件行。
 * persona 用 `complete: true`：专家的 soul 就是完整 system，
 * 不叠加默认模式说明（验收要求「预览一致」）。
 */
export function compileExpertPreset({ expert, registeredNames, skillRoot, skillIds }) {
  const expertId = String(expert.id || '')
  if (!expertId) throw new Error('专家缺少 id')
  const tools = resolveToolSubset(expert.toolIds, registeredNames)
  const plugins = [
    {
      name: '@deepseek-ai/dsh-persona',
      config: { prefix: materializeExpertSoul(expert), complete: true },
    },
    // 时间与压缩是会话能长期用下去的前提：不挂这两行，长对话不会自动压缩，
    // 模型也不知道「今天」是哪天。技能读工具由工具桥提供，因此不挂 dsh-tool-skill。
    { name: '@deepseek-ai/dsh-time-context' },
    {
      name: 'cordis:group',
      group: true,
      isolate: { compaction: true, toolResultPruner: true },
      config: [
        { name: '@deepseek-ai/dsh-compaction-basic' },
        { name: '@deepseek-ai/dsh-compaction-tool-result-pruner' },
      ],
    },
    {
      // 本应用自己的闸门：限制工具可见性并兜住技能 id 白名单
      name: 'dsh-plugin-creative-expert',
      config: {
        expertId,
        toolIds: tools,
        // 通配 * 在编译时已展开为 ids，闸门始终按列表校验（与工具桥同源）
        ...(Array.isArray(skillIds) && skillIds.length ? { skillIds: skillIds.map(String) } : {}),
      },
    },
  ]
  if (skillRoot) {
    plugins.push({
      name: '@deepseek-ai/dsh-skill-filesystem',
      config: {
        providerName: `expert-${expertId}`,
        // 只挂这个专家的根：默认根会把白名单外的技能也扫出来
        includeDefaultRoots: false,
        customSkillDirs: [skillRoot],
        watch: true,
        watchUsePolling: false,
        // 不要显式关掉 followSymlinks：技能根里的条目是软链，
        // 关了它技能增删与正文热更会同时失效（详见 docs/creative-host.md 的热更新边界）
      },
    })
  }
  return {
    id: presetIdForExpert(expertId),
    name: String(expert.name || expertId),
    description: String(expert.description || ''),
    plugins,
  }
}

/**
 * 把专家定义镜像到宿主配置目录（`<dshHome>/experts/<id>/`）。
 *
 * 为什么镜像：宿主侧排障、导出、人工检查都要能在配置目录里看到「这个 preset 是谁」，
 * 只留一份编译产物（preset 行）等于把专家的可读来源丢了。
 * 权威来源仍是应用设置，这里只是派生镜像：内容等价时不写盘，
 * 让「每次请求都同步一遍」退化成几十次只读（见 studio-entry-latency）。
 */
export function mirrorExpertSources({ dshHome, experts, log = () => {} }) {
  // 放 compiled/ 子目录而不是 experts/<id>/：后者是自定义专家的权威目录，
  // 快照写进去会覆盖用户正在编辑的 manifest。
  const base = path.join(dshHome, 'experts', 'compiled')
  const keep = new Set()
  let written = 0
  for (const expert of experts) {
    const id = String(expert.id || '')
    if (!id) continue
    keep.add(id)
    const dir = path.join(base, id)
    const manifest = {
      id,
      name: String(expert.name || id),
      description: String(expert.description || ''),
      skillIds: Array.isArray(expert.skillIds) ? expert.skillIds : [],
      toolIds: Array.isArray(expert.toolIds) ? expert.toolIds : [],
    }
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`
    const soulText = String(expert.soul || '')
    // 先比较再决定是否建目录：内容全等时连 mkdir 都不做
    const manifestPath = path.join(dir, 'manifest.json')
    const soulPath = path.join(dir, 'soul.md')
    const manifestSame = readIfExists(manifestPath) === manifestText
    const soulSame = readIfExists(soulPath) === soulText
    if (manifestSame && soulSame) continue
    fs.mkdirSync(dir, { recursive: true })
    if (!manifestSame) written += writeIfChanged(manifestPath, manifestText)
    if (!soulSame) written += writeIfChanged(soulPath, soulText)
  }
  // 删掉已经不存在的专家目录，但不要碰技能根以外的内容
  let entries = []
  try {
    entries = fs.readdirSync(base, { withFileTypes: true })
  } catch {
    entries = []
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || keep.has(entry.name)) continue
    // 只清理由本函数管理的两个文件所在目录
    const dir = path.join(base, entry.name)
    if (fs.existsSync(path.join(dir, 'manifest.json')) || fs.existsSync(path.join(dir, 'soul.md'))) {
      fs.rmSync(dir, { recursive: true, force: true })
      log(`[studio-experts] 已清理过期专家目录：${entry.name}`)
    }
  }
  return { dir: base, count: keep.size, written }
}

/** 文件读取，不存在时返回 null（用于「内容是否等价」判断，不抛错） */
function readIfExists(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

/** 专家 patch 文件位置：放在 profile 目录旁，便于排查 */
export function expertsPatchPath(dshHome) {
  return path.join(dshHome, 'profiles', 'web', 'creative-experts.patch.yml')
}

/**
 * 生成宿主可叠加的 patch：把全部专家写成 preset 行。
 *
 * 每次全量重写（而不是增量改）：专家集合是小的、可重建的派生数据，
 * 增量改会留下已删除专家的残留 preset。
 */
export function writeExpertsPatch({ dshHome, root, registeredNames, log = () => {} }) {
  const experts = listAllExperts()
  const rows = []
  const compiled = []
  const available = listSkillFiles(root).skills.map((s) => s.id)
  // 先在宿主配置目录留一份可读来源，再写 preset 派生数据
  mirrorExpertSources({ dshHome, experts, log })

  for (const expert of experts) {
    try {
      const rootInfo = syncExpertSkillRoot({ dshHome, expert, root, log, available })
      const whitelist = resolveSkillWhitelist(expert.skillIds, available)
      const preset = compileExpertPreset({
        expert,
        registeredNames,
        skillRoot: rootInfo.dir,
        skillIds: whitelist.ids,
      })
      compiled.push({
        id: expert.id,
        presetId: preset.id,
        name: preset.name,
        tools: resolveToolSubset(expert.toolIds, registeredNames).length,
        skills: whitelist.ids.length,
        wildcard: whitelist.wildcard,
        // 内容指纹：调用方用它判断「这次编译结果和上一次是否等价」，
        // 计数逐项保留是为了排障时能一眼看到专家规模
        fingerprint: expertFingerprint(expert),
      })
      rows.push({
        id: `preset-${preset.id}`,
        name: '@deepseek-ai/dsh-agent-preset',
        config: {
          id: preset.id,
          name: preset.name,
          ...(preset.description ? { description: preset.description } : {}),
          plugins: preset.plugins,
        },
      })
    } catch (e) {
      log(`[studio-experts] 专家 ${expert.id} 编译失败：${e?.message || String(e)}`)
    }
  }

  const file = expertsPatchPath(dshHome)
  const jsonFile = path.join(path.dirname(file), 'creative-experts.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const body = rows.length ? stringifyYaml([{ insert: rows }]) : '# 当前没有可用专家\n[]\n'
  const json = `${JSON.stringify(compiled, null, 2)}\n`
  // 幂等落盘：内容没变就不动文件。
  // 入口每次请求曾无条件重写这两个文件，一次进创意能写几十遍；
  // 除了白花的 IO，还会让宿主的文件监听反复触发，把「配置没变」误当「配置变了」。
  const written = writeIfChanged(file, body) | writeIfChanged(jsonFile, json)
  // 整批签名：专家增删、改名、改 soul、换白名单都会改变它。
  // 只拼「谁存在」不够——那正是旧实现漏掉 soul 改动的原因。
  const signature = compiled
    .map((row) => `${row.id}@${row.fingerprint}`)
    .sort()
    .join(',')
  if (written) {
    log(`[studio-experts] 已生成 ${rows.length} 个专家 preset：${file}`)
  }
  return { file, compiled, signature, written: Boolean(written) }
}

/**
 * 内容等价时不写盘。
 *
 * 返回 1 表示真的写了、0 表示跳过——用位或合并两个文件的判定，
 * 避免为了「要不要打日志」再多一次分支。
 */
function writeIfChanged(file, next) {
  try {
    if (fs.readFileSync(file, 'utf8') === next) return 0
  } catch {
    /* 文件不存在或不可读：当作需要写入 */
  }
  fs.writeFileSync(file, next, 'utf8')
  return 1
}

/** 读回编译结果：排障与「会话列表显示专家名」都用它，不必再扫配置 */
export function readCompiledExperts(dshHome) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dshHome, 'profiles', 'web', 'creative-experts.json'), 'utf8'))
  } catch {
    return []
  }
}

/** preset id → 专家显示名；找不到时回空串（会话列表据此决定要不要标注） */
export function expertNameForPreset(dshHome, presetId) {
  const expertId = expertIdFromPreset(presetId)
  if (!expertId) return ''
  const row = readCompiledExperts(dshHome).find((e) => e.id === expertId)
  return row?.name || ''
}
