// FixelFlow 2 关卡编辑器 — levels2 格式
// 数据格式：
//   colorTable: ["#HEX",...] — 颜色索引表，material ID = 下标
//   QueueGroup: [[{id, ammo, material},...], ...] — 每条队列
//   PixelImageData: {width, height, pixels:[{x,y,material}]}
//   坐标系：y=0 在顶部（与 canvas row 方向一致，无需翻转）

// ── 状态 ──────────────────────────────────────────────────────────────────────

const state = {
  levels:      [],     // 文件名列表 ['level1.json', ...]
  currentFile: null,
  data:        null,   // 当前关卡 JSON（直接操作）
  brushMat:    0,      // 当前画笔 material ID，-1 = 橡皮
  zoom:        12,
  painting:    false,
  paintMode:   null,   // 'draw' | 'erase'
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

const clamp    = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const ceil10   = n => Math.ceil(n / 10) * 10 || 10;
const floor10  = n => Math.floor(n / 10) * 10;
const hexUpper = c  => c.toUpperCase();
function isValidHex(hex) { return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex); }

// material ID → hex 颜色
function matColor(mat) {
  return hexUpper(state.data?.colorTable?.[mat] ?? '#FFFFFF');
}

// 构建 row→col→materialID 快速查找表
function buildCellMap() {
  if (!state.data) return {};
  const map = {};
  for (const p of state.data.PixelImageData?.pixels ?? []) {
    if (!map[p.y]) map[p.y] = {};
    map[p.y][p.x] = p.material;
  }
  return map;
}

// 统计各 material 像素数
function countPixels() {
  const cnt = {};
  for (const p of state.data?.PixelImageData?.pixels ?? []) {
    cnt[p.material] = (cnt[p.material] || 0) + 1;
  }
  return cnt;
}

// 统计各 material 弹药数
function countAmmo() {
  const cnt = {};
  for (const lane of state.data?.QueueGroup ?? []) {
    for (const t of lane) {
      cnt[t.material] = (cnt[t.material] || 0) + t.ammo;
    }
  }
  return cnt;
}

// 所有出现的 material ID（像素 + 炮车）
function allMaterials() {
  const s = new Set();
  for (const p of state.data?.PixelImageData?.pixels ?? []) s.add(p.material);
  for (const lane of state.data?.QueueGroup ?? [])
    for (const t of lane) s.add(t.material);
  return [...s].sort((a, b) => a - b);
}

// ── 关卡列表 ──────────────────────────────────────────────────────────────────

async function loadLevelList() {
  try {
    const res = await fetch('/api/level-list-a2');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.levels = await res.json();
  } catch (e) {
    setStatus(`关卡列表加载失败：${e.message}`);
    return;
  }
  elLevelList.innerHTML = '';
  for (const fname of state.levels) {
    const num = fname.replace('level', '').replace('.json', '');
    const div = document.createElement('div');
    div.className   = 'level-item';
    div.textContent = `Level ${num}`;
    div.dataset.file = fname;
    div.addEventListener('click', () => openLevel(fname));
    elLevelList.appendChild(div);
  }
}

// ── 关卡加载 ──────────────────────────────────────────────────────────────────

async function openLevel(fname) {
  try {
    const res = await fetch(`/levels_a2/${fname}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
  } catch (e) {
    setStatus(`关卡加载失败：${e.message}`);
    return;
  }
  state.currentFile = fname;

  // 确保必要字段存在（向前兼容）
  if (!state.data.colorTable)      state.data.colorTable      = [];
  if (!state.data.QueueGroup)      state.data.QueueGroup      = [];
  if (!state.data.PixelImageData)  state.data.PixelImageData  = { width: 20, height: 20, pixels: [] };
  if (!state.data.boardWidth)      state.data.boardWidth      = state.data.PixelImageData.width;
  if (!state.data.boardHeight)     state.data.boardHeight     = state.data.PixelImageData.height;

  // 同步 PixelImageData 尺寸
  state.data.PixelImageData.width  = state.data.boardWidth;
  state.data.PixelImageData.height = state.data.boardHeight;

  // 若 QueueGroup 条数与 prop-lanes 不符，以 QueueGroup.length 为准
  const numLanes = state.data.QueueGroup.length || 2;
  elPropLanes.value = numLanes;

  // 高亮列表
  document.querySelectorAll('.level-item').forEach(el =>
    el.classList.toggle('active', el.dataset.file === fname)
  );

  // 同步工具栏
  elTbWidth.value  = state.data.boardWidth;
  elTbHeight.value = state.data.boardHeight;
  elPropW.value    = state.data.boardWidth;
  elPropH.value    = state.data.boardHeight;

  // 确保画笔有效
  const mats = allMaterials();
  if (!mats.includes(state.brushMat) && mats.length > 0) {
    state.brushMat = mats[0];
  }

  renderBrushPalette();
  renderColorRows();
  renderCanvas();
  setStatus(`已加载 ${fname}（${state.data.boardWidth}×${state.data.boardHeight}，${state.data.colorTable.length} 色）`);
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

  ctx.fillStyle = '#13132a';
  ctx.fillRect(0, 0, bw * z, bh * z);

  const cmap = buildCellMap();
  for (let row = 0; row < bh; row++) {
    for (let col = 0; col < bw; col++) {
      const mat = cmap[row]?.[col];
      if (mat === undefined || mat === null) continue;
      const color = matColor(mat);
      ctx.fillStyle = color;
      ctx.fillRect(col * z + 1, row * z + 1, z - 2, z - 2);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(col * z + 1, row * z + 1, z - 2, 3);
      ctx.fillRect(col * z + 1, row * z + 1, 3, z - 2);
    }
  }

  ctx.strokeStyle = '#1c1c38';
  ctx.lineWidth   = 0.5;
  for (let c = 0; c <= bw; c++) {
    ctx.beginPath(); ctx.moveTo(c * z, 0); ctx.lineTo(c * z, bh * z); ctx.stroke();
  }
  for (let r = 0; r <= bh; r++) {
    ctx.beginPath(); ctx.moveTo(0, r * z); ctx.lineTo(bw * z, r * z); ctx.stroke();
  }

  ctx.strokeStyle = '#3a3a62';
  ctx.lineWidth   = 1.5;
  ctx.strokeRect(0, 0, bw * z, bh * z);
}

// ── 画笔 ──────────────────────────────────────────────────────────────────────

function canvasColRow(e) {
  const rect   = elCanvas.getBoundingClientRect();
  const scaleX = elCanvas.width  / rect.width;
  const scaleY = elCanvas.height / rect.height;
  return {
    col: Math.floor((e.clientX - rect.left) * scaleX / state.zoom),
    row: Math.floor((e.clientY - rect.top)  * scaleY / state.zoom),
  };
}

function paintCell(col, row) {
  if (!state.data) return;
  const bw = state.data.boardWidth, bh = state.data.boardHeight;
  if (col < 0 || col >= bw || row < 0 || row >= bh) return;

  const pixels = state.data.PixelImageData.pixels;

  if (state.paintMode === 'erase' || state.brushMat === -1) {
    const idx = pixels.findIndex(p => p.x === col && p.y === row);
    if (idx !== -1) pixels.splice(idx, 1);
  } else {
    // 先删除该位置已有像素
    const idx = pixels.findIndex(p => p.x === col && p.y === row);
    if (idx !== -1) pixels.splice(idx, 1);
    pixels.push({ x: col, y: row, material: state.brushMat });
  }

  renderCanvas();
  renderColorRows();
  updateInfo(col, row);
}

function updateInfo(col, row) {
  if (!state.data) return;
  elTbInfo.textContent = `col=${col}  row=${row}`;
}

// ── 画笔调色板 ────────────────────────────────────────────────────────────────

function renderBrushPalette() {
  if (!state.data) return;
  elBrushColors.innerHTML = '';
  const mats = allMaterials();

  // 橡皮
  const eraser = document.createElement('div');
  eraser.className   = 'brush-swatch eraser' + (state.brushMat === -1 ? ' active' : '');
  eraser.title       = '橡皮（E）';
  eraser.textContent = '✕';
  eraser.addEventListener('click', () => { state.brushMat = -1; renderBrushPalette(); });
  elBrushColors.appendChild(eraser);

  for (const mat of state.data.colorTable.map((_, i) => i)) {
    const sw = document.createElement('div');
    sw.className   = 'brush-swatch' + (state.brushMat === mat ? ' active' : '');
    sw.style.background = matColor(mat);
    sw.title       = `mat ${mat}: ${matColor(mat)}`;
    sw.addEventListener('click', () => { state.brushMat = mat; renderBrushPalette(); });
    elBrushColors.appendChild(sw);
  }
}

// ── 颜色/炮车面板 ─────────────────────────────────────────────────────────────

function renderColorRows() {
  if (!state.data) return;
  const pxCnt   = countPixels();
  const ammoCnt = countAmmo();
  const numLanes = state.data.QueueGroup.length;

  elColorRows.innerHTML = '';

  for (let mat = 0; mat < state.data.colorTable.length; mat++) {
    const hex  = matColor(mat);
    const b    = pxCnt[mat]   || 0;
    const a    = ammoCnt[mat] || 0;
    const ok   = b === a && b > 0;

    const row = document.createElement('div');
    row.className = 'color-row' + (ok ? ' ok' : ' error');

    const head = document.createElement('div');
    head.className = 'color-row-head';

    const dot = document.createElement('div');
    dot.className  = 'color-dot';
    dot.style.background = hex;

    const hexLabel = document.createElement('span');
    hexLabel.className   = 'color-hex';
    hexLabel.textContent = `#${mat} ${hex}`;

    const stat = document.createElement('span');
    stat.className   = 'color-stat' + (ok ? ' ok' : ' warn');
    stat.textContent = `块${b} 弹${a}`;
    stat.title = ok ? '对齐' : '数量不一致';

    const del = document.createElement('button');
    del.className   = 'del-color-btn';
    del.title       = '删除此颜色的所有像素和炮车';
    del.textContent = '✕';
    del.addEventListener('click', () => deleteColor(mat));

    head.append(dot, hexLabel, stat, del);
    row.appendChild(head);

    // 炮车配置（来自 QueueGroup 中所有队列）
    const tankConfig = document.createElement('div');
    tankConfig.className = 'tank-config';
    tankConfig.appendChild(Object.assign(document.createElement('label'), { textContent: '炮车（队列 / ammo）' }));

    for (let li = 0; li < numLanes; li++) {
      const lane = state.data.QueueGroup[li];
      for (let ti = 0; ti < lane.length; ti++) {
        const t = lane[ti];
        if (t.material !== mat) continue;

        const trow = document.createElement('div');
        trow.className = 'tank-row';

        const laneEl = document.createElement('select');
        for (let j = 0; j < numLanes; j++) {
          const opt = document.createElement('option');
          opt.value = j;
          opt.textContent = `Lane ${j}`;
          if (j === li) opt.selected = true;
          laneEl.appendChild(opt);
        }
        laneEl.addEventListener('change', () => {
          const newLane = parseInt(laneEl.value);
          state.data.QueueGroup[li].splice(ti, 1);
          state.data.QueueGroup[newLane].push(t);
          renderColorRows();
        });

        const ammoEl = document.createElement('input');
        ammoEl.type  = 'number';
        ammoEl.min   = 10;
        ammoEl.step  = 10;
        ammoEl.value = t.ammo;
        ammoEl.addEventListener('change', () => {
          t.ammo = Math.max(10, Math.round(parseInt(ammoEl.value) / 10) * 10 || 10);
          ammoEl.value = t.ammo;
          renderColorRows();
        });

        const delT = document.createElement('button');
        delT.className   = 'del-tank-btn';
        delT.textContent = '−';
        delT.title       = '删除此炮车';
        delT.addEventListener('click', () => {
          state.data.QueueGroup[li].splice(ti, 1);
          renderColorRows();
        });

        trow.append(laneEl, ammoEl, delT);
        tankConfig.appendChild(trow);
      }
    }

    // 添加炮车按钮
    const addBtn = document.createElement('button');
    addBtn.className   = 'add-tank-btn';
    addBtn.textContent = '+ 添加炮车';
    addBtn.addEventListener('click', () => {
      // 默认加入第一条队列
      const newId = Math.max(0, ...state.data.QueueGroup.flat().map(t => t.id)) + 1;
      state.data.QueueGroup[0].push({ id: newId, ammo: 10, material: mat });
      renderColorRows();
    });
    tankConfig.appendChild(addBtn);

    row.appendChild(tankConfig);
    elColorRows.appendChild(row);
  }
}

// ── 颜色管理 ──────────────────────────────────────────────────────────────────

function addColor(hex) {
  if (!isValidHex(hex)) {
    showSaveMsg('颜色格式无效（需要 #RGB 或 #RRGGBB）', 'err');
    return;
  }
  const c = hexUpper(hex);
  // 若颜色已存在则只切换画笔
  const existing = state.data.colorTable.findIndex(e => hexUpper(e) === c);
  if (existing !== -1) {
    state.brushMat = existing;
  } else {
    const newMat = state.data.colorTable.length;
    state.data.colorTable.push(c);
    state.brushMat = newMat;
  }
  renderBrushPalette();
  renderColorRows();
}

function deleteColor(mat) {
  // 删除该 material 的所有像素
  state.data.PixelImageData.pixels = state.data.PixelImageData.pixels.filter(
    p => p.material !== mat
  );
  // 删除该 material 的所有炮车
  for (const lane of state.data.QueueGroup) {
    for (let i = lane.length - 1; i >= 0; i--) {
      if (lane[i].material === mat) lane.splice(i, 1);
    }
  }
  // 删除 colorTable 中的颜色，后续 material ID 下移
  state.data.colorTable.splice(mat, 1);
  // 修复所有 material ID > mat 的引用（下移1位）
  for (const p of state.data.PixelImageData.pixels) {
    if (p.material > mat) p.material--;
  }
  for (const lane of state.data.QueueGroup) {
    for (const t of lane) {
      if (t.material > mat) t.material--;
    }
  }
  if (state.brushMat >= state.data.colorTable.length) {
    state.brushMat = state.data.colorTable.length - 1;
  }
  renderBrushPalette();
  renderColorRows();
  renderCanvas();
}

// ── 自动对齐（normalize）─────────────────────────────────────────────────────

function normalize() {
  if (!state.data) return;
  const pxCnt   = countPixels();
  const ammoCnt = countAmmo();
  const mats    = new Set([...Object.keys(pxCnt).map(Number), ...Object.keys(ammoCnt).map(Number)]);

  for (const mat of mats) {
    const b = pxCnt[mat]   || 0;
    const a = ammoCnt[mat] || 0;

    if (b === 0) {
      // 无像素 → 删所有该颜色炮车
      for (const lane of state.data.QueueGroup) {
        for (let i = lane.length - 1; i >= 0; i--) {
          if (lane[i].material === mat) lane.splice(i, 1);
        }
      }
      continue;
    }

    const target = b % 10 === 0 ? b : (floor10(b) || 10);

    // 像素多余 → 从末尾删
    if (b > target) {
      let toRemove = b - target;
      const pxArr = state.data.PixelImageData.pixels;
      for (let i = pxArr.length - 1; i >= 0 && toRemove > 0; i--) {
        if (pxArr[i].material === mat) { pxArr.splice(i, 1); toRemove--; }
      }
    }

    // 无炮车 → 新建一辆
    const allTanks = state.data.QueueGroup.flatMap((lane, li) =>
      lane.map((t, ti) => ({ t, li, ti }))
    ).filter(({ t }) => t.material === mat);

    if (allTanks.length === 0) {
      const newId = Math.max(0, ...state.data.QueueGroup.flat().map(t => t.id)) + 1;
      state.data.QueueGroup[0].push({ id: newId, ammo: target, material: mat });
      continue;
    }

    // 均匀分配弹药
    const n    = allTanks.length;
    let base   = Math.max(10, Math.floor(target / n / 10) * 10);
    while (n > 1 && base * (n - 1) > target - 10) base -= 10;
    if (base < 10) base = 10;
    const last = Math.max(10, target - base * (n - 1));
    allTanks.forEach(({ t }, i) => { t.ammo = (i === n - 1) ? last : base; });
  }

  renderColorRows();
  renderBrushPalette();
  renderCanvas();
  showSaveMsg('已对齐', 'ok');
}

// ── 保存 ──────────────────────────────────────────────────────────────────────

async function saveLevel() {
  if (!state.data || !state.currentFile) return;

  const pxCnt   = countPixels();
  const ammoCnt = countAmmo();
  const mats    = new Set([...Object.keys(pxCnt).map(Number), ...Object.keys(ammoCnt).map(Number)]);
  const errors  = [];
  for (const mat of mats) {
    const b = pxCnt[mat] || 0, a = ammoCnt[mat] || 0;
    if (b !== a) errors.push(`mat${mat}(${matColor(mat)}): 块${b}≠弹${a}`);
  }
  if (errors.length) {
    showSaveMsg('校验失败：' + errors.slice(0, 2).join(' | '), 'err');
    return;
  }

  // 同步 PixelImageData 尺寸字段
  state.data.PixelImageData.width  = state.data.boardWidth;
  state.data.PixelImageData.height = state.data.boardHeight;

  try {
    const res = await fetch('/api/save-level-a2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: state.currentFile, data: state.data }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.ok) showSaveMsg('已保存', 'ok');
    else         showSaveMsg('保存失败：' + json.error, 'err');
  } catch (e) {
    showSaveMsg(`保存失败：${e.message}`, 'err');
  }
}

function showSaveMsg(msg, type = '') {
  elSaveMsg.textContent = msg;
  elSaveMsg.className   = type;
}

function setStatus(msg) {
  elStatusbar.textContent = msg;
}

// ── 网格尺寸变更 ──────────────────────────────────────────────────────────────

function applyGridSize(w, h) {
  if (!state.data) return;
  w = clamp(parseInt(w) || 20, 4, 80);
  h = clamp(parseInt(h) || 20, 4, 80);

  // 裁剪越界像素
  state.data.PixelImageData.pixels = state.data.PixelImageData.pixels.filter(
    p => p.x >= 0 && p.x < w && p.y >= 0 && p.y < h
  );

  state.data.boardWidth             = w;
  state.data.boardHeight            = h;
  state.data.PixelImageData.width  = w;
  state.data.PixelImageData.height = h;
  elTbWidth.value  = w;
  elTbHeight.value = h;
  elPropW.value    = w;
  elPropH.value    = h;
  renderCanvas();
  renderColorRows();
}

// ── 队列数量变更 ──────────────────────────────────────────────────────────────

function applyLaneCount(n) {
  if (!state.data) return;
  n = clamp(parseInt(n) || 2, 1, 8);
  const cur = state.data.QueueGroup.length;
  if (n > cur) {
    for (let i = cur; i < n; i++) state.data.QueueGroup.push([]);
  } else if (n < cur) {
    // 多余队列中的炮车移入最后一条有效队列
    const last = n - 1;
    for (let i = n; i < cur; i++) {
      state.data.QueueGroup[last].push(...state.data.QueueGroup[i]);
    }
    state.data.QueueGroup.length = n;
  }
  elPropLanes.value = n;
  renderColorRows();
}

// ── 事件绑定 ──────────────────────────────────────────────────────────────────

elCanvas.addEventListener('mousedown', e => {
  if (!state.data) return;
  state.painting  = true;
  state.paintMode = e.button === 2 ? 'erase' : (state.brushMat === -1 ? 'erase' : 'draw');
  const { col, row } = canvasColRow(e);
  paintCell(col, row);
});
elCanvas.addEventListener('mousemove', e => {
  if (!state.data) return;
  const { col, row } = canvasColRow(e);
  updateInfo(col, row);
  if (state.painting) paintCell(col, row);
});
elCanvas.addEventListener('mouseup',    () => { state.painting = false; });
elCanvas.addEventListener('mouseleave', () => { state.painting = false; });
elCanvas.addEventListener('contextmenu', e => e.preventDefault());

elTbZoom.addEventListener('change', () => {
  state.zoom     = clamp(parseInt(elTbZoom.value) || 12, 4, 32);
  elTbZoom.value = state.zoom;
  renderCanvas();
});

elTbWidth.addEventListener('change',  () => applyGridSize(elTbWidth.value,  elTbHeight.value));
elTbHeight.addEventListener('change', () => applyGridSize(elTbWidth.value,  elTbHeight.value));
elPropW.addEventListener('change',    () => applyGridSize(elPropW.value,     elPropH.value));
elPropH.addEventListener('change',    () => applyGridSize(elPropW.value,     elPropH.value));

elPropLanes.addEventListener('change', () => applyLaneCount(elPropLanes.value));

elAddColor.addEventListener('click', () => {
  if (!state.data) return;
  addColor(elNewColor.value);
});

elBtnNorm.addEventListener('click', normalize);
elBtnSave.addEventListener('click', saveLevel);

document.addEventListener('keydown', e => {
  if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    saveLevel();
  }
  if (e.key === 'e' && !e.ctrlKey && !e.metaKey) {
    state.brushMat = -1;
    renderBrushPalette();
  }
});

// ── 启动 ──────────────────────────────────────────────────────────────────────

loadLevelList();
