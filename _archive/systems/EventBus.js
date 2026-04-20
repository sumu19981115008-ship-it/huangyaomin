/**
 * 全局事件总线，解耦各系统间通信
 */
class EventBus {
  constructor() {
    this._listeners = {};
  }

  on(event, fn) {
    (this._listeners[event] ??= []).push(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(f => f !== fn);
  }

  emit(event, ...args) {
    (this._listeners[event] ?? []).forEach(fn => fn(...args));
  }

  once(event, fn) {
    const wrapper = (...args) => { fn(...args); this.off(event, wrapper); };
    this.on(event, wrapper);
  }
}

export const Bus = new EventBus();

// 事件名常量
export const EV = {
  // 局内事件
  BULLET_HIT:        'bullet:hit',
  BLOCK_DESTROYED:   'block:destroyed',
  SPECIAL_TRIGGERED: 'special:triggered',
  LEVEL_WIN:         'level:win',
  LEVEL_FAIL:        'level:fail',
  COINS_EARNED:      'coins:earned',      // { amount }
  ITEM_DROPPED:      'item:dropped',      // { itemId, col, row }

  // 局外事件
  SAVE_UPDATED:      'save:updated',
  EQUIPMENT_CHANGED: 'equipment:changed',
  COLLECTION_UPDATED:'collection:updated',
};
