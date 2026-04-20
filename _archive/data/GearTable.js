/**
 * 装备数据表
 * slot: barrel(炮管) | core(核心) | charm(护符)
 */
export const GEAR_TABLE = {

  // ═══ 炮管（影响弹幕模式）═══

  barrel_basic: {
    slot: 'barrel', name: '基础炮管', rarity: 'common',
    desc: '单发直射，无特殊效果',
    barrelPattern: 'single',
    cost: 0,
  },
  barrel_double: {
    slot: 'barrel', name: '双管炮', rarity: 'rare',
    desc: '同时射出 ±1 格的两颗子弹',
    barrelPattern: 'double',
    cost: 200,
  },
  barrel_triple: {
    slot: 'barrel', name: '三管炮', rarity: 'rare',
    desc: '射出 -1/0/+1 三颗子弹',
    barrelPattern: 'triple',
    cost: 400,
  },
  barrel_spread: {
    slot: 'barrel', name: '散弹炮', rarity: 'epic',
    desc: '射出 5 颗扇形子弹',
    barrelPattern: 'spread',
    bulletCount: 5,
    cost: 800,
  },
  barrel_ring: {
    slot: 'barrel', name: '环形炮', rarity: 'epic',
    desc: '向四个方向同时射击',
    barrelPattern: 'ring',
    cost: 1200,
  },
  barrel_pierce: {
    slot: 'barrel', name: '穿甲炮管', rarity: 'legendary',
    desc: '子弹可穿透异色方块',
    barrelPattern: 'single',
    bulletPiercing: true,
    cost: 2000,
  },

  // ═══ 核心（影响数值属性）═══

  core_gold: {
    slot: 'core', name: '黄金核心', rarity: 'rare',
    desc: '金币获取 ×1.5',
    coinMultiplier: 1.5,
    cost: 300,
  },
  core_turbo: {
    slot: 'core', name: '涡轮核心', rarity: 'rare',
    desc: '炮台移动速度 +30%（暂存区判定宽松）',
    turretSpeedBonus: 0.3,
    cost: 350,
  },
  core_magnet: {
    slot: 'core', name: '磁力核心', rarity: 'epic',
    desc: '金币吸附范围 ×3',
    coinMagnet: 3,
    cost: 600,
  },
  core_fortune: {
    slot: 'core', name: '幸运核心', rarity: 'epic',
    desc: '特殊方块触发概率 +20%',
    specialChance: 0.2,
    cost: 700,
  },
  core_diamond: {
    slot: 'core', name: '钻石核心', rarity: 'legendary',
    desc: '金币 ×2 + 特殊触发 +10%',
    coinMultiplier: 2.0,
    specialChance: 0.1,
    cost: 1800,
  },

  // ═══ 护符（触发特殊时机效果）═══

  charm_shield: {
    slot: 'charm', name: '护盾护符', rarity: 'common',
    desc: '每关开始时获得一次溢出保护',
    charmEffect: 'shield',
    cost: 150,
  },
  charm_bomb: {
    slot: 'charm', name: '爆炸护符', rarity: 'rare',
    desc: '暂存区满时，随机消除一个方块',
    charmEffect: 'auto_bomb',
    cost: 500,
  },
  charm_magnet: {
    slot: 'charm', name: '召唤护符', rarity: 'epic',
    desc: '每消除 20 块，召唤一颗全色子弹',
    charmEffect: 'rainbow_bullet',
    cost: 900,
  },
  charm_phoenix: {
    slot: 'charm', name: '凤凰护符', rarity: 'legendary',
    desc: '失败时自动复活一次（每关一次）',
    charmEffect: 'revive',
    cost: 2500,
  },
};

/** 按 slot 分类获取 */
export function getGearBySlot(slot) {
  return Object.entries(GEAR_TABLE)
    .filter(([, v]) => v.slot === slot)
    .map(([id, v]) => ({ id, ...v }));
}
