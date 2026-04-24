import { G } from './constants.js';

/**
 * 自动闯关机器人
 *
 * 部署策略：
 *   1. 收集所有当前可部署候选（buffer 全部 + 各队列队首）
 *   2. 按颜色聚合弹药总和，评分 = 1 / (1 + |弹药总和 - 该色方块数|)
 *      → 弹药总和最贴近方块数的颜色得分最高
 *   3. 严格可达性：每行/列只看最外层第一个非空格子，与 _findTarget 逻辑完全一致
 *      → 只有当前真正暴露的颜色才进入候选，未暴露的等其他车打开路径
 *   4. 轨道颜色多样性：同色每多一辆在轨打 0.6 折，避免单色占满轨道
 *   5. 同分时 buffer 优先
 */
export class AutoBot {
  constructor(scene) {
    this.scene       = scene;
    this.enabled     = false;
    this._tickTimer  = null;
    this._commitLane = null;
  }

  // ── 开关 ──────────────────────────────────────────────────────

  toggle() {
    this.enabled = !this.enabled;
    if (this.enabled) this._start();
    else              this._stop();
    return this.enabled;
  }

  enable()  { if (!this.enabled) { this.enabled = true;  this._start(); } }
  disable() { if (this.enabled)  { this.enabled = false; this._stop();  } }

  reset() {
    this._commitLane = null;
    if (this.enabled) { this._stop(); this._start(); }
  }

  // ── 内部驱动 ─────────────────────────────────────────────────

  _start() {
    if (this._tickTimer) return;
    this._tickTimer = this.scene.time.addEvent({
      delay: 120, loop: true, callback: this._tick, callbackScope: this,
    });
  }

  _stop() {
    if (this._tickTimer) { this._tickTimer.remove(); this._tickTimer = null; }
  }

  // ── 每次决策 ─────────────────────────────────────────────────

  _tick() {
    const logic = this.scene.logic;
    if (!logic) return;

    if (logic.state === 'win') {
      this.scene.levelIndex = (this.scene.levelIndex + 1) % this.scene._currentLevels().length;
      this.scene._loadCurrentLevel();
      return;
    }

    if (logic.state !== 'playing') return;
    if (this.scene.items.item2Paused || this.scene.items.item3Active) return;
    if (logic.isTrackFull()) return;

    const SAFE_GAP = 28;
    if (logic.turrets.some(t => !t.lapComplete && t.pathPos < SAFE_GAP)) return;

    const colorCount   = this._countColors();
    const candidates   = this._gatherCandidates(colorCount);
    if (candidates.length === 0) return;

    const reachableSet = this._computeReachable();
    const exposureMap  = this._computeColorExposurePathPos();

    // buffer 危险预判：当前 buffer 数 + 即将跑完一圈的车数 >= bufferCap
    // 即将跑完：pathPos 超过 80% 总路程且有剩余弹药（还会进 buffer）
    const { TOTAL_DIST } = G;
    const soonDone = logic.turrets.filter(
      t => !t.lapComplete && t.ammo > 0 && t.pathPos >= TOTAL_DIST * 0.8
    ).length;
    const bufferDanger = logic.buffer.length + soonDone >= logic.bufferCap - 1;
    if (bufferDanger) {
      const bufCandidates = candidates.filter(c => c.source === 'buffer');
      if (bufCandidates.length > 0) {
        const reachBuf = bufCandidates.filter(c => reachableSet.has(c.color));
        // 危险时首选可达车；若无可达则推弹药最少的车（最快跑完腾槽）
        const pool = reachBuf.length > 0 ? reachBuf : bufCandidates;
        pool.sort((a, b) => a.ammo - b.ammo);
        this._deploy(pool[0]);
        return;
      }
    }

    // 统计所有待部署弹药（全队列 + buffer），用于准确的弹药匹配评分
    const colorAmmo = {};
    for (const lane of logic.lanes)
      for (const t of lane) colorAmmo[t.color] = (colorAmmo[t.color] ?? 0) + t.ammo;
    for (const t of logic.buffer) colorAmmo[t.color] = (colorAmmo[t.color] ?? 0) + t.ammo;

    // 轨道颜色多样性：轨道上已有同色车则评分打折
    const trackColorCount = {};
    for (const t of logic.turrets) trackColorCount[t.color] = (trackColorCount[t.color] || 0) + 1;

    const trackUsed  = logic.turrets.length;
    const trackCap   = logic.trackCap ?? 5;
    const freeSlots  = trackCap - trackUsed;

    const reachPool  = candidates.filter(c => reachableSet.has(c.color));

    // 挖坑承诺：锁定某条队列，持续停车直到队头变为可达色
    if (this._commitLane && freeSlots >= 1) {
      const { laneIdx } = this._commitLane;
      const lane = logic.lanes[laneIdx];
      if (lane && lane.length > 0) {
        const head = lane[0];
        if (!reachableSet.has(head.color) && (colorCount[head.color] ?? 0) > 0
            && !(trackColorCount[head.color] > 0)) {
          this._deploy({ source: 'lane', laneIdx, color: head.color, ammo: head.ammo, _unlock: true });
          return;
        }
      }
      this._commitLane = null;
    }

    const inFallback = reachPool.length === 0;

    // 停车场策略：计算每条阻塞队列的挖掘价值（含 dist/gain/cost 指标）
    const unlockPool = [];
    if (freeSlots > 0) {
      for (let li = 0; li < logic.lanes.length; li++) {
        const lane = logic.lanes[li];
        if (lane.length < 2) continue;
        const head = lane[0];
        if (reachableSet.has(head.color)) continue;
        if ((colorCount[head.color] ?? 0) === 0) continue;
        if ((trackColorCount[head.color] || 0) > 0) continue;
        let cost = 0, gain = 0, dist = Infinity, targetColor = null;
        for (let j = 0; j < Math.min(10, lane.length); j++) {
          const car = lane[j];
          if (reachableSet.has(car.color)) {
            gain += car.ammo;
            if (dist === Infinity) { dist = j; targetColor = car.color; }
          } else {
            if (j > 0) cost += car.ammo;
          }
        }
        if (dist === Infinity) continue;
        unlockPool.push({ source: 'lane', laneIdx: li, color: head.color,
                          ammo: head.ammo, idle: false, _unlock: true,
                          _dist: dist, _targetColor: targetColor, _gain: gain, _cost: cost });
      }
    }

    // 主动挖坑：开局全部inFallback时（轨道为空），阈值低（1.2，别无他选）
    const allEmpty = logic.turrets.length === 0;
    if (inFallback && allEmpty && freeSlots >= 2 && unlockPool.length > 0) {
      const worthwhile = unlockPool.filter(u => u._gain > u._cost * 1.2 && u._dist <= 3);
      if (worthwhile.length > 0) {
        worthwhile.sort((a, b) => (b._gain - b._cost) - (a._gain - a._cost));
        const best = worthwhile[0];
        this._commitLane = { laneIdx: best.laneIdx };
        this._deploy(best);
        return;
      }
    }

    // inFallback但不是allEmpty时：优先选择1步可达的解锁候选
    if (inFallback && !allEmpty && freeSlots >= 1) {
      const nearUnlock = unlockPool.filter(u => u._dist === 1);
      if (nearUnlock.length > 0) {
        nearUnlock.sort((a, b) => (b._gain - b._cost) - (a._gain - a._cost));
        const best = nearUnlock[0];
        this._commitLane = { laneIdx: best.laneIdx };
        this._deploy(best);
        return;
      }
    }

    // v10：容量感知评分
    const cellDepth = this._buildCellDepth();
    const urgency   = this._computeUrgency(cellDepth);

    const pool = inFallback ? candidates : [...reachPool, ...unlockPool];

    for (const c of pool) {
      let score;
      if (c._unlock) {
        const tColor  = c._targetColor;
        const tU      = tColor ? (urgency[tColor] ?? 0) : 0;
        const tBlocks = tColor ? (colorCount[tColor] ?? 1) : 1;
        const tAmmo   = tColor ? (colorAmmo[tColor] ?? 0) : 0;
        const ammoFit = 1 / (1 + Math.abs(tAmmo - tBlocks));
        score = 0.6 * tU * ammoFit * (1 / (1 + (c._cost ?? 0) / 20));
      } else {
        const u       = urgency[c.color] ?? 0;
        const blocks  = colorCount[c.color] ?? 0;
        const ammo    = colorAmmo[c.color]  ?? 0;
        const ammoFit = 1 / (1 + Math.abs(ammo - blocks));
        const ep      = exposureMap[c.color] ?? TOTAL_DIST;
        score = u * ammoFit * (1 / (1 + ep / (TOTAL_DIST * 2)));
        if (inFallback) score *= 1 / (1 + ep / TOTAL_DIST);
      }
      const onTrack = trackColorCount[c.color] || 0;
      if (onTrack > 0) score *= Math.pow(0.6, onTrack);
      c.score = score;
    }

    pool.sort((a, b) => {
      const ds = b.score - a.score;
      if (Math.abs(ds) > 1e-9) return ds;
      if (a.source === 'buffer' && b.source !== 'buffer') return -1;
      if (b.source === 'buffer' && a.source !== 'buffer') return  1;
      return 0;
    });

    this._commitLane = null;
    this._deploy(pool[0]);
  }

  // ── 候选收集 ─────────────────────────────────────────────────

  // 收集所有当前可部署的候选车（buffer 全部 + 各队列队首）
  _gatherCandidates(colorCount) {
    const logic      = this.scene.logic;
    const candidates = [];

    for (let i = 0; i < logic.buffer.length; i++) {
      const t = logic.buffer[i];
      if ((colorCount[t.color] ?? 0) === 0) continue;
      candidates.push({
        source: 'buffer', bufferIdx: i,
        color: t.color, ammo: t.ammo,
        idle: t.idleLastLap ?? false,
      });
    }

    for (let li = 0; li < logic.lanes.length; li++) {
      const lane = logic.lanes[li];
      if (lane.length === 0) continue;
      const t = lane[0];
      if ((colorCount[t.color] ?? 0) === 0) continue;
      candidates.push({
        source: 'lane', laneIdx: li,
        color: t.color, ammo: t.ammo,
        idle: false,
      });
    }

    return candidates;
  }

  // ── 可达性计算 ───────────────────────────────────────────────

  // 从四个方向扫描，每行/列只取最外层第一个非空格子的颜色（与 _findTarget 严格一致，不穿透）
  _computeReachable() {
    const { GW, GH } = G;
    const grid      = this.scene.logic.grid;
    const reachable = new Set();

    for (let col = 0; col < GW; col++) {
      for (let row = GH - 1; row >= 0; row--) {       // BOTTOM
        if (grid[row]?.[col] != null) { reachable.add(grid[row][col]); break; }
      }
      for (let row = 0; row < GH; row++) {             // TOP
        if (grid[row]?.[col] != null) { reachable.add(grid[row][col]); break; }
      }
    }
    for (let row = 0; row < GH; row++) {
      for (let col = GW - 1; col >= 0; col--) {       // RIGHT
        if (grid[row]?.[col] != null) { reachable.add(grid[row][col]); break; }
      }
      for (let col = 0; col < GW; col++) {             // LEFT
        if (grid[row]?.[col] != null) { reachable.add(grid[row][col]); break; }
      }
    }

    return reachable;
  }

  // ── 实际部署 ─────────────────────────────────────────────────

  _deploy(candidate) {
    const logic = this.scene.logic;
    const { BUFFER_Y, QUEUE_Y } = G;

    if (candidate.source === 'buffer') {
      const deployed = logic.deployFromBuffer(candidate.bufferIdx);
      if (deployed) {
        const sp = this.scene.renderer._bufferSlotPos(candidate.bufferIdx);
        this.scene.bullets.spawnFlash(sp.x, BUFFER_Y);
      }
    } else {
      const nl       = logic.lanes.length;
      const cx       = this.scene.renderer._laneCenterX(candidate.laneIdx, nl);
      const deployed = logic.deployFromLane(candidate.laneIdx);
      if (deployed) this.scene.bullets.spawnFlash(cx, QUEUE_Y + 60);
    }
  }

  // 按轨道 pathPos 顺序计算每种颜色的首次暴露位置（越小越早）
  _computeColorExposurePathPos() {
    const { GW, GH, LEN_BOTTOM, LEN_RIGHT, LEN_TOP, CELL } = G;
    const grid = this.scene.logic.grid;
    const blockExposure = {}; // color -> min pathPos

    const update = (color, pathPos) => {
      if (!(color in blockExposure) || pathPos < blockExposure[color])
        blockExposure[color] = pathPos;
    };

    for (let col = 0; col < GW; col++) {
      const pp = col * CELL;
      for (let row = GH - 1; row >= 0; row--) {
        if (grid[row]?.[col] != null) { update(grid[row][col], pp); break; }
      }
    }
    for (let row = 0; row < GH; row++) {
      const pp = LEN_BOTTOM + (GH - 1 - row) * CELL;
      for (let col = GW - 1; col >= 0; col--) {
        if (grid[row]?.[col] != null) { update(grid[row][col], pp); break; }
      }
    }
    for (let col = 0; col < GW; col++) {
      const pp = LEN_BOTTOM + LEN_RIGHT + (GW - 1 - col) * CELL;
      for (let row = 0; row < GH; row++) {
        if (grid[row]?.[col] != null) { update(grid[row][col], pp); break; }
      }
    }
    for (let row = 0; row < GH; row++) {
      const pp = LEN_BOTTOM + LEN_RIGHT + LEN_TOP + row * CELL;
      for (let col = 0; col < GW; col++) {
        if (grid[row]?.[col] != null) { update(grid[row][col], pp); break; }
      }
    }
    return blockExposure;
  }

  // ── v10 深度与紧迫度 ─────────────────────────────────────────

  _buildCellDepth() {
    const { GW, GH } = G;
    const grid = this.scene.logic.grid;
    const d = Array.from({ length: GH }, () => Array(GW).fill(Infinity));
    for (let col = 0; col < GW; col++) {
      let k = 0;
      for (let row = GH - 1; row >= 0; row--)
        if (grid[row]?.[col] != null) { d[row][col] = Math.min(d[row][col], k); k++; }
      k = 0;
      for (let row = 0; row < GH; row++)
        if (grid[row]?.[col] != null) { d[row][col] = Math.min(d[row][col], k); k++; }
    }
    for (let row = 0; row < GH; row++) {
      let k = 0;
      for (let col = GW - 1; col >= 0; col--)
        if (grid[row]?.[col] != null) { d[row][col] = Math.min(d[row][col], k); k++; }
      k = 0;
      for (let col = 0; col < GW; col++)
        if (grid[row]?.[col] != null) { d[row][col] = Math.min(d[row][col], k); k++; }
    }
    return d;
  }

  _computeUrgency(cellDepth) {
    const { GW, GH } = G;
    const grid = this.scene.logic.grid;
    const urgency = {};
    for (let row = 0; row < GH; row++)
      for (let col = 0; col < GW; col++) {
        const color = grid[row]?.[col];
        if (color == null) continue;
        urgency[color] = (urgency[color] ?? 0) + 1 / (cellDepth[row][col] + 1);
      }
    return urgency;
  }

  // ── 工具 ─────────────────────────────────────────────────────

  _countColors() {
    const map = {};
    for (const b of this.scene.logic.blocks)
      map[b.color] = (map[b.color] ?? 0) + 1;
    return map;
  }
}
