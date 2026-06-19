/* ── Interactive topographic contour background ──────────────
   Draws elevation-style contour lines over the hero section using
   a marching-squares algorithm. The terrain drifts slowly on its
   own and rises gently under the cursor when you hover the hero. */
(function () {
  const canvas = document.getElementById('hero-topo');
  if (!canvas) return;
  const hero = canvas.closest('.hero');
  const ctx = canvas.getContext('2d');

  const LINE_RGB = '74, 124, 111'; // matches --accent
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const CELL = 15;           // sample spacing in CSS px
  const LEVEL_STEP = 0.16;   // spacing between contour lines
  const LEVEL_MAX = 1.5;

  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let width = 0, height = 0, cols = 0, rows = 0;
  let field = [];

  let mouse = { x: 0.5, y: 0.5 };
  let smooth = { x: 0.5, y: 0.5 };
  let influence = 0, influenceTarget = 0;

  let running = true;
  let rafId = null;

  function resize() {
    const rect = hero.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.ceil(width * dpr);
    canvas.height = Math.ceil(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Math.ceil(width / CELL) + 2;
    rows = Math.ceil(height / CELL) + 2;
  }

  function heightAt(x, y, time) {
    const nx = x * 0.006, ny = y * 0.006;
    let h =
      0.55 * Math.sin(nx * 2.1 + time * 0.06) * Math.cos(ny * 1.7 - time * 0.045) +
      0.30 * Math.sin((nx + ny) * 1.4 + time * 0.03) +
      0.20 * Math.cos(nx * 2.6 - ny * 2.0 + time * 0.05);

    if (influence > 0.001) {
      const mx = smooth.x * width, my = smooth.y * height;
      const dx = x - mx, dy = y - my;
      const sigma = Math.max(width, height) * 0.32;
      const bump = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
      h += influence * 0.4 * bump;
    }
    return h;
  }

  function computeField(time) {
    field = new Array(rows);
    for (let j = 0; j < rows; j++) {
      const row = new Float32Array(cols);
      const y = j * CELL;
      for (let i = 0; i < cols; i++) row[i] = heightAt(i * CELL, y, time);
      field[j] = row;
    }
  }

  function interp(p1, p2, v1, v2, level) {
    if (Math.abs(v1 - v2) < 1e-6) return p1;
    return p1 + (p2 - p1) * ((level - v1) / (v2 - v1));
  }

  function marchCell(i, j, level) {
    const x0 = i * CELL, x1 = (i + 1) * CELL;
    const y0 = j * CELL, y1 = (j + 1) * CELL;
    const tl = field[j][i], tr = field[j][i + 1];
    const br = field[j + 1][i + 1], bl = field[j + 1][i];

    let c = 0;
    if (tl > level) c |= 8;
    if (tr > level) c |= 4;
    if (br > level) c |= 2;
    if (bl > level) c |= 1;
    if (c === 0 || c === 15) return;

    const top = [interp(x0, x1, tl, tr, level), y0];
    const right = [x1, interp(y0, y1, tr, br, level)];
    const bottom = [interp(x0, x1, bl, br, level), y1];
    const left = [x0, interp(y0, y1, tl, bl, level)];
    const avg = (tl + tr + br + bl) / 4;

    const draw = (a, b) => { ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); };

    switch (c) {
      case 1: draw(left, bottom); break;
      case 2: draw(bottom, right); break;
      case 3: draw(left, right); break;
      case 4: draw(top, right); break;
      case 5:
        if (avg > level) { draw(top, left); draw(bottom, right); }
        else { draw(top, right); draw(left, bottom); }
        break;
      case 6: draw(top, bottom); break;
      case 7: draw(top, left); break;
      case 8: draw(top, left); break;
      case 9: draw(top, bottom); break;
      case 10:
        if (avg > level) { draw(top, right); draw(left, bottom); }
        else { draw(top, left); draw(bottom, right); }
        break;
      case 11: draw(top, right); break;
      case 12: draw(left, right); break;
      case 13: draw(bottom, right); break;
      case 14: draw(left, bottom); break;
    }
  }

  function render(time) {
    ctx.clearRect(0, 0, width, height);
    const levelCount = Math.round((LEVEL_MAX * 2) / LEVEL_STEP);

    for (let li = 0; li <= levelCount; li++) {
      const level = -LEVEL_MAX + li * LEVEL_STEP;
      const bold = li % 5 === 0;
      ctx.beginPath();
      for (let j = 0; j < rows - 1; j++) {
        for (let i = 0; i < cols - 1; i++) marchCell(i, j, level);
      }
      ctx.strokeStyle = `rgba(${LINE_RGB}, ${bold ? 0.16 : 0.07})`;
      ctx.lineWidth = bold ? 1.1 : 0.75;
      ctx.stroke();
    }
  }

  function animate(now) {
    if (!running) return;
    const time = now * 0.001;

    smooth.x += (mouse.x - smooth.x) * 0.025;
    smooth.y += (mouse.y - smooth.y) * 0.025;
    influence += (influenceTarget - influence) * 0.02;

    computeField(time);
    render(time);

    if (!reduceMotion) {
      rafId = requestAnimationFrame(animate);
    }
  }

  function start() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(animate);
  }

  hero.addEventListener('mousemove', (e) => {
    const rect = hero.getBoundingClientRect();
    mouse.x = (e.clientX - rect.left) / rect.width;
    mouse.y = (e.clientY - rect.top) / rect.height;
    influenceTarget = 1;
  });
  hero.addEventListener('mouseleave', () => { influenceTarget = 0; });

  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running && !reduceMotion) start();
  });

  window.addEventListener('resize', () => {
    resize();
    if (reduceMotion) render(performance.now() * 0.001);
  });

  resize();
  if (reduceMotion) {
    render(0);
  } else {
    start();
  }
})();