import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  server: {
    port: 5174,
    plugins: [],
  },
  plugins: [
    {
      name: 'editor-api',
      configureServer(server) {
        // POST /api/save-level  body: { filename: 'level1.json', data: {...} }
        server.middlewares.use('/api/save-level', (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end('Method Not Allowed');
            return;
          }
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              const { filename, data } = JSON.parse(body);
              if (!filename || !/^level\d+\.json$/.test(filename)) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: '非法文件名' }));
                return;
              }
              const filepath = path.resolve(__dirname, 'levels', filename);
              fs.writeFileSync(filepath, JSON.stringify(data, null, 0));
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true }));
            } catch (e) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: e.message }));
            }
          });
        });

        // GET /api/level-list  返回所有关卡文件名列表
        server.middlewares.use('/api/level-list', (req, res) => {
          const dir = path.resolve(__dirname, 'levels');
          const files = fs.readdirSync(dir)
            .filter(f => /^level\d+\.json$/.test(f))
            .sort((a, b) => {
              const n = s => parseInt(s.replace(/\D/g, ''));
              return n(a) - n(b);
            });
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(files));
        });
      },
    },
  ],
  build: {
    outDir: 'dist',
    copyPublicDir: false,
  },
});
