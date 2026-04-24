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

    // DEV 触发按钮放右上角工具栏同行，在"🤖 自动"左侧
    const btn = this._scene.add.text(VW - 8 - 82 - 8 - 48, 8, '[DEV]', {
      fontSize: '12px', fontFamily: 'monospace',
      color: '#ff4444', backgroundColor: '#00000099',
      padding: { x: 7, y: 4 },
    }).setOrigin(1, 0).setDepth(100).setInteractive({ useHandCursor: true });

    btn.on('pointerdown', () => this._toggle());

    // 面板容器（默认隐藏）
    this._panel = this._scene.add.container(0, 0).setDepth(99).setVisible(false);
    this._buildPanel();

    // 遮罩：面板关闭时覆盖在 zone 上方，吃掉所有穿透点击
    const panelW = 200, panelH = 240;
    const mx = VW - panelW - 8, my = 42;
    this._mask = this._scene.add.zone(mx, my, panelW, panelH)
      .setOrigin(0).setDepth(102).setInteractive();
  }

  _buildPanel() {
    const VW = this._scene.scale.width;
    const panelW = 200, panelH = 240;
    const px = VW - panelW - 8, py = 42;

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

    // ±1 快捷按钮
    this._addBtn(px + 12,  py + 54, '◀ 上一关', () => this._jump(this._cur - 1));
    this._addBtn(px + 108, py + 54, '下一关 ▶', () => this._jump(this._cur + 1));

    // 跳关下拉框（HTML select 叠加在画布上）
    this._buildSelect(px + 8, py + 90, panelW - 16);

    // 重载当前关
    this._addBtn(px + 12, py + panelH - 64, '🔄 重载本关', () => this._jump(this._cur));

    // 打开编辑器
    this._addBtn(px + 12, py + panelH - 36, '✏ 编辑器', () => window.open('/editor.html', '_blank'), 84);
    this._addBtn(px + 108, py + panelH - 36, '🖼 像素工具', () => window.open('/pixel-tool.html', '_blank'), 84);
  }

  _buildSelect(x, y, w) {
    const canvas = this._scene.sys.game.canvas;
    const rect   = canvas.getBoundingClientRect();
    const scaleX = rect.width  / this._scene.scale.width;
    const scaleY = rect.height / this._scene.scale.height;

    const sel = document.createElement('select');
    sel.style.cssText = [
      `position:fixed`,
      `left:${rect.left + x * scaleX}px`,
      `top:${rect.top  + y * scaleY}px`,
      `width:${w * scaleX}px`,
      `height:28px`,
      `font-size:13px`,
      `font-family:monospace`,
      `background:#112233`,
      `color:#aaddff`,
      `border:1px solid #446688`,
      `border-radius:4px`,
      `padding:0 4px`,
      `z-index:9999`,
      `display:none`,
      `cursor:pointer`,
    ].join(';');

    this._rebuildOptions(sel);

    sel.addEventListener('change', () => {
      this._jump(parseInt(sel.value, 10));
    });

    document.body.appendChild(sel);
    this._select = sel;
  }

  _rebuildOptions(sel) {
    sel = sel ?? this._select;
    if (!sel) return;
    sel.innerHTML = '';
    for (let i = 0; i < this._totalLevels; i++) {
      const opt = document.createElement('option');
      opt.value       = String(i);
      opt.textContent = `Level ${i + 1}`;
      sel.appendChild(opt);
    }
  }

  _refreshSelect() {
    if (!this._select) return;
    this._select.value = String(this._cur ?? 0);
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
    if (this._select) this._select.style.display = this._visible ? 'block' : 'none';
    if (this._visible) {
      this._refreshCurrent(this._cur ?? 0);
      this._refreshSelect();
    }
  }

  /** GameScene 在每次加载关卡后调用，同步当前关卡索引 */
  sync(levelIndex) {
    this._cur = levelIndex;
    if (this._visible) {
      this._refreshCurrent(levelIndex);
      this._refreshSelect();
    }
  }

  /** 切换关卡组时更新总关卡数 */
  setTotalLevels(n) {
    this._totalLevels = n;
    this._rebuildOptions();
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
