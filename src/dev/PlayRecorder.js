/**
 * 手动打关过程录制器
 *
 * 使用方法：
 *   1. DevTools 面板中点击「开始录制」
 *   2. 手动打关（正常点击 buffer / 队列部署车辆）
 *   3. 打完后点击「复制日志」或「导出 JSON」
 *
 * 记录内容：每次部署的时刻、来源（buffer/lane）、颜色、弹药数、
 *           当前轨道状态、当前方块数，以及每次击中/消色事件。
 */

export class PlayRecorder {
  constructor(scene) {
    this._scene   = scene;
    this._log     = [];       // 操作记录
    this._t0      = 0;        // 录制开始时间（ms）
    this._active  = false;
    this._panel   = null;     // HTML 浮层
    this._txLines = null;     // 日志显示区
    this._deployCount = 0;
    this._hitCount    = 0;

    this._buildPanel();
  }

  // ── 面板构建 ─────────────────────────────────────────────────

  _buildPanel() {
    const div = document.createElement('div');
    div.id = 'play-recorder';
    div.style.cssText = [
      'position:fixed',
      'left:8px',
      'top:120px',
      'width:220px',
      'max-height:480px',
      'background:rgba(0,0,0,0.88)',
      'border:1px solid #44aa88',
      'border-radius:6px',
      'font-family:monospace',
      'font-size:11px',
      'color:#aaffcc',
      'z-index:9999',
      'display:flex',
      'flex-direction:column',
      'user-select:none',
    ].join(';');

    // 标题栏
    const header = document.createElement('div');
    header.style.cssText = 'padding:6px 10px 4px;border-bottom:1px solid #335544;display:flex;justify-content:space-between;align-items:center;';
    header.innerHTML = '<span style="color:#66ffaa;font-weight:bold">📹 录制器</span>';

    // 按钮区
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:4px;padding:4px 6px;';

    this._btnToggle = this._makeBtn('开始录制', '#44aa66', () => this._toggleRecord());
    this._btnCopy   = this._makeBtn('复制日志', '#446688', () => this._copyLog());
    this._btnExport = this._makeBtn('导出JSON', '#664488', () => this._exportJson());
    this._btnClear  = this._makeBtn('清空', '#664444', () => this._clear());

    btnRow.append(this._btnToggle, this._btnCopy, this._btnExport, this._btnClear);

    // 统计行
    this._statLine = document.createElement('div');
    this._statLine.style.cssText = 'padding:2px 10px;color:#88ccaa;font-size:10px;';
    this._statLine.textContent = '等待录制...';

    // 日志区
    const logArea = document.createElement('div');
    logArea.style.cssText = [
      'flex:1',
      'overflow-y:auto',
      'padding:4px 8px',
      'font-size:10px',
      'line-height:1.5',
      'max-height:320px',
      'color:#ccffee',
    ].join(';');
    this._logArea = logArea;

    div.append(header, btnRow, this._statLine, logArea);
    document.body.appendChild(div);
    this._panel = div;
  }

  _makeBtn(label, bg, cb) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = [
      `background:${bg}`,
      'color:#fff',
      'border:none',
      'border-radius:3px',
      'padding:3px 5px',
      'font-size:10px',
      'font-family:monospace',
      'cursor:pointer',
      'flex:1',
    ].join(';');
    b.addEventListener('click', cb);
    return b;
  }

  // ── 录制控制 ─────────────────────────────────────────────────

  _toggleRecord() {
    if (this._active) {
      this._active = false;
      this._btnToggle.textContent = '开始录制';
      this._btnToggle.style.background = '#44aa66';
      this._appendLine('── 录制结束 ──', '#ffaa44');
      this._updateStat();
    } else {
      this._active = true;
      this._t0 = Date.now();
      this._deployCount = 0;
      this._hitCount    = 0;
      this._log = [];
      this._logArea.innerHTML = '';
      this._btnToggle.textContent = '⏹ 停止';
      this._btnToggle.style.background = '#aa4444';
      const logic = this._scene.logic;
      const snap  = this._snapshotState(logic);
      this._log.push({ type: 'start', t: 0, snap });
      this._appendLine(`▶ 开始 | 方块:${snap.blocks} | 轨道:${snap.trackN} | buffer:${snap.bufferN}`, '#66ffaa');
      this._updateStat();
    }
  }

  // ── 外部钩子：由 GameScene._handleClick 调用 ─────────────────

  /** 每次成功部署车辆时调用 */
  onDeploy(source, color, ammo, extra) {
    if (!this._active) return;
    const t    = Date.now() - this._t0;
    const logic = this._scene.logic;
    const snap  = this._snapshotState(logic);
    this._deployCount++;

    const entry = { type: 'deploy', t, source, color, ammo, ...extra, snap };
    this._log.push(entry);

    const srcLabel = source === 'buffer' ? `buf[${extra.idx}]` : `L${extra.laneIdx}`;
    const shortC   = color.slice(1);
    this._appendLine(
      `#${this._deployCount} +${(t/1000).toFixed(1)}s  ${srcLabel}  #${shortC}×${ammo}  轨:${snap.trackN}  剩:${snap.blocks}`,
      '#aaffcc'
    );
    this._updateStat();
  }

  /** 每次色块被消灭（pruneUseless 触发）时调用 */
  onColorCleared(color, remaining) {
    if (!this._active) return;
    const t = Date.now() - this._t0;
    this._log.push({ type: 'colorCleared', t, color, remaining });
    this._appendLine(`  ✓ #${color.slice(1)} 消除  剩${remaining}色`, '#ffff88');
  }

  /** 关卡结束（win/fail）时调用 */
  onEnd(result) {
    if (!this._active) return;
    const t = Date.now() - this._t0;
    this._log.push({ type: 'end', t, result });
    const label = result === 'win' ? '🏆 通关' : '✗ 失败';
    this._appendLine(`${label}  用时${(t/1000).toFixed(1)}s  共${this._deployCount}次部署`, '#ffaa44');
    this._active = false;
    this._btnToggle.textContent = '开始录制';
    this._btnToggle.style.background = '#44aa66';
    this._updateStat();
  }

  // ── 快照 ─────────────────────────────────────────────────────

  _snapshotState(logic) {
    const trackColors = logic.turrets.map(t => ({ color: t.color, ammo: t.ammo, pathPos: Math.round(t.pathPos) }));
    const bufColors   = logic.buffer.map(t => ({ color: t.color, ammo: t.ammo }));
    return {
      blocks:  logic.blocks.length,
      trackN:  logic.turrets.length,
      bufferN: logic.buffer.length,
      track:   trackColors,
      buffer:  bufColors,
    };
  }

  // ── 日志输出 ─────────────────────────────────────────────────

  _appendLine(text, color = '#ccffee') {
    const line = document.createElement('div');
    line.style.color = color;
    line.textContent = text;
    this._logArea.appendChild(line);
    this._logArea.scrollTop = this._logArea.scrollHeight;
  }

  _updateStat() {
    const n = this._log.filter(e => e.type === 'deploy').length;
    this._statLine.textContent = this._active
      ? `录制中… 已部署 ${n} 次`
      : `共 ${n} 次部署，${this._log.length} 条记录`;
  }

  _copyLog() {
    const lines = this._log.map(e => {
      if (e.type === 'start')        return `[START t=0] blocks=${e.snap.blocks}`;
      if (e.type === 'deploy')       return `[DEPLOY t=${e.t}ms] ${e.source} color=${e.color} ammo=${e.ammo} track=${e.snap.trackN} blocks=${e.snap.blocks}`;
      if (e.type === 'colorCleared') return `[CLEAR  t=${e.t}ms] color=${e.color} remaining=${e.remaining}`;
      if (e.type === 'end')          return `[END    t=${e.t}ms] result=${e.result}`;
      return JSON.stringify(e);
    });
    navigator.clipboard.writeText(lines.join('\n'))
      .then(() => { this._statLine.textContent = '已复制到剪贴板！'; setTimeout(() => this._updateStat(), 2000); });
  }

  _exportJson() {
    const json = JSON.stringify(this._log, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `play_record_L${(this._scene.levelIndex||0)+1}.json`;
    a.click(); URL.revokeObjectURL(url);
  }

  _clear() {
    this._log = [];
    this._logArea.innerHTML = '';
    this._deployCount = 0;
    this._statLine.textContent = '已清空';
  }

  destroy() {
    this._panel?.remove();
  }
}
