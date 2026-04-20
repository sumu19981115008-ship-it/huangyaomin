/**
 * 弹幕系统
 * 根据装备的弹幕模式，将单次"射击意图"展开为多颗子弹
 */
export class BarrelSystem {
  /**
   * @param {object} stats - EquipmentSystem.stats
   * @returns {Function} shoot(baseIntent) → Bullet[]
   */
  buildShooter(stats) {
    const { barrelPattern, bulletCount, bulletSpread, bulletPiercing } = stats;

    return (intent) => {
      const bullets = [];
      const base = { ...intent, piercing: bulletPiercing };

      switch (barrelPattern) {
        case 'double':
          bullets.push({ ...base, offsetSlot: -1 });
          bullets.push({ ...base, offsetSlot:  1 });
          break;

        case 'triple':
          bullets.push({ ...base, offsetSlot: -1 });
          bullets.push({ ...base, offsetSlot:  0 });
          bullets.push({ ...base, offsetSlot:  1 });
          break;

        case 'spread': {
          // N 发扇形，角度由 bulletSpread 控制（此处用 offsetSlot 模拟）
          const n = Math.max(2, bulletCount);
          const half = Math.floor(n / 2);
          for (let i = -half; i <= half; i++) {
            bullets.push({ ...base, offsetSlot: i });
          }
          break;
        }

        case 'ring': {
          // 四方向同时射
          bullets.push({ ...base, direction: 'up'    });
          bullets.push({ ...base, direction: 'down'  });
          bullets.push({ ...base, direction: 'left'  });
          bullets.push({ ...base, direction: 'right' });
          break;
        }

        case 'single':
        default:
          bullets.push({ ...base, offsetSlot: 0 });
          break;
      }

      return bullets;
    };
  }
}
