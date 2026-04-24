import { readFileSync } from 'fs';
import { resolve } from 'path';
import { GameLogic } from '../src/GameLogic.js';
import { G } from '../src/constants.js';

const data = JSON.parse(readFileSync(resolve(import.meta.dirname, '../levels_b2/level62.json'), 'utf8'));
const ABBR = { '#2ECC71':'绿','#9B59B6':'紫','#00BCD4':'青','#3498DB':'蓝','#E91E63':'粉',
               '#FFD700':'黄','#FF6D00':'橙','#FF5722':'深橙','#A7FFEB':'薄荷' };
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
let frames = 0, deploys = 0, commitLane = null;
const MAX = 2000, SAFE = 28;

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

    const candidates = [];
    for (let li = 0; li < logic.lanes.length; li++) {
      const lane = logic.lanes[li]; if (!lane.length) continue;
      const t = lane[0]; if ((colorCount[t.color] ?? 0) === 0) continue;
      candidates.push({ source: 'lane', laneIdx: li, color: t.color, ammo: t.ammo });
    }
    for (let bi = 0; bi < logic.buffer.length; bi++) {
      const t = logic.buffer[bi]; if ((colorCount[t.color] ?? 0) === 0) continue;
      candidates.push({ source: 'buffer', bufferIdx: bi, color: t.color, ammo: t.ammo });
    }

    const reachPool = candidates.filter(c => reachable.has(c.color));
    const inFallback = reachPool.length === 0;
    const digThreshold = inFallback ? 1.2 : 2.0;

    const unlockPool = [];
    if (freeSlots > 0) {
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
        unlockPool.push({ laneIdx: li, gain, cost, dist, color: head.color });
      }
    }

    const worthwhile = (freeSlots >= 2 && unlockPool.length > 0)
      ? unlockPool.filter(u => u.gain > u.cost * digThreshold && u.dist <= 3) : [];
    const superWorth = (!inFallback && freeSlots >= 1 && unlockPool.length > 0)
      ? unlockPool.filter(u => u.gain > u.cost * 5 && u.dist <= 2) : [];

    const reachColors = [...reachable].map(c => a(c)).join(',');
    if (deploys <= 25) {
      console.log('d'+deploys+' f'+frames+' free='+freeSlots+' reach=['+reachColors+'] fb='+inFallback+' commit='+(commitLane?commitLane.laneIdx:'null')+' worth='+worthwhile.length+' super='+superWorth.length);
      if (unlockPool.length > 0) console.log('  unlock: '+unlockPool.map(u => 'L'+u.laneIdx+'('+a(u.color)+',g='+u.gain+',c='+u.cost+',d='+u.dist+',r='+(u.gain/Math.max(1,u.cost)).toFixed(1)+')').join(' '));
    }

    let chosen = null;
    if (commitLane && freeSlots >= 2) {
      const lane = logic.lanes[commitLane.laneIdx];
      if (lane && lane.length > 0) {
        const head = lane[0];
        if (!reachable.has(head.color) && (colorCount[head.color]??0)>0 && !(trackColorCount[head.color]>0)) {
          chosen = { source:'lane', laneIdx:commitLane.laneIdx, _commitLane: commitLane };
          if (deploys<=25) console.log('  -> 承诺继续');
        } else { commitLane = null; }
      } else { commitLane = null; }
    }
    if (!chosen && worthwhile.length > 0) {
      worthwhile.sort((a,b) => (b.gain-b.cost)-(a.gain-a.cost));
      const best = worthwhile[0];
      chosen = { source:'lane', laneIdx:best.laneIdx, _commitLane:{laneIdx:best.laneIdx} };
      if (deploys<=25) console.log('  -> 主动挖坑(>=2) L'+best.laneIdx);
    }
    if (!chosen && superWorth.length > 0) {
      superWorth.sort((a,b) => (b.gain-b.cost)-(a.gain-a.cost));
      const best = superWorth[0];
      chosen = { source:'lane', laneIdx:best.laneIdx, _commitLane:{laneIdx:best.laneIdx} };
      if (deploys<=25) console.log('  -> 超高收益挖坑(>=1) L'+best.laneIdx);
    }
    if (!chosen) {
      if (reachPool.length > 0) { chosen = reachPool[0]; chosen._commitLane=null; if (deploys<=25) console.log('  -> reach '+a(chosen.color)); }
      else if (candidates.length > 0) { chosen = candidates[0]; chosen._commitLane=null; if (deploys<=25) console.log('  -> fallback '+a(chosen.color)); }
    }

    if (chosen) {
      if (chosen._commitLane !== undefined) commitLane = chosen._commitLane;
      deploys++;
      if (chosen.source === 'buffer') logic.deployFromBuffer(chosen.bufferIdx);
      else logic.deployFromLane(chosen.laneIdx);
    }
  }
  logic.update();
  for (const b of logic.flushPendingBullets()) inFlight.push({ landFrame: frames + bulletFlightFrames(b), ...b });
}
console.log('\n结果: '+logic.state+' 帧: '+frames+' 部署: '+deploys);
