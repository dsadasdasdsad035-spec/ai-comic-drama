import type { DesignSheet } from '../api'
import { material3dObjectLabel } from './objectDisplayName'
import type { Material3dScene } from './material3dTypes'

export function buildStoryboardMarkdown(scene: Material3dScene, designs: DesignSheet[]): string {
  const lines: string[] = [
    `# 分镜参考 · ${scene.name}`,
    '',
    `更新：${scene.updatedAt}`,
    '',
    '## 机位',
  ]
  if (!scene.cameras.length) {
    lines.push('- （无机位书签）')
  } else {
    for (const c of scene.cameras) {
      lines.push(
        `- **${c.label}**：α=${c.alpha.toFixed(3)} β=${c.beta.toFixed(3)} r=${c.radius.toFixed(2)} 目标=(${c.target.x.toFixed(2)}, ${c.target.y.toFixed(2)}, ${c.target.z.toFixed(2)})`,
      )
    }
  }
  lines.push('', '## 对象')
  if (!scene.objects.length) {
    lines.push('- （无对象）')
  } else {
    for (const o of scene.objects) {
      const title = material3dObjectLabel(o, designs)
      const p = o.transform.position
      lines.push(
        `- ${title} · pos(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})${o.locked ? ' [锁定]' : ''}`,
      )
    }
  }
  return `${lines.join('\n')}\n`
}

export function buildStoryboardJson(scene: Material3dScene, designs: DesignSheet[]) {
  return {
    schemaVersion: 1,
    purpose: 'storyboard-reference',
    sceneName: scene.name,
    sceneId: scene.id,
    updatedAt: scene.updatedAt,
    cameras: scene.cameras,
    objectsSummary: scene.objects.map((o) => ({
      id: o.id,
      kind: o.kind,
      label: material3dObjectLabel(o, designs),
      locked: Boolean(o.locked),
      transform: o.transform,
      ...(o.kind === 'gltf' ? { assetUrl: o.assetUrl } : { designId: o.designId }),
    })),
    designRefs: scene.designRefs,
  }
}

export function downloadStoryboardJson(scene: Material3dScene, designs: DesignSheet[]) {
  const body = JSON.stringify(buildStoryboardJson(scene, designs), null, 2)
  const blob = new Blob([body], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const safe = scene.name.replace(/[^\w\u4e00-\u9fa5-]+/g, '_').slice(0, 40) || 'scene'
  a.href = url
  a.download = `${safe}-storyboard.json`
  a.click()
  URL.revokeObjectURL(url)
}