import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import { remarkSrCodes, SR_CODE_HREF, SrCodeLink } from './SrCodeLink'

interface MarkdownProps {
  content: string
  className?: string
  tone?: 'primary' | 'warning' | 'card'
}

export function Markdown({ content, className, tone }: MarkdownProps) {
  return (
    <div className={cn('md-body', className)} data-tone={tone}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkSrCodes]} components={{
        a: ({ href, title, children }) => href?.startsWith(SR_CODE_HREF) ? <SrCodeLink code={href.slice(SR_CODE_HREF.length)}>{children}</SrCodeLink> : <a href={href} title={title} target="_blank" rel="noreferrer">{children}</a>,
      }}>{content}</ReactMarkdown>
    </div>
  )
}
