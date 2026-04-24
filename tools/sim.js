/**
 * 纯逻辑跑关模拟器（无渲染）
 *
 * 用法：
 *   node tools/sim.js [关卡目录] [起始关] [结束关]
 *
 * 示例：
 *   node tools/sim.js levels_a2 1 50       # 跑 A 组第 1~50 关
 *   node tools/sim.js levels_b2 1 167       # 跑 B 组全部
 *   node tools/sim.js levels_a2 13 13       # 只跑第 13 关（调试）
 *
 * 输出：每关的结果（win/fail/stuck）、帧数、无用车剔除次数
 */

import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = resolve(__dir, '..');

// ── 从 src/ 直接引入逻辑层 ────────────────────────────────────
import { GameLogic } from '../src/GameLogic.js';
import { G, SIDE }   from '../src/constants.js';

// ── 参数解析 ──────────────────────────────────────────────────
const [,, dir = 'levels_a2', fromStr = '1', toStr = '10'] = process.argv;
const fromIdx = parseInt(fromStr) - 1;  // 转 0-based
const toIdx   = parseInt(toStr)   - 1;

// ── 模拟器主循环 ──────────────────────────────────────────────
const MAX_FRAMES  = 200_000;  // 防无限循环
const TURRET_SPEED = 3;       // 与 constants.js 一致

function simulate(data) {
  const logic = new GameLogic();
  logic.loadLevel(data);

  let frames      = 0;
  let pruneCount  = 0;
  let deployCount = 0;

  while (logic.state === 'playing' && frames < MAX_FRAMES) {
    frames++;

    // 1. Bot 决策：尝试部署一辆车
    if (!logic.isTrackFull()) {
      const SAFE_GAP = 28;
      const blocked  = logic.turrets.some(t => !t.lapComplete && t.pathPos < SAFE_GAP);
      if (!blocked) {
        const candidate = pickCandidate(logic);
        if (candidate) {
          deploy(logic, candidate);
          deployCount++;
        }
      }
    }

    // 2. 炮车移动 + 子弹生成
    logic.update();

    // 3. 子弹瞬间命中（跳过飞行动画）
    const bullets = logic.flushPendingBullets();
    for (const b of bullets) {
      logic.onBulletHit(b.turretId, b.col, b.row);
      if (logic.state !== 'playing') break;
    }

    // 检测无用车剔除（通过 turrets 长度变化间接统计）
    // _pruneUselessTurrets 内置在 onBulletHit 里，无需额外调用
  }

  const stuck = frames >= MAX_FRAMES;
  return { result: stuck ? 'stuck' : logic.state, frames, deployCount,
           failReason: logic.failReason ?? null };
}

// ── Bot 决策（与 AutoBot.js 逻辑一致，无 Phaser 依赖） ────────

function countColors(logic) {
  const map = {};
  for (const b of logic.blocks) map[b.color] = (map[b.color] ?? 0) + 1;
  return map;
}

function computeReachable(logic) {
  const { GW, GH } = G;
  const grid = logic.grid;
  const set  = new Set();
  for (let col = 0; col < GW; col++) {
    for (let row = GH - 1; row >= 0; row--)
      if (grid[row]?.[col] != null) { set.add(grid[row][col]); break; }
    for (let row = 0; row < GH; row++)
      if (grid[row]?.[col] != null) { set.add(grid[row][col]); break; }
  }
  for (let row = 0; row < GH; row++) {
    for (let col = GW - 1; col >= 0; col--)
      if (grid[row]?.[col] != null) { set.add(grid[row][col]); break; }
    for (let col = 0; col < GW; col++)
      if (grid[row]?.[col] != null) { set.add(grid[row][col]); break; }
  }
  return set;
}

function pickCandidate(logic) {
  const colorCount = countColors(logic);
  const candidates = [];

  for (let i = 0; i < logic.buffer.length; i++) {
    const t = logic.buffer[i];
    if ((colorCount[t.color] ?? 0) === 0) continue;
    candidates.push({ source: 'buffer', bufferIdx: i, color: t.color, ammo: t.ammo,
                      idle: t.idleLastLap ?? false });
  }
  for (let li = 0; li < logic.lanes.length; li++) {
    const lane = logic.lanes[li];
    if (!lane.length) continue;
    const t = lane[0];
    if ((colorCount[t.color] ?? 0) === 0) continue;
    candidates.push({ source: 'lane', laneIdx: li, color: t.color, ammo: t.ammo, idle: false });
  }
  if (!candidates.length) return null;

  const reachable  = computeReachable(logic);
  const colorAmmo  = {};
  for (const c of candidates) colorAmmo[c.color] = (colorAmmo[c.color] ?? 0) + c.ammo;

  const pool = candidates.filter(c => reachable.has(c.color));
  const use  = pool.length > 0 ? pool : candidates;

  for (const c of use) {
    const blockCount = colorCount[c.color] ?? 0;
    const ammoSum    = colorAmmo[c.color]  ?? 0;
    c.score = 1 / (1 + Math.abs(ammoSum - blockCount));
  }
  use.sort((a, b) => {
    const ds = b.score - a.score;
    if (Math.abs(ds) > 1e-9) return ds;
    if (a.source === 'buffer' && b.source !== 'buffer') return -1;
    if (b.source === 'buffer' && a.source !== 'buffer') return  1;
    return 0;
  });
  return use[0];
}

function deploy(logic, c) {
  if (c.source === 'buffer') logic.deployFromBuffer(c.bufferIdx);
  else                       logic.deployFromLane(c.laneIdx);
}

// ── 批量跑关 ──────────────────────────────────────────────────

const levelDir = resolve(ROOT, dir);
let files;
try {
  files = readdirSync(levelDir)
    .filter(f => f.endsWith('.json'))
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+/)?.[0] ?? 0);
      const nb = parseInt(b.match(/\d+/)?.[0] ?? 0);
      return na - nb;
    });
} catch (e) {
  console.error(`目录不存在：${levelDir}`);
  process.exit(1);
}

const subset = files.slice(fromIdx, toIdx + 1);
console.log(`\n跑关范围：${dir}  第 ${fromIdx+1} ~ ${toIdx+1} 关（共 ${subset.length} 关）\n`);

const results = { win: 0, fail: 0, stuck: 0 };
const failList = [], stuckList = [];

for (let i = 0; i < subset.length; i++) {
  const file  = subset[i];
  const level = fromIdx + i + 1;
  let data;
  try {
    data = JSON.parse(readFileSync(resolve(levelDir, file), 'utf8'));
  } catch (e) {
    console.log(`  L${level}  [ERROR] 文件读取失败：${e.message}`);
    continue;
  }

  const { result, frames, deployCount, failReason } = simulate(data);
  results[result] = (results[result] ?? 0) + 1;

  const tag = result === 'win'   ? '✓' :
              result === 'fail'  ? '✗' : '?';
  const detail = result === 'fail'  ? `  失败原因：${failReason}` :
                 result === 'stuck' ? `  超过 ${MAX_FRAMES} 帧未结束` : '';
  console.log(`  L${String(level).padStart(3)}  [${tag}]  帧:${String(frames).padStart(6)}  部署:${String(deployCount).padStart(4)}${detail}`);

  if (result === 'fail')  failList.push(level);
  if (result === 'stuck') stuckList.push(level);
}

console.log(`\n── 汇总 ──────────────────────────────`);
console.log(`  通关 ✓  ${results.win  ?? 0}`);
console.log(`  失败 ✗  ${results.fail ?? 0}  ${failList.length  ? `(${failList.join(', ')})` : ''}`);
console.log(`  卡关 ?  ${results.stuck ?? 0}  ${stuckList.length ? `(${stuckList.join(', ')})` : ''}`);
console.log(`  合计     ${subset.length}\n`);
