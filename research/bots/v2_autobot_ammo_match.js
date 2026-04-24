import { G } from './constants.js';

/**
 * 自动闯关机器人
 *
 * 部署策略：
 *   1. 收集所有当前可部署候选（buffer 全部 + 各队列队首）
 *   2. 按颜色聚合弹药总和，评分 = 1 / (1 + |弹药总和 - 该色方块数|)
 *      → 弹药总和最贴近方块数的颜色得分最高
 *   3. 递推可达性：沿每行/列向内扫描时，遇到"有可部署车的颜色"就穿透继续向内
 *      → 阻挡方块本身可被消除，则被遮挡方块也视为可消除
 *   4. idleLastLap=true 且颜色不可达（含递推后）的车跳过等待
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

    const colorCount  = this._countColors();
    const candidates  = this._gatherCandidates(colorCount);
    if (candidates.length === 0) return;

    // 第一步：用所有候选颜色集合计算递推可达色
    const candidateColorSet = new Set(candidates.map(c => c.color));
    const reachableSet      = this._computeReachable(candidateColorSet);

    // 第二步：按颜色聚合弹药总和
    const colorAmmo = {};
    for (const c of candidates) {
      colorAmmo[c.color] = (colorAmmo[c.color] ?? 0) + c.ammo;
    }

    // 第三步：过滤 + 评分
    const valid = [];
    for (const c of candidates) {
      const reachable = reachableSet.has(c.color);
      // idle 且颜色不可达（含递推）→ 跳过
      if ((c.idle) && !reachable) continue;
      const blockCount = colorCount[c.color] ?? 0;
      const ammoSum    = colorAmmo[c.color]  ?? 0;
      // 弹药总和与方块数差值越小评分越高；不可达的颜色评分打折
      const matchScore = 1 / (1 + Math.abs(ammoSum - blockCount));
      c.score     = reachable ? matchScore : matchScore * 0.1;
      c.reachable = reachable;
      valid.push(c);
    }

    if (valid.length === 0) return;

    // 第四步：排序 - 分数降序，同分 buffer 优先
    valid.sort((a, b) => {
      const ds = b.score - a.score;
      if (Math.abs(ds) > 1e-9) return ds;
      if (a.source === 'buffer' && b.source !== 'buffer') return -1;
      if (b.source === 'buffer' && a.source !== 'buffer') return  1;
      return 0;
    });

    this._deploy(valid[0]);
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

  // ── 递推可达性 ───────────────────────────────────────────────

  /**
   * 从四个方向扫描，遇到 candidateColors 中的颜色就穿透继续，
   * 遇到 candidateColors 之外的颜色就停止。
   * 这样：阻挡方块可被消除 → 被遮挡方块也视为可达。
   */
  _computeReachable(candidateColors) {
    const { GW, GH } = G;
    const grid      = this.scene.logic.grid;
    const reachable = new Set();

    // BOTTOM：每列从底向上穿透
    for (let col = 0; col < GW; col++) {
      for (let row = GH - 1; row >= 0; row--) {
        const color = grid[row]?.[col];
        if (color == null) continue;
        if (candidateColors.has(color)) { reachable.add(color); }
        else break;
      }
    }

    // TOP：每列从顶向下穿透
    for (let col = 0; col < GW; col++) {
      for (let row = 0; row < GH; row++) {
        const color = grid[row]?.[col];
        if (color == null) continue;
        if (candidateColors.has(color)) { reachable.add(color); }
        else break;
      }
    }

    // RIGHT：每行从右向左穿透
    for (let row = 0; row < GH; row++) {
      for (let col = GW - 1; col >= 0; col--) {
        const color = grid[row]?.[col];
        if (color == null) continue;
        if (candidateColors.has(color)) { reachable.add(color); }
        else break;
      }
    }

    // LEFT：每行从左向右穿透
    for (let row = 0; row < GH; row++) {
      for (let col = 0; col < GW; col++) {
        const color = grid[row]?.[col];
        if (color == null) continue;
        if (candidateColors.has(color)) { reachable.add(color); }
        else break;
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
