// Interactive workflow backdrop shared by the landing page, login page and both studios.
// Draws a faint left-to-right pipeline of Terraform resources inside the .ambient layer:
// packets flow along the edges, nodes near the pointer light up and speed their edges,
// and a click (or an idle timer) runs a "plan → apply" wave through the graph.
// Colours come from the page's CSS tokens, so it follows Day / Night automatically.
(function () {
  'use strict';
  var host = document.querySelector('.ambient');
  if (!host || !window.requestAnimationFrame) return;
  var cv = document.createElement('canvas');
  cv.className = 'flow';
  host.appendChild(cv);
  var ctx = cv.getContext('2d');
  if (!ctx) return;

  var root = document.documentElement;
  var reduce = matchMedia('(prefers-reduced-motion: reduce)');
  var path = location.pathname;
  var page = /\/azure\//.test(path) ? 'azure' : /\/aws\//.test(path) ? 'aws' : 'site';
  // Share of nodes per kind: [aws, azure, flow]
  var MIX = { aws: [0.62, 0, 0.38], azure: [0, 0.62, 0.38], site: [0.36, 0.36, 0.28] }[page];
  var LABELS = {
    aws: ['aws_vpc', 'aws_subnet', 'aws_lb', 'aws_instance', 'aws_db_instance', 'aws_s3_bucket', 'aws_nat_gateway', 'aws_kms_key', 'aws_backup_plan', 'aws_iam_role'],
    azure: ['azurerm_virtual_network', 'azurerm_subnet', 'azurerm_lb', 'azurerm_linux_vm', 'azurerm_mssql_server', 'azurerm_storage_account', 'azurerm_nsg', 'azurerm_key_vault', 'azurerm_backup_policy', 'azurerm_monitor'],
    plan: ['terraform init', 'validate', 'plan', 'apply', 'output', 'state', 'fmt', 'providers']
  };

  var W = 0, H = 0, nodes = [], edges = [], packets = [], queue = [], col = {}, dark = false;
  var mouse = { x: -1e4, y: -1e4, tx: -1e4, ty: -1e4 };
  var last = 0, nextAuto = 0, running = false;

  function token(cs, name, fallback) { return (cs.getPropertyValue(name) || '').trim() || fallback; }
  function readColors() {
    var cs = getComputedStyle(root);
    col = {
      aws: token(cs, '--aws', '#B8790A'), azure: token(cs, '--azure', '#2F6FB0'), plan: token(cs, '--plan', '#5B3FD1'),
      line: token(cs, '--muted', '#5A6875'), panel: token(cs, '--panel', '#FFFFFF'), ink: token(cs, '--ink', '#16212B')
    };
    dark = cs.colorScheme === 'dark' || root.getAttribute('data-theme') === 'dark';
    if (!running) draw(performance.now());
  }

  function pickKind() {
    var r = Math.random();
    return r < MIX[0] ? 'aws' : r < MIX[0] + MIX[1] ? 'azure' : 'plan';
  }

  function build() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var gx = W < 700 ? 150 : 210, gy = W < 700 ? 110 : 128;
    var cols = Math.ceil(W / gx) + 1, rows = Math.ceil(H / gy) + 1, grid = [];
    nodes = []; edges = []; packets = []; queue = [];
    for (var c = 0; c < cols; c++) {
      grid[c] = [];
      for (var r = 0; r < rows; r++) {
        if (Math.random() > 0.58) continue;
        var kind = pickKind(), set = LABELS[kind];
        var n = {
          x: c * gx + gx * 0.2 + Math.random() * gx * 0.6, y: r * gy + gy * 0.2 + Math.random() * gy * 0.6,
          c: c, kind: kind, label: Math.random() < 0.4 ? set[(Math.random() * set.length) | 0] : '',
          ph: Math.random() * 6.283, glow: 0, flash: 0, out: [], px: 0, py: 0, w: 0
        };
        nodes.push(n); grid[c].push(n);
      }
    }
    for (c = 0; c < cols - 1; c++) {
      grid[c].forEach(function (a) {
        var next = grid[c + 1].slice().sort(function (p, q) { return Math.abs(p.y - a.y) - Math.abs(q.y - a.y); });
        var links = Math.random() < 0.35 ? 2 : 1;
        for (var i = 0; i < Math.min(links, next.length); i++) {
          var e = { a: a, b: next[i], heat: 0 };
          edges.push(e); a.out.push(e);
          if (Math.random() < 0.55) packets.push({ e: e, t: Math.random(), sp: 0.05 + Math.random() * 0.07, spark: false });
        }
      });
    }
  }

  function bez(e, t) {
    var a = e.a, b = e.b, dx = (b.px - a.px) / 2, u = 1 - t;
    var x1 = a.px + dx, x2 = b.px - dx;
    return {
      x: u * u * u * a.px + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * b.px,
      y: u * u * u * a.py + 3 * u * u * t * a.py + 3 * u * t * t * b.py + t * t * t * b.py
    };
  }

  // Run a wave from node n along its outgoing edges, one hop at a time.
  function fire(n, now) {
    var seen = new Set([n]), frontier = [n];
    for (var depth = 0; depth < 7 && frontier.length; depth++) {
      var nextF = [];
      frontier.forEach(function (m) {
        queue.push({ n: m, at: now + depth * 170 });
        m.out.forEach(function (e) {
          if (seen.has(e.b)) return;
          seen.add(e.b); nextF.push(e.b);
          packets.push({ e: e, t: 0, sp: 1000 / 170, spark: true, start: now + depth * 170 });
        });
      });
      frontier = nextF;
    }
  }

  function nearest(x, y, max) {
    var best = null, bd = max * max;
    nodes.forEach(function (n) { var d = (n.px - x) * (n.px - x) + (n.py - y) * (n.py - y); if (d < bd) { bd = d; best = n; } });
    return best;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function draw(now) {
    var dt = last ? Math.min(now - last, 100) / 1000 : 0;
    last = now;
    var k = dark ? 1 : 0.85, active = document.body && document.body.getAttribute('data-active');
    mouse.x += (mouse.tx - mouse.x) * 0.18; mouse.y += (mouse.ty - mouse.y) * 0.18;
    var ox = mouse.tx > -1e3 ? (mouse.x - W / 2) * -0.012 : 0, oy = mouse.ty > -1e3 ? (mouse.y - H / 2) * -0.012 : 0;

    for (var i = queue.length - 1; i >= 0; i--) if (queue[i].at <= now) { queue[i].n.flash = 1; queue.splice(i, 1); }
    nodes.forEach(function (n) {
      n.px = n.x + Math.sin(now * 0.0004 + n.ph) * 5 + ox;
      n.py = n.y + Math.cos(now * 0.00033 + n.ph) * 4 + oy;
      var d = Math.hypot(n.px - mouse.x, n.py - mouse.y);
      n.glow += (Math.max(0, 1 - d / 170) - n.glow) * Math.min(1, dt * 8);
      n.flash = Math.max(0, n.flash - dt * 1.4);
    });

    ctx.clearRect(0, 0, W, H);

    // Soft spotlight that follows the pointer.
    if (mouse.tx > -1e3) {
      var g = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 260);
      g.addColorStop(0, col.plan); g.addColorStop(1, 'transparent');
      ctx.globalAlpha = (dark ? 0.10 : 0.07); ctx.fillStyle = g;
      ctx.fillRect(mouse.x - 260, mouse.y - 260, 520, 520);
    }

    // Edges
    ctx.lineWidth = 1.2;
    edges.forEach(function (e) {
      var hot = Math.max(e.a.glow, e.b.glow, e.a.flash, e.b.flash);
      e.heat = hot;
      var dx = (e.b.px - e.a.px) / 2;
      ctx.beginPath(); ctx.moveTo(e.a.px, e.a.py);
      ctx.bezierCurveTo(e.a.px + dx, e.a.py, e.b.px - dx, e.b.py, e.b.px, e.b.py);
      ctx.strokeStyle = hot > 0.05 ? col[e.a.kind] : col.line;
      ctx.globalAlpha = (0.13 + hot * 0.45) * k;
      ctx.setLineDash(hot > 0.05 ? [5, 5] : []);
      ctx.lineDashOffset = -now * 0.03;
      ctx.stroke();
    });
    ctx.setLineDash([]);

    // Packets
    for (i = packets.length - 1; i >= 0; i--) {
      var p = packets[i];
      if (p.spark) {
        if (now < p.start) continue;
        p.t += dt * p.sp;
        if (p.t >= 1) { packets.splice(i, 1); continue; }
      } else {
        p.t = (p.t + dt * p.sp * (1 + p.e.heat * 4)) % 1;
      }
      var c2 = col[p.e.a.kind], boost = active && p.e.a.kind === active ? 0.25 : 0;
      for (var tr = 0; tr < 4; tr++) {
        var tt = p.t - tr * 0.025;
        if (tt < 0) break;
        var pt = bez(p.e, tt);
        ctx.globalAlpha = ((p.spark ? 0.9 : 0.42 + p.e.heat * 0.4 + boost) * (1 - tr * 0.25)) * k;
        ctx.fillStyle = c2;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, (p.spark ? 3 : 2.2) - tr * 0.4, 0, 6.283); ctx.fill();
      }
    }

    // Nodes
    ctx.font = '600 10px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    nodes.forEach(function (n) {
      var c3 = col[n.kind], hot = Math.max(n.glow, n.flash), boost = active && n.kind === active ? 0.22 : 0;
      if (hot > 0.02) {
        ctx.globalAlpha = hot * 0.22 * k; ctx.fillStyle = c3;
        ctx.beginPath(); ctx.arc(n.px, n.py, 18 + hot * 16, 0, 6.283); ctx.fill();
      }
      if (n.label) {
        if (!n.w) n.w = ctx.measureText(n.label).width + 16;
        roundRect(n.px - n.w / 2, n.py - 10, n.w, 20, 6);
        ctx.globalAlpha = (0.55 + hot * 0.4) * k; ctx.fillStyle = col.panel; ctx.fill();
        ctx.globalAlpha = (0.30 + hot * 0.6 + boost) * k; ctx.strokeStyle = c3; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.globalAlpha = (0.38 + hot * 0.55 + boost) * k; ctx.fillStyle = hot > 0.3 ? col.ink : col.line;
        ctx.fillText(n.label, n.px, n.py + 0.5);
      } else {
        ctx.globalAlpha = (0.30 + hot * 0.6 + boost) * k; ctx.fillStyle = c3;
        ctx.beginPath(); ctx.arc(n.px, n.py, 3.4 + hot * 1.6, 0, 6.283); ctx.fill();
      }
    });
    ctx.globalAlpha = 1;
  }

  function loop(now) {
    if (!running) return;
    if (now - last >= 30) { // ~30 fps keeps the studios light on CPU
      if (now > nextAuto && nodes.length) {
        var starters = nodes.filter(function (n) { return n.c <= 1; });
        if (starters.length) fire(starters[(Math.random() * starters.length) | 0], now);
        nextAuto = now + 3200 + Math.random() * 2400;
      }
      draw(now);
    }
    requestAnimationFrame(loop);
  }
  function start() {
    if (running || reduce.matches || document.hidden) return;
    running = true; last = 0; requestAnimationFrame(loop);
  }
  function stop() { running = false; }

  window.addEventListener('pointermove', function (e) { mouse.tx = e.clientX; mouse.ty = e.clientY; if (mouse.x < -1e3) { mouse.x = e.clientX; mouse.y = e.clientY; } }, { passive: true });
  document.addEventListener('pointerleave', function () { mouse.tx = mouse.ty = mouse.x = mouse.y = -1e4; });
  window.addEventListener('pointerdown', function (e) {
    var n = nearest(e.clientX, e.clientY, 260);
    if (n && running) fire(n, performance.now());
  }, { passive: true });

  var lastW = 0, lastH = 0, rt = 0;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () {
      // Mobile toolbars change the height slightly while scrolling; ignore small changes.
      if (window.innerWidth === lastW && Math.abs(window.innerHeight - lastH) < 120) return;
      lastW = window.innerWidth; lastH = window.innerHeight; build(); if (!running) draw(performance.now());
    }, 150);
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else start(); });
  if (reduce.addEventListener) reduce.addEventListener('change', function () { if (reduce.matches) { stop(); draw(performance.now()); } else start(); });
  new MutationObserver(readColors).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readColors);

  lastW = window.innerWidth; lastH = window.innerHeight;
  build();
  readColors();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { nodes.forEach(function (n) { n.w = 0; }); if (!running) draw(performance.now()); });
  start();
})();
