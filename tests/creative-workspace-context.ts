import assert from 'node:assert/strict'
import {
  formatCreativeWorkspaceContext,
  buildCreativePiSystem,
  buildExpertSystem,
  creativeWorkspaceNeedsShotEpisode,
} from '../src/creative/creativeTurnPayload'
import type { CreativeExpert } from '../src/creative/expertTypes'

assert.match(
  buildCreativePiSystem(null, { projectName: 'demo', epNo: 2 }),
  /【当前上下文】[\s\S]*项目：demo[\s\S]*分镜默认集号：第 2 集/,
)

assert.match(
  formatCreativeWorkspaceContext({ projectName: 'p' }, { includeShotEpisode: false }),
  /项目：p[\s\S]*项目级/,
)
assert.doesNotMatch(formatCreativeWorkspaceContext({ projectName: 'p' }, { includeShotEpisode: false }), /分镜默认集号/)

const characterExpert: CreativeExpert = {
  id: 'expert-character',
  name: '角色设定',
  description: '',
  soul: '你是 {{expertName}} · {{projectName}}',
  skillIds: [],
  toolIds: ['read_characters', 'submit_characters'],
  source: 'builtin',
}

assert.equal(creativeWorkspaceNeedsShotEpisode(characterExpert), false)
assert.match(
  buildExpertSystem(characterExpert, { projectName: 'p', epNo: 3 }),
  /角色与素材为项目级/,
)
assert.doesNotMatch(buildExpertSystem(characterExpert, { projectName: 'p', epNo: 3 }), /分镜默认集号/)

const storyboardExpert: CreativeExpert = {
  id: 'expert-storyboard',
  name: '分镜教练',
  description: '',
  soul: 'coach',
  skillIds: [],
  toolIds: ['read_shots', 'submit_shots'],
  source: 'builtin',
}

assert.equal(creativeWorkspaceNeedsShotEpisode(storyboardExpert), true)

assert.doesNotMatch(formatCreativeWorkspaceContext({}), /项目：demo/)

console.log('creative-workspace-context: ok')