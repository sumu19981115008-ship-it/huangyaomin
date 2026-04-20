import {
  GW, GH, CELL,
  SIDE_LEN, TOTAL_DIST,
  TRACK_CAP, BUFFER_CAP, TURRET_SPEED,
  SIDE,
} from './constants.js';

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
    if (this.pathPos < SIDE_LEN)       return SIDE.BOTTOM;
    if (this.pathPos < SIDE_LEN * 2)   return SIDE.RIGHT;
    if (this.pathPos < SIDE_LEN * 3)   return SIDE.TOP;
    return SIDE.LEFT;
  }

  getSlot() {
    const p = this.pathPos;
    if (p < SIDE_LEN)      return Math.floor(p / CELL);
    if (p < SIDE_LEN * 2)  return GH - 1 - Math.floor((p - SIDE_LEN)     / CELL);
    if (p < SIDE_LEN * 3)  return GW - 1 - Math.floor((p - SIDE_LEN * 2) / CELL);
    return Math.floor((p - SIDE_LEN * 3) / CELL);
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
    this.pendingBullets = [];
    this.trackCap   = TRACK_CAP;
    this.state      = 'idle';
    this.failReason = null;
  }

  loadLevel(data) {
    _nextId = 0;
    this.grid   = Array.from({ length: GH }, () => Array(GW).fill(null));
    this.blocks = [];
    this.lanes  = [];
    this.turrets= [];
    this.buffer = [];
    this.pendingBullets = [];
    this.trackCap = TRACK_CAP;
    this.state    = 'playing';
    this.failReason = null;

    const bh = data.boardHeight ?? GH;

    for (const entity of data.entities) {
      if (entity.type !== 'PixelBlock') continue;
      const color = entity.color.toUpperCase();
      for (const cell of entity.cells) {
        const col = cell.x;
        const row = (bh - 1) - cell.y;
        if (col < 0 || col >= GW || row < 0 || row >= GH) continue;
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
      if (t.lane >= 0 && t.lane < numLanes) {
        this.lanes[t.lane].push(new TurretDef(t.color.toUpperCase(), t.ammo));
      }
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

    const lapDone = [];

    for (const t of this.turrets) {
      if (t.lapComplete) continue;

      t.pathPos += TURRET_SPEED;

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

  _findTarget(turret) {
    const side  = turret.getSide();
    const slot  = turret.getSlot();
    const color = turret.color;

    switch (side) {
      case SIDE.BOTTOM:
        for (let row = GH - 1; row >= 0; row--)
          if (this.grid[row][slot] !== null)
            return this.grid[row][slot] === color ? { col: slot, row } : null;
        break;
      case SIDE.RIGHT:
        for (let col = GW - 1; col >= 0; col--)
          if (this.grid[slot]?.[col] !== null)
            return this.grid[slot][col] === color ? { col, row: slot } : null;
        break;
      case SIDE.TOP:
        for (let row = 0; row < GH; row++)
          if (this.grid[row][slot] !== null)
            return this.grid[row][slot] === color ? { col: slot, row } : null;
        break;
      case SIDE.LEFT:
        for (let col = 0; col < GW; col++)
          if (this.grid[slot]?.[col] !== null)
            return this.grid[slot][col] === color ? { col, row: slot } : null;
        break;
    }
    return null;
  }

  _handleLapComplete(t) {
    const idx = this.turrets.indexOf(t);
    if (idx === -1) return;
    this.turrets.splice(idx, 1);

    if (t.ammo > 0) {
      if (this.buffer.length >= BUFFER_CAP) {
        this.state      = 'fail';
        this.failReason = 'ON_STAGE_FULL';
        return;
      }
      this.buffer.push(t);
    }
  }
}
