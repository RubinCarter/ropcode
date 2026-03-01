# 附件上传功能设计文档

## 概述

为消息输入框添加附件上传功能，支持桌面端和移动端多种场景，使用 HTTP multipart/form-data 上传，文件保存到临时目录。

## 需求

### 功能需求
- 支持任意文件类型上传（图片、文本、PDF、代码等）
- 支持三种使用场景：
  1. PC 端复制图片（已有，需保留）
  2. 移动端相机拍照上传
  3. 移动端相册/文件系统选择
- 文件上传后自动插入到 prompt 中作为引用

### 非功能需求
- 文件大小限制：50MB
- 上传方式：HTTP multipart/form-data
- 存储位置：`~/.claude/attachments/`
- 支持跨平台：桌面端（Electron/Web）、移动端（iOS/Android）

## UI/UX 设计

### 附件按钮
- **位置**：FloatingPromptInput 输入框右下角，Send 按钮左侧
- **图标**：📎 (Paperclip)
- **交互**：
  - 桌面端：悬停显示 tooltip "添加附件"
  - 移动端：直接点击可用

### 菜单布局
点击附件按钮后，弹出菜单（向上展开）：

```
┌─────────────────────┐
│ 📁 浏览文件         │ ← 桌面端/移动端都有
├─────────────────────┤
│ 📷 拍照上传         │ ← 仅移动端显示
├─────────────────────┤
│ 🖼️ 相册选择         │ ← 仅移动端显示
└─────────────────────┘
```

### 设备检测
- 使用 `window.matchMedia('(pointer: coarse)')` 检测触摸设备
- 使用 User-Agent 辅助判断（iOS/Android）
- 移动端显示完整菜单（3 个选项）
- 桌面端只显示"浏览文件"选项

## 技术架构

### 组件结构

```
FloatingPromptInput.tsx
├── <AttachmentButton> (新增)
│   ├── Props:
│   │   - onFileSelected: (file: File) => void
│   │   - disabled: boolean
│   ├── State:
│   │   - isMenuOpen: boolean
│   └── 渲染 📎 按钮，控制菜单显示
│
└── <AttachmentMenu> (新增)
    ├── Props:
    │   - isOpen: boolean
    │   - onClose: () => void
    │   - onFileSelected: (file: File) => void
    ├── 功能:
    │   - 检测设备类型（移动端/桌面端）
    │   - 渲染对应的菜单选项
    │   - 使用隐藏的 <input type="file"> 触发选择
    └── 文件选择器配置:
        - 浏览文件：accept="*/*"
        - 拍照上传：accept="image/*" capture="environment"
        - 相册选择：accept="image/*"
```

### 前端实现

#### 文件上传流程
```tsx
const handleAttachmentSelected = async (file: File) => {
  try {
    // 1. 文件大小检查
    if (file.size > 50 * 1024 * 1024) {
      throw new Error('文件大小不能超过 50MB');
    }

    // 2. 显示上传进度（可选）
    setUploadProgress(0);

    // 3. 构建 FormData
    const formData = new FormData();
    formData.append('file', file);
    if (projectPath) {
      formData.append('projectPath', projectPath);
    }

    // 4. HTTP 上传
    const response = await fetch(
      `http://localhost:${serverPort}/api/upload-attachment`,
      {
        method: 'POST',
        body: formData,
      }
    );

    if (!response.ok) {
      throw new Error('上传失败');
    }

    // 5. 获取返回的文件路径
    const { filePath } = await response.json();

    // 6. 插入到 prompt
    setPrompt(prev => prev + `@${filePath} `);

  } catch (error) {
    // 7. 错误处理
    console.error('Upload failed:', error);
    setUploadError(error.message);
  } finally {
    // 8. 清除进度
    setUploadProgress(null);
  }
};
```

#### HTML5 Input 配置
```tsx
// 浏览文件（通用）
<input
  type="file"
  accept="*/*"
  style={{ display: 'none' }}
  ref={fileInputRef}
  onChange={handleFileChange}
/>

// 拍照上传（移动端）
<input
  type="file"
  accept="image/*"
  capture="environment"  // 直接打开后置摄像头
  style={{ display: 'none' }}
  ref={cameraInputRef}
  onChange={handleFileChange}
/>

// 相册选择（移动端）
<input
  type="file"
  accept="image/*"  // 不带 capture，打开相册
  style={{ display: 'none' }}
  ref={photoInputRef}
  onChange={handleFileChange}
/>
```

### 后端实现

#### HTTP 端点
在 `internal/websocket/server.go` 添加新路由：

```go
// 在 Start() 方法中注册路由
mux.HandleFunc("/api/upload-attachment", s.handleUploadAttachment)
```

#### 文件上传处理器
```go
func (s *Server) handleUploadAttachment(w http.ResponseWriter, r *http.Request) {
  // 1. 验证请求方法
  if r.Method != "POST" {
    http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
    return
  }

  // 2. 解析 multipart form (最大 50MB)
  err := r.ParseMultipartForm(50 << 20)
  if err != nil {
    http.Error(w, "Failed to parse form", http.StatusBadRequest)
    return
  }

  // 3. 获取上传的文件
  file, header, err := r.FormFile("file")
  if err != nil {
    http.Error(w, "Failed to read file", http.StatusBadRequest)
    return
  }
  defer file.Close()

  // 4. 获取可选的 projectPath
  projectPath := r.FormValue("projectPath")

  // 5. 生成安全的文件名：timestamp_originalname
  timestamp := time.Now().Format("20060102-150405")
  safeFilename := sanitizeFilename(header.Filename)
  finalFilename := fmt.Sprintf("%s_%s", timestamp, safeFilename)

  // 6. 确保存储目录存在
  homeDir, _ := os.UserHomeDir()
  attachmentsDir := filepath.Join(homeDir, ".claude", "attachments")
  os.MkdirAll(attachmentsDir, 0755)

  // 7. 创建目标文件
  destPath := filepath.Join(attachmentsDir, finalFilename)
  dest, err := os.Create(destPath)
  if err != nil {
    http.Error(w, "Failed to save file", http.StatusInternalServerError)
    return
  }
  defer dest.Close()

  // 8. 写入文件内容
  _, err = io.Copy(dest, file)
  if err != nil {
    http.Error(w, "Failed to write file", http.StatusInternalServerError)
    return
  }

  // 9. 返回文件路径
  w.Header().Set("Content-Type", "application/json")
  json.NewEncoder(w).Encode(map[string]string{
    "filePath": destPath,
    "filename": finalFilename,
  })
}

// 文件名清理函数（防止路径遍历）
func sanitizeFilename(filename string) string {
  // 移除路径分隔符
  filename = filepath.Base(filename)
  // 移除特殊字符
  filename = strings.Map(func(r rune) rune {
    if r == filepath.Separator || r == '\\' || r == '/' {
      return -1
    }
    return r
  }, filename)
  return filename
}
```

## 数据流

### 完整上传流程
```
1. 用户点击 📎 按钮
   ↓
2. 显示菜单（根据设备类型）
   ↓
3. 用户选择选项（浏览文件/拍照/相册）
   ↓
4. 触发 <input type="file"> 打开文件选择器
   ↓
5. 用户选择文件
   ↓
6. handleAttachmentSelected(file: File) 被调用
   ↓
7. 前端检查文件大小（< 50MB）
   ↓
8. 显示上传进度 UI（可选）
   ↓
9. 构建 FormData 并发送 HTTP POST /api/upload-attachment
   ↓
10. 后端接收文件并保存到 ~/.claude/attachments/
   ↓
11. 后端返回 { filePath, filename }
   ↓
12. 前端将文件路径插入到 prompt: "@{filePath} "
   ↓
13. 用户继续编辑或发送消息
```

## 错误处理

### 前端错误处理
- **文件大小超限**：在上传前检查，显示错误提示
- **上传失败**：捕获网络错误，显示 toast 通知
- **网络超时**：设置合理的超时时间（30 秒）
- **用户取消**：清理状态，不显示错误

### 后端错误处理
- **文件格式验证**：检查文件扩展名（可选）
- **路径遍历防护**：使用 `filepath.Base()` 和 `sanitizeFilename()`
- **磁盘空间检查**：写入前检查可用空间（可选）
- **权限错误**：确保 ~/.claude/attachments/ 目录可写

## 安全考虑

### 文件名安全
- 使用 `filepath.Base()` 提取基础文件名，防止路径遍历
- 移除特殊字符（`/`, `\`, `..` 等）
- 添加时间戳前缀，避免文件名冲突

### 文件大小限制
- 前端检查：50MB
- 后端强制限制：`ParseMultipartForm(50 << 20)`

### MIME 类型验证（可选）
- 检查文件实际 MIME 类型，防止扩展名伪造
- 使用 `http.DetectContentType()` 或第三方库

### 文件类型白名单（可选）
```go
var allowedExtensions = map[string]bool{
  ".jpg": true, ".jpeg": true, ".png": true, ".gif": true,
  ".pdf": true, ".txt": true, ".md": true,
  ".js": true, ".ts": true, ".py": true, ".go": true,
  ".json": true, ".xml": true, ".csv": true,
}

func isAllowedFileType(filename string) bool {
  ext := strings.ToLower(filepath.Ext(filename))
  return allowedExtensions[ext]
}
```

## 移动端特殊处理

### iOS Safari
- `capture="environment"` 属性在 iOS 上会直接打开摄像头
- `accept="image/*"` 不带 capture 会打开相册选择器
- 文件选择后立即触发上传，避免后台进程被杀

### Android Chrome
- 支持 `capture` 属性，行为与 iOS 类似
- 可能需要用户授权相机/存储权限

### 设备检测
```tsx
const isMobile = () => {
  return window.matchMedia('(pointer: coarse)').matches ||
         /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
};
```

## 状态管理

### FloatingPromptInput 新增状态
```tsx
const [uploadProgress, setUploadProgress] = useState<number | null>(null);
const [uploadError, setUploadError] = useState<string | null>(null);
```

### 上传进度 UI（可选）
```tsx
{uploadProgress !== null && (
  <div className="upload-progress">
    <progress value={uploadProgress} max="100" />
    <span>{uploadProgress.toFixed(0)}%</span>
  </div>
)}
```

## 兼容性

### 现有功能保留
- ✅ 粘贴图片功能（handlePaste）继续工作
- ✅ 拖放图片功能继续工作
- ✅ @ FilePicker 继续工作
- ✅ 不影响现有的消息发送流程

### 多客户端同步
- 附件上传后插入的 `@文件路径` 会随用户消息一起发送
- 其他客户端收到消息时，会看到文件引用
- Claude 可以访问 ~/.claude/attachments/ 中的文件

## 测试计划

### 功能测试
- [ ] 桌面端浏览文件上传
- [ ] 移动端拍照上传（iOS/Android）
- [ ] 移动端相册选择上传
- [ ] 文件大小限制验证（< 50MB）
- [ ] 文件名特殊字符处理
- [ ] 上传失败错误提示
- [ ] 多次连续上传

### 跨平台测试
- [ ] macOS Electron
- [ ] macOS Web (Chrome/Safari)
- [ ] iOS Safari
- [ ] Android Chrome
- [ ] Windows Electron
- [ ] Windows Web

### 性能测试
- [ ] 上传 1MB 文件
- [ ] 上传 10MB 文件
- [ ] 上传 50MB 文件（边界）
- [ ] 并发多个上传请求

## 实现顺序

1. **后端 HTTP 端点**（优先）
   - 添加 `/api/upload-attachment` 路由
   - 实现文件上传处理器
   - 文件名安全处理

2. **前端基础组件**
   - AttachmentButton 组件
   - AttachmentMenu 组件
   - 设备检测逻辑

3. **前端上传逻辑**
   - handleAttachmentSelected 实现
   - HTTP 上传请求
   - 错误处理

4. **UI 集成**
   - 集成到 FloatingPromptInput
   - 上传进度显示（可选）
   - 样式和动画

5. **测试和优化**
   - 多平台测试
   - 错误场景测试
   - 性能优化

## 未来扩展

### 可选增强功能
- 上传进度条显示
- 文件预览（图片/文档）
- 批量上传多个文件
- 拖放上传任意文件（扩展现有功能）
- 云存储集成（S3/OSS）
- 文件管理界面（查看/删除已上传文件）

### 架构改进
- 添加文件去重（哈希检查）
- 压缩大文件（图片/视频）
- CDN 加速（如果部署到云端）
- 文件过期清理机制

## 参考

### 现有实现
- `SavePastedImage` RPC：保存粘贴的图片到 ~/.claude/pasted-images/
- `handlePaste`：处理粘贴图片事件
- FilePicker 组件：选择项目文件

### 相关文件
- `frontend/src/components/FloatingPromptInput.tsx`
- `internal/websocket/server.go`
- `bindings.go`
