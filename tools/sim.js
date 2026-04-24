/**
 * 纯逻辑跑关模拟器（无渲染）
 *
 * 用法：
 *   node tools/sim.js [关卡目录] [起始关] [结束关]
 *
 * 示例：
 *   node tools/sim.js levels_a2 1 50       # 跑 A 组第 1~50 关
 *   node tools/sim.js levels_b2 1 167       # 跑 B 组全部
 *   node tools/sim.js levels_a2 13 13       # 只跑第 13 关（调试）
 *
 * 输出：每关的结果（win/fail/stuck）、帧数、无用车剔除次数
 */

import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = resolve(__dir, '..');

// ── 从 src/ 直接引入逻辑层 ────────────────────────────────────
import { GameLogic } from '../src/GameLogic.js';
import { G, SIDE }   from '../src/constants.js';

// ── 参数解析 ──────────────────────────────────────────────────
const [,, dir = 'levels_a2', fromStr = '1', toStr = '10'] = process.argv;
const fromIdx = parseInt(fromStr) - 1;  // 转 0-based
const toIdx   = parseInt(toStr)   - 1;

// ── 模拟器主循环 ──────────────────────────────────────────────
const MAX_FRAMES  = 200_000;  // 防无限循环
const TURRET_SPEED = 3;       // 与 constants.js 一致

// 计算子弹从炮车位置到目标格的像素距离，从而推算飞行帧数
// 炮车在轨道边缘外侧，子弹沿垂直方向射入画布
function bulletFlightFrames(bullet) {
  const { CELL, CANVAS_X, CANVAS_Y, GW, GH, CW, CH,
          LEN_BOTTOM, LEN_RIGHT, LEN_TOP } = G;
  const { col, row, fromPathPos } = bullet;
  const BULLET_SPEED = 14;

  // 目标格中心坐标
  const targetX = CANVAS_X + col * CELL + CELL / 2;
  const targetY = CANVAS_Y + row * CELL + CELL / 2;

  // 炮车在轨道上的屏幕坐标（轨道在画布外侧 TRACK_GAP=22 处）
  const TRACK_GAP = 22;
  let sx, sy;
  const p = fromPathPos;
  if (p < LEN_BOTTOM) {
    sx = CANVAS_X + p;
    sy = CANVAS_Y + CH + TRACK_GAP;
  } else if (p < LEN_BOTTOM + LEN_RIGHT) {
    sx = CANVAS_X + CW + TRACK_GAP;
    sy = CANVAS_Y + CH - (p - LEN_BOTTOM);
  } else if (p < LEN_BOTTOM + LEN_RIGHT + LEN_TOP) {
    sx = CANVAS_X + CW - (p - LEN_BOTTOM - LEN_RIGHT);
    sy = CANVAS_Y - TRACK_GAP;
  } else {
    sx = CANVAS_X - TRACK_GAP;
    sy = CANVAS_Y + (p - LEN_BOTTOM - LEN_RIGHT - LEN_TOP);
  }

  const dist = Math.sqrt((targetX - sx) ** 2 + (targetY - sy) ** 2);
  return Math.max(1, Math.round(dist / BULLET_SPEED));
}

function simulate(data) {
  const logic = new GameLogic();
  logic.loadLevel(data);

  let frames      = 0;
  let deployCount = 0;

  // 在途子弹队列：{ landFrame, turretId, col, row }
  const inFlight = [];

  while (logic.state === 'playing' && frames < MAX_FRAMES) {
    frames++;

    // 1. 处理本帧到达的子弹
    let i = 0;
    while (i < inFlight.length) {
      if (inFlight[i].landFrame <= frames) {
        const b = inFlight.splice(i, 1)[0];
        logic.onBulletHit(b.turretId, b.col, b.row);
        if (logic.state !== 'playing') break;
      } else {
        i++;
      }
    }
    if (logic.state !== 'playing') break;

    // 2. Bot 决策：尝试部署一辆车
    if (!logic.isTrackFull()) {
      const SAFE_GAP = 28;
      const blocked  = logic.turrets.some(t => !t.lapComplete && t.pathPos < SAFE_GAP);
      if (!blocked) {
        const candidate = pickCandidate(logic);
        if (candidate) {
          deploy(logic, candidate);
          deployCount++;
        }
      }
    }

    // 3. 炮车移动 + 生成新子弹（加入飞行队列，延迟命中）
    logic.update();
    for (const b of logic.flushPendingBullets()) {
      const delay = bulletFlightFrames(b);
      inFlight.push({ landFrame: frames + delay, ...b });
    }
  }

  const stuck = frames >= MAX_FRAMES;
  return { result: stuck ? 'stuck' : logic.state, frames, deployCount,
           failReason: logic.failReason ?? null };
}

// ── Bot 决策（与 AutoBot.js 逻辑一致，无 Phaser 依赖） ────────

function countColors(logic) {
  const map = {};
  for (const b of logic.blocks) map[b.color] = (map[b.color] ?? 0) + 1;
  return map;
}

function computeReachable(logic) {
  const { GW, GH } = G;
  const grid = logic.grid;
  const set  = new Set();
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

// 按轨道 pathPos 顺序计算每种颜色的首次暴露位置（越小越早）
function computeColorExposurePathPos(logic) {
  const { GW, GH, LEN_BOTTOM, LEN_RIGHT, LEN_TOP, CELL } = G;
  const grid = logic.grid;
  const blockExposure = {}; // color -> min pathPos across all its blocks

  const update = (color, pathPos) => {
    if (!(color in blockExposure) || pathPos < blockExposure[color])
      blockExposure[color] = pathPos;
  };

  // BOTTOM: 从下往上，每列最底部第一个非空格
  for (let col = 0; col < GW; col++) {
    const pp = col * CELL;
    for (let row = GH - 1; row >= 0; row--) {
      if (grid[row]?.[col] != null) { update(grid[row][col], pp); break; }
    }
  }
  // RIGHT: 从右往左，每行最右边第一个非空格
  for (let row = 0; row < GH; row++) {
    const pp = LEN_BOTTOM + (GH - 1 - row) * CELL;
    for (let col = GW - 1; col >= 0; col--) {
      if (grid[row]?.[col] != null) { update(grid[row][col], pp); break; }
    }
  }
  // TOP: 从上往下，每列最顶部第一个非空格
  for (let col = 0; col < GW; col++) {
    const pp = LEN_BOTTOM + LEN_RIGHT + (GW - 1 - col) * CELL;
    for (let row = 0; row < GH; row++) {
      if (grid[row]?.[col] != null) { update(grid[row][col], pp); break; }
    }
  }
  // LEFT: 从左往右，每行最左边第一个非空格
  for (let row = 0; row < GH; row++) {
    const pp = LEN_BOTTOM + LEN_RIGHT + LEN_TOP + row * CELL;
    for (let col = 0; col < GW; col++) {
      if (grid[row]?.[col] != null) { update(grid[row][col], pp); break; }
    }
  }
  return blockExposure;
}


function pickCandidate(logic) {
  const colorCount = countColors(logic);
  const candidates = [];

  for (let i = 0; i < logic.buffer.length; i++) {
    const t = logic.buffer[i];
    if ((colorCount[t.color] ?? 0) === 0) continue;
    candidates.push({ source: 'buffer', bufferIdx: i, color: t.color, ammo: t.ammo,
                      idle: t.idleLastLap ?? false });
  }
  for (let li = 0; li < logic.lanes.length; li++) {
    const lane = logic.lanes[li];
    if (!lane.length) continue;
    const t = lane[0];
    if ((colorCount[t.color] ?? 0) === 0) continue;
    candidates.push({ source: 'lane', laneIdx: li, color: t.color, ammo: t.ammo, idle: false });
  }
  if (!candidates.length) return null;

  const reachable    = computeReachable(logic);
  const exposureMap  = computeColorExposurePathPos(logic);
  const { TOTAL_DIST } = G;

  const trackColorCount = {};
  for (const t of logic.turrets) trackColorCount[t.color] = (trackColorCount[t.color] || 0) + 1;

  // buffer 危险预判：当前 buffer 数 + 即将跑完一圈的车数 >= bufferCap
  const soonDone = logic.turrets.filter(
    t => !t.lapComplete && t.ammo > 0 && t.pathPos >= TOTAL_DIST * 0.8
  ).length;
  const bufferDanger = logic.buffer.length + soonDone >= logic.bufferCap - 1;
  if (bufferDanger) {
    const bufCandidates = candidates.filter(c => c.source === 'buffer');
    if (bufCandidates.length > 0) {
      const reachBuf = bufCandidates.filter(c => reachable.has(c.color));
      const pool = reachBuf.length > 0 ? reachBuf : bufCandidates;
      pool.sort((a, b) => a.ammo - b.ammo);
      return pool[0];
    }
  }

  // 统计所有待部署弹药（全队列 + buffer）以获得准确的弹药匹配评分
  const colorAmmo = {};
  for (const lane of logic.lanes)
    for (const t of lane) colorAmmo[t.color] = (colorAmmo[t.color] ?? 0) + t.ammo;
  for (const t of logic.buffer) colorAmmo[t.color] = (colorAmmo[t.color] ?? 0) + t.ammo;

  const reachPool  = candidates.filter(c => reachable.has(c.color));
  const inFallback = reachPool.length === 0;
  const norm = TOTAL_DIST;

  // 轨道有余量时，把「阻塞队列的不可达头部」也加入候选池
  // 条件：在轨数 <= trackCap-2，弹药<=20，在轨同色=0，后续5步内有可达色
  const trackUsed = logic.turrets.length;
  const trackCap  = logic.trackCap ?? 5;
  const unlockPool = [];
  if (!inFallback && trackUsed <= trackCap - 2) {
    for (let li = 0; li < logic.lanes.length; li++) {
      const lane = logic.lanes[li];
      if (lane.length < 2) continue;
      const head = lane[0];
      if (reachable.has(head.color)) continue;
      if ((colorCount[head.color] ?? 0) === 0) continue;
      if ((trackColorCount[head.color] || 0) > 0) continue;
      if (head.ammo > 20) continue;
      // 后续5步内有可达色
      let hasBehind = false;
      for (let j = 1; j <= Math.min(5, lane.length - 1); j++) {
        if (reachable.has(lane[j].color)) { hasBehind = true; break; }
      }
      if (!hasBehind) continue;
      unlockPool.push({ source: 'lane', laneIdx: li, color: head.color,
                        ammo: head.ammo, idle: false, _unlock: true });
    }
  }

  const use = inFallback ? candidates : [...reachPool, ...unlockPool];
  for (const c of use) {
    const blockCount = colorCount[c.color] ?? 0;
    const ammoSum    = colorAmmo[c.color]  ?? 0;
    let score = 1 / (1 + Math.abs(ammoSum - blockCount));
    const onTrack = trackColorCount[c.color] || 0;
    if (onTrack > 0) score *= Math.pow(0.6, onTrack);
    // 曝光 pathPos 惩罚：无论是否兜底，极晚才可打的颜色得分下降
    // 使用弱惩罚（norm*2 归一化），避免影响正常浅层颜色的相对排序
    const ep = exposureMap[c.color] ?? norm;
    score *= 1 / (1 + ep / (norm * 2));
    // 解锁候选额外降权（因为部署后不能立即打块，只能解锁队列）
    if (c._unlock) {
      score *= 0.6 * (1 / (1 + c.ammo / 20));
    }
    c.score = score;
  }
  use.sort((a, b) => {
    const ds = b.score - a.score;
    if (Math.abs(ds) > 1e-9) return ds;
    if (a.source === 'buffer' && b.source !== 'buffer') return -1;
    if (b.source === 'buffer' && a.source !== 'buffer') return  1;
    return 0;
  });
  return use[0];
}

function deploy(logic, c) {
  if (c.source === 'buffer') logic.deployFromBuffer(c.bufferIdx);
  else                       logic.deployFromLane(c.laneIdx);
}

// ── 批量跑关 ──────────────────────────────────────────────────

const levelDir = resolve(ROOT, dir);
let files;
try {
  files = readdirSync(levelDir)
    .filter(f => f.endsWith('.json'))
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+/)?.[0] ?? 0);
      const nb = parseInt(b.match(/\d+/)?.[0] ?? 0);
      return na - nb;
    });
} catch (e) {
  console.error(`目录不存在：${levelDir}`);
  process.exit(1);
}

const subset = files.slice(fromIdx, toIdx + 1);
console.log(`\n跑关范围：${dir}  第 ${fromIdx+1} ~ ${toIdx+1} 关（共 ${subset.length} 关）\n`);

const results = { win: 0, fail: 0, stuck: 0 };
const failList = [], stuckList = [];

for (let i = 0; i < subset.length; i++) {
  const file  = subset[i];
  const level = fromIdx + i + 1;
  let data;
  try {
    data = JSON.parse(readFileSync(resolve(levelDir, file), 'utf8'));
  } catch (e) {
    console.log(`  L${level}  [ERROR] 文件读取失败：${e.message}`);
    continue;
  }

  const { result, frames, deployCount, failReason } = simulate(data);
  results[result] = (results[result] ?? 0) + 1;

  const tag = result === 'win'   ? '✓' :
              result === 'fail'  ? '✗' : '?';
  const detail = result === 'fail'  ? `  失败原因：${failReason}` :
                 result === 'stuck' ? `  超过 ${MAX_FRAMES} 帧未结束` : '';
  console.log(`  L${String(level).padStart(3)}  [${tag}]  帧:${String(frames).padStart(6)}  部署:${String(deployCount).padStart(4)}${detail}`);

  if (result === 'fail')  failList.push(level);
  if (result === 'stuck') stuckList.push(level);
}

console.log(`\n── 汇总 ──────────────────────────────`);
console.log(`  通关 ✓  ${results.win  ?? 0}`);
console.log(`  失败 ✗  ${results.fail ?? 0}  ${failList.length  ? `(${failList.join(', ')})` : ''}`);
console.log(`  卡关 ?  ${results.stuck ?? 0}  ${stuckList.length ? `(${stuckList.join(', ')})` : ''}`);
console.log(`  合计     ${subset.length}\n`);
