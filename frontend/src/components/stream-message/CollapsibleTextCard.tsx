import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface CollapsibleTextCardProps {
  title: string;
  preview: string;
  defaultExpanded?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  children: React.ReactNode;
}

export const CollapsibleTextCard: React.FC<CollapsibleTextCardProps> = ({
  title,
  preview,
  defaultExpanded = false,
  expanded: controlledExpanded,
  onExpandedChange,
  children,
}) => {
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(defaultExpanded);
  const expanded = controlledExpanded ?? uncontrolledExpanded;

  const toggleExpanded = () => {
    const nextExpanded = !expanded;
    if (controlledExpanded === undefined) {
      setUncontrolledExpanded(nextExpanded);
    }
    onExpandedChange?.(nextExpanded);
  };

  return (
    <div className="rounded-lg border bg-muted/30 overflow-hidden">
      <button
        onClick={toggleExpanded}
        className="w-full flex items-start gap-2 p-3 text-left hover:bg-muted/50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="text-sm font-medium">{title}</div>
          {!expanded && (
            <div className="text-xs text-muted-foreground whitespace-pre-wrap break-words">
              {preview}
            </div>
          )}
        </div>
      </button>
      {expanded && (
        <div className="px-3 pb-3">
          {children}
        </div>
      )}
    </div>
  );
};
