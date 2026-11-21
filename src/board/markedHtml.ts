import DOMPurify from 'isomorphic-dompurify'
import { marked } from 'marked'

/** marked 直出 HTML，经 DOMPurify 消毒后供 dangerouslySetInnerHTML 使用 */
export function markdownToSafeHtml(md: string): string {
  const raw = marked.parse(String(md ?? ''), { async: false, gfm: true, breaks: true }) as string
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel'],
  })
}