import { Bus, EV }             from './EventBus.js';
import { SPECIAL_BLOCK_TABLE } from '../data/SpecialBlockTable.js';
import { GW, GH }              from '../constants.js';

/**
 * 特殊方块系统
 * 在 GameLogic 消除方块后，检查是否触发特殊效果
 */
export class SpecialBlockSystem {
  constructor(logic) {
    this.logic = logic;   // GameLogic 引用，用于操作 grid/blocks
  }

  /**
   * 方块被消除时调用
   * @param {object} block - { x, y, color, special }
   * @returns {object[]} 额外产生的视觉事件列表（供 GameScene 渲染）
   */
  trigger(block, stats) {
    if (!block.special) return [];
    const def = SPECIAL_BLOCK_TABLE[block.special];
    if (!def) return [];

    const events = [];

    switch (def.effect) {
      case 'bomb':
        // 爆炸：消除周围 N 格
        events.push(...this._explode(block.x, block.y, def.radius ?? 1));
        break;

      case 'row_clear':
        // 清除整行
        events.push(...this._clearRow(block.y));
        break;

      case 'col_clear':
        // 清除整列
        events.push(...this._clearCol(block.x));
        break;

      case 'color_clear':
        // 清除同色所有方块
        events.push(...this._clearColor(block.color));
        break;

      case 'coin_burst':
        // 爆出额外金币
        Bus.emit(EV.COINS_EARNED, { amount: def.coinAmount ?? 10 });
        events.push({ type: 'coin_burst', x: block.x, y: block.y, amount: def.coinAmount ?? 10 });
        break;

      case 'drop_item':
        // 掉落装备/收集品
        Bus.emit(EV.ITEM_DROPPED, { itemId: def.dropId, col: block.x, row: block.y });
        events.push({ type: 'item_drop', x: block.x, y: block.y, itemId: def.dropId });
        break;

      case 'shield':
        // 护盾：保护暂存区一次溢出（由 GameLogic 检查 shieldActive）
        this.logic.shieldActive = true;
        events.push({ type: 'shield_activate', x: block.x, y: block.y });
        break;

      case 'multiplier':
        // 短时金币倍率 ×2
        this.logic.tempCoinMultiplier = (def.multiplier ?? 2);
        this.logic.tempMultiplierTicks = def.ticks ?? 180;
        events.push({ type: 'multiplier', x: block.x, y: block.y, value: def.multiplier ?? 2 });
        break;
    }

    // 额外特效触发后发送事件
    if (events.length > 0) {
      Bus.emit(EV.SPECIAL_TRIGGERED, { block, effect: def.effect, events });
    }

    return events;
  }

  _explode(cx, cy, radius) {
    const events = [];
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx === 0 && dy === 0) continue;
        const col = cx + dx, row = cy + dy;
        if (this.logic.grid[row]?.[col] != null) {
          const color = this.logic.grid[row][col];
          this.logic.grid[row][col] = null;
          const idx = this.logic.blocks.findIndex(b => b.x === col && b.y === row);
          if (idx !== -1) this.logic.blocks.splice(idx, 1);
          events.push({ type: 'explode', x: col, y: row, color });
          Bus.emit(EV.BLOCK_DESTROYED, { x: col, y: row, color });
        }
      }
    }
    return events;
  }

  _clearRow(row) {
    const events = [];
    for (let col = 0; col < GW; col++) {
      if (this.logic.grid[row]?.[col] != null) {
        const color = this.logic.grid[row][col];
        this.logic.grid[row][col] = null;
        const idx = this.logic.blocks.findIndex(b => b.x === col && b.y === row);
        if (idx !== -1) this.logic.blocks.splice(idx, 1);
        events.push({ type: 'row_clear', x: col, y: row, color });
        Bus.emit(EV.BLOCK_DESTROYED, { x: col, y: row, color });
      }
    }
    return events;
  }

  _clearCol(col) {
    const events = [];
    for (let row = 0; row < GH; row++) {
      if (this.logic.grid[row]?.[col] != null) {
        const color = this.logic.grid[row][col];
        this.logic.grid[row][col] = null;
        const idx = this.logic.blocks.findIndex(b => b.x === col && b.y === row);
        if (idx !== -1) this.logic.blocks.splice(idx, 1);
        events.push({ type: 'col_clear', x: col, y: row, color });
        Bus.emit(EV.BLOCK_DESTROYED, { x: col, y: row, color });
      }
    }
    return events;
  }

  _clearColor(color) {
    const events = [];
    const targets = this.logic.blocks.filter(b => b.color === color);
    for (const b of targets) {
      this.logic.grid[b.y][b.x] = null;
      events.push({ type: 'color_clear', x: b.x, y: b.y, color });
      Bus.emit(EV.BLOCK_DESTROYED, { x: b.x, y: b.y, color });
    }
    this.logic.blocks = this.logic.blocks.filter(b => b.color !== color);
    return events;
  }
}
