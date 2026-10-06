/* ==========================================================================
   presets.js — example architectures and the Enterprise / Standard
   landing zone templates. Every preset is generated and validated by
   test.js.
   ========================================================================== */

const LZ_TEMPLATES = {
  Enterprise: {
    title: 'Enterprise landing zone',
    summary: 'Management group hierarchy (Platform, Landing Zones, Sandbox, Decommissioned), multi-subscription providers, hub-and-spoke networking with Azure Firewall and Bastion, policy initiative, RBAC, locks, budget, central logging and backup.',
    subMode: 'multi',
    ids: ['resource_group', 'mgmt_groups', 'policy', 'rbac', 'locks', 'budget', 'vnet', 'subnet', 'nsg', 'route_table', 'hub_spoke', 'firewall', 'bastion', 'private_dns', 'log_analytics', 'diagnostics', 'action_group', 'alerts', 'recovery_vault'],
    cfg: { resource_group: { layout: 'One per workload layer' }, mgmt_groups: { model: 'Enterprise', place_current: 'corp' } },
  },
  Standard: {
    title: 'Standard landing zone',
    summary: 'One subscription: resource group, VNet with subnets and NSGs, Azure Policy for locations and tags, RBAC, a delete lock, diagnostic settings and a Log Analytics workspace.',
    subMode: 'single',
    ids: ['resource_group', 'policy', 'rbac', 'locks', 'vnet', 'subnet', 'nsg', 'log_analytics', 'diagnostics', 'action_group'],
    cfg: {},
  },
};

const PRESETS = [
  { name: 'Guided example: Linux VM in a VNet', ids: ['resource_group', 'vnet', 'subnet', 'nsg', 'bastion', 'identity', 'vm', 'log_analytics', 'dcr'], cfg: { vm: { count: 1 } } },
  { name: 'Spec journey: governed app with VM, SQL and backup', ids: ['resource_group', 'policy', 'rbac', 'vnet', 'subnet', 'nsg', 'private_dns', 'private_endpoint', 'vm', 'sql_server', 'sql_database', 'storage_account', 'recovery_vault', 'vm_backup', 'log_analytics'] },
  { name: 'Web app + Azure SQL behind Front Door', ids: ['resource_group', 'vnet', 'subnet', 'private_dns', 'private_endpoint', 'app_service_plan', 'web_app', 'identity', 'sql_server', 'sql_database', 'frontdoor', 'log_analytics', 'app_insights', 'diagnostics', 'action_group', 'alerts'], cfg: { web_app: { vnet: true } } },
  { name: 'AKS platform with ACR and private networking', ids: ['resource_group', 'vnet', 'subnet', 'nsg', 'nat_gateway', 'identity', 'aks', 'acr', 'private_dns', 'private_endpoint', 'log_analytics', 'diagnostics'] },
  { name: 'Serverless: Functions, Storage and Cosmos DB', ids: ['resource_group', 'function_app', 'storage_account', 'blob_container', 'storage_queue', 'storage_lifecycle', 'cosmos', 'identity', 'log_analytics', 'app_insights'] },
  { name: 'Hub-and-spoke with VPN and Azure Firewall', ids: ['resource_group', 'vnet', 'subnet', 'nsg', 'route_table', 'hub_spoke', 'firewall', 'bastion', 'vpn_gw', 'private_dns', 'log_analytics', 'diagnostics'] },
  { name: 'Scale set behind Application Gateway WAF', ids: ['resource_group', 'vnet', 'subnet', 'nsg', 'nat_gateway', 'appgw', 'appgw_waf', 'vmss', 'log_analytics', 'diagnostics', 'action_group', 'alerts'] },
  { name: 'Data platform: PostgreSQL, MySQL and Redis', ids: ['resource_group', 'vnet', 'subnet', 'private_dns', 'private_endpoint', 'postgres', 'mysql', 'redis', 'log_analytics', 'diagnostics', 'backup_vault', 'storage_account'] },
  { name: 'Enterprise landing zone', ids: LZ_TEMPLATES.Enterprise.ids, cfg: LZ_TEMPLATES.Enterprise.cfg, subMode: 'multi' },
  { name: 'Standard landing zone', ids: LZ_TEMPLATES.Standard.ids, cfg: LZ_TEMPLATES.Standard.cfg, subMode: 'single' },
];
