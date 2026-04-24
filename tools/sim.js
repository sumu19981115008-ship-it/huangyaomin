/**
 * 纯逻辑跑关模拟器（无渲染）
 *
 * 用法：
 *   node tools/sim.js [关卡目录] [起始关] [结束关]
 *
 * 示例：
 *   node tools/sim.js levels/a 1 50       # 跑 A 组第 1~50 关
 *   node tools/sim.js levels/b 1 171      # 跑 B 组全部
 *   node tools/sim.js levels/a 13 13      # 只跑第 13 关（调试）
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
const [,, dir = 'levels/a', fromStr = '1', toStr = '10'] = process.argv;
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

  // 挖坑承诺：一旦开始停某条队列，锁定直到目标颜色到达队头
  let commitLane = null;

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
        const candidate = pickCandidate(logic, commitLane);
        if (candidate) {
          deploy(logic, candidate);
          deployCount++;
          // 更新承诺状态
          if (candidate._commitLane !== undefined) commitLane = candidate._commitLane;
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

// ── v10 辅助函数 ──────────────────────────────────────────────

/**
 * 构建每种颜色的最小遮挡深度（四方向扫描）
 * 返回 { color: minDepth }，depth=0 表示已暴露
 */
function buildBlockDepth(logic) {
  const { GW, GH } = G;
  const grid = logic.grid;
  const minDepth = {};

  const update = (color, depth) => {
    if (!(color in minDepth) || depth < minDepth[color])
      minDepth[color] = depth;
  };

  // 从下往上（BOTTOM方向射入），每列扫描
  for (let col = 0; col < GW; col++) {
    let depth = 0;
    for (let row = GH - 1; row >= 0; row--) {
      if (grid[row]?.[col] != null) {
        update(grid[row][col], depth);
        depth++;
      }
    }
  }
  // 从上往下（TOP方向射入），每列扫描
  for (let col = 0; col < GW; col++) {
    let depth = 0;
    for (let row = 0; row < GH; row++) {
      if (grid[row]?.[col] != null) {
        update(grid[row][col], depth);
        depth++;
      }
    }
  }
  // 从右往左（RIGHT方向射入），每行扫描
  for (let row = 0; row < GH; row++) {
    let depth = 0;
    for (let col = GW - 1; col >= 0; col--) {
      if (grid[row]?.[col] != null) {
        update(grid[row][col], depth);
        depth++;
      }
    }
  }
  // 从左往右（LEFT方向射入），每行扫描
  for (let row = 0; row < GH; row++) {
    let depth = 0;
    for (let col = 0; col < GW; col++) {
      if (grid[row]?.[col] != null) {
        update(grid[row][col], depth);
        depth++;
      }
    }
  }

  return minDepth;
}

/**
 * 逐格计算四方向最小遮挡深度，返回 cellDepth[row][col]
 * depth=0 表示该格从某方向直接暴露，depth=k 表示需要先清 k 层其他颜色
 */
function buildCellDepth(logic) {
  const { GW, GH } = G;
  const grid = logic.grid;
  const cellDepth = Array.from({ length: GH }, () => Array(GW).fill(Infinity));

  // 从下往上（炮从底部射入）
  for (let col = 0; col < GW; col++) {
    let d = 0;
    for (let row = GH - 1; row >= 0; row--) {
      if (grid[row]?.[col] != null) { cellDepth[row][col] = Math.min(cellDepth[row][col], d); d++; }
    }
  }
  // 从上往下
  for (let col = 0; col < GW; col++) {
    let d = 0;
    for (let row = 0; row < GH; row++) {
      if (grid[row]?.[col] != null) { cellDepth[row][col] = Math.min(cellDepth[row][col], d); d++; }
    }
  }
  // 从右往左
  for (let row = 0; row < GH; row++) {
    let d = 0;
    for (let col = GW - 1; col >= 0; col--) {
      if (grid[row]?.[col] != null) { cellDepth[row][col] = Math.min(cellDepth[row][col], d); d++; }
    }
  }
  // 从左往右
  for (let row = 0; row < GH; row++) {
    let d = 0;
    for (let col = 0; col < GW; col++) {
      if (grid[row]?.[col] != null) { cellDepth[row][col] = Math.min(cellDepth[row][col], d); d++; }
    }
  }
  return cellDepth;
}

/**
 * 基于逐格深度计算每种颜色的"紧迫需求分"
 * urgency[color] = Σ 1/(cellDepth+1)，对该颜色所有格求和
 * depth=0（已暴露）贡献 1.0，depth=1 贡献 0.5，depth=k 贡献 1/(k+1)
 * 颜色方块越多且越浅，urgency 越高
 */
function computeUrgency(cellDepth, logic) {
  const { GW, GH } = G;
  const grid = logic.grid;
  const urgency = {};
  for (let row = 0; row < GH; row++) {
    for (let col = 0; col < GW; col++) {
      const color = grid[row]?.[col];
      if (color == null) continue;
      const d = cellDepth[row][col];
      urgency[color] = (urgency[color] ?? 0) + 1 / (d + 1);
    }
  }
  return urgency;
}

/**
 * v10 候选车评分
 *
 * 可达色候选：
 *   score = urgency[color] * ammoMatch / (1 + onTrack * 0.5)
 *   ammoMatch = min(部署弹药, 剩余方块数) / max(部署弹药, 剩余方块数)
 *              → 弹药和方块数越接近越高
 *
 * 停车候选（_unlock）：
 *   score = (解锁目标urgency * 解锁弹药匹配) / (1 + dist) / (1 + _cost/20)
 *   再乘以 0.5 降权（停车不直接打块，始终劣于可达色）
 */
function v10Score(c, urgency, colorCount, colorAmmo, exposureMap, inFallback) {
  const { TOTAL_DIST } = G;

  if (c._unlock) {
    const targetColor = c._targetColor;
    if (!targetColor) return 0;
    const tUrgency = urgency[targetColor] ?? 0;
    const tBlocks  = colorCount[targetColor] ?? 1;
    const tAmmo    = colorAmmo[targetColor]  ?? 0;
    const ammoFit  = 1 / (1 + Math.abs(tAmmo - tBlocks));
    // 融合urgency与ammoFit，再按停车成本/距离降权
    return 0.6 * tUrgency * ammoFit * (1 / (1 + c._cost / 20));
  }

  // 可达色：urgency替换旧的ammoFit分母，保留exposureMap位置权重
  const u       = urgency[c.color] ?? 0;
  const blocks  = colorCount[c.color] ?? 0;
  const ammo    = colorAmmo[c.color]  ?? c.ammo;
  const ammoFit = 1 / (1 + Math.abs(ammo - blocks));
  const ep      = exposureMap[c.color] ?? TOTAL_DIST;
  let score     = u * ammoFit * (1 / (1 + ep / (TOTAL_DIST * 2)));
  if (inFallback) score *= 1 / (1 + ep / TOTAL_DIST);
  return score;
}


function pickCandidate(logic, commitLane) {
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

  const trackUsed  = logic.turrets.length;
  const trackCap   = logic.trackCap ?? 5;
  const freeSlots  = trackCap - trackUsed;

  // 挖坑承诺：锁定某条队列，持续停车直到队头变为可达色
  if (commitLane && freeSlots >= 1) {
    const { laneIdx } = commitLane;
    const lane = logic.lanes[laneIdx];
    if (lane && lane.length > 0) {
      const head = lane[0];
      const headReachable = reachable.has(head.color);
      const headUseful    = (colorCount[head.color] ?? 0) > 0;
      const headOnTrack   = (trackColorCount[head.color] || 0) > 0;
      if (!headReachable && headUseful && !headOnTrack) {
        // 队头仍是不可达色，继续挖
        return { source: 'lane', laneIdx, color: head.color, ammo: head.ammo,
                 _unlock: true, _commitLane: commitLane };
      }
      // 队头已是可达色（或无需停），承诺自然结束，fall through 正常评分
    }
    // 承诺的队列已空或条件不满足，清除承诺
    // _commitLane = null 在下面的 chosen 赋值处处理
  }

  const inFallback = reachPool.length === 0;

  // 停车场策略：计算每条阻塞队列的"挖掘价值"
  // 价值 = 挖通后可获得的所有可达色弹药总和 - 需要停车的弹药成本
  const unlockPool = [];
  if (freeSlots > 0) {
    for (let li = 0; li < logic.lanes.length; li++) {
      const lane = logic.lanes[li];
      if (lane.length < 2) continue;
      const head = lane[0];
      if (reachable.has(head.color)) continue;
      if ((colorCount[head.color] ?? 0) === 0) continue;
      if ((trackColorCount[head.color] || 0) > 0) continue;
      // 扫描队列：统计需要停车的弹药成本，以及能挖出的可达色弹药收益
      let cost = 0, gain = 0, dist = Infinity, targetColor = null;
      for (let j = 0; j < Math.min(10, lane.length); j++) {
        const car = lane[j];
        if (reachable.has(car.color)) {
          gain += car.ammo;
          if (dist === Infinity) { dist = j; targetColor = car.color; }
        } else {
          if (j > 0) cost += car.ammo; // j=0 是当前头部（即将停的这辆），单独计
        }
      }
      if (dist === Infinity) continue;
      unlockPool.push({ source: 'lane', laneIdx: li, color: head.color,
                        ammo: head.ammo, idle: false, _unlock: true,
                        _dist: dist, _targetColor: targetColor,
                        _gain: gain, _cost: cost });
    }
  }

  // 主动挖坑：开局全部inFallback时（轨道为空），阈值低（1.2，别无他选）
  const allEmpty = logic.turrets.length === 0;
  if (inFallback && allEmpty && freeSlots >= 2 && unlockPool.length > 0) {
    const worthwhile = unlockPool.filter(u => u._gain > u._cost * 1.2 && u._dist <= 3);
    if (worthwhile.length > 0) {
      worthwhile.sort((a, b) => (b._gain - b._cost) - (a._gain - a._cost));
      const best = worthwhile[0];
      best._commitLane = { laneIdx: best.laneIdx };
      return best;
    }
  }

  // inFallback但不是allEmpty时：优先选择1步可达的解锁候选
  if (inFallback && !allEmpty && freeSlots >= 1) {
    const nearUnlock = unlockPool.filter(u => u._dist === 1);
    if (nearUnlock.length > 0) {
      nearUnlock.sort((a, b) => (b._gain - b._cost) - (a._gain - a._cost));
      const best = nearUnlock[0];
      best._commitLane = { laneIdx: best.laneIdx };
      return best;
    }
  }

  // ── v10：容量感知评分 ──────────────────────────────────────
  const cellDepth   = buildCellDepth(logic);
  const urgency     = computeUrgency(cellDepth, logic);
  const exposureMap = computeColorExposurePathPos(logic);

  const use = inFallback ? candidates : [...reachPool, ...unlockPool];
  for (const c of use) {
    let score = v10Score(c, urgency, colorCount, colorAmmo, exposureMap, inFallback);
    // 轨道已有同色车时衰减，避免重复部署
    const onTrack = trackColorCount[c.color] || 0;
    if (onTrack > 0) score *= Math.pow(0.6, onTrack);
    c.score = score;
  }
  use.sort((a, b) => {
    const ds = b.score - a.score;
    if (Math.abs(ds) > 1e-9) return ds;
    // 同分时优先 buffer（缓解溢出风险）
    if (a.source === 'buffer' && b.source !== 'buffer') return -1;
    if (b.source === 'buffer' && a.source !== 'buffer') return  1;
    return 0;
  });

  const chosen = use[0];
  chosen._commitLane = null;
  return chosen;
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
