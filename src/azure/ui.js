/* ==========================================================================
   ui.js — Azure studio UI. Vanilla JS; state lives in one object and every
   view re-renders from it. Depends on core.js, gen_*.js, engine.js,
   learn.js and presets.js.
   ========================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const STORE_KEY = 'tf-azure-studio:v1';
// Day/Night is shared with the landing page, login page and AWS studio (see assets/theme.js).
const THEME_KEY = 'tf-aws-dashboard:v1';
function sharedTheme(set) {
  try {
    const d = JSON.parse(localStorage.getItem(THEME_KEY) || '{}') || {};
    if (set === undefined) return d.theme === 'light' || d.theme === 'dark' ? d.theme : null;
    d.theme = set; localStorage.setItem(THEME_KEY, JSON.stringify(d));
  } catch (e) { return null; }
}
const DIFFS = ['Beginner', 'Intermediate', 'Advanced'];
const CAT_VAR = { networking: 'var(--net)', compute: 'var(--cmp)', database: 'var(--db)', storage: 'var(--sto)', backup: 'var(--bkp)', monitoring: 'var(--mon)', landingzone: 'var(--lz)', root: 'var(--root)', extra: 'var(--root)' };
const ABBR = {
  resource_group: 'RG', mgmt_groups: 'MG', policy: 'POL', rbac: 'RBAC', locks: 'LOCK', budget: '$',
  vnet: 'VNET', subnet: 'SNET', nsg: 'NSG', asg: 'ASG', route_table: 'RT', nat_gateway: 'NAT', public_ip: 'PIP', lb: 'LB', appgw: 'AGW', appgw_waf: 'WAF', frontdoor: 'AFD', vpn_gw: 'VPN', expressroute: 'ER', vwan: 'VWAN', hub_spoke: 'HUB', private_dns: 'DNS', private_endpoint: 'PE', firewall: 'AFW', ddos: 'DDoS', bastion: 'BAS',
  vm: 'VM', managed_disk: 'DISK', identity: 'ID', vmss: 'VMSS', aks: 'AKS', acr: 'ACR', aci: 'ACI', container_apps: 'ACA', app_service_plan: 'ASP', web_app: 'APP', function_app: 'FUNC',
  storage_account: 'ST', blob_container: 'BLOB', file_share: 'FILE', storage_queue: 'QUE', storage_table: 'TBL', storage_lifecycle: 'LC', storage_network_rules: 'FW',
  sql_server: 'SQL', sql_database: 'SQLDB', sql_elastic_pool: 'POOL', postgres: 'PG', mysql: 'MY', cosmos: 'COS', redis: 'RDS',
  recovery_vault: 'RSV', vm_backup: 'BKP', file_share_backup: 'BKF', backup_vault: 'BV', site_recovery: 'ASR',
  log_analytics: 'LAW', app_insights: 'APPI', diagnostics: 'DIAG', action_group: 'AG', alerts: 'ALRT', workbook: 'WB', dcr: 'DCR',
};
const TABS = [['services', 'Services'], ['landing', 'Landing Zone'], ['files', 'Terraform files'], ['arch', 'Architecture'], ['modules', 'Modules'], ['learn', 'Learn Terraform'], ['cli', 'CLI & auth']];
const PROVIDER_MINOR = PROVIDER_SNAPSHOT.latestSeen.split('.').slice(0, 2).join('.');
const PROVIDER_OPTIONS = [['~> 5.0', 'any 5.x'], ['~> ' + PROVIDER_MINOR, PROVIDER_MINOR + ' or newer 5.x'], ['>= 5.0, < 6.0', 'explicit range']];
const FOUNDATIONS = [['resource_group', 'Resource Group'], ['vnet', 'VNet'], ['subnet', 'Subnets'], ['nsg', 'NSGs'], ['identity', 'Managed Identity'], ['private_dns', 'Private DNS'], ['log_analytics', 'Monitoring']];
const FILE_ROLE = {
  'providers.tf': 'Declares the Terraform version and hashicorp/azurerm, and configures the provider (features block, subscription and, in multi-subscription mode, aliases). No credentials live here.',
  'locals.tf': 'Local values computed once: the naming prefix, the common tag map every resource sets, and the unique suffix for globally unique names.',
  'variables.tf': 'Every input the configuration accepts, each with a type, description, default and, where useful, a validation rule. Sensitive inputs have no default.',
  'data.tf': 'Data sources: read-only lookups (the signed-in client, the current subscription, an existing resource group) shared by several services.',
  'outputs.tf': 'Values printed after apply and readable by other configurations through remote state.',
  'terraform.tfvars.example': 'A template for terraform.tfvars. Copy it, then change values for your environment. Sensitive values go in TF_VAR_* environment variables, never here.',
};
// Summary-panel checklist for services built from several optional parts: [resource type, label].
const COMPONENTS = {
  mgmt_groups: [['azurerm_management_group', 'Management groups'], ['azurerm_management_group_subscription_association', 'Subscription placement'], ['azurerm_subscription', 'Subscription aliases']],
  policy: [['azurerm_policy_definition', 'Custom policy definition'], ['azurerm_management_group_policy_set_definition', 'Initiative (management group)'], ['azurerm_policy_set_definition', 'Initiative (subscription)'], ['azurerm_management_group_policy_assignment', 'Assignments (management group)'], ['azurerm_subscription_policy_assignment', 'Assignments (subscription)'], ['azurerm_role_assignment', 'Remediation identity roles']],
  hub_spoke: [['azurerm_virtual_network', 'Hub and spoke VNets'], ['azurerm_virtual_network_peering', 'Peerings (both directions)'], ['azurerm_resource_group', 'Connectivity resource group']],
  diagnostics: [['azurerm_monitor_diagnostic_setting', 'Diagnostic settings']],
  alerts: [['azurerm_monitor_metric_alert', 'Metric alerts'], ['azurerm_monitor_scheduled_query_rules_alert_v2', 'Log query alert'], ['azurerm_monitor_activity_log_alert', 'Activity log alerts']],
  backup_vault: [['azurerm_data_protection_backup_vault', 'Backup vault'], ['azurerm_data_protection_backup_policy_blob_storage', 'Blob backup policy'], ['azurerm_data_protection_backup_instance_blob_storage', 'Protected storage account']],
};

/* ---------------- state ---------------- */
const state = {
  sel: [], cfg: {}, g: Object.assign({}, DEFAULT_GLOBAL), theme: null, openOnSelect: true,
  tab: 'services', q: '', cats: new Set(), diffs: new Set(), selectedOnly: false,
  gen: null, genKey: '', edits: {}, curFile: 'providers.tf', codeQ: '', codeHit: 0, expanded: false,
  archDeps: false, recOff: new Set(), learnQ: '', lzType: 'Enterprise', modMode: 'raw',
};
function load() {
  const t = sharedTheme(); if (t) state.theme = t;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (Array.isArray(d.sel)) state.sel = d.sel.filter(id => SVC[id]);
    if (d.cfg && typeof d.cfg === 'object') state.cfg = d.cfg;
    if (d.g) Object.assign(state.g, d.g);
    if (!t && (d.theme === 'light' || d.theme === 'dark')) state.theme = d.theme;
    if (typeof d.openOnSelect === 'boolean') state.openOnSelect = d.openOnSelect;
    if (d.lzType === 'Enterprise' || d.lzType === 'Standard') state.lzType = d.lzType;
  } catch (e) { /* storage unavailable or corrupt: start fresh */ }
}
function persist() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ sel: state.sel, cfg: state.cfg, g: state.g, theme: state.theme, openOnSelect: state.openOnSelect, lzType: state.lzType })); } catch (e) { /* ignore */ }
}
const isSel = id => state.sel.includes(id);
function cfgOf(id) { return Object.assign(defaultConfig(SVC[id]), state.cfg[id] || {}); }
function selKey() {
  const ids = SERVICES.filter(s => isSel(s.id)).map(s => s.id);
  const cfg = {}; for (const id of ids) if (state.cfg[id]) cfg[id] = state.cfg[id];
  return JSON.stringify([ids, cfg, state.g]);
}
let liveCache = { key: '', val: null };
function live() {
  const k = selKey();
  if (liveCache.key !== k) liveCache = { key: k, val: generateProject(state.sel, state.cfg, state.g) };
  return liveCache.val;
}
const isStale = () => !!state.gen && state.genKey !== selKey();
function currentFiles() {
  if (!state.gen) return [];
  return [...state.gen.files, ...state.gen.extras].map(f => Object.assign({}, f, { content: state.edits[f.name] != null ? state.edits[f.name] : f.content, edited: state.edits[f.name] != null && state.edits[f.name] !== f.content }));
}
function validation() { return state.gen ? validateProject(currentFiles(), state.sel, state.cfg, state.g) : null; }

/* ---------------- icons ---------------- */
const IC = {
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
  ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
  dl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  collapse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 15l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>',
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/></svg>',
};
const extSm = (n = 12) => IC.ext.replace('<svg', `<svg width="${n}" height="${n}"`);
const glyph = (id, size) => `<span class="glyph" style="background:${CAT_VAR[SVC[id].cat]}${size ? `;width:${size}px;height:${size}px;border-radius:7px;font-size:9px` : ''}" aria-hidden="true">${esc(ABBR[id] || id.slice(0, 3).toUpperCase())}</span>`;
const extLink = (url, label, cls = '') => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" class="${cls}">${label}</a>`;
const regionLabel = r => REGION_LABEL[r] ? `${REGION_LABEL[r]} (${r})` : r;

/* ---------------- toast / clipboard / downloads ---------------- */
function toast(msg, action) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(msg)}</span>`;
  if (action) { const b = document.createElement('button'); b.textContent = action.label; b.onclick = () => { action.fn(); el.remove(); }; el.appendChild(b); }
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), action ? 6000 : 3200);
}
async function copyText(text, what) {
  try { await navigator.clipboard.writeText(text); toast(`Copied ${what}`); return; } catch (e) { /* fall through */ }
  const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove();
  toast(ok ? `Copied ${what}` : 'Copy is blocked here. Select the code and press Ctrl/Cmd+C.');
}
// Published claude.ai pages save files through the downloads capability; elsewhere a normal browser download is used.
const downloadsReady = (window.claude && typeof window.claude.use === 'function')
  ? Promise.resolve(window.claude.use('downloads')).catch(() => null) : Promise.resolve(null);
async function saveBlob(filename, blob) {
  const ns = await downloadsReady;
  if (ns) {
    try { await ns.save({ filename, data: blob }); toast(`Saved ${filename}`); return; }
    catch (e) {
      const code = e && e.code;
      if (code === 'declined') { toast('Download cancelled'); return; }
      if (code === 'rate_limited') { toast('A download prompt is already open. Try again in a moment.'); return; }
      if (code === 'too_large' || code === 'bad_request' || code === 'rejected_extension' || code === 'extension_not_enabled') { toast('This download is not available here: ' + (e.message || code)); return; }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function gitignore() {
  return '# Local Terraform state and caches\n.terraform/\n*.tfstate\n*.tfstate.*\ncrash.log\ncrash.*.log\n*.tfplan\ntfplan\n\n# Real variable values often contain environment-specific data\nterraform.tfvars\n*.auto.tfvars\n\n# Override files are local-only\noverride.tf\noverride.tf.json\n*_override.tf\n*_override.tf.json\n\n# Keep the provider lock file: commit .terraform.lock.hcl\n';
}
function projectReadme(files) {
  const n = state.gen.notes.map(x => `- ${x.svc && SVC[x.svc] ? SVC[x.svc].name + ': ' : ''}${x.text}`).join('\n');
  const sens = [...state.gen.vars.entries()].filter(([, v]) => v.sensitive).map(([k]) => k);
  return `# ${state.g.project} (${state.g.env})\n\nGenerated by Terraform Azure Studio on ${new Date().toISOString().slice(0, 10)} for hashicorp/azurerm ${state.g.provider}.\n\n` +
    `Services: ${SERVICES.filter(s => isSel(s.id)).map(s => s.name).join(', ')}\n\nSubscription architecture: ${state.g.subMode === 'multi' ? 'multi-subscription (provider aliases azurerm.connectivity and azurerm.management)' : 'single subscription'}\n\n## Files\n\n${files.map(f => '- `' + f.name + '`').join('\n')}\n\n` +
    '## Deploy\n\n```bash\naz login\naz account set --subscription <subscription-id>\nexport ARM_SUBSCRIPTION_ID=$(az account show --query id -o tsv)\n' + (sens.length ? sens.map(s => `export TF_VAR_${s}="<from your secret store>"`).join('\n') + '\n' : '') + 'cp terraform.tfvars.example terraform.tfvars   # then edit values\nterraform init\nterraform fmt\nterraform validate\nterraform plan -out=tfplan\nterraform apply tfplan\n```\n\n' +
    'In CI/CD, authenticate with OIDC (ARM_USE_OIDC=true) or a managed identity instead of az login.\n\n' +
    '## Checks performed before download\n\nThe studio ran client-side static checks only (brackets, variable and reference resolution, outputs, provider block, naming, a credential scan and design rules such as subnet overlap). It did not run `terraform validate` or contact Azure. Run the commands above to validate against the real provider schema.\n\n' +
    (n ? '## Generator notes\n\n' + n + '\n' : '') +
    '\nNo client secrets, passwords, keys or SAS tokens are generated. SQL and PostgreSQL use Microsoft Entra ID only; MySQL takes a write-only password from an ephemeral variable; Windows VM and VPN secrets are sensitive variables without defaults.\n';
}
async function downloadZip() {
  if (!state.gen) { toast('Generate Terraform first'); return; }
  if (typeof JSZip === 'undefined') { toast('The ZIP library could not load. Copy files individually instead.'); return; }
  const v = validation();
  const errs = Object.values(v).reduce((n, c) => n + c.items.filter(i => i.level === 'error').length, 0);
  if (errs && !confirm(`Static checks found ${errs} error${errs > 1 ? 's' : ''}. Download anyway?`)) return;
  const files = currentFiles();
  const zip = new JSZip();
  const root = zip.folder('terraform-azure-project');
  for (const f of files) root.file(f.name, f.content);
  root.file('README.md', projectReadme(files));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  await saveBlob(`${state.g.project}-${state.g.env}-azure-terraform.zip`, blob);
}
async function downloadOne(f) {
  if (typeof JSZip === 'undefined') { toast('The ZIP library could not load. Use Copy instead.'); return; }
  const zip = new JSZip();
  zip.file(f.name, f.content);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  await saveBlob(f.name.replace(/\//g, '_') + '.zip', blob);
}

/* ---------------- theme ---------------- */
function applyTheme() {
  const root = document.documentElement;
  if (state.theme) root.setAttribute('data-theme', state.theme); else root.removeAttribute('data-theme');
  const dark = state.theme ? state.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  $('#themeBtn').innerHTML = dark ? IC.sun : IC.moon;
  $('#themeBtn').setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
}

/* ---------------- header ---------------- */
function initHeader() {
  const tf = $('#tfVersion');
  tf.innerHTML = TF_VERSIONS.map(v => `<option value="${v}">&gt;= ${v}.0</option>`).join('');
  if (!TF_VERSIONS.includes(state.g.tf)) state.g.tf = DEFAULT_GLOBAL.tf;
  tf.value = state.g.tf;
  tf.onchange = () => { state.g.tf = tf.value; changed(); };
  const pv = $('#provVersion');
  pv.innerHTML = PROVIDER_OPTIONS.map(([v, l]) => `<option value="${esc(v)}" title="${esc(l)}">${esc(v)}</option>`).join('');
  if (!PROVIDER_OPTIONS.some(o => o[0] === state.g.provider)) state.g.provider = PROVIDER_OPTIONS[0][0];
  pv.value = state.g.provider;
  pv.onchange = () => { state.g.provider = pv.value; changed(); };
  $('#provCtl').title = `Version constraint written to providers.tf. Latest hashicorp/azurerm release seen on the Terraform Registry when this studio was built: v${PROVIDER_SNAPSHOT.latestSeen} (checked ${PROVIDER_SNAPSHOT.checked}). terraform init installs the newest release that matches.`;
  const q = $('#q');
  q.value = state.q;
  q.addEventListener('input', () => { state.q = q.value; if (state.tab !== 'services') setTab('services', false); else renderMain(); });
  $('#themeBtn').onclick = () => {
    const dark = state.theme ? state.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    state.theme = dark ? 'light' : 'dark'; sharedTheme(state.theme); applyTheme(); persist(); if (state.tab === 'arch' || state.tab === 'landing') renderMain();
  };
  $('#resetBtn').onclick = resetAll;
  $('#genBtnTop').onclick = generate;
  renderTabs();
}
function renderTabs() {
  const nav = $('#tabs');
  nav.innerHTML = TABS.map(([k, l]) => {
    let extra = '';
    if (k === 'services' && state.sel.length) extra = `<span class="count">${state.sel.length}</span>`;
    if (k === 'files' && state.gen) extra = `<span class="count">${state.gen.files.length}</span>` + (isStale() ? '<span class="stale-dot" title="Selection changed since generation"></span>' : '');
    return `<button class="tab" role="tab" id="tab-${k}" aria-controls="main" aria-selected="${state.tab === k}" tabindex="${state.tab === k ? 0 : -1}" data-tab="${k}">${l}${extra}</button>`;
  }).join('');
  $$('.tab', nav).forEach(b => {
    b.onclick = () => setTab(b.dataset.tab);
    b.onkeydown = e => {
      const i = TABS.findIndex(t => t[0] === b.dataset.tab);
      let j = null;
      if (e.key === 'ArrowRight') j = (i + 1) % TABS.length;
      if (e.key === 'ArrowLeft') j = (i - 1 + TABS.length) % TABS.length;
      if (j !== null) { e.preventDefault(); setTab(TABS[j][0]); $('#tab-' + TABS[j][0]).focus(); }
    };
  });
}
function setTab(t, scroll = true) {
  state.tab = t; renderTabs(); renderMain();
  $('#main').setAttribute('aria-labelledby', 'tab-' + t);
  if (scroll) window.scrollTo({ top: 0 });
}

/* ---------------- selection logic ---------------- */
function changed() { persist(); renderTabs(); renderSummary(); if (state.tab !== 'files' || isStale()) renderMain(); }
function toggle(id, opts = {}) {
  if (isSel(id)) { state.sel = state.sel.filter(x => x !== id); toast(`Removed ${SVC[id].name}`); }
  else {
    state.sel.push(id);
    if (state.openOnSelect && !opts.quiet) { changed(); openConfig(id); return; }
    const missing = depsFor(id).filter(d => !isSel(d));
    toast(`Added ${SVC[id].name}` + (missing.length ? ` (${missing.length} suggested dependenc${missing.length > 1 ? 'ies' : 'y'})` : ''), { label: 'Configure', fn: () => openConfig(id) });
  }
  changed();
}
const depsFor = id => depsOf(id, cfgOf(id), isSel);
function recommendations() {
  const m = new Map();
  for (const id of state.sel) for (const d of depsFor(id)) if (!isSel(d)) { if (!m.has(d)) m.set(d, []); m.get(d).push(id); }
  return [...m.entries()].map(([id, by]) => ({ id, by }));
}
function addRecommended(ids) {
  const add = ids.filter(id => !isSel(id));
  if (!add.length) return;
  state.sel.push(...add);
  toast(`Added ${add.map(id => SVC[id].name).join(', ')}`);
  changed();
}
// A learning indicator, not a quality score.
function complexity() {
  const s = state.sel.map(id => SVC[id]);
  if (!s.length) return '—';
  const adv = s.filter(x => x.diff === 'Advanced').length;
  if (adv >= 2 || (adv && s.length >= 8) || s.length >= 16 || state.g.subMode === 'multi') return 'Advanced';
  if (adv || s.some(x => x.diff === 'Intermediate') || s.length >= 6) return 'Intermediate';
  return 'Basic';
}
function applyPreset(p) {
  const had = state.sel.length;
  if (had && !confirm(`Replace your current selection of ${had} service${had > 1 ? 's' : ''} with "${p.name}"?`)) return;
  state.sel = p.ids.slice();
  state.cfg = {};
  if (p.cfg) for (const [k, v] of Object.entries(p.cfg)) state.cfg[k] = JSON.parse(JSON.stringify(v));
  if (p.subMode) state.g.subMode = p.subMode;
  toast(`Loaded "${p.name}" (${p.ids.length} services)`, { label: 'Generate', fn: generate });
  changed();
}
function resetAll() {
  if ((state.sel.length || state.gen) && !confirm('Reset the project? This clears selected services, their settings and any generated or edited code.')) return;
  Object.assign(state, { sel: [], cfg: {}, g: Object.assign({}, DEFAULT_GLOBAL), gen: null, genKey: '', edits: {}, q: '', cats: new Set(), diffs: new Set(), selectedOnly: false, curFile: 'providers.tf', codeQ: '', recOff: new Set() });
  $('#q').value = ''; $('#tfVersion').value = state.g.tf; $('#provVersion').value = state.g.provider;
  persist(); setTab('services'); renderSummary(); toast('Project reset');
}
function generate() {
  if (!state.sel.length) { toast('Select at least one service first', { label: 'Load guided example', fn: () => applyPreset(PRESETS[0]) }); return; }
  const edited = Object.keys(state.edits).length;
  if (edited && !confirm(`Regenerating replaces your manual edits in ${edited} file${edited > 1 ? 's' : ''}. Continue?`)) return;
  state.gen = generateProject(state.sel, state.cfg, state.g);
  state.gen.extras.push({ name: '.gitignore', content: gitignore(), cat: 'extra' });
  state.genKey = selKey();
  state.edits = {};
  if (![...state.gen.files, ...state.gen.extras].some(f => f.name === state.curFile)) state.curFile = 'providers.tf';
  closeDrawer();
  setTab('files');
  renderSummary();
  toast(`Generated ${state.gen.files.length} files`);
}

/* ---------------- summary panel ---------------- */
function renderSummary() {
  const el = $('#summary');
  const counts = {}; for (const k of Object.keys(CATS)) counts[k] = 0;
  for (const id of state.sel) counts[SVC[id].cat]++;
  const max = Math.max(1, ...Object.values(counts));
  const lv = live();
  const tfCount = lv.files.filter(f => f.name.endsWith('.tf')).length;
  const resCount = lv.files.reduce((n, f) => n + (f.content.match(/^resource\s+"/gm) || []).length, 0);
  const recs = recommendations();
  const needed = new Set(state.sel.flatMap(depsFor));
  const comps = Object.entries(COMPONENTS).filter(([id]) => isSel(id)).map(([id, list]) => {
    const code = lv.files.filter(f => f.svc === id).map(f => f.content).join('\n');
    return { id, got: list.filter(([t]) => new RegExp(`^resource\\s+"${t}"`, 'm').test(code)) };
  });
  const v = state.gen ? validation() : null;
  const vErr = v ? Object.values(v).reduce((n, c) => n + c.items.filter(i => i.level === 'error').length, 0) : 0;
  const vWarn = v ? Object.values(v).reduce((n, c) => n + c.items.filter(i => i.level === 'warn').length, 0) : 0;
  el.innerHTML = `
    <h2>Project summary</h2>
    <div class="form-grid" style="gap:10px">
      <label class="field wide"><span>Project name</span><input class="inp mono" id="gProject" value="${esc(state.g.project)}" maxlength="15" spellcheck="false"></label>
      <label class="field wide"><span>Environment</span><select class="inp" id="gEnv">${['dev', 'test', 'prod'].map(e => `<option ${e === state.g.env ? 'selected' : ''}>${e}</option>`).join('')}</select></label>
      <label class="field wide"><span>Region (var.location)</span><select class="inp" id="gRegion">${REGIONS.map(([r, l]) => `<option value="${r}" ${r === state.g.region ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <div class="field wide"><span id="subModeL">Subscription architecture</span><div class="seg" role="group" aria-labelledby="subModeL"><button data-sub="single" aria-pressed="${state.g.subMode !== 'multi'}">Single subscription</button><button data-sub="multi" aria-pressed="${state.g.subMode === 'multi'}">Multi subscription</button></div></div>
    </div>
    <p class="hint" id="gProjectHint" hidden>Use 2 to 15 lowercase letters, numbers or hyphens, starting with a letter.</p>
    <div>
      <div class="stat-big"><b>${state.sel.length}</b><span>service${state.sel.length === 1 ? '' : 's'} selected</span></div>
      <div class="catbars" style="margin-top:10px">${Object.entries(CATS).map(([k, c]) => `<div class="catbar"><span>${c.label}</span><span class="track"><span class="fill" style="width:${counts[k] / max * 100}%;background:${CAT_VAR[k]}"></span></span><span class="n">${counts[k]}</span></div>`).join('')}</div>
    </div>
    <dl class="kv">
      <dt>Terraform files</dt><dd>${tfCount}</dd>
      <dt>Terraform resources</dt><dd>${resCount}</dd>
      <dt title="A learning indicator, not a quality score">Estimated complexity</dt><dd>${complexity()}</dd>
      <dt title="Snapshot taken when this studio was built. The constraint in providers.tf decides what terraform init installs.">Latest hashicorp/azurerm seen</dt><dd>${extLink('https://registry.terraform.io/providers/hashicorp/azurerm/latest', 'v' + PROVIDER_SNAPSHOT.latestSeen)}</dd>
      <dt>Static checks</dt><dd>${!v ? '<span style="color:var(--muted);font-weight:400">after generate</span>' : vErr ? `<span style="color:var(--err)">${vErr} error${vErr > 1 ? 's' : ''}</span>` : vWarn ? `<span style="color:var(--warn)">${vWarn} warning${vWarn > 1 ? 's' : ''}</span>` : '<span style="color:var(--ok)">passing</span>'}</dd>
    </dl>
    <div>
      <p class="sec-title">Dependencies</p>
      <ul class="foundation">${FOUNDATIONS.map(([id, l]) => {
        const s = isSel(id), n = needed.has(id);
        return `<li><span class="mark ${s ? 'ok' : n ? 'warn' : 'off'}" aria-hidden="true">${s ? '✓' : n ? '!' : ''}</span>${l}<span class="hint" style="margin-left:auto">${s ? 'included' : n ? 'suggested' : 'not used'}</span></li>`;
      }).join('')}</ul>
    </div>
    ${comps.map(({ id, got }) => `<div>
      <p class="sec-title">${esc(SVC[id].name)}</p>
      ${got.length ? `<ul class="foundation">${got.map(([, l]) => `<li><span class="mark ok" aria-hidden="true">✓</span>${esc(l)}</li>`).join('')}</ul>` : '<p class="hint">Nothing turned on yet. Configure the service to add components.</p>'}
    </div>`).join('')}
    ${recs.length ? `<div class="recs" id="recs">
      <p class="sec-title" style="margin:0;color:var(--ink)">Recommended dependencies</p>
      <p class="hint">Nothing is added until you confirm. Untick anything you already have; the generated code then takes its ID as a variable instead.</p>
      <ul>${recs.map(r => `<li><label class="chk"><input type="checkbox" data-rec="${r.id}" ${state.recOff.has(r.id) ? '' : 'checked'}>${esc(SVC[r.id].name)} <code class="hint">${esc(SVC[r.id].res[0])}</code></label><div class="why">for ${r.by.map(b => esc(SVC[b].name)).join(', ')}</div></li>`).join('')}</ul>
      <button class="btn primary sm" id="addRecs">Add recommended dependencies</button>
    </div>` : ''}
    <div>
      <p class="sec-title">Selected services</p>
      ${state.sel.length ? `<ul class="sel-list">${SERVICES.filter(s => isSel(s.id)).map(s => `<li><span class="dot" style="background:${CAT_VAR[s.cat]}"></span><span class="nm">${esc(s.name)}</span><button class="icon-btn" data-cfg="${s.id}" aria-label="Configure ${esc(s.name)}" title="Configure">${IC.gear}</button><button class="icon-btn" data-rm="${s.id}" aria-label="Remove ${esc(s.name)}" title="Remove">${IC.x}</button></li>`).join('')}</ul>` : '<p class="hint">Nothing selected yet. Pick services from the cards, generate a landing zone, or start with the guided example.</p>'}
    </div>
    <div class="actions">
      <button class="btn primary" id="genBtnSide">${state.gen && !isStale() ? 'Regenerate Terraform' : 'Generate Terraform'}</button>
      <button class="btn" id="valBtnSide" ${state.sel.length ? '' : 'disabled'} title="Generate if needed, then open the client-side static checks. These are not terraform validate.">Static checks</button>
      <button class="btn" id="zipBtnSide" ${state.gen ? '' : 'disabled'}>${IC.dl} Download ZIP</button>
      <button class="btn ghost danger" id="resetBtnSide">Reset project</button>
    </div>`;
  const proj = $('#gProject', el);
  proj.oninput = debounce(() => {
    const ok = /^[a-z][a-z0-9-]{1,14}$/.test(proj.value);
    $('#gProjectHint').hidden = ok;
    if (ok) { state.g.project = proj.value; persist(); renderTabs(); if (state.tab !== 'files' || isStale()) renderMain(); }
  }, 300);
  $('#gEnv', el).onchange = e => { state.g.env = e.target.value; changed(); };
  $('#gRegion', el).onchange = e => { state.g.region = e.target.value; changed(); };
  $$('[data-sub]', el).forEach(b => b.onclick = () => { state.g.subMode = b.dataset.sub; changed(); });
  $$('[data-rec]', el).forEach(c => c.onchange = () => { c.checked ? state.recOff.delete(c.dataset.rec) : state.recOff.add(c.dataset.rec); });
  const ar = $('#addRecs', el);
  if (ar) ar.onclick = () => addRecommended(recs.map(r => r.id).filter(id => !state.recOff.has(id)));
  $$('[data-cfg]', el).forEach(b => b.onclick = () => openConfig(b.dataset.cfg));
  $$('[data-rm]', el).forEach(b => b.onclick = () => toggle(b.dataset.rm));
  $('#genBtnSide', el).onclick = generate;
  $('#valBtnSide', el).onclick = () => {
    if (!state.gen || isStale()) generate(); else setTab('files');
    if (!state.gen) return;
    setTimeout(() => { const vp = $('#valPanel'); if (vp) { vp.scrollIntoView({ block: 'start', behavior: 'smooth' }); vp.focus({ preventScroll: true }); } }, 80);
  };
  $('#zipBtnSide', el).onclick = downloadZip;
  $('#resetBtnSide', el).onclick = resetAll;
}

/* ---------------- main router ---------------- */
function renderMain() {
  const m = $('#main');
  ({ services: renderServices, landing: renderLanding, files: renderFiles, arch: renderArch, modules: renderModules, learn: renderLearn, cli: renderCli })[state.tab](m);
}

/* ---------------- services view ---------------- */
function matches(s, q) {
  if (!q) return true;
  const hay = [s.name, s.id, s.cat, CATS[s.cat].label, s.kw, s.desc, ...s.res].join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(t => hay.includes(t));
}
function renderServices(m) {
  const q = state.q.trim();
  const base = SERVICES.filter(s => matches(s, q) && (!state.selectedOnly || isSel(s.id)));
  const list = base.filter(s => (!state.cats.size || state.cats.has(s.cat)) && (!state.diffs.size || state.diffs.has(s.diff)));
  const catCount = k => base.filter(s => s.cat === k && (!state.diffs.size || state.diffs.has(s.diff))).length;
  const diffCount = d => base.filter(s => s.diff === d && (!state.cats.size || state.cats.has(s.cat))).length;
  m.innerHTML = `<div class="svc-layout">
    <aside class="panel filters" aria-label="Filters">
      <fieldset><legend>Category</legend>${Object.entries(CATS).map(([k, c]) => `<label class="chk"><input type="checkbox" data-cat="${k}" ${state.cats.has(k) ? 'checked' : ''}><span class="dot" style="background:${CAT_VAR[k]}"></span>${c.label}<span class="n">${catCount(k)}</span></label>`).join('')}</fieldset>
      <fieldset><legend>Difficulty</legend>${DIFFS.map(d => `<label class="chk"><input type="checkbox" data-diff="${d}" ${state.diffs.has(d) ? 'checked' : ''}>${d}<span class="n">${diffCount(d)}</span></label>`).join('')}
        <p class="hint">Difficulty is a learning guide, not a quality ranking.</p></fieldset>
      <fieldset><legend>Show</legend>
        <label class="chk"><input type="checkbox" id="selOnly" ${state.selectedOnly ? 'checked' : ''}>Selected only</label>
        <label class="chk" title="Open the configuration panel each time you select a service"><input type="checkbox" id="openSel" ${state.openOnSelect ? 'checked' : ''}>Configure on select</label>
      </fieldset>
      <fieldset><legend>Start from an example</legend><div class="presets">${PRESETS.map((p, i) => `<button class="preset" data-preset="${i}">${esc(p.name)}<small>${p.ids.length} services</small></button>`).join('')}</div></fieldset>
    </aside>
    <section aria-label="Services">
      <div class="results-bar"><h2>Azure services</h2><span class="muted" aria-live="polite">${list.length} of ${SERVICES.length}${q ? ` matching "${esc(q)}"` : ''}</span>
        ${state.cats.size || state.diffs.size || q || state.selectedOnly ? '<button class="btn sm ghost" id="clearF">Clear filters</button>' : ''}</div>
      ${list.length ? Object.keys(CATS).map(k => {
        const items = list.filter(s => s.cat === k);
        if (!items.length) return '';
        return `<div class="cat-group"><div class="cat-head"><span class="dot" style="background:${CAT_VAR[k]}"></span><h3>${CATS[k].label}</h3><span class="hint">${items.length}</span><span class="rule"></span></div><div class="cards">${items.map(card).join('')}</div></div>`;
      }).join('') : `<div class="panel empty"><h3>No services match</h3><p>Try a resource name such as <code>azurerm_subnet</code>, a keyword such as <code>network</code>, or clear the filters.</p></div>`}
    </section></div>`;
  $$('[data-cat]', m).forEach(c => c.onchange = () => { c.checked ? state.cats.add(c.dataset.cat) : state.cats.delete(c.dataset.cat); renderMain(); });
  $$('[data-diff]', m).forEach(c => c.onchange = () => { c.checked ? state.diffs.add(c.dataset.diff) : state.diffs.delete(c.dataset.diff); renderMain(); });
  $('#selOnly', m).onchange = e => { state.selectedOnly = e.target.checked; renderMain(); };
  $('#openSel', m).onchange = e => { state.openOnSelect = e.target.checked; persist(); };
  $$('[data-preset]', m).forEach(b => b.onclick = () => applyPreset(PRESETS[+b.dataset.preset]));
  const cf = $('#clearF', m);
  if (cf) cf.onclick = () => { state.cats.clear(); state.diffs.clear(); state.q = ''; state.selectedOnly = false; $('#q').value = ''; renderMain(); };
  $$('[data-toggle]', m).forEach(b => b.onclick = () => { const id = b.dataset.toggle; toggle(id); const nb = $(`[data-toggle="${id}"]`); if (nb) nb.focus(); });
  $$('[data-open]', m).forEach(b => b.onclick = () => openConfig(b.dataset.open));
}
function card(s) {
  const sel = isSel(s.id);
  const dl = depsFor(s.id);
  const deps = dl.map(d => `${isSel(d) ? '<b>' + esc(SVC[d].name) + '</b>' : esc(SVC[d].name)}`).join(', ');
  return `<article class="card ${sel ? 'selected' : ''}" aria-label="${esc(s.name)}">
    <div class="card-top">${glyph(s.id)}<div style="min-width:0"><h4>${esc(s.name)}</h4>
      <div class="meta"><span class="pill cat" style="background:${CAT_VAR[s.cat]}">${CATS[s.cat].label}</span><span class="pill ${s.diff}">${s.diff}</span></div></div></div>
    <div class="res" title="${esc(s.res.join(', '))}">${esc(s.res[0])}${s.res.length > 1 ? ` <span class="more">+${s.res.length - 1}</span>` : ''}</div>
    <p class="desc">${esc(s.desc)}</p>
    ${dl.length ? `<div class="deps">Works with: ${deps}</div>` : '<div class="deps">No dependencies</div>'}
    <div class="card-links">
      ${extLink(docUrl(s.res[0]), 'Terraform ' + extSm(13), 'btn sm ghost" title="Terraform Registry: ' + esc(s.res[0]))}
      ${extLink(s.azdoc, 'Azure ' + extSm(13), 'btn sm ghost" title="Microsoft Learn: ' + esc(s.name))}
    </div>
    <div class="card-actions">
      <span class="spacer"></span>
      ${sel ? `<button class="icon-btn" data-open="${s.id}" aria-label="Configure ${esc(s.name)}" title="Configure">${IC.gear}</button>` : `<button class="btn sm ghost" data-open="${s.id}" aria-label="Details for ${esc(s.name)}">Details</button>`}
      <button class="btn sm ${sel ? '' : 'select'}" data-toggle="${s.id}" aria-pressed="${sel}" aria-label="${sel ? 'Deselect' : 'Select'} ${esc(s.name)}">${sel ? '✓ Selected' : 'Select'}</button>
    </div></article>`;
}

/* ---------------- drawer ---------------- */
let lastFocus = null;
function openDrawer(html, onReady) {
  const d = $('#drawer'), sc = $('#scrim');
  if (d.hidden) lastFocus = document.activeElement;
  d.innerHTML = html;
  d.hidden = false; sc.hidden = false;
  requestAnimationFrame(() => { d.classList.add('open'); sc.classList.add('open'); });
  sc.onclick = closeDrawer;
  $$('[data-close]', d).forEach(b => b.onclick = closeDrawer);
  d.scrollTop = 0; const body = $('.drawer-body', d); if (body) body.scrollTop = 0;
  if (onReady) onReady(d);
  setTimeout(() => { const f = $('[data-autofocus]', d) || $('.icon-btn', d); if (f) f.focus(); }, 60);
}
function closeDrawer() {
  const d = $('#drawer'), sc = $('#scrim');
  if (d.hidden) return;
  d.classList.remove('open'); sc.classList.remove('open');
  setTimeout(() => { d.hidden = true; sc.hidden = true; d.innerHTML = ''; }, 230);
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}
function fieldHtml(id, f, val) {
  if (f.t === 'section') return `<p class="form-sec">${esc(f.l)}</p>`;
  if (f.t === 'note') return `<p class="callout ${f.level === 'warn' ? 'warn' : ''}" role="note">${esc(f.l)}</p>`;
  const name = `f-${id}-${f.k}`;
  const hint = f.h ? `<p class="hint">${esc(f.h)}</p>` : '';
  if (f.t === 'bool') return `<div class="field wide"><label class="chk"><input type="checkbox" id="${name}" data-k="${f.k}" data-t="bool" ${val ? 'checked' : ''}>${esc(f.l)}</label>${hint}</div>`;
  if (f.t === 'select') return `<label class="field"><span>${esc(f.l)}</span><select class="inp" id="${name}" data-k="${f.k}" data-t="select">${f.o.map(o => `<option ${String(o) === String(val) ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>${hint}</label>`;
  if (f.t === 'multi') {
    const on = new Set(csv(val));
    return `<div class="field wide"><span id="${name}-l">${esc(f.l)}</span><div class="multi" role="group" aria-labelledby="${name}-l">${f.o.map((o, i) => `<label class="chk"><input type="checkbox" id="${name}-${i}" data-k="${f.k}" data-t="multi" value="${esc(o)}" ${on.has(o) ? 'checked' : ''}>${esc(o)}</label>`).join('')}</div>${hint}</div>`;
  }
  const wide = f.t === 'list' || String(val).length > 26;
  return `<label class="field ${wide ? 'wide' : ''}"><span>${esc(f.l)}</span><input class="inp mono" id="${name}" data-k="${f.k}" data-t="${f.t}" type="${f.t === 'number' ? 'number' : 'text'}" value="${esc(val)}" spellcheck="false" ${f.t === 'number' ? 'step="any"' : ''}>${hint}</label>`;
}
function previewFor(id) {
  const ids = isSel(id) ? state.sel : [...state.sel, id];
  return generateProject(ids, state.cfg, state.g).files.filter(f => f.svc === id);
}
function blocksOf(content) {
  return hclBlocks(content).map(b => { const type = (b.kind === 'data' ? 'data.' : '') + b.type; return { kind: b.kind, type, name: b.name, addr: type + '.' + b.name, text: b.text }; });
}
function openConfig(id) {
  const s = SVC[id];
  const sel = isSel(id);
  const html = `<div class="drawer-head">${glyph(id)}<div><h2 id="drawerTitle">${esc(s.name)} ${sel ? 'configuration' : ''}</h2>
      <p>${esc(s.desc)}</p><div class="meta" style="display:flex;gap:6px;margin-top:6px"><span class="pill cat" style="background:${CAT_VAR[s.cat]}">${CATS[s.cat].label}</span><span class="pill ${s.diff}">${s.diff}</span></div></div>
      <button class="icon-btn" data-close aria-label="Close panel">${IC.x}</button></div>
    <div class="drawer-body">
      <div class="box note"><h3>Common use case</h3><p style="margin:0;font-size:13.5px">${esc(s.use)}</p></div>
      ${s.fields.length ? `<div><p class="sec-title">Settings</p><div class="form-grid" id="cfgForm"></div>
        <p class="hint" style="margin-top:10px">Project name, environment, region and subscription architecture come from the summary panel and apply to every service. Settings become variable defaults in variables.tf.</p>
        ${Object.keys(state.cfg[id] || {}).length ? '<button class="btn sm ghost" id="cfgReset" style="margin-top:6px">Restore defaults</button>' : ''}</div>` : '<p class="hint">This service has no settings: it is wired to the other selected services automatically.</p>'}
      <div id="cfgDeps"></div>
      <div class="box"><h3><span class="source-tag reg">Terraform Registry</span>Resource documentation</h3>
        <ul class="links">${s.res.map(t => `<li>${extLink(docUrl(t), esc(t) + ' ' + extSm())}</li>`).join('')}</ul>
        <p class="hint" style="margin-top:8px">Links open the live <code>latest</code> documentation for hashicorp/azurerm. This page cannot fetch the Registry itself, so argument lists are not read at runtime.</p></div>
      <div class="box"><h3><span class="source-tag mod">Microsoft Learn</span>Azure documentation</h3><ul class="links"><li>${extLink(s.azdoc, esc(s.name) + ' ' + extSm())}</li></ul></div>
      <div class="box note"><h3><span class="source-tag asm">Assumptions</span>Made by this generator</h3><ul>${[...s.assume, 'Names follow <abbreviation>-<project>-<environment> (Cloud Adoption Framework style), and every taggable resource sets tags = local.common_tags.'].map(a => `<li>${esc(a)}</li>`).join('')}</ul></div>
      ${s.guide.length ? `<div class="box"><h3><span class="source-tag asm">Guidance</span>Security and governance</h3><ul>${s.guide.map(a => `<li>${esc(a)}</li>`).join('')}</ul>
        <p class="hint" style="margin-top:8px">Educational recommendations, not a compliance certification.</p></div>` : ''}
      <div id="cfgPreview"></div>
    </div>
    <div class="drawer-foot">
      <button class="btn ${sel ? 'danger' : 'select'}" id="dSel">${sel ? 'Remove service' : 'Select service'}</button>
      <span style="flex:1"></span>
      <button class="btn" data-close>Done</button>
      <button class="btn primary" id="dGen">Generate Terraform</button>
    </div>`;
  openDrawer(html, d => {
    const setVal = (k, v) => {
      const f = s.fields.find(x => x.k === k);
      state.cfg[id] = state.cfg[id] || {};
      if (f && v === f.d) delete state.cfg[id][k]; else state.cfg[id][k] = v;
      if (!Object.keys(state.cfg[id]).length) delete state.cfg[id];
    };
    const renderDeps = () => {
      const box = $('#cfgDeps', d);
      const deps = depsFor(id);
      if (!deps.length) { box.innerHTML = ''; return; }
      const missing = deps.filter(x => !isSel(x));
      box.innerHTML = `<p class="sec-title">Dependencies</p><ul class="foundation">${deps.map(x => `<li><span class="mark ${isSel(x) ? 'ok' : 'warn'}">${isSel(x) ? '✓' : '!'}</span>${esc(SVC[x].name)}<span class="hint" style="margin-left:auto">${isSel(x) ? 'selected, referenced directly' : 'suggested: not selected, so an input variable or skipped'}</span></li>`).join('')}</ul>
        ${missing.length ? `<button class="btn sm" id="addDeps" style="margin-top:8px">Add ${missing.map(x => esc(SVC[x].name)).join(', ')}</button>` : ''}`;
      const ad = $('#addDeps', box); if (ad) ad.onclick = () => { if (!isSel(id)) state.sel.push(id); addRecommended(missing); openConfig(id); };
    };
    const refresh = () => {
      renderDeps();
      const fs = previewFor(id);
      const box = $('#cfgPreview', d);
      if (!box) return;
      const bl = fs.flatMap(f => blocksOf(f.content).map(b => Object.assign(b, { file: f.name })));
      box.innerHTML = `<p class="sec-title"><span class="source-tag gen">Generated template</span>Preview of ${fs.map(f => esc(f.name)).join(', ')}</p>
        ${fs.map(f => `<pre class="snippet code">${highlightHCL(f.content).html}</pre>`).join('')}
        <ul class="res-list" style="margin-top:8px">${bl.map((b, i) => `<li><span class="addr">${esc(b.addr)}</span><button class="btn sm ghost" data-learn="${i}">${IC.book} Learn</button></li>`).join('')}</ul>`;
      $$('[data-learn]', box).forEach(b => b.onclick = () => { const x = bl[+b.dataset.learn]; openLearn(x.type, x, x.file, () => openConfig(id)); });
    };
    const later = debounce(() => { refresh(); changed(); }, 250);
    const renderForm = focusId => {
      const form = $('#cfgForm', d);
      if (!form) return;
      const c = cfgOf(id);
      form.innerHTML = s.fields.filter(f => !f.when || f.when(c, isSel)).map(f => fieldHtml(id, f, f.k ? c[f.k] : null)).join('');
      $$('[data-k]', form).forEach(inp => {
        const t = inp.dataset.t;
        inp.addEventListener(t === 'bool' || t === 'select' || t === 'multi' ? 'change' : 'input', () => {
          const f = s.fields.find(x => x.k === inp.dataset.k);
          let v = t === 'bool' ? inp.checked : inp.value;
          if (t === 'number') { v = Number(inp.value); if (inp.value === '' || isNaN(v)) return; }
          if (t === 'multi') v = f.o.filter(o => $$(`[data-k="${f.k}"]`, form).some(b => b.checked && b.value === o)).join(', ');
          setVal(f.k, v);
          if (t === 'select' && f.presets && f.presets[v]) for (const [k2, v2] of Object.entries(f.presets[v])) setVal(k2, v2);
          persist();
          if (t === 'bool' || t === 'select' || t === 'multi') renderForm(inp.id);
          later();
        });
      });
      if (focusId) { const el = document.getElementById(focusId); if (el) el.focus(); }
    };
    renderForm();
    refresh();
    const cr = $('#cfgReset', d); if (cr) cr.onclick = () => { delete state.cfg[id]; changed(); openConfig(id); };
    $('#dSel', d).onclick = () => { if (isSel(id)) { toggle(id); closeDrawer(); } else { state.sel.push(id); changed(); openConfig(id); } };
    $('#dGen', d).onclick = () => { if (!isSel(id)) state.sel.push(id); generate(); };
  });
}

/* ---------------- learn drawer ---------------- */
function conceptRows(block) {
  if (!block) return '';
  const body = block.text.split('\n').slice(1);
  const argLine = body.find(l => /^\s{2}[a-z_]+\s*=/.test(l));
  const arg = argLine ? argLine.trim().split(/\s*=\s*/)[0] : null;
  const vars = [...new Set([...block.text.matchAll(/\bvar\.([a-z0-9_]+)/g)].map(m => m[1]))];
  const refs = [...new Set([...block.text.matchAll(/\b((?:data\.)?azurerm_[a-z0-9_]+\.[a-z0-9_]+)(?:\[[^\]]*\])?\.[a-z_]+/g)].map(m => m[1]))].filter(r => r !== block.addr);
  const info = RES_INFO[block.type];
  const attr = info && info[2][0] ? `${block.addr}.${info[2][0]}` : `${block.addr}.id`;
  const isData = block.kind === 'data';
  const prov = /provider\s*=\s*azurerm\.(\w+)/.exec(block.text);
  return `<dl class="concepts">
    <div class="concept"><dt>${isData ? 'Data source' : 'Resource'}</dt><dd><code>${esc(block.kind)} "${esc(block.type.replace(/^data\./, ''))}" "${esc(block.name)}"</code> ${isData ? 'reads something that already exists. It never creates anything.' : `declares one object Terraform creates and manages. <code>${esc(block.type)}</code> is the type from the provider; <code>${esc(block.name)}</code> is your local name.`}</dd></div>
    ${arg ? `<div class="concept"><dt>Argument</dt><dd><code>${esc(arg)}</code> is an argument: a value you set, which Terraform sends to Azure Resource Manager.</dd></div>` : ''}
    <div class="concept"><dt>Attribute</dt><dd><code>${esc(attr)}</code> is an attribute: a value Azure returns after creation that other blocks and outputs can read.</dd></div>
    <div class="concept"><dt>Variable</dt><dd>${vars.length ? vars.map(v => `<code>var.${esc(v)}</code>`).join(', ') + ' come from variables.tf, so you change behaviour without editing this file.' : 'This block uses no input variables directly.'}</dd></div>
    <div class="concept"><dt>Reference</dt><dd>${refs.length ? refs.map(r => `<code>${esc(r)}</code>`).join(', ') + ' are references to other blocks in this configuration.' : 'This block does not reference other resources.'}</dd></div>
    <div class="concept"><dt>Dependency</dt><dd>${refs.length ? `Because of those references Terraform builds ${refs.slice(0, 2).map(r => `<code>${esc(r)}</code>`).join(' and ')}${refs.length > 2 ? ' and the others' : ''} first. This implicit dependency is why <code>depends_on</code> is rarely needed.` : 'With no references, Terraform can create this in parallel with other resources.'}</dd></div>
    <div class="concept"><dt>State</dt><dd>${isData ? 'Data sources are re-read on every plan; their result is cached in state but nothing is owned.' : `After apply, the state file maps <code>${esc(block.addr)}</code> to the real Azure resource ID (/subscriptions/.../providers/...). Renaming the address without a <code>moved</code> block makes Terraform destroy and recreate it.`}</dd></div>
    <div class="concept"><dt>Provider</dt><dd>${prov ? `<code>provider = azurerm.${esc(prov[1])}</code> sends this block to the ${esc(prov[1])} subscription through a provider alias.` : 'Uses the default <code>azurerm</code> provider configured in providers.tf.'}</dd></div>
  </dl>`;
}
function openLearn(type, block, fileName, back) {
  const info = RES_INFO[type];
  const g = RES_GUIDE[type];
  const pure = type.replace(/^data\./, '');
  const svc = SERVICES.find(s => s.res.includes(type));
  const html = `<div class="drawer-head"><div><h2 id="drawerTitle" class="mono" style="font-size:17px">${esc(type)}</h2><p>${type.startsWith('data.') ? 'Data source' : 'Terraform resource'}${svc ? ' · Azure service: ' + esc(svc.name) : ''}${fileName ? ' · in ' + esc(fileName) : ''}</p></div>
      <button class="icon-btn" data-close aria-label="Close panel">${IC.x}</button></div>
    <div class="drawer-body">
      ${back ? `<div><button class="btn sm ghost" id="lBack">${IC.up.replace('<svg', '<svg style="rotate:-90deg"')} Back</button></div>` : ''}
      <div><p class="sec-title">What does it do?</p><p style="margin:0">${esc(info ? info[0] : 'See the Registry page for a full description.')}</p></div>
      ${info ? `${info[1].length ? `<div><p class="sec-title">Important arguments <span class="hint">(you set these)</span></p><div class="chips">${info[1].map(a => `<span class="chip">${esc(a)}</span>`).join('')}</div></div>` : ''}
      <div><p class="sec-title">Important attributes <span class="hint">(Azure returns these)</span></p><div class="chips">${info[2].map(a => `<span class="chip">${esc(a)}</span>`).join('')}</div></div>
      <p class="hint" style="margin:0">A commonly used subset, checked against the azurerm 5.x schema. The Registry page lists every argument and attribute.</p>` : ''}
      ${g ? `<div><p class="sec-title">Why do we need it?</p><p style="margin:0">${esc(g.why)}</p></div>
      <div><p class="sec-title">Dependencies</p><p style="margin:0">${esc(g.deps)}</p></div>
      <div><p class="sec-title">How it fits in Azure</p><p style="margin:0">${esc(g.arch)}</p></div>
      <div><p class="sec-title">Common mistakes</p><ul style="margin:0;padding-left:18px">${g.mistakes.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div><p class="sec-title">Terraform example</p><pre class="snippet code">${highlightHCL(g.example).html}</pre></div>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap">${extLink(docUrl(type), 'Open Terraform Registry documentation ' + extSm(13), 'btn sm')}${svc ? extLink(svc.azdoc, 'Azure documentation ' + extSm(13), 'btn sm ghost') : ''}</div>
      ${block ? `<div><p class="sec-title">Your generated block</p><pre class="snippet code">${highlightHCL(block.text).html}</pre></div>
      <div><p class="sec-title">Terraform concepts, using this block</p>${conceptRows(block)}</div>` : `<div class="box note"><h3>Terraform concepts</h3><p class="hint">Generate a project that uses <code>${esc(pure)}</code> and open Learn from the file view to see each concept explained against your own code.</p></div>`}
    </div>`;
  openDrawer(html, d => { const b = $('#lBack', d); if (b) b.onclick = back; });
}
