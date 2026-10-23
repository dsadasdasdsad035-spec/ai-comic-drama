import { Card } from '@/chat-ui/ui/card'

export function ChatEmpty() {
  return (
    <Card data-chat-empty className="m-2 border-dashed bg-transparent px-3 py-4 text-xs leading-relaxed text-muted-foreground">
      让 agent 读取当前镜头、生成代码、运行沙箱、抓帧并验收。代码只有通过沙箱才会进入草稿。
    </Card>
  )
}
