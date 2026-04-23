import { G, BUFFER_CAP, VW } from './constants.js';
import { hexNum } from './renderer.js';

export class ItemSystem {
  constructor(scene) {
    this.scene = scene;

    // 道具次数
    this.counts = [3, 3, 3];

    // 当前激活的道具索引（-1 = 无）
    this.activeItem = -1;

    // 道具二状态
    this.item2Paused  = false;
    this.queueOffsetY = 0;

    // 道具三状态
    this.item3Active    = false;
    this.canvasOffsetY  = 0;
    this._vignG         = null;
    this._spotG         = null;
    this._wheelG        = null;
    this._item3Timer    = null;

    // Phaser 图形/文本对象（create 后初始化）
    this._itemGfx  = [];
    this._itemTxts = [];
  }

  // ── 初始化（GameScene.create 调用）──────────────────────────

  create() {
    const labels = ['＋槽', '取车', '清色'];
    for (let i = 0; i < 3; i++) {
      const g = this.scene.add.graphics().setDepth(8);
      this._itemGfx.push(g);
      const tx = this.scene.add.text(this._itemX(i), 0, `${labels[i]}\n×${this.counts[i]}`, {
        fontSize: '11px', fontFamily: 'monospace', color: '#ffffff',
        align: 'center', stroke: '#000000', strokeThickness: 3,
      }).setOrigin(0.5, 0).setDepth(9);
      this._itemTxts.push(tx);
    }
  }

  // ── 关卡重置 ─────────────────────────────────────────────────

  reset() {
    if (this.item2Paused) this._cancelItem2();
    if (this.item3Active) this._cancelItem3();
    this.counts      = [3, 3, 3];
    this.activeItem  = -1;
    this.queueOffsetY   = 0;
    this.canvasOffsetY  = 0;
    this.updateBar();
  }

  // ── 点击分发 ─────────────────────────────────────────────────

  handleClick(px, py) {
    if (this.scene.logic.state !== 'playing') return false;
    const y = G.ITEM_BAR_Y;

    for (let i = 0; i < 3; i++) {
      const cx = this._itemX(i);
      if (Math.hypot(px - cx, py - y) < 30) {
        if (this.counts[i] <= 0) return true;
        if (this.activeItem === i) {
          this._deactivate();
        } else {
          this._deactivate();
          this.activeItem = i;
          if (i === 0)      this._useItem1();
          else if (i === 1) this._activateItem2();
          else if (i === 2) this._activateItem3();
        }
        return true;
      }
    }

    if (this.item2Paused) return this._item2HandleClick(px, py);
    if (this.item3Active) return this._item3HandleClick(px, py);
    return false;
  }

  // ── 道具一：增加暂存槽 ───────────────────────────────────────

  _useItem1() {
    this.counts[0]--;
    this.activeItem = -1;
    const maxCap = BUFFER_CAP + 3;
    if (this.scene.logic.bufferCap >= maxCap) { this.updateBar(); return; }
    this.scene.logic.bufferCap++;
    this.scene.logic._checkEndgame();
    const sx = this._itemX(0), sy = G.ITEM_BAR_Y;
    const tx = this._bufSlotX(this.scene.logic.bufferCap - 1), ty = G.BUFFER_Y;
    this._spawnGoldBeam(sx, sy, tx, ty);
    this.updateBar();
  }

  _spawnGoldBeam(sx, sy, tx, ty) {
    const pg = this.scene.add.graphics().setDepth(20);
    const particles = Array.from({ length: 6 }, (_, i) => ({ t: i / 6 }));
    let progress = 0;
    const timer = this.scene.time.addEvent({ delay: 16, loop: true, callback: () => {
      progress = Math.min(1, progress + 0.045);
      pg.clear();
      for (const p of particles) {
        const pt    = (progress + p.t) % 1;
        const cx    = sx + (tx - sx) * pt;
        const cy    = sy + (ty - sy) * pt - Math.sin(pt * Math.PI) * 60;
        const alpha = pt < 0.1 ? pt * 10 : pt > 0.9 ? (1 - pt) * 10 : 1;
        pg.fillStyle(0xffdd44, alpha); pg.fillCircle(cx, cy, 5 * (1 - pt * 0.5));
        pg.fillStyle(0xffffff, alpha * 0.7); pg.fillCircle(cx, cy, 2);
      }
      if (progress >= 1) {
        timer.remove(); pg.destroy();
        this.scene.bullets.spawnFlash(tx, ty);
      }
    }});
  }

  // ── 道具二：从队列取车 ───────────────────────────────────────

  _activateItem2() {
    this.item2Paused = true;
    this.scene.tweens.add({
      targets: this, queueOffsetY: -80,
      duration: 300, ease: 'Back.easeOut',
    });
    this.updateBar();
  }

  _item2HandleClick(px, py) {
    const nl      = this.scene.logic.lanes.length;
    const QUEUE_Y = G.QUEUE_Y + this.queueOffsetY;
    const qHW     = Math.min(50, (VW - 60) / nl * 0.5);
    for (let li = 0; li < nl; li++) {
      const cx = this._laneCX(li, nl);
      if (Math.abs(px - cx) < qHW && py >= QUEUE_Y - 10 && py <= QUEUE_Y + 180) {
        const lane = this.scene.logic.lanes[li];
        if (!lane || lane.length === 0) return true;
        const slotIdx = Math.floor((py - QUEUE_Y) / 60);
        const tIdx    = Math.max(0, Math.min(slotIdx, lane.length - 1));
        this._item2Confirm(li, tIdx);
        return true;
      }
    }
    return false;
  }

  _item2Confirm(laneIdx, turretIdx) {
    const lane = this.scene.logic.lanes[laneIdx];
    if (!lane || turretIdx >= lane.length) return;
    const def = { color: lane[turretIdx].color, ammo: lane[turretIdx].ammo };
    this.counts[1]--;
    this.activeItem = -1;
    this.scene.logic.forceDeployFromLaneAt(laneIdx, turretIdx);
    const cx = this._laneCX(laneIdx, this.scene.logic.lanes.length);
    const fy = G.QUEUE_Y + this.queueOffsetY + 32 + turretIdx * 60;
    this._spawnTurretFlyIn(cx, fy, def.color);
    this._cancelItem2();
  }

  _spawnTurretFlyIn(sx, sy, color) {
    const { CANVAS_X, CANVAS_Y, CH } = G;
    const tx  = CANVAS_X, ty = CANVAS_Y + CH + 22;
    const pg  = this.scene.add.graphics().setDepth(20);
    const col = hexNum(color);
    const trailPoints = [];
    let progress = 0;
    const timer = this.scene.time.addEvent({ delay: 16, loop: true, callback: () => {
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
      if (progress >= 1) {
        timer.remove(); pg.destroy();
        this.scene.bullets.spawnFlash(tx, ty);
      }
    }});
  }

  _cancelItem2() {
    this.item2Paused = false;
    this.scene.tweens.add({
      targets: this, queueOffsetY: 0,
      duration: 220, ease: 'Quad.easeOut',
    });
    this.updateBar();
  }

  // ── 道具三：清除一色 ─────────────────────────────────────────

  _activateItem3() {
    this.item3Active = true;
    if (!this._vignG) this._vignG = this.scene.add.graphics().setDepth(18);
    if (!this._spotG) this._spotG = this.scene.add.graphics().setDepth(19);
    this._drawVignette();
    this.scene.tweens.add({
      targets: this, canvasOffsetY: 30,
      duration: 350, ease: 'Back.easeOut',
      onUpdate: () => this._updateSpotlight(),
    });
    this._updateSpotlight();
    this.updateBar();
  }

  _drawVignette() {
    const g = this._vignG;
    g.clear();
    const { VW, VH } = { VW: 480, VH: 920 };
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

  _updateSpotlight() {
    if (!this._spotG) return;
    const g = this._spotG;
    g.clear();
    const colorCount = {};
    for (const b of this.scene.logic.blocks)
      colorCount[b.color] = (colorCount[b.color] || 0) + 1;
    let bestColor = null, bestCount = 0;
    for (const [c, n] of Object.entries(colorCount))
      if (n > bestCount) { bestColor = c; bestCount = n; }
    if (!bestColor) return;
    const cells = this.scene.logic.blocks.filter(b => b.color === bestColor);
    const { CANVAS_X, CANVAS_Y, CELL } = G;
    const offY = CANVAS_Y + this.canvasOffsetY;
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
    const offY = CANVAS_Y + this.canvasOffsetY;
    if (px < CANVAS_X || px > CANVAS_X + CW || py < offY || py > offY + CH) return false;
    const col   = Math.floor((px - CANVAS_X) / CELL);
    const row   = Math.floor((py - offY) / CELL);
    if (col < 0 || col >= GW || row < 0 || row >= GH) return false;
    const block = this.scene.logic.blocks.find(b => b.x === col && b.y === row);
    if (!block) return false;
    this.counts[2]--;
    this.activeItem = -1;
    this._clearColor(block.color);
    return true;
  }

  _clearColor(color) {
    const logic   = this.scene.logic;
    const targets = logic.blocks.filter(b => b.color === color);
    if (targets.length === 0) { this._cancelItem3(); return; }

    // 按行分组，用于逐行动画
    const rows = {};
    for (const b of targets) { if (!rows[b.y]) rows[b.y] = []; rows[b.y].push(b); }
    const sortedRows = Object.keys(rows).map(Number).sort((a, b) => b - a);

    if (!this._wheelG) this._wheelG = this.scene.add.graphics().setDepth(21);
    const wheelG = this._wheelG;
    const { CANVAS_X, CANVAS_Y, CELL } = G;
    const offY         = CANVAS_Y + this.canvasOffsetY;
    const wheelTargetY = offY + G.CH + 30;
    let wheelY        = 920 + 60;
    let wheelProgress = 0;
    let phase         = 'fly_in';
    let rowIdx        = 0;
    let rowTimer      = 0;
    const col         = hexNum(color);

    // 预先按行记录坐标（供动画用），逻辑清除交给 logic.clearColor()
    const rowCoords = {};
    for (const b of targets) {
      if (!rowCoords[b.y]) rowCoords[b.y] = [];
      rowCoords[b.y].push({ x: b.x, y: b.y });
    }

    const tick = this.scene.time.addEvent({ delay: 16, loop: true, callback: () => {
      wheelG.clear();
      if (phase === 'fly_in') {
        wheelProgress = Math.min(1, wheelProgress + 0.06);
        wheelY = 920 + 60 + (wheelTargetY - 920 - 60) * this._easeOut(wheelProgress);
        this._drawWheel(wheelG, 480 / 2, wheelY, col);
        if (wheelProgress >= 1) { phase = 'collect'; rowIdx = 0; rowTimer = 0; }

      } else if (phase === 'collect') {
        rowTimer++;
        if (rowTimer >= 10 && rowIdx < sortedRows.length) {
          const r = sortedRows[rowIdx];
          for (const b of rowCoords[r] ?? []) {
            const bx = CANVAS_X + b.x * CELL + CELL / 2;
            const by = offY + b.y * CELL + CELL / 2;
            this.scene.bullets.spawnFlash(bx, by);
          }
          rowIdx++; rowTimer = 0;
        }
        this._drawWheel(wheelG, 480 / 2, wheelY, col);
        if (rowIdx >= sortedRows.length) {
          // 逻辑层统一清除：grid / blocks / turrets / buffer / lanes / inFlightTargets
          logic.clearColor(color);
          // 渲染层清掉飞行中同色子弹（视觉对齐，不影响逻辑）
          this.scene.bullets.vBullets = this.scene.bullets.vBullets.filter(b => b.color !== color);
          this.scene.time.delayedCall(300, () => { phase = 'fly_out'; wheelProgress = 0; });
        }

      } else if (phase === 'fly_out') {
        wheelProgress = Math.min(1, wheelProgress + 0.05);
        wheelY = wheelTargetY + (CANVAS_Y - 80 - wheelTargetY) * this._easeIn(wheelProgress);
        this._drawWheel(wheelG, 480 / 2, wheelY, col);
        if (wheelProgress >= 1) {
          tick.remove(); wheelG.clear();
          this.scene.tweens.add({
            targets: this, canvasOffsetY: 0,
            duration: 300, ease: 'Quad.easeOut',
          });
          this._cancelItem3();
          // 胜负由 GameLogic._checkEndgame() / onBulletHit() 负责，此处不再直接写 state
        }
      }
    }});
  }

  _drawWheel(g, cx, cy, colorNum) {
    const r = 28;
    g.fillStyle(0x111122, 1);      g.fillCircle(cx, cy, r);
    g.lineStyle(3, colorNum, 1);   g.strokeCircle(cx, cy, r);
    g.lineStyle(3, colorNum, 0.6); g.strokeCircle(cx, cy, r - 8);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.lineStyle(2, colorNum, 0.8);
      g.lineBetween(cx + Math.cos(a) * 6,     cy + Math.sin(a) * 6,
                    cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2));
    }
    g.fillStyle(colorNum, 1);     g.fillCircle(cx, cy, 8);
    g.fillStyle(0xffffff, 0.8);   g.fillCircle(cx - 3, cy - 3, 3);
  }

  _cancelItem3() {
    this.item3Active = false;
    this._item3Timer?.remove();
    this._vignG?.destroy();  this._vignG  = null;
    this._spotG?.destroy();  this._spotG  = null;
    this._wheelG?.destroy(); this._wheelG = null;
    this.activeItem = -1;
    this.updateBar();
  }

  // ── 共用 ─────────────────────────────────────────────────────

  _deactivate() {
    if (this.activeItem === 1 && this.item2Paused) this._cancelItem2();
    if (this.activeItem === 2 && this.item3Active) this._cancelItem3();
    this.activeItem = -1;
    this.updateBar();
  }

  updateBar() {
    const labels = ['＋槽', '取车', '清色'];
    const colors = [0xffcc00, 0x44ddff, 0xcc44ff];
    const y      = G.ITEM_BAR_Y;
    for (let i = 0; i < 3; i++) {
      const ig       = this._itemGfx[i];
      ig.clear();
      const cx       = this._itemX(i), r = 26;
      const isActive = this.activeItem === i;
      const hasCount = this.counts[i] > 0;
      const col      = colors[i];
      if (isActive) {
        ig.fillStyle(col, 0.25); ig.fillCircle(cx, y, r + 8);
        ig.lineStyle(2, col, 0.9); ig.strokeCircle(cx, y, r + 8);
      }
      ig.fillStyle(hasCount ? 0x111128 : 0x1a1a1a, 1); ig.fillCircle(cx, y, r);
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
          ig.lineBetween(cx + Math.cos(angle) * 5,  y + Math.sin(angle) * 5,
                         cx + Math.cos(angle) * 14, y + Math.sin(angle) * 14);
        }
      }
      this._itemTxts[i]
        .setPosition(cx, y + r + 4)
        .setText(`${labels[i]}\n×${this.counts[i]}`)
        .setColor(hasCount ? '#ffffff' : '#444466');
    }
  }

  _easeOut(t) { return 1 - (1 - t) * (1 - t); }
  _easeIn(t)  { return t * t; }

  _itemX(i)      { return 480 / 2 - 80 + i * 80; }
  _bufSlotX(i)   {
    const cap    = this.scene.logic.bufferCap;
    const totalW = cap * 52;
    const startX = (480 - totalW) / 2 + 26;
    return startX + i * 52;
  }
  _laneCX(li, nl) {
    const spacing = Math.min(130, (480 - 60) / nl);
    const totalW  = spacing * nl;
    const startX  = (480 - totalW) / 2 + spacing / 2;
    return startX + li * spacing;
  }
}
