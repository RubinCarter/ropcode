import React, { useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface ResizeHandleProps {
  onResize: (width: number) => void;
  minWidth?: number;
  maxWidth?: number;
  className?: string;
}

export const ResizeHandle: React.FC<ResizeHandleProps> = ({
  onResize,
  minWidth = 300,
  maxWidth = 800,
  className
}) => {
  const isDragging = useRef(false);

  const handleMouseDown = useCallback(() => {
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging.current) return;

    const newWidth = window.innerWidth - e.clientX;
    const clampedWidth = Math.min(Math.max(newWidth, minWidth), maxWidth);
    onResize(clampedWidth);
  }, [onResize, minWidth, maxWidth]);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  return (
    <div
      className={cn(
        "absolute left-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-primary/20 transition-colors",
        "group flex items-center justify-center",
        "-ml-1", // 向左偏移，增加可触发区域
        className
      )}
      onMouseDown={handleMouseDown}
    >
      <div className="w-1 h-16 bg-border group-hover:bg-primary/50 rounded-full transition-colors" />
    </div>
  );
};
