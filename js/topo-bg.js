/* ── Interactive topographic contour background ──────────────
   Draws elevation contours over the hero with marching squares.
   The terrain is slow-drifting fractal noise. */
(function () {
  const canvas = document.getElementById('hero-topo');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const LINE_RGB = '74, 124, 111';  // --accent
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const CELL = 8;            // sample spacing in CSS px (fine enough that small islands don't alias)
  const LEVEL_STEP = 0.11;    // spacing between contour lines
  const INDEX_EVERY = 5;      // every Nth line is a heavier index contour

  let dpr = 1, width = 0, height = 0, cols = 0, rows = 0;
  let field = new Float32Array(0);

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
  const SCALE = 0.0032;
  const WARP_STEP = 4;        // warp is very low frequency, so sample it coarsely and interpolate
  let warpCols = 0, warpRows = 0;
  let warpX = new Float32Array(0), warpY = new Float32Array(0);

  function computeField(time) {
    const s = SCALE, ws = s * 0.7;
    // gentle domain warp so the terrain slowly reshapes rather than scrolls
    for (let j = 0; j < warpRows; j++) {
      const y = j * WARP_STEP * CELL;
      for (let i = 0; i < warpCols; i++) {
        const x = i * WARP_STEP * CELL, k = j * warpCols + i;
        warpX[k] = noise(x * ws + time * 0.02, y * ws) * 1.4;
        warpY[k] = noise(x * ws - 11.3, y * ws + time * 0.017) * 1.4;
      }
    }

    const drift = time * 0.008;
    for (let j = 0; j < rows; j++) {
      const y = j * CELL, off = j * cols;
      const wj = Math.floor(j / WARP_STEP), fy = (j % WARP_STEP) / WARP_STEP;
      const r0 = wj * warpCols, r1 = r0 + warpCols;
      for (let i = 0; i < cols; i++) {
        const wi = Math.floor(i / WARP_STEP), fx = (i % WARP_STEP) / WARP_STEP;
        const a = r0 + wi, b = r1 + wi;
        const wx0 = warpX[a] + (warpX[a + 1] - warpX[a]) * fx;
        const wx1 = warpX[b] + (warpX[b + 1] - warpX[b]) * fx;
        const wy0 = warpY[a] + (warpY[a + 1] - warpY[a]) * fx;
        const wy1 = warpY[b] + (warpY[b + 1] - warpY[b]) * fx;
        const wx = wx0 + (wx1 - wx0) * fy, wy = wy0 + (wy1 - wy0) * fy;
        field[off + i] = fbm(i * CELL * s + wx + drift, y * s + wy) * 2.2;
      }
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
          // asymptotic decider: compare against the bilinear saddle value, which
          // changes smoothly, rather than the corner average, which flickers
          let saddleHigh = false;
          if (c === 5 || c === 10) {
            const den = tl + br - tr - bl;
            const saddle = Math.abs(den) < 1e-6
              ? (tl + tr + br + bl) / 4
              : (tl * br - tr * bl) / den;
            saddleHigh = saddle > level;
          }

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
    ctx.strokeStyle = `rgba(${LINE_RGB}, 0.1)`;
    ctx.lineWidth = 0.75;
    ctx.stroke(minor);
    ctx.strokeStyle = `rgba(${LINE_RGB}, 0.17)`;
    ctx.lineWidth = 1.1;
    ctx.stroke(index);
  }

  /* ── Loop ────────────────────────────────────────────────── */
  function frame(nowMs) {
    if (!running) return;
    const time = nowMs * 0.001;
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
    // the canvas fills the hero on desktop but is pinned to the viewport on mobile
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width), h = Math.max(1, rect.height);
    const d = Math.min(window.devicePixelRatio || 1, 2);
    // mobile browser bars fire resize without changing our size; skip the reset
    if (w === width && h === height && d === dpr) return false;
    width = w;
    height = h;
    dpr = d;
    canvas.width = Math.ceil(width * dpr);
    canvas.height = Math.ceil(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Math.ceil(width / CELL) + 2;
    rows = Math.ceil(height / CELL) + 2;
    field = new Float32Array(cols * rows);
    warpCols = Math.ceil(cols / WARP_STEP) + 1;
    warpRows = Math.ceil(rows / WARP_STEP) + 1;
    warpX = new Float32Array(warpCols * warpRows);
    warpY = new Float32Array(warpCols * warpRows);
    return true;
  }

  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running && !reduceMotion) start();
  });

  window.addEventListener('resize', () => {
    if (resize() && reduceMotion) drawStatic();
  });

  resize();
  if (reduceMotion) drawStatic();
  else start();
})();
