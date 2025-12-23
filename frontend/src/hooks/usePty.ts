import { CreatePtySession, WriteToPty, ResizePty, ClosePtySession } from '@/lib/rpc-client';
import { EventsOn, EventsOff } from '@/lib/rpc-events';
import { useEffect, useCallback, useRef } from 'react';

interface PtyOutput {
  session_id: string;
  output_type: string;
  content: string;
}

export function usePty(sessionId: string, onOutput: (content: string) => void) {
  const outputHandler = useRef(onOutput);
  outputHandler.current = onOutput;

  useEffect(() => {
    const handler = (data: PtyOutput) => {
      if (data.session_id === sessionId) {
        outputHandler.current(data.content);
      }
    };

    EventsOn('pty-output', handler);
    return () => {
      EventsOff('pty-output');
    };
  }, [sessionId]);

  const create = useCallback(async (cwd: string, rows: number, cols: number, shell?: string) => {
    return CreatePtySession(sessionId, cwd, rows, cols, shell || '');
  }, [sessionId]);

  const write = useCallback(async (data: string) => {
    return WriteToPty(sessionId, data);
  }, [sessionId]);

  const resize = useCallback(async (rows: number, cols: number) => {
    return ResizePty(sessionId, rows, cols);
  }, [sessionId]);

  const close = useCallback(async () => {
    return ClosePtySession(sessionId);
  }, [sessionId]);

  return { create, write, resize, close };
}
