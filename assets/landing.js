// Interactive provider chooser on index.html: active-side switching, cursor spotlight,
// typed terraform output, topology animation, keyboard shortcuts, last-used provider,
// rotating hero word and per-provider stats that follow the active side. Everything degrades to a static page with
// prefers-reduced-motion or without JavaScript.
(function () {
  'use strict';
  var LAST_KEY = 'tf-studio:last-provider';
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var duel = document.querySelector('.duel');
  if (!duel) return;
  var sides = { aws: duel.querySelector('.side.aws'), azure: duel.querySelector('.side.azure') };
  var active = null;

  /* ---------- typed terminal ---------- */
  var SCRIPTS = {
    aws: [
      ['cmd', 'terraform init'],
      ['dim', 'Initializing provider plugins...'],
      ['dim', '- Installing hashicorp/aws ~> 6.0'],
      ['cmd', 'terraform plan'],
      ['add', '  + aws_vpc.main'],
      ['add', '  + aws_subnet.public'],
      ['add', '  + aws_lb.web'],
      ['add', '  + aws_instance.web[0]'],
      ['add', '  + aws_instance.web[1]'],
      ['add', '  + aws_rds_cluster.db'],
      ['hi', 'Plan: 6 to add, 0 to change, 0 to destroy.']
    ],
    azure: [
      ['cmd', 'terraform init'],
      ['dim', 'Initializing provider plugins...'],
      ['dim', '- Installing hashicorp/azurerm ~> 5.0'],
      ['cmd', 'terraform plan'],
      ['add', '  + azurerm_resource_group.main'],
      ['add', '  + azurerm_virtual_network.main'],
      ['add', '  + azurerm_application_gateway.web'],
      ['add', '  + azurerm_linux_virtual_machine.web[0]'],
      ['add', '  + azurerm_linux_virtual_machine.web[1]'],
      ['add', '  + azurerm_mssql_server.db'],
      ['hi', 'Plan: 6 to add, 0 to change, 0 to destroy.']
    ]
  };
  var typers = {};

  function esc(s) { return s.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function lineHtml(kind, text) {
    return kind === 'cmd' ? '<span class="p">$ </span><span class="cmd">' + esc(text) + '</span>' : '<span class="' + kind + '">' + esc(text) + '</span>';
  }
  function renderFull(id) {
    var pre = sides[id].querySelector('.term pre');
    pre.innerHTML = SCRIPTS[id].map(function (l) { return lineHtml(l[0], l[1]); }).join('\n');
  }
  function stopTyping(id) { if (typers[id]) { clearTimeout(typers[id]); typers[id] = null; } }
  function type(id) {
    stopTyping(id);
    if (reduce) { renderFull(id); return; }
    var pre = sides[id].querySelector('.term pre');
    var lines = SCRIPTS[id], li = 0, ci = 0, done = [];
    (function tick() {
      if (li >= lines.length) { pre.innerHTML = done.join('\n') + '\n<span class="p">$ </span><span class="caret"></span>'; typers[id] = null; return; }
      var kind = lines[li][0], text = lines[li][1];
      if (kind === 'cmd' && ci < text.length) {
        ci++;
        pre.innerHTML = done.concat('<span class="p">$ </span><span class="cmd">' + esc(text.slice(0, ci)) + '</span><span class="caret"></span>').join('\n');
        typers[id] = setTimeout(tick, 38 + Math.random() * 40);
        return;
      }
      done.push(lineHtml(kind, text));
      li++; ci = 0;
      pre.innerHTML = done.join('\n');
      typers[id] = setTimeout(tick, kind === 'cmd' ? 380 : 110);
    })();
  }

  /* ---------- active side ---------- */
  function setActive(id, opts) {
    if (id === active) return;
    active = id;
    duel.dataset.active = id;
    document.body.dataset.active = id;
    Object.keys(sides).forEach(function (k) {
      var on = k === id;
      sides[k].classList.toggle('on', on);
      var svg = sides[k].querySelector('svg.topo');
      if (svg && svg.pauseAnimations) { if (on && !reduce) svg.unpauseAnimations(); else svg.pauseAnimations(); }
      if (on) type(k); else stopTyping(k);
    });
    var sw = document.getElementById('provSwitch');
    if (sw) sw.setAttribute('aria-label', 'Switch to ' + (id === 'aws' ? 'Azure' : 'AWS'));
    if (opts && opts.focus) sides[id].focus({ preventScroll: true });
    showStats(id, statsSeen);
  }

  Object.keys(sides).forEach(function (id) {
    var el = sides[id];
    el.addEventListener('pointerenter', function () { setActive(id); });
    el.addEventListener('focus', function () { setActive(id); });
    el.addEventListener('pointermove', function (e) {
      var r = el.getBoundingClientRect();
      el.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      el.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
    el.addEventListener('click', function () { try { localStorage.setItem(LAST_KEY, id); } catch (e) { /* ignore */ } });
    var svg = el.querySelector('svg.topo');
    if (svg && svg.pauseAnimations) svg.pauseAnimations();
    renderFull(id);
  });

  var sw = document.getElementById('provSwitch');
  if (sw) sw.addEventListener('click', function () { setActive(active === 'aws' ? 'azure' : 'aws', { focus: true }); });

  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    var k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') { e.preventDefault(); setActive('aws', { focus: true }); }
    else if (k === 'arrowright' || k === 'z') { e.preventDefault(); setActive('azure', { focus: true }); }
    else if (k === 'enter' && active && !(t && t.closest && t.closest('a, button'))) { e.preventDefault(); sides[active].click(); }
  });

  /* ---------- per-provider stats ---------- */
  // Each number and label carries data-aws / data-azure. The active provider decides which is shown;
  // numbers count from their current value to the new one. Counting starts once the row is visible.
  var statsWrap = document.querySelector('.stats-wrap');
  var statNums = statsWrap ? statsWrap.querySelectorAll('.stat b[data-aws]') : [];
  var statLabels = statsWrap ? statsWrap.querySelectorAll('[data-aws]:not(.stat b)') : [];
  var statsSeen = false, statsFor = 'aws';
  function tween(el, to) {
    if (el._raf) cancelAnimationFrame(el._raf);
    var from = statsSeen ? (+el.textContent || 0) : 0;
    if (reduce || from === to) { el.textContent = to; return; }
    var t0 = performance.now(), dur = statsSeen && from ? 600 : 1100;
    el._raf = requestAnimationFrame(function step(ts) {
      var p = Math.min(1, Math.max(0, ts - t0) / dur);
      el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) el._raf = requestAnimationFrame(step);
    });
  }
  function showStats(id, animate) {
    if (!statsWrap) return;
    statsFor = id;
    statsWrap.dataset.provider = id;
    statLabels.forEach(function (el) { el.textContent = el.dataset[id]; });
    // Before the row has been seen, numbers stay at 0 for the first count-up.
    if (!statsSeen && !animate) return;
    statNums.forEach(function (el) { var to = +el.dataset[id]; if (animate) tween(el, to); else el.textContent = to; });
  }
  if (statsWrap) {
    if ('IntersectionObserver' in window && !reduce) {
      statNums.forEach(function (el) { el.textContent = '0'; });
      var io = new IntersectionObserver(function (entries) {
        if (!entries.some(function (en) { return en.isIntersecting; })) return;
        io.disconnect();
        showStats(statsFor, true);
        statsSeen = true;
      }, { threshold: 0.6 });
      io.observe(statsWrap.querySelector('.stats'));
    } else statsSeen = true;
  }

  // Start on the last-used provider, or AWS.
  var last = null;
  try { last = localStorage.getItem(LAST_KEY); } catch (e) { /* ignore */ }
  if (last && sides[last]) {
    var tags = sides[last].querySelector('.tags');
    if (tags) tags.insertAdjacentHTML('beforeend', '<span class="badge last">Last used</span>');
  }
  setActive(last && sides[last] ? last : 'aws');

  /* ---------- rotating hero word ---------- */
  var words = document.querySelectorAll('.hero .rot > span');
  if (words.length > 1 && !reduce) {
    var wi = 0;
    setInterval(function () {
      words[wi].classList.remove('on');
      wi = (wi + 1) % words.length;
      words[wi].classList.add('on');
    }, 2400);
  }

})();
