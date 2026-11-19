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
import { DEFAULT_EXPERT_PLATFORM_TOOLS, HOST_NATIVE_TOOLS } from '../src/creative/expertToolGroups'

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
const hostNative = new Set(HOST_NATIVE_TOOLS)
const manifests = readManifests()

async function main() {
  await check('仓库里至少有一个内置专家', () => {
    assert.ok(manifests.length > 0, 'experts/ 下没有 manifest.json')
  })

  await check('每个内置专家只声明真实注册的工具', () => {
    for (const m of manifests) {
      const ghost = m.toolIds.filter((t) => (!declared.has(t) || !registered.has(t)) && !hostNative.has(t))
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
      // 出片输入读取：分镜与转场各一个，Agent 写正文靠它们拿有序参考
      'read_shot_video_inputs',
      'read_transition_video_inputs',
      // 转场参考与音色写入：Agent 自己选参考，不再只能由人在画布上点
      'attach_transition_refs',
      'set_transition_audio',
    ]) {
      assert.ok(have.has(name), `全能专家缺 ${name}`)
    }
  })

  /**
   * 新增平台工具后必须给每套专家勾上。
   * 名单以 DEFAULT_EXPERT_PLATFORM_TOOLS 为准；`list_experts` 由运行时无条件注入，不写进 manifest。
   */
  await check('每套内置专家都勾满平台工具（新增工具不许漏勾）', () => {
    for (const m of manifests) {
      const have = new Set(m.toolIds)
      const missing = DEFAULT_EXPERT_PLATFORM_TOOLS.filter((n) => !have.has(n))
      assert.deepEqual(missing, [], `专家「${m.id}」漏勾：${missing.join('、')}`)
    }
  })

  await check('内置专家清单没有重复项', () => {
    for (const m of manifests) {
      assert.equal(new Set(m.toolIds).size, m.toolIds.length, `专家「${m.id}」toolIds 有重复`)
    }
  })

  /**
   * soul 里的「已读可省读」承诺必须与历史能力一致。
   * 专家 soul 由用户自行编辑，一旦写了这句，压缩后模型会凭印象编造早期内容；
   * 统一改由 buildExpertSystem 在压缩状态注入重取提示（见 creative-workspace-context）。
   */
  await check('专家 soul 不自行声明「已读可不再重复读取」', () => {
    const root = path.join(process.cwd(), 'experts')
    if (!fs.existsSync(root)) return
    for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
      const file = path.join(root, ent.name, 'soul.md')
      if (!fs.existsSync(file)) continue
      const soul = fs.readFileSync(file, 'utf8')
      assert.doesNotMatch(
        soul,
        /可不再重复读取|已读.*(无需|不必).*重复/,
        `专家「${ent.name}」soul 声明了省读能力；请改用「需要时重取」`,
      )
    }
  })

  console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 专家清单一致性全部通过')
  process.exit(bad ? 1 : 0)
}

void main()
