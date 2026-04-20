import { Bus, EV } from './EventBus.js';
import { Save } from './SaveSystem.js';

/**
 * 局内金币系统
 * 负责计算每局获得的金币（根据得星数、装备加成等）
 * 局结束后通过 ResourceBridge 转入存档
 */
export class CoinSystem {
  constructor() {
    this.sessionCoins = 0;         // 本局赚到的金币
    this.multiplier   = 1.0;       // 金币倍率（装备加成）
  }

  reset(multiplier = 1.0) {
    this.sessionCoins = 0;
    this.multiplier   = multiplier;
  }

  /** 消除方块时调用 */
  onBlockDestroyed(block) {
    const base = block.special ? 3 : 1;
    const earned = Math.ceil(base * this.multiplier);
    this.sessionCoins += earned;
    Bus.emit(EV.COINS_EARNED, { amount: earned, session: this.sessionCoins });
    return earned;
  }

  /** 完关奖励（额外按星数） */
  onLevelComplete(stars) {
    const bonus = stars * 10;
    const earned = Math.ceil(bonus * this.multiplier);
    this.sessionCoins += earned;
    Bus.emit(EV.COINS_EARNED, { amount: earned, session: this.sessionCoins });
    return earned;
  }

  flush() {
    Save.addCoins(this.sessionCoins);
    const total = this.sessionCoins;
    this.sessionCoins = 0;
    return total;
  }
}
