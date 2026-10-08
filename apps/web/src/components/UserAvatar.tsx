import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { AvatarUser } from '@/lib/users'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface UserAvatarProps {
  user?: AvatarUser
  size?: 'xs' | 'sm' | 'md'
  className?: string
  showName?: boolean
}

const SIZE = { xs: 'size-5 text-xs', sm: 'size-6 text-xs', md: 'size-8 text-xs' }

export function UserAvatar({ user, size = 'sm', className, showName }: UserAvatarProps) {
  const t = useT()
  const avatar = (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white', SIZE[size], className)}
      style={{ backgroundColor: user?.color ?? '#94a3b8' }}
    >
      {user?.initials ?? '?'}
    </span>
  )
  if (showName) {
    return (
      <span className="inline-flex items-center gap-1.5">
        {avatar}
        <span className="text-sm">{user?.name ?? t('components.unknownUser')}</span>
      </span>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>{avatar}</TooltipTrigger>
      <TooltipContent>
        {user?.name ?? t('components.unknownUser')} {user?.role ? `· ${user.role}` : ''}
      </TooltipContent>
    </Tooltip>
  )
}

interface AvatarGroupProps {
  users: (AvatarUser | undefined)[]
  max?: number
}

export function AvatarGroup({ users, max = 3 }: AvatarGroupProps) {
  const shown = users.slice(0, max)
  const rest = users.length - shown.length
  return (
    <span className="inline-flex items-center -space-x-1.5">
      {shown.map((u, i) => (
        <UserAvatar key={u?.id ?? i} user={u} size="sm" className="ring-2 ring-background" />
      ))}
      {rest > 0 && (
        <span className="inline-flex size-6 items-center justify-center rounded-full bg-muted text-[11px] font-medium ring-2 ring-background">
          +{rest}
        </span>
      )}
    </span>
  )
}
