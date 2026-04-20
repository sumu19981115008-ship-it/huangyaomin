import { VIEW_W, VIEW_H, TOTAL_LEVELS } from '../constants.js';
import { Save } from '../systems/SaveSystem.js';

/**
 * 关卡选择场景
 */
export class LevelSelectScene extends Phaser.Scene {
  constructor() { super('LevelSelect'); }

  create() {
    const unlocked = Save.get('unlockedLevels') ?? [1];
    const stars    = Save.get('levelStars')    ?? {};

    this.add.rectangle(VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, 0x080818);
    this.add.text(VIEW_W / 2, 40, '选择关卡', {
      fontSize: '28px', fontFamily: 'monospace', color: '#fff',
    }).setOrigin(0.5);

    // 返回按钮
    this._backBtn();

    // 关卡格子（每行 5 个，显示前 50 关）
    const COLS = 5;
    const BTN_SIZE = 70;
    const GAP  = 14;
    const startX = (VIEW_W - COLS * (BTN_SIZE + GAP)) / 2 + BTN_SIZE / 2;
    const startY = 100;

    const maxShow = Math.min(TOTAL_LEVELS, 50);
    for (let i = 1; i <= maxShow; i++) {
      const col = (i - 1) % COLS;
      const row = Math.floor((i - 1) / COLS);
      const x = startX + col * (BTN_SIZE + GAP);
      const y = startY + row * (BTN_SIZE + GAP);

      const isUnlocked = unlocked.includes(i);
      const starCount  = stars[i] ?? 0;
      const bgColor    = isUnlocked ? 0x224488 : 0x333333;

      const btn = this.add.rectangle(x, y, BTN_SIZE, BTN_SIZE, bgColor)
        .setInteractive({ useHandCursor: isUnlocked });

      this.add.text(x, y - 8, `${i}`, {
        fontSize: '18px', fontFamily: 'monospace',
        color: isUnlocked ? '#fff' : '#666',
      }).setOrigin(0.5);

      if (isUnlocked && starCount > 0) {
        this.add.text(x, y + 16, '⭐'.repeat(starCount), {
          fontSize: '10px',
        }).setOrigin(0.5);
      }

      if (isUnlocked) {
        btn.on('pointerdown', () => {
          this.scene.start('Game', { levelId: i });
        });
        btn.on('pointerover',  () => btn.setFillStyle(0x3355aa));
        btn.on('pointerout',   () => btn.setFillStyle(bgColor));
      }
    }
  }

  _backBtn() {
    const btn = this.add.text(30, VIEW_H - 40, '← 返回', {
      fontSize: '18px', fontFamily: 'monospace', color: '#aaa',
    }).setInteractive({ useHandCursor: true });
    btn.on('pointerdown', () => this.scene.start('Menu'));
  }
}
