/**
 * 内置专家清单与平台工具清单的一致性验收。
 *
 * 专家能用的工具严格等于 manifest 的 toolIds——平台新增工具后如果忘了挂到 manifest，
 * 界面上「全能专家」就是缺功能的，而这种漂移不会报错、只会静默少能力。
 * 所以这里把仓库里的 experts/<id>/manifest.json 全部对一遍。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  builtinPlatformToolNames,
  createBuiltinPlatformTools,
} from '../src/agent/builtinPlatformTools'
import { DEFAULT_EXPERT_PLATFORM_TOOLS } from '../src/creative/expertToolGroups'

let bad = 0
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`✅ ${name}`)
    })
    .catch((e) => {
      bad++
      console.log(`❌ ${name}\n   ${(e as Error).message}`)
    })
}

type Manifest = { id: string; toolIds?: string[] }

function readManifests(): Array<{ id: string; toolIds: string[] }> {
  const root = path.join(process.cwd(), 'experts')
  if (!fs.existsSync(root)) return []
  const out: Array<{ id: string; toolIds: string[] }> = []
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue
    const file = path.join(root, ent.name, 'manifest.json')
    if (!fs.existsSync(file)) continue
    const m = JSON.parse(fs.readFileSync(file, 'utf8')) as Manifest
    out.push({ id: String(m.id || ent.name), toolIds: Array.isArray(m.toolIds) ? m.toolIds.map(String) : [] })
  }
  return out
}

const declared = new Set(builtinPlatformToolNames())
const registered = new Set(createBuiltinPlatformTools({ projectName: '', epNo: 1 }).map((t) => t.name))
const manifests = readManifests()

async function main() {
  await check('仓库里至少有一个内置专家', () => {
    assert.ok(manifests.length > 0, 'experts/ 下没有 manifest.json')
  })

  await check('每个内置专家只声明真实注册的工具', () => {
    for (const m of manifests) {
      const ghost = m.toolIds.filter((t) => !declared.has(t) || !registered.has(t))
      assert.deepEqual(ghost, [], `专家「${m.id}」声明了不存在的工具：${ghost.join('、')}`)
    }
  })

  await check('全能专家挂满默认平台工具集', () => {
    const omni = manifests.find((m) => m.id === 'expert-omni')
    assert.ok(omni, '找不到 expert-omni')
    const have = new Set(omni!.toolIds)
    const missing = DEFAULT_EXPERT_PLATFORM_TOOLS.filter((n) => !have.has(n))
    assert.deepEqual(missing, [], `全能专家缺工具：${missing.join('、')}`)
  })

  await check('批次新增工具已挂到全能专家', () => {
    const omni = manifests.find((m) => m.id === 'expert-omni')
    const have = new Set(omni?.toolIds ?? [])
    for (const name of [
      'submit_episodes',
      'create_project',
      'update_project_meta',
      'delete_shots',
      'generate_keyframe',
      'generate_clip',
      'generate_voice',
      'read_shot_detail',
      'read_shot_video_prompt',
    ]) {
      assert.ok(have.has(name), `全能专家缺 ${name}`)
    }
  })

  await check('三个内置专家的工具集一致（避免用户看不出差别的漂移）', () => {
    const sets = manifests.map((m) => ({ id: m.id, key: [...m.toolIds].sort().join(',') }))
    const first = sets[0]
    for (const s of sets.slice(1)) {
      assert.equal(s.key, first?.key, `专家「${s.id}」与「${first?.id}」工具集不同`)
    }
  })

  await check('内置专家清单没有重复项', () => {
    for (const m of manifests) {
      assert.equal(new Set(m.toolIds).size, m.toolIds.length, `专家「${m.id}」toolIds 有重复`)
    }
  })

  console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 专家清单一致性全部通过')
  process.exit(bad ? 1 : 0)
}

void main()
