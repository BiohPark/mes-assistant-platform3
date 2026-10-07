"use client"

import * as React from "react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"
import { CheckIcon, MinusIcon } from "lucide-react"
import { cn } from "cn"

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root data-slot="checkbox" className={cn("peer size-4 shrink-0 rounded-lg border border-input outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground", className)} {...props}>
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="group flex items-center justify-center">
        <CheckIcon className="size-3 group-data-[state=indeterminate]:hidden" />
        <MinusIcon className="hidden size-3 group-data-[state=indeterminate]:block" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
