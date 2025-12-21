/**
 * Web Worker for computing diffs in the background
 * This prevents blocking the main UI thread during expensive diff calculations
 */

export interface DiffLine {
  type: 'add' | 'delete' | 'modify' | 'context';
  lineNumber: number;
  content: string;
  oldContent?: string;
}

interface DiffRequest {
  type: 'compute-diff';
  oldLines: string[];
  newLines: string[];
  chunkStart?: number;
  chunkEnd?: number;
}

interface DiffResponse {
  type: 'diff-result' | 'diff-progress' | 'diff-error';
  lines?: DiffLine[];
  progress?: number;
  error?: string;
  chunkStart?: number;
  chunkEnd?: number;
}

/**
 * 使用 Myers diff 算法计算单栏显示的 diff
 * 添加了复杂度保护和进度报告
 */
function computeSinglePaneDiff(
  oldLines: string[],
  newLines: string[],
  progressCallback?: (progress: number) => void
): DiffLine[] {
  const n = oldLines.length;
  const m = newLines.length;

  // 如果文件太大,使用简化算法
  const MAX_COMPLEXITY = 10000000; // 10M operations
  if (n * m > MAX_COMPLEXITY) {
    console.warn('File too large for full diff computation, using simplified mode');
    // 返回简化的 diff: 逐行对比
    const result: DiffLine[] = [];
    const maxLen = Math.max(n, m);
    for (let i = 0; i < maxLen; i++) {
      if (progressCallback && i % 100 === 0) {
        progressCallback((i / maxLen) * 100);
      }

      if (i < n && i < m) {
        if (oldLines[i] === newLines[i]) {
          result.push({ type: 'context', lineNumber: i + 1, content: newLines[i] });
        } else {
          result.push({ type: 'modify', lineNumber: i + 1, content: newLines[i], oldContent: oldLines[i] });
        }
      } else if (i < m) {
        result.push({ type: 'add', lineNumber: i + 1, content: newLines[i] });
      } else if (i < n) {
        result.push({ type: 'delete', lineNumber: i + 1, content: oldLines[i], oldContent: oldLines[i] });
      }
    }
    return result;
  }

  // 构建 LCS 动态规划表
  const dp: number[][] = Array(n + 1).fill(0).map(() => Array(m + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    if (progressCallback && i % 100 === 0) {
      progressCallback((i / n) * 50); // 前 50% 进度
    }
    for (let j = 1; j <= m; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // 回溯构建 diff 结果
  const result: DiffLine[] = [];
  let i = n, j = m;

  const operations: Array<{
    type: 'add' | 'delete' | 'context';
    oldContent?: string;
    newContent?: string;
    newLineNum: number
  }> = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      operations.unshift({
        type: 'context',
        newContent: newLines[j - 1],
        newLineNum: j
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      operations.unshift({
        type: 'add',
        newContent: newLines[j - 1],
        newLineNum: j
      });
      j--;
    } else if (i > 0) {
      operations.unshift({
        type: 'delete',
        oldContent: oldLines[i - 1],
        newLineNum: j + 1
      });
      i--;
    }
  }

  // 合并连续的 delete + add 为 modify
  const mergedOps: Array<{
    type: 'add' | 'delete' | 'modify' | 'context';
    oldContent?: string;
    newContent?: string;
    newLineNum: number
  }> = [];
  let k = 0;

  while (k < operations.length) {
    if (progressCallback && k % 100 === 0) {
      progressCallback(50 + (k / operations.length) * 50); // 后 50% 进度
    }

    const op = operations[k];

    if (op.type === 'delete') {
      // 收集连续的删除
      const deleteOps = [op];
      let nextIdx = k + 1;
      while (nextIdx < operations.length && operations[nextIdx].type === 'delete') {
        deleteOps.push(operations[nextIdx]);
        nextIdx++;
      }

      // 收集紧随的添加
      const addOps = [];
      while (nextIdx < operations.length && operations[nextIdx].type === 'add') {
        addOps.push(operations[nextIdx]);
        nextIdx++;
      }

      if (addOps.length > 0) {
        // 有删除和添加,标记为修改
        const minLen = Math.min(deleteOps.length, addOps.length);

        // 配对的部分标记为 modify
        for (let p = 0; p < minLen; p++) {
          mergedOps.push({
            type: 'modify',
            oldContent: deleteOps[p].oldContent,
            newContent: addOps[p].newContent,
            newLineNum: addOps[p].newLineNum
          });
        }

        // 多余的删除
        for (let p = minLen; p < deleteOps.length; p++) {
          mergedOps.push(deleteOps[p]);
        }

        // 多余的添加
        for (let p = minLen; p < addOps.length; p++) {
          mergedOps.push(addOps[p]);
        }

        k = nextIdx;
      } else {
        // 只有删除
        mergedOps.push(...deleteOps);
        k = nextIdx;
      }
    } else {
      mergedOps.push(op);
      k++;
    }
  }

  // 转换为 DiffLine
  for (const op of mergedOps) {
    if (op.type === 'context') {
      result.push({
        type: 'context',
        lineNumber: op.newLineNum,
        content: op.newContent || ''
      });
    } else if (op.type === 'add') {
      result.push({
        type: 'add',
        lineNumber: op.newLineNum,
        content: op.newContent || ''
      });
    } else if (op.type === 'delete') {
      result.push({
        type: 'delete',
        lineNumber: op.newLineNum,
        content: op.oldContent || '',
        oldContent: op.oldContent
      });
    } else if (op.type === 'modify') {
      result.push({
        type: 'modify',
        lineNumber: op.newLineNum,
        content: op.newContent || '',
        oldContent: op.oldContent
      });
    }
  }

  if (progressCallback) {
    progressCallback(100);
  }

  return result;
}

// Worker 消息处理
self.addEventListener('message', (event: MessageEvent<DiffRequest>) => {
  const { type, oldLines, newLines, chunkStart, chunkEnd } = event.data;

  if (type === 'compute-diff') {
    try {
      // 如果是分块请求,只处理指定范围
      const linesToProcess = (chunkStart !== undefined && chunkEnd !== undefined)
        ? {
            oldLines: oldLines.slice(chunkStart, chunkEnd),
            newLines: newLines.slice(chunkStart, chunkEnd)
          }
        : { oldLines, newLines };

      // 计算 diff,并报告进度
      const lines = computeSinglePaneDiff(
        linesToProcess.oldLines,
        linesToProcess.newLines,
        (progress) => {
          const response: DiffResponse = {
            type: 'diff-progress',
            progress,
            chunkStart,
            chunkEnd
          };
          self.postMessage(response);
        }
      );

      // 发送结果
      const response: DiffResponse = {
        type: 'diff-result',
        lines,
        chunkStart,
        chunkEnd
      };
      self.postMessage(response);
    } catch (error) {
      const response: DiffResponse = {
        type: 'diff-error',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
      self.postMessage(response);
    }
  }
});

export {};
