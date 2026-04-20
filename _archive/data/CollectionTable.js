/**
 * 局外收集图鉴数据表
 * category: pixel(像素生物) | weapon(武器) | element(元素) | trophy(奖杯)
 */
export const COLLECTION_TABLE = {

  // ── 像素生物 ──
  pixel_slime: {
    name: '像素史莱姆', category: 'pixel', icon: '🟢',
    desc: '最常见的像素生物，喜欢方块',
    requiredFragments: 5, gemValue: 1,
  },
  pixel_dragon: {
    name: '像素龙', category: 'pixel', icon: '🐉',
    desc: '稀有的像素龙，据说能喷出彩色火焰',
    requiredFragments: 20, gemValue: 5,
  },
  pixel_cat: {
    name: '像素猫', category: 'pixel', icon: '🐱',
    desc: '温顺的像素猫，会带来好运',
    requiredFragments: 8, gemValue: 2,
  },
  pixel_robot: {
    name: '像素机器人', category: 'pixel', icon: '🤖',
    desc: '精密的像素机器人，能精准射击',
    requiredFragments: 15, gemValue: 4,
  },

  // ── 武器 ──
  weapon_cannon: {
    name: '古典加农炮', category: 'weapon', icon: '🔫',
    desc: '最原始的炮管设计，简单而可靠',
    requiredFragments: 3, gemValue: 1,
  },
  weapon_laser: {
    name: '激光炮', category: 'weapon', icon: '⚡',
    desc: '高科技激光武器，可穿透方块',
    requiredFragments: 25, gemValue: 8,
  },
  weapon_rainbow: {
    name: '彩虹炮', category: 'weapon', icon: '🌈',
    desc: '传说中的武器，能射出任意颜色',
    requiredFragments: 50, gemValue: 20,
  },

  // ── 元素 ──
  element_fire: {
    name: '火焰晶体', category: 'element', icon: '🔥',
    desc: '蕴含火焰能量的神秘晶体',
    requiredFragments: 10, gemValue: 3,
  },
  element_ice: {
    name: '冰霜晶体', category: 'element', icon: '❄',
    desc: '永不融化的冰霜结晶',
    requiredFragments: 10, gemValue: 3,
  },
  element_thunder: {
    name: '雷电晶体', category: 'element', icon: '⚡',
    desc: '储存了闪电能量的晶体',
    requiredFragments: 10, gemValue: 3,
  },
  element_void: {
    name: '虚空晶体', category: 'element', icon: '🌑',
    desc: '来自虚空的神秘能量，极为稀有',
    requiredFragments: 40, gemValue: 15,
  },

  // ── 奖杯 ──
  trophy_bronze: {
    name: '铜质奖杯', category: 'trophy', icon: '🥉',
    desc: '完成 10 关的证明',
    requiredFragments: 1, gemValue: 2,
  },
  trophy_silver: {
    name: '银质奖杯', category: 'trophy', icon: '🥈',
    desc: '完成 50 关的证明',
    requiredFragments: 1, gemValue: 5,
  },
  trophy_gold: {
    name: '金质奖杯', category: 'trophy', icon: '🥇',
    desc: '完成 100 关的证明',
    requiredFragments: 1, gemValue: 10,
  },
  trophy_rainbow: {
    name: '彩虹奖杯', category: 'trophy', icon: '🏆',
    desc: '完成全部关卡，传说级成就',
    requiredFragments: 1, gemValue: 50,
  },
};
