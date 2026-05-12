import * as React from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface PopoverProps {
  /**
   * The trigger element
   */
  trigger: React.ReactNode;
  /**
   * The content to display in the popover
   */
  content: React.ReactNode;
  /**
   * Whether the popover is open
   */
  open?: boolean;
  /**
   * Callback when the open state changes
   */
  onOpenChange?: (open: boolean) => void;
  /**
   * Optional className for the content
   */
  className?: string;
  /**
   * Alignment of the popover relative to the trigger
   */
  align?: "start" | "center" | "end";
  /**
   * Side of the trigger to display the popover
   */
  side?: "top" | "bottom";
}

/**
 * Popover component for displaying floating content
 * 
 * @example
 * <Popover
 *   trigger={<Button>Click me</Button>}
 *   content={<div>Popover content</div>}
 *   side="top"
 * />
 */
export const Popover: React.FC<PopoverProps> = ({
  trigger,
  content,
  open: controlledOpen,
  onOpenChange,
  className,
  align = "center",
  side = "bottom",
}) => {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = onOpenChange || setInternalOpen;
  
  const triggerRef = React.useRef<HTMLDivElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const [contentStyle, setContentStyle] = React.useState<React.CSSProperties>({});
  
  // Close on click outside
  React.useEffect(() => {
    if (!open) return;
    
    const handleClickOutside = (event: MouseEvent) => {
      if (
        triggerRef.current &&
        contentRef.current &&
        !triggerRef.current.contains(event.target as Node) &&
        !contentRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, setOpen]);
  
  // Close on escape
  React.useEffect(() => {
    if (!open) return;
    
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open, setOpen]);
  
  React.useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;

    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const nextStyle: React.CSSProperties = {
        position: 'fixed',
        zIndex: 1000,
        top: side === 'top' ? undefined : rect.bottom + 8,
        bottom: side === 'top' ? window.innerHeight - rect.top + 8 : undefined,
      };

      if (align === 'start') {
        nextStyle.left = rect.left;
      } else if (align === 'end') {
        nextStyle.right = window.innerWidth - rect.right;
      } else {
        nextStyle.left = rect.left + rect.width / 2;
        nextStyle.transform = 'translateX(-50%)';
      }

      setContentStyle(nextStyle);
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [align, open, side]);

  const animationY = side === "top" ? { initial: 10, exit: 10 } : { initial: -10, exit: -10 };
  
  return (
    <div className="relative inline-block">
      <div
        ref={triggerRef}
        onClick={() => setOpen(!open)}
      >
        {trigger}
      </div>
      
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={contentRef}
              initial={{ opacity: 0, scale: 0.95, y: animationY.initial }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: animationY.exit }}
              transition={{ duration: 0.15 }}
              style={contentStyle}
              className={cn(
                "min-w-[200px] rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-md",
                className
              )}
            >
              {content}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}; 