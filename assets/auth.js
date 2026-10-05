// Sign-in for Terraform Studio (Firebase Authentication: Google and GitHub).
//
// Every page sets <html data-auth="...">:
//   required  studio pages. Hidden until a user is confirmed, otherwise sent to login.html?next=...
//   optional  landing page. Shows the signed-in user or a Sign in button.
//   login     login page. Wires the provider buttons and returns to ?next= after sign-in.
//
// This is a client-side gate for a static site: it controls the experience, not access
// to the files themselves. Anyone who requests a studio's HTML directly can still read it.

(function () {
'use strict';

const FIREBASE_VERSION = '10.14.1';
const cfg = window.TF_STUDIO_AUTH || {};
const fb = cfg.firebase || {};
const configured = Boolean(fb.apiKey && fb.authDomain && fb.projectId && fb.appId);
const isLocal = location.protocol === 'file:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const PREVIEW_KEY = 'tf-studio:local-preview';

// Site root is the folder above /assets/, so links work from any page depth and on
// a GitHub Pages project path such as /terraform-aws-studio/.
const ROOT = new URL('../', document.currentScript.src);
const mode = document.documentElement.dataset.auth || 'optional';

const PROVIDER_LABEL = { google: 'Google', github: 'GitHub' };

/* ---------------- helpers ---------------- */

function safeNext(raw) {
  // Only same-origin destinations inside the site; anything else falls back to the landing page.
  if (!raw) return ROOT.href;
  try {
    const u = new URL(raw, ROOT);
    if (u.origin !== ROOT.origin || !u.pathname.startsWith(ROOT.pathname)) return ROOT.href;
    return u.href;
  } catch (e) { return ROOT.href; }
}

function loginUrl(next) {
  const u = new URL('login.html', ROOT);
  if (next) u.searchParams.set('next', next);
  return u.href;
}

function currentPathForNext() {
  return location.pathname + location.search + location.hash;
}

function isAllowed(user) {
  const emails = (cfg.allowedEmails || []).map((e) => e.toLowerCase());
  const domains = (cfg.allowedEmailDomains || []).map((d) => d.toLowerCase().replace(/^@/, ''));
  if (!emails.length && !domains.length) return true;
  const email = (user.email || '').toLowerCase();
  if (!email) return false;
  return emails.includes(email) || domains.includes(email.split('@').pop());
}

function previewUser() {
  try { return sessionStorage.getItem(PREVIEW_KEY) === '1' ? { displayName: 'Local preview', email: '', photoURL: '', preview: true } : null; } catch (e) { return null; }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function injectChipStyles() {
  if (document.getElementById('tf-auth-style')) return;
  const st = document.createElement('style');
  st.id = 'tf-auth-style';
  st.textContent = `
.user-chip { position: relative; display: inline-flex; }
.user-chip > button { display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--line); background: var(--panel); border-radius: 999px; padding: 3px 10px 3px 3px; cursor: pointer; font-size: 13.5px; color: var(--ink); max-width: 220px; }
.user-chip > button:hover { border-color: var(--muted); }
.user-chip .av { width: 26px; height: 26px; border-radius: 50%; flex: none; object-fit: cover; background: var(--plan-soft); color: var(--plan); display: inline-grid; place-items: center; font-weight: 700; font-size: 12px; }
.user-chip .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.user-chip .menu { position: absolute; right: 0; top: calc(100% + 6px); z-index: 60; min-width: 220px; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; box-shadow: var(--shadow); padding: 6px; display: grid; gap: 2px; }
.user-chip .menu .who { padding: 6px 8px 8px; border-bottom: 1px solid var(--line-2); margin-bottom: 4px; font-size: 13px; }
.user-chip .menu .who small { display: block; color: var(--muted); overflow: hidden; text-overflow: ellipsis; }
.user-chip .menu a, .user-chip .menu button { display: block; width: 100%; text-align: left; border: 0; background: none; padding: 7px 8px; border-radius: 6px; font-size: 13.5px; color: var(--ink); text-decoration: none; cursor: pointer; }
.user-chip .menu a:hover, .user-chip .menu button:hover { background: var(--panel-2); }
@media (max-width: 560px) { .user-chip .nm { display: none; } .user-chip > button { padding-right: 3px; } }
`;
  document.head.appendChild(st);
}

function renderUserSlots(user, doSignOut) {
  const slots = document.querySelectorAll('[data-user-slot]');
  if (!slots.length) return;
  injectChipStyles();
  slots.forEach((slot) => {
    if (!user) {
      slot.innerHTML = `<a class="btn primary" href="${esc(loginUrl(currentPathForNext()))}">Sign in</a>`;
      return;
    }
    const name = user.displayName || user.email || 'Signed in';
    const initial = esc(name.trim().charAt(0).toUpperCase() || '?');
    const avatar = user.photoURL
      ? `<img class="av" src="${esc(user.photoURL)}" alt="" referrerpolicy="no-referrer">`
      : `<span class="av" aria-hidden="true">${initial}</span>`;
    slot.innerHTML = `
      <div class="user-chip">
        <button type="button" aria-haspopup="true" aria-expanded="false">${avatar}<span class="nm">${esc(name)}</span></button>
        <div class="menu" role="menu" hidden>
          <div class="who"><b>${esc(name)}</b>${user.email ? `<small>${esc(user.email)}</small>` : ''}${user.preview ? '<small>Sign-in not configured</small>' : ''}</div>
          <a role="menuitem" href="${esc(ROOT.href)}">Switch cloud provider</a>
          <button type="button" role="menuitem" data-signout>Sign out</button>
        </div>
      </div>`;
    const btn = slot.querySelector('.user-chip > button');
    const menu = slot.querySelector('.menu');
    const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      btn.setAttribute('aria-expanded', String(!menu.hidden));
    });
    document.addEventListener('click', (e) => { if (!slot.contains(e.target)) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    slot.querySelector('[data-signout]').addEventListener('click', doSignOut);
  });
}

function reveal() {
  document.documentElement.classList.add('auth-ok');
}

/* ---------------- Firebase ---------------- */

let fbApi = null;
async function firebase() {
  if (fbApi) return fbApi;
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const [{ initializeApp }, authMod] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`)
  ]);
  const app = initializeApp(fb);
  const auth = authMod.getAuth(app);
  await authMod.setPersistence(auth, authMod.browserLocalPersistence);
  fbApi = { auth, m: authMod };
  return fbApi;
}

function firstUser() {
  // Resolves with the restored session (or null) once Firebase has checked storage.
  return firebase().then(({ auth, m }) => new Promise((resolve) => {
    const off = m.onAuthStateChanged(auth, (u) => { off(); resolve(u); });
  }));
}

async function signOutEverywhere() {
  try { sessionStorage.removeItem(PREVIEW_KEY); } catch (e) { /* ignore */ }
  if (configured) {
    const { auth, m } = await firebase();
    await m.signOut(auth);
  }
  location.href = ROOT.href;
}

/* ---------------- page modes ---------------- */

async function runRequired() {
  const preview = !configured && isLocal ? previewUser() : null;
  if (preview) { renderUserSlots(preview, signOutEverywhere); reveal(); return; }
  if (!configured) { location.replace(loginUrl(currentPathForNext())); return; }
  try {
    const user = await firstUser();
    if (!user) { location.replace(loginUrl(currentPathForNext())); return; }
    if (!isAllowed(user)) {
      const { auth, m } = await firebase();
      await m.signOut(auth);
      const u = new URL(loginUrl(currentPathForNext()));
      u.searchParams.set('error', 'not-allowed');
      location.replace(u.href);
      return;
    }
    renderUserSlots(user, signOutEverywhere);
    reveal();
  } catch (e) {
    console.error('Sign-in check failed', e);
    const u = new URL(loginUrl(currentPathForNext()));
    u.searchParams.set('error', 'load-failed');
    location.replace(u.href);
  }
}

async function runOptional() {
  reveal();
  const preview = !configured && isLocal ? previewUser() : null;
  if (preview || !configured) { renderUserSlots(preview, signOutEverywhere); return; }
  try {
    const user = await firstUser();
    renderUserSlots(user && isAllowed(user) ? user : null, signOutEverywhere);
  } catch (e) {
    console.error('Sign-in check failed', e);
    renderUserSlots(null, signOutEverywhere);
  }
}

const ERRORS = {
  'not-allowed': 'That account is not on the allow-list for this site. Sign in with an approved account.',
  'load-failed': 'The sign-in service could not be reached. Check your connection and try again.',
  'auth/popup-closed-by-user': 'The sign-in window was closed before finishing.',
  'auth/cancelled-popup-request': 'The sign-in window was closed before finishing.',
  'auth/account-exists-with-different-credential': 'An account with this email already exists under a different sign-in method. Use the method you signed up with first.',
  'auth/unauthorized-domain': 'This domain is not authorized for sign-in. Add it in Firebase console > Authentication > Settings > Authorized domains.',
  'auth/operation-not-allowed': 'This sign-in method is not enabled. Enable it in Firebase console > Authentication > Sign-in method.',
  'auth/network-request-failed': 'Network error. Check your connection and try again.'
};

async function runLogin() {
  reveal();
  const params = new URLSearchParams(location.search);
  const next = safeNext(params.get('next'));
  const msg = document.getElementById('authMsg');
  const setup = document.getElementById('authSetup');
  const buttons = Array.from(document.querySelectorAll('[data-provider]'));
  const show = (text, kind) => {
    if (!msg) return;
    msg.textContent = text || '';
    msg.dataset.kind = kind || 'err';
    msg.hidden = !text;
  };
  const busy = (on) => buttons.forEach((b) => { b.disabled = on; });

  const enabled = (cfg.providers || ['google', 'github']).filter((p) => PROVIDER_LABEL[p]);
  buttons.forEach((b) => { b.hidden = !enabled.includes(b.dataset.provider); });

  const nextLabel = document.getElementById('nextLabel');
  if (nextLabel) {
    const path = new URL(next).pathname.slice(ROOT.pathname.length);
    nextLabel.textContent = path.startsWith('aws') ? 'Terraform AWS Studio'
      : path.startsWith('azure') ? 'Terraform Azure Studio' : 'Terraform Studio';
  }

  if (params.get('error')) show(ERRORS[params.get('error')] || 'Sign-in failed. Try again.');

  if (!configured) {
    busy(true);
    if (setup) setup.hidden = false;
    const previewBtn = document.getElementById('previewBtn');
    if (previewBtn && isLocal) {
      previewBtn.hidden = false;
      previewBtn.addEventListener('click', () => {
        try { sessionStorage.setItem(PREVIEW_KEY, '1'); } catch (e) { /* ignore */ }
        location.href = next;
      });
    }
    return;
  }

  let api;
  try {
    api = await firebase();
  } catch (e) {
    console.error(e);
    busy(true);
    show(ERRORS['load-failed']);
    return;
  }
  const { auth, m } = api;

  const finish = async (user) => {
    if (!user) return false;
    if (!isAllowed(user)) {
      await m.signOut(auth);
      show(ERRORS['not-allowed']);
      return false;
    }
    location.replace(next);
    return true;
  };

  // Already signed in, or returning from a redirect sign-in.
  busy(true);
  try {
    const redirected = await m.getRedirectResult(auth);
    if (redirected && await finish(redirected.user)) return;
    if (await finish(await firstUser())) return;
  } catch (e) {
    show(ERRORS[e.code] || e.message);
  }
  busy(false);

  buttons.forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.provider;
    const provider = id === 'github' ? new m.GithubAuthProvider() : new m.GoogleAuthProvider();
    if (id === 'github') provider.addScope('read:user');
    if (id === 'google') provider.setCustomParameters({ prompt: 'select_account' });
    show('');
    busy(true);
    try {
      const res = await m.signInWithPopup(auth, provider);
      if (await finish(res.user)) return;
    } catch (e) {
      if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
        await m.signInWithRedirect(auth, provider);
        return;
      }
      show(ERRORS[e.code] || e.message);
    }
    busy(false);
  }));
}

if (mode === 'required') runRequired();
else if (mode === 'login') runLogin();
else runOptional();
})();
