// Shared light/dark theme for the site pages. Loaded synchronously in <head> so the
// saved theme applies before first paint. It reads and writes the same localStorage
// entry as the AWS studio, so a choice made in one place carries over to the other.
(function () {
  'use strict';
  var KEY = 'tf-aws-dashboard:v1';
  var root = document.documentElement;

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function saved() {
    var t = read().theme;
    return t === 'light' || t === 'dark' ? t : null;
  }
  function isDark() {
    var t = saved();
    return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function apply() {
    var t = saved();
    if (t) root.setAttribute('data-theme', t); else root.removeAttribute('data-theme');
    var btn = document.getElementById('themeBtn');
    if (!btn) return;
    var dark = isDark();
    btn.innerHTML = dark
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
    btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  }
  function toggle() {
    var d = read();
    d.theme = isDark() ? 'light' : 'dark';
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* ignore */ }
    apply();
  }

  apply();
  document.addEventListener('DOMContentLoaded', function () {
    apply();
    var btn = document.getElementById('themeBtn');
    if (btn) btn.addEventListener('click', toggle);
    var yr = document.getElementById('yr');
    if (yr) yr.textContent = new Date().getFullYear();
  });
})();
