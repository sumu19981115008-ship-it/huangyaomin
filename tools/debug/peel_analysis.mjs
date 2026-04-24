/**
 * 剥离序列 vs 队列序列分析工具
 *
 * 用法：node tools/peel_analysis.mjs [目录] [关卡号]
 * 示例：node tools/peel_analysis.mjs levels_a2 100
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = resolve(__dir, '..');

const [,, dir = 'levels_a2', lvlStr = '100'] = process.argv;
const lvl  = parseInt(lvlStr);
const file = resolve(ROOT, dir, `level${lvl}.json`);
const data = JSON.parse(readFileSync(file, 'utf8'));

const { colorTable, boardWidth: W, boardHeight: H, QueueGroup, PixelImageData } = data;
const pixels = PixelImageData.pixels;

// ── 1. 构建 grid ─────────────────────────────────────────────
const grid = Array.from({ length: H }, () => Array(W).fill(null));
for (const p of pixels) grid[p.y][p.x] = colorTable[p.material];

// ── 2. 按轨道 pathPos 计算每个方块的首次暴露时刻 ────────────
// 轨道顺序：BOTTOM(col*CELL) → RIGHT(LEN_B+(GH-1-row)*CELL) → TOP(LEN_B+LEN_R+(GW-1-col)*CELL) → LEFT(LEN_B+LEN_R+LEN_T+row*CELL)
// 每条边：从外向内扫该行/列，第一个非空格才可被打到
// 某方块的首次暴露 pathPos = 四边中最小的"该方块恰好是外层第一个"的 pathPos

const CELL = 1; // 归一化，pathPos 单位 = 格数（不影响相对顺序）
const LEN_B = W, LEN_R = H, LEN_T = W, LEN_L = H;

function computeExposurePathPos(grid, W, H) {
  // blockExposure[row][col] = 该格首次暴露的 pathPos（Infinity=永不暴露，即被挡住）
  const exposure = Array.from({ length: H }, () => Array(W).fill(Infinity));

  // BOTTOM：从下往上，每列第一个非空格
  for (let col = 0; col < W; col++) {
    const pathPos = col * CELL; // 炮车经过该列时的 pathPos
    for (let row = H - 1; row >= 0; row--) {
      if (grid[row][col] != null) { exposure[row][col] = Math.min(exposure[row][col], pathPos); break; }
    }
  }
  // RIGHT：从右往左，每行第一个非空格
  for (let row = 0; row < H; row++) {
    const pathPos = LEN_B + (H - 1 - row) * CELL;
    for (let col = W - 1; col >= 0; col--) {
      if (grid[row][col] != null) { exposure[row][col] = Math.min(exposure[row][col], pathPos); break; }
    }
  }
  // TOP：从上往下，每列第一个非空格
  for (let col = 0; col < W; col++) {
    const pathPos = LEN_B + LEN_R + (W - 1 - col) * CELL;
    for (let row = 0; row < H; row++) {
      if (grid[row][col] != null) { exposure[row][col] = Math.min(exposure[row][col], pathPos); break; }
    }
  }
  // LEFT：从左往右，每行第一个非空格
  for (let row = 0; row < H; row++) {
    const pathPos = LEN_B + LEN_R + LEN_T + row * CELL;
    for (let col = 0; col < W; col++) {
      if (grid[row][col] != null) { exposure[row][col] = Math.min(exposure[row][col], pathPos); break; }
    }
  }
  return exposure;
}

const exposure = computeExposurePathPos(grid, W, H);

// 每种颜色的首次暴露 pathPos = 该颜色所有方块中最小值
const colorLayer = {}; // color -> 首次暴露 pathPos（越小越早）
for (const p of pixels) {
  const color = colorTable[p.material];
  const ep = exposure[p.y][p.x];
  if (!(color in colorLayer) || ep < colorLayer[color]) colorLayer[color] = ep;
}

// 为了兼容后续输出，构建伪 layers（按 pathPos 分段，每段=1格）
const layers = [];

// ── 3. 统计各色总方块数 ──────────────────────────────────────
const colorTotal = {};
for (const p of pixels) {
  const c = colorTable[p.material];
  colorTotal[c] = (colorTotal[c] || 0) + 1;
}

// ── 4. 统计各色总弹药 + 队列中出现的顺序位置 ────────────────
const colorAmmo = {};
const colorQueuePositions = {}; // color -> [{lane, pos, ammo}]
for (let li = 0; li < QueueGroup.length; li++) {
  for (let ti = 0; ti < QueueGroup[li].length; ti++) {
    const t = QueueGroup[li][ti];
    const color = colorTable[t.material];
    colorAmmo[color] = (colorAmmo[color] || 0) + t.ammo;
    if (!colorQueuePositions[color]) colorQueuePositions[color] = [];
    colorQueuePositions[color].push({ lane: li, pos: ti, ammo: t.ammo });
  }
}

// ── 5. 输出剥离序列摘要 ──────────────────────────────────────
console.log(`\n=== ${dir} Level ${lvl} 剥离序列分析 ===`);
console.log(`网格: ${W}×${H}  总方块: ${pixels.length}  总层数: ${layers.length}  队列数: ${QueueGroup.length}\n`);

console.log('── 各颜色首次暴露层 ──────────────────────────────────');
console.log('颜色        首暴层  方块数  弹药数  差值  队列最早位置');
const sortedColors = Object.keys(colorLayer).sort((a, b) => colorLayer[a] - colorLayer[b]);
for (const c of sortedColors) {
  const layer  = colorLayer[c];
  const blocks = colorTotal[c] || 0;
  const ammo   = colorAmmo[c]  || 0;
  const diff   = ammo - blocks;
  const positions = colorQueuePositions[c] || [];
  const earliest  = positions.length ? `L${positions[0].lane}[${positions[0].pos}]` : '无';
  const shortC    = c.slice(1); // 去掉#
  console.log(`#${shortC}  层${String(layer).padStart(2)}   ${String(blocks).padStart(4)}    ${String(ammo).padStart(4)}   ${String(diff).padStart(3)}   ${earliest}`);
}

// ── 6. 输出队列序列（各队列前10辆）─────────────────────────
console.log('\n── 各队列前15辆炮车 ────────────────────────────────────');
for (let li = 0; li < QueueGroup.length; li++) {
  const lane = QueueGroup[li];
  const items = lane.slice(0, 15).map((t, i) => {
    const c = colorTable[t.material];
    const layer = colorLayer[c] ?? '?';
    return `[${i}]${c.slice(1)}(层${layer},${t.ammo}发)`;
  });
  console.log(`L${li}: ${items.join('  ')}`);
}

// ── 7. 检测死锁风险：队首颜色比队列内后续颜色层更深 ──────────
console.log('\n── 死锁风险检测（队首层 > 队内后续层）──────────────────');
let riskFound = false;
for (let li = 0; li < QueueGroup.length; li++) {
  const lane = QueueGroup[li];
  if (lane.length < 2) continue;
  const headColor = colorTable[lane[0].material];
  const headLayer = colorLayer[headColor] ?? 0;
  for (let ti = 1; ti < Math.min(lane.length, 10); ti++) {
    const c = colorTable[lane[ti].material];
    const l = colorLayer[c] ?? 0;
    if (l < headLayer) {
      console.log(`⚠ L${li}: 队首 ${headColor}(层${headLayer}) 比位置[${ti}] ${c}(层${l}) 更深 → 浅层色被压住`);
      riskFound = true;
    }
  }
}
if (!riskFound) console.log('未检测到明显死锁风险');

// ── 8. 输出逐层剥离摘要（颜色组合）────────────────────────────
console.log('\n── 逐层剥离颜色分布（前10层）──────────────────────────');
for (let i = 0; i < Math.min(layers.length, 10); i++) {
  const layer = layers[i];
  const total = Object.values(layer).reduce((s, v) => s + v, 0);
  const parts = Object.entries(layer)
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${c.slice(1)}×${n}`)
    .join('  ');
  console.log(`层${String(i).padStart(2)} (${String(total).padStart(3)}格): ${parts}`);
}
if (layers.length > 10) console.log(`  ...共 ${layers.length} 层`);
