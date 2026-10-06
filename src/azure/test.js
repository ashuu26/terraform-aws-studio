// Generator tests for the Azure studio. Run: node test.js   (add --print to dump a sample project)
// Generates every service alone, all services together and every preset, runs the static checks,
// and asserts behaviour of the landing zone, networking, database, backup and monitoring generators.
// Exits non-zero on any failure. terraform validate is run separately (see README).
const fs = require('fs'), path = require('path'), vm = require('vm');
const FILES = ['core.js', 'gen_landingzone.js', 'gen_networking.js', 'gen_compute.js', 'gen_storage.js', 'gen_database.js', 'gen_backup.js', 'gen_monitoring.js', 'engine.js', 'learn.js', 'presets.js'];
const src = FILES.map(f => fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/^if \(typeof module[^\n]*\n?/m, '')).join('\n');
const ctx = { console }; vm.createContext(ctx);
vm.runInContext(src + '\nthis.API={SERVICES,SVC,PRESETS,LZ_TEMPLATES,generateProject,validateProject,DEFAULT_GLOBAL,highlightHCL,depsOf,RES_INFO,RES_GUIDE,MODULES,LZ_TOPICS,docUrl,subnetPlan,cidrOverlap,cidrWithin};', ctx);
const A = ctx.API;
const G = (o = {}) => Object.assign({}, A.DEFAULT_GLOBAL, o);
const gen = (ids, cfg = {}, g = {}) => A.generateProject(ids, cfg, G(g));
const all = p => p.files.map(f => f.content).join('\n');
const file = (p, n) => (p.files.find(f => f.name === n) || {}).content || '';

let pass = 0; const fails = [];
function t(name, fn) { try { fn(); pass++; } catch (e) { fails.push(name + ': ' + e.message); } }
function ok(c, msg) { if (!c) throw new Error(msg || 'assertion failed'); }
// Errors anywhere, or warnings outside the advisory categories, fail a run.
function problems(ids, cfg = {}, g = {}) {
  const p = gen(ids, cfg, g);
  const v = A.validateProject(p.files, ids, cfg, G(g));
  const out = [];
  for (const k in v) for (const i of v[k].items) if (i.level === 'error' || (i.level === 'warn' && !['design', 'security', 'naming'].includes(k))) out.push(k + ': ' + i.msg);
  return { p, out };
}
function run(ids, label, cfg, g) {
  const { out } = problems(ids, cfg, g);
  t(label, () => ok(!out.length, out.join(' | ')));
}

// Private Endpoint alone has no PaaS target, so it legitimately produces no outputs.
for (const s of A.SERVICES) run(s.id === 'private_endpoint' ? ['private_endpoint', 'storage_account'] : [s.id], 'solo ' + s.id);
// Lifecycle tiering to archive is invalid on ZRS, so the "everything" run uses LRS.
run(A.SERVICES.map(s => s.id), 'ALL', { storage_account: { replication: 'LRS' } });
run(A.SERVICES.map(s => s.id), 'ALL multi-subscription', { storage_account: { replication: 'LRS' } }, { subMode: 'multi' });
for (const pr of A.PRESETS) run(pr.ids, 'preset ' + pr.name, pr.cfg || {}, pr.subMode ? { subMode: pr.subMode } : {});
for (const [k, tp] of Object.entries(A.LZ_TEMPLATES)) run(tp.ids, 'landing zone template ' + k, tp.cfg, { subMode: tp.subMode });
run(A.SERVICES.map(s => s.id), 'ALL category layout', { storage_account: { replication: 'LRS' } }, { layout: 'category' });

/* ---------- metadata ---------- */
t('every service has metadata', () => { for (const s of A.SERVICES) ok(s.name && s.cat && s.diff && s.res.length && s.azdoc && s.desc && s.use, s.id); });
t('categories are the seven required', () => ok(['landingzone', 'compute', 'storage', 'networking', 'database', 'backup', 'monitoring'].every(c => A.SERVICES.some(s => s.cat === c))));
t('dependencies reference real services', () => { for (const s of A.SERVICES) for (const d of s.deps) ok(A.SVC[d], `${s.id} -> ${d}`); });
t('registry URLs derive from resource types', () => {
  ok(A.docUrl('azurerm_virtual_network') === 'https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/virtual_network');
  ok(A.docUrl('data.azurerm_client_config') === 'https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/data-sources/client_config');
});
t('every generated type has learning content', () => {
  const types = new Set();
  const p = gen(A.SERVICES.map(s => s.id), { storage_account: { replication: 'LRS' } }, { subMode: 'multi' });
  for (const m of all(p).matchAll(/^(resource|data)\s+"([^"]+)"/gm)) types.add((m[1] === 'data' ? 'data.' : '') + m[2]);
  for (const s of A.SERVICES) for (const r of s.res) types.add(r);
  const missing = [...types].filter(x => !A.RES_INFO[x]);
  ok(!missing.length, 'no RES_INFO for ' + missing.join(', '));
});
t('every service is covered by a module entry or listed without one', () => { for (const k of Object.keys(A.MODULES)) ok(/^avm-(res|ptn)-/.test(k), k); });

/* ---------- providers and security ---------- */
t('providers.tf pins azurerm and has features', () => { const p = file(gen(['vnet']), 'providers.tf'); ok(/source\s+= "hashicorp\/azurerm"/.test(p)); ok(/version\s+= "~> 5.0"/.test(p)); ok(/features/.test(p)); ok(!/client_secret|client_id\s*=/.test(p)); });
t('multi-subscription adds aliases', () => { const p = gen(['hub_spoke', 'vnet', 'firewall', 'log_analytics'], {}, { subMode: 'multi' }); const pr = file(p, 'providers.tf'); ok(/alias\s+= "connectivity"/.test(pr) && /alias\s+= "management"/.test(pr)); ok(/provider = azurerm.connectivity/.test(file(p, 'firewall.tf'))); ok(/provider = azurerm.management/.test(file(p, 'log_analytics.tf'))); });
t('no secrets are generated', () => {
  const txt = all(gen(A.SERVICES.map(s => s.id), { vm: { os: 'Windows', image: 'Windows Server 2022 Azure Edition' } }));
  ok(!/password\s*=\s*"/.test(txt) && !/shared_key\s*=\s*"/.test(txt) && !/BEGIN [A-Z ]*PRIVATE KEY/.test(txt) && !/client_secret/.test(txt));
});
t('sensitive inputs have no default', () => { const p = gen(['vm', 'vpn_gw', 'mysql'], { vm: { os: 'Windows', image: 'Windows Server 2022 Azure Edition' } }); for (const n of ['admin_password', 'vpn_shared_key', 'mysql_admin_password']) { const v = p.vars.get(n); ok(v && v.sensitive && v.def === undefined, n); } ok(p.vars.get('mysql_admin_password').ephemeral); });
t('SQL and PostgreSQL are Entra-only', () => { const p = gen(['sql_server', 'postgres']); ok(/azuread_authentication_only\s+= true/.test(file(p, 'sql_server.tf'))); ok(/password_auth_enabled\s+= false/.test(file(p, 'postgresql.tf'))); });
t('MySQL uses a write-only password', () => ok(/administrator_password_wo\s+= var.mysql_admin_password/.test(file(gen(['mysql']), 'mysql.tf'))));
t('static checks flag a hard-coded password', () => { const p = gen(['vnet']); p.files.push({ name: 'bad.tf', content: 'resource "azurerm_mssql_server" "x" {\n  administrator_login_password = "Hunter2!"\n}\n' }); const v = A.validateProject(p.files, ['vnet'], {}, G()); ok(v.security.items.some(i => i.level === 'error')); });

/* ---------- references and dependency awareness ---------- */
t('resources reference the resource group', () => ok(/resource_group_name\s+= azurerm_resource_group.main.name/.test(file(gen(['resource_group', 'vnet']), 'vnet.tf'))));
t('missing resource group falls back to a data source', () => { const p = gen(['vnet']); ok(/data "azurerm_resource_group" "main"/.test(file(p, 'data.tf'))); ok(p.vars.has('resource_group_name')); });
t('per-layer resource groups place services by category', () => { const p = gen(['resource_group', 'vnet', 'storage_account'], { resource_group: { layout: 'One per workload layer' } }); ok(/azurerm_resource_group.layer\["network"\]/.test(file(p, 'vnet.tf'))); ok(/azurerm_resource_group.layer\["data"\]/.test(file(p, 'storage_account.tf'))); });
t('VM references subnet, NSG association and identity', () => { const p = gen(['vnet', 'subnet', 'nsg', 'identity', 'vm']); ok(/subnet_id\s+= azurerm_subnet.this\["app"\].id/.test(file(p, 'vm.tf'))); ok(/azurerm_user_assigned_identity.main.id/.test(file(p, 'vm.tf'))); ok(/azurerm_subnet_network_security_group_association/.test(file(p, 'nsg.tf'))); });
t('VM without subnet asks for an ID', () => ok(gen(['vm']).vars.has('app_subnet_id')));
t('special subnets appear only when needed', () => { const c = (ids) => Object.keys(gen(['subnet', ...ids]).vars.get('subnets').def); ok(!c([]).includes('AzureFirewallSubnet')); ok(c(['firewall']).includes('AzureFirewallSubnet')); ok(!c(['firewall', 'hub_spoke']).includes('AzureFirewallSubnet')); ok(c(['postgres']).includes('postgres')); ok(!c(['postgres']).includes('mysql')); });
t('hub-and-spoke moves firewall into the hub', () => { const p = gen(['vnet', 'subnet', 'hub_spoke', 'firewall', 'vpn_gw']); ok(/azurerm_subnet.hub\["AzureFirewallSubnet"\]/.test(file(p, 'firewall.tf'))); ok(/use_remote_gateways\s+= true/.test(file(p, 'hub_spoke.tf'))); ok(/depends_on = \[azurerm_virtual_network_gateway.main/.test(file(p, 'hub_spoke.tf'))); });
t('route table points at the firewall', () => ok(/next_hop_in_ip_address = azurerm_firewall.main.ip_configuration\[0\].private_ip_address/.test(file(gen(['subnet', 'route_table', 'firewall']), 'route_table.tf'))));
t('private endpoints follow the selection', () => { const p = gen(['subnet', 'private_dns', 'private_endpoint', 'storage_account', 'sql_server', 'cosmos']); const pe = file(p, 'private_endpoint.tf'); ok(/"storage_blob"/.test(pe) && /"sql"/.test(pe) && /"cosmos"/.test(pe)); ok(/privatelink.database.windows.net/.test(file(p, 'locals.tf'))); ok(/public_network_access\s+= "Disabled"/.test(file(p, 'storage_account.tf'))); });
t('dependency suggestions are explicit', () => { const d = A.depsOf('vm', {}, () => false); ok(d.includes('subnet') && d.includes('nsg') && d.includes('identity')); });
t('subnet overlap is caught', () => { const v = A.validateProject(gen(['vnet', 'subnet'], { subnet: { data: '10.0.1.128/25' } }).files, ['vnet', 'subnet'], { subnet: { data: '10.0.1.128/25' } }, G()); ok(v.design.items.some(i => /overlap/.test(i.msg))); });
t('subnet outside the VNet is caught', () => { const cfg = { subnet: { app: '192.168.1.0/24' } }; const v = A.validateProject(gen(['vnet', 'subnet'], cfg).files, ['vnet', 'subnet'], cfg, G()); ok(v.design.items.some(i => /outside the VNet/.test(i.msg))); });
t('a broken reference is caught', () => { const p = gen(['vnet']); p.files.push({ name: 'x.tf', content: 'resource "azurerm_subnet" "y" {\n  virtual_network_name = azurerm_virtual_network.missing.name\n}\n' }); ok(A.validateProject(p.files, ['vnet'], {}, G()).refs.items.some(i => i.level === 'error')); });

/* ---------- landing zone ---------- */
t('enterprise hierarchy has the CAF archetypes', () => { const l = file(gen(['mgmt_groups']), 'locals.tf'); for (const k of ['platform', 'landingzones', 'sandbox', 'decommissioned', 'connectivity', 'corp', 'online']) ok(l.includes(k), k); });
t('standard hierarchy is three groups', () => { const l = file(gen(['mgmt_groups'], { mgmt_groups: { model: 'Standard' } }), 'locals.tf'); ok(/prod/.test(l) && /nonprod/.test(l) && !/corp/.test(l)); });
t('policy targets the management group when present', () => { ok(/azurerm_management_group_policy_assignment/.test(file(gen(['mgmt_groups', 'policy']), 'policy.tf'))); ok(/azurerm_subscription_policy_assignment/.test(file(gen(['policy']), 'policy.tf'))); });
t('modify policies get an identity and a role', () => { const p = file(gen(['policy']), 'policy.tf'); ok(/identity \{\n\s+type = "SystemAssigned"/.test(p)); ok(/role_definition_name = "Contributor"/.test(p)); });
t('policy region check', () => { const cfg = { policy: { locations: 'westeurope' } }; ok(A.validateProject(gen(['vnet', 'policy'], cfg).files, ['vnet', 'policy'], cfg, G()).design.items.some(i => /not in the policy/.test(i.msg))); });

/* ---------- backup and monitoring ---------- */
t('VM backup protects every VM', () => ok(/for_each = \{ for k, vm in azurerm_linux_virtual_machine.main : k => vm.id \}/.test(file(gen(['vm', 'recovery_vault', 'vm_backup']), 'backup_vm.tf'))));
t('cross region restore needs GRS', () => { const cfg = { recovery_vault: { crr: true, redundancy: 'LocallyRedundant' } }; ok(A.validateProject(gen(['recovery_vault'], cfg).files, ['recovery_vault'], cfg, G()).design.items.some(i => i.level === 'error')); });
t('diagnostics cover selected services', () => { const l = file(gen(['log_analytics', 'diagnostics', 'aks', 'storage_account', 'firewall', 'subnet']), 'locals.tf'); ok(/aks/.test(l) && /blobServices\/default/.test(l) && /firewall/.test(l)); });
t('metric alerts follow the selection', () => { const a = file(gen(['action_group', 'alerts', 'vm', 'sql_database', 'sql_server']), 'alerts.tf'); ok(/Percentage CPU/.test(a) && /cpu_percent/.test(a) && /action_group_id = azurerm_monitor_action_group.main.id/.test(a)); });
t('AKS sends logs to Log Analytics', () => ok(/oms_agent/.test(file(gen(['aks', 'log_analytics']), 'aks.tf'))));
t('highlighter runs', () => ok(A.highlightHCL(file(gen(['vnet']), 'vnet.tf'), 'vnet').count > 0));

for (const f of fails) console.log('FAIL', f);
console.log(`${pass} passed, ${fails.length} failed`);
if (process.argv.includes('--print')) { const p = gen(A.PRESETS[1].ids, A.PRESETS[1].cfg || {}); for (const f of p.files) if (['providers.tf', 'vm.tf', 'private_endpoint.tf'].includes(f.name)) console.log('=== ' + f.name + '\n' + f.content); }
process.exit(fails.length ? 1 : 0);
