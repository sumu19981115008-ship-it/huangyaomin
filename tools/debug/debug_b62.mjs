import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

import { GameLogic } from '../src/GameLogic.js';
import { G } from '../src/constants.js';

const data = JSON.parse(readFileSync(resolve(ROOT, 'levels_b2/level62.json'), 'utf8'));

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

function pickCandidate(logic) {
  const colorCount = countColors(logic);
  const candidates = [];
  for (let i = 0; i < logic.buffer.length; i++) {
    const t = logic.buffer[i];
    if ((colorCount[t.color] ?? 0) === 0) continue;
    candidates.push({ source: 'buffer', bufferIdx: i, color: t.color, ammo: t.ammo });
  }
  for (let li = 0; li < logic.lanes.length; li++) {
    const lane = logic.lanes[li];
    if (!lane.length) continue;
    const t = lane[0];
    if ((colorCount[t.color] ?? 0) === 0) continue;
    candidates.push({ source: 'lane', laneIdx: li, color: t.color, ammo: t.ammo });
  }
  if (!candidates.length) return null;

  const reachable = computeReachable(logic);
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

const logic = new GameLogic();
logic.loadLevel(data);

const inFlight = [];
let frames = 0;
const MAX = 8000;
const SAFE_GAP = 28;
let lastBlockCount = logic.blocks.length;
let zeroProgressStart = -1;
const deployLog = [];

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

  if (!logic.isTrackFull()) {
    const blocked = logic.turrets.some(t => !t.lapComplete && t.pathPos < SAFE_GAP);
    if (!blocked) {
      const c = pickCandidate(logic);
      if (c) {
        deployLog.push({ frame: frames, color: c.color, source: c.source });
        if (c.source === 'buffer') logic.deployFromBuffer(c.bufferIdx);
        else logic.deployFromLane(c.laneIdx);
      }
    }
  }

  logic.update();
  for (const b of logic.flushPendingBullets()) {
    const delay = bulletFlightFrames(b);
    inFlight.push({ landFrame: frames + delay, ...b });
  }

  if (logic.blocks.length < lastBlockCount) {
    lastBlockCount = logic.blocks.length;
    zeroProgressStart = -1;
  } else if (zeroProgressStart === -1) {
    zeroProgressStart = frames;
  }

  if (zeroProgressStart > 0 && frames - zeroProgressStart === 300) {
    const reachable = computeReachable(logic);
    const colorCount = countColors(logic);
    console.log('\n[F' + frames + '] *** 零进度300帧，死锁分析 ***');
    console.log('blocks=' + logic.blocks.length + ' inFlight=' + inFlight.length);
    console.log('轨道:');
    for (const t of logic.turrets) {
      const reach = reachable.has(t.color) ? '可达' : '不可达';
      console.log('  ' + t.color.slice(1) + ' ammo=' + t.ammo + ' pos=' + Math.round(t.pathPos) + ' ' + reach);
    }
    console.log('暂存:');
    for (const t of logic.buffer) {
      const reach = reachable.has(t.color) ? '可达' : '不可达';
      console.log('  ' + t.color.slice(1) + ' ammo=' + t.ammo + ' idle=' + t.idleLastLap + ' ' + reach);
    }
    console.log('队列头部（前4个）:');
    for (let li = 0; li < logic.lanes.length; li++) {
      const head4 = logic.lanes[li].slice(0, 4).map(t => {
        const reach = reachable.has(t.color) ? '★' : '×';
        return reach + t.color.slice(1) + '(' + t.ammo + ')';
      }).join(' -> ');
      console.log('  L' + li + ': ' + head4);
    }
    console.log('可达颜色: ' + [...reachable].map(c => c.slice(1)).join(', '));

    console.log('\n可达颜色在队列中的最浅位置:');
    for (const color of reachable) {
      if ((colorCount[color] ?? 0) === 0) continue;
      let minPos = Infinity;
      let minLane = -1;
      for (let li = 0; li < logic.lanes.length; li++) {
        for (let ti = 0; ti < logic.lanes[li].length; ti++) {
          if (logic.lanes[li][ti].color === color && ti < minPos) {
            minPos = ti;
            minLane = li;
          }
        }
      }
      if (minLane >= 0) {
        const blockers = logic.lanes[minLane].slice(0, minPos).map(t => t.color.slice(1) + '(' + t.ammo + ')').join(', ');
        console.log('  ' + color.slice(1) + ': L' + minLane + '[' + minPos + '] 前面有: ' + blockers);
      } else {
        console.log('  ' + color.slice(1) + ': 不在队列');
      }
    }
    break;
  }
}

console.log('\n最终: state=' + logic.state + ' frames=' + frames + ' blocks=' + logic.blocks.length);
console.log('最后10次部署: ' + deployLog.slice(-10).map(d => 'F' + d.frame + ':' + d.color.slice(1) + '(' + d.source[0] + ')').join(', '));
