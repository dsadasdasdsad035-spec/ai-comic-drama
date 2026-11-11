/**
 * 出片改稿：线程键与 adapter 契约
 * 跑法：node verify-video-prompt-refine.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-vp-refine-'))
const entry = path.join(tmp, 'entry.ts')
const abs = (p) => JSON.stringify(path.join(root, p))
fs.writeFileSync(
  entry,
  [
    `export * from ${abs('src/agent/promptRefineAdapter.ts')}`,
    `export * from ${abs('src/agent/promptRenderDraft.ts')}`,
    `export * from ${abs('src/promptRenderSkill.ts')}`,
    `export { parseSkillText } from ${abs('src/skills/parse.ts')}`,
    `import seedanceRefine from ${JSON.stringify(path.join(root, 'skills/seedance-prompt-refine/SKILL.md'))}`,
    `export const REFINE_MD = seedanceRefine`,
  ].join('\n') + '\n',
)
const bundle = path.join(tmp, 'bundle.mjs')
execFileSync(path.join(root, 'node_modules', '.bin', 'esbuild'), [
  entry,
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--loader:.md=text',
  `--outfile=${bundle}`,
])

const lib = await import(bundle)

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const skill = lib.parseSkillText('seedance-prompt-refine', lib.REFINE_MD, 'builtin')
check('refine 技能可解析', skill.id === 'seedance-prompt-refine')
check('refine 含 read_prompt_render_bundle', skill.manifest.tools.includes('read_prompt_render_bundle'))

const adapter = lib.createShotPromptRefineAdapter({
  projectName: 'p1',
  episode: 1,
  shotNo: 'S01',
  shotNodeId: 'n1',
  style: '赛博',
  aspect: '16:9',
  bundle: () => ({ kind: 'shot', schemaVersion: 1 }),
  getSnapshot: () => ({ name: 'p1', shots: [] }),
  setSnapshot: () => {},
  onShotPatched: () => {},
})
check('线程 surface 含 prompt-refine', adapter.threadKey.surface === 'prompt-refine-shot')
check('线程 shotId', adapter.threadKey.shotId === 'n1')
check('门禁镜号', adapter.promptRenderGate?.shotNo === 'S01')

const d1 = lib.computePromptTemplateDigest(skill)
const d2 = lib.computePromptTemplateDigest({ ...skill, task: skill.task + ' ' })
check('任务模板变则 digest 变', d1 !== d2)

const merged = lib.mergePromptRenderDraft(
  [{ id: 'n1', no: 'S01', episode: 1 }],
  [
    {
      no: 'S01',
      video_prompt_rendered: '改后九段',
      video_prompt_render_meta: { fingerprint: 'fp', templateVersion: 't1', renderedAt: '' },
    },
  ],
  1,
)
check('单镜写回 merge', merged.patched === 1 && merged.shots[0].video_prompt_rendered === '改后九段')

if (bad) process.exit(1)
console.log('\n全部通过')
