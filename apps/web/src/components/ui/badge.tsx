import * as React from "react"
import { cn } from "cn"

const badgeTones = {
  neutral: "bg-tone-neutral-bg text-tone-neutral-fg",
  info: "bg-tone-info-bg text-tone-info-fg",
  violet: "bg-tone-violet-bg text-tone-violet-fg",
  teal: "bg-tone-teal-bg text-tone-teal-fg",
  warning: "bg-tone-warning-bg text-tone-warning-fg",
  success: "bg-tone-success-bg text-tone-success-fg",
  danger: "bg-tone-danger-bg text-tone-danger-fg",
}
type BadgeTone = keyof typeof badgeTones
// Status badges are read-only spans: no asChild or click API.
function Badge({ className, tone = "neutral", ...props }: Omit<React.ComponentProps<"span">, "onClick" | "onKeyDown" | "tabIndex" | "role"> & { tone?: BadgeTone }) {
  return <span data-slot="badge" className={cn("inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium whitespace-nowrap", badgeTones[tone], className)} {...props} />
}

export { Badge, type BadgeTone }
