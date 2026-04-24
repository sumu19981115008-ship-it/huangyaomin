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
const MAX = 50000;
const SAFE_GAP = 28;
let lastBlockCount = logic.blocks.length;
let lastProgressFrame = 0;
let longestGap = 0;
let longestGapStart = 0;

// 每隔N帧打印一次blocks进度
let milestones = [400, 350, 300, 250, 200, 150, 100, 50, 10, 0];
let nextMilestone = milestones[0];

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
    const gap = frames - lastProgressFrame;
    if (gap > longestGap) {
      longestGap = gap;
      longestGapStart = lastProgressFrame;
    }
    lastBlockCount = logic.blocks.length;
    lastProgressFrame = frames;
  }

  // 里程碑打印
  if (logic.blocks.length <= nextMilestone) {
    const reachable = computeReachable(logic);
    const colorCount = countColors(logic);
    const trackColors = logic.turrets.map(t => (reachable.has(t.color) ? '★' : '×') + t.color.slice(1) + '(' + t.ammo + ')').join(', ');
    const bufColors = logic.buffer.map(t => (reachable.has(t.color) ? '★' : '×') + t.color.slice(1) + '(' + t.ammo + ')').join(', ');
    const laneHeads = logic.lanes.map((l,i) => {
      if (!l.length) return 'L' + i + ':空';
      const reach = reachable.has(l[0].color) ? '★' : '×';
      return 'L' + i + ':' + reach + l[0].color.slice(1) + '(' + l[0].ammo + ')';
    }).join(' ');
    console.log('[F' + frames + '] blocks=' + logic.blocks.length + ' track:[' + trackColors + '] buf:[' + bufColors + '] lanes:' + laneHeads);

    while (milestones.length > 0 && milestones[0] >= logic.blocks.length) {
      milestones.shift();
    }
    nextMilestone = milestones[0] ?? -1;
  }
}

console.log('\n最终: state=' + logic.state + ' frames=' + frames + ' blocks=' + logic.blocks.length);
console.log('最长零进度间隔: ' + longestGap + '帧 (从F' + longestGapStart + '开始)');
