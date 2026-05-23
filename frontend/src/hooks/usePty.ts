import { CreatePtySession, WriteToPty, ResizePty, ClosePtySession } from '@/lib/rpc-client';
import { useEffect, useCallback, useRef } from 'react';
import { useBulkStream } from './useBulkStream';

export function usePty(sessionId: string, onOutput: (content: string) => void) {
  const outputHandler = useRef(onOutput);
  outputHandler.current = onOutput;
  const { frames } = useBulkStream('pty', sessionId);
  const consumedCountRef = useRef(0);

  useEffect(() => {
    for (const frame of frames.slice(consumedCountRef.current)) {
      outputHandler.current(frame.data ?? '');
    }
    consumedCountRef.current = frames.length;
  }, [frames]);

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
