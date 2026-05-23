import React from 'react';
import { SessionStreamBoundary } from './SessionStreamBoundary';

interface SessionStreamProviderProps {
  streamId?: string | null;
  children: React.ReactNode;
}

export const SessionStreamProvider: React.FC<SessionStreamProviderProps> = ({ streamId, children }) => (
  <SessionStreamBoundary streamId={streamId}>{children}</SessionStreamBoundary>
);
