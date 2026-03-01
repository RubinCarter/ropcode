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
 * Uploads a file to the server and returns the saved file path.
 *
 * @param file - The file to upload
 * @param serverPort - The server port (defaults to current page port or 5173)
 * @param projectPath - Optional project path to associate with the upload
 * @returns Promise resolving to upload result with filePath and filename
 * @throws UploadError if file is too large or upload fails
 */
export async function uploadAttachment(
  file: File,
  serverPort?: number | string,
  projectPath?: string
): Promise<UploadResult> {
  // 1. Validate file size
  if (file.size > MAX_FILE_SIZE) {
    throw new UploadError(`文件大小不能超过 50MB（当前大小：${(file.size / 1024 / 1024).toFixed(1)}MB）`);
  }

  // 2. Determine server URL - use Go server port injected at runtime
  const port = serverPort ?? window.__ROPCODE_WS_PORT__ ?? window.location.port ?? '5173';
  const baseUrl = `http://localhost:${port}`;

  // 3. Build FormData
  const formData = new FormData();
  formData.append('file', file);
  if (projectPath) {
    formData.append('projectPath', projectPath);
  }

  // 4. Upload with timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000); // 30 second timeout

  try {
    const response = await fetch(`${baseUrl}/api/upload-attachment`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => 'Unknown error');
      throw new UploadError(`上传失败：${response.status} ${text}`);
    }

    const result = await response.json() as UploadResult;
    return result;
  } catch (error) {
    if (error instanceof UploadError) {
      throw error;
    }
    if ((error as Error).name === 'AbortError') {
      throw new UploadError('上传超时，请检查网络连接后重试');
    }
    throw new UploadError(`上传失败：${(error as Error).message}`);
  } finally {
    clearTimeout(timeoutId);
  }
}
