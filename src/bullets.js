import { G, BULLET_SPEED } from './constants.js';
import { turretScreen, blockScreen, hexNum } from './renderer.js';

export class BulletSystem {
  constructor(scene) {
    this.scene      = scene;
    this.vBullets   = [];
    this.vParticles = [];
  }

  reset() {
    this.vBullets   = [];
    this.vParticles = [];
  }

  // ── 每帧逻辑更新 ─────────────────────────────────────────────

  spawnFromLogic() {
    for (const b of this.scene.logic.flushPendingBullets()) {
      const from = turretScreen(b.fromPathPos);
      const to   = blockScreen(b.col, b.row);
      this.vBullets.push({
        x: from.x, y: from.y,
        tx: to.x,  ty: to.y,
        color: b.color, turretId: b.turretId,
        col: b.col, row: b.row,
        preFxDone: false,
      });
    }
  }

  moveBullets() {
    const PRE_FX_DIST = BULLET_SPEED * 6;
    const toHit = [];

    for (const vb of this.vBullets) {
      const dx   = vb.tx - vb.x;
      const dy   = vb.ty - vb.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= BULLET_SPEED) {
        toHit.push(vb);
      } else {
        vb.x += (dx / dist) * BULLET_SPEED;
        vb.y += (dy / dist) * BULLET_SPEED;
        if (!vb.preFxDone && dist <= PRE_FX_DIST) {
          vb.preFxDone = true;
          this._spawnPreFx(vb.tx, vb.ty, vb.color);
        }
      }
    }

    for (const vb of toHit) {
      this.vBullets = this.vBullets.filter(b => b !== vb);
      this._spawnHitFx(vb.tx, vb.ty, vb.color);
      this.scene.logic.onBulletHit(vb.turretId, vb.col, vb.row);
    }
  }

  // ── 渲染（由 Renderer.render 调用）──────────────────────────

  draw(g) {
    this._drawBullets(g);
    this._updateParticles(g);
  }

  _drawBullets(g) {
    for (const vb of this.vBullets) {
      const c = hexNum(vb.color);
      g.fillStyle(0xffffff, 0.9); g.fillCircle(vb.x, vb.y, 5);
      g.fillStyle(c, 1);          g.fillCircle(vb.x, vb.y, 3);
    }
  }

  _updateParticles(g) {
    const alive = [];
    for (const p of this.vParticles) {
      p.alpha -= p.fade ?? 0.055;
      if (p.alpha <= 0) continue;
      alive.push(p);
      const c = hexNum(p.color ?? '#ffffff');

      if (p.kind === 'flash') {
        g.fillStyle(0xffffff, p.alpha);
        g.fillCircle(p.x, p.y, p.radius);

      } else if (p.kind === 'ring') {
        if (p.expand) p.radius += (p.targetR - p.radius) * 0.25;
        else          p.radius += (p.targetR - p.radius) * 0.35;
        g.lineStyle(p.lineW, c, p.alpha);
        g.strokeCircle(p.x, p.y, Math.max(1, p.radius));
        g.lineStyle(p.lineW * 0.5, 0xffffff, p.alpha * 0.5);
        g.strokeCircle(p.x, p.y, Math.max(1, p.radius));

      } else if (p.kind === 'spark') {
        p.x += p.vx; p.y += p.vy;
        p.vx *= p.friction; p.vy *= p.friction;
        g.fillStyle(0xffffff, p.alpha * 0.75); g.fillCircle(p.x, p.y, p.size + 1.5);
        g.fillStyle(c, p.alpha);               g.fillCircle(p.x, p.y, p.size);

      } else if (p.kind === 'chip') {
        p.x += p.vx; p.y += p.vy;
        p.vx *= p.friction; p.vy *= p.friction;
        p.rot += p.rotV;
        const hw = p.w / 2, hh = p.h / 2;
        const cos = Math.cos(p.rot), sin = Math.sin(p.rot);
        const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([lx, ly]) => ({
          x: p.x + lx * cos - ly * sin,
          y: p.y + lx * sin + ly * cos,
        }));
        g.fillStyle(c, p.alpha);            g.fillPoints(pts, true);
        g.fillStyle(0xffffff, p.alpha * 0.4); g.fillPoints(pts, true);
      }
    }
    this.vParticles = alive;
  }

  // ── 特效生成 ─────────────────────────────────────────────────

  _spawnPreFx(x, y, color) {
    const { CELL } = G;
    this.vParticles.push({
      kind: 'ring', x, y, color,
      radius: CELL * 1.2, targetR: CELL * 0.3,
      alpha: 0.9, lineW: 2.5, fade: 0.10,
    });
  }

  _spawnHitFx(x, y, color) {
    const { CELL } = G;
    const s = CELL / 18;
    for (let i = 0; i < 2; i++) {
      this.vParticles.push({
        kind: 'ring', x, y, color,
        radius: i * 4 * s, targetR: CELL * 2.2,
        alpha: 0.85 - i * 0.15, lineW: (3 - i * 0.8) * s,
        fade: 0.045, expand: true,
      });
    }
    this.vParticles.push({
      kind: 'flash', x, y,
      radius: CELL * 0.9, alpha: 1, fade: 0.18,
    });
    const SPARKS = 14;
    for (let i = 0; i < SPARKS; i++) {
      const angle = (Math.PI * 2 / SPARKS) * i + (Math.random() - 0.5) * 0.5;
      const speed = (3.5 + Math.random() * 4.5) * s;
      this.vParticles.push({
        kind: 'spark', x, y,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        color, alpha: 1,
        size: (2.5 + Math.random() * 2.5) * s,
        fade: 0.038 + Math.random() * 0.02, friction: 0.84,
      });
    }
    for (let i = 0; i < 6; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (2 + Math.random() * 3) * s;
      this.vParticles.push({
        kind: 'chip',
        x: x + (Math.random() - 0.5) * CELL * 0.6,
        y: y + (Math.random() - 0.5) * CELL * 0.6,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        color, alpha: 1,
        w: (3 + Math.random() * 3) * s, h: (3 + Math.random() * 3) * s,
        rot: Math.random() * Math.PI * 2,
        rotV: (Math.random() - 0.5) * 0.3,
        fade: 0.045, friction: 0.80,
      });
    }
  }

  // 外部调用（道具特效用）
  spawnFlash(x, y) {
    const fx = this.scene.add.graphics().setDepth(5);
    fx.fillStyle(0xffffff, 0.7);
    fx.fillCircle(x, y, 18);
    this.scene.tweens.add({
      targets: fx,
      alpha: 0, scaleX: 2, scaleY: 2,
      duration: 250, ease: 'Quad.easeOut',
      onComplete: () => fx.destroy(),
    });
  }
}
