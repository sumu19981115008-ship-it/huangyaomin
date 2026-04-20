import { Bus, EV } from './EventBus.js';

const SAVE_KEY = 'fixelflow2_save';

const DEFAULT_SAVE = {
  // 进度
  unlockedLevels: [1],
  levelStars:     {},      // { [levelId]: 1|2|3 }

  // 货币
  coins:    0,
  gems:     0,             // 高级货币（局外收集获得）

  // 装备槽位（当前装备中的 itemId，null = 空）
  equippedGear: {
    barrel:   null,        // 炮管（影响子弹形态/弹幕）
    core:     null,        // 核心（影响属性加成）
    charm:    null,        // 护符（触发特殊效果）
  },

  // 背包（已获得的装备 itemId 列表）
  inventory: [],

  // 局外收集图鉴（已解锁的 collectableId 列表）
  collection: [],

  // 升级进度（barrelId → level 1~5）
  upgrades: {},

  // 统计数据
  stats: {
    totalCoinsEarned: 0,
    totalLevelsCleared: 0,
    totalBlocksDestroyed: 0,
  },
};

class SaveSystem {
  constructor() {
    this._data = null;
  }

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      this._data = raw ? { ...DEFAULT_SAVE, ...JSON.parse(raw) } : structuredClone(DEFAULT_SAVE);
    } catch {
      this._data = structuredClone(DEFAULT_SAVE);
    }
    return this._data;
  }

  save() {
    localStorage.setItem(SAVE_KEY, JSON.stringify(this._data));
    Bus.emit(EV.SAVE_UPDATED, this._data);
  }

  get(key) {
    return this._data[key];
  }

  set(key, value) {
    this._data[key] = value;
    this.save();
  }

  // ---- 货币操作 ----

  addCoins(amount) {
    this._data.coins += amount;
    this._data.stats.totalCoinsEarned += amount;
    this.save();
    Bus.emit(EV.COINS_EARNED, { amount, total: this._data.coins });
  }

  spendCoins(amount) {
    if (this._data.coins < amount) return false;
    this._data.coins -= amount;
    this.save();
    return true;
  }

  addGems(amount) {
    this._data.gems += amount;
    this.save();
  }

  spendGems(amount) {
    if (this._data.gems < amount) return false;
    this._data.gems -= amount;
    this.save();
    return true;
  }

  // ---- 装备操作 ----

  equipItem(slot, itemId) {
    if (!this._data.equippedGear.hasOwnProperty(slot)) return false;
    if (itemId !== null && !this._data.inventory.includes(itemId)) return false;
    this._data.equippedGear[slot] = itemId;
    this.save();
    Bus.emit(EV.EQUIPMENT_CHANGED, { slot, itemId });
    return true;
  }

  addToInventory(itemId) {
    if (this._data.inventory.includes(itemId)) return false; // 唯一性装备
    this._data.inventory.push(itemId);
    this.save();
    return true;
  }

  getUpgradeLevel(itemId) {
    return this._data.upgrades[itemId] ?? 1;
  }

  upgradeItem(itemId, cost) {
    const cur = this.getUpgradeLevel(itemId);
    if (cur >= 5) return false;
    if (!this.spendCoins(cost)) return false;
    this._data.upgrades[itemId] = cur + 1;
    this.save();
    return true;
  }

  // ---- 收集图鉴 ----

  unlockCollectable(id) {
    if (this._data.collection.includes(id)) return false;
    this._data.collection.push(id);
    this.save();
    Bus.emit(EV.COLLECTION_UPDATED, { id });
    return true;
  }

  // ---- 关卡进度 ----

  completeLevel(levelId, stars) {
    const prev = this._data.levelStars[levelId] ?? 0;
    if (stars > prev) this._data.levelStars[levelId] = stars;
    const next = levelId + 1;
    if (!this._data.unlockedLevels.includes(next)) this._data.unlockedLevels.push(next);
    this._data.stats.totalLevelsCleared++;
    this.save();
  }

  // ---- 统计 ----

  addBlocksDestroyed(n) {
    this._data.stats.totalBlocksDestroyed += n;
    this.save();
  }

  reset() {
    this._data = structuredClone(DEFAULT_SAVE);
    this.save();
  }
}

export const Save = new SaveSystem();
