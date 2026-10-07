"use client"

import * as React from "react"
import { Dialog as SheetPrimitive } from "radix-ui"
import { XIcon } from "lucide-react"
import { cn } from "cn"
import { useT } from "@/i18n"

function Sheet(props: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}
function SheetTrigger(props: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}
function SheetClose(props: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}
function SheetPortal(props: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}
function SheetOverlay({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return <SheetPrimitive.Overlay data-slot="sheet-overlay" className={cn("fixed inset-0 z-50 bg-black/20 motion-safe:duration-250 motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=closed]:fade-out-0", className)} {...props} />
}
const sides = {
  right: "inset-y-0 right-0 h-full w-3/4 rounded-l-2xl sm:max-w-md motion-safe:data-[state=open]:slide-in-from-right motion-safe:data-[state=closed]:slide-out-to-right",
  left: "inset-y-0 left-0 h-full w-3/4 rounded-r-2xl sm:max-w-md motion-safe:data-[state=open]:slide-in-from-left motion-safe:data-[state=closed]:slide-out-to-left",
  top: "inset-x-0 top-0 max-h-[90dvh] rounded-b-2xl motion-safe:data-[state=open]:slide-in-from-top motion-safe:data-[state=closed]:slide-out-to-top",
  bottom: "inset-x-0 bottom-0 max-h-[90dvh] rounded-t-2xl motion-safe:data-[state=open]:slide-in-from-bottom motion-safe:data-[state=closed]:slide-out-to-bottom",
}
function SheetContent({ className, children, side = "right", showCloseButton = true, ...props }: React.ComponentProps<typeof SheetPrimitive.Content> & { side?: keyof typeof sides; showCloseButton?: boolean }) {
  const t = useT()
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content data-slot="sheet-content" data-side={side} className={cn("fixed z-50 flex flex-col gap-4 overflow-y-auto bg-background p-5 text-sm shadow-xl outline-none motion-safe:duration-250 motion-safe:data-[state=open]:animate-in motion-safe:data-[state=closed]:animate-out", sides[side], className)} {...props}>
        {children}
        {showCloseButton && <SheetPrimitive.Close className="absolute top-3 right-3 rounded-lg p-1 text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" aria-label={t('common.close')}><XIcon className="size-4" /></SheetPrimitive.Close>}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}
function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sheet-header" className={cn("flex flex-col gap-2 pr-6", className)} {...props} />
}
function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sheet-footer" className={cn("mt-auto flex flex-col gap-2 sm:flex-row sm:justify-end", className)} {...props} />
}
function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return <SheetPrimitive.Title data-slot="sheet-title" className={cn("text-base font-semibold", className)} {...props} />
}
function SheetDescription({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return <SheetPrimitive.Description data-slot="sheet-description" className={cn("text-sm text-muted-foreground", className)} {...props} />
}

export { Sheet, SheetTrigger, SheetClose, SheetPortal, SheetOverlay, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription }
