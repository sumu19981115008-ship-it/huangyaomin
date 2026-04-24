// 在指定帧数停下来，打印所有队列的完整内容
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { GameLogic } from '../src/GameLogic.js';
import { G } from '../src/constants.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = resolve(__dir, '..');

const [,, dir = 'levels_a2', lvlStr = '33', stopStr = '41000'] = process.argv;
const lvl  = parseInt(lvlStr);
const STOP = parseInt(stopStr);
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
let frames=0, deployCount=0;

while(logic.state==='playing' && frames < STOP) {
  frames++;
  if(!logic.isTrackFull()){
    const SAFE_GAP=28;
    const blocked=logic.turrets.some(t=>!t.lapComplete&&t.pathPos<SAFE_GAP);
    if(!blocked){
      const c=pickCandidate(logic);
      if(c){
        if(c.source==='buffer') logic.deployFromBuffer(c.bufferIdx);
        else logic.deployFromLane(c.laneIdx);
        deployCount++;
      }
    }
  }
  logic.update();
  const bullets=logic.flushPendingBullets();
  for(const b of bullets){
    logic.onBulletHit(b.turretId,b.col,b.row);
    if(logic.state!=='playing')break;
  }
}

const cc = countColors(logic);
const reach = computeReachable(logic);
console.log(`\n帧:${frames} 部署:${deployCount} 状态:${logic.state}`);
console.log(`方块:${logic.blocks.length} 轨道:${logic.turrets.length}/${logic.trackCap} buffer:${logic.buffer.length}/${logic.bufferCap}`);

console.log(`\n颜色统计:`);
for(const [c,n] of Object.entries(cc)){
  let ammoT=0, ammoB=0, ammoL=0;
  for(const t of logic.turrets) if(t.color===c) ammoT+=t.ammo;
  for(const t of logic.buffer) if(t.color===c) ammoB+=t.ammo;
  for(const lane of logic.lanes) for(const t of lane) if(t.color===c) ammoL+=t.ammo;
  const total=ammoT+ammoB+ammoL;
  const r=reach.has(c)?'可达':'遮挡';
  console.log(`  ${c.slice(1,7)}: blocks=${n} ammo=${total}(轨${ammoT}+存${ammoB}+队${ammoL}) ${r}`);
}

console.log(`\n轨道:`);
for(const t of logic.turrets){
  console.log(`  ${t.color.slice(1,7)} ammo:${t.ammo} pos:${Math.round(t.pathPos)} idle:${t.idleLastLap} lapDone:${t.lapComplete}`);
}

console.log(`\nbuffer: ${logic.buffer.map(t=>t.color.slice(1,7)+'('+t.ammo+')').join(' ') || '空'}`);

console.log(`\n队列（完整）:`);
for(let i=0;i<logic.lanes.length;i++){
  const lane=logic.lanes[i];
  if(lane.length===0){ console.log(`  L${i}: 空`); continue; }
  console.log(`  L${i}(${lane.length}辆): ${lane.map(t=>t.color.slice(1,7)+'('+t.ammo+')').join(' ')}`);
}
