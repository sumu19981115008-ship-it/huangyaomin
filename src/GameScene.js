import { GameLogic }  from './GameLogic.js';
import { DevTools }   from './dev/DevTools.js';
import {
  GW, GH, CELL, CW, CH,
  SIDE_LEN,
  TRACK_CAP, BUFFER_CAP, BULLET_SPEED,
  VW, VH,
  CANVAS_X, CANVAS_Y, TRACK_GAP,
  BUFFER_Y, QUEUE_Y,
  C_CANVAS_BG, C_TRACK, C_GRID_LINE, C_EMPTY_SLOT,
  BUFFER_COLORS, TOTAL_LEVELS,
} from './constants.js';

function turretScreen(p) {
  const SL = SIDE_LEN;
  const [x0, y0, g] = [CANVAS_X, CANVAS_Y, TRACK_GAP];
  if (p < SL)      return { x: x0 + p,              y: y0 + CH + g };
  if (p < SL * 2)  return { x: x0 + CW + g,          y: y0 + CH - (p - SL) };
  if (p < SL * 3)  return { x: x0 + CW - (p - SL*2), y: y0 - g };
  return                  { x: x0 - g,                y: y0 + (p - SL*3) };
}

function blockScreen(col, row) {
  return {
    x: CANVAS_X + col * CELL + CELL / 2,
    y: CANVAS_Y + row * CELL + CELL / 2,
  };
}

function hex(str) {
  return parseInt(str.replace('#', ''), 16);
}

export class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
    this.logic        = null;
    this.vBullets     = [];
    this.vParticles   = [];
    this.levelIndex   = 0;
    this.levels       = [];
    this.g            = null;
    this.overlayG     = null;
    this._lastState   = null;
    this.txLevel      = null;
    this.txHint       = null;
    this.txStatus     = null;
    this.txContinue   = null;
    this.txTurretAmmo  = [];
    this.txBufferAmmo  = [];
    this.txQueueItems  = [];
    this.txQueueCounts = [];
    this.devTools      = null;
  }

  init(data) {
    this.levelIndex = (data?.levelIndex ?? 0);
  }

  preload() {
    for (let i = 1; i <= TOTAL_LEVELS; i++) {
      this.load.json(`level${i}`, `/levels/level${i}.json`);
    }
  }

  create() {
    this.logic    = new GameLogic();
    this.g        = this.add.graphics();
    this.overlayG = this.add.graphics().setDepth(10);
    this.vBullets = [];

    this.levels = [];
    for (let i = 1; i <= TOTAL_LEVELS; i++) {
      const d = this.cache.json.get(`level${i}`);
      if (d) this.levels.push(d);
    }

    this._createTexts();
    this._loadCurrentLevel();

    this.devTools = new DevTools(this, {
      totalLevels: this.levels.length,
      onJump: (idx) => { this.levelIndex = idx; this._loadCurrentLevel(); },
    });

    this.input.on('pointerdown', (ptr) => this._handleClick(ptr.x, ptr.y));
  }

  update() {
    if (!this.logic || this.logic.state === 'idle') return;

    if (this.logic.state === 'playing') {
      this._spawnNewBullets();
      this._moveBullets();
      this.logic.update();
    }

    this._render();
    this._checkStateChange();
  }

  // ── 关卡管理 ──────────────────────────────────────────────

  _loadCurrentLevel() {
    const data = this.levels[this.levelIndex];
    if (!data) return;
    this.logic.loadLevel(data);
    this.vBullets   = [];
    this.vParticles = [];
    this._lastState = 'playing';
    this.txLevel.setText(`Level ${this.levelIndex + 1}`);
    this._hideOverlay();
    this.devTools?.sync(this.levelIndex);
  }

  // ── 输入 ──────────────────────────────────────────────────

  _handleClick(px, py) {
    const state = this.logic.state;

    if (state === 'win') {
      this.levelIndex = (this.levelIndex + 1) % this.levels.length;
      this._loadCurrentLevel();
      return;
    }
    if (state === 'fail') {
      this._loadCurrentLevel();
      return;
    }
    if (state !== 'playing') return;

    for (let i = 0; i < BUFFER_CAP; i++) {
      const sp = this._bufferSlotPos(i);
      if (Math.abs(px - sp.x) < 26 && Math.abs(py - BUFFER_Y) < 28) {
        const deployed = this.logic.deployFromBuffer(i);
        if (deployed) this._flashFeedback(sp.x, BUFFER_Y);
        return;
      }
    }

    const numLanes = this.logic.lanes.length;
    for (let i = 0; i < numLanes; i++) {
      const cx = this._laneCenterX(i, numLanes);
      if (Math.abs(px - cx) < 50 && py >= QUEUE_Y - 5 && py <= QUEUE_Y + 165) {
        const deployed = this.logic.deployFromLane(i);
        if (deployed) this._flashFeedback(cx, QUEUE_Y + 60);
        return;
      }
    }
  }

  _flashFeedback(x, y) {
    const fx = this.add.graphics().setDepth(5);
    fx.fillStyle(0xffffff, 0.7);
    fx.fillCircle(x, y, 18);
    this.tweens.add({
      targets: fx,
      alpha: 0, scaleX: 2, scaleY: 2,
      duration: 250, ease: 'Quad.easeOut',
      onComplete: () => fx.destroy(),
    });
  }

  // ── 子弹 ──────────────────────────────────────────────────

  _spawnNewBullets() {
    for (const b of this.logic.flushPendingBullets()) {
      const from = turretScreen(b.fromPathPos);
      const to   = blockScreen(b.col, b.row);
      this.vBullets.push({
        x: from.x, y: from.y,
        tx: to.x,  ty: to.y,
        color: b.color, turretId: b.turretId,
        col: b.col, row: b.row,
      });
    }
  }

  _moveBullets() {
    const PRE_FX_DIST = BULLET_SPEED * 6;
    const toHit = [];

    for (const vb of this.vBullets) {
      const dx   = vb.tx - vb.x;
      const dy   = vb.ty - vb.y;
      const dist = Math.hypot(dx, dy);

      if (dist <= BULLET_SPEED) {
        toHit.push(vb);
      } else {
        vb.x += (dx / dist) * BULLET_SPEED;
        vb.y += (dy / dist) * BULLET_SPEED;
        if (!vb.preFxDone && dist <= PRE_FX_DIST) {
          vb.preFxDone = true;
          this._spawnPreFx(vb.tx, vb.ty, vb.color);
        }
      }
    }

    for (const vb of toHit) {
      this.vBullets = this.vBullets.filter(b => b !== vb);
      this._spawnHitFx(vb.tx, vb.ty, vb.color);
      this.logic.onBulletHit(vb.turretId, vb.col, vb.row);
    }
  }

  _spawnPreFx(x, y, color) {
    this.vParticles.push({
      kind: 'ring', x, y, color,
      radius: CELL * 1.2, targetR: CELL * 0.3,
      alpha: 0.9, lineW: 2.5, fade: 0.10,
    });
  }

  _spawnHitFx(x, y, color) {
    for (let i = 0; i < 2; i++) {
      this.vParticles.push({
        kind: 'ring', x, y, color,
        radius: i * 4, targetR: CELL * 2.2,
        alpha: 0.85 - i * 0.15, lineW: 3 - i * 0.8,
        fade: 0.045, expand: true,
      });
    }
    this.vParticles.push({
      kind: 'flash', x, y,
      radius: CELL * 0.9, alpha: 1, fade: 0.18,
    });
    const SPARKS = 14;
    for (let i = 0; i < SPARKS; i++) {
      const angle = (Math.PI * 2 / SPARKS) * i + (Math.random() - 0.5) * 0.5;
      const speed = 3.5 + Math.random() * 4.5;
      this.vParticles.push({
        kind: 'spark', x, y,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        color, alpha: 1,
        size: 2.5 + Math.random() * 2.5,
        fade: 0.038 + Math.random() * 0.02, friction: 0.84,
      });
    }
    for (let i = 0; i < 6; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 3;
      this.vParticles.push({
        kind: 'chip',
        x: x + (Math.random() - 0.5) * CELL * 0.6,
        y: y + (Math.random() - 0.5) * CELL * 0.6,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        color, alpha: 1,
        w: 3 + Math.random() * 3, h: 3 + Math.random() * 3,
        rot: Math.random() * Math.PI * 2,
        rotV: (Math.random() - 0.5) * 0.3,
        fade: 0.045, friction: 0.80,
      });
    }
  }

  _updateParticles(g) {
    const alive = [];
    for (const p of this.vParticles) {
      p.alpha -= p.fade ?? 0.055;
      if (p.alpha <= 0) continue;
      alive.push(p);
      const c = parseInt((p.color ?? '#ffffff').replace('#', ''), 16);

      if (p.kind === 'flash') {
        g.fillStyle(0xffffff, p.alpha);
        g.fillCircle(p.x, p.y, p.radius);

      } else if (p.kind === 'ring') {
        if (p.expand) p.radius += (p.targetR - p.radius) * 0.25;
        else          p.radius += (p.targetR - p.radius) * 0.35;
        g.lineStyle(p.lineW, c, p.alpha);
        g.strokeCircle(p.x, p.y, Math.max(1, p.radius));
        g.lineStyle(p.lineW * 0.5, 0xffffff, p.alpha * 0.5);
        g.strokeCircle(p.x, p.y, Math.max(1, p.radius));

      } else if (p.kind === 'spark') {
        p.x += p.vx; p.y += p.vy;
        p.vx *= p.friction; p.vy *= p.friction;
        g.fillStyle(0xffffff, p.alpha * 0.75);
        g.fillCircle(p.x, p.y, p.size + 1.5);
        g.fillStyle(c, p.alpha);
        g.fillCircle(p.x, p.y, p.size);

      } else if (p.kind === 'chip') {
        p.x += p.vx; p.y += p.vy;
        p.vx *= p.friction; p.vy *= p.friction;
        p.rot += p.rotV;
        const hw = p.w / 2, hh = p.h / 2;
        const cos = Math.cos(p.rot), sin = Math.sin(p.rot);
        const pts = [[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]].map(([lx, ly]) => ({
          x: p.x + lx * cos - ly * sin,
          y: p.y + lx * sin + ly * cos,
        }));
        g.fillStyle(c, p.alpha);
        g.fillPoints(pts, true);
        g.fillStyle(0xffffff, p.alpha * 0.4);
        g.fillPoints(pts, true);
      }
    }
    this.vParticles = alive;
  }

  // ── 状态检测 ──────────────────────────────────────────────

  _checkStateChange() {
    const state = this.logic.state;
    if (state !== this._lastState) {
      this._lastState = state;
      if (state === 'win')  this._showWin();
      if (state === 'fail') this._showFail();
    }
  }

  // ── 渲染 ──────────────────────────────────────────────────

  _render() {
    const g = this.g;
    g.clear();
    this._drawCanvas(g);
    this._drawTrack(g);
    this._drawTurrets(g);
    this._drawBullets(g);
    this._updateParticles(g);
    this._drawBuffer(g);
    this._drawQueues(g);
  }

  _drawCanvas(g) {
    g.fillStyle(C_CANVAS_BG);
    g.fillRect(CANVAS_X, CANVAS_Y, CW, CH);

    g.lineStyle(0.5, C_GRID_LINE, 0.55);
    for (let c = 0; c <= GW; c++) {
      const x = CANVAS_X + c * CELL;
      g.lineBetween(x, CANVAS_Y, x, CANVAS_Y + CH);
    }
    for (let r = 0; r <= GH; r++) {
      const y = CANVAS_Y + r * CELL;
      g.lineBetween(CANVAS_X, y, CANVAS_X + CW, y);
    }

    for (const b of this.logic.blocks) {
      const px = CANVAS_X + b.x * CELL + 1;
      const py = CANVAS_Y + b.y * CELL + 1;
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

    g.lineStyle(1.5, 0x3a3a62, 1);
    g.strokeRect(CANVAS_X, CANVAS_Y, CW, CH);
  }

  _drawTrack(g) {
    const tx = CANVAS_X - TRACK_GAP;
    const ty = CANVAS_Y - TRACK_GAP;
    const tw = CW + TRACK_GAP * 2;
    const th = CH + TRACK_GAP * 2;
    g.lineStyle(4, C_TRACK, 0.9);
    g.strokeRect(tx, ty, tw, th);
    g.lineStyle(1, 0x181838, 0.7);
    g.strokeRect(tx + 4, ty + 4, tw - 8, th - 8);
    const corners = [[tx,ty],[tx+tw,ty],[tx,ty+th],[tx+tw,ty+th]];
    g.fillStyle(0x5555aa, 1);
    for (const [cx, cy] of corners) g.fillCircle(cx, cy, 4);
  }

  _drawTurrets(g) {
    let ti = 0;
    for (const t of this.logic.turrets) {
      const pos = turretScreen(t.pathPos);
      const c   = hex(t.color);
      g.fillStyle(c, 0.28);
      g.fillCircle(pos.x, pos.y, 15);
      g.fillStyle(c, 1);
      g.fillCircle(pos.x, pos.y, 11);
      g.lineStyle(2, 0xffffff, 0.75);
      g.strokeCircle(pos.x, pos.y, 11);
      g.fillStyle(0x000000, 0.5);
      g.fillCircle(pos.x, pos.y, 4);
      if (ti < this.txTurretAmmo.length) {
        const txt = this.txTurretAmmo[ti];
        txt.setPosition(pos.x, pos.y - 20);
        txt.setText(String(t.ammo));
        txt.setVisible(true);
        ti++;
      }
    }
    for (let i = ti; i < this.txTurretAmmo.length; i++)
      this.txTurretAmmo[i].setVisible(false);
  }

  _drawBullets(g) {
    for (const vb of this.vBullets) {
      const c = hex(vb.color);
      g.fillStyle(0xffffff, 0.9);
      g.fillCircle(vb.x, vb.y, 5);
      g.fillStyle(c, 1);
      g.fillCircle(vb.x, vb.y, 3);
    }
  }

  _drawBuffer(g) {
    const used  = this.logic.buffer.length;
    const bgCol = BUFFER_COLORS[Math.min(used, BUFFER_COLORS.length - 1)];
    for (let i = 0; i < BUFFER_CAP; i++) {
      const { x } = this._bufferSlotPos(i);
      const y = BUFFER_Y;
      const t = this.logic.buffer[i];
      const hasTurret = i < used;
      g.fillStyle(hasTurret ? 0x1c1c3a : C_EMPTY_SLOT, 0.9);
      g.fillRoundedRect(x - 22, y - 22, 44, 44, 7);
      g.lineStyle(2, hasTurret ? bgCol : 0x2e2e50, 1);
      g.strokeRoundedRect(x - 22, y - 22, 44, 44, 7);
      const txt = this.txBufferAmmo[i];
      if (hasTurret) {
        g.fillStyle(hex(t.color), 1);
        g.fillCircle(x, y - 6, 10);
        g.lineStyle(1.5, 0xffffff, 0.6);
        g.strokeCircle(x, y - 6, 10);
        txt.setPosition(x, y + 11);
        txt.setText(`×${t.ammo}`);
        txt.setVisible(true);
      } else {
        txt.setVisible(false);
      }
    }
  }

  _drawQueues(g) {
    const numLanes = this.logic.lanes.length;
    let itemIdx = 0, countIdx = 0;
    for (let li = 0; li < numLanes; li++) {
      const cx      = this._laneCenterX(li, numLanes);
      const total   = this.logic.getLaneCount(li);
      const visible = this.logic.getLaneVisible(li);
      const cardW = 70, cardH = 158;
      const active = total > 0;
      g.fillStyle(0x10102a, 0.88);
      g.fillRoundedRect(cx - cardW / 2, QUEUE_Y, cardW, cardH, 10);
      g.lineStyle(1.5, active ? 0x5555cc : 0x222244, 1);
      g.strokeRoundedRect(cx - cardW / 2, QUEUE_Y, cardW, cardH, 10);
      for (let vi = 0; vi < 2; vi++) {
        const def = visible[vi];
        const ty  = QUEUE_Y + 32 + vi * 60;
        const txt = this.txQueueItems[itemIdx++];
        if (def) {
          const c = hex(def.color);
          g.fillStyle(c, 1);
          g.fillCircle(cx, ty, 15);
          g.lineStyle(1.5, 0xffffff, 0.5);
          g.strokeCircle(cx, ty, 15);
          g.fillStyle(0x000000, 0.4);
          g.fillCircle(cx, ty, 5);
          txt.setPosition(cx, ty - 22);
          txt.setText(String(def.ammo));
          txt.setVisible(true);
        } else {
          g.fillStyle(0x252540, 1);
          g.fillCircle(cx, ty, 12);
          g.lineStyle(1, 0x333355, 1);
          g.strokeCircle(cx, ty, 12);
          txt.setVisible(false);
        }
      }
      const countTxt = this.txQueueCounts[countIdx++];
      if (total > 2) {
        countTxt.setPosition(cx, QUEUE_Y + cardH - 16);
        countTxt.setText(`+${total - 2}`);
        countTxt.setVisible(true);
      } else {
        countTxt.setVisible(false);
      }
    }
    for (let i = itemIdx;  i < this.txQueueItems.length;  i++) this.txQueueItems[i].setVisible(false);
    for (let i = countIdx; i < this.txQueueCounts.length; i++) this.txQueueCounts[i].setVisible(false);
  }

  // ── 胜负覆盖 ──────────────────────────────────────────────

  _showWin() {
    this.overlayG.clear();
    this.overlayG.fillStyle(0x001530, 0.65);
    this.overlayG.fillRect(0, 0, VW, VH);
    this.txStatus.setText('✓  通  关！').setColor('#88ffcc').setVisible(true);
    this.txContinue.setText('点击进入下一关 →').setColor('#aaccff').setVisible(true);
  }

  _showFail() {
    this.overlayG.clear();
    this.overlayG.fillStyle(0x1a0000, 0.68);
    this.overlayG.fillRect(0, 0, VW, VH);
    this.txStatus.setText('✗  暂存区溢出！').setColor('#ff6655').setVisible(true);
    this.txContinue.setText('点击重新挑战').setColor('#ffaa88').setVisible(true);
  }

  _hideOverlay() {
    this.overlayG?.clear();
    this.txStatus?.setVisible(false);
    this.txContinue?.setVisible(false);
  }

  // ── 坐标工具 ──────────────────────────────────────────────

  _bufferSlotPos(i) {
    const totalW = BUFFER_CAP * 52;
    const startX = (VW - totalW) / 2 + 26;
    return { x: startX + i * 52, y: BUFFER_Y };
  }

  _laneCenterX(laneIdx, numLanes) {
    const spacing = Math.min(130, (VW - 60) / numLanes);
    const totalW  = spacing * numLanes;
    const startX  = (VW - totalW) / 2 + spacing / 2;
    return startX + laneIdx * spacing;
  }

  // ── 文本池 ────────────────────────────────────────────────

  _createTexts() {
    const style = (size, color = '#ddddff') => ({
      fontSize: `${size}px`, color,
      fontFamily: 'monospace',
      stroke: '#000000', strokeThickness: 3,
    });
    this.txLevel   = this.add.text(VW / 2, 28, '', style(18, '#ffffff')).setOrigin(0.5);
    this.txHint    = this.add.text(VW / 2, 56, '点击队列派出炮台 · 点击暂存区重新部署', style(11, '#666688')).setOrigin(0.5);
    this.txStatus   = this.add.text(VW / 2, VH / 2 - 28, '', style(26)).setOrigin(0.5).setDepth(11).setVisible(false);
    this.txContinue = this.add.text(VW / 2, VH / 2 + 20, '', style(15)).setOrigin(0.5).setDepth(11).setVisible(false);
    this.add.text(VW / 2, BUFFER_Y - 40, '暂 存 区', style(12, '#555588')).setOrigin(0.5);
    this.add.text(VW / 2, QUEUE_Y  - 24, '炮台队列', style(12, '#555588')).setOrigin(0.5);
    for (let i = 0; i < TRACK_CAP;  i++) this.txTurretAmmo .push(this.add.text(0, 0, '', style(10)).setOrigin(0.5).setVisible(false));
    for (let i = 0; i < BUFFER_CAP; i++) this.txBufferAmmo .push(this.add.text(0, 0, '', style(10)).setOrigin(0.5).setVisible(false));
    // 预分配足够数量（最多支持 8 条队列 × 2 = 16 个 item，8 个 count）
    for (let i = 0; i < 16; i++) this.txQueueItems .push(this.add.text(0, 0, '', style(10)).setOrigin(0.5).setVisible(false));
    for (let i = 0; i < 8;  i++) this.txQueueCounts.push(this.add.text(0, 0, '', style(13, '#9999cc')).setOrigin(0.5).setVisible(false));
  }
}
