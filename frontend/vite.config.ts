import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import fs from 'fs'

const platformModule = process.platform === 'win32'
  ? path.resolve(__dirname, './src/lib/platformWin.ts')
  : path.resolve(__dirname, './src/lib/platform.ts')

const diffPathModule = process.platform === 'win32'
  ? path.resolve(__dirname, './src/lib/diffPathWin.ts')
  : path.resolve(__dirname, './src/lib/diffPath.ts')

const pathUtilsModule = process.platform === 'win32'
  ? path.resolve(__dirname, './src/lib/pathUtilsWin.ts')
  : path.resolve(__dirname, './src/lib/pathUtils.ts')

// https://vitejs.dev/config/
export default defineConfig({
  base: './', // 使用相对路径，以便在 Electron file:// 协议下正确加载资源
  server: {
    port: 5174,
    strictPort: false,
    host: '0.0.0.0',
    // ROPCODE_NO_HMR=1 disables HMR — Vite still rebuilds on file changes but
    // the browser stays put until you manually reload. Useful when you want a
    // dev server that won't yank the page out from under you mid-test.
    hmr: process.env.ROPCODE_NO_HMR === '1'
      ? false
      : {
          protocol: 'ws',
          host: 'localhost',
        },
  },
  plugins: [
    react(),
    tailwindcss(),
    // Custom plugin to serve local files in dev mode
    {
      name: 'serve-local-files',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          // Handle requests with /local-file/ prefix
          if (req.url && req.url.startsWith('/local-file/')) {
            // Remove the /local-file prefix to get actual file path
            const filePath = decodeURIComponent(req.url.replace('/local-file', ''));

            console.log('[Vite Plugin] Serving local file:', filePath);

            // Security check: only allow specific directories
            const homeDir = process.env.HOME || '';
            const allowedPrefixes = [
              `${homeDir}/.ropcode/temp-images/`,
              `${homeDir}/.ropcode/`,
              '/Users/',
              '/tmp/',
            ];

            const allowed = allowedPrefixes.some(prefix => filePath.startsWith(prefix));
            if (!allowed) {
              console.error('[Vite Plugin] Forbidden path:', filePath);
              res.statusCode = 403;
              res.end('Forbidden');
              return;
            }

            // Check if file exists and serve it
            try {
              if (fs.existsSync(filePath)) {
                const ext = path.extname(filePath).toLowerCase();
                const mimeTypes: Record<string, string> = {
                  '.png': 'image/png',
                  '.jpg': 'image/jpeg',
                  '.jpeg': 'image/jpeg',
                  '.gif': 'image/gif',
                  '.webp': 'image/webp',
                  '.svg': 'image/svg+xml',
                  '.ico': 'image/x-icon',
                  '.bmp': 'image/bmp',
                };

                const contentType = mimeTypes[ext] || 'application/octet-stream';
                const fileData = fs.readFileSync(filePath);

                console.log('[Vite Plugin] File served successfully:', filePath, 'Size:', fileData.length);

                res.setHeader('Content-Type', contentType);
                res.statusCode = 200;
                res.end(fileData);
                return;
              } else {
                console.error('[Vite Plugin] File not found:', filePath);
              }
            } catch (err) {
              console.error('[Vite Plugin] Error serving file:', err);
            }

            res.statusCode = 404;
            res.end('File not found');
            return;
          }
          next();
        });
      },
    },
  ],
  resolve: {
    alias: {
      '@/lib/platform': platformModule,
      '@/lib/diffPath': diffPathModule,
      '@/lib/pathUtils': pathUtilsModule,
      '@': path.resolve(__dirname, './src'),
    },
  },
})
