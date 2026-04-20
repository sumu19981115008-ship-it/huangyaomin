import { VIEW_W, VIEW_H } from '../constants.js';
import { Collection }      from '../systems/CollectionSystem.js';
import { Save }            from '../systems/SaveSystem.js';

const CATEGORY_NAMES = {
  pixel: '像素生物', weapon: '武器', element: '元素', trophy: '奖杯',
};

/**
 * 收集图鉴场景
 */
export class CollectionScene extends Phaser.Scene {
  constructor() { super('Collection'); }

  create() {
    this._activeCategory = 'pixel';
    this._buildBg();
    this._buildCategoryTabs();
    this._buildGemBar();
    this._buildGrid();
    this._backBtn();
  }

  _buildBg() {
    this.add.rectangle(VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, 0x050a08);
    this.add.text(VIEW_W / 2, 20, '收集图鉴', {
      fontSize: '24px', fontFamily: 'monospace', color: '#44FF88',
    }).setOrigin(0.5, 0);
  }

  _buildGemBar() {
    this.txGems = this.add.text(VIEW_W - 10, 20, `💎 ${Save.get('gems')}`, {
      fontSize: '16px', fontFamily: 'monospace', color: '#88FFFF',
    }).setOrigin(1, 0);
  }

  _buildCategoryTabs() {
    this._catBtns = [];
    const cats = Object.keys(CATEGORY_NAMES);
    cats.forEach((cat, i) => {
      const x = 50 + i * 110;
      const btn = this.add.rectangle(x, 80, 100, 32, 0x223322)
        .setInteractive({ useHandCursor: true });
      const tx = this.add.text(x, 80, CATEGORY_NAMES[cat], {
        fontSize: '13px', fontFamily: 'monospace', color: '#aaa',
      }).setOrigin(0.5);
      btn.on('pointerdown', () => {
        this._activeCategory = cat;
        this._refreshGrid();
        this._refreshTabs();
      });
      this._catBtns.push({ btn, cat });
    });
    this._refreshTabs();
  }

  _refreshTabs() {
    this._catBtns.forEach(({ btn, cat }) => {
      btn.setFillStyle(cat === this._activeCategory ? 0x336633 : 0x223322);
    });
  }

  _buildGrid() {
    this._gridContainer = this.add.container(0, 100);
    this._refreshGrid();
  }

  _refreshGrid() {
    this._gridContainer.removeAll(true);
    const entries = Collection.getAllEntries().filter(e => e.category === this._activeCategory);

    const COLS = 3;
    const W = 140, H = 130, GAP = 10;
    const startX = (VIEW_W - COLS * (W + GAP)) / 2 + W / 2;
    const startY = 30;

    entries.forEach((entry, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = startX + col * (W + GAP);
      const y = startY + row * (H + GAP);

      const alpha = entry.unlocked ? 1 : 0.4;
      const bg = this.add.rectangle(x, y, W, H, entry.unlocked ? 0x1a3322 : 0x1a1a1a)
        .setAlpha(alpha);

      const iconT = this.add.text(x, y - 30, entry.icon, {
        fontSize: '28px',
      }).setOrigin(0.5).setAlpha(alpha);

      const nameT = this.add.text(x, y + 10, entry.unlocked ? entry.name : '???', {
        fontSize: '12px', fontFamily: 'monospace', color: entry.unlocked ? '#fff' : '#555',
        wordWrap: { width: W - 10 },
      }).setOrigin(0.5);

      // 进度条
      const prog = entry.fragments / entry.requiredFragments;
      const barW = W - 20;
      const barBg = this.add.rectangle(x, y + 45, barW, 8, 0x333333);
      const barFg = this.add.rectangle(x - barW / 2 + (barW * prog) / 2, y + 45, barW * prog, 8, 0x44FF88);

      const fragT = this.add.text(x, y + 58, `${entry.fragments}/${entry.requiredFragments}`, {
        fontSize: '10px', fontFamily: 'monospace', color: '#888',
      }).setOrigin(0.5);

      // 点击查看详情（已解锁）
      if (entry.unlocked) {
        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerdown', () => this._showDetail(entry));
      }

      this._gridContainer.add([bg, iconT, nameT, barBg, barFg, fragT]);
    });
  }

  _showDetail(entry) {
    // 弹出详情面板
    const overlay = this.add.rectangle(VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, 0x000000, 0.6)
      .setInteractive();
    const panel = this.add.rectangle(VIEW_W / 2, VIEW_H / 2, 300, 300, 0x0a2a1a);

    const iconT = this.add.text(VIEW_W / 2, VIEW_H / 2 - 100, entry.icon, { fontSize: '40px' }).setOrigin(0.5);
    const nameT = this.add.text(VIEW_W / 2, VIEW_H / 2 - 50, entry.name, {
      fontSize: '18px', fontFamily: 'monospace', color: '#44FF88',
    }).setOrigin(0.5);
    const descT = this.add.text(VIEW_W / 2, VIEW_H / 2, entry.desc, {
      fontSize: '13px', fontFamily: 'monospace', color: '#ccc',
      wordWrap: { width: 260 }, align: 'center',
    }).setOrigin(0.5);
    const closeT = this.add.text(VIEW_W / 2, VIEW_H / 2 + 110, '关闭', {
      fontSize: '16px', fontFamily: 'monospace', color: '#aaa',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    const cleanup = () => [overlay, panel, iconT, nameT, descT, closeT].forEach(o => o.destroy());
    overlay.on('pointerdown', cleanup);
    closeT.on('pointerdown', cleanup);
  }

  _backBtn() {
    const btn = this.add.text(20, VIEW_H - 30, '← 返回', {
      fontSize: '18px', fontFamily: 'monospace', color: '#aaa',
    }).setInteractive({ useHandCursor: true });
    btn.on('pointerdown', () => this.scene.start('Menu'));
  }
}
