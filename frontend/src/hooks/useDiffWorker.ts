import { useEffect, useRef, useState, useCallback } from 'react';

export interface DiffLine {
  type: 'add' | 'delete' | 'modify' | 'context';
  lineNumber: number;
  content: string;
  oldContent?: string;
}

interface DiffWorkerResult {
  lines: DiffLine[];
  loading: boolean;
  progress: number;
  error: string | null;
  computeDiff: (oldContent: string, newContent: string, options?: DiffOptions) => void;
  cancel: () => void;
}

interface DiffOptions {
  chunkSize?: number;
  useChunking?: boolean;
}

/**
 * Hook for computing diffs using Web Worker
 * Supports chunked loading for large files
 */
export function useDiffWorker(): DiffWorkerResult {
  const workerRef = useRef<Worker | null>(null);
  const [lines, setLines] = useState<DiffLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Initialize worker
  useEffect(() => {
    // Create worker
    workerRef.current = new Worker(
      new URL('../workers/diffWorker.ts', import.meta.url),
      { type: 'module' }
    );

    // Setup message handler
    workerRef.current.onmessage = (event) => {
      const { type, lines: resultLines, progress: progressValue, error: errorMsg } = event.data;

      if (type === 'diff-result') {
        setLines(resultLines || []);
        setLoading(false);
        setProgress(100);
      } else if (type === 'diff-progress') {
        setProgress(progressValue || 0);
      } else if (type === 'diff-error') {
        setError(errorMsg || 'Unknown error');
        setLoading(false);
      }
    };

    workerRef.current.onerror = (event) => {
      console.error('Worker error:', event);
      setError('Worker error occurred');
      setLoading(false);
    };

    // Cleanup
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  // Compute diff function
  const computeDiff = useCallback((
    oldContent: string,
    newContent: string,
    options: DiffOptions = {}
  ) => {
    if (!workerRef.current) {
      setError('Worker not initialized');
      return;
    }

    setLoading(true);
    setProgress(0);
    setError(null);
    setLines([]);

    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    const { chunkSize = 1000, useChunking = false } = options;

    if (useChunking && (oldLines.length > chunkSize || newLines.length > chunkSize)) {
      // 分块处理
      computeChunkedDiff(oldLines, newLines, chunkSize);
    } else {
      // 一次性处理
      workerRef.current.postMessage({
        type: 'compute-diff',
        oldLines,
        newLines
      });
    }
  }, []);

  // 分块计算 diff
  const computeChunkedDiff = useCallback(async (
    oldLines: string[],
    newLines: string[],
    chunkSize: number
  ) => {
    const maxLines = Math.max(oldLines.length, newLines.length);
    const chunks = Math.ceil(maxLines / chunkSize);
    const allLines: DiffLine[] = [];

    for (let i = 0; i < chunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, maxLines);

      await new Promise<void>((resolve, reject) => {
        if (!workerRef.current) {
          reject(new Error('Worker not available'));
          return;
        }

        const handleMessage = (event: MessageEvent) => {
          const { type, lines: chunkLines, error: errorMsg } = event.data;

          if (type === 'diff-result') {
            if (chunkLines) {
              allLines.push(...chunkLines);
            }
            setLines([...allLines]);
            setProgress(((i + 1) / chunks) * 100);
            workerRef.current?.removeEventListener('message', handleMessage);
            resolve();
          } else if (type === 'diff-error') {
            setError(errorMsg || 'Chunk processing error');
            workerRef.current?.removeEventListener('message', handleMessage);
            reject(new Error(errorMsg));
          }
        };

        workerRef.current.addEventListener('message', handleMessage);

        workerRef.current.postMessage({
          type: 'compute-diff',
          oldLines,
          newLines,
          chunkStart: start,
          chunkEnd: end
        });
      });
    }

    setLoading(false);
    setProgress(100);
  }, []);

  // Cancel computation
  const cancel = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      // Recreate worker
      workerRef.current = new Worker(
        new URL('../workers/diffWorker.ts', import.meta.url),
        { type: 'module' }
      );
    }
    setLoading(false);
    setProgress(0);
  }, []);

  return {
    lines,
    loading,
    progress,
    error,
    computeDiff,
    cancel
  };
}
