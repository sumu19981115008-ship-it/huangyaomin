/**
 * B24 专项调试：打印前100步决策，看bot为何卡住
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { GameLogic } from '../src/GameLogic.js';
import { G } from '../src/constants.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(resolve(ROOT, 'levels_b2/level24.json'), 'utf8'));

const { TOTAL_DIST } = G;

function computeReachable(logic) {
  const { GW, GH } = G;
  const grid = logic.grid;
  const r = new Set();
  for (let col = 0; col < GW; col++) {
    for (let row = GH-1; row >= 0; row--) { if (grid[row]?.[col] != null) { r.add(grid[row][col]); break; } }
    for (let row = 0; row < GH; row++)    { if (grid[row]?.[col] != null) { r.add(grid[row][col]); break; } }
  }
  for (let row = 0; row < GH; row++) {
    for (let col = GW-1; col >= 0; col--) { if (grid[row]?.[col] != null) { r.add(grid[row][col]); break; } }
    for (let col = 0; col < GW; col++)    { if (grid[row]?.[col] != null) { r.add(grid[row][col]); break; } }
  }
  return r;
}

// 颜色缩写
const ABBR = {'#2ECC71':'绿','#9B59B6':'紫','#00BCD4':'青','#8BC34A':'浅绿','#FFD700':'黄','#FF6D00':'橙','#A7FFEB':'薄荷'};
const a = c => ABBR[c] || c.slice(1,5);

const logic = new GameLogic();
logic.loadLevel(data);

const SAFE_GAP = 28;
const MAX_DEPLOY = 100;
let deployCount = 0;
let frames = 0;
const MAX_FRAMES = 500000;
const inFlight = [];

function bulletFlightFrames(bullet) {
  const { CELL, CANVAS_X, CANVAS_Y, GW, GH, CW, CH, LEN_BOTTOM, LEN_RIGHT, LEN_TOP } = G;
  const BULLET_SPEED = 14, TRACK_GAP = 22;
  const targetX = CANVAS_X + bullet.col * CELL + CELL/2;
  const targetY = CANVAS_Y + bullet.row * CELL + CELL/2;
  const p = bullet.fromPathPos;
  let sx, sy;
  if (p < LEN_BOTTOM) { sx = CANVAS_X+p; sy = CANVAS_Y+CH+TRACK_GAP; }
  else if (p < LEN_BOTTOM+LEN_RIGHT) { sx = CANVAS_X+CW+TRACK_GAP; sy = CANVAS_Y+CH-(p-LEN_BOTTOM); }
  else if (p < LEN_BOTTOM+LEN_RIGHT+LEN_TOP) { sx = CANVAS_X+CW-(p-LEN_BOTTOM-LEN_RIGHT); sy = CANVAS_Y-TRACK_GAP; }
  else { sx = CANVAS_X-TRACK_GAP; sy = CANVAS_Y+(p-LEN_BOTTOM-LEN_RIGHT-LEN_TOP); }
  return Math.max(1, Math.round(Math.sqrt((targetX-sx)**2+(targetY-sy)**2)/BULLET_SPEED));
}

while (logic.state === 'playing' && frames < MAX_FRAMES) {
  frames++;

  let i = 0;
  while (i < inFlight.length) {
    if (inFlight[i].landFrame <= frames) {
      const b = inFlight.splice(i,1)[0];
      logic.onBulletHit(b.turretId, b.col, b.row);
      if (logic.state !== 'playing') break;
    } else i++;
  }
  if (logic.state !== 'playing') break;

  // 炮车移动+开火
  for (const t of logic.turrets) {
    t.pathPos += 3;
    if (t.pathPos >= TOTAL_DIST) { t.pathPos -= TOTAL_DIST; t.lapComplete = true; }
    if (t.ammo <= 0) continue;
    const target = logic._findTarget(t);
    if (!target) continue;
    const flightF = bulletFlightFrames({ col: target.col, row: target.row, fromPathPos: t.pathPos });
    inFlight.push({ landFrame: frames+flightF, turretId: t.id, col: target.col, row: target.row });
    t.ammo--;
    if (t.ammo === 0) logic._onTurretEmpty(t);
  }
  if (logic.state !== 'playing') break;

  // 决策
  if (logic.isTrackFull()) continue;
  if (logic.turrets.some(t => !t.lapComplete && t.pathPos < SAFE_GAP)) continue;

  const colorCount = {};
  for (const b of logic.blocks) colorCount[b.color] = (colorCount[b.color]??0)+1;

  const candidates = [];
  for (let bi = 0; bi < logic.buffer.length; bi++) {
    const t = logic.buffer[bi];
    if ((colorCount[t.color]??0) === 0) continue;
    candidates.push({ source:'buffer', bufferIdx:bi, color:t.color, ammo:t.ammo });
  }
  for (let li = 0; li < logic.lanes.length; li++) {
    const lane = logic.lanes[li];
    if (lane.length === 0) continue;
    const t = lane[0];
    if ((colorCount[t.color]??0) === 0) continue;
    candidates.push({ source:'lane', laneIdx:li, color:t.color, ammo:t.ammo });
  }
  if (candidates.length === 0) continue;

  const reachable = computeReachable(logic);
  const reachPool = candidates.filter(c => reachable.has(c.color));
  const inFallback = reachPool.length === 0;

  const trackUsed = logic.turrets.length;
  const trackCap  = logic.trackCap ?? 5;
  const unlockPool = [];
  if (!inFallback && trackUsed <= trackCap - 2) {
    for (let li = 0; li < logic.lanes.length; li++) {
      const lane = logic.lanes[li];
      if (lane.length < 2) continue;
      const head = lane[0];
      if (reachable.has(head.color)) continue;
      if ((colorCount[head.color]??0) === 0) continue;
      const trackColorCount = {};
      for (const t of logic.turrets) trackColorCount[t.color] = (trackColorCount[t.color]||0)+1;
      if ((trackColorCount[head.color]||0) > 0) continue;
      if (head.ammo > 20) continue;
      let hasBehind = false;
      for (let j = 1; j <= Math.min(5, lane.length-1); j++) {
        if (reachable.has(lane[j].color)) { hasBehind = true; break; }
      }
      if (!hasBehind) continue;
      unlockPool.push({ source:'lane', laneIdx:li, color:head.color, ammo:head.ammo, _unlock:true });
    }
  }

  const use = inFallback ? candidates : [...reachPool, ...unlockPool];

  const colorAmmo = {};
  for (const lane of logic.lanes) for (const t of lane) colorAmmo[t.color]=(colorAmmo[t.color]??0)+t.ammo;
  for (const t of logic.buffer) colorAmmo[t.color]=(colorAmmo[t.color]??0)+t.ammo;
  const trackColorCount = {};
  for (const t of logic.turrets) trackColorCount[t.color]=(trackColorCount[t.color]||0)+1;

  for (const c of use) {
    const blockCount = colorCount[c.color]??0;
    const ammoSum    = colorAmmo[c.color]??0;
    let score = 1/(1+Math.abs(ammoSum-blockCount));
    const onTrack = trackColorCount[c.color]||0;
    if (onTrack > 0) score *= Math.pow(0.6, onTrack);
    const ep = TOTAL_DIST; // 简化，不算曝光map
    if (c._unlock) score *= 0.6*(1/(1+c.ammo/20));
    c.score = score;
  }
  use.sort((a,b)=>{
    const ds = b.score-a.score;
    if (Math.abs(ds)>1e-9) return ds;
    if (a.source==='buffer'&&b.source!=='buffer') return -1;
    if (b.source==='buffer'&&a.source!=='buffer') return 1;
    return 0;
  });

  const chosen = use[0];
  deployCount++;

  // 打印前80步决策
  if (deployCount <= 80) {
    const buf = logic.buffer.map(t=>a(t.color)+'x'+t.ammo).join(',');
    const lanes = logic.lanes.map((l,i)=>'L'+i+'['+l.length+']:'+(l[0]?a(l[0].color)+'x'+l[0].ammo:'空')).join(' ');
    const track = logic.turrets.map(t=>a(t.color)+'x'+t.ammo).join(',');
    const reachStr = [...reachable].map(a).join(',');
    const unlockStr = unlockPool.length > 0 ? ' 解锁候选:'+unlockPool.map(u=>'L'+u.laneIdx+a(u.color)).join(',') : '';
    const fallStr = inFallback ? ' [兜底]' : '';
    console.log(`#${deployCount} f${frames} 部署:${chosen.source==='buffer'?'buf':'L'+chosen.laneIdx}(${a(chosen.color)}x${chosen.ammo}${chosen._unlock?'🔓':''})${fallStr}${unlockStr}`);
    console.log(`   轨(${trackUsed}/${trackCap}):[${track}] buf:[${buf}]`);
    console.log(`   可达:[${reachStr}] ${lanes}`);
  }

  if (chosen.source === 'buffer') logic.deployFromBuffer(chosen.bufferIdx);
  else                             logic.deployFromLane(chosen.laneIdx);
}

console.log(`\n结果: ${logic.state}  总帧:${frames}  总部署:${deployCount}`);
console.log(`剩余方块: ${logic.blocks.length}  剩余队列: ${logic.lanes.map((l,i)=>'L'+i+':'+l.length).join(' ')}`);
