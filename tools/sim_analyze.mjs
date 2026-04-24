// 分析关卡卡住的原因：在指定帧数后打印完整状态
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { GameLogic } from '../src/GameLogic.js';
import { G } from '../src/constants.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = resolve(__dir, '..');

const [,, dir = 'levels_a2', lvlStr = '33', samplesStr = '5'] = process.argv;
const lvl  = parseInt(lvlStr);
const SAMPLES = parseInt(samplesStr);
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

function printState(logic, frame, label) {
  const colorCount = countColors(logic);
  const reachable  = computeReachable(logic);
  console.log(`\n=== ${label} 帧${frame} ===`);
  console.log(`  状态: ${logic.state}  endgame:${logic.endgameStarted}  speedMult:${logic.speedMult}`);
  console.log(`  方块剩余: ${logic.blocks.length}  轨道:${logic.turrets.length}/${logic.trackCap}  暂存:${logic.buffer.length}/${logic.bufferCap}`);

  // 各颜色统计
  console.log(`  颜色统计（方块数 / 弹药）:`);
  const colorInfo = {};
  for (const [c, n] of Object.entries(colorCount)) colorInfo[c] = { blocks: n, ammo: 0, reach: reachable.has(c) };
  for (const t of logic.turrets) if (colorInfo[t.color]) colorInfo[t.color].ammo += t.ammo;
  for (const t of logic.buffer) if (colorInfo[t.color]) colorInfo[t.color].ammo += t.ammo;
  for (const lane of logic.lanes) for (const t of lane) if (colorInfo[t.color]) colorInfo[t.color].ammo += t.ammo;
  for (const [c, info] of Object.entries(colorInfo)) {
    const short = c.slice(1,7);
    const reachMark = info.reach ? '✓' : '✗';
    console.log(`    ${short}: 方块${info.blocks} 弹药${info.ammo} 可达${reachMark} 差${info.ammo-info.blocks}`);
  }

  // 轨道上的车
  if (logic.turrets.length > 0) {
    console.log(`  轨道炮车:`);
    for (const t of logic.turrets) {
      console.log(`    ${t.color.slice(1,7)} ammo:${t.ammo} pos:${Math.round(t.pathPos)} lapDone:${t.lapComplete} idle:${t.idleLastLap}`);
    }
  }

  // 暂存区
  if (logic.buffer.length > 0) {
    console.log(`  暂存区: ${logic.buffer.map(t=>t.color.slice(1,7)+'('+t.ammo+')').join(' ')}`);
  }

  // 各队列队首
  console.log(`  队列队首: ${logic.lanes.map((l,i)=>`L${i}:${l[0]?.color.slice(1,7)??'空'}(${l[0]?.ammo??'-'})`).join('  ')}`);

  // 当前能部署的候选
  const cand = pickCandidate(logic);
  console.log(`  最优候选: ${cand ? `${cand.source}[${cand.source==='buffer'?cand.bufferIdx:cand.laneIdx}] ${cand.color.slice(1,7)} ammo:${cand.ammo} score:${cand.score?.toFixed(4)}` : '无'}`);
}

const logic = new GameLogic();
logic.loadLevel(data);

const MAX = 200_000;
const sampleFrames = new Set();
for (let i = 1; i <= SAMPLES; i++) sampleFrames.add(Math.floor(MAX * i / (SAMPLES+1)));
sampleFrames.add(MAX-1);

let frames = 0, deployCount = 0;

// 打印初始状态
printState(logic, 0, '初始');

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
        deployCount++;
      }
    }
  }

  logic.update();
  const bullets = logic.flushPendingBullets();
  for (const b of bullets) {
    logic.onBulletHit(b.turretId, b.col, b.row);
    if (logic.state !== 'playing') break;
  }

  if (sampleFrames.has(frames)) {
    printState(logic, frames, `采样`);
  }
}

printState(logic, frames, '最终');
console.log(`\n结果: ${logic.state}  帧:${frames}  部署:${deployCount}  失败:${logic.failReason}`);
