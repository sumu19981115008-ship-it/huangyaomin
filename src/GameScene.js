import { GameLogic }  from './GameLogic.js';
import { DevTools }   from './dev/DevTools.js';
import {
  G,
  TRACK_CAP, BUFFER_CAP, BULLET_SPEED,
  VW, VH, TRACK_GAP,
  C_BG, C_CANVAS_BG, C_TRACK, C_GRID_LINE, C_EMPTY_SLOT,
  BUFFER_COLORS, TOTAL_LEVELS,
} from './constants.js';

function turretScreen(p) {
  const { LEN_BOTTOM, LEN_RIGHT, LEN_TOP, CANVAS_X, CANVAS_Y, CW, CH } = G;
  const g = TRACK_GAP;
  if (p < LEN_BOTTOM)
    return { x: CANVAS_X + p,                        y: CANVAS_Y + CH + g };
  if (p < LEN_BOTTOM + LEN_RIGHT)
    return { x: CANVAS_X + CW + g,                   y: CANVAS_Y + CH - (p - LEN_BOTTOM) };
  if (p < LEN_BOTTOM + LEN_RIGHT + LEN_TOP)
    return { x: CANVAS_X + CW - (p - LEN_BOTTOM - LEN_RIGHT), y: CANVAS_Y - g };
  return   { x: CANVAS_X - g,                        y: CANVAS_Y + (p - LEN_BOTTOM - LEN_RIGHT - LEN_TOP) };
}

function blockScreen(col, row) {
  const { CANVAS_X, CANVAS_Y, CELL } = G;
  return {
    x: CANVAS_X + col * CELL + CELL / 2,
    y: CANVAS_Y + row * CELL + CELL / 2,
  };
}

function hex(str) {
  return parseInt(str.replace('#', ''), 16);
}

function hexNum(color) {
  if (typeof color === 'number') return color;
  return parseInt(String(color).replace('#', ''), 16);
}

export class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
    this.logic         = null;
    this.vBullets      = [];
    this.vParticles    = [];
    this.levelIndex    = 0;
    this.levels        = [];
    this.g             = null;
    this.overlayG      = null;
    this._lastState    = null;
    this.txLevel       = null;
    this.txHint        = null;
    this.txStatus      = null;
    this.txContinue    = null;
    this.txTurretAmmo  = [];
    this.txBufferAmmo  = [];
    this.txQueueItems  = [];
    this.txQueueCounts = [];
    this.txBufferLabel = null;
    this.txQueueLabel  = null;
    this.devTools      = null;
    // 道具系统
    this._itemCounts         = [3, 3, 3];
    this._itemGfx            = [];
    this._itemTxts           = [];
    this._activeItem         = -1;
    this._item2Paused        = false;
    this._item2QueueOffsetY  = 0;
    this._item3Active        = false;
    this._item3CanvasOffsetY = 0;
    this._item3VignG         = null;
    this._item3SpotG         = null;
    this._item3WheelG        = null;
    this._item3Timer         = null;
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
    this._createItemBar();
    this._loadCurrentLevel();

    this.devTools = new DevTools(this, {
      totalLevels: this.levels.length,
      onJump: (idx) => { this.levelIndex = idx; this._loadCurrentLevel(); },
    });

    this.input.on('pointerdown', (ptr) => this._handleClick(ptr.x, ptr.y));
  }

  update() {
    if (!this.logic || this.logic.state === 'idle') return;

    if (this.logic.state === 'playing' && !this._item2Paused && !this._item3Active) {
      this._spawnNewBullets();
      this._moveBullets();
      this.logic.update();
      this._checkEndgameDeploy();
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
    this._itemCounts = [3, 3, 3];
    this._activeItem = -1;
    this._item2Paused = false;
    this._item2QueueOffsetY = 0;
    this._item3Active = false;
    this._item3CanvasOffsetY = 0;
    this._item3VignG?.destroy();  this._item3VignG  = null;
    this._item3SpotG?.destroy();  this._item3SpotG  = null;
    this._item3WheelG?.destroy(); this._item3WheelG = null;
    this.txLevel.setText(`Level ${this.levelIndex + 1}`);
    this._hideOverlay();
    this._updateItemBar();
    this._updateLabels();
    this._endgameDeployDone = false;
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

    if (this._handleItemClick(px, py)) return;

    const { BUFFER_Y, QUEUE_Y } = G;
    const cap = this.logic.bufferCap;
    for (let i = 0; i < cap; i++) {
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
      const qy = G.QUEUE_Y + (this._item2QueueOffsetY || 0);
      if (Math.abs(px - cx) < 50 && py >= qy - 5 && py <= qy + 165) {
        const deployed = this.logic.deployFromLane(i);
        if (deployed) this._flashFeedback(cx, qy + 60);
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

  // ── 终局自动部署 ───────────────────────────────────────────

  _checkEndgameDeploy() {
    if (!this.logic.endgameStarted) return;
    if (this._endgameDeployDone) return;

    const pendingLane   = this.logic.lanes.reduce((s, l) => s + l.length, 0);
    const pendingBuffer = this.logic.buffer.length;
    if (pendingLane + pendingBuffer === 0) return;

    this._endgameDeployDone = true;
    const SAFE_GAP = 28;

    const cmds = [];
    for (let i = 0; i < this.logic.buffer.length; i++) cmds.push({ type: 'buffer', idx: i });
    for (let li = 0; li < this.logic.lanes.length; li++) {
      for (let j = 0; j < this.logic.lanes[li].length; j++) cmds.push({ type: 'lane', laneIdx: li });
    }

    const tryDeploy = (cmd) => {
      if (this.logic.state !== 'playing') return;
      const blocked = this.logic.turrets.some(t => !t.lapComplete && t.pathPos < SAFE_GAP);
      if (blocked) { this.time.delayedCall(80, () => tryDeploy(cmd)); return; }
      if (cmd.type === 'buffer') this.logic.forceDeployFromBuffer(0);
      else                       this.logic.forceDeployFromLane(cmd.laneIdx);
    };

    cmds.forEach((cmd, i) => this.time.delayedCall(i * 300, () => tryDeploy(cmd)));
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
    const { CELL } = G;
    this.vParticles.push({
      kind: 'ring', x, y, color,
      radius: CELL * 1.2, targetR: CELL * 0.3,
      alpha: 0.9, lineW: 2.5, fade: 0.10,
    });
  }

  _spawnHitFx(x, y, color) {
    const { CELL } = G;
    const s = CELL / 18;
    for (let i = 0; i < 2; i++) {
      this.vParticles.push({
        kind: 'ring', x, y, color,
        radius: i * 4 * s, targetR: CELL * 2.2,
        alpha: 0.85 - i * 0.15, lineW: (3 - i * 0.8) * s,
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
      const speed = (3.5 + Math.random() * 4.5) * s;
      this.vParticles.push({
        kind: 'spark', x, y,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        color, alpha: 1,
        size: (2.5 + Math.random() * 2.5) * s,
        fade: 0.038 + Math.random() * 0.02, friction: 0.84,
      });
    }
    for (let i = 0; i < 6; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (2 + Math.random() * 3) * s;
      this.vParticles.push({
        kind: 'chip',
        x: x + (Math.random() - 0.5) * CELL * 0.6,
        y: y + (Math.random() - 0.5) * CELL * 0.6,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        color, alpha: 1,
        w: (3 + Math.random() * 3) * s, h: (3 + Math.random() * 3) * s,
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
    const { CANVAS_X, CANVAS_Y, CW, CH, GW, GH, CELL } = G;
    const oy = this._item3CanvasOffsetY || 0;
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

    for (const b of this.logic.blocks) {
      const px = CANVAS_X + b.x * CELL + 1;
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

    g.lineStyle(1.5, 0x3a3a62, 1);
    g.strokeRect(CANVAS_X, cy0, CW, CH);
  }

  _drawTrack(g) {
    const { CANVAS_X, CANVAS_Y, CW, CH } = G;
    const oy = this._item3CanvasOffsetY || 0;
    const tx = CANVAS_X - TRACK_GAP;
    const ty = CANVAS_Y - TRACK_GAP + oy;
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
    const cap   = this.logic.bufferCap;
    const bgCol = BUFFER_COLORS[Math.min(used, BUFFER_COLORS.length - 1)];
    const { BUFFER_Y } = G;
    for (let i = 0; i < cap; i++) {
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
    const qy = G.QUEUE_Y + (this._item2QueueOffsetY || 0);
    let itemIdx = 0, countIdx = 0;
    for (let li = 0; li < numLanes; li++) {
      const cx      = this._laneCenterX(li, numLanes);
      const total   = this.logic.getLaneCount(li);
      const visible = this.logic.getLaneVisible(li);
      const cardW = 70, cardH = 158;
      const active = total > 0;
      g.fillStyle(0x10102a, 0.88);
      g.fillRoundedRect(cx - cardW / 2, qy, cardW, cardH, 10);
      g.lineStyle(1.5, active ? 0x5555cc : 0x222244, 1);
      g.strokeRoundedRect(cx - cardW / 2, qy, cardW, cardH, 10);
      for (let vi = 0; vi < 2; vi++) {
        const def = visible[vi];
        const ty  = qy + 32 + vi * 60;
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
        countTxt.setPosition(cx, qy + cardH - 16);
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

  // ── 道具系统 ──────────────────────────────────────────────

  _itemX(i)    { return VW / 2 - 80 + i * 80; }
  _itemBarY()  { return G.ITEM_BAR_Y; }
  _laneCX(li, nl) { return this._laneCenterX(li, nl); }
  _bufSlotX(i) { return this._bufferSlotPos(i).x; }
  _flash(x, y) { this._flashFeedback(x, y); }

  _createItemBar() {
    const labels = ['＋槽', '取车', '清色'];
    for (let i = 0; i < 3; i++) {
      const g = this.add.graphics().setDepth(8);
      this._itemGfx.push(g);
      const tx = this.add.text(this._itemX(i), 0, `${labels[i]}\n×${this._itemCounts[i]}`, {
        fontSize: '11px', fontFamily: 'monospace', color: '#ffffff',
        align: 'center', stroke: '#000000', strokeThickness: 3,
      }).setOrigin(0.5, 0).setDepth(9);
      this._itemTxts.push(tx);
    }
  }

  _updateItemBar() {
    const labels = ['＋槽', '取车', '清色'];
    const colors = [0xffcc00, 0x44ddff, 0xcc44ff];
    const y      = this._itemBarY();
    for (let i = 0; i < 3; i++) {
      const ig       = this._itemGfx[i];
      ig.clear();
      const cx       = this._itemX(i), r = 26;
      const isActive = this._activeItem === i;
      const hasCount = this._itemCounts[i] > 0;
      const col      = colors[i];
      if (isActive) {
        ig.fillStyle(col, 0.25); ig.fillCircle(cx, y, r + 8);
        ig.lineStyle(2, col, 0.9); ig.strokeCircle(cx, y, r + 8);
      }
      ig.fillStyle(hasCount ? 0x111128 : 0x1a1a1a, 1);
      ig.fillCircle(cx, y, r);
      ig.lineStyle(isActive ? 3 : 1.5, hasCount ? col : 0x444444, isActive ? 1 : 0.6);
      ig.strokeCircle(cx, y, r);
      if (i === 0) {
        ig.lineStyle(2, hasCount ? col : 0x555555, 1);
        ig.strokeRect(cx - 10, y - 10, 20, 20);
        ig.lineStyle(2.5, hasCount ? 0xffffff : 0x555555, 1);
        ig.lineBetween(cx, y - 6, cx, y + 6);
        ig.lineBetween(cx - 6, y, cx + 6, y);
      } else if (i === 1) {
        ig.fillStyle(hasCount ? col : 0x555555, 1);
        ig.fillRoundedRect(cx - 12, y - 6, 24, 12, 3);
        ig.fillStyle(0x000000, 0.5);
        ig.fillCircle(cx - 7, y + 7, 5);
        ig.fillCircle(cx + 7, y + 7, 5);
        ig.lineStyle(1.5, hasCount ? 0xffffff : 0x555555, 0.8);
        ig.strokeCircle(cx - 7, y + 7, 5);
        ig.strokeCircle(cx + 7, y + 7, 5);
      } else {
        ig.fillStyle(hasCount ? col : 0x555555, 1);
        ig.fillCircle(cx, y, 10);
        ig.lineStyle(2, hasCount ? 0xffffff : 0x555555, 0.8);
        for (let a = 0; a < 4; a++) {
          const angle = (a / 4) * Math.PI * 2 - Math.PI / 4;
          ig.lineBetween(cx + Math.cos(angle) * 5, y + Math.sin(angle) * 5,
                         cx + Math.cos(angle) * 14, y + Math.sin(angle) * 14);
        }
      }
      this._itemTxts[i].setPosition(cx, y + r + 4)
        .setText(`${labels[i]}\n×${this._itemCounts[i]}`)
        .setColor(hasCount ? '#ffffff' : '#444466');
    }
  }

  _handleItemClick(px, py) {
    if (this.logic.state !== 'playing') return false;
    const y = this._itemBarY();
    for (let i = 0; i < 3; i++) {
      const cx = this._itemX(i);
      if (Math.hypot(px - cx, py - y) < 30) {
        if (this._itemCounts[i] <= 0) return true;
        if (this._activeItem === i) {
          this._deactivateItem();
        } else {
          this._deactivateItem();
          this._activeItem = i;
          if (i === 0)      this._useItem1();
          else if (i === 1) this._activateItem2();
          else if (i === 2) this._activateItem3();
        }
        return true;
      }
    }
    if (this._item2Paused) return this._item2HandleClick(px, py);
    if (this._item3Active) return this._item3HandleClick(px, py);
    return false;
  }

  _deactivateItem() {
    if (this._activeItem === 1 && this._item2Paused) this._cancelItem2();
    if (this._activeItem === 2 && this._item3Active) this._cancelItem3();
    this._activeItem = -1;
    this._updateItemBar();
  }

  _resetItems() {
    if (this._item2Paused) this._cancelItem2();
    if (this._item3Active) this._cancelItem3();
    this._itemCounts = [3, 3, 3];
    this._activeItem = -1;
    this._updateItemBar();
  }

  // 道具一：增加暂存槽
  _useItem1() {
    this._itemCounts[0]--;
    this._activeItem = -1;
    const maxCap = BUFFER_CAP + 3;
    if (this.logic.bufferCap >= maxCap) { this._updateItemBar(); return; }
    this.logic.bufferCap++;
    this.logic._checkEndgame();
    const sx = this._itemX(0), sy = this._itemBarY();
    const tx = this._bufSlotX(this.logic.bufferCap - 1), ty = G.BUFFER_Y;
    this._spawnGoldBeam(sx, sy, tx, ty);
    this._updateItemBar();
  }

  _spawnGoldBeam(sx, sy, tx, ty) {
    const pg = this.add.graphics().setDepth(20);
    const particles = Array.from({ length: 6 }, (_, i) => ({ t: i / 6 }));
    let progress = 0;
    const timer = this.time.addEvent({ delay: 16, loop: true, callback: () => {
      progress = Math.min(1, progress + 0.045);
      pg.clear();
      for (const p of particles) {
        const pt = (progress + p.t) % 1;
        const cx = sx + (tx - sx) * pt;
        const cy = sy + (ty - sy) * pt - Math.sin(pt * Math.PI) * 60;
        const alpha = pt < 0.1 ? pt * 10 : pt > 0.9 ? (1 - pt) * 10 : 1;
        pg.fillStyle(0xffdd44, alpha); pg.fillCircle(cx, cy, 5 * (1 - pt * 0.5));
        pg.fillStyle(0xffffff, alpha * 0.7); pg.fillCircle(cx, cy, 2);
      }
      if (progress >= 1) { timer.remove(); pg.destroy(); this._flash(tx, ty); }
    }});
  }

  // 道具二：从队列取一辆车直接上轨道
  _activateItem2() {
    this._item2Paused = true;
    this.tweens.add({
      targets: this, _item2QueueOffsetY: -80,
      duration: 300, ease: 'Back.easeOut',
    });
    this._updateItemBar();
  }

  _item2HandleClick(px, py) {
    const nl   = this.logic.lanes.length;
    const QUEUE_Y = G.QUEUE_Y + this._item2QueueOffsetY;
    const qHW  = Math.min(50, (VW - 60) / nl * 0.5);
    for (let li = 0; li < nl; li++) {
      const cx = this._laneCX(li, nl);
      if (Math.abs(px - cx) < qHW && py >= QUEUE_Y - 10 && py <= QUEUE_Y + 180) {
        const lane = this.logic.lanes[li];
        if (!lane || lane.length === 0) return true;
        const relY    = py - QUEUE_Y;
        const slotIdx = Math.floor(relY / 60);
        const tIdx    = Math.max(0, Math.min(slotIdx, lane.length - 1));
        this._item2ConfirmRemove(li, tIdx);
        return true;
      }
    }
    return false;
  }

  _item2ConfirmRemove(laneIdx, turretIdx) {
    const lane = this.logic.lanes[laneIdx];
    if (!lane || turretIdx >= lane.length) return;
    const def = { color: lane[turretIdx].color, ammo: lane[turretIdx].ammo };
    this._itemCounts[1]--;
    this._activeItem = -1;
    this.logic.forceDeployFromLaneAt(laneIdx, turretIdx);
    const cx = this._laneCX(laneIdx, this.logic.lanes.length);
    const fy = G.QUEUE_Y + this._item2QueueOffsetY + 32 + turretIdx * 60;
    this._spawnTurretFlyIn(cx, fy, def.color);
    this._cancelItem2();
  }

  _spawnTurretFlyIn(sx, sy, color) {
    const { CANVAS_X, CANVAS_Y, CH } = G;
    const tx = CANVAS_X, ty = CANVAS_Y + CH + TRACK_GAP;
    const pg  = this.add.graphics().setDepth(20);
    const col = hexNum(color);
    const trailPoints = [];
    let progress = 0;
    const timer = this.time.addEvent({ delay: 16, loop: true, callback: () => {
      progress = Math.min(1, progress + 0.035);
      const cx = sx + (tx - sx) * progress;
      const cy = sy + (ty - sy) * progress - Math.sin(progress * Math.PI) * 80;
      trailPoints.push({ x: cx, y: cy, a: 1 });
      pg.clear();
      for (let i = trailPoints.length - 1; i >= 0; i--) {
        const tp = trailPoints[i];
        tp.a -= 0.06;
        if (tp.a <= 0) { trailPoints.splice(i, 1); continue; }
        pg.fillStyle(col, tp.a * 0.6); pg.fillCircle(tp.x, tp.y, 4 * tp.a);
      }
      pg.fillStyle(0xffffff, 0.55); pg.fillCircle(cx, cy, 14);
      pg.fillStyle(col, 1);         pg.fillCircle(cx, cy, 10);
      pg.lineStyle(2, 0xffffff, 0.9); pg.strokeCircle(cx, cy, 10);
      pg.fillStyle(0x000000, 0.5);  pg.fillCircle(cx, cy, 4);
      if (progress >= 1) { timer.remove(); pg.destroy(); this._flash(tx, ty); }
    }});
  }

  _cancelItem2() {
    this._item2Paused = false;
    this.tweens.add({
      targets: this, _item2QueueOffsetY: 0,
      duration: 220, ease: 'Quad.easeOut',
    });
    this._updateItemBar();
  }

  // 道具三：清除一种颜色的所有方块
  _activateItem3() {
    this._item3Active = true;
    if (!this._item3VignG) this._item3VignG = this.add.graphics().setDepth(18);
    if (!this._item3SpotG) this._item3SpotG = this.add.graphics().setDepth(19);
    this._drawVignette();
    this.tweens.add({
      targets: this, _item3CanvasOffsetY: 30,
      duration: 350, ease: 'Back.easeOut',
      onUpdate: () => this._updateItem3Spotlight(),
    });
    this._updateItem3Spotlight();
    this._updateItemBar();
  }

  _drawVignette() {
    const g = this._item3VignG;
    g.clear();
    const steps = 12;
    for (let i = 0; i < steps; i++) {
      const t      = i / steps;
      const margin = t * 180;
      const alpha  = (1 - t) * 0.55;
      g.fillStyle(0x000000, alpha);
      g.fillRect(0, 0, margin, VH);
      g.fillRect(VW - margin, 0, margin, VH);
      g.fillRect(0, 0, VW, margin * 0.6);
      g.fillRect(0, VH - margin * 0.6, VW, margin * 0.6);
    }
  }

  _updateItem3Spotlight() {
    if (!this._item3SpotG) return;
    const g = this._item3SpotG;
    g.clear();
    const colorCount = {};
    for (const b of this.logic.blocks) colorCount[b.color] = (colorCount[b.color] || 0) + 1;
    let bestColor = null, bestCount = 0;
    for (const [c, n] of Object.entries(colorCount)) {
      if (n > bestCount) { bestColor = c; bestCount = n; }
    }
    if (!bestColor) return;
    const cells = this.logic.blocks.filter(b => b.color === bestColor);
    const { CANVAS_X, CANVAS_Y, CELL } = G;
    const offY = CANVAS_Y + this._item3CanvasOffsetY;
    let mx = 0, my = 0;
    for (const b of cells) { mx += CANVAS_X + b.x * CELL + CELL / 2; my += offY + b.y * CELL + CELL / 2; }
    mx /= cells.length; my /= cells.length;
    g.fillStyle(0xffffff, 0.06); g.fillCircle(mx, my, 120);
    g.fillStyle(0xffffff, 0.08); g.fillCircle(mx, my, 80);
    g.fillStyle(0xffffff, 0.10); g.fillCircle(mx, my, 50);
    g.lineStyle(2, 0xffffff, 0.5); g.strokeCircle(mx, my, 50);
    g.fillStyle(0xffffff, 0.9); g.fillCircle(mx, my - 48, 3);
  }

  _item3HandleClick(px, py) {
    const { CANVAS_X, CANVAS_Y, CW, CH, CELL, GW, GH } = G;
    const offY = CANVAS_Y + this._item3CanvasOffsetY;
    if (px < CANVAS_X || px > CANVAS_X + CW || py < offY || py > offY + CH) return false;
    const col = Math.floor((px - CANVAS_X) / CELL);
    const row = Math.floor((py - offY) / CELL);
    if (col < 0 || col >= GW || row < 0 || row >= GH) return false;
    const block = this.logic.blocks.find(b => b.x === col && b.y === row);
    if (!block) return false;
    const targetColor = block.color;
    this._itemCounts[2]--;
    this._activeItem = -1;
    this._item3ClearColor(targetColor);
    return true;
  }

  _item3ClearColor(color) {
    const targets = this.logic.blocks.filter(b => b.color === color);
    if (targets.length === 0) { this._cancelItem3(); return; }
    const rows = {};
    for (const b of targets) { if (!rows[b.y]) rows[b.y] = []; rows[b.y].push(b); }
    const sortedRows = Object.keys(rows).map(Number).sort((a, b) => b - a);
    if (!this._item3WheelG) this._item3WheelG = this.add.graphics().setDepth(21);
    const wheelG = this._item3WheelG;
    const { CANVAS_X, CANVAS_Y, CELL } = G;
    const offY = CANVAS_Y + this._item3CanvasOffsetY;
    const wheelTargetY = offY + G.CH + 30;
    let wheelY       = VH + 60;
    let wheelProgress = 0;
    let phase        = 'fly_in';
    let rowIdx       = 0;
    let rowTimer     = 0;
    const col        = hexNum(color);

    const tick = this.time.addEvent({ delay: 16, loop: true, callback: () => {
      wheelG.clear();
      if (phase === 'fly_in') {
        wheelProgress = Math.min(1, wheelProgress + 0.06);
        wheelY = VH + 60 + (wheelTargetY - VH - 60) * this._easeOut(wheelProgress);
        this._drawWheelAt(wheelG, VW / 2, wheelY, col);
        if (wheelProgress >= 1) { phase = 'collect'; rowIdx = 0; rowTimer = 0; }
      } else if (phase === 'collect') {
        rowTimer++;
        if (rowTimer >= 10 && rowIdx < sortedRows.length) {
          const r = sortedRows[rowIdx];
          for (const b of rows[r]) {
            this.logic.grid[b.y][b.x] = null;
            const idx = this.logic.blocks.indexOf(b);
            if (idx !== -1) this.logic.blocks.splice(idx, 1);
            const bx = CANVAS_X + b.x * CELL + CELL / 2;
            const by = offY + b.y * CELL + CELL / 2;
            this._flash(bx, by);
          }
          rowIdx++; rowTimer = 0;
        }
        this._drawWheelAt(wheelG, VW / 2, wheelY, col);
        if (rowIdx >= sortedRows.length) {
          // 同色炮台、暂存区、队列一并清除
          this.logic.turrets = this.logic.turrets.filter(t => t.color !== color);
          this.logic.buffer  = this.logic.buffer.filter(t => t.color !== color);
          for (const lane of this.logic.lanes) {
            const filtered = lane.filter(t => t.color !== color);
            lane.length = 0; filtered.forEach(t => lane.push(t));
          }
          this.vBullets = this.vBullets.filter(b => b.color !== color);
          this.logic._checkEndgame();
          this.time.delayedCall(300, () => { phase = 'fly_out'; wheelProgress = 0; });
        }
      } else if (phase === 'fly_out') {
        wheelProgress = Math.min(1, wheelProgress + 0.05);
        wheelY = wheelTargetY + (CANVAS_Y - 80 - wheelTargetY) * this._easeIn(wheelProgress);
        this._drawWheelAt(wheelG, VW / 2, wheelY, col);
        if (wheelProgress >= 1) {
          tick.remove(); wheelG.clear();
          this.tweens.add({ targets: this, _item3CanvasOffsetY: 0, duration: 300, ease: 'Quad.easeOut' });
          this._cancelItem3();
          if (this.logic.blocks.length === 0) this.logic.state = 'win';
        }
      }
    }});
  }

  _drawWheelAt(g, cx, cy, colorNum) {
    const r = 28;
    g.fillStyle(0x111122, 1); g.fillCircle(cx, cy, r);
    g.lineStyle(3, colorNum, 1); g.strokeCircle(cx, cy, r);
    g.lineStyle(3, colorNum, 0.6); g.strokeCircle(cx, cy, r - 8);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.lineStyle(2, colorNum, 0.8);
      g.lineBetween(cx + Math.cos(a) * 6, cy + Math.sin(a) * 6,
                    cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2));
    }
    g.fillStyle(colorNum, 1); g.fillCircle(cx, cy, 8);
    g.fillStyle(0xffffff, 0.8); g.fillCircle(cx - 3, cy - 3, 3);
  }

  _easeOut(t) { return 1 - (1 - t) * (1 - t); }
  _easeIn(t)  { return t * t; }

  _cancelItem3() {
    this._item3Active = false;
    this._item3Timer?.remove();
    this._item3VignG?.destroy();  this._item3VignG  = null;
    this._item3SpotG?.destroy();  this._item3SpotG  = null;
    this._item3WheelG?.destroy(); this._item3WheelG = null;
    this._activeItem = -1;
    this._updateItemBar();
  }

  // ── 坐标工具 ──────────────────────────────────────────────

  _bufferSlotPos(i) {
    const cap    = this.logic.bufferCap;
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

  // ── 文本池 ────────────────────────────────────────────────

  _createTexts() {
    const style = (size, color = '#ddddff') => ({
      fontSize: `${size}px`, color,
      fontFamily: 'monospace',
      stroke: '#000000', strokeThickness: 3,
    });
    this.txLevel    = this.add.text(VW / 2, 28, '', style(18, '#ffffff')).setOrigin(0.5);
    this.txHint     = this.add.text(VW / 2, 56, '点击队列派出炮台 · 点击暂存区重新部署', style(11, '#666688')).setOrigin(0.5);
    this.txStatus   = this.add.text(VW / 2, VH / 2 - 28, '', style(26)).setOrigin(0.5).setDepth(11).setVisible(false);
    this.txContinue = this.add.text(VW / 2, VH / 2 + 20, '', style(15)).setOrigin(0.5).setDepth(11).setVisible(false);

    // 暂存区/队列标签（动态 Y 由 _updateLabels 更新）
    this.txBufferLabel = this.add.text(VW / 2, 0, '暂 存 区', style(12, '#555588')).setOrigin(0.5);
    this.txQueueLabel  = this.add.text(VW / 2, 0, '炮台队列', style(12, '#555588')).setOrigin(0.5);

    for (let i = 0; i < TRACK_CAP + 3; i++) this.txTurretAmmo .push(this.add.text(0, 0, '', style(10)).setOrigin(0.5).setVisible(false).setDepth(6));
    for (let i = 0; i < BUFFER_CAP + 3; i++) this.txBufferAmmo .push(this.add.text(0, 0, '', style(10)).setOrigin(0.5).setVisible(false).setDepth(6));
    for (let i = 0; i < 16; i++) this.txQueueItems .push(this.add.text(0, 0, '', style(10)).setOrigin(0.5).setVisible(false).setDepth(6));
    for (let i = 0; i < 8;  i++) this.txQueueCounts.push(this.add.text(0, 0, '', style(13, '#9999cc')).setOrigin(0.5).setVisible(false).setDepth(6));
  }

  // 每关 loadLevel 后更新标签位置（布局可能变化）
  _updateLabels() {
    this.txBufferLabel?.setPosition(VW / 2, G.BUFFER_Y - 40);
    this.txQueueLabel?.setPosition(VW / 2, G.QUEUE_Y  - 24);
  }
}
