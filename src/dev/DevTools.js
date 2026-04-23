/**
 * 开发辅助工具（仅开发模式可见）
 * 打包时设置 VITE_DEV_TOOLS=false 或直接 vite build 即可排除
 */

// Vite 开发模式自动为 true；serve.ps1 静态服务时手动设为 true 调试
const ENABLED = (typeof import.meta !== 'undefined' && import.meta.env?.DEV)
  || (typeof window !== 'undefined' && window.__DEV_TOOLS__ === true);

export class DevTools {
  /**
   * @param {Phaser.Scene} scene  - GameScene 实例
   * @param {object} opts
   * @param {number}  opts.totalLevels  - 关卡总数
   * @param {Function} opts.onJump      - (levelIndex: number) => void
   */
  constructor(scene, { totalLevels, onJump }) {
    if (!ENABLED) return;

    this._scene      = scene;
    this._totalLevels = totalLevels;
    this._onJump     = onJump;
    this._panel      = null;
    this._visible    = false;
    this._zones      = [];

    this._build();
  }

  _build() {
    const VW = this._scene.scale.width;
    const VH = this._scene.scale.height;

    // 触发按钮移到左下角，不与右上角工具栏冲突
    const btn = this._scene.add.text(8, VH - 8, '[DEV]', {
      fontSize: '11px', fontFamily: 'monospace',
      color: '#ff4444', backgroundColor: '#00000088',
      padding: { x: 4, y: 2 },
    }).setOrigin(0, 1).setDepth(100).setInteractive({ useHandCursor: true });

    btn.on('pointerdown', () => this._toggle());

    // 面板容器（默认隐藏）
    this._panel = this._scene.add.container(0, 0).setDepth(99).setVisible(false);
    this._buildPanel();

    // 遮罩：面板关闭时覆盖在 zone 上方，吃掉所有穿透点击
    const panelW = 200, panelH = 348;
    const mx = VW - panelW - 8, my = 28;
    this._mask = this._scene.add.zone(mx, my, panelW, panelH)
      .setOrigin(0).setDepth(102).setInteractive();
  }

  _buildPanel() {
    const VW = this._scene.scale.width;
    const panelW = 200, panelH = 348;
    const px = VW - panelW - 8, py = 28;

    // 背景
    const bg = this._scene.add.graphics();
    bg.fillStyle(0x000000, 0.88);
    bg.fillRoundedRect(px, py, panelW, panelH, 8);
    bg.lineStyle(1, 0xff4444, 0.8);
    bg.strokeRoundedRect(px, py, panelW, panelH, 8);
    this._panel.add(bg);

    // 标题
    this._panel.add(
      this._scene.add.text(px + panelW / 2, py + 14, '⚙ DEV TOOLS', {
        fontSize: '12px', fontFamily: 'monospace', color: '#ff8888',
      }).setOrigin(0.5)
    );

    // 当前关卡显示
    this._txCurrent = this._scene.add.text(px + panelW / 2, py + 34, '', {
      fontSize: '11px', fontFamily: 'monospace', color: '#aaaaaa',
    }).setOrigin(0.5);
    this._panel.add(this._txCurrent);

    // 输入框（用 HTML input 模拟）
    this._panel.add(
      this._scene.add.text(px + 12, py + 54, '跳转到关卡：', {
        fontSize: '11px', fontFamily: 'monospace', color: '#cccccc',
      })
    );

    // ±1 快捷按钮
    this._addBtn(px + 12,  py + 74, '◀ 上一关', () => this._jump(this._cur - 1));
    this._addBtn(px + 108, py + 74, '下一关 ▶', () => this._jump(this._cur + 1));

    // 数字跳关按钮（每行5个，最多2行 = 10格 + 分页）
    this._buildLevelGrid(px + 8, py + 110, panelW - 16);

    // 重载当前关
    this._addBtn(px + 12, py + panelH - 64, '🔄 重载本关', () => this._jump(this._cur));

    // 打开编辑器
    this._addBtn(px + 12, py + panelH - 36, '✏ 编辑器', () => window.open('/editor.html', '_blank'), 84);
    this._addBtn(px + 108, py + panelH - 36, '🖼 像素工具', () => window.open('/pixel-tool.html', '_blank'), 84);
  }

  _buildLevelGrid(x, y, w) {
    const COLS = 5;
    const btnW = Math.floor(w / COLS) - 2;
    const btnH = 26;
    const GAP  = 2;
    const PAGE_SIZE = 10;

    this._gridPage = 0;
    this._gridBtns = [];

    for (let i = 0; i < PAGE_SIZE; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const bx = x + col * (btnW + GAP);
      const by = y + row * (btnH + GAP);

      const bg = this._scene.add.graphics();
      const tx = this._scene.add.text(bx + btnW / 2, by + btnH / 2, '', {
        fontSize: '11px', fontFamily: 'monospace', color: '#ffffff',
      }).setOrigin(0.5).setDepth(101);

      const zone = this._scene.add.zone(bx, by, btnW, btnH)
        .setOrigin(0).setInteractive({ useHandCursor: true }).setDepth(101);

      const idx = i;
      zone.on('pointerdown', () => {
        const lvl = this._gridPage * PAGE_SIZE + idx;
        if (lvl < this._totalLevels) this._jump(lvl);
      });

      this._panel.add([bg, tx]);
      this._zones.push(zone);
      this._gridBtns.push({ bg, tx, zone, bx, by, w: btnW, h: btnH });
    }

    // 翻页按钮
    const pageY = y + (btnH + GAP) * 2 + 6;
    this._txPage = this._scene.add.text(x + w / 2, pageY, '', {
      fontSize: '11px', fontFamily: 'monospace', color: '#888888',
    }).setOrigin(0.5);
    this._panel.add(this._txPage);

    this._addBtn(x,         pageY - 2, '«', () => this._changePage(-1), 28);
    this._addBtn(x + w - 30, pageY - 2, '»', () => this._changePage(+1), 28);
  }

  _changePage(dir) {
    const maxPage = Math.ceil(this._totalLevels / 10) - 1;
    this._gridPage = Math.max(0, Math.min(maxPage, this._gridPage + dir));
    this._refreshGrid();
  }

  _refreshGrid() {
    const PAGE_SIZE = 10;
    const offset = this._gridPage * PAGE_SIZE;
    const maxPage = Math.ceil(this._totalLevels / PAGE_SIZE) - 1;
    this._txPage?.setText(`第 ${this._gridPage + 1} / ${maxPage + 1} 页`);

    for (let i = 0; i < this._gridBtns.length; i++) {
      const { bg, tx, bx, by, w, h } = this._gridBtns[i];
      const lvl = offset + i;
      const valid = lvl < this._totalLevels;
      const isCur = lvl === this._cur;

      bg.clear();
      if (valid) {
        bg.fillStyle(isCur ? 0x4466ff : 0x223344, 1);
        bg.fillRoundedRect(bx, by, w, h, 4);
        tx.setText(String(lvl + 1));
        tx.setColor(isCur ? '#ffffff' : '#aaaaaa');
      } else {
        bg.fillStyle(0x111111, 0.5);
        bg.fillRoundedRect(bx, by, w, h, 4);
        tx.setText('');
      }
    }
  }

  _addBtn(x, y, label, cb, width = 84) {
    const h = 24;
    const bg = this._scene.add.graphics();
    bg.fillStyle(0x223344, 1);
    bg.fillRoundedRect(x, y, width, h, 4);
    bg.lineStyle(1, 0x446688, 1);
    bg.strokeRoundedRect(x, y, width, h, 4);

    const tx = this._scene.add.text(x + width / 2, y + h / 2, label, {
      fontSize: '11px', fontFamily: 'monospace', color: '#aaddff',
    }).setOrigin(0.5).setDepth(101);

    const zone = this._scene.add.zone(x, y, width, h)
      .setOrigin(0).setInteractive({ useHandCursor: true }).setDepth(101);
    zone.on('pointerdown', cb);
    zone.on('pointerover',  () => { bg.clear(); bg.fillStyle(0x334466,1); bg.fillRoundedRect(x,y,width,h,4); });
    zone.on('pointerout',   () => { bg.clear(); bg.fillStyle(0x223344,1); bg.fillRoundedRect(x,y,width,h,4); });

    this._zones.push(zone);
    this._panel.add([bg, tx]);
  }

  _jump(idx) {
    const clamped = Math.max(0, Math.min(this._totalLevels - 1, idx));
    this._onJump(clamped);
    this._refreshCurrent(clamped);
  }

  _toggle() {
    this._visible = !this._visible;
    this._panel.setVisible(this._visible);
    for (const z of this._zones) {
      if (this._visible) z.setInteractive({ useHandCursor: true });
      else               z.setDepth(-1);
    }
    // 遮罩：面板关闭时启用（吃掉穿透点击），面板打开时禁用
    if (this._visible) this._mask.disableInteractive();
    else               this._mask.setInteractive();
    if (this._visible) {
      this._refreshCurrent(this._cur ?? 0);
      this._refreshGrid();
    }
  }

  /** GameScene 在每次加载关卡后调用，同步当前关卡索引 */
  sync(levelIndex) {
    this._cur = levelIndex;
    if (this._visible) {
      this._refreshCurrent(levelIndex);
      this._refreshGrid();
    }
  }

  /** 切换关卡组时更新总关卡数 */
  setTotalLevels(n) {
    this._totalLevels = n;
    this._refreshCurrent(this._cur ?? 0);
  }

  _refreshCurrent(idx) {
    this._txCurrent?.setText(`当前：Level ${idx + 1} / ${this._totalLevels}`);
  }

  /** 无效果的空实现（生产模式） */
  static noop() {
    return { sync() {} };
  }
}
