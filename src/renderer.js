import {
  G,
  TRACK_GAP,
  C_CANVAS_BG, C_TRACK, C_GRID_LINE, C_EMPTY_SLOT,
  BUFFER_COLORS,
  VW,
} from './constants.js';

// ── 共享坐标工具（bullets.js 也 import）────────────────────────

export function turretScreen(p) {
  const { LEN_BOTTOM, LEN_RIGHT, LEN_TOP, CANVAS_X, CANVAS_Y, CW, CH } = G;
  const g = TRACK_GAP;
  if (p < LEN_BOTTOM)
    return { x: CANVAS_X + p,                                        y: CANVAS_Y + CH + g };
  if (p < LEN_BOTTOM + LEN_RIGHT)
    return { x: CANVAS_X + CW + g,                                   y: CANVAS_Y + CH - (p - LEN_BOTTOM) };
  if (p < LEN_BOTTOM + LEN_RIGHT + LEN_TOP)
    return { x: CANVAS_X + CW - (p - LEN_BOTTOM - LEN_RIGHT),       y: CANVAS_Y - g };
  return   { x: CANVAS_X - g,                                        y: CANVAS_Y + (p - LEN_BOTTOM - LEN_RIGHT - LEN_TOP) };
}

export function blockScreen(col, row) {
  const { CANVAS_X, CANVAS_Y, CELL } = G;
  return {
    x: CANVAS_X + col * CELL + CELL / 2,
    y: CANVAS_Y + row * CELL + CELL / 2,
  };
}

export function hex(str) {
  return parseInt(String(str).replace('#', ''), 16);
}

export function hexNum(color) {
  if (typeof color === 'number') return color;
  return parseInt(String(color).replace('#', ''), 16);
}

// ── Renderer ───────────────────────────────────────────────────

export class Renderer {
  constructor(scene) {
    this.scene = scene;
  }

  // 主渲染入口，由 GameScene.update 每帧调用
  render(g, bullets) {
    g.clear();
    this._drawCanvas(g);
    this._drawTrack(g);
    this._drawTurrets(g);
    bullets.draw(g);
    this._drawBuffer(g);
    this._drawQueues(g);
  }

  // ── 网格与方块区域 ───────────────────────────────────────────

  _drawCanvas(g) {
    const { CANVAS_X, CANVAS_Y, CW, CH, GW, GH, CELL } = G;
    const oy  = this.scene.items.canvasOffsetY;
    const cy0 = CANVAS_Y + oy;

    g.fillStyle(C_CANVAS_BG);
    g.fillRect(CANVAS_X, cy0, CW, CH);

    g.lineStyle(0.5, C_GRID_LINE, 0.55);
    for (let c = 0; c <= GW; c++) {
      const x = CANVAS_X + c * CELL;
      g.lineBetween(x, cy0, x, cy0 + CH);
    }
    for (let r = 0; r <= GH; r++) {
      const y = cy0 + r * CELL;
      g.lineBetween(CANVAS_X, y, CANVAS_X + CW, y);
    }

    // 所有 entity 类型统一绘制（扩展点：障碍物、特殊方块等在此分发）
    this._drawEntities(g, cy0);

    g.lineStyle(1.5, 0x3a3a62, 1);
    g.strokeRect(CANVAS_X, cy0, CW, CH);
  }

  // 分发所有 entity 类型的绘制，新增障碍类型只需加 case
  _drawEntities(g, cy0) {
    const { CANVAS_X, CELL } = G;
    const logic = this.scene.logic;

    for (const b of logic.blocks) {
      this._drawBlock(g, b, CANVAS_X, cy0, CELL);
    }

    for (const obs of logic.obstacles) {
      this._drawObstacle(g, obs, CANVAS_X, cy0, CELL);
    }
  }

  _drawBlock(g, b, cx, cy0, CELL) {
    const px = cx + b.x * CELL + 1;
    const py = cy0 + b.y * CELL + 1;
    const s  = CELL - 2;
    const c  = hex(b.color);
    g.fillStyle(c, 1);
    g.fillRect(px, py, s, s);
    g.fillStyle(0xffffff, 0.22);
    g.fillRect(px, py, s, 3);
    g.fillRect(px, py + 3, 3, s - 3);
    g.fillStyle(0x000000, 0.25);
    g.fillRect(px, py + s - 2, s, 2);
    g.fillRect(px + s - 2, py, 2, s - 2);
  }

  // 障碍物绘制占位（后续按 obs.type 分发）
  _drawObstacle(g, obs, cx, cy0, CELL) {
    // 待实现
  }

  // ── 轨道 ─────────────────────────────────────────────────────

  _drawTrack(g) {
    const { CANVAS_X, CANVAS_Y, CW, CH } = G;
    const oy = this.scene.items.canvasOffsetY;
    const tx = CANVAS_X - TRACK_GAP;
    const ty = CANVAS_Y - TRACK_GAP + oy;
    const tw = CW + TRACK_GAP * 2;
    const th = CH + TRACK_GAP * 2;
    g.lineStyle(4, C_TRACK, 0.9);
    g.strokeRect(tx, ty, tw, th);
    g.lineStyle(1, 0x181838, 0.7);
    g.strokeRect(tx + 4, ty + 4, tw - 8, th - 8);
    const corners = [[tx, ty], [tx + tw, ty], [tx, ty + th], [tx + tw, ty + th]];
    g.fillStyle(0x5555aa, 1);
    for (const [cx, cy] of corners) g.fillCircle(cx, cy, 4);
  }

  // ── 轨道炮台 ─────────────────────────────────────────────────

  _drawTurrets(g) {
    const { txTurretAmmo } = this.scene;
    const turrets = this.scene.logic.turrets;
    let ti = 0;
    for (const t of turrets) {
      const pos = turretScreen(t.pathPos);
      const c   = hex(t.color);
      g.fillStyle(c, 0.28); g.fillCircle(pos.x, pos.y, 15);
      g.fillStyle(c, 1);    g.fillCircle(pos.x, pos.y, 11);
      g.lineStyle(2, 0xffffff, 0.75); g.strokeCircle(pos.x, pos.y, 11);
      g.fillStyle(0x000000, 0.5);     g.fillCircle(pos.x, pos.y, 4);
      if (ti < txTurretAmmo.length) {
        const txt = txTurretAmmo[ti];
        txt.setPosition(pos.x, pos.y - 20);
        txt.setText(String(t.ammo));
        txt.setVisible(true);
        ti++;
      }
    }
    for (let i = ti; i < txTurretAmmo.length; i++)
      txTurretAmmo[i].setVisible(false);
  }

  // ── 暂存区 ───────────────────────────────────────────────────

  _drawBuffer(g) {
    const logic  = this.scene.logic;
    const used   = logic.buffer.length;
    const cap    = logic.bufferCap;
    const bgCol  = BUFFER_COLORS[Math.min(used, BUFFER_COLORS.length - 1)];
    const { BUFFER_Y } = G;
    for (let i = 0; i < cap; i++) {
      const { x } = this._bufferSlotPos(i);
      const t      = logic.buffer[i];
      const has    = i < used;
      g.fillStyle(has ? 0x1c1c3a : C_EMPTY_SLOT, 0.9);
      g.fillRoundedRect(x - 22, BUFFER_Y - 22, 44, 44, 7);
      g.lineStyle(2, has ? bgCol : 0x2e2e50, 1);
      g.strokeRoundedRect(x - 22, BUFFER_Y - 22, 44, 44, 7);
      const txt = this.scene.txBufferAmmo[i];
      if (has) {
        g.fillStyle(hex(t.color), 1); g.fillCircle(x, BUFFER_Y - 6, 10);
        g.lineStyle(1.5, 0xffffff, 0.6); g.strokeCircle(x, BUFFER_Y - 6, 10);
        txt.setPosition(x, BUFFER_Y + 11);
        txt.setText(`×${t.ammo}`);
        txt.setVisible(true);
      } else {
        txt.setVisible(false);
      }
    }
  }

  // ── 队列 ─────────────────────────────────────────────────────

  _drawQueues(g) {
    const logic    = this.scene.logic;
    const numLanes = logic.lanes.length;
    const qy       = G.QUEUE_Y + (this.scene.items.queueOffsetY || 0);
    let itemIdx = 0, countIdx = 0;

    for (let li = 0; li < numLanes; li++) {
      const cx      = this._laneCenterX(li, numLanes);
      const total   = logic.getLaneCount(li);
      const visible = logic.getLaneVisible(li);
      const cardW = 70, cardH = 158;
      const active = total > 0;

      g.fillStyle(0x10102a, 0.88);
      g.fillRoundedRect(cx - cardW / 2, qy, cardW, cardH, 10);
      g.lineStyle(1.5, active ? 0x5555cc : 0x222244, 1);
      g.strokeRoundedRect(cx - cardW / 2, qy, cardW, cardH, 10);

      for (let vi = 0; vi < 2; vi++) {
        const def = visible[vi];
        const ty  = qy + 32 + vi * 60;
        const txt = this.scene.txQueueItems[itemIdx++];
        if (def) {
          const c = hex(def.color);
          g.fillStyle(c, 1);             g.fillCircle(cx, ty, 15);
          g.lineStyle(1.5, 0xffffff, 0.5); g.strokeCircle(cx, ty, 15);
          g.fillStyle(0x000000, 0.4);    g.fillCircle(cx, ty, 5);
          txt.setPosition(cx, ty - 22); txt.setText(String(def.ammo)); txt.setVisible(true);
        } else {
          g.fillStyle(0x252540, 1);      g.fillCircle(cx, ty, 12);
          g.lineStyle(1, 0x333355, 1);   g.strokeCircle(cx, ty, 12);
          txt.setVisible(false);
        }
      }

      const countTxt = this.scene.txQueueCounts[countIdx++];
      if (total > 2) {
        countTxt.setPosition(cx, qy + cardH - 16);
        countTxt.setText(`+${total - 2}`);
        countTxt.setVisible(true);
      } else {
        countTxt.setVisible(false);
      }
    }
    for (let i = itemIdx;  i < this.scene.txQueueItems.length;  i++) this.scene.txQueueItems[i].setVisible(false);
    for (let i = countIdx; i < this.scene.txQueueCounts.length; i++) this.scene.txQueueCounts[i].setVisible(false);
  }

  // ── 坐标工具 ─────────────────────────────────────────────────

  _bufferSlotPos(i) {
    const cap    = this.scene.logic.bufferCap;
    const totalW = cap * 52;
    const startX = (VW - totalW) / 2 + 26;
    return { x: startX + i * 52, y: G.BUFFER_Y };
  }

  _laneCenterX(laneIdx, numLanes) {
    const spacing = Math.min(130, (VW - 60) / numLanes);
    const totalW  = spacing * numLanes;
    const startX  = (VW - totalW) / 2 + spacing / 2;
    return startX + laneIdx * spacing;
  }
}
