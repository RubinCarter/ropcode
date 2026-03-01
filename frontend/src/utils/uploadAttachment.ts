const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export interface UploadResult {
  filePath: string;
  filename: string;
}

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadError';
  }
}

/**
 * Uploads a file to the Go server via HTTP multipart/form-data.
 * The user always accesses the app through the Go server port,
 * so window.location.port is always the correct server port.
 */
export async function uploadAttachment(
  file: File,
  projectPath?: string,
): Promise<UploadResult> {
  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    throw new UploadError(`文件大小不能超过 50MB（当前大小：${(file.size / 1024 / 1024).toFixed(1)}MB）`);
  }

  const formData = new FormData();
  formData.append('file', file);
  if (projectPath) {
    formData.append('projectPath', projectPath);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch('/api/upload-attachment', {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => 'Unknown error');
      throw new UploadError(`上传失败：${response.status} ${text}`);
    }

    return await response.json() as UploadResult;
  } catch (error) {
    if (error instanceof UploadError) throw error;
    if ((error as Error).name === 'AbortError') {
      throw new UploadError('上传超时，请检查网络连接后重试');
    }
    throw new UploadError(`上传失败：${(error as Error).message}`);
  } finally {
    clearTimeout(timeoutId);
  }
}
