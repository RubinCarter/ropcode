import React from 'react';
import { useSessionStream } from '@/hooks/useSessionStream';

interface SessionStreamBoundaryProps {
  streamId?: string | null;
  enabled?: boolean;
  children: React.ReactNode;
}

export const SessionStreamBoundary: React.FC<SessionStreamBoundaryProps> = ({ streamId, enabled = true, children }) => {
  useSessionStream(streamId, { enabled: enabled && Boolean(streamId) });
  return <>{children}</>;
};
