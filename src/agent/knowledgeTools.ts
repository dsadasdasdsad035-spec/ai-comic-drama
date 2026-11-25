import { z } from 'zod'
import { searchKnowledge, readKnowledgeDoc, type KnowledgeSearchHit } from '../api'
import { defineTool, type ToolDef } from './tool'

/**
 * 知识库检索工具（只读）。
 *
 * 两个刻意的设计：
 *
 * 1. **项目不由模型指定**。`projectName` 从聊天上下文注入，工具 schema 里没有
 *    这个字段 —— 模型没有任何路径指向别的项目。跨项目检索不是「暂时没做」，
 *    而是与上下文透明规则冲突，不该成为可选项。
 *
 * 2. **模型只看到摘要**。命中片段的全文留在工具卡片里给用户看，模型收到的是
 *    截断片段 + 标题 + 分数。整段原文塞进模型上下文既浪费预算，也让「用户能
 *    看到模型看到了什么」这条要求变成空话。
 *
 * 这两个工具都不产生模型调用（上游 vector-search 不经 LLM），因此不参与成本确认。
 */

/** 单个片段给模型的最长字符数。整段留在界面，摘要给模型。 */
const SNIPPET_MAX = 600

function clip(text: string, max = SNIPPET_MAX): string {
  const t = String(text || '').trim()
  return t.length > max ? `${t.slice(0, max)}…（片段已截断）` : t
}

type KnowledgeToolDeps = {
  /** 当前项目名；空串表示没有项目上下文 */
  projectName: () => string
}

export function createKnowledgeTools(deps: KnowledgeToolDeps): ToolDef[] {
  const project = () => String(deps.projectName() || '').trim()

  return [
    defineTool({
      name: 'search_knowledge',
      description:
        '【平台内置】检索当前项目的知识库（向量检索，不经过大模型，免费）。' +
        '返回命中文档的标题、相似度分数与片段摘要。只作用于当前项目，不需要也不能指定项目。' +
        '用户问「资料里怎么写的」「设定里有没有提到」这类问题时用；事实性创作决策前值得先查。',
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
        const name = project()
        if (!name) return { ok: false, error: '当前没有选中的项目，无法检索知识库' }
        let hits: KnowledgeSearchHit[]
        try {
          hits = await searchKnowledge(name, String(args.query || ''), {
            topN: args.topN ? Number(args.topN) : undefined,
          })
        } catch (e) {
          return { ok: false, error: (e as Error).message || String(e) }
        }
        if (!hits.length) {
          return {
            ok: true,
            summary: '知识库没有命中任何内容',
            hits: [],
            note: '库里没有相关内容，或这个项目还没有上传文档。',
          }
        }
        return {
          ok: true,
          summary: `命中 ${hits.length} 段`,
          project: name,
          hits: hits.map((h) => ({
            title: h.title,
            score: h.score,
            snippet: clip(h.text),
            // 完整片段给工具卡片渲染；模型可见的 summary/hits 已在上层裁剪
            fullText: h.text,
            location: h.location,
          })),
        }
      },
    }),

    defineTool({
      name: 'read_knowledge_doc',
      description:
        '【平台内置】读取当前项目知识库里某份文档的全文（只读文件，不经过大模型，免费）。' +
        '先用 search_knowledge 找到标题，再需要完整上下文时再调用它。' +
        '正文较长时返回开头部分与总字数提示。',
      schema: z.object({
        docName: z
          .string()
          .min(1)
          .describe('文档标识或标题：search_knowledge 返回的 location 或 title 都可以'),
      }),
      run: async (args) => {
        if (!project()) return { ok: false, error: '当前没有选中的项目，无法读取知识库文档' }
        let doc
        try {
          doc = await readKnowledgeDoc(String(args.docName || ''))
        } catch (e) {
          return { ok: false, error: (e as Error).message || String(e) }
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
export const KNOWLEDGE_TOOL_NAMES = ['search_knowledge', 'read_knowledge_doc'] as const
