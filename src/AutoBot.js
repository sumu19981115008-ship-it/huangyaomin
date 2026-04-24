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
    this.scene      = scene;
    this.enabled    = false;
    this._tickTimer = null;
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

    // 正常决策：按颜色聚合弹药总和，评分选最优
    const colorAmmo = {};
    for (const c of candidates) {
      colorAmmo[c.color] = (colorAmmo[c.color] ?? 0) + c.ammo;
    }

    // 轨道颜色多样性：轨道上已有同色车则评分打折，避免单色占轨导致不可达车无法进入
    const trackColorCount = {};
    for (const t of logic.turrets) trackColorCount[t.color] = (trackColorCount[t.color] || 0) + 1;

    const reachable = candidates.filter(c => reachableSet.has(c.color));
    const pool      = reachable.length > 0 ? reachable : candidates;

    for (const c of pool) {
      const blockCount = colorCount[c.color] ?? 0;
      const ammoSum    = colorAmmo[c.color]  ?? 0;
      let score = 1 / (1 + Math.abs(ammoSum - blockCount));
      const onTrack = trackColorCount[c.color] || 0;
      if (onTrack > 0) score *= Math.pow(0.6, onTrack); // 同色每多一辆打 0.6 折
      c.score = score;
    }

    pool.sort((a, b) => {
      const ds = b.score - a.score;
      if (Math.abs(ds) > 1e-9) return ds;
      if (a.source === 'buffer' && b.source !== 'buffer') return -1;
      if (b.source === 'buffer' && a.source !== 'buffer') return  1;
      return 0;
    });

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

  // ── 工具 ─────────────────────────────────────────────────────

  _countColors() {
    const map = {};
    for (const b of this.scene.logic.blocks)
      map[b.color] = (map[b.color] ?? 0) + 1;
    return map;
  }
}
