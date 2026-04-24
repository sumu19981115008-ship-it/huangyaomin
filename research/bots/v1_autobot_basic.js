import { G } from './constants.js';

/**
 * 自动闯关机器人
 *
 * 部署优先级：
 *   1. 颜色在棋盘上"可立即打到"（至少有一格暴露在最外层）且剩余数量最多
 *   2. 候选范围：buffer 全部 + 每条队列前3辆
 *   3. buffer 中 idleLastLap=true 且颜色当前不可达的车，跳过等待
 *   4. 同分时 buffer 优先于队列
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
    const blocked = logic.turrets.some(t => !t.lapComplete && t.pathPos < SAFE_GAP);
    if (blocked) return;

    // 预计算：棋盘各颜色总数 + 可达色集合
    const colorCount    = this._countColors();
    const reachableSet  = this._reachableColors();

    this._deployBest(colorCount, reachableSet);
  }

  // ── 核心选车逻辑 ─────────────────────────────────────────────

  _deployBest(colorCount, reachableSet) {
    const logic = this.scene.logic;
    const { BUFFER_Y, QUEUE_Y } = G;

    // 候选列表
    // { source, bufferIdx?, laneIdx?, posInLane?, color, score, reachable, idle }
    const candidates = [];

    // buffer：全部候选，但 idleLastLap 且不可达的排到最后
    for (let i = 0; i < logic.buffer.length; i++) {
      const t         = logic.buffer[i];
      const cnt       = colorCount[t.color] ?? 0;
      if (cnt === 0) continue;  // 颜色已不在棋盘，跳过
      const reachable = reachableSet.has(t.color);
      const idle      = t.idleLastLap ?? false;
      // 上圈没打中且颜色当前仍不可达，等待
      if (idle && !reachable) continue;
      candidates.push({ source: 'buffer', bufferIdx: i, color: t.color,
                        score: cnt, reachable, idle });
    }

    // 队列：每条取前3辆
    const LOOK_AHEAD = 3;
    for (let li = 0; li < logic.lanes.length; li++) {
      const lane = logic.lanes[li];
      for (let pi = 0; pi < Math.min(LOOK_AHEAD, lane.length); pi++) {
        const t         = lane[pi];
        const cnt       = colorCount[t.color] ?? 0;
        if (cnt === 0) continue;
        const reachable = reachableSet.has(t.color);
        // 队列中间的车（pi>0）只有比队首更优才考虑，否则不值得乱序
        // 只有 pi===0 的车能直接 deployFromLane 取到（规则限制）
        // pi>0 的车用于评估"如果队首不优，等一等"的参考，但不直接部署
        if (pi === 0) {
          candidates.push({ source: 'lane', laneIdx: li, posInLane: 0,
                            color: t.color, score: cnt, reachable });
        }
        // pi 1~2：仅用于判断"队首是否值得跳过"，不作为直接候选
      }
    }

    if (candidates.length === 0) return false;

    // 排序：可达优先 > 分数降序 > buffer优先
    candidates.sort((a, b) => {
      const ra = a.reachable ? 1 : 0, rb = b.reachable ? 1 : 0;
      if (rb !== ra) return rb - ra;
      if (b.score !== a.score) return b.score - a.score;
      if (a.source === 'buffer' && b.source !== 'buffer') return -1;
      if (b.source === 'buffer' && a.source !== 'buffer') return  1;
      return 0;
    });

    // 最优候选：若队列队首不是最优色，但队列前3里有更好的色，
    // 且那辆车不在队首（无法直接取），则暂缓部署队列，等颜色消除后再取
    const best = candidates[0];

    if (best.source === 'buffer') {
      const deployed = logic.deployFromBuffer(best.bufferIdx);
      if (deployed) {
        const sp = this.scene.renderer._bufferSlotPos(best.bufferIdx);
        this.scene.bullets.spawnFlash(sp.x, BUFFER_Y);
      }
      return deployed;
    } else {
      const nl       = logic.lanes.length;
      const cx       = this.scene.renderer._laneCenterX(best.laneIdx, nl);
      const deployed = logic.deployFromLane(best.laneIdx);
      if (deployed) this.scene.bullets.spawnFlash(cx, QUEUE_Y + 60);
      return deployed;
    }
  }

  // ── 工具 ─────────────────────────────────────────────────────

  // 各颜色在棋盘上的剩余数量
  _countColors() {
    const map = {};
    for (const b of this.scene.logic.blocks)
      map[b.color] = (map[b.color] ?? 0) + 1;
    return map;
  }

  /**
   * 从四个方向扫描，找出当前"最外层暴露"的颜色集合。
   * 逻辑与 _findTarget 一致：从边缘射入，遇到第一个非空格子即为该行/列的最外层。
   * 若最外层格子颜色 === 某炮车颜色，该颜色"可达"。
   */
  _reachableColors() {
    const { GW, GH } = G;
    const grid = this.scene.logic.grid;
    const reachable = new Set();

    // BOTTOM 方向：每列从底部向上，取第一个非空
    for (let col = 0; col < GW; col++) {
      for (let row = GH - 1; row >= 0; row--) {
        if (grid[row]?.[col] != null) { reachable.add(grid[row][col]); break; }
      }
    }
    // TOP 方向：每列从顶部向下
    for (let col = 0; col < GW; col++) {
      for (let row = 0; row < GH; row++) {
        if (grid[row]?.[col] != null) { reachable.add(grid[row][col]); break; }
      }
    }
    // RIGHT 方向：每行从右向左
    for (let row = 0; row < GH; row++) {
      for (let col = GW - 1; col >= 0; col--) {
        if (grid[row]?.[col] != null) { reachable.add(grid[row][col]); break; }
      }
    }
    // LEFT 方向：每行从左向右
    for (let row = 0; row < GH; row++) {
      for (let col = 0; col < GW; col++) {
        if (grid[row]?.[col] != null) { reachable.add(grid[row][col]); break; }
      }
    }

    return reachable;
  }
}
