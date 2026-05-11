import { cn } from "@/lib/utils";

interface MessageScrollSeekPlaceholderProps {
  height: number;
  className?: string;
}

export function MessageScrollSeekPlaceholder({ height, className }: MessageScrollSeekPlaceholderProps) {
  const rowCount = height > 180 ? 3 : height > 96 ? 2 : 1;

  return (
    <div style={{ height, boxSizing: 'border-box' }} className={cn("px-4 pb-4 pt-2", className)}>
      <div className="h-full rounded-lg border border-border/50 bg-muted/20 p-3 overflow-hidden">
        {Array.from({ length: rowCount }).map((_, index) => (
          <div key={index} className="flex gap-3 py-1.5">
            <div className="h-6 w-6 rounded-full bg-muted/60 flex-shrink-0" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-3 w-24 rounded bg-muted/60" />
              <div className="h-3 w-full max-w-xl rounded bg-muted/50" />
              <div className="h-3 w-2/3 rounded bg-muted/40" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
