/* ==========================================================================
   core.js — Azure service metadata model, HCL builders and documentation
   links. Every resource type used by the generators is a real
   hashicorp/azurerm resource, checked against the provider schema.
   ========================================================================== */

const PROVIDER_NAME = 'hashicorp/azurerm';
const REGISTRY_BASE = 'https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/';
// Registry URLs are derived from the resource type, never typed by hand.
function docUrl(t) {
  if (t.startsWith('data.azurerm_')) return REGISTRY_BASE + 'data-sources/' + t.slice(13);
  if (t.startsWith('azurerm_')) return REGISTRY_BASE + 'resources/' + t.slice(8);
  return 'https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs';
}
const MS = 'https://learn.microsoft.com/azure/';

/* ---------- HCL value + block builders ---------- */
function hq(s) { return JSON.stringify(String(s)).replace(/\$\{/g, '$${').replace(/%\{/g, '%%{'); }
function hv(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  if (typeof v === 'string') return hq(v);
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    if (v.every(x => x === null || typeof x !== 'object')) return '[' + v.map(hv).join(', ') + ']';
    return '[\n' + v.map(x => indentLines(hv(x), '  ')).join(',\n') + ',\n]';
  }
  const ks = Object.keys(v);
  if (!ks.length) return '{}';
  return '{\n' + ks.map(k => indentLines((/^[A-Za-z_][\w-]*$/.test(k) ? k : hq(k)) + ' = ' + hv(v[k]), '  ')).join('\n') + '\n}';
}
function indentLines(s, ind) { return s.split('\n').map(l => (l ? ind + l : l)).join('\n'); }
const B = (h, b) => ({ h, b });
function renderBlock(h, items, ind = '') {
  const inner = ind + '  ';
  const out = [ind + h + ' {'];
  for (const it of items) {
    if (it === null || it === undefined || it === false) continue;
    if (Array.isArray(it)) { for (const sub of it) out.push(renderBlock(sub.h, sub.b, inner)); continue; }
    if (typeof it === 'string') {
      if (it === '') { out.push(''); continue; }
      out.push(it.split('\n').map(l => (l ? inner + l : '')).join('\n'));
    } else out.push(renderBlock(it.h, it.b, inner));
  }
  out.push(ind + '}');
  return out.join('\n');
}
const R = (h, items) => renderBlock(h, items);
const csv = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
// "key=value, key2=value2" -> { key: value }
const kvList = s => Object.fromEntries(csv(s).map(p => p.split('=').map(x => x.trim())).filter(p => p[0] && p[1] !== undefined));

/* ---------- categories ---------- */
// Display order on the Services page, filters and summary bars.
const CATS = {
  landingzone: { label: 'Landing Zone', color: 'lz' },
  compute: { label: 'Compute', color: 'cmp' },
  storage: { label: 'Storage', color: 'sto' },
  networking: { label: 'Networking', color: 'net' },
  database: { label: 'Database', color: 'db' },
  backup: { label: 'Backup', color: 'bkp' },
  monitoring: { label: 'Monitoring', color: 'mon' },
};

/* ---------- service metadata model ----------
   S({
     id, name, cat, diff ('Beginner'|'Intermediate'|'Advanced'), file (output stem),
     res:      every azurerm type the service can generate (drives Registry links),
     azdoc:    official Microsoft Learn page,
     deps:     IDs of services it usually needs (shown before anything is added),
     suggest(config, has): extra dependency IDs that depend on the configuration,
     kw, desc, use, assume (assumptions), guide (security notes),
     fields:   [{ k, l, t: text|number|bool|select|list|multi, d, o, h, when(config, has), presets }]
               plus layout-only { t: 'section', l } and { t: 'note', l, level },
     gen(c, x): HCL for <file>.tf, or [{ stem, title, desc, body }] for several files.
   })
*/
const SERVICES = [];
const SVC = {};
function S(def) {
  def.fields = def.fields || []; def.deps = def.deps || []; def.kw = def.kw || ''; def.assume = def.assume || []; def.guide = def.guide || [];
  SERVICES.push(def); SVC[def.id] = def;
}
function depsOf(id, cfg, has) {
  const s = SVC[id];
  return [...new Set([...s.deps, ...(s.suggest ? s.suggest(cfg, has) : [])])].filter(d => d !== id && SVC[d]);
}

/* ---------- regions ---------- */
const REGIONS = [
  ['southeastasia', 'Southeast Asia'], ['eastasia', 'East Asia'], ['australiaeast', 'Australia East'], ['centralindia', 'Central India'],
  ['japaneast', 'Japan East'], ['koreacentral', 'Korea Central'], ['eastus', 'East US'], ['eastus2', 'East US 2'], ['centralus', 'Central US'],
  ['westus2', 'West US 2'], ['westus3', 'West US 3'], ['canadacentral', 'Canada Central'], ['brazilsouth', 'Brazil South'],
  ['northeurope', 'North Europe'], ['westeurope', 'West Europe'], ['uksouth', 'UK South'], ['germanywestcentral', 'Germany West Central'],
  ['francecentral', 'France Central'], ['swedencentral', 'Sweden Central'],
];
const REGION_LABEL = Object.fromEntries(REGIONS);
// Azure paired regions, used as the default secondary region for geo-redundant services.
const REGION_PAIR = { southeastasia: 'eastasia', eastasia: 'southeastasia', australiaeast: 'australiasoutheast', centralindia: 'southindia', japaneast: 'japanwest', koreacentral: 'koreasouth', eastus: 'westus', eastus2: 'centralus', centralus: 'eastus2', westus2: 'westcentralus', westus3: 'eastus', canadacentral: 'canadaeast', brazilsouth: 'southcentralus', northeurope: 'westeurope', westeurope: 'northeurope', uksouth: 'ukwest', germanywestcentral: 'germanynorth', francecentral: 'francesouth', swedencentral: 'swedensouth' };

/* ---------- CIDR helpers (used by the generators and the static checks) ---------- */
function cidrParse(c) {
  const m = String(c).trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/);
  if (!m) return null;
  const o = m.slice(1, 5).map(Number), p = +m[5];
  if (o.some(n => n > 255) || p > 32) return null;
  const ip = ((o[0] << 24) >>> 0) + (o[1] << 16) + (o[2] << 8) + o[3];
  const size = 2 ** (32 - p);
  const start = Math.floor(ip / size) * size;
  return { start, end: start + size - 1, prefix: p, aligned: start === ip };
}
const cidrWithin = (inner, outer) => { const a = cidrParse(inner), b = cidrParse(outer); return !!(a && b && a.start >= b.start && a.end <= b.end); };
const cidrOverlap = (x, y) => { const a = cidrParse(x), b = cidrParse(y); return !!(a && b && a.start <= b.end && b.start <= a.end); };

if (typeof module !== 'undefined') module.exports = { docUrl, hq, hv, R, B, csv, SERVICES, SVC, CATS, REGIONS };
