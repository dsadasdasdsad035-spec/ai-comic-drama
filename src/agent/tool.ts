import type { z } from 'zod'

/**
 * 框架无关的工具定义。
 *
 * 全应用只有这一种工具形状；执行细节（哪个循环、哪个渠道）由运行时适配层负责。
 * `schema` 是参数结构的唯一真相：模型看到的声明由它生成，执行前的校验也用它，
 * 不存在第二份手写副本。
 */
export type ToolDef<Schema extends z.ZodType = z.ZodType> = {
  name: string
  description: string
  schema: Schema
  /** 工具实现；返回值原样交给运行时，由适配层决定模型可见与界面可见的部分 */
  run: (args: z.infer<Schema>) => Promise<unknown>
  /**
   * `run` 的校验入口：先按 schema 校验再执行。
   *
   * 运行时（pi）在调用 execute 前已用同一份 schema 校验过参数，走的也是 `run`；
   * 直接调用（宿主与测试）走这里，保证两条路径的拒绝语义一致——
   * 参数不合规必须抛错，而不是交给工具函数返回一个 ok:false 的结果。
   */
  invoke: (args: z.infer<Schema>) => Promise<unknown>
}

/** 建工具时只写 run；schema 的类型推导与 invoke 校验由这里补齐。 */
export function defineTool<Schema extends z.ZodType>(def: {
  name: string
  description: string
  schema: Schema
  run: (args: z.infer<Schema>) => Promise<unknown>
}): ToolDef<Schema> {
  return {
    ...def,
    invoke: async (args) => def.run(def.schema.parse(args) as z.infer<Schema>),
  }
}

/** 按名字取工具；找不到时返回 undefined，调用方负责给可读错误。 */
export function toolByName(tools: readonly ToolDef[], name: string): ToolDef | undefined {
  return tools.find((tool) => tool.name === name)
}
