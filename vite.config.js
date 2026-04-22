import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function sortedLevelFiles(dir) {
  return fs.readdirSync(dir)
    .filter(f => /^level\d+\.json$/.test(f))
    .sort((a, b) => parseInt(a.replace(/\D/g, '')) - parseInt(b.replace(/\D/g, '')));
}

export default defineConfig({
  server: {
    port: 5174,
    plugins: [],
  },
  plugins: [
    {
      name: 'editor-api',
      configureServer(server) {

        // GET /api/level-list（旧格式，保留兼容）
        server.middlewares.use('/api/level-list', (req, res) => {
          const files = sortedLevelFiles(path.resolve(__dirname, 'levels'));
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(files));
        });

        // GET /api/level-list-a2（levels2 格式 A 组）
        server.middlewares.use('/api/level-list-a2', (req, res) => {
          const files = sortedLevelFiles(path.resolve(__dirname, 'levels_a2'));
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(files));
        });

        // POST /api/save-level（旧格式，保留兼容）
        server.middlewares.use('/api/save-level', (req, res) => {
          if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
          let body = '';
          req.on('data', c => { body += c; });
          req.on('end', () => {
            try {
              const { filename, data } = JSON.parse(body);
              if (!filename || !/^level\d+\.json$/.test(filename)) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: '非法文件名' }));
                return;
              }
              fs.writeFileSync(path.resolve(__dirname, 'levels', filename), JSON.stringify(data, null, 0));
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true }));
            } catch (e) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: e.message }));
            }
          });
        });

        // POST /api/save-level-a2（levels2 格式 A 组）
        server.middlewares.use('/api/save-level-a2', (req, res) => {
          if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
          let body = '';
          req.on('data', c => { body += c; });
          req.on('end', () => {
            try {
              const { filename, data } = JSON.parse(body);
              if (!filename || !/^level\d+\.json$/.test(filename)) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: '非法文件名' }));
                return;
              }
              fs.writeFileSync(path.resolve(__dirname, 'levels_a2', filename), JSON.stringify(data, null, 0));
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true }));
            } catch (e) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: e.message }));
            }
          });
        });
      },
    },
  ],
  build: {
    outDir: 'dist',
    copyPublicDir: false,
  },
});
