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
import { stringify as stringifyYaml } from 'yaml'
import { listAllExperts } from './experts.mjs'
import { listSkillFiles, resolveSkillDir } from './skills.mjs'

/** 预设 id 前缀：与专家 id 一一对应，会话保存的就是这个值 */
export const EXPERT_PRESET_PREFIX = 'expert-'
/** 始终可用的工具：列举专家、以及技能发现入口都必须在任何专家下可用 */
export const ALWAYS_ON_TOOLS = ['list_experts', 'list_installed_skills']
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

/**
 * 为某专家生成 per-expert 技能根。
 *
 * 为什么用目录而不是拦截读工具：宿主自己的技能发现也要按根扫，
 * 只拦读工具会让「模型在候选列表里看得见却读不到」，反而误导。
 * 白名单外的技能根本不出现在根里，模型自然发现不到。
 */
export function syncExpertSkillRoot({ dshHome, expert, root, log = () => {} }) {
  const expertId = String(expert.id || '')
  if (!expertId) throw new Error('专家缺少 id')
  const base = path.join(dshHome, 'experts', expertId, 'skills')
  fs.rmSync(base, { recursive: true, force: true })
  fs.mkdirSync(base, { recursive: true })

  const available = listSkillFiles(root).skills.map((s) => s.id)
  const whitelist = resolveSkillWhitelist(expert.skillIds, available)
  let linked = 0
  for (const id of whitelist.ids) {
    const found = resolveSkillDir(root, id)
    if (!found) continue
    const dest = path.join(base, id)
    try {
      // 软链而不是复制：技能是可热改的，复制会让改完的 SKILL.md 读不到
      fs.symlinkSync(found.dir, dest, 'dir')
      linked += 1
    } catch (e) {
      // 不支持软链（或已存在）时退化成复制，功能可用但不热更
      try {
        fs.cpSync(found.dir, dest, { recursive: true })
        linked += 1
      } catch (e2) {
        log(`[studio-experts] 技能 ${id} 挂载失败：${e2?.message || String(e2)}`)
      }
    }
  }
  return { dir: base, wildcard: whitelist.wildcard, ids: whitelist.ids, linked }
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
      config: { prefix: String(expert.soul || ''), complete: true },
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
        ...(Array.isArray(skillIds) && !skillIds.includes('*') ? { skillIds } : {}),
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
 * 权威来源仍是应用设置，这里只是派生镜像，每次全量重写。
 */
export function mirrorExpertSources({ dshHome, experts, log = () => {} }) {
  // 放 compiled/ 子目录而不是 experts/<id>/：后者是自定义专家的权威目录，
  // 快照写进去会覆盖用户正在编辑的 manifest。
  const base = path.join(dshHome, 'experts', 'compiled')
  const keep = new Set()
  for (const expert of experts) {
    const id = String(expert.id || '')
    if (!id) continue
    keep.add(id)
    const dir = path.join(base, id)
    fs.mkdirSync(dir, { recursive: true })
    const manifest = {
      id,
      name: String(expert.name || id),
      description: String(expert.description || ''),
      skillIds: Array.isArray(expert.skillIds) ? expert.skillIds : [],
      toolIds: Array.isArray(expert.toolIds) ? expert.toolIds : [],
    }
    const manifestPath = path.join(dir, 'manifest.json')
    const soulPath = path.join(dir, 'soul.md')
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`
    const soulText = String(expert.soul || '')
    if (!fs.existsSync(manifestPath) || fs.readFileSync(manifestPath, 'utf8') !== manifestText) {
      fs.writeFileSync(manifestPath, manifestText, 'utf8')
    }
    if (!fs.existsSync(soulPath) || fs.readFileSync(soulPath, 'utf8') !== soulText) {
      fs.writeFileSync(soulPath, soulText, 'utf8')
    }
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
  return { dir: base, count: keep.size }
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
      const rootInfo = syncExpertSkillRoot({ dshHome, expert, root, log })
      const whitelist = resolveSkillWhitelist(expert.skillIds, available)
      const preset = compileExpertPreset({
        expert,
        registeredNames,
        skillRoot: rootInfo.dir,
        skillIds: whitelist.wildcard ? ['*'] : whitelist.ids,
      })
      compiled.push({
        id: expert.id,
        presetId: preset.id,
        name: preset.name,
        tools: resolveToolSubset(expert.toolIds, registeredNames).length,
        skills: whitelist.ids.length,
        wildcard: whitelist.wildcard,
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
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const body = rows.length ? stringifyYaml([{ insert: rows }]) : '# 当前没有可用专家\n[]\n'
  fs.writeFileSync(file, body, 'utf8')
  fs.writeFileSync(path.join(path.dirname(file), 'creative-experts.json'), `${JSON.stringify(compiled, null, 2)}\n`, 'utf8')
  log(`[studio-experts] 已生成 ${rows.length} 个专家 preset：${file}`)
  return { file, compiled }
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
