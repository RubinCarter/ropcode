import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import fs from 'fs'

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    // 确保带查询参数的请求也能正���处理
    strictPort: false,
    hmr: {
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
          // Handle requests with /wails-local-file/ prefix
          if (req.url && req.url.startsWith('/wails-local-file/')) {
            // Remove the /wails-local-file prefix to get actual file path
            const filePath = decodeURIComponent(req.url.replace('/wails-local-file', ''));

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
      '@': path.resolve(__dirname, './src'),
    },
  },
})
