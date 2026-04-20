import { VIEW_W, VIEW_H } from '../constants.js';

/**
 * 叠加 UI 场景（暂停菜单等）
 * 通过 scene.launch('UI', { mode, gameScene }) 启动
 */
export class UIScene extends Phaser.Scene {
  constructor() { super('UI'); }

  init(data) {
    this.mode      = data.mode ?? 'pause';
    this.gameScene = data.gameScene ?? null;
  }

  create() {
    if (this.mode === 'pause') this._buildPauseMenu();
  }

  _buildPauseMenu() {
    this.add.rectangle(VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, 0x000000, 0.65);
    this.add.text(VIEW_W / 2, 280, '⏸ 已暂停', {
      fontSize: '30px', fontFamily: 'monospace', color: '#fff',
    }).setOrigin(0.5);

    this._btn(VIEW_W / 2, 380, '继续游戏', () => {
      this.scene.stop();
      this.scene.resume('Game');
    });
    this._btn(VIEW_W / 2, 460, '重试关卡', () => {
      this.scene.stop();
      this.scene.stop('Game');
      const levelId = this.gameScene?.levelId ?? 1;
      this.scene.start('Game', { levelId });
    });
    this._btn(VIEW_W / 2, 540, '返回菜单', () => {
      this.scene.stop();
      this.scene.stop('Game');
      this.scene.start('Menu');
    });
  }

  _btn(x, y, label, cb) {
    const btn = this.add.rectangle(x, y, 240, 55, 0x223366)
      .setInteractive({ useHandCursor: true });
    this.add.text(x, y, label, {
      fontSize: '20px', fontFamily: 'monospace', color: '#fff',
    }).setOrigin(0.5);
    btn.on('pointerdown', cb);
    btn.on('pointerover',  () => btn.setFillStyle(0x3355aa));
    btn.on('pointerout',   () => btn.setFillStyle(0x223366));
  }
}
