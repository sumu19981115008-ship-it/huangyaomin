/**
 * B62追踪：使用与sim.js完全相同的逻辑（含superWorth），追踪前30次部署
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { GameLogic } from '../src/GameLogic.js';
import { G } from '../src/constants.js';

const data = JSON.parse(readFileSync(resolve(import.meta.dirname, '../levels_b2/level62.json'), 'utf8'));
const ABBR = { '#3498DB':'蓝','#2ECC71':'绿','#9B59B6':'紫','#1ABC9C':'青','#E91E63':'粉','#00BCD4':'天','#FF5722':'橙','#8BC34A':'黄绿','#FFD700':'黄' };
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

function computeColorExposurePathPos(logic) {
  const { GW, GH, LEN_BOTTOM, LEN_RIGHT, LEN_TOP, CELL } = G;
  const grid = logic.grid; const blockExposure = {};
  const update = (color, pp) => { if (!(color in blockExposure) || pp < blockExposure[color]) blockExposure[color] = pp; };
  for (let col = 0; col < GW; col++) { const pp = col * CELL;
    for (let row = GH-1; row >= 0; row--) { if (grid[row]?.[col] != null) { update(grid[row][col], pp); break; } } }
  for (let row = 0; row < GH; row++) { const pp = LEN_BOTTOM + (GH-1-row) * CELL;
    for (let col = GW-1; col >= 0; col--) { if (grid[row]?.[col] != null) { update(grid[row][col], pp); break; } } }
  for (let col = 0; col < GW; col++) { const pp = LEN_BOTTOM + LEN_RIGHT + (GW-1-col) * CELL;
    for (let row = 0; row < GH; row++) { if (grid[row]?.[col] != null) { update(grid[row][col], pp); break; } } }
  for (let row = 0; row < GH; row++) { const pp = LEN_BOTTOM + LEN_RIGHT + LEN_TOP + row * CELL;
    for (let col = 0; col < GW; col++) { if (grid[row]?.[col] != null) { update(grid[row][col], pp); break; } } }
  return blockExposure;
}

const logic = new GameLogic();
logic.loadLevel(data);
const inFlight = [];
let frames = 0, deploys = 0, commitLane = null;
const MAX = 200000, SAFE = 28;
const { TOTAL_DIST } = G;

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
    const exposureMap = computeColorExposurePathPos(logic);
    const trackColorCount = {};
    for (const t of logic.turrets) trackColorCount[t.color] = (trackColorCount[t.color] || 0) + 1;
    const trackCap = logic.trackCap ?? 5;
    const freeSlots = trackCap - logic.turrets.length;
    const colorAmmo = {};
    for (const lane of logic.lanes) for (const t of lane) colorAmmo[t.color] = (colorAmmo[t.color] ?? 0) + t.ammo;
    for (const t of logic.buffer) colorAmmo[t.color] = (colorAmmo[t.color] ?? 0) + t.ammo;
    const soonDone = logic.turrets.filter(t => !t.lapComplete && t.ammo > 0 && t.pathPos >= TOTAL_DIST * 0.8).length;
    const bufferDanger = logic.buffer.length + soonDone >= logic.bufferCap - 1;

    const candidates = [];
    for (let li = 0; li < logic.lanes.length; li++) {
      const lane = logic.lanes[li]; if (!lane.length) continue;
      const t = lane[0]; if ((colorCount[t.color] ?? 0) === 0) continue;
      candidates.push({ source:'lane', laneIdx:li, color:t.color, ammo:t.ammo, idle:false });
    }
    for (let bi = 0; bi < logic.buffer.length; bi++) {
      const t = logic.buffer[bi]; if ((colorCount[t.color] ?? 0) === 0) continue;
      candidates.push({ source:'buffer', bufferIdx:bi, color:t.color, ammo:t.ammo, idle:t.idleLastLap??false });
    }
    if (!candidates.length) { logic.update(); for (const b of logic.flushPendingBullets()) inFlight.push({ landFrame: frames+bulletFlightFrames(b), ...b }); continue; }

    const reachPool = candidates.filter(c => reachable.has(c.color));
    const reachColors = [...reachable].map(c => a(c)).join(',');

    if (deploys <= 30) {
      const laneStr = logic.lanes.map((ln,li) => ln.length ? `L${li}:[${ln.slice(0,4).map(c=>a(c.color)+'('+c.ammo+')').join(',')}]` : null).filter(Boolean).join(' ');
      console.log(`d${deploys} f${frames} free=${freeSlots} reach=[${reachColors}] commit=${commitLane?commitLane.laneIdx:'null'}`);
      console.log(`  ${laneStr}`);
    }

    let chosen = null;

    if (bufferDanger) {
      const bufCandidates = candidates.filter(c => c.source === 'buffer');
      if (bufCandidates.length > 0) {
        const pool = bufCandidates.filter(c => reachable.has(c.color));
        const p2 = pool.length > 0 ? pool : bufCandidates;
        p2.sort((a,b)=>a.ammo-b.ammo);
        chosen = p2[0]; chosen._commitLane = null;
      }
    }

    if (!chosen) {
      if (commitLane && freeSlots >= 1) {
        const lane = logic.lanes[commitLane.laneIdx];
        if (lane && lane.length > 0) {
          const head = lane[0];
          if (!reachable.has(head.color) && (colorCount[head.color]??0)>0 && !(trackColorCount[head.color]>0)) {
            chosen = { source:'lane', laneIdx:commitLane.laneIdx, color:head.color, ammo:head.ammo, _unlock:true, _commitLane:commitLane };
            if (deploys<=30) console.log(`  -> 承诺继续 L${commitLane.laneIdx} (${a(head.color)})`);
          } else {
            if (deploys<=30) console.log(`  -> 承诺结束 L${commitLane.laneIdx}: head=${a(lane[0]?.color)} reachable=${reachable.has(lane[0]?.color)}`);
            commitLane = null;
          }
        } else { commitLane = null; }
      }

      if (!chosen) {
        const unlockPool = [];
        if (freeSlots > 0) {
          for (let li = 0; li < logic.lanes.length; li++) {
            const lane = logic.lanes[li]; if (lane.length < 2) continue;
            const head = lane[0];
            if (reachable.has(head.color)) continue;
            if ((colorCount[head.color] ?? 0) === 0) continue;
            if ((trackColorCount[head.color] || 0) > 0) continue;
            let cost = 0, gain = 0, dist = Infinity, targetColor = null;
            for (let j = 0; j < Math.min(10, lane.length); j++) {
              const car = lane[j];
              if (reachable.has(car.color)) { gain += car.ammo; if (dist===Infinity) { dist=j; targetColor=car.color; } }
              else if (j > 0) cost += car.ammo;
            }
            if (dist === Infinity) continue;
            unlockPool.push({ source:'lane', laneIdx:li, color:head.color, ammo:head.ammo, idle:false, _unlock:true,
                              _dist:dist, _targetColor:targetColor, _gain:gain, _cost:cost });
          }
        }
        if (deploys<=30 && unlockPool.length > 0) {
          console.log(`  unlockPool: `+unlockPool.map(u=>`L${u.laneIdx}(${a(u.color)},g=${u._gain},c=${u._cost},d=${u._dist},r=${(u._gain/Math.max(1,u._cost)).toFixed(1)})`).join(' '));
        }

        const inFallback = reachPool.length === 0;
        const allEmpty = logic.turrets.length === 0;
        if (inFallback && allEmpty && freeSlots >= 2 && unlockPool.length > 0) {
          const worthwhile = unlockPool.filter(u => u._gain > u._cost * 1.2 && u._dist <= 3);
          if (worthwhile.length > 0) {
            worthwhile.sort((a, b) => (b._gain - b._cost) - (a._gain - a._cost));
            const best = worthwhile[0];
            best._commitLane = { laneIdx: best.laneIdx };
            chosen = best;
            if (deploys<=30) console.log(`  -> allEmpty挖坑 L${best.laneIdx}`);
          }
        }

        if (!chosen && !inFallback && freeSlots >= 1 && unlockPool.length > 0) {
          const superWorth = unlockPool.filter(u => u._cost > 0 && u._gain > u._cost * 13 && u._dist <= 2);
          if (superWorth.length > 0) {
            superWorth.sort((a, b) => (b._gain - b._cost) - (a._gain - a._cost));
            const best = superWorth[0];
            best._commitLane = { laneIdx: best.laneIdx };
            chosen = best;
            if (deploys<=30) console.log(`  -> superWorth(>13) L${best.laneIdx} g=${best._gain} c=${best._cost} r=${(best._gain/best._cost).toFixed(1)}`);
          }
        }

        if (!chosen) {
          const use = inFallback ? candidates : [...reachPool, ...unlockPool];
          const norm = TOTAL_DIST;
          for (const c of use) {
            const blockCount = colorCount[c.color] ?? 0;
            const ammoSum = colorAmmo[c.color] ?? 0;
            let score = 1 / (1 + Math.abs(ammoSum - blockCount));
            const onTrack = trackColorCount[c.color] || 0;
            if (onTrack > 0) score *= Math.pow(0.6, onTrack);
            const ep = exposureMap[c.color] ?? norm;
            score *= 1 / (1 + ep / (norm * 2));
            if (inFallback) score *= 1 / (1 + ep / norm);
            if (c._unlock) score *= 0.6 * (1 / (1 + c.ammo / 20));
            c.score = score;
          }
          use.sort((a, b) => {
            const ds = b.score - a.score;
            if (Math.abs(ds) > 1e-9) return ds;
            if (a.source==='buffer' && b.source!=='buffer') return -1;
            if (b.source==='buffer' && a.source!=='buffer') return 1;
            return 0;
          });
          chosen = use[0];
          if (chosen) {
            chosen._commitLane = null;
            if (deploys<=30) console.log(`  -> scored ${a(chosen.color)} (${chosen.source}${chosen._unlock?',unlock':''})`);
          }
        }
      }
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
