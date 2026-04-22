import { GameLogic }   from './GameLogic.js';
import { Renderer }    from './renderer.js';
import { BulletSystem } from './bullets.js';
import { ItemSystem }  from './items.js';
import { DevTools }    from './dev/DevTools.js';
import {
  G,
  TRACK_CAP, BUFFER_CAP,
  VW, VH,
  C_BG,
  TOTAL_LEVELS,
} from './constants.js';

export class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
    this.logic      = null;
    this.renderer   = null;
    this.bullets    = null;
    this.items      = null;
    this.devTools   = null;

    this.levelIndex = 0;
    this.levels     = [];
    this.g          = null;
    this.overlayG   = null;
    this._lastState = null;

    // 文本池（由 _createTexts 初始化，Renderer/ItemSystem 读取）
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

    this._endgameDeployDone = false;
  }

  init(data) {
    this.levelIndex = data?.levelIndex ?? 0;
  }

  preload() {
    for (let i = 1; i <= TOTAL_LEVELS; i++) {
      this.load.json(`level${i}`, `/levels/level${i}.json`);
    }
  }

  create() {
    this.logic    = new GameLogic();
    this.renderer = new Renderer(this);
    this.bullets  = new BulletSystem(this);
    this.items    = new ItemSystem(this);

    this.g        = this.add.graphics();
    this.overlayG = this.add.graphics().setDepth(10);

    this.cameras.main.setBackgroundColor(C_BG);

    this.levels = [];
    for (let i = 1; i <= TOTAL_LEVELS; i++) {
      const d = this.cache.json.get(`level${i}`);
      if (d) this.levels.push(d);
    }

    this._createTexts();
    this.items.create();
    this._loadCurrentLevel();

    this.devTools = new DevTools(this, {
      totalLevels: this.levels.length,
      onJump: (idx) => { this.levelIndex = idx; this._loadCurrentLevel(); },
    });

    this.input.on('pointerdown', (ptr) => this._handleClick(ptr.x, ptr.y));
  }

  update() {
    if (!this.logic || this.logic.state === 'idle') return;

    if (this.logic.state === 'playing' && !this.items.item2Paused && !this.items.item3Active) {
      this.bullets.spawnFromLogic();
      this.bullets.moveBullets();
      this.logic.update();
      this._checkEndgameDeploy();
    }

    this.renderer.render(this.g, this.bullets);
    this._checkStateChange();
  }

  // ── 关卡管理 ──────────────────────────────────────────────────

  _loadCurrentLevel() {
    const data = this.levels[this.levelIndex];
    if (!data) return;
    this.logic.loadLevel(data);
    this.bullets.reset();
    this._lastState = 'playing';
    this._endgameDeployDone = false;
    this.items.reset();
    this.txLevel.setText(`Level ${this.levelIndex + 1}`);
    this._hideOverlay();
    this._updateLabels();
    this.devTools?.sync(this.levelIndex);
  }

  // ── 输入 ──────────────────────────────────────────────────────

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

    if (this.items.handleClick(px, py)) return;

    const { BUFFER_Y } = G;
    const cap = this.logic.bufferCap;
    for (let i = 0; i < cap; i++) {
      const sp = this.renderer._bufferSlotPos(i);
      if (Math.abs(px - sp.x) < 26 && Math.abs(py - BUFFER_Y) < 28) {
        const deployed = this.logic.deployFromBuffer(i);
        if (deployed) this.bullets.spawnFlash(sp.x, BUFFER_Y);
        return;
      }
    }

    const numLanes = this.logic.lanes.length;
    for (let i = 0; i < numLanes; i++) {
      const cx = this.renderer._laneCenterX(i, numLanes);
      const qy = G.QUEUE_Y + (this.items.queueOffsetY || 0);
      if (Math.abs(px - cx) < 50 && py >= qy - 5 && py <= qy + 165) {
        const deployed = this.logic.deployFromLane(i);
        if (deployed) this.bullets.spawnFlash(cx, qy + 60);
        return;
      }
    }
  }

  // ── 终局自动部署 ──────────────────────────────────────────────

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
    for (let li = 0; li < this.logic.lanes.length; li++)
      for (let j = 0; j < this.logic.lanes[li].length; j++) cmds.push({ type: 'lane', laneIdx: li });

    const tryDeploy = (cmd) => {
      if (this.logic.state !== 'playing') return;
      const blocked = this.logic.turrets.some(t => !t.lapComplete && t.pathPos < SAFE_GAP);
      if (blocked) { this.time.delayedCall(80, () => tryDeploy(cmd)); return; }
      if (cmd.type === 'buffer') this.logic.forceDeployFromBuffer(0);
      else                       this.logic.forceDeployFromLane(cmd.laneIdx);
    };

    cmds.forEach((cmd, i) => this.time.delayedCall(i * 300, () => tryDeploy(cmd)));
  }

  // ── 状态检测 ──────────────────────────────────────────────────

  _checkStateChange() {
    const state = this.logic.state;
    if (state !== this._lastState) {
      this._lastState = state;
      if (state === 'win')  this._showWin();
      if (state === 'fail') this._showFail();
    }
  }

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

  // ── 文本池 ────────────────────────────────────────────────────

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
    this.txBufferLabel = this.add.text(VW / 2, 0, '暂 存 区', style(12, '#555588')).setOrigin(0.5);
    this.txQueueLabel  = this.add.text(VW / 2, 0, '炮台队列', style(12, '#555588')).setOrigin(0.5);

    for (let i = 0; i < TRACK_CAP + 3; i++)
      this.txTurretAmmo.push(this.add.text(0, 0, '', style(10)).setOrigin(0.5).setVisible(false).setDepth(6));
    for (let i = 0; i < BUFFER_CAP + 3; i++)
      this.txBufferAmmo.push(this.add.text(0, 0, '', style(10)).setOrigin(0.5).setVisible(false).setDepth(6));
    for (let i = 0; i < 16; i++)
      this.txQueueItems.push(this.add.text(0, 0, '', style(10)).setOrigin(0.5).setVisible(false).setDepth(6));
    for (let i = 0; i < 8; i++)
      this.txQueueCounts.push(this.add.text(0, 0, '', style(13, '#9999cc')).setOrigin(0.5).setVisible(false).setDepth(6));
  }

  _updateLabels() {
    this.txBufferLabel?.setPosition(VW / 2, G.BUFFER_Y - 40);
    this.txQueueLabel?.setPosition(VW / 2, G.QUEUE_Y  - 24);
  }
}
