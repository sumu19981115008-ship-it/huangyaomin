import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

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

        // GET /api/level-list-c2（levels2 格式 C 组）
        server.middlewares.use('/api/level-list-c2', (req, res) => {
          const files = sortedLevelFiles(path.resolve(__dirname, 'levels_c2'));
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(files));
        });

        // POST /api/save-level-c2（levels2 格式 C 组）
        server.middlewares.use('/api/save-level-c2', (req, res) => {
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
              fs.writeFileSync(path.resolve(__dirname, 'levels_c2', filename), JSON.stringify(data, null, 0));
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true }));
            } catch (e) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: e.message }));
            }
          });
        });

        // POST /api/generate-level（图片 → 关卡 JSON）
        // body: { group, filename, imageBase64, difficulty, lanes, colors, boardW, boardH, slot }
        server.middlewares.use('/api/generate-level', (req, res) => {
          if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
          let body = '';
          req.on('data', c => { body += c; });
          req.on('end', () => {
            try {
              const { group, filename, imageBase64, difficulty, lanes, colors, boardW, boardH, slot } = JSON.parse(body);

              if (!filename || !/^level\d+\.json$/.test(filename)) {
                res.statusCode = 400; res.end(JSON.stringify({ error: '非法文件名' })); return;
              }
              const validGroups = ['a', 'b', 'c'];
              if (!validGroups.includes(group)) {
                res.statusCode = 400; res.end(JSON.stringify({ error: '非法组别' })); return;
              }

              // 把 base64 图片写到临时文件
              const tmpImg = path.resolve(__dirname, 'tools', '_tmp_input.png');
              const imgBuf = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
              fs.writeFileSync(tmpImg, imgBuf);

              const dirMap  = { a: 'levels_a2', b: 'levels_b2', c: 'levels_c2' };
              const outDir  = path.resolve(__dirname, dirMap[group] || 'levels_c2');
              const outFile = path.resolve(outDir, filename);
              const script  = path.resolve(__dirname, 'tools', 'level_generator.py');

              const result = spawnSync('python3', [
                script, tmpImg, outFile,
                '--difficulty', difficulty || 'medium',
                '--lanes',      String(lanes  || 3),
                '--colors',     String(colors || 0),
                '--board',      String(boardW || 20), String(boardH || 20),
                '--slot',       String(slot   || 5),
              ], { encoding: 'utf-8', timeout: 30000 });

              fs.unlinkSync(tmpImg);

              if (result.status !== 0) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: result.stderr || result.stdout || '生成失败' }));
                return;
              }

              // 读回生成的 JSON 返回给前端
              const generated = JSON.parse(fs.readFileSync(outFile, 'utf-8'));
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true, filename, data: generated, log: result.stdout }));
            } catch (e) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: e.message }));
            }
          });
        });

        // GET /api/level-list-b2（levels2 格式 B 组）
        server.middlewares.use('/api/level-list-b2', (req, res) => {
          const files = sortedLevelFiles(path.resolve(__dirname, 'levels_b2'));
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(files));
        });

        // POST /api/save-level-b2（levels2 格式 B 组）
        server.middlewares.use('/api/save-level-b2', (req, res) => {
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
              fs.writeFileSync(path.resolve(__dirname, 'levels_b2', filename), JSON.stringify(data, null, 0));
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
