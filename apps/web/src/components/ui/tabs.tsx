"use client"

import * as React from "react"
import { Tabs as TabsPrimitive } from "radix-ui"
import { cn } from "cn"

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col gap-4", className)} {...props} />
}
function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List data-slot="tabs-list" className={cn("inline-flex h-8 w-fit items-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground", className)} {...props} />
}
function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return <TabsPrimitive.Trigger data-slot="tabs-trigger" className={cn("inline-flex h-6 items-center justify-center rounded-lg px-2 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-card data-[state=active]:text-foreground", className)} {...props} />
}
function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn("flex-1 outline-none focus-visible:ring-2 focus-visible:ring-ring", className)} {...props} />
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
