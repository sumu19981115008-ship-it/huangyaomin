// 单关详细调试：打印每次暂存区满时的状态
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { GameLogic } from '../src/GameLogic.js';
import { G } from '../src/constants.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = resolve(__dir, '..');

const [,, dir = 'levels_a2', lvlStr = '30'] = process.argv;
const lvl  = parseInt(lvlStr);
const file = resolve(ROOT, dir, `level${lvl}.json`);
const data = JSON.parse(readFileSync(file, 'utf8'));

function countColors(logic) {
  const map = {};
  for (const b of logic.blocks) map[b.color] = (map[b.color] ?? 0) + 1;
  return map;
}
function computeReachable(logic) {
  const { GW, GH } = G;
  const grid = logic.grid, set = new Set();
  for (let col = 0; col < GW; col++) {
    for (let row = GH-1; row >= 0; row--) if (grid[row]?.[col] != null) { set.add(grid[row][col]); break; }
    for (let row = 0; row < GH; row++)    if (grid[row]?.[col] != null) { set.add(grid[row][col]); break; }
  }
  for (let row = 0; row < GH; row++) {
    for (let col = GW-1; col >= 0; col--) if (grid[row]?.[col] != null) { set.add(grid[row][col]); break; }
    for (let col = 0; col < GW; col++)    if (grid[row]?.[col] != null) { set.add(grid[row][col]); break; }
  }
  return set;
}
function pickCandidate(logic) {
  const colorCount = countColors(logic);
  const candidates = [];
  for (let i = 0; i < logic.buffer.length; i++) {
    const t = logic.buffer[i];
    if ((colorCount[t.color]??0) === 0) continue;
    candidates.push({ source:'buffer', bufferIdx:i, color:t.color, ammo:t.ammo });
  }
  for (let li = 0; li < logic.lanes.length; li++) {
    const lane = logic.lanes[li]; if (!lane.length) continue;
    const t = lane[0];
    if ((colorCount[t.color]??0) === 0) continue;
    candidates.push({ source:'lane', laneIdx:li, color:t.color, ammo:t.ammo });
  }
  if (!candidates.length) return null;
  const reachable = computeReachable(logic);
  const colorAmmo = {};
  for (const c of candidates) colorAmmo[c.color] = (colorAmmo[c.color]??0) + c.ammo;
  const pool = candidates.filter(c => reachable.has(c.color));
  const use  = pool.length > 0 ? pool : candidates;
  for (const c of use) {
    const bc = colorCount[c.color]??0, am = colorAmmo[c.color]??0;
    c.score = 1/(1+Math.abs(am-bc));
  }
  use.sort((a,b)=>{
    const ds=b.score-a.score; if(Math.abs(ds)>1e-9) return ds;
    if(a.source==='buffer'&&b.source!=='buffer') return -1;
    if(b.source==='buffer'&&a.source!=='buffer') return 1;
    return 0;
  });
  return use[0];
}

const logic = new GameLogic();
logic.loadLevel(data);

const MAX = 200_000;
let frames = 0, lastBufferLen = 0;

while (logic.state === 'playing' && frames < MAX) {
  frames++;

  if (!logic.isTrackFull()) {
    const SAFE_GAP = 28;
    const blocked = logic.turrets.some(t => !t.lapComplete && t.pathPos < SAFE_GAP);
    if (!blocked) {
      const c = pickCandidate(logic);
      if (c) {
        if (c.source === 'buffer') logic.deployFromBuffer(c.bufferIdx);
        else                       logic.deployFromLane(c.laneIdx);
      }
    }
  }

  logic.update();
  const bullets = logic.flushPendingBullets();
  for (const b of bullets) {
    logic.onBulletHit(b.turretId, b.col, b.row);
    if (logic.state !== 'playing') break;
  }

  // 每当暂存区变化时打印状态
  if (logic.buffer.length !== lastBufferLen || (frames % 500 === 0)) {
    lastBufferLen = logic.buffer.length;
    const colorCount = countColors(logic);
    const reachable  = computeReachable(logic);
    const bufColors  = logic.buffer.map(t => t.color.slice(1,7) + `(${t.ammo})`).join(' ');
    const trackColors= logic.turrets.map(t => t.color.slice(1,7)).join(' ');
    const laneHeads  = logic.lanes.map(l => l[0]?.color.slice(1,7) ?? '--').join(' ');
    const reachStr   = [...reachable].map(c=>c.slice(1,7)).join(' ');
    const blockLeft  = Object.entries(colorCount).map(([c,n])=>`${c.slice(1,7)}:${n}`).join(' ');
    if (logic.buffer.length >= logic.bufferCap - 1) {
      console.log(`\n帧${frames} buffer:${logic.buffer.length}/${logic.bufferCap} track:${logic.turrets.length}/${logic.trackCap}`);
      console.log(`  暂存: ${bufColors || '空'}`);
      console.log(`  轨道: ${trackColors || '空'}`);
      console.log(`  队首: ${laneHeads}`);
      console.log(`  可达: ${reachStr}`);
      console.log(`  剩余方块: ${blockLeft}`);
    }
  }
}

console.log(`\n结果: ${logic.state}  帧:${frames}  失败原因:${logic.failReason}`);
