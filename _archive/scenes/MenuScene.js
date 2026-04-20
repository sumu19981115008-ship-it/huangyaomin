import { VIEW_W, VIEW_H } from '../constants.js';
import { Save }           from '../systems/SaveSystem.js';

/**
 * 主菜单场景
 */
export class MenuScene extends Phaser.Scene {
  constructor() { super('Menu'); }

  create() {
    const { coins, gems } = Save.load();

    // 背景
    this.add.rectangle(VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, 0x0a0a1a);

    // 标题
    this.add.text(VIEW_W / 2, 180, 'FIXELFLOW 2', {
      fontSize: '42px', fontFamily: 'monospace',
      color: '#FFD700', stroke: '#000', strokeThickness: 4,
    }).setOrigin(0.5);

    // 货币显示
    this._addText(20, 20, `🪙 ${coins}  💎 ${gems}`, 18, '#FFD700');

    // 按钮列表
    const btns = [
      { label: '开始游戏',  scene: 'LevelSelect', color: 0x2244AA },
      { label: '装备商店',  scene: 'Shop',        color: 0x884400 },
      { label: '收集图鉴',  scene: 'Collection',  color: 0x228844 },
    ];

    btns.forEach(({ label, scene, color }, i) => {
      const y = 380 + i * 110;
      const btn = this.add.rectangle(VIEW_W / 2, y, 300, 70, color, 1)
        .setInteractive({ useHandCursor: true });
      this.add.text(VIEW_W / 2, y, label, {
        fontSize: '24px', fontFamily: 'monospace', color: '#fff',
      }).setOrigin(0.5);

      btn.on('pointerdown', () => this.scene.start(scene));
      btn.on('pointerover',  () => btn.setFillStyle(color + 0x222222));
      btn.on('pointerout',   () => btn.setFillStyle(color));
    });

    // 版本号
    this.add.text(VIEW_W / 2, VIEW_H - 30, 'v2.0.0  FixelFlow', {
      fontSize: '12px', fontFamily: 'monospace', color: '#555',
    }).setOrigin(0.5);
  }

  _addText(x, y, str, size, color) {
    return this.add.text(x, y, str, {
      fontSize: `${size}px`, fontFamily: 'monospace', color,
    });
  }
}
