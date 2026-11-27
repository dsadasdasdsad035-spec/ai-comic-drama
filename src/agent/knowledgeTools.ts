import { z } from 'zod'
import {
  listKnowledgeBases,
  readKnowledgeDoc,
  searchKnowledge,
  KnowledgeError,
  type KnowledgeBaseSummary,
  type KnowledgeSearchHit,
} from '../api'
import { defineTool, type ToolDef } from './tool'

/**
 * 知识库工具（只读）。
 *
 * 三个刻意的设计：
 *
 * 1. **库不由模型指定**。作用域是「当前会话选定的库」，会话标识由宿主注入
 *    （`sessionId`），工具 schema 里没有任何库参数 —— 模型没有路径指向别的库。
 *    未选库时返回可读说明，而不是偷偷查任意一个库。
 *
 * 2. **模型只看到摘要**。命中片段的全文留在工具卡片里给用户看，模型收到的是
 *    截断片段 + 标题 + 分数。整段原文塞进模型上下文既浪费预算，也让「用户能
 *    看到模型看到了什么」这条要求变成空话。
 *
 * 3. **list_knowledge_bases 不改选定**。它只回答「有哪些库」，让模型在用户没选库
 *    时能列出可选项去问人；真正选定只能由用户在界面上做（或明确说「用 X 库」后
 *    由界面写入），工具不代劳 —— 免得模型自己替用户选一个。
 *
 * 这些工具都不产生模型调用（上游 vector-search 不经 LLM），因此不参与成本确认。
 */

/** 单个片段给模型的最长字符数。整段留在界面，摘要给模型。 */
const SNIPPET_MAX = 600

function clip(text: string, max = SNIPPET_MAX): string {
  const t = String(text || '').trim()
  return t.length > max ? `${t.slice(0, max)}…（片段已截断）` : t
}

/** 从错误里取服务端给的 code：KnowledgeError 不保留 code，兜底看 message 前缀 */
function errorCode(e: unknown): string {
  const code = String((e as { code?: string })?.code || '')
  if (code) return code
  const msg = String((e as Error)?.message || '')
  // 服务端错误码不随文案变：`resolveKnowledgeScope` 抛的清楚说明会带上这句
  if (msg.includes('选定的知识库已被删除')) return 'kb_session_gone'
  if (msg.includes('还没有选择知识库') || msg.includes('缺少知识库标识')) return 'kb_session_unset'
  return ''
}

type KnowledgeToolDeps = {
  /**
   * 当前会话标识；空串表示没有会话上下文。
   *
   * 为什么不叫 projectName：库与项目已解耦（见 openspec 变更
   * knowledge-base-library-model）。会话标识只回答「哪个对话在问」。
   */
  sessionId: () => string
}

export function createKnowledgeTools(deps: KnowledgeToolDeps): ToolDef[] {
  const session = () => String(deps.sessionId() || '').trim()

  const baseList = async (): Promise<{ bases: KnowledgeBaseSummary[]; error: string }> => {
    try {
      return { bases: await listKnowledgeBases(), error: '' }
    } catch (e) {
      // 列举失败不该把「没选库」这条主因遮住，但要说清为什么没有清单
      return { bases: [], error: String((e as Error)?.message || e) }
    }
  }

  /** 未选库：列出可用库 + 指引，不抛错、不跨库 */
  const needSelection = async (verb: string) => {
    const { bases, error } = await baseList()
    const names = bases.map((b) => b.name).join('、')
    const tail = error
      ? `（暂时读不到库列表：${error}）`
      : names
        ? `可用的库有：${names}。请让用户在会话头部的知识库下拉里选一个，或直接告诉用哪个库。`
        : '当前还没有任何知识库：请让用户到「知识库」页新建一个并上传文档。'
    return {
      ok: false,
      needKnowledgeBase: true,
      error: `本次会话还没有选择知识库，所以无法${verb}。${tail}`,
      availableBases: bases.map((b) => ({ id: b.id, name: b.name, docCount: b.docCount })),
    }
  }

  /** 选定的库被删：要求重选，明确说清「不是你选错了，是库没了」 */
  const needReselect = async (verb: string) => {
    const { bases } = await baseList()
    const names = bases.map((b) => b.name).join('、')
    return {
      ok: false,
      needKnowledgeBase: true,
      reselect: true,
      error:
        `本次会话选定的知识库已被删除，所以无法${verb}。` +
        (names
          ? `请让用户在会话头部重新选择，可用的库有：${names}。`
          : '当前没有任何知识库，请让用户到「知识库」页新建一个。'),
      availableBases: bases.map((b) => ({ id: b.id, name: b.name, docCount: b.docCount })),
    }
  }

  return [
    defineTool({
      name: 'list_knowledge_bases',
      description:
        '【平台内置】列出所有知识库（名称、标识、文档数）。只读，不改变当前选定的库。' +
        '用户没选库、或问「有哪些资料库」时用它列出可选项，再请用户选择。',
      schema: z.object({}),
      run: async () => {
        const { bases, error } = await baseList()
        if (error) return { ok: false, error }
        if (!bases.length) {
          return {
            ok: true,
            summary: '当前还没有知识库',
            bases: [],
            note: '需要用户到「知识库」页新建一个并上传文档。',
          }
        }
        return {
          ok: true,
          summary: `共 ${bases.length} 个知识库`,
          bases: bases.map((b) => ({ id: b.id, name: b.name, docCount: b.docCount })),
        }
      },
    }),

    defineTool({
      name: 'search_knowledge',
      description:
        '【平台内置】检索当前会话选定的知识库（向量检索，不经过大模型，免费）。' +
        '返回命中文档的标题、相似度分数与片段摘要。作用域由会话决定，不需要也不能指定库。' +
        '用户问「资料里怎么写的」「设定里有没有提到」这类问题时用；事实性创作决策前值得先查。' +
        '会话还没选库时会返回可用库清单，据此问用户要查哪个。',
      schema: z.object({
        query: z.string().min(1).describe('检索关键词或问题，用自然语言即可'),
        topN: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe('返回片段数，默认 4；不确定就省略'),
      }),
      run: async (args) => {
        const sid = session()
        if (!sid) return needSelection('检索知识库')
        let hits: KnowledgeSearchHit[]
        try {
          hits = await searchKnowledge({ sessionId: sid }, String(args.query || ''), {
            topN: args.topN ? Number(args.topN) : undefined,
          })
        } catch (e) {
          const code = errorCode(e)
          if (code === 'kb_session_unset') return needSelection('检索知识库')
          if (code === 'kb_session_gone') return needReselect('检索知识库')
          /*
           * 其余失败一律转成可读结果，不抛。抛出去会被宿主包成 tool-error，
           * 模型只看到一句「执行失败」，既不知道是没配、连不上还是库坏了。
           */
          return { ok: false, error: String((e as Error)?.message || e) }
        }
        if (!hits.length) {
          return {
            ok: true,
            summary: '知识库没有命中任何内容',
            hits: [],
            note: '库里没有相关内容，或这个库还没有上传文档。',
          }
        }
        return {
          ok: true,
          summary: `命中 ${hits.length} 段`,
          hits: hits.map((h) => ({
            title: h.title,
            score: h.score,
            snippet: clip(h.text),
            // 完整片段给界面渲染；模型可见的摘要已在上面裁剪
            fullText: h.text,
            location: h.location,
          })),
        }
      },
    }),

    defineTool({
      name: 'read_knowledge_doc',
      description:
        '【平台内置】读取当前会话选定知识库里某份文档的全文（只读文件，不经过大模型，免费）。' +
        '先用 search_knowledge 找到标题，再需要完整上下文时再调用它。' +
        '正文较长时返回开头部分与总字数提示。',
      schema: z.object({
        docName: z
          .string()
          .min(1)
          .describe('文档标识或标题：search_knowledge 返回的 location 或 title 都可以'),
      }),
      run: async (args) => {
        const sid = session()
        if (!sid) return needSelection('读取知识库文档')
        let doc
        try {
          doc = await readKnowledgeDoc({ sessionId: sid }, String(args.docName || ''))
        } catch (e) {
          const code = errorCode(e)
          if (code === 'kb_session_unset') return needSelection('读取知识库文档')
          if (code === 'kb_session_gone') return needReselect('读取知识库文档')
          return { ok: false, error: String((e as Error)?.message || e) }
        }
        return {
          ok: true,
          summary: `已读取「${doc.title}」（${doc.wordCount || 0} 词）`,
          title: doc.title,
          wordCount: doc.wordCount,
          text: clip(doc.text, 4000),
          fullText: doc.text,
        }
      },
    }),
  ]
}

/** 知识库工具名：清单、专家分组与检查器都从这里取，避免第二份字面量 */
export const KNOWLEDGE_TOOL_NAMES = [
  'list_knowledge_bases',
  'search_knowledge',
  'read_knowledge_doc',
] as const

export { KnowledgeError }
