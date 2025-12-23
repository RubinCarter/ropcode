#!/bin/bash
# scripts/migrate-imports.sh
# 将 wailsjs 导入替换为兼容层

FRONTEND_SRC="frontend/src"

echo "Migrating wailsjs imports to compatibility layer..."

# 替换 wailsjs/go/main/App 导入
find "$FRONTEND_SRC" -name "*.ts" -o -name "*.tsx" | xargs sed -i '' \
  "s|from ['\"].*wailsjs/go/main/App['\"]|from '@/lib/wails-compat'|g"

# 替换 wailsjs/runtime/runtime 导入（EventsOn, EventsOff 等）
find "$FRONTEND_SRC" -name "*.ts" -o -name "*.tsx" | xargs sed -i '' \
  "s|from ['\"].*wailsjs/runtime/runtime['\"]|from '@/lib/wails-events-compat'|g"

# 特殊处理：wails-api.ts 和 wails-events.ts 本身不需要替换
# 这些文件保留作为 Wails 模式的实现

echo "Done! Please review the changes."
echo "Files modified:"
git status --porcelain | grep "^ M"
