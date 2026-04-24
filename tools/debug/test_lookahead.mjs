/**
 * 全量测试"队列穿透"策略
 * 策略：当队头颜色不可达时，往后找第一个可达颜色，把它提到队首再部署
 * （受 trackCap 限制，非强制部署）
 */
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

import { GameLogic } from '../src/GameLogic.js';
import { G } from '../src/constants.js';

const [,, dir = 'levels_b2', fromStr = '1', toStr = '167'] = process.argv;
const fromIdx = parseInt(fromStr) - 1;
const toIdx   = parseInt(toStr)   - 1;

const MAX_FRAMES = 200_000;

function bulletFlightFrames(bullet) {
  const { CELL, CANVAS_X, CANVAS_Y, CW, CH, LEN_BOTTOM, LEN_RIGHT, LEN_TOP } = G;
  const { col, row, fromPathPos } = bullet;
  const BULLET_SPEED = 14;
  const targetX = CANVAS_X + col * CELL + CELL / 2;
  const targetY = CANVAS_Y + row * CELL + CELL / 2;
  const TRACK_GAP = 22;
  let sx, sy;
  const p = fromPathPos;
  if (p < LEN_BOTTOM) { sx = CANVAS_X + p; sy = CANVAS_Y + CH + TRACK_GAP; }
  else if (p < LEN_BOTTOM + LEN_RIGHT) { sx = CANVAS_X + CW + TRACK_GAP; sy = CANVAS_Y + CH - (p - LEN_BOTTOM); }
  else if (p < LEN_BOTTOM + LEN_RIGHT + LEN_TOP) { sx = CANVAS_X + CW - (p - LEN_BOTTOM - LEN_RIGHT); sy = CANVAS_Y - TRACK_GAP; }
  else { sx = CANVAS_X - TRACK_GAP; sy = CANVAS_Y + (p - LEN_BOTTOM - LEN_RIGHT - LEN_TOP); }
  const dist = Math.sqrt((targetX - sx) ** 2 + (targetY - sy) ** 2);
  return Math.max(1, Math.round(dist / BULLET_SPEED));
}

function countColors(logic) {
  const map = {};
  for (const b of logic.blocks) map[b.color] = (map[b.color] ?? 0) + 1;
  return map;
}

function computeReachable(logic) {
  const { GW, GH } = G;
  const grid = logic.grid;
  const set = new Set();
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

// 穿透策略：队列头不可达时跳过，找到第一个可达颜色（最多向前看 LOOKAHEAD 个）
const LOOKAHEAD = 20; // 最多看多深

function pickCandidateLookahead(logic) {
  const colorCount = countColors(logic);
  const reachable = computeReachable(logic);
  const candidates = [];

  for (let i = 0; i < logic.buffer.length; i++) {
    const t = logic.buffer[i];
    if ((colorCount[t.color] ?? 0) === 0) continue;
    candidates.push({ source: 'buffer', bufferIdx: i, color: t.color, ammo: t.ammo });
  }

  for (let li = 0; li < logic.lanes.length; li++) {
    const lane = logic.lanes[li];
    // 找该队列中最浅的可达颜色
    let found = null;
    for (let ti = 0; ti < Math.min(lane.length, LOOKAHEAD); ti++) {
      const t = lane[ti];
      if ((colorCount[t.color] ?? 0) === 0) continue;
      if (reachable.has(t.color)) {
        found = { source: 'lane', laneIdx: li, lanePos: ti, color: t.color, ammo: t.ammo };
        break;
      }
    }
    // 找不到可达的，就用队首（避免死等）
    if (!found) {
      for (let ti = 0; ti < Math.min(lane.length, LOOKAHEAD); ti++) {
        const t = lane[ti];
        if ((colorCount[t.color] ?? 0) > 0) {
          found = { source: 'lane', laneIdx: li, lanePos: ti, color: t.color, ammo: t.ammo };
          break;
        }
      }
    }
    if (found) candidates.push(found);
  }

  if (!candidates.length) return null;

  const { TOTAL_DIST } = G;
  const soonDone = logic.turrets.filter(t => !t.lapComplete && t.ammo > 0 && t.pathPos >= TOTAL_DIST * 0.8).length;
  const bufferDanger = logic.buffer.length + soonDone >= logic.bufferCap - 1;
  if (bufferDanger) {
    const bufC = candidates.filter(c => c.source === 'buffer');
    if (bufC.length > 0) {
      const rb = bufC.filter(c => reachable.has(c.color));
      const pool = rb.length > 0 ? rb : bufC;
      pool.sort((a, b) => a.ammo - b.ammo);
      return pool[0];
    }
  }

  const colorAmmo = {};
  for (const c of candidates) colorAmmo[c.color] = (colorAmmo[c.color] ?? 0) + c.ammo;
  const trackColorCount = {};
  for (const t of logic.turrets) trackColorCount[t.color] = (trackColorCount[t.color] || 0) + 1;

  const reachPool = candidates.filter(c => reachable.has(c.color));
  const use = reachPool.length > 0 ? reachPool : candidates;

  for (const c of use) {
    const blockCount = colorCount[c.color] ?? 0;
    const ammoSum = colorAmmo[c.color] ?? 0;
    let score = 1 / (1 + Math.abs(ammoSum - blockCount));
    const onTrack = trackColorCount[c.color] || 0;
    if (onTrack > 0) score *= Math.pow(0.6, onTrack);
    c.score = score;
  }
  use.sort((a, b) => {
    const ds = b.score - a.score;
    if (Math.abs(ds) > 1e-9) return ds;
    if (a.source === 'buffer' && b.source !== 'buffer') return -1;
    if (b.source === 'buffer' && a.source !== 'buffer') return 1;
    return 0;
  });
  return use[0];
}

function deploy(logic, c) {
  if (c.source === 'buffer') return logic.deployFromBuffer(c.bufferIdx);
  // 穿透策略：如果不是队首，先把目标车移到队首
  if (c.lanePos > 0) {
    const lane = logic.lanes[c.laneIdx];
    const [target] = lane.splice(c.lanePos, 1);
    lane.unshift(target);
  }
  return logic.deployFromLane(c.laneIdx);
}

function simulate(data) {
  const logic = new GameLogic();
  logic.loadLevel(data);

  const inFlight = [];
  let frames = 0;

  while (logic.state === 'playing' && frames < MAX_FRAMES) {
    frames++;

    let i = 0;
    while (i < inFlight.length) {
      if (inFlight[i].landFrame <= frames) {
        const b = inFlight.splice(i, 1)[0];
        logic.onBulletHit(b.turretId, b.col, b.row);
        if (logic.state !== 'playing') break;
      } else i++;
    }
    if (logic.state !== 'playing') break;

    if (!logic.isTrackFull()) {
      const blocked = logic.turrets.some(t => !t.lapComplete && t.pathPos < 28);
      if (!blocked) {
        const c = pickCandidateLookahead(logic);
        if (c) deploy(logic, c);
      }
    }

    logic.update();
    for (const b of logic.flushPendingBullets()) {
      inFlight.push({ landFrame: frames + bulletFlightFrames(b), ...b });
    }
  }

  return { result: frames >= MAX_FRAMES ? 'stuck' : logic.state, frames, failReason: logic.failReason ?? null };
}

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
  console.error('目录不存在：' + levelDir);
  process.exit(1);
}

const subset = files.slice(fromIdx, toIdx + 1);
console.log('\n跑关范围：' + dir + '  第 ' + (fromIdx+1) + ' ~ ' + (toIdx+1) + ' 关（共 ' + subset.length + ' 关）穿透策略\n');

const results = { win: 0, fail: 0, stuck: 0 };
const failList = [], stuckList = [];

for (let i = 0; i < subset.length; i++) {
  const file = subset[i];
  const level = fromIdx + i + 1;
  let data;
  try {
    data = JSON.parse(readFileSync(resolve(levelDir, file), 'utf8'));
  } catch (e) {
    console.log('  L' + level + '  [ERROR]');
    continue;
  }

  const { result, frames, failReason } = simulate(data);
  results[result] = (results[result] ?? 0) + 1;

  const tag = result === 'win' ? '✓' : result === 'fail' ? '✗' : '?';
  const detail = result === 'fail' ? '  失败:' + failReason : result === 'stuck' ? '  超过' + MAX_FRAMES + '帧' : '';
  console.log('  L' + String(level).padStart(3) + '  [' + tag + ']  帧:' + String(frames).padStart(6) + detail);

  if (result === 'fail') failList.push(level);
  if (result === 'stuck') stuckList.push(level);
}

console.log('\n── 汇总（穿透策略） ──────────────────────');
console.log('  通关 ✓  ' + (results.win ?? 0));
console.log('  失败 ✗  ' + (results.fail ?? 0) + '  ' + (failList.length ? '(' + failList.join(', ') + ')' : ''));
console.log('  卡关 ?  ' + (results.stuck ?? 0) + '  ' + (stuckList.length ? '(' + stuckList.join(', ') + ')' : ''));
console.log('  合计     ' + subset.length);
