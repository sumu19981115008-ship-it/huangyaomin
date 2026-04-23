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
  group:       'c',    // 'a' | 'b' | 'c'（默认 C 组，编辑器创作专用）
};

// ── DOM 引用 ──────────────────────────────────────────────────────────────────

const elLevelList       = document.getElementById('level-list');
const elBtnDeleteMode   = document.getElementById('btn-delete-mode');
const elBtnDeleteConfirm= document.getElementById('btn-delete-confirm');
const elDeleteCount     = document.getElementById('delete-count');
const elDeleteModal     = document.getElementById('delete-modal');
const elDeleteModalMsg  = document.getElementById('delete-modal-msg');
const elBtnModalCancel  = document.getElementById('btn-modal-cancel');
const elBtnModalOk      = document.getElementById('btn-modal-ok');
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
const elBtnSaveAs   = document.getElementById('btn-save-as');
const elBtnNorm     = document.getElementById('btn-normalize');
const elSaveMsg     = document.getElementById('save-msg');
const elBtnGroupA   = document.getElementById('btn-group-a');
const elBtnGroupB   = document.getElementById('btn-group-b');
const elBtnGroupC   = document.getElementById('btn-group-c');
const elBtnPreview  = document.getElementById('btn-preview');
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

function apiListUrl()  {
  if (state.group === 'b') return '/api/level-list-b2';
  if (state.group === 'c') return '/api/level-list-c2';
  return '/api/level-list-a2';
}
function apiSaveUrl()  {
  if (state.group === 'b') return '/api/save-level-b2';
  if (state.group === 'c') return '/api/save-level-c2';
  return '/api/save-level-a2';
}
function levelDirUrl() {
  if (state.group === 'b') return '/levels_b2';
  if (state.group === 'c') return '/levels_c2';
  return '/levels_a2';
}

async function loadLevelList() {
  try {
    const res = await fetch(apiListUrl());
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
    div.className    = 'level-item';
    div.dataset.file = fname;

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.addEventListener('click', e => {
      e.stopPropagation();
      div.classList.toggle('selected', chk.checked);
      updateDeleteCount();
    });

    const label = document.createElement('span');
    label.textContent = `Level ${num}`;

    div.appendChild(chk);
    div.appendChild(label);
    div.addEventListener('click', () => {
      if (deleteSelectMode) {
        chk.checked = !chk.checked;
        div.classList.toggle('selected', chk.checked);
        updateDeleteCount();
      } else {
        openLevel(fname);
      }
    });
    elLevelList.appendChild(div);
  }
}

// ── 关卡加载 ──────────────────────────────────────────────────────────────────

async function openLevel(fname) {
  try {
    const res = await fetch(`${levelDirUrl()}/${fname}`);
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
    const ok   = a === ceil10(b) && b > 0;

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
    stat.title = ok ? '对齐' : `弹药应为 ${ceil10(b)}`;

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
// 规则：画布像素永远不动，只调整炮车弹药总量 = ceil10(像素数)

function normalize() {
  if (!state.data) return;
  const pxCnt = countPixels();

  // 收集所有出现的 material（含有像素的 + 有炮车的）
  const ammoCnt = countAmmo();
  const mats = new Set([...Object.keys(pxCnt).map(Number), ...Object.keys(ammoCnt).map(Number)]);

  for (const mat of mats) {
    const b = pxCnt[mat] || 0;

    // 无像素 → 删所有该颜色炮车
    if (b === 0) {
      for (const lane of state.data.QueueGroup) {
        for (let i = lane.length - 1; i >= 0; i--) {
          if (lane[i].material === mat) lane.splice(i, 1);
        }
      }
      continue;
    }

    const target = ceil10(b); // 与生成器保持一致，向上取整

    // 收集该颜色所有炮车（保持原有顺序，不改队列归属）
    const allTanks = [];
    for (const lane of state.data.QueueGroup) {
      for (const t of lane) {
        if (t.material === mat) allTanks.push(t);
      }
    }

    // 无炮车 → 按标准包新建（优先 20 发中包，上限 5 辆）
    if (allTanks.length === 0) {
      const newTanks = makeAmmoList(target, 5, 20);
      const newIdBase = Math.max(0, ...state.data.QueueGroup.flat().map(t => t.id)) + 1;
      const laneIdx = 0;
      newTanks.forEach((ammo, i) => {
        state.data.QueueGroup[laneIdx].push({ id: newIdBase + i, ammo, material: mat });
      });
      continue;
    }

    let curTotal = allTanks.reduce((s, t) => s + t.ammo, 0);
    let diff = target - curTotal; // 正 = 需要增加，负 = 需要减少

    if (diff > 0) {
      // 弹药不足：把差值加到最后一辆，若超过 40 则拆出新炮车
      const last = allTanks[allTanks.length - 1];
      last.ammo += diff;
      // 若最后一辆超过 40，把超出部分拆成新炮车追加到同队列末尾
      while (last.ammo > 40) {
        const overflow = last.ammo - 40;
        last.ammo = 40;
        const newId = Math.max(0, ...state.data.QueueGroup.flat().map(t => t.id)) + 1;
        // 找到 last 所在队列
        for (const lane of state.data.QueueGroup) {
          const idx = lane.findIndex(t => t === last);
          if (idx !== -1) {
            const newTank = { id: newId, ammo: overflow, material: mat };
            lane.splice(idx + 1, 0, newTank);
            // 如果 overflow 还超过 40，下次循环会继续处理 newTank
            // 但 allTanks 没有 newTank，跳出后不再管（已满足 target）
            break;
          }
        }
        break; // 一次最多只拆一层，diff 已经消化完
      }
    } else if (diff < 0) {
      // 弹药过多：从最后一辆往前减，减完就删
      let excess = -diff;
      for (let i = allTanks.length - 1; i >= 0 && excess > 0; i--) {
        const t = allTanks[i];
        if (t.ammo <= excess) {
          // 整辆删掉
          excess -= t.ammo;
          for (const lane of state.data.QueueGroup) {
            const idx = lane.indexOf(t);
            if (idx !== -1) { lane.splice(idx, 1); break; }
          }
        } else {
          // 减去部分弹药，对齐到 10 的倍数
          t.ammo -= excess;
          t.ammo  = Math.max(10, Math.round(t.ammo / 10) * 10);
          excess  = 0;
        }
      }
    }
    // diff === 0：已对齐，不做任何操作
  }

  renderColorRows();
  renderBrushPalette();
  // 画布不重绘（像素未变动）
  showSaveMsg('已对齐', 'ok');
}

// 标准弹药包拆分（与 level_generator.py make_ammo_list 逻辑一致）
function makeAmmoList(total, maxTanks, prefPack) {
  const packOrder = { 40: [40, 20, 10], 20: [20, 40, 10], 10: [10, 20, 40] }[prefPack] || [20, 40, 10];
  const tanks = [];
  let remain = total;
  for (const pack of packOrder) {
    while (remain >= pack && tanks.length < maxTanks) {
      tanks.push(pack);
      remain -= pack;
    }
    if (remain === 0) break;
  }
  if (remain > 0) {
    if (tanks.length > 0 && tanks[tanks.length - 1] + remain <= 40) {
      tanks[tanks.length - 1] += remain;
    } else {
      while (remain > 40) { tanks.push(40); remain -= 40; }
      if (remain > 0) tanks.push(remain);
    }
  }
  return tanks;
}

// ── 保存校验（允许弹药 = ceil10(像素)，手绘场景像素不一定是整十）──────────────

function checkSaveErrors() {
  const pxCnt   = countPixels();
  const ammoCnt = countAmmo();
  const mats    = new Set([...Object.keys(pxCnt).map(Number), ...Object.keys(ammoCnt).map(Number)]);
  const errors  = [];
  for (const mat of mats) {
    const b = pxCnt[mat] || 0;
    const a = ammoCnt[mat] || 0;
    const expected = ceil10(b);
    if (a !== expected) errors.push(`mat${mat}(${matColor(mat)}): 块${b} 弹${a}≠${expected}`);
  }
  return errors;
}

// ── 保存 ──────────────────────────────────────────────────────────────────────

async function saveLevel() {
  if (!state.data || !state.currentFile) return;

  const errors = checkSaveErrors();
  if (errors.length) {
    showSaveMsg('校验失败：' + errors.slice(0, 2).join(' | '), 'err');
    return;
  }

  // 同步 PixelImageData 尺寸字段
  state.data.PixelImageData.width  = state.data.boardWidth;
  state.data.PixelImageData.height = state.data.boardHeight;

  try {
    const res = await fetch(apiSaveUrl(), {
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

async function saveAs() {
  if (!state.data) return;
  const input = prompt('另存为文件名（如 level302）：');
  if (!input) return;
  const fname = input.trim().replace(/\.json$/i, '') + '.json';
  if (!/^level\d+\.json$/.test(fname)) {
    showSaveMsg('文件名格式错误（需为 levelN）', 'err');
    return;
  }

  const errors = checkSaveErrors();
  if (errors.length) {
    showSaveMsg('校验失败：' + errors.slice(0, 2).join(' | '), 'err');
    return;
  }

  state.data.PixelImageData.width  = state.data.boardWidth;
  state.data.PixelImageData.height = state.data.boardHeight;

  try {
    const res = await fetch(apiSaveUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: fname, data: state.data }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.ok) {
      state.currentFile = fname;
      showSaveMsg(`已另存为 ${fname}`, 'ok');
      setStatus(`当前文件：${fname}`);
      await loadLevelList();
      document.querySelectorAll('.level-item').forEach(el =>
        el.classList.toggle('active', el.dataset.file === fname)
      );
    } else {
      showSaveMsg('另存失败：' + json.error, 'err');
    }
  } catch (e) {
    showSaveMsg(`另存失败：${e.message}`, 'err');
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

// ── 多选删除 ──────────────────────────────────────────────────────────────────

let deleteSelectMode = false;

function apiDeleteUrl() {
  if (state.group === 'b') return '/api/delete-levels-b2';
  if (state.group === 'c') return '/api/delete-levels-c2';
  return '/api/delete-levels-a2';
}

function updateDeleteCount() {
  const n = document.querySelectorAll('.level-item input[type=checkbox]:checked').length;
  elDeleteCount.style.display   = deleteSelectMode ? 'block' : 'none';
  elDeleteCount.textContent     = `已选 ${n} 个关卡`;
  elBtnDeleteConfirm.style.display = (deleteSelectMode && n > 0) ? 'block' : 'none';
}

function exitDeleteMode() {
  deleteSelectMode = false;
  document.getElementById('panel-levels').classList.remove('select-mode');
  document.querySelectorAll('.level-item').forEach(el => {
    el.classList.remove('selected');
    el.querySelector('input[type=checkbox]').checked = false;
  });
  elBtnDeleteMode.classList.remove('active');
  elBtnDeleteMode.textContent = '多选删除';
  updateDeleteCount();
}

elBtnDeleteMode.addEventListener('click', () => {
  deleteSelectMode = !deleteSelectMode;
  document.getElementById('panel-levels').classList.toggle('select-mode', deleteSelectMode);
  elBtnDeleteMode.classList.toggle('active', deleteSelectMode);
  elBtnDeleteMode.textContent = deleteSelectMode ? '退出多选' : '多选删除';
  if (!deleteSelectMode) exitDeleteMode();
  else updateDeleteCount();
});

elBtnDeleteConfirm.addEventListener('click', () => {
  const selected = [...document.querySelectorAll('.level-item input[type=checkbox]:checked')]
    .map(chk => chk.closest('.level-item').dataset.file);
  if (selected.length === 0) return;
  elDeleteModalMsg.textContent = `确认删除 ${selected.length} 个关卡？此操作不可撤销。`;
  elDeleteModal.classList.add('show');
});

elBtnModalCancel.addEventListener('click', () => {
  elDeleteModal.classList.remove('show');
});

elBtnModalOk.addEventListener('click', async () => {
  elDeleteModal.classList.remove('show');
  const selected = [...document.querySelectorAll('.level-item input[type=checkbox]:checked')]
    .map(chk => chk.closest('.level-item').dataset.file);
  try {
    const res = await fetch(apiDeleteUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filenames: selected }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    // 若当前打开的关卡被删除，清空编辑器
    if (selected.includes(state.currentFile)) {
      state.currentFile = null;
      state.data = null;
      renderCanvas();
      renderBrushPalette();
      renderColorRows();
    }
    exitDeleteMode();
    await loadLevelList();
    setStatus(`已删除 ${selected.length} 个关卡`);
  } catch (e) {
    setStatus(`删除失败：${e.message}`);
  }
});

function switchGroup(g) {
  if (state.group === g) return;
  exitDeleteMode();
  state.group       = g;
  state.currentFile = null;
  state.data        = null;
  elBtnGroupA.classList.toggle('active', g === 'a');
  elBtnGroupB.classList.toggle('active', g === 'b');
  elBtnGroupC.classList.toggle('active', g === 'c');
  renderCanvas();
  renderBrushPalette();
  renderColorRows();
  showSaveMsg('');
  setStatus(`已切换到 ${g.toUpperCase()} 组`);
  loadLevelList();
}

function previewLevel() {
  if (!state.data) { showSaveMsg('请先加载或生成关卡', 'err'); return; }
  sessionStorage.setItem('editorPreview', JSON.stringify(state.data));
  window.open('/', '_blank');
}

elBtnGroupA.addEventListener('click', () => switchGroup('a'));
elBtnGroupB.addEventListener('click', () => switchGroup('b'));
elBtnGroupC.addEventListener('click', () => switchGroup('c'));
elBtnPreview.addEventListener('click', previewLevel);
elBtnNorm.addEventListener('click', normalize);
elBtnSave.addEventListener('click', saveLevel);
elBtnSaveAs.addEventListener('click', saveAs);

// ── 图片生成弹窗 ──────────────────────────────────────────────────────────────

const elBtnGenerate  = document.getElementById('btn-generate');
const elGenModal     = document.getElementById('gen-modal');
const elGenDrop      = document.getElementById('gen-drop');
const elGenFileInput = document.getElementById('gen-file-input');
const elGenPreview   = document.getElementById('gen-preview');
const elGenFilename  = document.getElementById('gen-filename');
const elGenDifficulty    = document.getElementById('gen-difficulty');
const elGenLanes         = document.getElementById('gen-lanes');
const elGenColors        = document.getElementById('gen-colors');
const elGenSlot          = document.getElementById('gen-slot');
const elGenBw            = document.getElementById('gen-bw');
const elGenFixedPalette  = document.getElementById('gen-fixed-palette');
const elGenBh        = document.getElementById('gen-bh');
const elGenLog       = document.getElementById('gen-log');
const elGenSubmit    = document.getElementById('gen-submit');
const elGenCancel    = document.getElementById('gen-cancel');

let genImageBase64 = null;

function openGenModal() {
  // 预填文件名：当前组最大关卡号 + 1
  const nums = state.levels.map(f => parseInt(f.replace(/\D/g, ''))).filter(Boolean);
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  elGenFilename.value = `level${next}`;
  elGenModal.classList.add('open');
}

function closeGenModal() {
  elGenModal.classList.remove('open');
  elGenLog.classList.remove('show');
  elGenLog.textContent = '';
}

function loadGenImage(file) {
  const reader = new FileReader();
  reader.onload = e => {
    genImageBase64 = e.target.result;
    elGenPreview.src = genImageBase64;
    elGenPreview.classList.add('show');
    elGenDrop.classList.add('has-img');
    elGenDrop.textContent = file.name;
    elGenSubmit.disabled = false;
  };
  reader.readAsDataURL(file);
}

elBtnGenerate.addEventListener('click', openGenModal);
elGenCancel.addEventListener('click', closeGenModal);
elGenModal.addEventListener('click', e => { if (e.target === elGenModal) closeGenModal(); });

elGenDrop.addEventListener('click', () => elGenFileInput.click());
elGenFileInput.addEventListener('change', e => { if (e.target.files[0]) loadGenImage(e.target.files[0]); });
elGenDrop.addEventListener('dragover',  e => { e.preventDefault(); elGenDrop.classList.add('dragover'); });
elGenDrop.addEventListener('dragleave', () => elGenDrop.classList.remove('dragover'));
elGenDrop.addEventListener('drop', e => {
  e.preventDefault();
  elGenDrop.classList.remove('dragover');
  if (e.dataTransfer.files[0]) loadGenImage(e.dataTransfer.files[0]);
});

elGenSubmit.addEventListener('click', async () => {
  if (!genImageBase64) return;

  const rawName = elGenFilename.value.trim().replace(/\.json$/i, '');
  const fname   = rawName + '.json';
  if (!/^level\d+\.json$/.test(fname)) {
    elGenLog.textContent = '文件名格式错误（需为 levelN）';
    elGenLog.classList.add('show');
    return;
  }

  elGenSubmit.disabled = true;
  elGenLog.textContent = '生成中，请稍候…';
  elGenLog.classList.add('show');

  try {
    const res = await fetch('/api/generate-level', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        group:       state.group,
        filename:    fname,
        imageBase64: genImageBase64,
        difficulty:    elGenDifficulty.value,
        lanes:         parseInt(elGenLanes.value)  || 3,
        colors:        parseInt(elGenColors.value) || 0,
        boardW:        parseInt(elGenBw.value)      || 20,
        boardH:        parseInt(elGenBh.value)      || 20,
        slot:          parseInt(elGenSlot.value)    || 5,
        fixedPalette:  elGenFixedPalette.checked,
      }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);

    elGenLog.textContent = json.log || '完成';
    // 把生成的数据直接载入编辑器
    state.data        = json.data;
    state.currentFile = fname;
    await loadLevelList();
    document.querySelectorAll('.level-item').forEach(el =>
      el.classList.toggle('active', el.dataset.file === fname)
    );
    const lanes = state.data.QueueGroup?.length || 2;
    elPropLanes.value = lanes;
    elTbWidth.value   = state.data.boardWidth;
    elTbHeight.value  = state.data.boardHeight;
    elPropW.value     = state.data.boardWidth;
    elPropH.value     = state.data.boardHeight;
    renderBrushPalette();
    renderColorRows();
    renderCanvas();
    setStatus(`已生成 ${fname}（${elGenDifficulty.value}，${state.data.colorTable.length} 色）`);
    showSaveMsg('已生成，未保存', 'ok');
    closeGenModal();
  } catch (e) {
    elGenLog.textContent = '错误：' + e.message;
  } finally {
    elGenSubmit.disabled = false;
  }
});

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
