/* ==========================================================================
   engine.js — turns a selection + config into AzureRM Terraform files and
   runs client-side static checks. It never runs Terraform itself.
   ========================================================================== */

const DEFAULT_GLOBAL = {
  tf: '1.11', provider: '~> 5.0', region: 'southeastasia', project: 'tfstudio', env: 'dev', layout: 'flat', subMode: 'single',
};
// Latest hashicorp/azurerm release seen on the Registry when this studio was built.
const PROVIDER_SNAPSHOT = { latestSeen: '5.8.0', checked: '2026-10-06' };
// Write-only arguments (administrator_password_wo) and ephemeral variables need Terraform 1.11 or newer.
const TF_VERSIONS = ['1.16', '1.15', '1.14', '1.13', '1.12', '1.11'];
// Workload layer used for each category when the resource group service creates one group per layer.
const RG_LAYER = { networking: 'network', compute: 'app', storage: 'data', database: 'data', backup: 'ops', monitoring: 'ops', landingzone: 'ops' };

function defaultConfig(svc) { if (svc.defaults) return svc.defaults(); const o = {}; for (const f of svc.fields) if (f.k) o[f.k] = f.d; return o; }
// Category layout prefixes the category (networking_vnet.tf) so files sort together.
function svcFileName(s, stem, layout) { return (layout === 'category' && !stem.startsWith(s.cat + '_') ? s.cat + '_' : '') + stem + '.tf'; }
function typesIn(body) {
  const t = [];
  for (const m of body.matchAll(/^(resource|data)\s+"([^"]+)"/gm)) { const k = (m[1] === 'data' ? 'data.' : '') + m[2]; if (!t.includes(k)) t.push(k); }
  return t;
}

/* ---------- generation context: the helpers every generator uses ---------- */
function makeCtx(sel, cfg, g) {
  const vars = new Map(), outs = new Map(), data = new Map(), locals = new Map(), notes = [], flags = { suffix: false, storageAad: false, connectivity: false, management: false };
  let current = null;
  const x = {
    g, flags,
    has: id => sel.has(id),
    cfgOf: id => Object.assign(defaultConfig(SVC[id]), cfg[id] || {}),
    setCurrent(id) { current = id; },
    // v(name, type, description, default, validation, opts: { sensitive, ephemeral, nullable })
    v(name, type, desc, def, val, opts) {
      if (!vars.has(name)) vars.set(name, Object.assign({ type, desc, def, val, svc: current }, opts || {}));
      return 'var.' + name;
    },
    o(name, value, desc, sensitive) { outs.set(name, { value, desc, sensitive, svc: current }); },
    data(key, hcl) { if (!data.has(key)) data.set(key, hcl); },
    local(name, expr) { if (!locals.has(name)) locals.set(name, expr); return 'local.' + name; },
    note(s) { notes.push({ svc: current, text: s }); },
    multi: () => g.subMode === 'multi',

    /* identity of the caller and the subscription */
    client() { x.data('client', 'data "azurerm_client_config" "current" {}'); return 'data.azurerm_client_config.current'; },
    sub() { x.data('sub', 'data "azurerm_subscription" "current" {}'); return 'data.azurerm_subscription.current'; },

    /* naming: CAF-style "<abbr>-<project>-<env>", or a compact globally unique name */
    n(abbr, extra) { return `"${abbr}-\${local.name_prefix}${extra ? '-' + extra : ''}"`; },
    uname(abbr, max, sep) {
      flags.suffix = true; x.client();
      return sep === false
        ? `substr("${abbr}\${local.name_compact}\${local.unique_suffix}", 0, ${max})`
        : `substr("${abbr}-\${local.name_prefix}-\${local.unique_suffix}", 0, ${max})`;
    },
    tags: 'tags = local.common_tags',

    /* resource groups */
    rg(cat) {
      if (!x.has('resource_group')) {
        x.v('resource_group_name', 'string', 'Name of an existing resource group (the Resource Group service is not selected)', `rg-${g.project}-${g.env}`);
        x.data('rg', R('data "azurerm_resource_group" "main"', ['name = var.resource_group_name']));
        return { name: 'data.azurerm_resource_group.main.name', loc: 'data.azurerm_resource_group.main.location', id: 'data.azurerm_resource_group.main.id' };
      }
      const c = x.cfgOf('resource_group');
      const a = c.layout === 'One per workload layer' ? `azurerm_resource_group.layer["${RG_LAYER[cat] || 'app'}"]` : 'azurerm_resource_group.main';
      return { name: a + '.name', loc: a + '.location', id: a + '.id' };
    },
    rgArgs(cat) { const r = x.rg(cat); return ['resource_group_name = ' + r.name, 'location = ' + r.loc]; },

    /* placement of shared hub resources (firewall, bastion, gateways) */
    hub() {
      if (x.has('hub_spoke')) {
        if (x.multi()) { flags.connectivity = true; return { name: 'azurerm_resource_group.connectivity.name', loc: 'azurerm_resource_group.connectivity.location', id: 'azurerm_resource_group.connectivity.id', prov: 'provider = azurerm.connectivity', inHub: true }; }
        return Object.assign(x.rg('networking'), { prov: null, inHub: true });
      }
      return Object.assign(x.rg('networking'), { prov: null, inHub: false });
    },
    hubArgs() { const h = x.hub(); return [h.prov, h.prov ? '' : null, 'resource_group_name = ' + h.name, 'location = ' + h.loc].filter(v => v !== null); },

    /* networking references */
    vnetId() { return x.has('vnet') ? 'azurerm_virtual_network.main.id' : x.v('vnet_id', 'string', 'Resource ID of an existing virtual network (the Virtual Network service is not selected)'); },
    vnetName() { return x.has('vnet') ? 'azurerm_virtual_network.main.name' : x.v('vnet_name', 'string', 'Name of an existing virtual network (the Virtual Network service is not selected)'); },
    vnetSpace() { return x.has('vnet') ? 'var.vnet_address_space' : x.v('vnet_address_space', 'list(string)', 'Address space of the existing virtual network', ['10.0.0.0/16']); },
    subnetId(key) {
      if (x.has('subnet')) return `azurerm_subnet.this["${key}"].id`;
      return x.v(`${key.toLowerCase()}_subnet_id`, 'string', `Resource ID of an existing "${key}" subnet (the Subnet service is not selected)`);
    },
    // Special subnets (firewall, bastion, gateway) live in the hub VNet when hub-and-spoke is selected.
    specialSubnetId(key) {
      if (x.has('hub_spoke')) return `azurerm_subnet.hub["${key}"].id`;
      return x.subnetId(key);
    },
    // A map of subnet key => subnet ID, used by for_each associations.
    subnetIdMap(keys, varName, what) {
      if (x.has('subnet')) return `{ for k in ${hv(keys)} : k => azurerm_subnet.this[k].id }`;
      return x.v(varName, 'map(string)', `Subnet IDs to ${what}, keyed by a short name (the Subnet service is not selected)`, {});
    },
    dnsZoneId(key, what) {
      if (x.has('private_dns')) return `azurerm_private_dns_zone.this["${key}"].id`;
      return x.v(`${key}_private_dns_zone_id`, 'string', `Resource ID of an existing private DNS zone for ${what} (the Private DNS service is not selected)`);
    },

    /* shared platform references */
    law() { return x.has('log_analytics') ? 'azurerm_log_analytics_workspace.main.id' : null; },
    lawOrVar() { return x.law() || x.v('log_analytics_workspace_id', 'string', 'Resource ID of an existing Log Analytics workspace (the Log Analytics service is not selected)'); },
    appiConn() { return x.has('app_insights') ? 'azurerm_application_insights.main.connection_string' : null; },
    uai() { return x.has('identity') ? 'azurerm_user_assigned_identity.main' : null; },
    identityBlock(allowSystem = true) {
      const u = x.uai();
      if (u) return B('identity', ['type = "UserAssigned"', `identity_ids = [${u}.id]`]);
      return allowSystem ? B('identity', ['type = "SystemAssigned"']) : null;
    },
    vm() {
      if (!x.has('vm')) return null;
      const win = x.cfgOf('vm').os === 'Windows';
      const res = win ? 'azurerm_windows_virtual_machine.main' : 'azurerm_linux_virtual_machine.main';
      return { res, win, nic: 'azurerm_network_interface.vm', ids: `{ for k, vm in ${res} : k => vm.id }` };
    },
    vmss() {
      if (!x.has('vmss')) return null;
      const win = x.cfgOf('vmss').os === 'Windows';
      return { res: win ? 'azurerm_windows_virtual_machine_scale_set.main' : 'azurerm_linux_virtual_machine_scale_set.main', win };
    },
    // Governance scope: the intermediate root management group when Management Groups is selected, else the subscription.
    scope() {
      if (x.has('mgmt_groups')) return { kind: 'mg', id: 'azurerm_management_group.root.id', label: 'the intermediate root management group' };
      return { kind: 'sub', id: x.sub() + '.id', label: 'the current subscription' };
    },
  };
  return { x, vars, outs, data, locals, notes, flags };
}

/* ---------- formatting: tidy blank lines + align "=" like terraform fmt ---------- */
function tidy(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') {
      const prev = out.length ? out[out.length - 1].trim() : '';
      const next = (lines.slice(i + 1).find(s => s.trim() !== '') || '').trim();
      if (!out.length || prev === '' || /[{[(]$/.test(prev) || /^[}\])]/.test(next)) continue;
    }
    out.push(l.replace(/\s+$/, ''));
  }
  return alignEquals(out).join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
function alignEquals(lines) {
  const res = lines.slice();
  let group = [];
  const flush = () => {
    if (group.length > 1) {
      const w = Math.max(...group.map(g => g.key.length));
      for (const g of group) res[g.i] = g.ind + g.key.padEnd(w) + ' = ' + g.val;
    }
    group = [];
  };
  let heredoc = null;
  for (let i = 0; i < lines.length; i++) {
    // Like terraform fmt, a heredoc body belongs to its attribute and does not break the alignment group.
    if (heredoc) { if (lines[i].trim() === heredoc) heredoc = null; continue; }
    const m = lines[i].match(/^(\s*)([A-Za-z_][\w-]*|"[^"]+")\s*=\s(?!=)(.*)$/);
    const opensMulti = m && /[{[(]\s*$/.test(m[3]) && !/^\s*[{[(].*[}\])]\s*$/.test(m[3]);
    const hd = m && m[3].match(/^<<-?([A-Za-z_]\w*)\s*$/);
    if (hd) heredoc = hd[1];
    if (m && !opensMulti) {
      if (group.length && group[0].ind !== m[1]) flush();
      group.push({ i, ind: m[1], key: m[2], val: m[3] });
    } else flush(); // like terraform fmt, an attribute whose value spans lines is not padded and ends the group
  }
  flush();
  return res;
}

/* ---------- main generator ---------- */
function generateProject(selIds, cfgAll, g) {
  const sel = new Set(selIds);
  const { x, vars, outs, data, locals, notes, flags } = makeCtx(sel, cfgAll, g);
  const ordered = SERVICES.filter(s => sel.has(s.id));
  const svcFiles = [];

  x.setCurrent('_global');
  x.v('subscription_id', 'string', 'Target subscription ID. Leave null to use ARM_SUBSCRIPTION_ID or the Azure CLI default subscription.', null);
  x.v('location', 'string', 'Azure region for every resource, for example southeastasia', g.region, { condition: 'can(regex("^[a-z]+[a-z0-9]*$", var.location))', error: 'location must be a region name such as southeastasia (lowercase, no spaces).' });
  x.v('project_name', 'string', 'Short project name used in resource names (lowercase, hyphens)', g.project, { condition: 'can(regex("^[a-z][a-z0-9-]{1,14}$", var.project_name))', error: 'project_name must be 2-15 lowercase letters, numbers or hyphens, starting with a letter.' });
  x.v('environment', 'string', 'Deployment environment', g.env, { condition: 'contains(["dev", "test", "prod"], var.environment)', error: 'environment must be dev, test or prod.' });
  x.v('additional_tags', 'map(string)', 'Extra tags merged into local.common_tags', {});
  if (g.subMode === 'multi') {
    x.v('connectivity_subscription_id', 'string', 'Subscription for shared networking (hub VNet, firewall, gateways). Used by the azurerm.connectivity provider alias.', null);
    x.v('management_subscription_id', 'string', 'Subscription for shared management (Log Analytics). Used by the azurerm.management provider alias.', null);
  }

  for (const s of ordered) {
    x.setCurrent(s.id);
    const c = Object.assign(defaultConfig(s), cfgAll[s.id] || {});
    const out = s.gen(c, x);
    if (Array.isArray(out)) for (const p of out) svcFiles.push({ svc: s, body: p.body, stem: p.stem, part: p });
    else svcFiles.push({ svc: s, body: out, stem: s.file });
  }

  const files = [];
  const header = (title, lines) => `# ${title}\n` + lines.map(l => '# ' + l).join('\n') + '\n\n';

  // providers.tf
  const features = [];
  if (sel.has('recovery_vault') || sel.has('vm_backup')) features.push(B('recovery_service', ['vm_backup_stop_protection_and_retain_data_on_destroy = true', 'purge_protected_items_from_vault_on_destroy = false']));
  if (sel.has('log_analytics')) features.push(B('log_analytics_workspace', ['permanently_delete_on_destroy = false']));
  if (sel.has('resource_group')) features.push(B('resource_group', ['prevent_deletion_if_contains_resources = true']));
  const provBody = (extra) => [...extra, '', features.length ? B('features', features) : 'features {}', flags.storageAad ? '' : null, flags.storageAad ? '# Use Microsoft Entra ID (not account keys) for storage data-plane calls.' : null, flags.storageAad ? 'storage_use_azuread = true' : null];
  let providers = header('providers.tf', [
    'Terraform and provider requirements.',
    'Authentication is NOT configured here. The azurerm provider signs in with the Azure CLI,',
    'a managed identity, or OIDC / workload identity federation, read from ARM_* environment variables.',
  ]) + R('terraform', [
    `required_version = ">= ${g.tf}.0"`, '',
    B('required_providers', ['azurerm = {\n  source  = "hashicorp/azurerm"\n  version = ' + hq(g.provider) + '\n}']), '',
    '# Remote state in Azure Storage with Entra ID auth. Blob leases lock the state. Uncomment after creating the account.',
    '# backend "azurerm" {\n#   resource_group_name  = "rg-tfstate"\n#   storage_account_name = "sttfstate001"\n#   container_name       = "tfstate"\n#   key                  = "terraform-studio.tfstate"\n#   use_azuread_auth     = true\n# }',
  ]) + '\n\n' + R('provider "azurerm"', provBody(['subscription_id = var.subscription_id']));
  if (g.subMode === 'multi') {
    providers += '\n\n# Multi-subscription: shared networking lives in the connectivity subscription.\n' + R('provider "azurerm"', provBody(['alias = "connectivity"', 'subscription_id = var.connectivity_subscription_id']));
    providers += '\n\n# Multi-subscription: shared logging lives in the management subscription.\n' + R('provider "azurerm"', provBody(['alias = "management"', 'subscription_id = var.management_subscription_id']));
  }
  files.push({ name: 'providers.tf', cat: 'root', content: tidy(providers) });

  // locals.tf
  const loc = [
    'name_prefix = "${var.project_name}-${var.environment}"', '',
    'common_tags = merge(\n  {\n    Project     = var.project_name\n    Environment = var.environment\n    ManagedBy   = "Terraform"\n  },\n  var.additional_tags,\n)',
  ];
  if (flags.suffix) loc.push('', '# Globally unique names (storage, SQL, Cosmos DB, registries) get a stable suffix per subscription.', 'name_compact = substr(replace(local.name_prefix, "-", ""), 0, 13)', 'unique_suffix = substr(sha1("${data.azurerm_client_config.current.subscription_id}-${local.name_prefix}"), 0, 6)');
  for (const [k, v] of locals) loc.push('', k + ' = ' + v);
  files.push({ name: 'locals.tf', cat: 'root', content: tidy(header('locals.tf', ['Values computed once and reused everywhere. azurerm has no provider-level default tags,', 'so every taggable resource sets tags = local.common_tags.']) + R('locals', loc)) });

  // variables.tf
  let varsTxt = header('variables.tf', ['Every tunable value lives here. Override them in terraform.tfvars or TF_VAR_* environment variables.']);
  let lastSvc = null;
  for (const [name, v] of vars) {
    if (v.svc !== lastSvc) { varsTxt += (lastSvc ? '\n' : '') + '# ' + (v.svc === '_global' ? 'Global' : SVC[v.svc].name) + '\n\n'; lastSvc = v.svc; }
    const items = ['description = ' + hq(v.desc), 'type = ' + v.type];
    if (v.def !== undefined) items.push('default = ' + hv(v.def));
    if (v.sensitive) items.push('sensitive = true');
    if (v.ephemeral) items.push('ephemeral = true');
    if (v.nullable === false) items.push('nullable = false');
    if (v.val) items.push('', B('validation', ['condition = ' + v.val.condition, 'error_message = ' + hq(v.val.error)]));
    varsTxt += R(`variable "${name}"`, items) + '\n\n';
  }
  files.push({ name: 'variables.tf', cat: 'root', content: tidy(varsTxt) });

  // data.tf
  if (data.size) files.push({ name: 'data.tf', cat: 'root', content: tidy(header('data.tf', ['Shared data sources: read-only lookups used by several services.']) + [...data.values()].join('\n\n')) });

  // service files
  for (const f of svcFiles) {
    const s = f.svc;
    const name = svcFileName(s, f.stem, g.layout);
    const types = typesIn(f.body);
    const links = (types.length ? types : s.res).map(t => '  ' + t + ': ' + docUrl(t));
    const title = f.part ? `${s.name}: ${f.part.title}` : s.name;
    const desc = f.part ? f.part.desc : s.desc;
    files.push({ name, cat: s.cat, svc: s.id, part: f.part && f.part.title, partDesc: f.part && f.part.desc, content: tidy(header(title, [desc, 'Registry docs:', ...links, 'Azure docs: ' + s.azdoc]) + f.body) });
  }

  // outputs.tf
  let outTxt = header('outputs.tf', ['Values printed after apply and readable by other configurations.']);
  lastSvc = null;
  for (const [name, o] of outs) {
    if (o.svc !== lastSvc) { outTxt += (lastSvc ? '\n' : '') + '# ' + SVC[o.svc].name + '\n\n'; lastSvc = o.svc; }
    outTxt += R(`output "${name}"`, ['description = ' + hq(o.desc), 'value = ' + o.value, o.sensitive ? 'sensitive = true' : null]) + '\n\n';
  }
  if (!outs.size) outTxt += '# Select services to generate outputs.\n';
  files.push({ name: 'outputs.tf', cat: 'root', content: tidy(outTxt) });

  // terraform.tfvars.example
  let tfv = '# Copy to terraform.tfvars and adjust. Never put client secrets, passwords or keys here:\n# pass sensitive inputs as TF_VAR_<name> environment variables from a secret store instead.\n\n';
  for (const [name, v] of vars) {
    if (v.sensitive) tfv += `# ${name}: sensitive, set TF_VAR_${name} from your secret store\n`;
    else if (v.def === undefined) tfv += `${name} = "REPLACE_ME" # required\n`;
    else tfv += `# ${name} = ${hv(v.def).split('\n').join('\n# ')}\n`;
  }
  files.push({ name: 'terraform.tfvars.example', cat: 'root', content: tfv });

  return { files, extras: [], notes, vars, outs, flags };
}

/* ---------- static validation ---------- */
function stripComments(t) {
  let out = '', i = 0, inStr = false;
  while (i < t.length) {
    const ch = t[i];
    if (inStr) { out += ch; if (ch === '\\') { out += t[i + 1] || ''; i += 2; continue; } if (ch === '"') inStr = false; i++; continue; }
    if (ch === '"') { inStr = true; out += ch; i++; continue; }
    if (ch === '#' || (ch === '/' && t[i + 1] === '/')) { while (i < t.length && t[i] !== '\n') i++; continue; }
    if (ch === '/' && t[i + 1] === '*') { const e = t.indexOf('*/', i + 2); i = e < 0 ? t.length : e + 2; continue; }
    out += ch; i++;
  }
  return out;
}
function balance(t) {
  const pairs = { '{': '}', '[': ']', '(': ')' }, stack = [];
  let line = 1, inStr = false, interp = 0;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === '\n') { line++; if (inStr && !interp) return `Unterminated string on line ${line - 1}`; }
    if (inStr && !interp) {
      if (ch === '\\') { i++; continue; }
      if (ch === '$' && t[i + 1] === '{') { interp++; stack.push({ ch: '{', line, interp: true }); i++; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (pairs[ch]) stack.push({ ch, line });
    else if ('}])'.includes(ch)) {
      const top = stack.pop();
      if (!top || pairs[top.ch] !== ch) return `Unexpected "${ch}" on line ${line}`;
      if (top.interp) { interp--; inStr = true; }
    }
  }
  if (inStr) return 'Unterminated string at end of file';
  if (stack.length) return `Unclosed "${stack[stack.length - 1].ch}" opened on line ${stack[stack.length - 1].line}`;
  return null;
}

// Top-level resource and data blocks with their full text (strings and nested braces respected).
function hclBlocks(content) {
  const out = [];
  const re = /^(resource|data)\s+"([^"]+)"\s+"([^"]+)"\s*\{/gm;
  let m;
  while ((m = re.exec(content))) {
    let depth = 0, i = m.index + m[0].length - 1, inStr = false;
    for (; i < content.length; i++) {
      const c = content[i];
      if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) break; }
    }
    out.push({ kind: m[1], type: m[2], name: m[3], text: content.slice(m.index, i + 1) });
  }
  return out;
}

function validateProject(files, selIds, cfgAll, g) {
  const sel = new Set(selIds);
  const checks = {
    syntax: { label: 'Terraform syntax (brackets and strings)', items: [] },
    variables: { label: 'Variables', items: [] },
    refs: { label: 'Resource, data and local references', items: [] },
    outputs: { label: 'Outputs', items: [] },
    provider: { label: 'Provider configuration', items: [] },
    naming: { label: 'Naming consistency', items: [] },
    security: { label: 'Security', items: [] },
    design: { label: 'Dependencies and design', items: [] },
  };
  const add = (k, level, msg) => checks[k].items.push({ level, msg });
  const tf = files.filter(f => f.name.endsWith('.tf'));
  const declared = { vars: new Map(), res: new Map(), data: new Map(), outs: new Map(), locals: new Set(), aliases: new Set() };
  const all = [];
  for (const f of tf) {
    const b = balance(f.content);
    if (b) add('syntax', 'error', `${f.name}: ${b}`);
    const code = stripComments(f.content);
    all.push({ f, code });
    for (const m of code.matchAll(/^\s*variable\s+"([^"]+)"/gm)) { if (declared.vars.has(m[1])) add('variables', 'error', `Variable "${m[1]}" is declared twice (${declared.vars.get(m[1])} and ${f.name}).`); declared.vars.set(m[1], f.name); }
    for (const m of code.matchAll(/^\s*resource\s+"([^"]+)"\s+"([^"]+)"/gm)) { const a = m[1] + '.' + m[2]; if (declared.res.has(a)) add('refs', 'error', `Duplicate resource address ${a} (${declared.res.get(a)} and ${f.name}).`); declared.res.set(a, f.name); }
    for (const m of code.matchAll(/^\s*data\s+"([^"]+)"\s+"([^"]+)"/gm)) { const a = m[1] + '.' + m[2]; if (declared.data.has(a)) add('refs', 'error', `Duplicate data source data.${a} (${declared.data.get(a)} and ${f.name}).`); declared.data.set(a, f.name); }
    for (const m of code.matchAll(/^\s*output\s+"([^"]+)"/gm)) { if (declared.outs.has(m[1])) add('outputs', 'error', `Output "${m[1]}" is declared twice.`); declared.outs.set(m[1], f.name); }
    for (const lb of code.matchAll(/^locals\s*\{([\s\S]*?)^\}/gm)) for (const m of lb[1].matchAll(/^ {2}([A-Za-z_][\w-]*)\s*=/gm)) { if (declared.locals.has(m[1])) add('refs', 'error', `local.${m[1]} is defined twice.`); declared.locals.add(m[1]); }
    for (const m of code.matchAll(/provider\s+"azurerm"\s*\{[^}]*?alias\s*=\s*"([^"]+)"/g)) declared.aliases.add(m[1]);
  }
  const usedVars = new Set();
  for (const { f, code } of all) {
    const scan = code.replace(/^\s*(variable|output|resource|data)\s+"[^"]+"(\s+"[^"]+")?/gm, '');
    for (const m of scan.matchAll(/\bvar\.([A-Za-z_][\w-]*)/g)) { usedVars.add(m[1]); if (!declared.vars.has(m[1])) add('variables', 'error', `${f.name}: var.${m[1]} is used but never declared.`); }
    for (const m of scan.matchAll(/\blocal\.([A-Za-z_][\w-]*)/g)) if (!declared.locals.has(m[1])) add('refs', 'error', `${f.name}: local.${m[1]} is not defined in a locals block.`);
    for (const m of scan.matchAll(/\bdata\.([a-z0-9_]+)\.([A-Za-z_][\w-]*)/g)) if (!declared.data.has(m[1] + '.' + m[2])) add('refs', 'error', `${f.name}: data.${m[1]}.${m[2]} is referenced but not declared.`);
    for (const m of scan.matchAll(/(?<![\w.:"/-])(azurerm_[a-z0-9_]+)\.([A-Za-z_][\w-]*)/g)) {
      const a = m[1] + '.' + m[2];
      if (!declared.res.has(a)) add(f.name === 'outputs.tf' ? 'outputs' : 'refs', 'error', `${f.name}: ${a} is referenced but no such resource exists.`);
    }
    for (const m of scan.matchAll(/provider\s*=\s*azurerm\.([A-Za-z_][\w-]*)/g)) if (!declared.aliases.has(m[1])) add('provider', 'error', `${f.name}: provider alias azurerm.${m[1]} is not configured.`);
    for (const m of scan.matchAll(/^resource\s+"[^"]+"\s+"([^"]+)"/gm)) if (!/^[a-z][a-z0-9_]*$/.test(m[1])) add('naming', 'warn', `${f.name}: the local name "${m[1]}" should be lowercase snake_case.`);
  }
  for (const [n, file] of declared.vars) if (!usedVars.has(n)) add('variables', 'warn', `var.${n} is declared in ${file} but never used.`);
  const joined = all.map(a => a.code).join('\n');
  if (!/required_providers\s*\{[\s\S]*?azurerm\s*=\s*\{[\s\S]*?source\s*=\s*"hashicorp\/azurerm"/.test(joined)) add('provider', 'error', 'required_providers does not declare hashicorp/azurerm.');
  if (!/provider\s+"azurerm"\s*\{[\s\S]*?features\s*(\{|=)/.test(joined)) add('provider', 'error', 'The azurerm provider block needs a features {} block.');
  if (!/required_version\s*=/.test(joined)) add('provider', 'warn', 'No required_version constraint for Terraform itself.');
  if (/_wo\s*=/.test(joined) && +String(g.tf).split('.')[1] < 11) add('provider', 'error', 'Write-only arguments (*_wo) need Terraform 1.11 or newer. Raise the Terraform version.');
  if (!declared.outs.size) add('outputs', 'warn', 'No outputs are defined.');

  // Naming: top-level resources should build their name from local.name_prefix or a variable, so environments never collide.
  const TOP = /^azurerm_(resource_group|virtual_network|storage_account|kubernetes_cluster|linux_virtual_machine|windows_virtual_machine|log_analytics_workspace|recovery_services_vault|mssql_server|postgresql_flexible_server|mysql_flexible_server|cosmosdb_account|container_registry|application_gateway|firewall|key_vault)$/;
  for (const { f, code } of all) for (const b of hclBlocks(code)) {
    if (b.kind !== 'resource' || !TOP.test(b.type)) continue;
    const m = b.text.match(/^ {2}name\s*=\s*"([^"$]*)"\s*$/m);
    if (m) add('naming', 'warn', `${f.name}: ${b.type}.${b.name} uses the literal name "${m[1]}". Build it from local.name_prefix so environments do not collide.`);
  }

  // Security
  const raw = files.map(f => f.content).join('\n');
  if (/\b(client_secret|client_certificate_password|client_certificate|oidc_token|access_key)\s*=/.test(joined.replace(/storage_account_access_key\s*=/g, ''))) add('security', 'error', 'Credentials are set in code. Sign in with the Azure CLI, a managed identity or OIDC instead.');
  if (/\b(admin_password|administrator_login_password|administrator_password|password|shared_key)\s*=\s*"[^"$]/.test(joined)) add('security', 'error', 'A literal password or shared key is set. Pass it as a sensitive variable or use Microsoft Entra authentication.');
  if (/AccountKey=[A-Za-z0-9+/=]{20,}/.test(raw)) add('security', 'error', 'A storage account key or connection string is embedded. Remove it and rotate the key.');
  if (/[?&]sig=[A-Za-z0-9%+/=]{20,}/.test(raw)) add('security', 'error', 'A SAS token is embedded. Remove it and revoke the token.');
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(raw)) add('security', 'error', 'A private key is embedded in the configuration.');
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}~[A-Za-z0-9._~-]{20,}/i.test(raw)) add('security', 'error', 'Something that looks like an Entra ID client secret is present.');
  if (/source_address_prefix\s*=\s*"(\*|Internet|0\.0\.0\.0\/0)"/.test(joined) && /destination_port_ranges?\s*=.*\b(22|3389)\b/.test(joined)) add('security', 'warn', 'An NSG rule may open SSH or RDP to the internet. Use Azure Bastion instead.');
  const cfgOf = id => Object.assign(defaultConfig(SVC[id]), cfgAll[id] || {});
  if (sel.has('storage_account') && cfgOf('storage_account').shared_key) add('security', 'warn', 'Shared key access is enabled on the storage account. Prefer Microsoft Entra ID and turn it off.');
  if (sel.has('aks') && !cfgOf('aks').private && sel.has('aks')) add('security', 'info', 'The AKS API server is public. Restrict authorized IP ranges or use a private cluster for production.');
  if (!checks.security.items.some(i => i.level === 'error')) add('security', 'ok', 'No client secrets, passwords, keys, SAS tokens or private keys found in the generated code.');

  // Design and dependency checks
  for (const id of sel) for (const d of depsOf(id, cfgOf(id), i => sel.has(i))) if (!sel.has(d)) add('design', 'info', `${SVC[id].name} usually pairs with ${SVC[d].name}. It uses an input variable or skips that part instead.`);
  if (sel.has('vnet') && sel.has('subnet')) {
    const space = csv(cfgOf('vnet').address_space);
    const subs = subnetPlan(cfgOf('subnet'), i => sel.has(i));
    for (const s of subs) {
      if (!cidrParse(s.cidr)) { add('design', 'error', `Subnet ${s.key}: "${s.cidr}" is not a valid IPv4 CIDR.`); continue; }
      if (!cidrParse(s.cidr).aligned) add('design', 'error', `Subnet ${s.key}: ${s.cidr} is not aligned to its prefix length.`);
      if (!space.some(sp => cidrWithin(s.cidr, sp))) add('design', 'error', `Subnet ${s.key} (${s.cidr}) is outside the VNet address space ${space.join(', ')}.`);
      if (s.min && cidrParse(s.cidr).prefix > s.min) add('design', 'error', `${s.key} must be /${s.min} or larger; ${s.cidr} is too small.`);
    }
    for (let i = 0; i < subs.length; i++) for (let j = i + 1; j < subs.length; j++) if (cidrOverlap(subs[i].cidr, subs[j].cidr)) add('design', 'error', `Subnets ${subs[i].key} (${subs[i].cidr}) and ${subs[j].key} (${subs[j].cidr}) overlap.`);
  }
  if (sel.has('hub_spoke') && sel.has('vnet')) {
    const h = cfgOf('hub_spoke'), spoke = csv(cfgOf('vnet').address_space);
    if (spoke.some(s => cidrOverlap(s, h.hub_space))) add('design', 'error', `The hub address space ${h.hub_space} overlaps the spoke VNet. Peered VNets need distinct ranges.`);
    for (const [n, c] of Object.entries(kvList(h.spokes))) if (cidrOverlap(c, h.hub_space) || spoke.some(s => cidrOverlap(s, c))) add('design', 'error', `Additional spoke ${n} (${c}) overlaps another VNet in the hub-and-spoke design.`);
  }
  if (sel.has('hub_spoke') && sel.has('vwan')) add('design', 'warn', 'Hub-and-spoke peering and Virtual WAN are two different hub models. Most designs use one of them.');
  if (sel.has('private_endpoint') && !sel.has('private_dns')) add('design', 'warn', 'Private endpoints need private DNS zones so names resolve to the private IP. Select Private DNS Zone or pass existing zone IDs.');
  if (sel.has('private_endpoint') && !peTargets(i => sel.has(i)).length) add('design', 'warn', 'Private Endpoint is selected but no supported PaaS service is: select Storage, SQL, Cosmos DB, Container Registry, Managed Redis, Web App or Function App.');
  if (sel.has('acr') && sel.has('private_endpoint') && cfgOf('acr').sku !== 'Premium') add('design', 'error', 'Private endpoints for Container Registry need the Premium SKU.');
  if (sel.has('appgw_waf') && sel.has('appgw') && cfgOf('appgw').sku !== 'WAF_v2') add('design', 'error', 'A WAF policy can only be attached to an Application Gateway with the WAF_v2 SKU.');
  if (sel.has('frontdoor') && cfgOf('frontdoor').waf && cfgOf('frontdoor').sku !== 'Premium_AzureFrontDoor') add('design', 'info', 'The Standard Front Door tier has no managed WAF rule sets, so the policy starts with custom rules only. Use Premium for OWASP and bot protection.');
  if (sel.has('postgres')) { const c = cfgOf('postgres'); if (c.ha && c.sku.startsWith('B_')) add('design', 'error', 'Zone-redundant high availability is not available on Burstable (B_) PostgreSQL SKUs.'); if (c.network === 'Private (VNet integration)' && !sel.has('subnet')) add('design', 'info', 'Private PostgreSQL needs a subnet delegated to Microsoft.DBforPostgreSQL/flexibleServers; pass its ID as a variable.'); }
  if (sel.has('mysql')) { const c = cfgOf('mysql'); if (c.ha && c.sku.startsWith('B_')) add('design', 'error', 'High availability is not available on Burstable (B_) MySQL SKUs.'); }
  if (sel.has('cosmos')) { const c = cfgOf('cosmos'); if (c.serverless && c.secondary) add('design', 'error', 'Serverless Cosmos DB accounts run in a single region. Turn off the secondary region or use provisioned throughput.'); if (c.serverless && c.free_tier) add('design', 'error', 'The Cosmos DB free tier applies to provisioned throughput, not serverless accounts.'); }
  if (sel.has('recovery_vault')) { const c = cfgOf('recovery_vault'); if (c.crr && c.redundancy !== 'GeoRedundant') add('design', 'error', 'Cross Region Restore needs GeoRedundant vault storage.'); if (c.immutability === 'Locked') add('design', 'warn', 'Locked immutability cannot be undone: recovery points cannot be deleted before they expire.'); }
  if (sel.has('backup_vault')) { const c = cfgOf('backup_vault'); if (c.crr && c.redundancy !== 'GeoRedundant') add('design', 'error', 'Cross Region Restore on the Backup vault needs GeoRedundant redundancy.'); }
  if (sel.has('storage_lifecycle') && sel.has('storage_account')) { const r = cfgOf('storage_account').replication; if (+cfgOf('storage_lifecycle').archive > 0 && /ZRS/.test(r)) add('design', 'error', `The archive tier is not supported with ${r} replication. Use LRS, GRS or RA-GRS, or set the archive days to 0.`); }
  if (sel.has('storage_lifecycle') && sel.has('storage_account')) { const l = cfgOf('storage_lifecycle'); if (+l.cool > 0 && +l.archive > 0 && +l.archive <= +l.cool) add('design', 'error', 'Blobs must move to archive after they move to cool: archive days must be greater than cool days.'); if (+l.delete > 0 && +l.delete <= Math.max(+l.cool, +l.archive)) add('design', 'error', 'Delete days must be greater than the tiering days.'); }
  if (sel.has('nat_gateway') && sel.has('firewall') && sel.has('route_table')) add('design', 'info', 'Subnets that route 0.0.0.0/0 to Azure Firewall send internet traffic through the firewall, not the NAT gateway. Attach the NAT gateway to the firewall subnet if you need it for SNAT.');
  if (sel.has('vmss')) { const c = cfgOf('vmss'); if (c.autoscale && !(+c.min <= +c.instances && +c.instances <= +c.max)) add('design', 'error', 'Scale set sizes must satisfy minimum <= instances <= maximum.'); }
  if (sel.has('aks')) { const c = cfgOf('aks'); if (+c.min > +c.max) add('design', 'error', 'AKS system pool minimum is greater than the maximum.'); if (sel.has('firewall') && !sel.has('route_table')) add('design', 'warn', 'AKS with Azure Firewall needs a route table that sends 0.0.0.0/0 to the firewall (userDefinedRouting).'); }
  if (sel.has('vm') && cfgOf('vm').availability === 'Availability set' && cfgOf('vm').zones !== 'No zone') add('design', 'info', 'VMs in an availability set are not zonal, so the zone setting is ignored.');
  if (sel.has('ddos')) add('design', 'warn', 'Azure DDoS Network Protection is billed per plan per month (a significant fixed cost). Share one plan across subscriptions in a tenant.');
  if (sel.has('expressroute')) add('design', 'info', 'The ExpressRoute circuit starts billing when the connectivity provider provisions it. Share the service key with the provider after apply.');
  if (sel.has('site_recovery') && !sel.has('vm')) add('design', 'info', 'Site Recovery has no VM selected to replicate. The fabric, containers and policy are ready for azurerm_site_recovery_replicated_vm.');
  if (sel.has('policy') && !csv(cfgOf('policy').locations).length) add('design', 'error', 'Allowed locations is empty, so every deployment would be denied.');
  if (sel.has('policy') && sel.has('vnet') && !csv(cfgOf('policy').locations).includes(g.region)) add('design', 'error', `The default region ${g.region} is not in the policy's allowed locations, so this deployment would be denied.`);
  if (sel.has('budget') && !csv(cfgOf('budget').emails).length && !sel.has('action_group')) add('design', 'error', 'The budget needs at least one contact email or an action group to notify.');
  if (sel.has('alerts') && !sel.has('action_group')) add('design', 'info', 'Alerts fire in the portal but notify nobody until an action group is selected.');
  if (sel.has('mgmt_groups') && g.subMode === 'single') add('design', 'info', 'Management groups are created, and the current subscription can be placed in one. Switch Subscription architecture to Multi to model platform subscriptions.');
  if (!checks.design.items.length) add('design', 'ok', 'Selected services have the pieces they depend on.');

  for (const k of Object.keys(checks)) {
    const c = checks[k];
    c.items = c.items.filter(i => i.msg);
    if (!c.items.length) c.items.push({ level: 'ok', msg: { syntax: 'All brackets, braces and strings are balanced.', variables: 'Every var.* reference is declared and every variable is used.', refs: 'Every resource, data and local reference resolves.', outputs: 'All outputs reference resources that exist.', provider: 'hashicorp/azurerm is required and configured with a features block.', naming: 'Names follow the <abbreviation>-<project>-<environment> convention.' }[k] || 'OK' });
    const lv = c.items.map(i => i.level);
    c.status = lv.includes('error') ? 'error' : lv.includes('warn') ? 'warn' : 'ok';
  }
  return checks;
}

/* ---------- syntax highlighting ---------- */
const HCL_BLOCKS = new Set(['resource', 'data', 'variable', 'output', 'locals', 'module', 'provider', 'terraform', 'dynamic', 'content', 'backend', 'required_providers', 'lifecycle', 'validation', 'features', 'import', 'moved', 'removed', 'ephemeral']);
const HCL_META = new Set(['for_each', 'count', 'depends_on', 'provider', 'lifecycle', 'for', 'in', 'if', 'each', 'self', 'path']);
function tokenizeHCL(src) {
  const toks = []; let i = 0;
  const push = (c, t) => toks.push([c, t]);
  const re = { comment: /#[^\n]*|\/\/[^\n]*|\/\*[\s\S]*?\*\//y, num: /\b\d+(?:\.\d+)?\b/y, word: /[A-Za-z_][\w-]*/y };
  while (i < src.length) {
    const ch = src[i];
    let m;
    re.comment.lastIndex = i;
    if ((ch === '#' || ch === '/') && (m = re.comment.exec(src))) { push('c', m[0]); i += m[0].length; continue; }
    if (ch === '"') {
      let j = i + 1, buf = '"';
      while (j < src.length && src[j] !== '"' && src[j] !== '\n') {
        if (src[j] === '\\') { buf += src[j] + (src[j + 1] || ''); j += 2; continue; }
        if (src[j] === '$' && src[j + 1] === '{') {
          push('s', buf); buf = '';
          let d = 0, k = j;
          for (; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) break; } }
          push('i', src.slice(j, k + 1)); j = k + 1; continue;
        }
        buf += src[j]; j++;
      }
      if (src[j] === '"') { buf += '"'; j++; }
      push('s', buf); i = j; continue;
    }
    re.num.lastIndex = i;
    if (/\d/.test(ch) && (m = re.num.exec(src))) { push('n', m[0]); i += m[0].length; continue; }
    re.word.lastIndex = i;
    if (/[A-Za-z_]/.test(ch) && (m = re.word.exec(src))) {
      const w = m[0]; const rest = src.slice(i + w.length, i + w.length + 40);
      const lineStart = src.lastIndexOf('\n', i - 1) + 1;
      const atStart = /^\s*$/.test(src.slice(lineStart, i));
      let cls = 'p';
      if (w === 'true' || w === 'false' || w === 'null') cls = 'b';
      else if (atStart && HCL_BLOCKS.has(w) && /^\s*("|\{)/.test(rest)) cls = 'k';
      else if (/^\s*=(?!=)/.test(rest)) cls = HCL_META.has(w) ? 'm' : 'a';
      else if (/^\(/.test(rest)) cls = 'f';
      else if (['var', 'local', 'data', 'each', 'count', 'path', 'module'].includes(w) && rest[0] === '.') cls = 'r';
      else if (/^azurerm_/.test(w) && rest[0] === '.') cls = 'r';
      else if (atStart && /^\s*\{/.test(rest)) cls = 'k';
      push(cls, w); i += w.length; continue;
    }
    push('p', ch); i++;
  }
  return toks;
}
function escHtml(s) { return s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function highlightHCL(src, query) {
  const toks = tokenizeHCL(src);
  const q = (query || '').toLowerCase();
  let html = '', pos = 0;
  const markRanges = [];
  if (q) { const low = src.toLowerCase(); let k = low.indexOf(q); while (k >= 0) { markRanges.push([k, k + q.length]); k = low.indexOf(q, k + q.length); } }
  let mi = 0;
  for (const [cls, text] of toks) {
    const start = pos, end = pos + text.length;
    let piece = '';
    if (!markRanges.length) piece = escHtml(text);
    else {
      let p = start;
      while (mi < markRanges.length && markRanges[mi][1] <= start) mi++;
      let j = mi;
      while (j < markRanges.length && markRanges[j][0] < end) {
        const [a, b] = markRanges[j];
        const s = Math.max(a, start), e = Math.min(b, end);
        if (s > p) piece += escHtml(src.slice(p, s));
        piece += '<mark data-i="' + j + '">' + escHtml(src.slice(s, e)) + '</mark>';
        p = e;
        if (b > end) break;
        j++;
      }
      if (p < end) piece += escHtml(src.slice(p, end));
    }
    html += cls === 'p' ? piece : `<span class="t-${cls}">${piece}</span>`;
    pos = end;
  }
  return { html, count: markRanges.length, ranges: markRanges };
}

if (typeof module !== 'undefined') module.exports = { generateProject, validateProject, highlightHCL, tidy, DEFAULT_GLOBAL, TF_VERSIONS, PROVIDER_SNAPSHOT, defaultConfig, svcFileName };
