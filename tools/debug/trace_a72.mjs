import { readFileSync } from 'fs';
import { resolve } from 'path';
import { GameLogic } from '../src/GameLogic.js';
import { G } from '../src/constants.js';

const data = JSON.parse(readFileSync(resolve(import.meta.dirname, '../levels_a2/level72.json'), 'utf8'));
// colorTable: ["#222222","#228B22","#FF8C00","#00CED1","#FFD700","#F5F5F5","#C8A2C8"]
const ABBR = { '#222222':'黑','#228B22':'绿','#FF8C00':'橙','#00CED1':'青','#FFD700':'黄','#F5F5F5':'白','#C8A2C8':'紫' };
const a = c => ABBR[c] || c.slice(1,5);

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
    for (let row = GH-1; row >= 0; row--) { if (grid[row]?.[col] != null) { r.add(grid[row][col]); break; } }
    for (let row = 0; row < GH; row++) { if (grid[row]?.[col] != null) { r.add(grid[row][col]); break; } }
  }
  for (let row = 0; row < GH; row++) {
    for (let col = GW-1; col >= 0; col--) { if (grid[row]?.[col] != null) { r.add(grid[row][col]); break; } }
    for (let col = 0; col < GW; col++) { if (grid[row]?.[col] != null) { r.add(grid[row][col]); break; } }
  }
  return r;
}

const logic = new GameLogic();
logic.loadLevel(data);
const inFlight = [];
let frames = 0, deploys = 0;
const MAX = 5000, SAFE = 28;

while (logic.state === 'playing' && frames < MAX) {
  frames++;
  let i = 0;
  while (i < inFlight.length) {
    if (inFlight[i].landFrame <= frames) {
      const b = inFlight.splice(i,1)[0]; logic.onBulletHit(b.turretId, b.col, b.row);
      if (logic.state !== 'playing') break;
    } else i++;
  }
  if (logic.state !== 'playing') break;

  if (!logic.isTrackFull() && !logic.turrets.some(t => !t.lapComplete && t.pathPos < SAFE)) {
    const colorCount = {};
    for (const b of logic.blocks) colorCount[b.color] = (colorCount[b.color] ?? 0) + 1;
    const reachable = computeReachable(logic);
    const trackColorCount = {};
    for (const t of logic.turrets) trackColorCount[t.color] = (trackColorCount[t.color] || 0) + 1;
    const trackCap = logic.trackCap ?? 5;
    const freeSlots = trackCap - logic.turrets.length;

    const reachPool = [];
    for (let li = 0; li < logic.lanes.length; li++) {
      const lane = logic.lanes[li]; if (!lane.length) continue;
      const t = lane[0]; if ((colorCount[t.color] ?? 0) === 0) continue;
      if (reachable.has(t.color)) reachPool.push({ source:'lane', li, color: t.color });
    }
    for (let bi = 0; bi < logic.buffer.length; bi++) {
      const t = logic.buffer[bi]; if ((colorCount[t.color] ?? 0) === 0) continue;
      if (reachable.has(t.color)) reachPool.push({ source:'buffer', bi, color: t.color });
    }
    const inFallback = reachPool.length === 0;

    // 检查 extreme 条件（gain/cost > 10, dist === 1）
    const extremePool = [];
    if (!inFallback && freeSlots >= 1) {
      for (let li = 0; li < logic.lanes.length; li++) {
        const lane = logic.lanes[li]; if (lane.length < 2) continue;
        const head = lane[0];
        if (reachable.has(head.color)) continue;
        if ((colorCount[head.color] ?? 0) === 0) continue;
        if ((trackColorCount[head.color] || 0) > 0) continue;
        let cost = 0, gain = 0, dist = Infinity;
        for (let j = 0; j < Math.min(10, lane.length); j++) {
          const car = lane[j];
          if (reachable.has(car.color)) { gain += car.ammo; if (dist===Infinity) dist=j; }
          else if (j > 0) cost += car.ammo;
        }
        if (dist === Infinity) continue;
        const ratio = gain / Math.max(1, cost);
        if (ratio > 5 && dist <= 2) {
          extremePool.push({ li, color: head.color, ammo: head.ammo, gain, cost, dist, ratio });
        }
      }
    }

    const reachColors = [...reachable].map(c => a(c)).join(',');
    console.log(`d${deploys} f${frames} free=${freeSlots} reach=[${reachColors}] fb=${inFallback} turrets=${logic.turrets.length}`);
    if (extremePool.length > 0) {
      console.log(`  *** EXTREME TRIGGERED *** `);
      extremePool.forEach(u => console.log(`    L${u.li}(${a(u.color)},head_ammo=${u.ammo},g=${u.gain},c=${u.cost},d=${u.dist},r=${u.ratio.toFixed(1)})`));
      console.log(`  Lane details:`);
      extremePool.forEach(u => {
        const lane = logic.lanes[u.li];
        const preview = lane.slice(0, 5).map(c => `${a(c.color)}(${c.ammo})`).join(',');
        console.log(`    L${u.li}: [${preview}]`);
      });
    }

    // 正常部署：选 reachPool 第一个
    let chosen = null;
    if (reachPool.length > 0) {
      const c = reachPool[0];
      chosen = c;
      console.log(`  -> reach ${a(c.color)} from ${c.source}`);
    } else {
      // fallback：找第一个有效候选
      for (let li = 0; li < logic.lanes.length; li++) {
        const lane = logic.lanes[li]; if (!lane.length) continue;
        const t = lane[0]; if ((colorCount[t.color] ?? 0) === 0) continue;
        chosen = { source: 'lane', li, color: t.color };
        console.log(`  -> fallback ${a(t.color)} L${li}`);
        break;
      }
    }
    if (chosen) {
      deploys++;
      if (chosen.source === 'buffer') logic.deployFromBuffer(chosen.bi);
      else logic.deployFromLane(chosen.li ?? chosen.laneIdx);
    }
  }
  logic.update();
  for (const b of logic.flushPendingBullets()) inFlight.push({ landFrame: frames + bulletFlightFrames(b), ...b });
}
console.log('\n结果: '+logic.state+' 帧: '+frames+' 部署: '+deploys);
