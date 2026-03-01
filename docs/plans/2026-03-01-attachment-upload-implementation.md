# 附件上传功能实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为消息输入框添加附件上传功能，支持桌面端文件浏览和移动端相机/相册上传

**Architecture:** 在 FloatingPromptInput 旁添加独立的附件按钮，点击展开菜单。前端使用 HTML5 File API 选择文件，通过 HTTP multipart/form-data POST 到新增的 `/api/upload-attachment` 端点。后端保存文件到 `~/.claude/attachments/` 并返回路径，前端插入到 prompt 中。

**Tech Stack:** React, TypeScript, Go, HTTP multipart/form-data, HTML5 File API

---

## 实现顺序

按照以下顺序实现，确保每个步骤都可独立测试：

1. 后端 HTTP 端点（优先，可独立测试）
2. 前端基础组件（AttachmentButton + AttachmentMenu）
3. 前端上传逻辑集成
4. UI 集成到 FloatingPromptInput
5. 测试和优化

---

## Task 1: 后端 - 文件名清理工具函数

**Files:**
- Modify: `internal/websocket/server.go`

**Step 1: 添加文件名清理函数**

在 `internal/websocket/server.go` 文件末尾添加：

```go
// sanitizeFilename 清理文件名，防止路径遍历攻击
func sanitizeFilename(filename string) string {
	// 只保留基础文件名，移除路径
	filename = filepath.Base(filename)

	// 移除特殊字符
	filename = strings.Map(func(r rune) rune {
		// 保留字母、数字、点、下划线、连字符
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') ||
		   (r >= '0' && r <= '9') || r == '.' || r == '_' || r == '-' {
			return r
		}
		return '_' // 替换其他字符为下划线
	}, filename)

	// 限制文件名长度
	if len(filename) > 200 {
		ext := filepath.Ext(filename)
		name := filename[:200-len(ext)]
		filename = name + ext
	}

	return filename
}
```

**Step 2: 手动测试文件名清理**

在 Go playground 或本地测试：

```go
fmt.Println(sanitizeFilename("../../../etc/passwd")) // 输出: _etc_passwd
fmt.Println(sanitizeFilename("test file (1).pdf"))   // 输出: test_file__1_.pdf
fmt.Println(sanitizeFilename("中文文件.txt"))         // 输出: ___.txt
```

**Step 3: Commit**

```bash
git add internal/websocket/server.go
git commit -m "feat(upload): add filename sanitization utility"
```

---

## Task 2: 后端 - HTTP 文件上传端点

**Files:**
- Modify: `internal/websocket/server.go`

**Step 1: 在 Start() 方法中添加路由**

找到 `Start()` 方法中的路由注册部分（约第 71-74 行），添加新路由：

```go
mux := http.NewServeMux()
mux.HandleFunc("/ws", s.handleWebSocket)
mux.HandleFunc("/health", s.handleHealth)
mux.HandleFunc("/api/upload-attachment", s.handleUploadAttachment) // 新增这行
mux.Handle("/", s.frontendHandler())
```

**Step 2: 实现文件上传处理器**

在 `server.go` 文件中添加新方法：

```go
// handleUploadAttachment 处理文件上传请求
func (s *Server) handleUploadAttachment(w http.ResponseWriter, r *http.Request) {
	// 1. 验证请求方法
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// 2. 启用 CORS（如果需要跨域）
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	// 3. 解析 multipart form (最大 50MB)
	err := r.ParseMultipartForm(50 << 20)
	if err != nil {
		log.Printf("[Upload] Failed to parse form: %v", err)
		http.Error(w, "Failed to parse form", http.StatusBadRequest)
		return
	}

	// 4. 获取上传的文件
	file, header, err := r.FormFile("file")
	if err != nil {
		log.Printf("[Upload] Failed to read file: %v", err)
		http.Error(w, "Failed to read file", http.StatusBadRequest)
		return
	}
	defer file.Close()

	// 5. 获取可选的 projectPath（暂未使用，预留）
	projectPath := r.FormValue("projectPath")
	log.Printf("[Upload] Uploading file: %s (size: %d bytes, project: %s)",
		header.Filename, header.Size, projectPath)

	// 6. 生成安全的文件名：timestamp_originalname
	timestamp := time.Now().Format("20060102-150405")
	safeFilename := sanitizeFilename(header.Filename)
	finalFilename := fmt.Sprintf("%s_%s", timestamp, safeFilename)

	// 7. 确保存储目录存在
	homeDir, err := os.UserHomeDir()
	if err != nil {
		log.Printf("[Upload] Failed to get home dir: %v", err)
		http.Error(w, "Server error", http.StatusInternalServerError)
		return
	}
	attachmentsDir := filepath.Join(homeDir, ".claude", "attachments")
	err = os.MkdirAll(attachmentsDir, 0755)
	if err != nil {
		log.Printf("[Upload] Failed to create directory: %v", err)
		http.Error(w, "Failed to create directory", http.StatusInternalServerError)
		return
	}

	// 8. 创建目标文件
	destPath := filepath.Join(attachmentsDir, finalFilename)
	dest, err := os.Create(destPath)
	if err != nil {
		log.Printf("[Upload] Failed to create file: %v", err)
		http.Error(w, "Failed to save file", http.StatusInternalServerError)
		return
	}
	defer dest.Close()

	// 9. 写入文件内容
	written, err := io.Copy(dest, file)
	if err != nil {
		log.Printf("[Upload] Failed to write file: %v", err)
		http.Error(w, "Failed to write file", http.StatusInternalServerError)
		return
	}

	log.Printf("[Upload] Successfully saved file: %s (%d bytes)", destPath, written)

	// 10. 返回文件路径
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"filePath": destPath,
		"filename": finalFilename,
	})
}
```

**Step 3: 添加必要的 import**

在文件顶部确保有以下 import（如果没有则添加）：

```go
import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
	// ... 其他已有的 import
)
```

**Step 4: 测试上传端点**

使用 curl 测试：

```bash
# 创建测试文件
echo "test content" > /tmp/test.txt

# 上传测试
curl -X POST http://localhost:3001/api/upload-attachment \
  -F "file=@/tmp/test.txt" \
  -F "projectPath=/tmp/test-project"

# 预期输出（JSON）：
# {"filePath":"/Users/username/.claude/attachments/20260301-123456_test.txt","filename":"20260301-123456_test.txt"}

# 验证文件是否保存
ls -la ~/.claude/attachments/
```

**Step 5: Commit**

```bash
git add internal/websocket/server.go
git commit -m "feat(upload): add HTTP file upload endpoint"
```

---

## Task 3: 前端 - AttachmentMenu 组件

**Files:**
- Create: `frontend/src/components/FloatingPromptInput/AttachmentMenu.tsx`

**Step 1: 创建 AttachmentMenu 组件**

```tsx
import React, { useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface AttachmentMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onFileSelected: (file: File) => void;
}

interface MenuOption {
  id: string;
  icon: string;
  label: string;
  accept: string;
  capture?: 'user' | 'environment';
}

export const AttachmentMenu: React.FC<AttachmentMenuProps> = ({
  isOpen,
  onClose,
  onFileSelected,
}) => {
  // 文件输入 refs
  const browseInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // 检测是否为移动设备
  const isMobile = () => {
    return (
      window.matchMedia('(pointer: coarse)').matches ||
      /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
    );
  };

  // 根据设备类型定义菜单选项
  const getMenuOptions = (): MenuOption[] => {
    const mobile = isMobile();

    const baseOptions: MenuOption[] = [
      {
        id: 'browse',
        icon: '📁',
        label: '浏览文件',
        accept: '*/*',
      },
    ];

    if (mobile) {
      baseOptions.push(
        {
          id: 'camera',
          icon: '📷',
          label: '拍照上传',
          accept: 'image/*',
          capture: 'environment', // 后置摄像头
        },
        {
          id: 'photo',
          icon: '🖼️',
          label: '相册选择',
          accept: 'image/*',
        }
      );
    }

    return baseOptions;
  };

  // 处理文件选择
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelected(file);
      onClose();
    }
    // 清空 input，允许重复选择同一文件
    e.target.value = '';
  };

  // 处理选项点击
  const handleOptionClick = (optionId: string) => {
    switch (optionId) {
      case 'browse':
        browseInputRef.current?.click();
        break;
      case 'camera':
        cameraInputRef.current?.click();
        break;
      case 'photo':
        photoInputRef.current?.click();
        break;
    }
  };

  const menuOptions = getMenuOptions();

  return (
    <>
      {/* 隐藏的文件输入元素 */}
      <input
        ref={browseInputRef}
        type="file"
        accept="*/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* 菜单弹出层 */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* 背景遮罩 */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              className="fixed inset-0 z-40"
              style={{ background: 'transparent' }}
            />

            {/* 菜单内容 */}
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="absolute bottom-full right-0 mb-2 z-50"
            >
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden min-w-[160px]">
                {menuOptions.map((option, index) => (
                  <button
                    key={option.id}
                    onClick={() => handleOptionClick(option.id)}
                    className={`
                      w-full px-4 py-2.5 flex items-center gap-3
                      hover:bg-gray-100 dark:hover:bg-gray-700
                      transition-colors duration-150
                      text-left text-sm
                      ${index !== 0 ? 'border-t border-gray-200 dark:border-gray-700' : ''}
                    `}
                  >
                    <span className="text-lg">{option.icon}</span>
                    <span className="text-gray-700 dark:text-gray-200">
                      {option.label}
                    </span>
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
};
```

**Step 2: Commit**

```bash
git add frontend/src/components/FloatingPromptInput/AttachmentMenu.tsx
git commit -m "feat(upload): add AttachmentMenu component"
```

---

## Task 4: 前端 - AttachmentButton 组件

**Files:**
- Create: `frontend/src/components/FloatingPromptInput/AttachmentButton.tsx`

**Step 1: 创建 AttachmentButton 组件**

```tsx
import React, { useState, useRef, useEffect } from 'react';
import { Paperclip } from 'lucide-react';
import { AttachmentMenu } from './AttachmentMenu';
import { TooltipSimple } from '../TooltipSimple';

interface AttachmentButtonProps {
  onFileSelected: (file: File) => void;
  disabled?: boolean;
}

export const AttachmentButton: React.FC<AttachmentButtonProps> = ({
  onFileSelected,
  disabled = false,
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const buttonRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (buttonRef.current && !buttonRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isMenuOpen]);

  const handleButtonClick = () => {
    if (!disabled) {
      setIsMenuOpen(!isMenuOpen);
    }
  };

  const handleFileSelected = (file: File) => {
    setIsMenuOpen(false);
    onFileSelected(file);
  };

  return (
    <div ref={buttonRef} className="relative">
      <TooltipSimple content="添加附件" side="top">
        <button
          onClick={handleButtonClick}
          disabled={disabled}
          className={`
            h-8 w-8 rounded-md flex items-center justify-center
            transition-colors duration-150
            ${disabled
              ? 'text-gray-400 cursor-not-allowed'
              : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800'
            }
          `}
          aria-label="添加附件"
        >
          <Paperclip className="h-4 w-4" />
        </button>
      </TooltipSimple>

      <AttachmentMenu
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        onFileSelected={handleFileSelected}
      />
    </div>
  );
};
```

**Step 2: Commit**

```bash
git add frontend/src/components/FloatingPromptInput/AttachmentButton.tsx
git commit -m "feat(upload): add AttachmentButton component"
```

---

## Task 5: 前端 - 上传逻辑工具函数

**Files:**
- Create: `frontend/src/lib/upload.ts`

**Step 1: 创建上传工具函数**

```typescript
/**
 * 上传附件到服务器
 * @param file 要上传的文件
 * @param projectPath 项目路径（可选）
 * @param serverPort WebSocket 服务器端口
 * @returns 上传后的文件路径
 */
export async function uploadAttachment(
  file: File,
  projectPath: string | undefined,
  serverPort: number
): Promise<{ filePath: string; filename: string }> {
  // 1. 检查文件大小（50MB 限制）
  const maxSize = 50 * 1024 * 1024; // 50MB
  if (file.size > maxSize) {
    throw new Error(`文件大小不能超过 50MB（当前: ${(file.size / 1024 / 1024).toFixed(2)}MB）`);
  }

  // 2. 构建 FormData
  const formData = new FormData();
  formData.append('file', file);
  if (projectPath) {
    formData.append('projectPath', projectPath);
  }

  // 3. 发送 HTTP 请求
  const response = await fetch(`http://localhost:${serverPort}/api/upload-attachment`, {
    method: 'POST',
    body: formData,
  });

  // 4. 处理响应
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`上传失败: ${response.status} ${errorText}`);
  }

  const result = await response.json();
  return result;
}

/**
 * 格式化文件大小显示
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  } else {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
}
```

**Step 2: Commit**

```bash
git add frontend/src/lib/upload.ts
git commit -m "feat(upload): add file upload utility functions"
```

---

## Task 6: 前端 - 集成到 FloatingPromptInput

**Files:**
- Modify: `frontend/src/components/FloatingPromptInput.tsx`

**Step 1: 添加 imports**

在文件顶部添加新的 imports：

```tsx
import { AttachmentButton } from './FloatingPromptInput/AttachmentButton';
import { uploadAttachment } from '../lib/upload';
```

**Step 2: 添加上传状态**

在组件内部，找到状态定义区域，添加：

```tsx
// 在现有 useState 附近添加
const [uploadError, setUploadError] = useState<string | null>(null);
const [isUploading, setIsUploading] = useState(false);
```

**Step 3: 添加文件上传处理函数**

在组件内部添加：

```tsx
const handleAttachmentSelected = async (file: File) => {
  try {
    setUploadError(null);
    setIsUploading(true);

    // 获取 WebSocket 服务器端口
    const serverPort = (window as any).__ROPCODE_SERVER_PORT__ || 3001;

    // 上传文件
    const { filePath } = await uploadAttachment(file, projectPath, serverPort);

    // 插入文件路径到 prompt
    setPrompt((prev) => {
      const newPrompt = prev + `@${filePath} `;
      return newPrompt;
    });

    // 自动聚焦输入框
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    }, 0);
  } catch (error) {
    console.error('[FloatingPromptInput] Upload failed:', error);
    setUploadError(error instanceof Error ? error.message : '上传失败');
  } finally {
    setIsUploading(false);
  }
};
```

**Step 4: 在 UI 中添加 AttachmentButton**

找到 Send 按钮的位置（约第 2318 行），在其左侧添加 AttachmentButton：

```tsx
{/* 在 Send 按钮的 TooltipSimple 之前添加 */}
<AttachmentButton
  onFileSelected={handleAttachmentSelected}
  disabled={disabled || isLoading || isUploading}
/>

{/* 原有的 Send 按钮 */}
<TooltipSimple content={isLoading ? "Stop generation" : "Send message (⌘+Enter)"} side="top">
  {/* ... 原有代码 ... */}
</TooltipSimple>
```

**Step 5: 添加错误提示 UI（可选）**

在输入框区域添加错误提示：

```tsx
{/* 在输入框上方或下方添加 */}
{uploadError && (
  <div className="text-red-500 text-sm px-3 py-1.5 bg-red-50 dark:bg-red-900/20 rounded">
    ⚠️ {uploadError}
  </div>
)}
```

**Step 6: 测试集成**

1. 启动开发服务器
2. 点击 📎 按钮，验证菜单显示
3. 选择文件，验证上传成功
4. 检查 prompt 中是否插入了文件路径
5. 检查控制台是否有错误

**Step 7: Commit**

```bash
git add frontend/src/components/FloatingPromptInput.tsx
git commit -m "feat(upload): integrate attachment upload to FloatingPromptInput"
```

---

## Task 7: 样式优化和响应式调整

**Files:**
- Modify: `frontend/src/components/FloatingPromptInput/AttachmentButton.tsx`
- Modify: `frontend/src/components/FloatingPromptInput/AttachmentMenu.tsx`

**Step 1: 优化移动端菜单位置**

在 AttachmentMenu.tsx 中，调整菜单定位逻辑，确保移动端不会超出屏幕：

```tsx
// 在 motion.div 中添加更智能的定位
<motion.div
  initial={{ opacity: 0, y: 10, scale: 0.95 }}
  animate={{ opacity: 1, y: 0, scale: 1 }}
  exit={{ opacity: 0, y: 10, scale: 0.95 }}
  transition={{ duration: 0.15 }}
  className="absolute bottom-full right-0 mb-2 z-50"
  style={{
    // 移动端调整：确保不超出屏幕
    maxWidth: 'calc(100vw - 32px)',
  }}
>
  {/* 菜单内容 */}
</motion.div>
```

**Step 2: 添加上传中状态指示**

在 AttachmentButton.tsx 中添加上传中的视觉反馈：

```tsx
// 修改按钮，添加 isUploading prop
interface AttachmentButtonProps {
  onFileSelected: (file: File) => void;
  disabled?: boolean;
  isUploading?: boolean; // 新增
}

export const AttachmentButton: React.FC<AttachmentButtonProps> = ({
  onFileSelected,
  disabled = false,
  isUploading = false, // 新增
}) => {
  // ... 其他代码 ...

  return (
    <div ref={buttonRef} className="relative">
      <TooltipSimple content={isUploading ? "上传中..." : "添加附件"} side="top">
        <button
          onClick={handleButtonClick}
          disabled={disabled || isUploading}
          className={`
            h-8 w-8 rounded-md flex items-center justify-center
            transition-colors duration-150
            ${disabled || isUploading
              ? 'text-gray-400 cursor-not-allowed'
              : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800'
            }
          `}
          aria-label={isUploading ? "上传中..." : "添加附件"}
        >
          {isUploading ? (
            <div className="animate-spin h-4 w-4 border-2 border-gray-400 border-t-transparent rounded-full" />
          ) : (
            <Paperclip className="h-4 w-4" />
          )}
        </button>
      </TooltipSimple>

      {/* ... 菜单 ... */}
    </div>
  );
};
```

**Step 3: 更新 FloatingPromptInput 传递 isUploading**

```tsx
<AttachmentButton
  onFileSelected={handleAttachmentSelected}
  disabled={disabled || isLoading}
  isUploading={isUploading}
/>
```

**Step 4: Commit**

```bash
git add frontend/src/components/FloatingPromptInput/AttachmentButton.tsx
git add frontend/src/components/FloatingPromptInput/AttachmentMenu.tsx
git add frontend/src/components/FloatingPromptInput.tsx
git commit -m "feat(upload): add upload status indicator and mobile optimizations"
```

---

## Task 8: 错误处理和用户反馈

**Files:**
- Modify: `frontend/src/components/FloatingPromptInput.tsx`

**Step 1: 改进错误处理**

增强 handleAttachmentSelected 的错误处理：

```tsx
const handleAttachmentSelected = async (file: File) => {
  try {
    setUploadError(null);
    setIsUploading(true);

    // 获取 WebSocket 服务器端口
    const serverPort = (window as any).__ROPCODE_SERVER_PORT__ || 3001;

    console.log(`[FloatingPromptInput] Uploading file: ${file.name} (${formatFileSize(file.size)})`);

    // 上传文件
    const { filePath, filename } = await uploadAttachment(file, projectPath, serverPort);

    console.log(`[FloatingPromptInput] Upload successful: ${filePath}`);

    // 插入文件路径到 prompt
    setPrompt((prev) => {
      const newPrompt = prev + `@${filePath} `;
      return newPrompt;
    });

    // 自动聚焦输入框
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    }, 0);

    // 可选：显示成功提示（3 秒后自动消失）
    // 这里可以使用 toast 库或自定义提示

  } catch (error) {
    console.error('[FloatingPromptInput] Upload failed:', error);
    const errorMessage = error instanceof Error ? error.message : '上传失败，请重试';
    setUploadError(errorMessage);

    // 5 秒后自动清除错误
    setTimeout(() => {
      setUploadError(null);
    }, 5000);
  } finally {
    setIsUploading(false);
  }
};
```

**Step 2: 添加 formatFileSize import**

```tsx
import { uploadAttachment, formatFileSize } from '../lib/upload';
```

**Step 3: 改进错误提示 UI**

使用更好的错误提示样式：

```tsx
{uploadError && (
  <motion.div
    initial={{ opacity: 0, y: -10 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -10 }}
    className="absolute top-0 left-0 right-0 mx-4 mt-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg shadow-sm z-10"
  >
    <div className="flex items-start gap-2">
      <span className="text-red-500 text-sm flex-shrink-0">⚠️</span>
      <span className="text-red-700 dark:text-red-300 text-sm flex-1">
        {uploadError}
      </span>
      <button
        onClick={() => setUploadError(null)}
        className="text-red-400 hover:text-red-600 dark:hover:text-red-200 text-sm"
      >
        ✕
      </button>
    </div>
  </motion.div>
)}
```

**Step 4: Commit**

```bash
git add frontend/src/components/FloatingPromptInput.tsx
git commit -m "feat(upload): improve error handling and user feedback"
```

---

## Task 9: 测试和文档

**Files:**
- Create: `docs/features/attachment-upload.md`

**Step 1: 创建功能文档**

```markdown
# 附件上传功能使用指南

## 概述

附件上传功能允许用户在与 AI 聊天时上传任意文件（图片、文档、代码等），文件会自动插入到消息中作为引用。

## 使用方法

### 桌面端

1. 在消息输入框右下角找到 📎 附件按钮
2. 点击按钮
3. 选择"浏览文件"
4. 在文件选择器中选择要上传的文件
5. 文件路径会自动插入到输入框中（格式：`@文件路径`）
6. 继续编辑或直接发送消息

### 移动端

1. 点击 📎 附件按钮
2. 选择上传方式：
   - **浏览文件**：从文件系统选择任意文件
   - **拍照上传**：直接打开相机拍照
   - **相册选择**：从相册中选择图片
3. 文件路径会自动插入到输入框中
4. 继续编辑或发送消息

## 文件限制

- 最大文件大小：50MB
- 支持文件类型：所有类型
- 存储位置：`~/.claude/attachments/`

## 文件命名

上传的文件会自动重命名为：`时间戳_原文件名`

例如：`20260301-123456_document.pdf`

## 常见问题

### Q: 上传的文件在哪里？
A: 所有上传的文件都保存在 `~/.claude/attachments/` 目录下

### Q: 为什么上传失败？
A: 可能的原因：
- 文件大小超过 50MB
- 网络连接问题
- 服务器磁盘空间不足

### Q: 移动端看不到相机/相册选项？
A: 系统会自动检测设备类型，桌面端只显示"浏览文件"选项

## 技术细节

### 上传流程

1. 前端使用 HTML5 File API 选择文件
2. 通过 HTTP POST multipart/form-data 上传到 `/api/upload-attachment`
3. 后端保存文件到 `~/.claude/attachments/` 目录
4. 返回文件路径
5. 前端将路径插入到 prompt 中

### 安全措施

- 文件名清理：移除特殊字符，防止路径遍历
- 大小限制：强制 50MB 上限
- 时间戳前缀：避免文件名冲突
```

**Step 2: 手动测试清单**

在不同平台上测试：

- [ ] macOS 桌面端浏览文件上传
- [ ] iOS Safari 拍照上传
- [ ] iOS Safari 相册选择
- [ ] Android Chrome 浏览文件上传
- [ ] Android Chrome 拍照上传
- [ ] 上传超过 50MB 的文件（应该失败）
- [ ] 上传包含特殊字符的文件名
- [ ] 网络断开时上传（应该显示错误）
- [ ] 连续上传多个文件

**Step 3: Commit**

```bash
git add docs/features/attachment-upload.md
git commit -m "docs: add attachment upload feature documentation"
```

---

## Task 10: 最终验证和清理

**Step 1: 代码审查清单**

- [ ] 所有 TypeScript 类型正确
- [ ] 没有 console.log（除了必要的日志）
- [ ] 错误处理完善
- [ ] 用户反馈清晰
- [ ] 移动端和桌面端都测试通过
- [ ] 没有硬编码的端口号或路径
- [ ] 代码格式化一致

**Step 2: 运行格式化和 lint**

```bash
cd frontend
npm run format  # 或 prettier
npm run lint    # 或 eslint

cd ..
go fmt ./internal/websocket/...
```

**Step 3: 最终提交**

```bash
git add -A
git commit -m "chore: final cleanup for attachment upload feature"
```

---

## 完成标准

- [ ] 后端 HTTP 端点正常工作
- [ ] 前端组件正常渲染
- [ ] 文件上传成功并返回路径
- [ ] 路径正确插入到 prompt
- [ ] 桌面端和移动端都能使用
- [ ] 错误处理完善
- [ ] 文档完整
- [ ] 代码审查通过

## 后续扩展（可选）

- 添加上传进度条
- 支持拖放上传
- 文件预览功能
- 批量上传
- 文件管理界面
