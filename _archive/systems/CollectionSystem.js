import { Save } from './SaveSystem.js';
import { Bus, EV } from './EventBus.js';
import { COLLECTION_TABLE } from '../data/CollectionTable.js';

/**
 * 局外收集系统（图鉴）
 * 管理碎片积累、图鉴解锁
 */
class CollectionSystem {
  /** 添加碎片，返回是否触发新解锁 */
  addFragment(collectableId, count = 1) {
    const def = COLLECTION_TABLE[collectableId];
    if (!def) return false;

    const save = Save.load();
    // 碎片存储
    const frags = save.fragments ?? {};
    frags[collectableId] = (frags[collectableId] ?? 0) + count;
    Save.set('fragments', frags);

    // 检查是否满足解锁条件
    if (frags[collectableId] >= def.requiredFragments) {
      return Save.unlockCollectable(collectableId);
    }
    return false;
  }

  getFragments(collectableId) {
    return (Save.get('fragments') ?? {})[collectableId] ?? 0;
  }

  isUnlocked(collectableId) {
    return (Save.get('collection') ?? []).includes(collectableId);
  }

  /** 返回所有图鉴条目及进度 */
  getAllEntries() {
    const frags = Save.get('fragments') ?? {};
    const unlocked = Save.get('collection') ?? [];
    return Object.entries(COLLECTION_TABLE).map(([id, def]) => ({
      id,
      name:     def.name,
      desc:     def.desc,
      category: def.category,
      icon:     def.icon,
      unlocked: unlocked.includes(id),
      fragments:        frags[id] ?? 0,
      requiredFragments: def.requiredFragments,
    }));
  }

  /** 局结束时：将本局掉落的收集品转入存档 */
  commitSessionDrops(drops) {
    let newUnlocks = 0;
    for (const { id, count } of drops) {
      if (this.addFragment(id, count)) newUnlocks++;
    }
    return newUnlocks;
  }
}

export const Collection = new CollectionSystem();
