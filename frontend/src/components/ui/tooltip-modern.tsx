import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"
import { cn } from "@/lib/utils"

function isWailsRuntime(): boolean {
  if (typeof window === "undefined") return false
  return window.location.protocol === "wails:" || typeof (window as any).runtime !== "undefined"
}

const TooltipProvider: React.FC<React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Provider>> = ({ children, ...props }) => {
  if (isWailsRuntime()) {
    return <>{children}</>
  }
  return <TooltipPrimitive.Provider {...props}>{children}</TooltipPrimitive.Provider>
}

const Tooltip: React.FC<React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Root>> = ({ children, ...props }) => {
  if (isWailsRuntime()) {
    return <>{children}</>
  }
  return <TooltipPrimitive.Root {...props}>{children}</TooltipPrimitive.Root>
}

const TooltipTrigger = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Trigger>
>(({ children, asChild: _asChild, ...props }, ref) => {
  if (isWailsRuntime()) {
    if (React.isValidElement(children)) {
      return React.cloneElement(children, { ...props, ref } as any)
    }
    return <>{children}</>
  }
  return (
    <TooltipPrimitive.Trigger ref={ref} asChild={_asChild} {...props}>
      {children}
    </TooltipPrimitive.Trigger>
  )
})
TooltipTrigger.displayName = TooltipPrimitive.Trigger.displayName

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => {
  if (isWailsRuntime()) {
    return null
  }

  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          "z-[100] overflow-hidden rounded-lg border border-border bg-popover px-3 py-2",
          "text-xs text-popover-foreground shadow-md",
          "animate-in fade-in-0 zoom-in-95",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          "data-[side=bottom]:slide-in-from-top-2",
          "data-[side=left]:slide-in-from-right-2",
          "data-[side=right]:slide-in-from-left-2",
          "data-[side=top]:slide-in-from-bottom-2",
          className
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  )
})
TooltipContent.displayName = TooltipPrimitive.Content.displayName

interface TooltipSimpleProps {
  content: string
  children: React.ReactNode
  side?: "top" | "right" | "bottom" | "left"
  align?: "start" | "center" | "end"
  delayDuration?: number
  className?: string
  contentClassName?: string
}

/**
 * Simple tooltip wrapper for common use cases
 */
export const TooltipSimple: React.FC<TooltipSimpleProps> = ({
  content,
  children,
  side = "top",
  align = "center",
  delayDuration = 200,
  className,
  contentClassName,
}) => {
  if (isWailsRuntime()) {
    return <>{children}</>
  }

  return (
    <Tooltip delayDuration={delayDuration}>
      <TooltipTrigger asChild className={className}>
        {children}
      </TooltipTrigger>
      <TooltipContent side={side} align={align} className={contentClassName}>
        {content}
      </TooltipContent>
    </Tooltip>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
