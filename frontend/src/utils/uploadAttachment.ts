import { wsClient } from '@/lib/ws-rpc-client';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export interface UploadResult {
  filePath: string;
}

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadError';
  }
}

/**
 * Uploads a file to the Go backend via WebSocket RPC (same channel as all other API calls).
 */
export async function uploadAttachment(
  file: File,
): Promise<UploadResult> {
  // 1. Validate file size
  if (file.size > MAX_FILE_SIZE) {
    throw new UploadError(`文件大小不能超过 50MB（当前大小：${(file.size / 1024 / 1024).toFixed(1)}MB）`);
  }

  // 2. Read file as base64
  const base64Data = await fileToBase64(file);

  // 3. Call Go backend via WebSocket RPC (consistent with SavePastedImage and all other APIs)
  try {
    const filePath = await wsClient.call('SaveAttachment', base64Data, file.name) as string;
    return { filePath };
  } catch (error) {
    throw new UploadError(`上传失败：${(error as Error).message}`);
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new UploadError('读取文件失败'));
    reader.readAsDataURL(file);
  });
}
