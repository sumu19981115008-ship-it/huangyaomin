/**
 * 扩展网格搜索：分别测试每个目标关卡在不同参数下的通关情况
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { GameLogic } from '../src/GameLogic.js';
import { G } from '../src/constants.js';

const ROOT = resolve(import.meta.dirname, '..');
const { TOTAL_DIST } = G;

function bulletFlightFrames(bullet) {
  const { CELL, CANVAS_X, CANVAS_Y, CW, CH, LEN_BOTTOM, LEN_RIGHT, LEN_TOP } = G;
  const BULLET_SPEED = 14, TRACK_GAP = 22;
  const tx = CANVAS_X + bullet.col * CELL + CELL / 2;
  const ty = CANVAS_Y + bullet.row * CELL + CELL / 2;
  const p = bullet.fromPathPos; let sx, sy;
  if (p < LEN_BOTTOM) { sx = CANVAS_X + p; sy = CANVAS_Y + CH + TRACK_GAP; }
  else if (p < LEN_BOTTOM + LEN_RIGHT) { sx = CANVAS_X + CW + TRACK_GAP; sy = CANVAS_Y + CH - (p - LEN_BOTTOM); }
  else if (p < LEN_BOTTOM + LEN_RIGHT + LEN_TOP) { sx = CANVAS_X + CW - (p - LEN_BOTTOM - LEN_RIGHT); sy = CANVAS_Y - TRACK_GAP; }
  else { sx = CANVAS_X - TRACK_GAP; sy = CANVAS_Y + (p - LEN_BOTTOM - LEN_RIGHT - LEN_TOP); }
  return Math.max(1, Math.round(Math.sqrt((tx - sx) ** 2 + (ty - sy) ** 2) / BULLET_SPEED));
}

function computeReachable(logic) {
  const { GW, GH } = G; const grid = logic.grid; const r = new Set();
  for (let col = 0; col < GW; col++) {
    for (let row = GH - 1; row >= 0; row--) { if (grid[row]?.[col] != null) { r.add(grid[row][col]); break; } }
    for (let row = 0; row < GH; row++) { if (grid[row]?.[col] != null) { r.add(grid[row][col]); break; } }
  }
  for (let row = 0; row < GH; row++) {
    for (let col = GW - 1; col >= 0; col--) { if (grid[row]?.[col] != null) { r.add(grid[row][col]); break; } }
    for (let col = 0; col < GW; col++) { if (grid[row]?.[col] != null) { r.add(grid[row][col]); break; } }
  }
  return r;
}

function computeExposure(logic) {
  const { GW, GH, LEN_BOTTOM, LEN_RIGHT, LEN_TOP, CELL } = G;
  const grid = logic.grid; const m = {};
  const up = (c, p) => { if (!(c in m) || p < m[c]) m[c] = p; };
  for (let col = 0; col < GW; col++) {
    const pp = col * CELL;
    for (let row = GH - 1; row >= 0; row--) { if (grid[row]?.[col] != null) { up(grid[row][col], pp); break; } }
  }
  for (let row = 0; row < GH; row++) {
    const pp = LEN_BOTTOM + (GH - 1 - row) * CELL;
    for (let col = GW - 1; col >= 0; col--) { if (grid[row]?.[col] != null) { up(grid[row][col], pp); break; } }
  }
  for (let col = 0; col < GW; col++) {
    const pp = LEN_BOTTOM + LEN_RIGHT + (GW - 1 - col) * CELL;
    for (let row = 0; row < GH; row++) { if (grid[row]?.[col] != null) { up(grid[row][col], pp); break; } }
  }
  for (let row = 0; row < GH; row++) {
    const pp = LEN_BOTTOM + LEN_RIGHT + LEN_TOP + row * CELL;
    for (let col = 0; col < GW; col++) { if (grid[row]?.[col] != null) { up(grid[row][col], pp); break; } }
  }
  return m;
}

function simulate(data, baseW, ammoScale, minFree) {
  const logic = new GameLogic();
  logic.loadLevel(data);
  const inFlight = [];
  let frames = 0;
  const MAX = 200000, SAFE = 28;

  while (logic.state === 'playing' && frames < MAX) {
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

    if (!logic.isTrackFull() && !logic.turrets.some(t => !t.lapComplete && t.pathPos < SAFE)) {
      const colorCount = {};
      for (const b of logic.blocks) colorCount[b.color] = (colorCount[b.color] ?? 0) + 1;
      const cands = [];
      for (let li = 0; li < logic.lanes.length; li++) {
        const lane = logic.lanes[li]; if (!lane.length) continue;
        const t = lane[0]; if ((colorCount[t.color] ?? 0) === 0) continue;
        cands.push({ source: 'lane', laneIdx: li, color: t.color, ammo: t.ammo });
      }
      for (let bi = 0; bi < logic.buffer.length; bi++) {
        const t = logic.buffer[bi]; if ((colorCount[t.color] ?? 0) === 0) continue;
        cands.push({ source: 'buffer', bufferIdx: bi, color: t.color, ammo: t.ammo });
      }
      if (!cands.length) { logic.update(); for (const b of logic.flushPendingBullets()) inFlight.push({ landFrame: frames + bulletFlightFrames(b), ...b }); continue; }

      const reachable = computeReachable(logic);
      const exposureMap = computeExposure(logic);
      const trackColorCount = {};
      for (const t of logic.turrets) trackColorCount[t.color] = (trackColorCount[t.color] || 0) + 1;
      const colorAmmo = {};
      for (const lane of logic.lanes) for (const t of lane) colorAmmo[t.color] = (colorAmmo[t.color] ?? 0) + t.ammo;
      for (const t of logic.buffer) colorAmmo[t.color] = (colorAmmo[t.color] ?? 0) + t.ammo;

      const soonDone = logic.turrets.filter(t => !t.lapComplete && t.ammo > 0 && t.pathPos >= TOTAL_DIST * 0.8).length;
      if (logic.buffer.length + soonDone >= logic.bufferCap - 1) {
        const bufC = cands.filter(c => c.source === 'buffer');
        if (bufC.length > 0) {
          const rBuf = bufC.filter(c => reachable.has(c.color));
          const pool = rBuf.length > 0 ? rBuf : bufC;
          pool.sort((a, b) => a.ammo - b.ammo);
          const ch = pool[0];
          if (ch.source === 'buffer') logic.deployFromBuffer(ch.bufferIdx); else logic.deployFromLane(ch.laneIdx);
          logic.update(); for (const b of logic.flushPendingBullets()) inFlight.push({ landFrame: frames + bulletFlightFrames(b), ...b }); continue;
        }
      }

      const reachPool = cands.filter(c => reachable.has(c.color));
      const inFallback = reachPool.length === 0;
      const trackUsed = logic.turrets.length;
      const trackCap = logic.trackCap ?? 5;
      const freeSlots = trackCap - trackUsed;
      const reachLanes = reachPool.length;

      const unlockPool = [];
      if (!inFallback && freeSlots >= minFree) {
        for (let li = 0; li < logic.lanes.length; li++) {
          const lane = logic.lanes[li]; if (lane.length < 2) continue;
          const head = lane[0];
          if (reachable.has(head.color)) continue;
          if ((colorCount[head.color] ?? 0) === 0) continue;
          if ((trackColorCount[head.color] || 0) > 0) continue;
          let hasBehind = false;
          for (let j = 1; j <= Math.min(10, lane.length - 1); j++) { if (reachable.has(lane[j].color)) { hasBehind = true; break; } }
          if (!hasBehind) continue;
          unlockPool.push({ source: 'lane', laneIdx: li, color: head.color, ammo: head.ammo, _unlock: true });
        }
      }

      const use = inFallback ? cands : [...reachPool, ...unlockPool];
      for (const c of use) {
        const blockCount = colorCount[c.color] ?? 0, ammoSum = colorAmmo[c.color] ?? 0;
        let score = 1 / (1 + Math.abs(ammoSum - blockCount));
        const onTrack = trackColorCount[c.color] || 0;
        if (onTrack > 0) score *= Math.pow(0.6, onTrack);
        const ep = exposureMap[c.color] ?? TOTAL_DIST;
        score *= 1 / (1 + ep / (TOTAL_DIST * 2));
        if (c._unlock) {
          const slotPenalty = 1 / (1 + Math.max(0, reachLanes - freeSlots + 1));
          score *= baseW * (1 / (1 + c.ammo / ammoScale)) * slotPenalty;
        }
        c.score = score;
      }
      use.sort((a, b) => { const ds = b.score - a.score; if (Math.abs(ds) > 1e-9) return ds; if (a.source === 'buffer' && b.source !== 'buffer') return -1; if (b.source === 'buffer' && a.source !== 'buffer') return 1; return 0; });
      const chosen = use[0];
      if (chosen.source === 'buffer') logic.deployFromBuffer(chosen.bufferIdx); else logic.deployFromLane(chosen.laneIdx);
    }
    logic.update();
    for (const b of logic.flushPendingBullets()) inFlight.push({ landFrame: frames + bulletFlightFrames(b), ...b });
  }
  return frames >= MAX ? 'stuck' : logic.state;
}

// 分别列出每个关卡在哪些参数下能通
const targets = [
  { dir: 'levels_b2', n: 24 },
  { dir: 'levels_a2', n: 216 },
  { dir: 'levels_a2', n: 218 },
  { dir: 'levels_a2', n: 231 },
  { dir: 'levels_b2', n: 40 },
  { dir: 'levels_b2', n: 41 },
  { dir: 'levels_a2', n: 137 },
  { dir: 'levels_a2', n: 170 },
];

const allData = {};
for (const { dir, n } of targets) {
  allData[dir + '_' + n] = JSON.parse(readFileSync(resolve(ROOT, dir, 'level' + n + '.json'), 'utf8'));
}

const baseWs     = [0.05, 0.08, 0.1, 0.12, 0.15, 0.2, 0.3];
const ammoScales = [10, 15, 20, 30, 40];
const minFrees   = [1, 2, 3];

// 记录每个参数组合下的通关集合
const results = new Map();
for (const baseW of baseWs) {
  for (const ammoScale of ammoScales) {
    for (const minFree of minFrees) {
      const key = `${baseW}_${ammoScale}_${minFree}`;
      const wins = new Set();
      for (const { dir, n } of targets) {
        const r = simulate(allData[dir + '_' + n], baseW, ammoScale, minFree);
        if (r === 'win') wins.add(dir.slice(-2) + n);
      }
      results.set(key, { baseW, ammoScale, minFree, wins });
    }
  }
}

// 找出 b2_24 必须赢的参数
console.log('\n=== b2_24 能通的参数组合 ===');
for (const [key, v] of results) {
  if (v.wins.has('b2_24')) {
    const total = v.wins.size;
    console.log(`baseW=${v.baseW} ammoScale=${v.ammoScale} minFree=${v.minFree} -> 通关: ${[...v.wins].join(',')} (${total}/${targets.length})`);
  }
}

// 找全胜组合
console.log('\n=== 全部通关的参数 ===');
for (const [key, v] of results) {
  if (v.wins.size === targets.length) {
    console.log(`baseW=${v.baseW} ammoScale=${v.ammoScale} minFree=${v.minFree}`);
  }
}
