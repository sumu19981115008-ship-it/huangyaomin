import { GameScene } from './GameScene.js';
import { VW, VH }   from './constants.js';

const config = {
  type: Phaser.AUTO,
  width: VW,
  height: VH,
  backgroundColor: '#0d0d1a',
  scene: [GameScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: {
    antialias: true,
    pixelArt: false,
  },
};

new Phaser.Game(config);
