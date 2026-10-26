/* ── Interactive topographic contour background ──────────────
   Draws elevation contours over the hero with marching squares.
   The terrain is slow-drifting fractal noise. The cursor gently
   lifts a broad rise that trails a soft, continuous wake behind it,
   and warms the contour lines nearby. */
(function () {
  const canvas = document.getElementById('hero-topo');
  if (!canvas) return;
  const hero = canvas.closest('.hero');
  const ctx = canvas.getContext('2d');

  const LINE_RGB = '74, 124, 111';  // --accent
  const WARM_RGB = '196, 114, 74';  // --accent-warm
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const CELL = 14;            // sample spacing in CSS px
  const LEVEL_STEP = 0.11;    // spacing between contour lines
  const INDEX_EVERY = 5;      // every Nth line is a heavier index contour

  let dpr = 1, width = 0, height = 0, cols = 0, rows = 0;
  let field = new Float32Array(0);

  const pointer = { x: 0, y: 0, inside: false };
  const smooth = { x: 0, y: 0 };   // where the rise sits
  const wake = { x: 0, y: 0 };     // lags further behind to stretch a ridge
  let presence = 0;                // 0..1, eases in/out as cursor enters/leaves
  let lastFrame = null;

  let running = true;
  let rafId = null;

  /* ── Value noise + fbm ───────────────────────────────────── */
  const perm = new Uint8Array(512);
  (function seed() {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    let s = 1337;
    for (let i = 255; i > 0; i--) {
      s = (s * 16807) % 2147483647;
      const j = s % (i + 1);
      const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
    }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  })();

  const fade = (t) => t * t * (3 - 2 * t);
  const hash = (ix, iy) => perm[(perm[ix & 255] + iy) & 511] / 255;

  function noise(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = fade(x - ix), fy = fade(y - iy);
    const a = hash(ix, iy), b = hash(ix + 1, iy);
    const c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
  }

  function fbm(x, y) {
    return noise(x, y) * 0.6 + noise(x * 2.03 + 17.1, y * 2.03 - 9.4) * 0.28 +
           noise(x * 4.11 - 31.7, y * 4.11 + 5.3) * 0.12;
  }

  /* ── Terrain ─────────────────────────────────────────────── */
  function baseHeight(x, y, time) {
    const s = 0.0032;
    // gentle domain warp so the terrain slowly reshapes rather than scrolls
    const wx = noise(x * s * 0.7 + time * 0.02, y * s * 0.7) * 1.4;
    const wy = noise(x * s * 0.7 - 11.3, y * s * 0.7 + time * 0.017) * 1.4;
    return fbm(x * s + wx + time * 0.008, y * s + wy) * 2.2;
  }

  function bump(x, y, cx, cy, sig) {
    const dx = x - cx, dy = y - cy;
    return Math.exp(-(dx * dx + dy * dy) / (2 * sig * sig));
  }

  function heightAt(x, y, time) {
    let h = baseHeight(x, y, time);
    if (presence > 0.001) {
      const reach = Math.min(width, height);
      h += presence * (0.2 * bump(x, y, smooth.x, smooth.y, reach * 0.2) +
                       0.1 * bump(x, y, wake.x, wake.y, reach * 0.26));
    }
    return h;
  }

  function computeField(time) {
    for (let j = 0; j < rows; j++) {
      const y = j * CELL, off = j * cols;
      for (let i = 0; i < cols; i++) field[off + i] = heightAt(i * CELL, y, time);
    }
  }

  /* ── Marching squares ────────────────────────────────────── */
  function lerp(p1, p2, v1, v2, level) {
    const d = v2 - v1;
    return Math.abs(d) < 1e-6 ? p1 : p1 + (p2 - p1) * ((level - v1) / d);
  }

  function seg(path, ax, ay, bx, by) { path.moveTo(ax, ay); path.lineTo(bx, by); }

  function buildPaths() {
    const minLevel = -LEVEL_STEP * 4, maxLevel = 3.2;
    const count = Math.ceil((maxLevel - minLevel) / LEVEL_STEP);
    const minor = new Path2D(), index = new Path2D();

    for (let j = 0; j < rows - 1; j++) {
      const y0 = j * CELL, y1 = y0 + CELL;
      for (let i = 0; i < cols - 1; i++) {
        const tl = field[j * cols + i], tr = field[j * cols + i + 1];
        const bl = field[(j + 1) * cols + i], br = field[(j + 1) * cols + i + 1];
        const lo = Math.min(tl, tr, bl, br), hi = Math.max(tl, tr, bl, br);
        const first = Math.max(0, Math.ceil((lo - minLevel) / LEVEL_STEP));
        const last = Math.min(count, Math.floor((hi - minLevel) / LEVEL_STEP));
        if (first > last) continue;

        const x0 = i * CELL, x1 = x0 + CELL;
        for (let li = first; li <= last; li++) {
          const level = minLevel + li * LEVEL_STEP;
          let c = 0;
          if (tl > level) c |= 8;
          if (tr > level) c |= 4;
          if (br > level) c |= 2;
          if (bl > level) c |= 1;
          if (c === 0 || c === 15) continue;

          const path = li % INDEX_EVERY === 0 ? index : minor;
          const tx = lerp(x0, x1, tl, tr, level);
          const ry = lerp(y0, y1, tr, br, level);
          const bx = lerp(x0, x1, bl, br, level);
          const ly = lerp(y0, y1, tl, bl, level);
          const saddleHigh = (tl + tr + br + bl) / 4 > level;

          switch (c) {
            case 1: case 14: seg(path, x0, ly, bx, y1); break;
            case 2: case 13: seg(path, bx, y1, x1, ry); break;
            case 3: case 12: seg(path, x0, ly, x1, ry); break;
            case 4: case 11: seg(path, tx, y0, x1, ry); break;
            case 6: case 9:  seg(path, tx, y0, bx, y1); break;
            case 7: case 8:  seg(path, tx, y0, x0, ly); break;
            case 5:
              if (saddleHigh) { seg(path, tx, y0, x0, ly); seg(path, bx, y1, x1, ry); }
              else { seg(path, tx, y0, x1, ry); seg(path, x0, ly, bx, y1); }
              break;
            case 10:
              if (saddleHigh) { seg(path, tx, y0, x1, ry); seg(path, x0, ly, bx, y1); }
              else { seg(path, tx, y0, x0, ly); seg(path, bx, y1, x1, ry); }
              break;
          }
        }
      }
    }
    return { minor, index };
  }

  /* ── Render ──────────────────────────────────────────────── */
  function render() {
    ctx.clearRect(0, 0, width, height);
    const { minor, index } = buildPaths();

    ctx.lineJoin = 'round';
    ctx.strokeStyle = `rgba(${LINE_RGB}, 0.075)`;
    ctx.lineWidth = 0.7;
    ctx.stroke(minor);
    ctx.strokeStyle = `rgba(${LINE_RGB}, 0.17)`;
    ctx.lineWidth = 1.1;
    ctx.stroke(index);

    // Warm "lamp" around the cursor: same contours, re-stroked with a fading tint
    if (presence > 0.01) {
      const r = Math.min(width, height) * 0.32;
      const g = ctx.createRadialGradient(smooth.x, smooth.y, 0, smooth.x, smooth.y, r);
      g.addColorStop(0, `rgba(${WARM_RGB}, ${0.18 * presence})`);
      g.addColorStop(0.5, `rgba(${WARM_RGB}, ${0.06 * presence})`);
      g.addColorStop(1, `rgba(${WARM_RGB}, 0)`);
      ctx.strokeStyle = g;
      ctx.lineWidth = 0.8;
      ctx.stroke(minor);
      ctx.lineWidth = 1.2;
      ctx.stroke(index);
    }
  }

  /* ── Loop ────────────────────────────────────────────────── */
  function frame(nowMs) {
    if (!running) return;
    const time = nowMs * 0.001;
    // frame-rate independent easing so it feels the same at 60Hz and 144Hz
    const dt = lastFrame === null ? 1 / 60 : Math.min(0.1, time - lastFrame);
    lastFrame = time;
    const ease = (rate) => 1 - Math.exp(-rate * dt);

    smooth.x += (pointer.x - smooth.x) * ease(2.2);
    smooth.y += (pointer.y - smooth.y) * ease(2.2);
    wake.x += (smooth.x - wake.x) * ease(1.1);
    wake.y += (smooth.y - wake.y) * ease(1.1);
    presence += ((pointer.inside ? 1 : 0) - presence) * ease(1.5);

    computeField(time);
    render();

    rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(frame);
  }

  function drawStatic() {
    computeField(0);
    render();
  }

  function resize() {
    const rect = hero.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.ceil(width * dpr);
    canvas.height = Math.ceil(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Math.ceil(width / CELL) + 2;
    rows = Math.ceil(height / CELL) + 2;
    field = new Float32Array(cols * rows);
    if (!pointer.inside) {
      pointer.x = smooth.x = wake.x = width * 0.7;
      pointer.y = smooth.y = wake.y = height * 0.4;
    }
  }

  /* ── Input ───────────────────────────────────────────────── */
  function localPoint(e) {
    const rect = hero.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  hero.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const p = localPoint(e);
    pointer.x = p.x; pointer.y = p.y; pointer.inside = true;
  });

  hero.addEventListener('pointerleave', () => { pointer.inside = false; });

  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    lastFrame = null;
    if (running && !reduceMotion) start();
  });

  window.addEventListener('resize', () => {
    resize();
    if (reduceMotion) drawStatic();
  });

  resize();
  if (reduceMotion) drawStatic();
  else start();
})();
