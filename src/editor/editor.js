// FixelFlow 2 关卡编辑器
// 坐标系：JSON 原始坐标 y 向上（0=底），canvas 绘制 row 向下（0=顶）
// 转换：row = (boardHeight-1) - cell.y   /   cell.y = (boardHeight-1) - row

// ── 状态 ──────────────────────────────────────────────────────────────────────

const state = {
  levels: [],          // 文件名列表 ['level1.json', ...]
  currentFile: null,   // 当前文件名
  data: null,          // 当前关卡 JSON 对象（直接操作）
  brushColor: null,    // 当前画笔颜色，null = 橡皮
  zoom: 16,            // 每格像素
  painting: false,     // 鼠标按下中
  paintMode: null,     // 'draw' | 'erase'
};

// ── DOM 引用 ──────────────────────────────────────────────────────────────────

const elLevelList   = document.getElementById('level-list');
const elCanvas      = document.getElementById('main-canvas');
const elTbWidth     = document.getElementById('tb-width');
const elTbHeight    = document.getElementById('tb-height');
const elTbZoom      = document.getElementById('tb-zoom');
const elTbInfo      = document.getElementById('tb-info');
const elPropW       = document.getElementById('prop-w');
const elPropH       = document.getElementById('prop-h');
const elPropLanes   = document.getElementById('prop-lanes');
const elBrushColors = document.getElementById('brush-colors');
const elNewColor    = document.getElementById('new-color-input');
const elAddColor    = document.getElementById('add-color-btn');
const elColorRows   = document.getElementById('color-rows');
const elBtnSave     = document.getElementById('btn-save');
const elBtnNorm     = document.getElementById('btn-normalize');
const elSaveMsg     = document.getElementById('save-msg');
const elStatusbar   = document.getElementById('statusbar');
const ctx           = elCanvas.getContext('2d');

// ── 工具函数 ──────────────────────────────────────────────────────────────────

const ceil10  = n => Math.ceil(n / 10) * 10 || 10;
const floor10 = n => Math.floor(n / 10) * 10;
const clamp   = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function colorUpper(c) { return c.toUpperCase(); }

// 统计有效方块（过滤越界）
function countBlocks(data) {
  const bw = data.boardWidth, bh = data.boardHeight;
  const map = {};
  for (const e of data.entities) {
    if (e.type !== 'PixelBlock') continue;
    const c = colorUpper(e.color);
    for (const cell of e.cells) {
      const row = (bh - 1) - cell.y;
      if (cell.x >= 0 && cell.x < bw && row >= 0 && row < bh) {
        map[c] = (map[c] || 0) + 1;
      }
    }
  }
  return map;
}

// 统计弹药
function countAmmo(data) {
  const map = {};
  for (const t of data.initialTanks) {
    const c = colorUpper(t.color);
    map[c] = (map[c] || 0) + t.ammo;
  }
  return map;
}

// 所有出现的颜色（方块 + 炮车）
function allColors(data) {
  const s = new Set();
  for (const e of data.entities)
    if (e.type === 'PixelBlock') s.add(colorUpper(e.color));
  for (const t of data.initialTanks)
    s.add(colorUpper(t.color));
  return [...s].sort();
}

// 默认炮车模板
function tankTemplate(color, ammo, lane, position) {
  return {
    color, ammo, lane, position,
    isLinked: false, linkedGroupId: -1,
    isMystery: false, isLock: false,
    stoneData: { amount: 0 }, isHammer: false,
  };
}

// ── 关卡列表 ──────────────────────────────────────────────────────────────────

async function loadLevelList() {
  const res  = await fetch('/api/level-list');
  state.levels = await res.json();
  elLevelList.innerHTML = '';
  for (const fname of state.levels) {
    const num  = fname.replace('level', '').replace('.json', '');
    const div  = document.createElement('div');
    div.className = 'level-item';
    div.textContent = `Level ${num}`;
    div.dataset.file = fname;
    div.addEventListener('click', () => openLevel(fname));
    elLevelList.appendChild(div);
  }
}

// ── 关卡加载 ──────────────────────────────────────────────────────────────────

async function openLevel(fname) {
  const res  = await fetch(`/levels/${fname}`);
  state.data = await res.json();
  state.currentFile = fname;

  // 确保字段存在
  if (!state.data.boardWidth)  state.data.boardWidth  = state.data.boardSize || 20;
  if (!state.data.boardHeight) state.data.boardHeight = state.data.boardSize || 20;
  if (!state.data.numberOfLanes)  state.data.numberOfLanes  = 2;
  if (!state.data.initialTanks)   state.data.initialTanks   = [];
  if (!state.data.entities)       state.data.entities       = [];
  if (!state.data.shooterPipes)   state.data.shooterPipes   = [];
  if (!state.data.maxTanksOnConveyor) state.data.maxTanksOnConveyor = 5;

  // 高亮列表
  document.querySelectorAll('.level-item').forEach(el => {
    el.classList.toggle('active', el.dataset.file === fname);
  });

  // 同步工具栏
  elTbWidth.value  = state.data.boardWidth;
  elTbHeight.value = state.data.boardHeight;
  elPropW.value    = state.data.boardWidth;
  elPropH.value    = state.data.boardHeight;
  elPropLanes.value = state.data.numberOfLanes;

  // 初始化画笔颜色（取第一个颜色）
  const colors = allColors(state.data);
  if (colors.length && !colors.includes(state.brushColor)) {
    state.brushColor = colors[0];
  }

  renderBrushPalette();
  renderColorRows();
  renderCanvas();
  setStatus(`已加载 ${fname}（${state.data.boardWidth}×${state.data.boardHeight}）`);
  showSaveMsg('');
}

// ── Canvas 渲染 ───────────────────────────────────────────────────────────────

function renderCanvas() {
  if (!state.data) return;
  const bw = state.data.boardWidth;
  const bh = state.data.boardHeight;
  const z  = state.zoom;

  elCanvas.width  = bw * z;
  elCanvas.height = bh * z;

  // 背景
  ctx.fillStyle = '#13132a';
  ctx.fillRect(0, 0, bw * z, bh * z);

  // 方块
  const bmap = buildCellMap();
  for (let row = 0; row < bh; row++) {
    for (let col = 0; col < bw; col++) {
      const color = bmap[row]?.[col];
      if (color) {
        ctx.fillStyle = color;
        ctx.fillRect(col * z + 1, row * z + 1, z - 2, z - 2);
        // 高光
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(col * z + 1, row * z + 1, z - 2, 3);
        ctx.fillRect(col * z + 1, row * z + 1, 3, z - 2);
      }
    }
  }

  // 网格线
  ctx.strokeStyle = '#1c1c38';
  ctx.lineWidth = 0.5;
  for (let c = 0; c <= bw; c++) {
    ctx.beginPath();
    ctx.moveTo(c * z, 0);
    ctx.lineTo(c * z, bh * z);
    ctx.stroke();
  }
  for (let r = 0; r <= bh; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * z);
    ctx.lineTo(bw * z, r * z);
    ctx.stroke();
  }

  // 边框
  ctx.strokeStyle = '#3a3a62';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(0, 0, bw * z, bh * z);
}

// 构建 row→col→color 快速查找表
function buildCellMap() {
  if (!state.data) return {};
  const bw = state.data.boardWidth, bh = state.data.boardHeight;
  const map = {};
  for (const e of state.data.entities) {
    if (e.type !== 'PixelBlock') continue;
    const c = colorUpper(e.color);
    for (const cell of e.cells) {
      const row = (bh - 1) - cell.y;
      if (cell.x >= 0 && cell.x < bw && row >= 0 && row < bh) {
        if (!map[row]) map[row] = {};
        map[row][cell.x] = c;
      }
    }
  }
  return map;
}

// ── 画笔 ──────────────────────────────────────────────────────────────────────

function canvasColRow(e) {
  const rect = elCanvas.getBoundingClientRect();
  const scaleX = elCanvas.width  / rect.width;
  const scaleY = elCanvas.height / rect.height;
  const col = Math.floor((e.clientX - rect.left) * scaleX / state.zoom);
  const row = Math.floor((e.clientY - rect.top)  * scaleY / state.zoom);
  return { col, row };
}

function paintCell(col, row) {
  if (!state.data) return;
  const bw = state.data.boardWidth, bh = state.data.boardHeight;
  if (col < 0 || col >= bw || row < 0 || row >= bh) return;

  const cellY = (bh - 1) - row;

  if (state.paintMode === 'erase') {
    // 从所有实体中删除该坐标
    for (const e of state.data.entities) {
      if (e.type !== 'PixelBlock') continue;
      const idx = e.cells.findIndex(c => c.x === col && c.y === cellY);
      if (idx !== -1) e.cells.splice(idx, 1);
    }
  } else if (state.brushColor) {
    // 先擦掉该位置其他颜色
    for (const e of state.data.entities) {
      if (e.type !== 'PixelBlock') continue;
      const idx = e.cells.findIndex(c => c.x === col && c.y === cellY);
      if (idx !== -1) e.cells.splice(idx, 1);
    }
    // 写入目标颜色实体
    let entity = state.data.entities.find(
      e => e.type === 'PixelBlock' && colorUpper(e.color) === state.brushColor
    );
    if (!entity) {
      entity = { type: 'PixelBlock', color: state.brushColor, cells: [], pixelCount: 0, colorRanges: [] };
      state.data.entities.push(entity);
    }
    // 检查是否已存在
    if (!entity.cells.find(c => c.x === col && c.y === cellY)) {
      entity.cells.push({ x: col, y: cellY });
    }
  }

  renderCanvas();
  renderColorRows();
  updateInfo(col, row);
}

function updateInfo(col, row) {
  if (!state.data) return;
  const bh = state.data.boardHeight;
  const cellY = (bh - 1) - row;
  elTbInfo.textContent = `col=${col} row=${row}  →  x=${col} y=${cellY}`;
}

// ── 画笔调色板 ────────────────────────────────────────────────────────────────

function renderBrushPalette() {
  if (!state.data) return;
  elBrushColors.innerHTML = '';
  const colors = allColors(state.data);

  // 橡皮
  const eraser = document.createElement('div');
  eraser.className = 'brush-swatch eraser' + (state.brushColor === null ? ' active' : '');
  eraser.title = '橡皮';
  eraser.textContent = '✕';
  eraser.addEventListener('click', () => { state.brushColor = null; renderBrushPalette(); });
  elBrushColors.appendChild(eraser);

  for (const c of colors) {
    const sw = document.createElement('div');
    sw.className = 'brush-swatch' + (state.brushColor === c ? ' active' : '');
    sw.style.background = c;
    sw.title = c;
    sw.addEventListener('click', () => { state.brushColor = c; renderBrushPalette(); });
    elBrushColors.appendChild(sw);
  }
}

// ── 颜色/炮车面板 ─────────────────────────────────────────────────────────────

function renderColorRows() {
  if (!state.data) return;
  const blocks = countBlocks(state.data);
  const ammo   = countAmmo(state.data);
  const colors = allColors(state.data);
  const numLanes = state.data.numberOfLanes || 2;

  elColorRows.innerHTML = '';

  for (const c of colors) {
    const b = blocks[c] || 0;
    const a = ammo[c]   || 0;
    const ok = b === a && b % 10 === 0;
    const warn = b !== a || b % 10 !== 0;

    const row = document.createElement('div');
    row.className = 'color-row' + (ok ? ' ok' : (warn ? ' error' : ''));

    const head = document.createElement('div');
    head.className = 'color-row-head';

    const dot = document.createElement('div');
    dot.className = 'color-dot';
    dot.style.background = c;

    const hex = document.createElement('span');
    hex.className = 'color-hex';
    hex.textContent = c;

    const stat = document.createElement('span');
    stat.className = 'color-stat' + (ok ? ' ok' : ' warn');
    stat.textContent = `块${b} 弹${a}`;
    stat.title = ok ? '对齐' : (b !== a ? '数量不对齐' : '不是10的倍数');

    const del = document.createElement('button');
    del.className = 'del-color-btn';
    del.title = '删除此颜色所有方块和炮车';
    del.textContent = '✕';
    del.addEventListener('click', () => deleteColor(c));

    head.append(dot, hex, stat, del);
    row.appendChild(head);

    // 炮车配置
    const tanks = state.data.initialTanks.filter(t => colorUpper(t.color) === c);
    const tankConfig = document.createElement('div');
    tankConfig.className = 'tank-config';

    const tankLabel = document.createElement('label');
    tankLabel.textContent = '炮车（lane / ammo）';
    tankConfig.appendChild(tankLabel);

    for (let ti = 0; ti < tanks.length; ti++) {
      const t = tanks[ti];
      const trow = document.createElement('div');
      trow.className = 'tank-row';

      const laneEl = document.createElement('select');
      for (let li = 0; li < numLanes; li++) {
        const opt = document.createElement('option');
        opt.value = li;
        opt.textContent = `Lane ${li}`;
        if (t.lane === li) opt.selected = true;
        laneEl.appendChild(opt);
      }
      laneEl.addEventListener('change', () => {
        t.lane = parseInt(laneEl.value);
        reorderTankPositions();
      });

      const ammoEl = document.createElement('input');
      ammoEl.type = 'number';
      ammoEl.min  = 10;
      ammoEl.step = 10;
      ammoEl.value = t.ammo;
      ammoEl.addEventListener('change', () => {
        t.ammo = Math.max(10, Math.round(parseInt(ammoEl.value) / 10) * 10 || 10);
        ammoEl.value = t.ammo;
        renderColorRows();
      });

      const delT = document.createElement('button');
      delT.className = 'del-tank-btn';
      delT.textContent = '−';
      delT.title = '删除此炮车';
      delT.addEventListener('click', () => {
        const idx = state.data.initialTanks.indexOf(t);
        if (idx !== -1) state.data.initialTanks.splice(idx, 1);
        reorderTankPositions();
        renderColorRows();
      });

      trow.append(laneEl, ammoEl, delT);
      tankConfig.appendChild(trow);
    }

    // 添加炮车按钮
    const addBtn = document.createElement('button');
    addBtn.className = 'add-tank-btn';
    addBtn.textContent = '+ 添加炮车';
    addBtn.addEventListener('click', () => {
      const maxPos = Math.max(-1, ...state.data.initialTanks
        .filter(t => colorUpper(t.color) === c)
        .map(t => t.position));
      state.data.initialTanks.push(tankTemplate(c, 10, 0, maxPos + 1));
      reorderTankPositions();
      renderColorRows();
    });
    tankConfig.appendChild(addBtn);

    row.appendChild(tankConfig);
    elColorRows.appendChild(row);
  }
}

// 重新分配 position（按 lane 分组，各自从0递增）
function reorderTankPositions() {
  const byLane = {};
  for (const t of state.data.initialTanks) {
    if (!byLane[t.lane]) byLane[t.lane] = [];
    byLane[t.lane].push(t);
  }
  for (const lane of Object.values(byLane)) {
    lane.sort((a, b) => a.position - b.position);
    lane.forEach((t, i) => { t.position = i; });
  }
}

// ── 颜色管理 ──────────────────────────────────────────────────────────────────

function addColor(hex) {
  const c = colorUpper(hex);
  const exists = allColors(state.data).includes(c);
  if (!exists) {
    // 添加空实体占位
    state.data.entities.push({ type: 'PixelBlock', color: c, cells: [], pixelCount: 0, colorRanges: [] });
  }
  state.brushColor = c;
  renderBrushPalette();
  renderColorRows();
}

function deleteColor(c) {
  // 删方块
  state.data.entities = state.data.entities.filter(
    e => !(e.type === 'PixelBlock' && colorUpper(e.color) === c)
  );
  // 删炮车
  state.data.initialTanks = state.data.initialTanks.filter(
    t => colorUpper(t.color) !== c
  );
  if (state.brushColor === c) state.brushColor = null;
  renderBrushPalette();
  renderColorRows();
  renderCanvas();
}

// ── 自动对齐（normalize） ─────────────────────────────────────────────────────

function normalize() {
  if (!state.data) return;
  const blocks = countBlocks(state.data);
  const ammo   = countAmmo(state.data);
  const colors = new Set([...Object.keys(blocks), ...Object.keys(ammo)]);

  for (const c of colors) {
    const b = blocks[c] || 0;
    const a = ammo[c]   || 0;

    // blocks=0 且 ammo>0 → 删炮车
    if (b === 0 && a > 0) {
      state.data.initialTanks = state.data.initialTanks.filter(
        t => colorUpper(t.color) !== c
      );
      continue;
    }

    // 目标：floor10(b)，最低 10
    const target = b % 10 === 0 ? b : floor10(b) || 10;

    // 删多余方块（从末尾删）
    if (b > target) {
      const toRemove = b - target;
      let removed = 0;
      outer: for (const e of state.data.entities) {
        if (e.type !== 'PixelBlock' || colorUpper(e.color) !== c) continue;
        while (e.cells.length > 0 && removed < toRemove) {
          e.cells.pop();
          removed++;
        }
        if (removed >= toRemove) break outer;
      }
    }

    // ammo=0 且 blocks>0 → 加炮车
    if (a === 0 && target > 0) {
      const numLanes = state.data.numberOfLanes || 2;
      const maxPos = Math.max(-1, ...state.data.initialTanks.map(t => t.position));
      state.data.initialTanks.push(tankTemplate(c, target, 0, maxPos + 1));
      reorderTankPositions();
      continue;
    }

    // 调整现有炮车弹药均匀分配
    const tanks = state.data.initialTanks.filter(t => colorUpper(t.color) === c);
    if (!tanks.length) continue;
    const n    = tanks.length;
    const base = Math.max(10, Math.floor(target / n / 10) * 10);
    const last = Math.max(10, target - base * (n - 1));
    tanks.forEach((t, i) => { t.ammo = i === n - 1 ? last : base; });
  }

  // 清理空实体
  state.data.entities = state.data.entities.filter(
    e => e.type !== 'PixelBlock' || e.cells.length > 0
  );

  renderColorRows();
  renderBrushPalette();
  renderCanvas();
  showSaveMsg('已对齐', 'ok');
}

// ── 保存 ──────────────────────────────────────────────────────────────────────

async function saveLevel() {
  if (!state.data || !state.currentFile) return;

  // 更新 boardSize 为 max(w, h) 保持兼容
  state.data.boardSize = Math.max(state.data.boardWidth, state.data.boardHeight);

  // 校验
  const blocks = countBlocks(state.data);
  const ammo   = countAmmo(state.data);
  const colors = new Set([...Object.keys(blocks), ...Object.keys(ammo)]);
  const errors = [];
  for (const c of colors) {
    const b = blocks[c] || 0, a = ammo[c] || 0;
    if (b !== a) errors.push(`${c}: 块${b}≠弹${a}`);
    else if (b % 10 !== 0) errors.push(`${c}: ${b}不是10的倍数`);
  }
  if (errors.length) {
    showSaveMsg('校验失败：' + errors.slice(0, 2).join(' | '), 'err');
    return;
  }

  try {
    const res = await fetch('/api/save-level', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: state.currentFile, data: state.data }),
    });
    const json = await res.json();
    if (json.ok) showSaveMsg('已保存 ✓', 'ok');
    else         showSaveMsg('保存失败：' + json.error, 'err');
  } catch (e) {
    showSaveMsg('保存失败（需要 Vite dev server）', 'err');
  }
}

function showSaveMsg(msg, type = '') {
  elSaveMsg.textContent = msg;
  elSaveMsg.className = type;
}

function setStatus(msg) {
  elStatusbar.textContent = msg;
}

// ── 网格尺寸变更 ──────────────────────────────────────────────────────────────

function applyGridSize(w, h) {
  if (!state.data) return;
  w = clamp(parseInt(w) || 20, 4, 80);
  h = clamp(parseInt(h) || 20, 4, 80);

  const oldH = state.data.boardHeight;

  // 若 boardHeight 缩小，删掉越界方块
  if (h < oldH) {
    for (const e of state.data.entities) {
      if (e.type !== 'PixelBlock') continue;
      e.cells = e.cells.filter(c => {
        const row = (h - 1) - c.y;
        return c.x >= 0 && c.x < w && row >= 0 && row < h;
      });
    }
  }

  state.data.boardWidth  = w;
  state.data.boardHeight = h;
  elTbWidth.value  = w;
  elTbHeight.value = h;
  elPropW.value    = w;
  elPropH.value    = h;
  renderCanvas();
  renderColorRows();
}

// ── 事件绑定 ──────────────────────────────────────────────────────────────────

// 画布鼠标事件
elCanvas.addEventListener('mousedown', e => {
  if (!state.data) return;
  state.painting = true;
  state.paintMode = e.button === 2 ? 'erase' : (state.brushColor ? 'draw' : 'erase');
  const { col, row } = canvasColRow(e);
  paintCell(col, row);
});
elCanvas.addEventListener('mousemove', e => {
  if (!state.data) return;
  const { col, row } = canvasColRow(e);
  updateInfo(col, row);
  if (state.painting) paintCell(col, row);
});
elCanvas.addEventListener('mouseup', () => { state.painting = false; });
elCanvas.addEventListener('mouseleave', () => { state.painting = false; });
elCanvas.addEventListener('contextmenu', e => e.preventDefault());

// 工具栏缩放
elTbZoom.addEventListener('change', () => {
  state.zoom = clamp(parseInt(elTbZoom.value) || 16, 4, 32);
  elTbZoom.value = state.zoom;
  renderCanvas();
});

// 工具栏宽高
elTbWidth.addEventListener('change',  () => applyGridSize(elTbWidth.value, elTbHeight.value));
elTbHeight.addEventListener('change', () => applyGridSize(elTbWidth.value, elTbHeight.value));

// 属性面板宽高
elPropW.addEventListener('change', () => applyGridSize(elPropW.value, elPropH.value));
elPropH.addEventListener('change', () => applyGridSize(elPropW.value, elPropH.value));

// 队列数变更
elPropLanes.addEventListener('change', () => {
  if (!state.data) return;
  state.data.numberOfLanes = clamp(parseInt(elPropLanes.value) || 2, 1, 8);
  elPropLanes.value = state.data.numberOfLanes;
  renderColorRows();
});

// 添加颜色
elAddColor.addEventListener('click', () => {
  if (!state.data) return;
  addColor(elNewColor.value);
});

// 对齐 + 保存
elBtnNorm.addEventListener('click', normalize);
elBtnSave.addEventListener('click', saveLevel);

// 快捷键
document.addEventListener('keydown', e => {
  if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    saveLevel();
  }
  if (e.key === 'e') { state.brushColor = null; renderBrushPalette(); }
});

// ── 启动 ──────────────────────────────────────────────────────────────────────

loadLevelList();
