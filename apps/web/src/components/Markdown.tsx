import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

interface MarkdownProps {
  content: string
  className?: string
  tone?: 'primary' | 'warning' | 'card'
}

export function Markdown({ content, className, tone }: MarkdownProps) {
  return (
    <div className={cn('md-body', className)} data-tone={tone}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
        a: ({ href, title, children }) => <a href={href} title={title} target="_blank" rel="noreferrer">{children}</a>,
      }}>{content}</ReactMarkdown>
    </div>
  )
}
