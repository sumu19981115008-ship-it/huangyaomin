/**
 * B24 专项追踪：停车场为何在关键时刻停止触发
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { GameLogic } from '../src/GameLogic.js';
import { G } from '../src/constants.js';

const ROOT = resolve(import.meta.dirname, '..');
const { TOTAL_DIST } = G;
const data = JSON.parse(readFileSync(resolve(ROOT, 'levels_b2/level24.json'), 'utf8'));

const ABBR = { '#2ECC71': '绿', '#9B59B6': '紫', '#00BCD4': '青', '#8BC34A': '浅绿', '#FFD700': '黄', '#FF6D00': '橙', '#A7FFEB': '薄荷' };
const a = c => ABBR[c] || c.slice(1, 5);

function bulletFlightFrames(bullet) {
  const { CELL, CANVAS_X, CANVAS_Y, CW, CH, LEN_BOTTOM, LEN_RIGHT, LEN_TOP } = G;
  const BULLET_SPEED = 14, TRACK_GAP = 22;
  const tx = CANVAS_X + bullet.col * CELL + CELL / 2, ty = CANVAS_Y + bullet.row * CELL + CELL / 2;
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

const logic = new GameLogic();
logic.loadLevel(data);
const inFlight = [];
let frames = 0, deploys = 0;
const MAX = 200000, SAFE = 28;

while (logic.state === 'playing' && frames < MAX) {
  frames++;
  let i = 0;
  while (i < inFlight.length) {
    if (inFlight[i].landFrame <= frames) { const b = inFlight.splice(i, 1)[0]; logic.onBulletHit(b.turretId, b.col, b.row); if (logic.state !== 'playing') break; } else i++;
  }
  if (logic.state !== 'playing') break;

  if (!logic.isTrackFull() && !logic.turrets.some(t => !t.lapComplete && t.pathPos < SAFE)) {
    const colorCount = {};
    for (const b of logic.blocks) colorCount[b.color] = (colorCount[b.color] ?? 0) + 1;

    const reachable = computeReachable(logic);
    const trackColorCount = {};
    for (const t of logic.turrets) trackColorCount[t.color] = (trackColorCount[t.color] || 0) + 1;
    const trackUsed = logic.turrets.length;
    const trackCap = logic.trackCap ?? 5;
    const freeSlots = trackCap - trackUsed;

    // 检查 L1 队头状态
    const L1 = logic.lanes[1];
    if (L1 && L1.length > 0) {
      const head = L1[0];
      const isReach = reachable.has(head.color);
      const colorBlock = colorCount[head.color] ?? 0;
      const onTrack = trackColorCount[head.color] || 0;

      // 打印每次 L1 头部可能被停车场处理的状态
      if (!isReach && colorBlock > 0) {
        let dist = Infinity;
        for (let j = 1; j <= Math.min(10, L1.length - 1); j++) {
          if (reachable.has(L1[j].color)) { dist = j; break; }
        }
        const cands = [];
        for (let li = 0; li < logic.lanes.length; li++) {
          const lane = logic.lanes[li]; if (!lane.length) continue;
          const t = lane[0]; if ((colorCount[t.color] ?? 0) === 0) continue;
          cands.push({ color: t.color });
        }
        const reachPool = cands.filter(c => reachable.has(c.color));

        console.log(`f=${frames} d=${deploys} free=${freeSlots} reach=${reachPool.length} L1头=${a(head.color)}x${head.ammo} dist=${dist} onTrack=${onTrack} colorBlock=${colorBlock}`);
        console.log(`  条件dist=1? ${dist===1} freeSlots>0? ${freeSlots>0} -> 停车触发: ${dist===1&&freeSlots>0&&onTrack===0&&colorBlock>0}`);
        if (deploys > 50) break;
      }
    }

    // 执行实际决策（简化：直接选reachPool第一个）
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
    if (cands.length > 0) {
      // 停车场规则
      let chosen = null;
      const reachPool = cands.filter(c => reachable.has(c.color));
      if (reachPool.length > 0 && freeSlots > 0) {
        for (let li = 0; li < logic.lanes.length; li++) {
          const lane = logic.lanes[li]; if (lane.length < 2) continue;
          const head = lane[0];
          if (reachable.has(head.color)) continue;
          if ((colorCount[head.color] ?? 0) === 0) continue;
          if ((trackColorCount[head.color] || 0) > 0) continue;
          let dist = Infinity;
          for (let j = 1; j <= Math.min(10, lane.length - 1); j++) {
            if (reachable.has(lane[j].color)) { dist = j; break; }
          }
          if (dist !== 1) continue;
          chosen = { source: 'lane', laneIdx: li, color: head.color, ammo: head.ammo };
          break;
        }
      }
      if (!chosen) chosen = reachPool[0] ?? cands[0];
      if (chosen) {
        deploys++;
        if (chosen.source === 'buffer') logic.deployFromBuffer(chosen.bufferIdx);
        else logic.deployFromLane(chosen.laneIdx);
      }
    }
  }

  logic.update();
  for (const b of logic.flushPendingBullets()) inFlight.push({ landFrame: frames + bulletFlightFrames(b), ...b });
}

console.log(`\n结果: ${logic.state} 总帧: ${frames} 总部署: ${deploys}`);
console.log(`剩余方块: ${logic.blocks.length}`);
const colorCount = {};
for (const b of logic.blocks) colorCount[b.color] = (colorCount[b.color] ?? 0) + 1;
console.log('剩余颜色:', Object.entries(colorCount).map(([c, n]) => a(c) + ':' + n).join(', '));
