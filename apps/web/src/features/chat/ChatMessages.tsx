import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react'
import type { Message } from '@mes/domain'
import { MessageBubble } from './MessageBubble'
import type { ChatRun } from './useChat'

type BubbleActions = Omit<ComponentProps<typeof MessageBubble>, 'message'>

/** 업무와 SR 접수에서 공용 메시지 표시·스트리밍·자동 스크롤을 사용한다. */
export function ChatMessages({ messages, run, empty, actions }: {
  messages: Message[]; run?: ChatRun | null; empty?: ReactNode; actions?: (message: Message) => BubbleActions
}) {
  const bottom = useRef<HTMLDivElement>(null)
  useEffect(() => { bottom.current?.scrollIntoView?.({ block: 'end' }) }, [messages, run?.text])
  return <>{messages.length ? messages.map(item => <MessageBubble key={item.id}
    message={run?.replyId === item.id ? { ...item, content: run.text || item.content } : item} {...actions?.(item)} />) : empty}
    {run?.phase && <p className="text-xs text-muted-foreground">{run.phase}</p>}
    <div ref={bottom} />
  </>
}
