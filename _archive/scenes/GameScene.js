import {
  GW, GH, CELL, VIEW_W, VIEW_H,
  BOARD_OFFSET_X, BOARD_OFFSET_Y,
  BULLET_SPEED, SIDE, SIDE_LEN,
} from '../constants.js';
import { GameLogic }        from '../GameLogic.js';
import { EquipmentSystem }  from '../systems/EquipmentSystem.js';
import { BarrelSystem }     from '../systems/BarrelSystem.js';
import { ResourceBridge }   from '../systems/ResourceBridge.js';
import { Bus, EV }          from '../systems/EventBus.js';
import { Save }             from '../systems/SaveSystem.js';

const OX = BOARD_OFFSET_X;
const OY = BOARD_OFFSET_Y;

/**
 * 主游戏场景
 * 接收 { levelId } 数据，加载对应关卡
 */
export class GameScene extends Phaser.Scene {
  constructor() { super('Game'); }

  init(data) {
    this.levelId = data.levelId ?? 1;
  }

  preload() {
    // 每次进入关卡都重新加载，确保缓存命中
    this.load.json(`level${this.levelId}`, `/levels/level${this.levelId}.json`);
  }

  create() {
    // 初始化系统
    this.equipSys  = new EquipmentSystem();
    this.stats     = this.equipSys.snapshot();
    this.barrelSys = new BarrelSystem();

    this.logic = new GameLogic();
    this.logic.shootFn = this.barrelSys.buildShooter(this.stats);

    const data = this.cache.json.get(`level${this.levelId}`);
    if (!data) {
      console.error(`关卡 ${this.levelId} 数据加载失败`);
      this.scene.start('LevelSelect');
      return;
    }

    this.logic.loadLevel(data, this.stats);

    // 视觉对象池
    this._bullets       = [];   // { go: Graphics, turretId, col, row, x, y, piercing }
    this._particles     = [];   // { go: Graphics, life }
    this._coinPopups    = [];   // { go: Text, life }
    this._specialFx     = [];   // { go: Graphics|Text, life }

    // 主绘图层
    this.gfx = this.add.graphics();

    // HUD（顶部）
    this._buildHUD();

    // 底部操作区
    this._buildControlArea();

    // 输入
    this.input.on('pointerdown', this._handleClick, this);

    // 事件监听
    this._unsubWin  = Bus.on(EV.LEVEL_WIN,  () => this._onWin());
    this._unsubFail = Bus.on(EV.LEVEL_FAIL, () => this._onFail());
    this._unsubCoin = Bus.on(EV.COINS_EARNED, ({ amount }) => this._popCoin(amount));
  }

  update() {
    if (this.logic.state === 'idle') return;

    // 逻辑更新
    if (this.logic.state === 'playing') {
      this.logic.update();
    }

    // 处理新子弹
    const newBullets = this.logic.flushPendingBullets();
    for (const b of newBullets) this._spawnBullet(b);

    // 处理特殊效果事件
    const specialEvs = this.logic.flushSpecialEvents();
    for (const ev of specialEvs) this._handleSpecialEvent(ev);

    // 移动子弹
    this._updateBullets();

    // 更新粒子/特效
    this._updateParticles();
    this._updatePopups();

    // 主渲染
    this._draw();

    // 更新 HUD
    this._updateHUD();
  }

  // ── 构建 UI ──────────────────────────────────────────────

  _buildHUD() {
    const C = '#ffffff';
    this.txLevel  = this.add.text(VIEW_W / 2, 12, `关卡 ${this.levelId}`, { fontSize: '18px', fontFamily: 'monospace', color: C }).setOrigin(0.5, 0);
    this.txCoins  = this.add.text(10,   12, '🪙 0',   { fontSize: '15px', fontFamily: 'monospace', color: '#FFD700' });
    this.txBlocks = this.add.text(VIEW_W - 10, 12, '', { fontSize: '15px', fontFamily: 'monospace', color: '#aaa' }).setOrigin(1, 0);

    // 暂停按钮
    const pauseBtn = this.add.text(VIEW_W - 10, VIEW_H - 40, '⏸', {
      fontSize: '26px',
    }).setOrigin(1, 1).setInteractive({ useHandCursor: true });
    pauseBtn.on('pointerdown', () => this._pause());
  }

  _buildControlArea() {
    // 队列按钮区域（两条队列）
    this.laneButtons = [];
    const laneCount = this.logic.lanes.length;
    for (let i = 0; i < laneCount; i++) {
      const x = (i + 1) * VIEW_W / (laneCount + 1);
      const y = VIEW_H - 90;
      const btn = this.add.rectangle(x, y, 100, 60, 0x223366)
        .setInteractive({ useHandCursor: true });
      const tx = this.add.text(x, y, '', { fontSize: '14px', fontFamily: 'monospace', color: '#fff' }).setOrigin(0.5);
      btn.on('pointerdown', () => this.logic.deployFromLane(i));
      this.laneButtons.push({ btn, tx, laneIdx: i });
    }

    // 暂存区点击（点击暂存区中的炮台重新入轨）
    this._bufferClickSetup();
  }

  _bufferClickSetup() {
    // 暂存区绘制在棋盘下方，这里注册点击区域
    this.input.on('pointerdown', (ptr) => {
      const bx = OX;
      const by = OY + GH * CELL + 10;
      if (ptr.y < by || ptr.y > by + 60) return;
      const relX = ptr.x - bx;
      const slot = Math.floor(relX / (CELL * 2 + 4));
      if (slot >= 0 && slot < this.logic.buffer.length) {
        this.logic.deployFromBuffer(slot);
      }
    });
  }

  _updateHUD() {
    const coins = this.logic.coinSys.sessionCoins;
    this.txCoins.setText(`🪙 ${coins}`);
    this.txBlocks.setText(`方块: ${this.logic.blocks.length}`);

    // 更新队列按钮文字
    for (const { tx, laneIdx } of this.laneButtons) {
      const visible = this.logic.getLaneVisible(laneIdx);
      if (visible.length > 0) {
        const v = visible[0];
        tx.setText(`发射\n${v.color.slice(1,5)}`);
        tx.setColor(v.color);
      } else {
        tx.setText('空队列');
        tx.setColor('#555');
      }
    }
  }

  // ── 子弹管理 ──────────────────────────────────────────────

  _spawnBullet(intent) {
    // 计算起始屏幕坐标（炮台在轨道上的位置）
    const start = this._pathPosToScreen(intent.fromPathPos, intent.turretId);
    // 目标坐标
    const tx = OX + (intent.col + 0.5) * CELL;
    const ty = OY + (intent.row + 0.5) * CELL;

    // 若有 offsetSlot，偏移目标
    let finalTx = tx, finalTy = ty;
    if (intent.offsetSlot) {
      // 简化：根据大致方向偏移 offsetSlot 格
      const dx = Math.abs(start.x - tx) > Math.abs(start.y - ty) ? 0 : CELL * intent.offsetSlot;
      const dy = Math.abs(start.x - tx) > Math.abs(start.y - ty) ? CELL * intent.offsetSlot : 0;
      finalTx = tx + dx;
      finalTy = ty + dy;
    }

    const go = this.add.graphics();
    this._bullets.push({
      go,
      turretId: intent.turretId,
      col: intent.col,
      row: intent.row,
      color: intent.color,
      piercing: intent.piercing ?? false,
      x: start.x,
      y: start.y,
      tx: finalTx,
      ty: finalTy,
    });
  }

  _updateBullets() {
    const done = [];
    for (const b of this._bullets) {
      const dx = b.tx - b.x;
      const dy = b.ty - b.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < BULLET_SPEED) {
        // 命中
        this.logic.onBulletHit(b.turretId, b.col, b.row);
        this._spawnHitParticle(b.tx, b.ty, b.color);
        b.go.destroy();
        done.push(b);
      } else {
        const nx = b.x + (dx / dist) * BULLET_SPEED;
        const ny = b.y + (dy / dist) * BULLET_SPEED;
        b.x = nx; b.y = ny;
        b.go.clear();
        b.go.fillStyle(Phaser.Display.Color.HexStringToColor(b.color).color, 1);
        b.go.fillCircle(nx, ny, 5);
      }
    }
    this._bullets = this._bullets.filter(b => !done.includes(b));
  }

  // ── 特殊效果 ──────────────────────────────────────────────

  _handleSpecialEvent(ev) {
    const sx = OX + (ev.x + 0.5) * CELL;
    const sy = OY + (ev.y + 0.5) * CELL;

    switch (ev.type) {
      case 'explode':
      case 'row_clear':
      case 'col_clear':
      case 'color_clear':
        this._spawnHitParticle(sx, sy, '#FF6600', 12);
        break;
      case 'coin_burst':
        this._spawnPopup(sx, sy, `+${ev.amount}🪙`, '#FFD700');
        break;
      case 'item_drop':
        this._spawnPopup(sx, sy, '⚙ 装备!', '#44AAFF');
        break;
      case 'collection_drop':
        this._spawnPopup(sx, sy, '📖 碎片!', '#44FF88');
        break;
      case 'shield_activate':
        this._spawnPopup(sx, sy, '🛡 护盾!', '#4488FF');
        break;
      case 'multiplier':
        this._spawnPopup(sx, sy, `×${ev.value} 金币!`, '#FF44AA');
        break;
      case 'auto_bomb':
        this._spawnHitParticle(sx, sy, '#FF0000', 16);
        break;
    }
  }

  // ── 粒子与弹出文字 ────────────────────────────────────────

  _spawnHitParticle(x, y, hex, radius = 8) {
    const go = this.add.graphics();
    this._particles.push({ go, x, y, hex, radius, life: 20 });
  }

  _updateParticles() {
    const dead = [];
    for (const p of this._particles) {
      p.life--;
      const alpha = p.life / 20;
      p.go.clear();
      p.go.fillStyle(Phaser.Display.Color.HexStringToColor(p.hex).color, alpha);
      p.go.fillCircle(p.x, p.y, p.radius * alpha + 2);
      if (p.life <= 0) { p.go.destroy(); dead.push(p); }
    }
    this._particles = this._particles.filter(p => !dead.includes(p));
  }

  _spawnPopup(x, y, text, color) {
    const go = this.add.text(x, y, text, {
      fontSize: '14px', fontFamily: 'monospace', color,
      stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5);
    this._coinPopups.push({ go, life: 60, startY: y });
  }

  _updatePopups() {
    const dead = [];
    for (const p of this._coinPopups) {
      p.life--;
      p.go.y = p.startY - (60 - p.life) * 0.5;
      p.go.setAlpha(p.life / 60);
      if (p.life <= 0) { p.go.destroy(); dead.push(p); }
    }
    this._coinPopups = this._coinPopups.filter(p => !dead.includes(p));
  }

  _popCoin(amount) {
    // 金币弹窗（在 HUD 附近）
    this._spawnPopup(80, 30, `+${amount}`, '#FFD700');
  }

  // ── 主渲染 ────────────────────────────────────────────────

  _draw() {
    const g = this.gfx;
    g.clear();

    // 棋盘背景
    g.fillStyle(0x111122, 1);
    g.fillRect(OX, OY, GW * CELL, GH * CELL);

    // 网格线
    g.lineStyle(1, 0x222244, 0.5);
    for (let c = 0; c <= GW; c++) {
      g.lineBetween(OX + c * CELL, OY, OX + c * CELL, OY + GH * CELL);
    }
    for (let r = 0; r <= GH; r++) {
      g.lineBetween(OX, OY + r * CELL, OX + GW * CELL, OY + r * CELL);
    }

    // 方块
    for (const block of this.logic.blocks) {
      const bx = OX + block.x * CELL + 1;
      const by = OY + block.y * CELL + 1;
      const col = Phaser.Display.Color.HexStringToColor(block.color).color;
      g.fillStyle(col, 1);
      g.fillRect(bx, by, CELL - 2, CELL - 2);

      // 特殊方块标记
      if (block.special) {
        g.lineStyle(2, 0xFFFFFF, 0.8);
        g.strokeRect(bx, by, CELL - 2, CELL - 2);
      }
    }

    // 轨道炮台
    for (const t of this.logic.turrets) {
      const { x, y } = this._turretScreenPos(t);
      const col = Phaser.Display.Color.HexStringToColor(t.color).color;
      g.fillStyle(col, 1);
      g.fillCircle(x, y, 10);
      g.lineStyle(2, 0xFFFFFF, 1);
      g.strokeCircle(x, y, 10);

      // 弹药数
      // 用 text 对象管理的做法太重，这里简化：绘制小圆点代表弹药
      g.fillStyle(0xFFFFFF, 0.8);
      g.fillRect(x - 8, y + 12, Math.min(16, t.ammo / 2), 3);
    }

    // 暂存区
    const bx0 = OX;
    const by0 = OY + GH * CELL + 10;
    g.fillStyle(0x1a1a2e, 1);
    g.fillRect(bx0, by0, GW * CELL, 55);
    g.lineStyle(1, 0x334466, 1);
    g.strokeRect(bx0, by0, GW * CELL, 55);

    for (let i = 0; i < this.logic.buffer.length; i++) {
      const t = this.logic.buffer[i];
      const bx = bx0 + i * (CELL * 2 + 4) + CELL;
      const by = by0 + 27;
      const col = Phaser.Display.Color.HexStringToColor(t.color).color;
      g.fillStyle(col, 1);
      g.fillRoundedRect(bx - CELL, by - 20, CELL * 2, 40, 6);
      g.lineStyle(1, 0xffffff, 0.6);
      g.strokeRoundedRect(bx - CELL, by - 20, CELL * 2, 40, 6);
    }
  }

  // ── 工具：坐标转换 ────────────────────────────────────────

  _turretScreenPos(turret) {
    const p = turret.pathPos;
    const S = SIDE_LEN;
    const ox = OX, oy = OY, gw = GW * CELL, gh = GH * CELL;

    if (p < S)      return { x: ox + p,          y: oy + gh + 20 };
    if (p < S * 2)  return { x: ox + gw + 20,    y: oy + gh - (p - S) };
    if (p < S * 3)  return { x: ox + gw - (p - S * 2), y: oy - 20 };
    return             { x: ox - 20,             y: oy + (p - S * 3) };
  }

  _pathPosToScreen(pathPos, _turretId) {
    return this._turretScreenPos({ pathPos });
  }

  // ── 输入 ──────────────────────────────────────────────────

  _handleClick(ptr) {
    if (this.logic.state !== 'playing') return;
    // 队列区域点击已由 _buildControlArea 的按钮处理
    // 轨道炮台点击（暂未扩展）
  }

  // ── 胜负 ──────────────────────────────────────────────────

  _onWin() {
    const stars = this._calcStars();
    const result = this.logic.getSessionResult(this.levelId, stars);
    const summary = ResourceBridge.commit(result);
    this._showResult(true, stars, summary);
  }

  _onFail() {
    this._showResult(false, 0, null);
  }

  _calcStars() {
    // 简化：剩余暂存区越少星越多
    const buf = this.logic.buffer.length;
    if (buf === 0) return 3;
    if (buf <= 2)  return 2;
    return 1;
  }

  _showResult(win, stars, summary) {
    // 半透明遮罩
    const overlay = this.add.rectangle(VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, 0x000000, 0.7);

    const title = win ? '🎉 关卡完成!' : '😵 失败';
    this.add.text(VIEW_W / 2, 300, title, {
      fontSize: '36px', fontFamily: 'monospace', color: win ? '#FFD700' : '#FF4444',
    }).setOrigin(0.5);

    if (win && summary) {
      this.add.text(VIEW_W / 2, 370, `⭐ × ${stars}`, { fontSize: '28px', fontFamily: 'monospace', color: '#FFD700' }).setOrigin(0.5);
      this.add.text(VIEW_W / 2, 420, `+${summary.coinsAdded} 🪙`, { fontSize: '22px', fontFamily: 'monospace', color: '#FFD700' }).setOrigin(0.5);
      if (summary.newGear.length > 0) {
        this.add.text(VIEW_W / 2, 460, `获得装备 ×${summary.newGear.length} ⚙`, { fontSize: '18px', fontFamily: 'monospace', color: '#44AAFF' }).setOrigin(0.5);
      }
    }

    // 按钮
    const nextId = this.levelId + 1;
    const unlocked = Save.get('unlockedLevels') ?? [];

    if (win && unlocked.includes(nextId)) {
      this._resultBtn(VIEW_W / 2 - 90, 540, '下一关', () => this.scene.start('Game', { levelId: nextId }));
    }
    this._resultBtn(VIEW_W / 2 + (win ? 90 : 0), 540, '重试', () => this.scene.start('Game', { levelId: this.levelId }));
    this._resultBtn(VIEW_W / 2, 610, '返回菜单', () => this.scene.start('Menu'));
  }

  _resultBtn(x, y, label, cb) {
    const btn = this.add.rectangle(x, y, 160, 50, 0x334488).setInteractive({ useHandCursor: true });
    this.add.text(x, y, label, { fontSize: '18px', fontFamily: 'monospace', color: '#fff' }).setOrigin(0.5);
    btn.on('pointerdown', cb);
  }

  _pause() {
    this.scene.pause();
    this.scene.launch('UI', { mode: 'pause', gameScene: this });
  }

  // ── 清理 ──────────────────────────────────────────────────

  shutdown() {
    this._unsubWin?.();
    this._unsubFail?.();
    this._unsubCoin?.();
    Bus.off(EV.LEVEL_WIN);
    Bus.off(EV.LEVEL_FAIL);
  }
}
