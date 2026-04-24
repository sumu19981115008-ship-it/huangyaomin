/**
 * A72追踪：使用与sim.js完全相同的bot逻辑，
 * 额外记录每次决策时的extreme候选（freeSlots>=1, ratio>5, dist<=2）
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { GameLogic } from '../src/GameLogic.js';
import { G } from '../src/constants.js';

const data = JSON.parse(readFileSync(resolve(import.meta.dirname, '../levels_a2/level72.json'), 'utf8'));
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
const MAX = 10000, SAFE = 28;
const { TOTAL_DIST } = G;
let extremeCount = 0;

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

    // buffer危险预判
    const soonDone = logic.turrets.filter(t => !t.lapComplete && t.ammo > 0 && t.pathPos >= TOTAL_DIST * 0.8).length;
    const bufferDanger = logic.buffer.length + soonDone >= logic.bufferCap - 1;

    const candidates = [];
    for (let li = 0; li < logic.lanes.length; li++) {
      const lane = logic.lanes[li]; if (!lane.length) continue;
      const t = lane[0]; if ((colorCount[t.color] ?? 0) === 0) continue;
      candidates.push({ source:'lane', laneIdx:li, color:t.color, ammo:t.ammo });
    }
    for (let bi = 0; bi < logic.buffer.length; bi++) {
      const t = logic.buffer[bi]; if ((colorCount[t.color] ?? 0) === 0) continue;
      candidates.push({ source:'buffer', bufferIdx:bi, color:t.color, ammo:t.ammo });
    }
    if (!candidates.length) { logic.update(); for (const b of logic.flushPendingBullets()) inFlight.push({ landFrame: frames+bulletFlightFrames(b), ...b }); continue; }

    const reachPool = candidates.filter(c => reachable.has(c.color));
    const inFallback = reachPool.length === 0;

    // 计算extreme候选（这是我们想要检测的条件）
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
        // 记录所有 ratio > 5, dist <= 2 的候选
        if (ratio > 5 && dist <= 2) {
          extremePool.push({ li, color: head.color, ammo: head.ammo, gain, cost, dist, ratio });
          extremeCount++;
        }
      }
    }

    if (extremePool.length > 0) {
      const reachColors = [...reachable].map(c => a(c)).join(',');
      console.log(`\n*** EXTREME d${deploys} f${frames} free=${freeSlots} reach=[${reachColors}] fb=${inFallback}`);
      extremePool.forEach(u => {
        const lane = logic.lanes[u.li];
        const preview = lane.slice(0, 6).map(c => `${a(c.color)}(${c.ammo})`).join(',');
        console.log(`  L${u.li}(${a(u.color)},head_ammo=${u.ammo},g=${u.gain},c=${u.cost},d=${u.dist},r=${u.ratio.toFixed(1)}): [${preview}]`);
      });
    }

    // 实际sim.js决策逻辑
    let chosen = null;
    if (bufferDanger) {
      const bufCandidates = candidates.filter(c => c.source === 'buffer');
      if (bufCandidates.length > 0) {
        const reachBuf = bufCandidates.filter(c => reachable.has(c.color));
        const pool = reachBuf.length > 0 ? reachBuf : bufCandidates;
        pool.sort((a, b) => a.ammo - b.ammo);
        chosen = pool[0]; chosen._commitLane = null;
      }
    }

    if (!chosen) {
      // commitLane检查
      if (commitLane && freeSlots >= 1) {
        const lane = logic.lanes[commitLane.laneIdx];
        if (lane && lane.length > 0) {
          const head = lane[0];
          if (!reachable.has(head.color) && (colorCount[head.color]??0)>0 && !(trackColorCount[head.color]>0)) {
            chosen = { source:'lane', laneIdx:commitLane.laneIdx, color:head.color, ammo:head.ammo, _unlock:true, _commitLane:commitLane };
          } else { commitLane = null; }
        } else { commitLane = null; }
      }

      if (!chosen) {
        const colorAmmo = {};
        for (const lane of logic.lanes) for (const t of lane) colorAmmo[t.color] = (colorAmmo[t.color] ?? 0) + t.ammo;
        for (const t of logic.buffer) colorAmmo[t.color] = (colorAmmo[t.color] ?? 0) + t.ammo;

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

        const allEmpty = logic.turrets.length === 0;
        if (inFallback && allEmpty && freeSlots >= 2 && unlockPool.length > 0) {
          const worthwhile = unlockPool.filter(u => u._gain > u._cost * 1.2 && u._dist <= 3);
          if (worthwhile.length > 0) {
            worthwhile.sort((a, b) => (b._gain - b._cost) - (a._gain - a._cost));
            const best = worthwhile[0];
            best._commitLane = { laneIdx: best.laneIdx };
            chosen = best;
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
            if (a.source === 'buffer' && b.source !== 'buffer') return -1;
            if (b.source === 'buffer' && a.source !== 'buffer') return 1;
            return 0;
          });
          chosen = use[0];
          if (chosen) chosen._commitLane = null;
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
console.log('extreme候选总次数: '+extremeCount);
