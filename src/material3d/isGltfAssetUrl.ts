/** 场景三维可加载的 glTF URL：项目资产或 CC0 道具缓存 */
export function isGltfAssetUrl(url: string): boolean {
  const u = url.split('?')[0]
  const lower = u.toLowerCase()
  if (!lower.endsWith('.glb') && !lower.endsWith('.gltf')) return false
  if (lower.startsWith('/cc0-props/')) return true
  if (lower.startsWith('/itch-props/')) return true
  return u.startsWith('/project-assets/')
}