/**
 * A100 死锁诊断：打印前10次 pickCandidate 的决策过程
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { GameLogic } from '../src/GameLogic.js';
import { G } from '../src/constants.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = resolve(__dir, '..');

const data  = JSON.parse(readFileSync(resolve(ROOT, 'levels_a2/level100.json'), 'utf8'));
const logic = new GameLogic();
logic.loadLevel(data);

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

function computeColorExposurePathPos(logic) {
  const { GW, GH, LEN_BOTTOM, LEN_RIGHT, LEN_TOP, CELL } = G;
  const grid = logic.grid;
  const blockExposure = {};
  const update = (color, pathPos) => {
    if (!(color in blockExposure) || pathPos < blockExposure[color])
      blockExposure[color] = pathPos;
  };
  for (let col = 0; col < GW; col++) {
    const pp = col * CELL;
    for (let row = GH - 1; row >= 0; row--)
      if (grid[row]?.[col] != null) { update(grid[row][col], pp); break; }
  }
  for (let row = 0; row < GH; row++) {
    const pp = LEN_BOTTOM + (GH - 1 - row) * CELL;
    for (let col = GW - 1; col >= 0; col--)
      if (grid[row]?.[col] != null) { update(grid[row][col], pp); break; }
  }
  for (let col = 0; col < GW; col++) {
    const pp = LEN_BOTTOM + LEN_RIGHT + (GW - 1 - col) * CELL;
    for (let row = 0; row < GH; row++)
      if (grid[row]?.[col] != null) { update(grid[row][col], pp); break; }
  }
  for (let row = 0; row < GH; row++) {
    const pp = LEN_BOTTOM + LEN_RIGHT + LEN_TOP + row * CELL;
    for (let col = 0; col < GW; col++)
      if (grid[row]?.[col] != null) { update(grid[row][col], pp); break; }
  }
  return blockExposure;
}

// 打印初始状态决策
const colorCount = countColors(logic);
const reachable  = computeReachable(logic);
const exposureMap = computeColorExposurePathPos(logic);
const { TOTAL_DIST } = G;

console.log('=== A100 初始状态 ===');
console.log('可达色:', [...reachable].join(', '));
console.log('轨道用量:', logic.turrets.length, '/', logic.trackCap ?? 5);
console.log('\n队列头部:');
for (let li = 0; li < logic.lanes.length; li++) {
  const lane = logic.lanes[li];
  if (!lane.length) continue;
  const h = lane[0];
  const ep = exposureMap[h.color];
  console.log(`  L${li}[0]: ${h.color} ammo=${h.ammo} ep=${ep} reachable=${reachable.has(h.color)}`);
}

console.log('\n候选评分（可达池）:');
const candidates = [];
for (let li = 0; li < logic.lanes.length; li++) {
  const lane = logic.lanes[li];
  if (!lane.length) continue;
  const t = lane[0];
  if ((colorCount[t.color] ?? 0) === 0) continue;
  candidates.push({ source: 'lane', laneIdx: li, color: t.color, ammo: t.ammo });
}

const colorAmmo = {};
for (const c of candidates) colorAmmo[c.color] = (colorAmmo[c.color] ?? 0) + c.ammo;
const trackColorCount = {};

const reachPool = candidates.filter(c => reachable.has(c.color));
console.log('reachPool:', reachPool.length, '个');
for (const c of reachPool) {
  const blockCount = colorCount[c.color] ?? 0;
  const ammoSum    = colorAmmo[c.color]  ?? 0;
  const score = 1 / (1 + Math.abs(ammoSum - blockCount));
  console.log(`  L${c.laneIdx} ${c.color} ammo=${c.ammo} blockCount=${blockCount} ammoSum=${ammoSum} score=${score.toFixed(4)}`);
}

console.log('\n解锁候选（不可达但后续有可达色）:');
for (let li = 0; li < logic.lanes.length; li++) {
  const lane = logic.lanes[li];
  if (lane.length < 2) continue;
  const head = lane[0];
  if (reachable.has(head.color)) continue;
  let behindColor = null;
  for (let j = 1; j <= Math.min(5, lane.length - 1); j++) {
    if (reachable.has(lane[j].color)) { behindColor = lane[j].color; break; }
  }
  if (!behindColor) continue;
  const ammoSum = colorAmmo[head.color] ?? head.ammo;
  const blockCount = colorCount[head.color] ?? 0;
  const baseScore = 1 / (1 + Math.abs(ammoSum - blockCount));
  const unlockScore = baseScore * 0.4 * (1 / (1 + head.ammo / 20));
  console.log(`  L${li}[0]: ${head.color} ammo=${head.ammo}  后续可达色=${behindColor}  baseScore=${baseScore.toFixed(4)}  unlockScore=${unlockScore.toFixed(4)}`);
}
