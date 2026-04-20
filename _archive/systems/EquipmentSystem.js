import { Save } from './SaveSystem.js';
import { GEAR_TABLE } from '../data/GearTable.js';

/**
 * 装备系统
 * 读取当前装备配置，计算局内生效的属性加成和弹幕模式
 */
export class EquipmentSystem {
  constructor() {
    this._stats = null;
  }

  /** 局开始时调用，快照当前装备属性 */
  snapshot() {
    const equipped = Save.get('equippedGear');
    const upgrades = Save.get('upgrades');
    this._stats = this._compute(equipped, upgrades);
    return this._stats;
  }

  get stats() {
    return this._stats ?? this._defaultStats();
  }

  _compute(equipped, upgrades) {
    const s = this._defaultStats();
    for (const [slot, itemId] of Object.entries(equipped)) {
      if (!itemId) continue;
      const def = GEAR_TABLE[itemId];
      if (!def) continue;
      const lv = upgrades[itemId] ?? 1;
      const scale = 1 + (lv - 1) * 0.2;   // 每级 +20% 效果

      if (def.coinMultiplier)   s.coinMultiplier   += (def.coinMultiplier   - 1) * scale;
      if (def.bulletCount)      s.bulletCount      += def.bulletCount * scale | 0;
      if (def.bulletPiercing)   s.bulletPiercing    = true;
      if (def.bulletSpread)     s.bulletSpread     += def.bulletSpread * scale;
      if (def.specialChance)    s.specialChance    += def.specialChance * scale;
      if (def.barrelPattern)    s.barrelPattern     = def.barrelPattern;
      if (def.charmEffect)      s.charmEffect       = def.charmEffect;
    }
    s.coinMultiplier = Math.max(1, s.coinMultiplier);
    return s;
  }

  _defaultStats() {
    return {
      coinMultiplier: 1.0,    // 金币倍率
      bulletCount:    1,      // 每槽子弹数（弹幕数）
      bulletPiercing: false,  // 穿透
      bulletSpread:   0,      // 散射角度
      specialChance:  0,      // 额外触发特殊效果概率
      barrelPattern:  'single',// 弹幕模式 single|double|triple|spread|ring
      charmEffect:    null,   // 护符特效 id
    };
  }
}
