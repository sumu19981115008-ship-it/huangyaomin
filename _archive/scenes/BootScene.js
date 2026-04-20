import { Save } from '../systems/SaveSystem.js';

/**
 * 启动场景：加载存档 → 跳转主菜单
 */
export class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }

  create() {
    Save.load();
    this.scene.start('Menu');
  }
}
