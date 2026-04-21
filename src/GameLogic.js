import {
  G,
  TRACK_CAP, BUFFER_CAP, TURRET_SPEED,
  CELL_MIN, CELL_MAX,
  VW, VH, TRACK_GAP,
  SIDE,
} from './constants.js';

// 底部 UI 总高度预留，与 game1 保持一致
const CANVAS_Y_FIXED = 90;
const UI_RESERVE     = 516;

class TurretDef {
  constructor(color, ammo) {
    this.color = color;
    this.ammo  = ammo;
  }
}

let _nextId = 0;

class ActiveTurret {
  constructor(color, ammo) {
    this.id    = _nextId++;
    this.color = color;
    this.ammo  = ammo;
    this.pathPos           = 0;
    this.lapComplete       = false;
    this.activeShotCount   = 0;
    this.shotSlotsThisSide = new Set();
    this.lastSide          = SIDE.BOTTOM;
  }

  getSide() {
    const { LEN_BOTTOM, LEN_RIGHT, LEN_TOP } = G;
    const p = this.pathPos;
    if (p < LEN_BOTTOM)                          return SIDE.BOTTOM;
    if (p < LEN_BOTTOM + LEN_RIGHT)              return SIDE.RIGHT;
    if (p < LEN_BOTTOM + LEN_RIGHT + LEN_TOP)    return SIDE.TOP;
    return SIDE.LEFT;
  }

  getSlot() {
    const { LEN_BOTTOM, LEN_RIGHT, LEN_TOP, GW, GH, CELL } = G;
    const p = this.pathPos;
    if (p < LEN_BOTTOM)
      return Math.floor(p / CELL);
    if (p < LEN_BOTTOM + LEN_RIGHT)
      return GH - 1 - Math.floor((p - LEN_BOTTOM) / CELL);
    if (p < LEN_BOTTOM + LEN_RIGHT + LEN_TOP)
      return GW - 1 - Math.floor((p - LEN_BOTTOM - LEN_RIGHT) / CELL);
    return Math.floor((p - LEN_BOTTOM - LEN_RIGHT - LEN_TOP) / CELL);
  }

  resetForDeploy() {
    this.pathPos           = 0;
    this.lapComplete       = false;
    this.activeShotCount   = 0;
    this.shotSlotsThisSide = new Set();
    this.lastSide          = SIDE.BOTTOM;
  }
}

export class GameLogic {
  constructor() {
    this.grid    = [];
    this.blocks  = [];
    this.lanes   = [];
    this.turrets = [];
    this.buffer  = [];
    this.pendingBullets   = [];
    this.inFlightTargets  = new Set();
    this.trackCap         = TRACK_CAP;
    this.bufferCap        = BUFFER_CAP;
    this.speedMult        = 1;
    this.endgameStarted   = false;
    this.state            = 'idle';
    this.failReason       = null;
  }

  loadLevel(data) {
    _nextId = 0;

    // ── 动态几何计算（与 game1 公式一致）──────────────────────
    const bw = data.boardWidth  || 20;
    const bh = data.boardHeight || 20;
    const CANVAS_Y = CANVAS_Y_FIXED;
    const cellByW  = Math.floor((VW - 40) / bw);
    const cellByH  = Math.floor((VH - CANVAS_Y - UI_RESERVE) / bh);
    const CELL     = Math.max(CELL_MIN, Math.min(CELL_MAX, cellByW, cellByH));
    const CW       = bw * CELL;
    const CH       = bh * CELL;
    const CANVAS_X = Math.floor((VW - CW) / 2);
    const ITEM_BAR_Y = CANVAS_Y + CH + TRACK_GAP + 52;
    const BUFFER_Y   = ITEM_BAR_Y + 130;
    const QUEUE_Y    = BUFFER_Y + 90;
    const LEN_BOTTOM = CW, LEN_RIGHT = CH, LEN_TOP = CW, LEN_LEFT = CH;
    const TOTAL_DIST = LEN_BOTTOM + LEN_RIGHT + LEN_TOP + LEN_LEFT;
    Object.assign(G, {
      GW: bw, GH: bh, CELL, CW, CH, CANVAS_X, CANVAS_Y,
      ITEM_BAR_Y, BUFFER_Y, QUEUE_Y,
      LEN_BOTTOM, LEN_RIGHT, LEN_TOP, LEN_LEFT, TOTAL_DIST,
    });
    // ──────────────────────────────────────────────────────────

    this.grid   = Array.from({ length: bh }, () => Array(bw).fill(null));
    this.blocks = [];
    this.lanes  = [];
    this.turrets= [];
    this.buffer = [];
    this.pendingBullets  = [];
    this.inFlightTargets = new Set();
    this.trackCap        = TRACK_CAP;
    this.bufferCap       = BUFFER_CAP;
    this.speedMult       = 1;
    this.endgameStarted  = false;
    this.state           = 'playing';
    this.failReason      = null;

    for (const entity of data.entities) {
      if (entity.type !== 'PixelBlock') continue;
      const color = entity.color.toUpperCase();
      for (const cell of entity.cells) {
        const col = cell.x;
        const row = (bh - 1) - cell.y;
        if (col < 0 || col >= bw || row < 0 || row >= bh) continue;
        this.grid[row][col] = color;
        this.blocks.push({ x: col, y: row, color });
      }
    }

    const numLanes = data.numberOfLanes ?? 2;
    for (let i = 0; i < numLanes; i++) this.lanes.push([]);

    const sorted = [...data.initialTanks].sort((a, b) =>
      a.lane !== b.lane ? a.lane - b.lane : a.position - b.position
    );
    for (const t of sorted) {
      if (t.lane >= 0 && t.lane < numLanes)
        this.lanes[t.lane].push(new TurretDef(t.color.toUpperCase(), t.ammo));
    }
  }

  deployFromLane(laneIdx) {
    if (this.state !== 'playing') return false;
    if (laneIdx < 0 || laneIdx >= this.lanes.length) return false;
    if (this.lanes[laneIdx].length === 0) return false;
    if (this.turrets.length >= this.trackCap) return false;
    const def = this.lanes[laneIdx].shift();
    this.turrets.push(new ActiveTurret(def.color, def.ammo));
    return true;
  }

  deployFromBuffer(bufferIdx) {
    if (this.state !== 'playing') return false;
    if (bufferIdx < 0 || bufferIdx >= this.buffer.length) return false;
    if (this.turrets.length >= this.trackCap) return false;
    const t = this.buffer.splice(bufferIdx, 1)[0];
    t.resetForDeploy();
    this.turrets.push(t);
    return true;
  }

  update() {
    if (this.state !== 'playing') return;
    const { TOTAL_DIST } = G;
    const lapDone = [];

    for (const t of this.turrets) {
      if (t.lapComplete) continue;

      t.pathPos += TURRET_SPEED * this.speedMult;

      const newSide = t.getSide();
      if (newSide !== t.lastSide) {
        t.shotSlotsThisSide = new Set();
        t.lastSide = newSide;
      }

      if (t.pathPos >= TOTAL_DIST) {
        t.lapComplete = true;
        if (t.activeShotCount === 0) lapDone.push(t);
        continue;
      }

      if (t.ammo > 0) {
        const slot = t.getSlot();
        if (!t.shotSlotsThisSide.has(slot)) {
          t.shotSlotsThisSide.add(slot);
          const target = this._findTarget(t);
          if (target !== null) {
            t.activeShotCount++;
            t.ammo--;
            this.inFlightTargets.add(`${target.col},${target.row}`);
            this.pendingBullets.push({
              turretId:    t.id,
              col:         target.col,
              row:         target.row,
              color:       t.color,
              fromPathPos: t.pathPos,
            });
          }
        }
      }
    }

    for (const t of lapDone) {
      this._handleLapComplete(t);
      if (this.state === 'fail') return;
    }
  }

  onBulletHit(turretId, col, row) {
    this.inFlightTargets.delete(`${col},${row}`);
    if (this.grid[row]?.[col] != null) {
      this.grid[row][col] = null;
      const idx = this.blocks.findIndex(b => b.x === col && b.y === row);
      if (idx !== -1) this.blocks.splice(idx, 1);
    }

    if (this.blocks.length === 0) {
      this.state = 'win';
      const tw = this.turrets.find(t => t.id === turretId);
      if (tw) tw.activeShotCount = Math.max(0, tw.activeShotCount - 1);
      return;
    }

    const t = this.turrets.find(t => t.id === turretId);
    if (t) {
      t.activeShotCount--;
      if (t.ammo === 0 && t.activeShotCount === 0) {
        const idx = this.turrets.indexOf(t);
        if (idx !== -1) this.turrets.splice(idx, 1);
        this._checkEndgame();
        return;
      }
      if (t.lapComplete && t.activeShotCount === 0) {
        this._handleLapComplete(t);
      }
    }
  }

  flushPendingBullets() {
    const list = this.pendingBullets;
    this.pendingBullets = [];
    return list;
  }

  getLaneVisible(laneIdx) { return this.lanes[laneIdx]?.slice(0, 2) ?? []; }
  getLaneCount(laneIdx)   { return this.lanes[laneIdx]?.length ?? 0; }
  isTrackFull()           { return this.turrets.length >= this.trackCap; }

  getPendingTurrets() {
    const list = [];
    for (const t of this.buffer) list.push({ source: 'buffer', turret: t });
    for (let li = 0; li < this.lanes.length; li++)
      for (const def of this.lanes[li]) list.push({ source: 'lane', laneIdx: li, def });
    return list;
  }

  _checkEndgame() {
    if (this.endgameStarted) return;
    const laneTotal = this.lanes.reduce((s, l) => s + l.length, 0);
    const total = this.turrets.length + this.buffer.length + laneTotal;
    if (total >= this.bufferCap + 1) return;
    this.endgameStarted = true;
    this.speedMult = 2;
    const { TOTAL_DIST } = G;
    for (const t of this.turrets) t.pathPos = t.pathPos % TOTAL_DIST;
  }

  forceDeployFromBuffer(bufferIdx) {
    if (this.state !== 'playing') return false;
    if (bufferIdx < 0 || bufferIdx >= this.buffer.length) return false;
    const t = this.buffer.splice(bufferIdx, 1)[0];
    t.resetForDeploy();
    this.turrets.push(t);
    return true;
  }

  forceDeployFromLane(laneIdx) {
    if (this.state !== 'playing') return false;
    if (laneIdx < 0 || laneIdx >= this.lanes.length) return false;
    if (this.lanes[laneIdx].length === 0) return false;
    const def = this.lanes[laneIdx].shift();
    this.turrets.push(new ActiveTurret(def.color, def.ammo));
    return true;
  }

  forceDeployFromLaneAt(laneIdx, turretIdx) {
    if (this.state !== 'playing') return null;
    const lane = this.lanes[laneIdx];
    if (!lane || turretIdx >= lane.length) return null;
    const [def] = lane.splice(turretIdx, 1);
    const t = new ActiveTurret(def.color, def.ammo);
    this.turrets.push(t);
    return { color: def.color, ammo: def.ammo };
  }

  _findTarget(turret) {
    const { GW, GH } = G;
    const side  = turret.getSide();
    const slot  = turret.getSlot();
    const color = turret.color;
    switch (side) {
      case SIDE.BOTTOM:
        for (let row = GH - 1; row >= 0; row--)
          if (this.grid[row][slot] !== null)
            return (this.grid[row][slot] === color && !this.inFlightTargets.has(`${slot},${row}`)) ? { col: slot, row } : null;
        break;
      case SIDE.RIGHT:
        for (let col = GW - 1; col >= 0; col--)
          if (this.grid[slot]?.[col] !== null)
            return (this.grid[slot][col] === color && !this.inFlightTargets.has(`${col},${slot}`)) ? { col, row: slot } : null;
        break;
      case SIDE.TOP:
        for (let row = 0; row < GH; row++)
          if (this.grid[row][slot] !== null)
            return (this.grid[row][slot] === color && !this.inFlightTargets.has(`${slot},${row}`)) ? { col: slot, row } : null;
        break;
      case SIDE.LEFT:
        for (let col = 0; col < GW; col++)
          if (this.grid[slot]?.[col] !== null)
            return (this.grid[slot][col] === color && !this.inFlightTargets.has(`${col},${slot}`)) ? { col, row: slot } : null;
        break;
    }
    return null;
  }

  _handleLapComplete(t) {
    const { TOTAL_DIST } = G;
    const idx = this.turrets.indexOf(t);
    if (idx === -1) return;
    this.turrets.splice(idx, 1);

    if (t.ammo > 0) {
      if (this.endgameStarted) {
        t.pathPos -= TOTAL_DIST;
        t.lapComplete = false;
        t.shotSlotsThisSide = new Set();
        t.lastSide = SIDE.BOTTOM;
        this.turrets.push(t);
        this.speedMult = Math.min(2.4, this.speedMult * 1.2);
        return;
      }
      if (this.buffer.length >= this.bufferCap) {
        this.state      = 'fail';
        this.failReason = 'ON_STAGE_FULL';
        return;
      }
      this.buffer.push(t);
    }
    this._checkEndgame();
  }
}

