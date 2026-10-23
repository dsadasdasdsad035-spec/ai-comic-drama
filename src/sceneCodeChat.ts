import { runSceneCodeJob, type SceneCodeChatMessage, type SceneCodeJobInput, type SceneCodeJobResult } from './sceneCodeJob'

export type SceneCodeChatInput = Omit<SceneCodeJobInput, 'mode' | 'message' | 'history' | 'currentCode'> & {
  currentCode: string
  message: string
  history?: SceneCodeChatMessage[]
}

/** 聊天改写：只改当前镜代码，返回完整代码；旧代码的保留由调用方负责。 */
export function runSceneCodeChat(input: SceneCodeChatInput): Promise<SceneCodeJobResult> {
  return runSceneCodeJob({
    ...input,
    mode: 'chat',
    currentCode: input.currentCode,
    message: input.message,
    history: input.history || [],
  })
}
