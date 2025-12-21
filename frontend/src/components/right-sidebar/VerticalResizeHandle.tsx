import React, { useCallback, useState } from 'react';
import { cn } from '@/lib/utils';

interface VerticalResizeHandleProps {
  onResize: (deltaY: number) => void;
  className?: string;
}

export const VerticalResizeHandle: React.FC<VerticalResizeHandleProps> = ({
  onResize,
  className
}) => {
  const [isDragging, setIsDragging] = useState(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);

    const startY = e.clientY;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - startY;
      onResize(deltaY);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }, [onResize]);

  return (
    <div
      className={cn(
        "h-2 cursor-ns-resize hover:bg-primary/20 transition-colors relative group",
        "py-0.5", // 增加内边距，让视觉指示器更明显
        isDragging && "bg-primary/30",
        className
      )}
      onMouseDown={handleMouseDown}
    >
      {/* 拖动指示器 */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className={cn(
          "w-12 h-1 rounded-full bg-border transition-colors",
          "group-hover:bg-primary/50 group-hover:w-16",
          isDragging && "bg-primary w-16"
        )} />
      </div>
    </div>
  );
};

export default VerticalResizeHandle;
