import type { ArcRotateCamera, Engine, Scene } from '@babylonjs/core'

export type BabylonHost = {
  engine: Engine
  scene: Scene
  camera: ArcRotateCamera
  dispose: () => void
}

const HOST_ROOTS = new Set(['__m3d_ground', '__m3d_light'])

export function isHostMeshName(name: string): boolean {
  return HOST_ROOTS.has(name) || name.startsWith('__m3d_')
}

/** 创建 Babylon 视口：Arc 相机、地面与基础灯光 */
export async function createBabylonHost(canvas: HTMLCanvasElement): Promise<BabylonHost> {
  const BABYLON = await import('@babylonjs/core')
  const engine = new BABYLON.Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: true,
    adaptToDeviceRatio: true,
  })
  const scene = new BABYLON.Scene(engine)
  scene.clearColor = new BABYLON.Color4(0.07, 0.09, 0.11, 1)

  const camera = new BABYLON.ArcRotateCamera(
    '__m3d_cam',
    -Math.PI / 2,
    Math.PI / 2.5,
    10,
    new BABYLON.Vector3(0, 1, 0),
    scene,
  )
  camera.attachControl(canvas, true)
  camera.wheelPrecision = 40
  camera.lowerRadiusLimit = 2
  camera.upperRadiusLimit = 40

  new BABYLON.HemisphericLight('__m3d_light_hemi', new BABYLON.Vector3(0.2, 1, 0.2), scene)
  const dir = new BABYLON.DirectionalLight('__m3d_light_sun', new BABYLON.Vector3(-0.5, -1, -0.3), scene)
  dir.intensity = 0.6

  const ground = BABYLON.MeshBuilder.CreateGround(
    '__m3d_ground',
    { width: 24, height: 24, subdivisions: 2 },
    scene,
  )
  const gmat = new BABYLON.StandardMaterial('__m3d_ground_mat', scene)
  gmat.diffuseColor = new BABYLON.Color3(0.14, 0.16, 0.19)
  gmat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05)
  ground.material = gmat
  ground.isPickable = false

  engine.runRenderLoop(() => {
    scene.render()
  })

  const onResize = () => engine.resize()
  window.addEventListener('resize', onResize)

  return {
    engine,
    scene,
    camera,
    dispose: () => {
      window.removeEventListener('resize', onResize)
      engine.stopRenderLoop()
      scene.dispose()
      engine.dispose()
    },
  }
}