import { Save }             from './SaveSystem.js';
import { Collection }        from './CollectionSystem.js';
import { COLLECTION_TABLE } from '../data/CollectionTable.js';

/**
 * 局内外资源转化桥
 * 局结束时统一调用，将局内产出（金币、碎片、装备掉落）写入存档
 */
export class ResourceBridge {
  /**
   * @param {object} result 局结算数据
   * @param {number}   result.coins         - 本局获得金币
   * @param {object[]} result.drops          - 装备掉落 [{ itemId }]
   * @param {object[]} result.collectionDrops- 图鉴碎片 [{ id, count }]
   * @param {number}   result.stars          - 本局星数 1~3
   * @param {number}   result.levelId        - 关卡编号
   * @returns {object} 结算摘要（用于结算 UI 显示）
   */
  static commit(result) {
    const summary = {
      coinsAdded:     0,
      newGear:        [],
      newCollections: 0,
      stars:          result.stars,
    };

    // 1. 金币写入
    if (result.coins > 0) {
      Save.addCoins(result.coins);
      summary.coinsAdded = result.coins;
    }

    // 2. 装备掉落写入背包
    for (const { itemId } of (result.drops ?? [])) {
      if (Save.addToInventory(itemId)) {
        summary.newGear.push(itemId);
      }
    }

    // 3. 图鉴碎片写入
    summary.newCollections = Collection.commitSessionDrops(result.collectionDrops ?? []);

    // 4. 关卡进度写入
    if (result.levelId) {
      Save.completeLevel(result.levelId, result.stars ?? 1);
    }

    // 5. 统计
    Save.addBlocksDestroyed(result.blocksDestroyed ?? 0);

    return summary;
  }

  /** 局外商店购买装备（花费金币） */
  static buyGear(itemId, cost) {
    if (!Save.spendCoins(cost)) return { ok: false, reason: 'insufficient_coins' };
    if (!Save.addToInventory(itemId)) return { ok: false, reason: 'already_owned' };
    return { ok: true };
  }

  /** 局外升级装备 */
  static upgradeGear(itemId) {
    const lv = Save.getUpgradeLevel(itemId);
    if (lv >= 5) return { ok: false, reason: 'max_level' };
    const UPGRADE_COSTS = [0, 100, 250, 500, 1000];
    const cost = UPGRADE_COSTS[lv] ?? 9999;
    const ok = Save.upgradeItem(itemId, cost);
    return ok ? { ok: true, newLevel: lv + 1, cost } : { ok: false, reason: 'insufficient_coins' };
  }

  /** 图鉴碎片兑换宝石 */
  static exchangeFragmentsForGems(collectableId, count) {
    const def = COLLECTION_TABLE[collectableId];
    if (!def?.gemValue) return { ok: false };
    const frags = Collection.getFragments(collectableId);
    if (frags < count) return { ok: false, reason: 'not_enough' };
    const gems = count * def.gemValue;
    Save.addGems(gems);
    const newFrags = (Save.get('fragments') ?? {});
    newFrags[collectableId] = frags - count;
    Save.set('fragments', newFrags);
    return { ok: true, gems };
  }
}
