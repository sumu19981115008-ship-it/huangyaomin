/**
 * 特殊方块数据表
 * 关卡 JSON 中方块带 "special": "bomb" 等字段时激活
 */
export const SPECIAL_BLOCK_TABLE = {

  bomb: {
    name: '炸弹方块',
    desc: '消除时爆炸，清除周围 2 格范围内的所有方块',
    color: '#FF4444',
    icon: '💣',
    effect: 'bomb',
    radius: 2,
  },

  row_clear: {
    name: '横扫方块',
    desc: '消除时清空整行',
    color: '#FF8800',
    icon: '↔',
    effect: 'row_clear',
  },

  col_clear: {
    name: '纵扫方块',
    desc: '消除时清空整列',
    color: '#FFAA00',
    icon: '↕',
    effect: 'col_clear',
  },

  color_clear: {
    name: '同色清除方块',
    desc: '消除时清空所有同色方块',
    color: '#AA44FF',
    icon: '🎨',
    effect: 'color_clear',
  },

  coin_burst: {
    name: '金币方块',
    desc: '消除时爆出 20 枚金币',
    color: '#FFD700',
    icon: '💰',
    effect: 'coin_burst',
    coinAmount: 20,
  },

  coin_burst_big: {
    name: '大金币方块',
    desc: '消除时爆出 50 枚金币',
    color: '#FFC000',
    icon: '💎',
    effect: 'coin_burst',
    coinAmount: 50,
  },

  drop_gear: {
    name: '装备方块',
    desc: '消除时随机掉落一件装备',
    color: '#44AAFF',
    icon: '⚙',
    effect: 'drop_item',
    dropId: '__random_gear__',
  },

  drop_collection: {
    name: '图鉴方块',
    desc: '消除时掉落一枚图鉴碎片',
    color: '#44FF88',
    icon: '📖',
    effect: 'drop_item',
    dropId: '__random_collection__',
  },

  shield: {
    name: '护盾方块',
    desc: '消除时激活一次溢出保护',
    color: '#4488FF',
    icon: '🛡',
    effect: 'shield',
  },

  multiplier: {
    name: '倍率方块',
    desc: '消除时金币倍率 ×2，持续 3 秒',
    color: '#FF44AA',
    icon: '×2',
    effect: 'multiplier',
    multiplier: 2,
    ticks: 180,
  },
};
