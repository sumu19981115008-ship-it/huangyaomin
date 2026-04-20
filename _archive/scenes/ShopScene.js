import { VIEW_W, VIEW_H } from '../constants.js';
import { Save }            from '../systems/SaveSystem.js';
import { ResourceBridge }  from '../systems/ResourceBridge.js';
import { GEAR_TABLE, getGearBySlot } from '../data/GearTable.js';

const SLOTS = ['barrel', 'core', 'charm'];
const SLOT_NAMES = { barrel: '炮管', core: '核心', charm: '护符' };
const RARITY_COLORS = { common: '#aaaaaa', rare: '#4488ff', epic: '#aa44ff', legendary: '#ffaa00' };

/**
 * 装备商店场景
 */
export class ShopScene extends Phaser.Scene {
  constructor() { super('Shop'); }

  create() {
    this._activeSlot = 'barrel';
    this._buildBg();
    this._buildTabs();
    this._buildCurrencyBar();
    this._buildItemList();
    this._buildEquippedPanel();
    this._buildUpgradePanel();
    this._backBtn();
  }

  _buildBg() {
    this.add.rectangle(VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, 0x080810);
    this.add.text(VIEW_W / 2, 20, '装备商店', {
      fontSize: '24px', fontFamily: 'monospace', color: '#FFD700',
    }).setOrigin(0.5, 0);
  }

  _buildCurrencyBar() {
    this.txCoins = this.add.text(10, 50, '', { fontSize: '16px', fontFamily: 'monospace', color: '#FFD700' });
    this.txGems  = this.add.text(180, 50, '', { fontSize: '16px', fontFamily: 'monospace', color: '#88FFFF' });
    this._refreshCurrency();
  }

  _refreshCurrency() {
    this.txCoins?.setText(`🪙 ${Save.get('coins')}`);
    this.txGems?.setText(`💎 ${Save.get('gems')}`);
  }

  _buildTabs() {
    this._tabBtns = [];
    SLOTS.forEach((slot, i) => {
      const x = 60 + i * 140;
      const btn = this.add.rectangle(x, 90, 120, 36, 0x223366)
        .setInteractive({ useHandCursor: true });
      const tx = this.add.text(x, 90, SLOT_NAMES[slot], {
        fontSize: '16px', fontFamily: 'monospace', color: '#fff',
      }).setOrigin(0.5);
      btn.on('pointerdown', () => {
        this._activeSlot = slot;
        this._refreshItemList();
        this._refreshEquipped();
        this._refreshTabs();
      });
      this._tabBtns.push({ btn, slot });
    });
    this._refreshTabs();
  }

  _refreshTabs() {
    this._tabBtns.forEach(({ btn, slot }) => {
      btn.setFillStyle(slot === this._activeSlot ? 0x4466aa : 0x223366);
    });
  }

  // 装备列表
  _buildItemList() {
    this._itemContainer = this.add.container(0, 120);
    this._refreshItemList();
  }

  _refreshItemList() {
    this._itemContainer.removeAll(true);
    const items = getGearBySlot(this._activeSlot);
    const inventory = Save.get('inventory') ?? [];
    const equipped  = Save.get('equippedGear') ?? {};
    const upgrades  = Save.get('upgrades') ?? {};

    items.forEach((item, i) => {
      const y = i * 78;
      const owned    = inventory.includes(item.id);
      const isEquip  = equipped[this._activeSlot] === item.id;
      const lv       = upgrades[item.id] ?? 1;
      const bgColor  = isEquip ? 0x335500 : owned ? 0x223355 : 0x1a1a2e;
      const rc = RARITY_COLORS[item.rarity] ?? '#aaa';

      const bg = this.add.rectangle(VIEW_W / 2, y + 38, VIEW_W - 20, 68, bgColor)
        .setInteractive({ useHandCursor: true });

      const nameT = this.add.text(20, y + 16, `[${item.rarity[0].toUpperCase()}] ${item.name}`, {
        fontSize: '15px', fontFamily: 'monospace', color: rc,
      });
      const descT = this.add.text(20, y + 38, item.desc, {
        fontSize: '11px', fontFamily: 'monospace', color: '#888',
      });

      let rightLabel, rightColor;
      if (isEquip)       { rightLabel = '已装备'; rightColor = '#88ff88'; }
      else if (owned)    { rightLabel = `装备 (Lv${lv})`; rightColor = '#88aaff'; }
      else               { rightLabel = `购买 🪙${item.cost}`; rightColor = '#FFD700'; }

      const actionT = this.add.text(VIEW_W - 20, y + 28, rightLabel, {
        fontSize: '13px', fontFamily: 'monospace', color: rightColor,
      }).setOrigin(1, 0.5);

      bg.on('pointerdown', () => this._onItemClick(item, owned, isEquip));

      this._itemContainer.add([bg, nameT, descT, actionT]);
    });
  }

  _onItemClick(item, owned, isEquip) {
    if (isEquip) return;
    if (owned) {
      Save.equipItem(this._activeSlot, item.id);
      this._refreshItemList();
      this._refreshEquipped();
    } else {
      const res = ResourceBridge.buyGear(item.id, item.cost);
      if (res.ok) {
        Save.equipItem(this._activeSlot, item.id);
        this._refreshItemList();
        this._refreshEquipped();
        this._refreshCurrency();
      } else {
        this._flash(res.reason === 'insufficient_coins' ? '金币不足!' : '已拥有');
      }
    }
  }

  // 当前装备面板
  _buildEquippedPanel() {
    this._equippedTexts = {};
    SLOTS.forEach((slot, i) => {
      const y = VIEW_H - 160 + i * 30;
      this.add.text(10, y, `${SLOT_NAMES[slot]}:`, {
        fontSize: '14px', fontFamily: 'monospace', color: '#888',
      });
      this._equippedTexts[slot] = this.add.text(80, y, '', {
        fontSize: '14px', fontFamily: 'monospace', color: '#fff',
      });
    });
    this._refreshEquipped();
  }

  _refreshEquipped() {
    const equipped = Save.get('equippedGear') ?? {};
    SLOTS.forEach(slot => {
      const id = equipped[slot];
      const name = id ? (GEAR_TABLE[id]?.name ?? id) : '(空)';
      this._equippedTexts[slot]?.setText(name);
    });
  }

  // 升级面板
  _buildUpgradePanel() {
    this.add.text(VIEW_W / 2, VIEW_H - 70, '长按已装备装备可升级', {
      fontSize: '13px', fontFamily: 'monospace', color: '#666',
    }).setOrigin(0.5);
  }

  _flash(msg) {
    const tx = this.add.text(VIEW_W / 2, VIEW_H / 2, msg, {
      fontSize: '22px', fontFamily: 'monospace', color: '#ff4444',
      stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5);
    this.time.delayedCall(1000, () => tx.destroy());
  }

  _backBtn() {
    const btn = this.add.text(20, VIEW_H - 30, '← 返回', {
      fontSize: '18px', fontFamily: 'monospace', color: '#aaa',
    }).setInteractive({ useHandCursor: true });
    btn.on('pointerdown', () => this.scene.start('Menu'));
  }
}
