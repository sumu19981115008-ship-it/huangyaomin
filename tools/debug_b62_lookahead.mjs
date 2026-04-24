/**
 * 测试"队列穿透"策略：当队头颜色不可达时，向后寻找队列中第一个可达颜色车
 * 对比：当前策略 vs 穿透策略
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

import { GameLogic } from '../src/GameLogic.js';
import { G } from '../src/constants.js';

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

// 穿透策略：当队头不可达时，往后找第一个可达颜色
function pickCandidateLookahead(logic) {
  const colorCount = countColors(logic);
  const reachable = computeReachable(logic);

  const candidates = [];

  // buffer: 只取有效颜色的车
  for (let i = 0; i < logic.buffer.length; i++) {
    const t = logic.buffer[i];
    if ((colorCount[t.color] ?? 0) === 0) continue;
    candidates.push({ source: 'buffer', bufferIdx: i, color: t.color, ammo: t.ammo });
  }

  // 队列：穿透不可达队头，找第一个可达颜色
  for (let li = 0; li < logic.lanes.length; li++) {
    const lane = logic.lanes[li];
    // 找该队列中第一个可达颜色
    let found = null;
    for (let ti = 0; ti < lane.length; ti++) {
      const t = lane[ti];
      if ((colorCount[t.color] ?? 0) === 0) continue;
      if (reachable.has(t.color)) {
        found = { source: 'lane', laneIdx: li, lanePos: ti, color: t.color, ammo: t.ammo };
        break;
      }
      // 如果队头不可达，只跳过一个（不要跳太多）
      if (ti === 0) continue;
      break;
    }
    // 若没有找到可达的，回退到队头
    if (!found && lane.length > 0) {
      const t = lane[0];
      if ((colorCount[t.color] ?? 0) > 0) {
        found = { source: 'lane', laneIdx: li, lanePos: 0, color: t.color, ammo: t.ammo };
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

function deployCandidate(logic, c) {
  if (c.source === 'buffer') return logic.deployFromBuffer(c.bufferIdx);
  // 穿透策略：从队列指定位置部署
  if (c.lanePos !== undefined && c.lanePos > 0) {
    // 使用 forceDeployFromLaneAt
    return logic.forceDeployFromLaneAt(c.laneIdx, c.lanePos);
  }
  return logic.deployFromLane(c.laneIdx);
}

function simulate(useLookahead) {
  const logic = new GameLogic();
  const data2 = JSON.parse(readFileSync(resolve(ROOT, 'levels_b2/level62.json'), 'utf8'));
  logic.loadLevel(data2);

  const inFlight = [];
  let frames = 0;
  const MAX = 200000;
  const SAFE_GAP = 28;

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
        const c = useLookahead ? pickCandidateLookahead(logic) : pickCandidateOriginal(logic);
        if (c) {
          deployCandidate(logic, c);
        }
      }
    }

    logic.update();
    for (const b of logic.flushPendingBullets()) {
      const delay = bulletFlightFrames(b);
      inFlight.push({ landFrame: frames + delay, ...b });
    }
  }

  return { result: frames >= MAX ? 'stuck' : logic.state, frames, blocks: logic.blocks.length };
}

// 原始策略（从sim.js复制）
function pickCandidateOriginal(logic) {
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
    candidates.push({ source: 'lane', laneIdx: li, lanePos: 0, color: t.color, ammo: t.ammo });
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

const r1 = simulate(false);
console.log('原始策略: result=' + r1.result + ' frames=' + r1.frames + ' blocks=' + r1.blocks);

const r2 = simulate(true);
console.log('穿透策略: result=' + r2.result + ' frames=' + r2.frames + ' blocks=' + r2.blocks);
