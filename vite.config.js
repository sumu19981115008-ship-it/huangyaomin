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

        // POST /api/regen-queue（仅重新生成炮车序列，不动画布）
        // body: { levelData, difficulty, lanes, slot, seed?, syncLanes? }
        server.middlewares.use('/api/regen-queue', (req, res) => {
          if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
          let body = '';
          req.on('data', c => { body += c; });
          req.on('end', () => {
            try {
              const { levelData, difficulty, lanes, slot, seed, syncLanes } = JSON.parse(body);
              const input  = JSON.stringify(levelData);
              const syncArg = syncLanes ? 'True' : 'False';
              const result = spawnSync('python3', [
                '-c',
                `import sys, json; sys.path.insert(0,'${path.resolve(__dirname,"tools").replace(/\\/g,"/")}'); ` +
                `from level_generator import regen_queue; ` +
                `d=json.loads(sys.stdin.read()); ` +
                `print(json.dumps(regen_queue(d,${JSON.stringify(difficulty||'medium')},${lanes||3},${slot||5},${seed||42},sync_lanes=${syncArg})))`,
              ], { input, encoding: 'utf-8', timeout: 15000 });

              if (result.status !== 0) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: result.stderr || '重新生成失败' }));
                return;
              }
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true, data: JSON.parse(result.stdout.trim()) }));
            } catch (e) {
              res.statusCode = 500; res.end(JSON.stringify({ error: e.message }));
            }
          });
        });

        // POST /api/delete-levels-{a2/b2/c2}（批量删除关卡）
        const makeDeleteHandler = (dir) => (req, res) => {
          if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
          let body = '';
          req.on('data', c => { body += c; });
          req.on('end', () => {
            try {
              const { filenames } = JSON.parse(body);
              if (!Array.isArray(filenames) || filenames.length === 0) {
                res.statusCode = 400; res.end(JSON.stringify({ error: '无效文件名列表' })); return;
              }
              const deleted = [];
              for (const filename of filenames) {
                if (!/^level\d+\.json$/.test(filename)) continue;
                const fp = path.resolve(__dirname, dir, filename);
                if (fs.existsSync(fp)) { fs.unlinkSync(fp); deleted.push(filename); }
              }
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true, deleted }));
            } catch (e) {
              res.statusCode = 500; res.end(JSON.stringify({ error: e.message }));
            }
          });
        };
        server.middlewares.use('/api/delete-levels-a2', makeDeleteHandler('levels_a2'));
        server.middlewares.use('/api/delete-levels-b2', makeDeleteHandler('levels_b2'));
        server.middlewares.use('/api/delete-levels-c2', makeDeleteHandler('levels_c2'));

        // POST /api/generate-level（图片 → 关卡 JSON）
        // body: { group, filename, imageBase64, difficulty, lanes, colors, boardW, boardH, slot, fixedPalette, syncLanes }
        server.middlewares.use('/api/generate-level', (req, res) => {
          if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
          let body = '';
          req.on('data', c => { body += c; });
          req.on('end', () => {
            try {
              const { group, filename, imageBase64, difficulty, lanes, colors, boardW, boardH, slot, fixedPalette, syncLanes } = JSON.parse(body);

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

              const pyArgs = [
                script, tmpImg, outFile,
                '--difficulty', difficulty || 'medium',
                '--lanes',      String(lanes  || 3),
                '--colors',     String(colors || 0),
                '--board',      String(boardW || 20), String(boardH || 20),
                '--slot',       String(slot   || 5),
              ];
              if (fixedPalette) pyArgs.push('--fixed-palette');
              if (syncLanes)    pyArgs.push('--sync-lanes');
              const result = spawnSync('python3', pyArgs, { encoding: 'utf-8', timeout: 30000 });

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
