import React from 'react';
import { Circle, Loader2, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RuntimeStatusIconProps {
  connected: boolean;
  active: boolean;
  className?: string;
}

export const RuntimeStatusIcon: React.FC<RuntimeStatusIconProps> = ({ connected, active, className }) => {
  if (!connected) {
    return <WifiOff className={cn('h-4 w-4 text-muted-foreground', className)} />;
  }
  if (active) {
    return <Loader2 className={cn('h-4 w-4 animate-spin text-primary', className)} />;
  }
  return <Circle className={cn('h-4 w-4 text-muted-foreground', className)} />;
};
