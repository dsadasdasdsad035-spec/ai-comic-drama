/**
 * 导入预览提示文案。
 *
 * 为什么单独成模块：这段文案原先在 `IntakeDialog` 与 `BundleDialog` 里各写一份，
 * 措辞和条件总是对不齐——一处报了「表演补全」，另一处不报；一处把忽略列说成
 * 「无法识别」，另一处说「忽略列」。提示是用户判断「这次导入改了什么」的唯一
 * 依据，两侧说不同的话比不提示更糟。抽纯函数还有两个好处：文案可被回归脚本断言，
 * 且不必起浏览器就能验。
 *
 * 分工：凡是能按行算出来的（跳行、场次回退、涉及镜数、忽略列、参考未解析）都由
 * `diffShots` 一次性产出，本模块只负责它不知道的两件事——表演补全与补全口径措辞。
 * 两边各报一次会让同一条问题在预览里出现两遍，用户分不清是一处还是两处。
 */

export type IntakeNoticeInput = {
  /** `diffShots` 已经产出的提示，原样透传 */
  notices?: string[]
  /** 逐镜统计的系统补全项：字段名 → 镜数（`diffShots` 的 `defaultsFilled`） */
  defaultsFilled?: Record<string, number>
  /** 说话角色没有表演条目、由系统补默认值的镜数 */
  filledPerformance?: number
  /** 上面这些镜的明细，形如 `S03 陈默` */
  filledPerformanceDetail?: string[]
  /** 每条提示的前缀，压缩包导入时用来点名文件 */
  prefix?: string
}

/**
 * 生成提示列表。
 *
 * 「表演缺项」与「表演整条缺失」是两件事，必须分开说：前者是文件写了这行但情绪/强度
 * 空着，后者是文件根本没给这个说话角色写表演。合并成一句会让用户以为只补了 N 镜，
 * 实际补的是 N+M 处。
 */
export function intakeNotices(input: IntakeNoticeInput): string[] {
  const out: string[] = []
  const push = (text: string) => out.push(input.prefix ? `${input.prefix}：${text}` : text)

  for (const text of input.notices ?? []) push(text)

  const filled = input.defaultsFilled ?? {}
  for (const [field, count] of Object.entries(filled)) {
    if (!count) continue
    if (field === 'performance') {
      push(`表演列有 ${count} 镜的情绪或强度没写全，按平静/3 度填了`)
    } else if (field === 'move') {
      push(`运镜 缺列，系统补了默认值 ${count} 镜`)
    } else if (field === 'size') {
      push(`景别 有 ${count} 镜认不出，已保留原文`)
    } else {
      push(`${field} 缺列，系统补了默认值 ${count} 镜`)
    }
  }

  if (input.filledPerformance) {
    const detail = (input.filledPerformanceDetail ?? []).join('；')
    push(
      `${input.filledPerformance} 个说话角色没写表演，系统补了默认值（平静/3 度/说话中）` +
        (detail ? `：${detail}` : ''),
    )
  }

  return out
}
