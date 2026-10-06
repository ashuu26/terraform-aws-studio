/* ==========================================================================
   gen_networking.js — Networking generator. Subnets are one for_each map;
   special subnets (AzureFirewallSubnet, GatewaySubnet, delegated subnets)
   are added automatically for the services that need them.
   ========================================================================== */

const DELEGATIONS = {
  postgres: ['Microsoft.DBforPostgreSQL/flexibleServers', ['Microsoft.Network/virtualNetworks/subnets/join/action']],
  mysql: ['Microsoft.DBforMySQL/flexibleServers', ['Microsoft.Network/virtualNetworks/subnets/join/action']],
  appsvc: ['Microsoft.Web/serverFarms', ['Microsoft.Network/virtualNetworks/subnets/action']],
  func: ['Microsoft.App/environments', ['Microsoft.Network/virtualNetworks/subnets/join/action']],
  aca: ['Microsoft.App/environments', ['Microsoft.Network/virtualNetworks/subnets/join/action']],
  aci: ['Microsoft.ContainerInstance/containerGroups', ['Microsoft.Network/virtualNetworks/subnets/action']],
};
const HUB_KEYS = ['AzureFirewallSubnet', 'AzureBastionSubnet', 'GatewaySubnet'];
// Subnets that must not get an NSG, route table or NAT gateway from this generator.
const SPECIAL_KEYS = [...HUB_KEYS, 'appgw'];

// The subnets the Subnet service creates for the current selection: [{ key, cidr, delegation, min, field }].
function subnetPlan(c, has) {
  const hub = has('hub_spoke');
  const out = [
    { key: 'app', cidr: c.app }, { key: 'data', cidr: c.data }, { key: 'endpoints', cidr: c.endpoints },
  ];
  const add = (cond, key, field, extra) => { if (cond) out.push(Object.assign({ key, cidr: c[field], field }, extra || {})); };
  add(has('aks'), 'aks', 'aks');
  add(has('appgw'), 'appgw', 'appgw', { min: 26 });
  add(has('bastion') && !hub, 'AzureBastionSubnet', 'bastion', { min: 26 });
  add(has('firewall') && !hub, 'AzureFirewallSubnet', 'firewall', { min: 26 });
  add(has('vpn_gw') && !hub, 'GatewaySubnet', 'gateway', { min: 27 });
  add(has('postgres') && c._pgPrivate, 'postgres', 'postgres', { delegation: 'postgres' });
  add(has('mysql') && c._myPrivate, 'mysql', 'mysql', { delegation: 'mysql' });
  add(has('web_app') && c._webVnet, 'appsvc', 'appsvc', { delegation: 'appsvc' });
  add(has('function_app') && c._funcVnet, 'func', 'func', { delegation: 'func' });
  add(has('container_apps') && c._acaVnet, 'aca', 'aca', { delegation: 'aca', min: 27 });
  add(has('aci') && c._aciPrivate, 'aci', 'aci', { delegation: 'aci' });
  return out;
}
// The subnet plan needs to know how other services are configured; the generator fills these flags.
function subnetFlags(c, x) {
  const f = Object.assign({}, c);
  f._pgPrivate = x.has('postgres') && x.cfgOf('postgres').network === 'Private (VNet integration)';
  f._myPrivate = x.has('mysql') && x.cfgOf('mysql').network === 'Private (VNet integration)';
  f._webVnet = x.has('web_app') && x.cfgOf('web_app').vnet;
  f._funcVnet = x.has('function_app') && x.cfgOf('function_app').vnet;
  f._acaVnet = x.has('container_apps') && x.cfgOf('container_apps').vnet;
  f._aciPrivate = x.has('aci') && x.cfgOf('aci').ip === 'Private';
  return f;
}
// Workload subnets an NSG / route table / NAT gateway can attach to (no special or delegated subnets except app service ones).
const workloadKeys = plan => plan.filter(s => !SPECIAL_KEYS.includes(s.key) && s.key !== 'endpoints').map(s => s.key);

// PaaS services with a private endpoint: id => [endpoint key, sub-resource, private DNS zone key, zone name, target expression].
function peTargets(has, x) {
  const t = [];
  const cosmosApi = x ? x.cfgOf('cosmos').api : 'NoSQL';
  if (has('storage_account')) t.push(['storage_blob', 'blob', 'blob', 'privatelink.blob.core.windows.net', 'azurerm_storage_account.main.id', 'storage_account']);
  if (has('storage_account') && has('file_share')) t.push(['storage_file', 'file', 'file', 'privatelink.file.core.windows.net', 'azurerm_storage_account.main.id', 'file_share']);
  if (has('sql_server')) t.push(['sql', 'sqlServer', 'sql', 'privatelink.database.windows.net', 'azurerm_mssql_server.main.id', 'sql_server']);
  if (has('cosmos')) t.push(cosmosApi === 'MongoDB' ? ['cosmos', 'MongoDB', 'cosmos_mongo', 'privatelink.mongo.cosmos.azure.com', 'azurerm_cosmosdb_account.main.id', 'cosmos'] : ['cosmos', 'Sql', 'cosmos_sql', 'privatelink.documents.azure.com', 'azurerm_cosmosdb_account.main.id', 'cosmos']);
  if (has('acr')) t.push(['acr', 'registry', 'acr', 'privatelink.azurecr.io', 'azurerm_container_registry.main.id', 'acr']);
  if (has('redis')) t.push(['redis', 'redisEnterprise', 'redis', 'privatelink.redis.azure.net', 'azurerm_managed_redis.main.id', 'redis']);
  if (has('web_app')) t.push(['web_app', 'sites', 'sites', 'privatelink.azurewebsites.net', 'azurerm_linux_web_app.main.id', 'web_app']);
  if (has('function_app')) t.push(['function_app', 'sites', 'sites', 'privatelink.azurewebsites.net', 'azurerm_function_app_flex_consumption.main.id', 'function_app']);
  return t;
}
// Private DNS zones the project needs: key => zone name expression.
function dnsZonesFor(x) {
  const z = {};
  if (x.has('private_endpoint')) for (const t of peTargets(x.has, x)) z[t[2]] = hq(t[3]);
  if (x.has('postgres') && x.cfgOf('postgres').network === 'Private (VNet integration)') z.postgres = '"${local.name_prefix}.private.postgres.database.azure.com"';
  if (x.has('mysql') && x.cfgOf('mysql').network === 'Private (VNet integration)') z.mysql = '"${local.name_prefix}.private.mysql.database.azure.com"';
  return z;
}

S({
  id: 'vnet', name: 'Virtual Network', cat: 'networking', diff: 'Beginner', file: 'vnet',
  res: ['azurerm_virtual_network'], deps: ['resource_group'], kw: 'vnet network address space cidr dns',
  azdoc: MS + 'virtual-network/virtual-networks-overview',
  desc: 'An isolated private network in one region. Subnets, NICs and private endpoints all live inside it.',
  use: 'The network boundary for VMs, AKS nodes, private endpoints and VNet-integrated PaaS services.',
  suggest: () => ['subnet'],
  fields: [
    { k: 'address_space', l: 'Address space', t: 'list', d: '10.0.0.0/16', h: 'Comma-separated CIDRs. Must not overlap networks you will peer or connect to.' },
    { k: 'dns', l: 'DNS servers', t: 'select', o: ['Azure provided', 'Custom'], d: 'Azure provided' },
    { k: 'dns_servers', l: 'Custom DNS server IPs', t: 'list', d: '10.0.0.4, 10.0.0.5', when: c => c.dns === 'Custom' },
  ],
  guide: ['Plan address space for growth and peering up front; resizing a peered VNet needs a peering sync.'],
  gen(c, x) {
    x.v('vnet_address_space', 'list(string)', 'Address space of the virtual network', csv(c.address_space), { condition: 'alltrue([for c in var.vnet_address_space : can(cidrhost(c, 0))])', error: 'Each entry must be a valid IPv4 CIDR, for example 10.0.0.0/16.' });
    x.v('vnet_dns_servers', 'list(string)', 'Custom DNS servers; an empty list uses Azure-provided DNS', c.dns === 'Custom' ? csv(c.dns_servers) : []);
    x.o('vnet_id', 'azurerm_virtual_network.main.id', 'ID of the virtual network');
    x.o('vnet_name', 'azurerm_virtual_network.main.name', 'Name of the virtual network');
    return R('resource "azurerm_virtual_network" "main"', [
      'name = ' + x.n('vnet'), ...x.rgArgs('networking'), 'address_space = var.vnet_address_space', 'dns_servers = var.vnet_dns_servers',
      x.has('ddos') ? '' : null, x.has('ddos') ? B('ddos_protection_plan', ['id = azurerm_network_ddos_protection_plan.main.id', 'enable = true']) : null,
      '', x.tags,
    ]);
  },
});

S({
  id: 'subnet', name: 'Subnets', cat: 'networking', diff: 'Beginner', file: 'subnet',
  res: ['azurerm_subnet'], deps: ['vnet'], kw: 'subnet address prefix delegation service endpoint gatewaysubnet azurefirewallsubnet azurebastionsubnet',
  azdoc: MS + 'virtual-network/virtual-network-manage-subnet',
  desc: 'App, data and private-endpoint subnets, plus the special and delegated subnets your other services need, created with for_each.',
  use: 'Separate tiers so NSGs, route tables and NAT gateways apply per tier.',
  fields: [
    { k: 'app', l: 'app subnet', t: 'text', d: '10.0.1.0/24' },
    { k: 'data', l: 'data subnet', t: 'text', d: '10.0.2.0/24' },
    { k: 'endpoints', l: 'endpoints subnet (private endpoints)', t: 'text', d: '10.0.3.0/24' },
    { k: 'outbound', l: 'Default outbound access', t: 'select', o: ['Automatic', 'Private (no default outbound)', 'Allowed'], d: 'Automatic', h: 'Automatic makes subnets private when a NAT gateway or Azure Firewall provides egress.' },
    { t: 'section', l: 'Subnets added for selected services' },
    { k: 'aks', l: 'aks subnet (AKS nodes)', t: 'text', d: '10.0.16.0/22', when: (c, has) => has('aks') },
    { k: 'appgw', l: 'appgw subnet (Application Gateway, /26 or larger)', t: 'text', d: '10.0.4.0/24', when: (c, has) => has('appgw') },
    { k: 'bastion', l: 'AzureBastionSubnet (/26 or larger)', t: 'text', d: '10.0.250.0/26', when: (c, has) => has('bastion') && !has('hub_spoke') },
    { k: 'firewall', l: 'AzureFirewallSubnet (/26 or larger)', t: 'text', d: '10.0.251.0/26', when: (c, has) => has('firewall') && !has('hub_spoke') },
    { k: 'gateway', l: 'GatewaySubnet (/27 or larger)', t: 'text', d: '10.0.252.0/27', when: (c, has) => has('vpn_gw') && !has('hub_spoke') },
    { k: 'postgres', l: 'postgres subnet (delegated)', t: 'text', d: '10.0.5.0/24', when: (c, has) => has('postgres') },
    { k: 'mysql', l: 'mysql subnet (delegated)', t: 'text', d: '10.0.6.0/24', when: (c, has) => has('mysql') },
    { k: 'appsvc', l: 'appsvc subnet (web app integration, delegated)', t: 'text', d: '10.0.7.0/24', when: (c, has) => has('web_app') },
    { k: 'func', l: 'func subnet (Flex Consumption integration, delegated)', t: 'text', d: '10.0.8.0/24', when: (c, has) => has('function_app') },
    { k: 'aca', l: 'aca subnet (Container Apps, /27 or larger)', t: 'text', d: '10.0.10.0/23', when: (c, has) => has('container_apps') },
    { k: 'aci', l: 'aci subnet (Container Instances, delegated)', t: 'text', d: '10.0.12.0/24', when: (c, has) => has('aci') },
  ],
  assume: ['Subnet names are snet-<key>, except the names Azure requires (AzureFirewallSubnet, AzureBastionSubnet, GatewaySubnet).', 'Delegated and special subnets appear only when the service that needs them is selected and configured for VNet integration.'],
  guide: ['Azure reserves five addresses in every subnet. Size AKS and App Gateway subnets for scale-out.'],
  gen(c, x) {
    const plan = subnetPlan(subnetFlags(c, x), x.has);
    const egress = x.has('nat_gateway') || x.has('firewall');
    const priv = c.outbound === 'Automatic' ? egress : c.outbound === 'Private (no default outbound)';
    const storageSe = x.has('storage_network_rules');
    const map = {};
    for (const s of plan) {
      const o = { address_prefixes: [s.cidr] };
      if (s.delegation) o.delegation = DELEGATIONS[s.delegation][0];
      if (storageSe && s.key === 'app') o.service_endpoints = ['Microsoft.Storage'];
      map[s.key] = o;
    }
    x.v('subnets', 'map(object({\n  address_prefixes  = list(string)\n  delegation        = optional(string)\n  service_endpoints = optional(list(string), [])\n}))', 'Subnets keyed by short name. Special names (AzureFirewallSubnet, GatewaySubnet, AzureBastionSubnet) are used as-is.', map);
    x.v('subnet_default_outbound_access', 'bool', 'Allow implicit default outbound internet access. false makes subnets private: egress then needs a NAT gateway or firewall.', !priv);
    x.local('subnet_delegation_actions', hv(Object.fromEntries(Object.values(DELEGATIONS).map(([n, a]) => [n, a]))));
    if (priv && !egress) x.note('Subnets are private (no default outbound access) and no NAT gateway or firewall is selected, so VMs cannot reach the internet.');
    x.o('subnet_ids', '{ for k, s in azurerm_subnet.this : k => s.id }', 'Subnet IDs keyed by short name');
    return R('resource "azurerm_subnet" "this"', [
      'for_each = var.subnets', '',
      '# Azure requires exact names for its special subnets; everything else is snet-<key>.',
      'name = startswith(each.key, "Azure") || each.key == "GatewaySubnet" ? each.key : "snet-${each.key}"',
      'resource_group_name = ' + x.rg('networking').name, 'virtual_network_name = ' + x.vnetName(), 'address_prefixes = each.value.address_prefixes',
      'default_outbound_access_enabled = contains(["AzureFirewallSubnet", "AzureBastionSubnet", "GatewaySubnet"], each.key) ? null : var.subnet_default_outbound_access', '',
      B('dynamic "service_endpoint"', ['for_each = toset(each.value.service_endpoints)', '', B('content', ['service = service_endpoint.value'])]), '',
      B('dynamic "delegation"', ['for_each = each.value.delegation == null ? [] : [each.value.delegation]', '', B('content', ['name = "delegation"', '', B('service_delegation', ['name = delegation.value', 'actions = local.subnet_delegation_actions[delegation.value]'])])]),
    ]);
  },
});

S({
  id: 'nsg', name: 'Network Security Group', cat: 'networking', diff: 'Beginner', file: 'nsg',
  res: ['azurerm_network_security_group', 'azurerm_network_security_rule', 'azurerm_subnet_network_security_group_association'],
  deps: ['subnet'], kw: 'nsg firewall rules security inbound outbound port acl',
  azdoc: MS + 'virtual-network/network-security-groups-overview',
  desc: 'A stateful allow/deny rule set attached to workload subnets, with rules as separate resources.',
  use: 'Allow HTTPS to the app tier, SSH or RDP only from Azure Bastion, and nothing else from outside the VNet.',
  fields: [
    { k: 'ports', l: 'Inbound HTTPS/HTTP ports', t: 'list', d: '443', h: 'Opened to the source below.' },
    { k: 'source', l: 'Allowed source', t: 'select', o: ['VirtualNetwork', 'AzureLoadBalancer', 'Internet'], d: 'VirtualNetwork', h: 'A service tag. Internet opens the ports to everyone.' },
    { k: 'subnets', l: 'Attach to subnets', t: 'multi', o: ['app', 'data', 'aks', 'postgres', 'mysql', 'appsvc'], d: 'app, data' },
  ],
  assume: ['The NSG is not attached to App Gateway, Bastion, firewall or gateway subnets: those have their own rules or forbid NSGs.', 'Azure default rules (allow VNet and load balancer, deny the rest) still apply below priority 4096.'],
  guide: ['Never open 22 or 3389 to Internet. Use Azure Bastion or Just-In-Time access.'],
  gen(c, x) {
    const plan = x.has('subnet') ? subnetPlan(subnetFlags(x.cfgOf('subnet'), x), x.has).map(s => s.key) : null;
    const keys = csv(c.subnets).filter(k => !plan || plan.includes(k));
    x.v('nsg_allowed_ports', 'list(string)', 'Destination ports allowed inbound from var.nsg_allowed_source', csv(c.ports));
    x.v('nsg_allowed_source', 'string', 'Service tag or CIDR allowed to reach the app ports', c.source);
    const rules = {
      'allow-app-inbound': { priority: 100, ports: 'var.nsg_allowed_ports', source: 'var.nsg_allowed_source' },
    };
    if (x.has('bastion')) {
      const bastionCidr = x.has('hub_spoke') ? x.cfgOf('hub_spoke').bastion : x.has('subnet') ? x.cfgOf('subnet').bastion : null;
      if (bastionCidr) rules['allow-bastion-inbound'] = { priority: 110, ports: '["22", "3389"]', source: hq(bastionCidr) };
    }
    const rg = x.rg('networking');
    const asg = x.has('asg');
    x.local('nsg_rules', '{\n' + Object.entries(rules).map(([k, r]) => `  ${hq(k)} = {\n    priority = ${r.priority}\n    ports    = ${r.ports}\n    source   = ${r.source}\n  }`).join('\n') + '\n}');
    x.o('nsg_id', 'azurerm_network_security_group.main.id', 'ID of the network security group');
    return [
      R('resource "azurerm_network_security_group" "main"', ['name = ' + x.n('nsg'), ...x.rgArgs('networking'), '', x.tags]),
      '# Rules as separate resources: easier to review in a plan than inline security_rule blocks.',
      R('resource "azurerm_network_security_rule" "this"', [
        'for_each = local.nsg_rules', '', 'name = each.key', 'resource_group_name = ' + rg.name, 'network_security_group_name = azurerm_network_security_group.main.name',
        'priority = each.value.priority', 'direction = "Inbound"', 'access = "Allow"', 'protocol = "Tcp"', 'source_port_range = "*"', 'destination_port_ranges = each.value.ports', 'source_address_prefix = each.value.source',
        asg ? '# Only VMs in the web application security group receive this traffic.' : null,
        asg ? 'destination_application_security_group_ids = [azurerm_application_security_group.web.id]' : 'destination_address_prefix = "VirtualNetwork"',
      ]),
      R('resource "azurerm_subnet_network_security_group_association" "this"', ['for_each = ' + x.subnetIdMap(keys, 'nsg_subnet_ids', 'protect with the NSG'), '', 'subnet_id = each.value', 'network_security_group_id = azurerm_network_security_group.main.id']),
    ].join('\n\n');
  },
});

S({
  id: 'asg', name: 'Application Security Group', cat: 'networking', diff: 'Intermediate', file: 'asg',
  res: ['azurerm_application_security_group', 'azurerm_network_interface_application_security_group_association'],
  deps: ['nsg'], kw: 'asg application security group micro-segmentation nic',
  azdoc: MS + 'virtual-network/application-security-groups',
  desc: 'A named group of NICs that NSG rules can target instead of IP addresses.',
  use: 'Write "allow 443 to web servers" once, and every VM that joins the group gets it.',
  gen(c, x) {
    const vm = x.vm();
    x.o('asg_id', 'azurerm_application_security_group.web.id', 'ID of the web application security group');
    const parts = [R('resource "azurerm_application_security_group" "web"', ['name = ' + x.n('asg', 'web'), ...x.rgArgs('networking'), '', x.tags])];
    if (vm) parts.push(R('resource "azurerm_network_interface_application_security_group_association" "vm"', ['for_each = azurerm_network_interface.vm', '', 'network_interface_id = each.value.id', 'application_security_group_id = azurerm_application_security_group.web.id']));
    return parts.join('\n\n');
  },
});

S({
  id: 'route_table', name: 'Route Table', cat: 'networking', diff: 'Intermediate', file: 'route_table',
  res: ['azurerm_route_table', 'azurerm_route', 'azurerm_subnet_route_table_association'],
  deps: ['subnet'], kw: 'udr route table user defined routes next hop firewall virtual appliance',
  azdoc: MS + 'virtual-network/virtual-networks-udr-overview',
  desc: 'User-defined routes. With Azure Firewall selected, 0.0.0.0/0 goes to the firewall.',
  use: 'Force internet-bound traffic through a firewall, or steer on-premises prefixes to a gateway.',
  fields: [
    { k: 'subnets', l: 'Attach to subnets', t: 'multi', o: ['app', 'data', 'aks', 'appsvc'], d: 'app, data' },
    { k: 'bgp', l: 'Propagate gateway routes (BGP)', t: 'bool', d: false, h: 'Off when a firewall must inspect everything; on-premises routes would otherwise bypass it.' },
  ],
  gen(c, x) {
    const fw = x.has('firewall');
    const plan = x.has('subnet') ? subnetPlan(subnetFlags(x.cfgOf('subnet'), x), x.has).map(s => s.key) : null;
    const keys = csv(c.subnets).filter(k => !plan || plan.includes(k));
    if (x.has('aks') && fw && !keys.includes('aks') && (!plan || plan.includes('aks'))) keys.push('aks');
    x.v('route_table_bgp_route_propagation', 'bool', 'Propagate routes learned by virtual network gateways', c.bgp);
    x.o('route_table_id', 'azurerm_route_table.main.id', 'ID of the route table');
    const rg = x.rg('networking');
    return [
      R('resource "azurerm_route_table" "main"', ['name = ' + x.n('rt'), ...x.rgArgs('networking'), 'bgp_route_propagation_enabled = var.route_table_bgp_route_propagation', '', x.tags]),
      fw ? '# Default route through Azure Firewall: its private IP is the next hop.' : '# Explicit default route to the internet (the same as the system route). Change next_hop_type to steer traffic.',
      R('resource "azurerm_route" "default"', [fw ? 'name = "default-via-firewall"' : 'name = "default-internet"', 'resource_group_name = ' + rg.name, 'route_table_name = azurerm_route_table.main.name', 'address_prefix = "0.0.0.0/0"', fw ? 'next_hop_type = "VirtualAppliance"' : 'next_hop_type = "Internet"', fw ? 'next_hop_in_ip_address = azurerm_firewall.main.ip_configuration[0].private_ip_address' : null]),
      R('resource "azurerm_subnet_route_table_association" "this"', ['for_each = ' + x.subnetIdMap(keys, 'route_table_subnet_ids', 'attach the route table to'), '', 'subnet_id = each.value', 'route_table_id = azurerm_route_table.main.id']),
    ].join('\n\n');
  },
});

S({
  id: 'nat_gateway', name: 'NAT Gateway', cat: 'networking', diff: 'Intermediate', file: 'nat_gateway',
  res: ['azurerm_nat_gateway', 'azurerm_public_ip', 'azurerm_nat_gateway_public_ip_association', 'azurerm_subnet_nat_gateway_association'],
  deps: ['subnet'], kw: 'nat egress outbound snat public ip',
  azdoc: MS + 'nat-gateway/nat-overview',
  desc: 'Managed outbound internet access with a static public IP for private subnets.',
  use: 'Give private VMs and AKS nodes predictable egress IPs without public IPs on each machine.',
  fields: [
    { k: 'zone', l: 'Availability zone', t: 'select', o: ['No zone', '1', '2', '3'], d: '1', h: 'A NAT gateway is zonal or regional; its public IP must use the same zone.' },
    { k: 'idle', l: 'TCP idle timeout (minutes)', t: 'number', d: 4 },
    { k: 'subnets', l: 'Attach to subnets', t: 'multi', o: ['app', 'data', 'aks', 'appsvc'], d: 'app, data' },
  ],
  gen(c, x) {
    const plan = x.has('subnet') ? subnetPlan(subnetFlags(x.cfgOf('subnet'), x), x.has).map(s => s.key) : null;
    const keys = csv(c.subnets).filter(k => !plan || plan.includes(k));
    if (x.has('aks') && !keys.includes('aks') && (!plan || plan.includes('aks'))) keys.push('aks');
    const zones = c.zone === 'No zone' ? null : `["${c.zone}"]`;
    x.v('nat_idle_timeout_minutes', 'number', 'TCP idle timeout for the NAT gateway (4-120)', +c.idle, { condition: 'var.nat_idle_timeout_minutes >= 4 && var.nat_idle_timeout_minutes <= 120', error: 'Use 4 to 120 minutes.' });
    x.o('nat_public_ip', 'azurerm_public_ip.nat.ip_address', 'Outbound public IP of the NAT gateway');
    return [
      R('resource "azurerm_public_ip" "nat"', ['name = ' + x.n('pip', 'nat'), ...x.rgArgs('networking'), 'allocation_method = "Static"', 'sku = "Standard"', zones ? 'zones = ' + zones : null, '', x.tags]),
      R('resource "azurerm_nat_gateway" "main"', ['name = ' + x.n('ng'), ...x.rgArgs('networking'), 'sku_name = "Standard"', 'idle_timeout_in_minutes = var.nat_idle_timeout_minutes', zones ? 'zones = ' + zones : null, '', x.tags]),
      R('resource "azurerm_nat_gateway_public_ip_association" "main"', ['nat_gateway_id = azurerm_nat_gateway.main.id', 'public_ip_address_id = azurerm_public_ip.nat.id']),
      R('resource "azurerm_subnet_nat_gateway_association" "this"', ['for_each = ' + x.subnetIdMap(keys, 'nat_subnet_ids', 'send outbound traffic through the NAT gateway'), '', 'subnet_id = each.value', 'nat_gateway_id = azurerm_nat_gateway.main.id']),
    ].join('\n\n');
  },
});

S({
  id: 'public_ip', name: 'Public IP Address', cat: 'networking', diff: 'Beginner', file: 'public_ip',
  res: ['azurerm_public_ip'], deps: ['resource_group'], kw: 'public ip static standard sku internet',
  azdoc: MS + 'virtual-network/ip-services/public-ip-addresses',
  desc: 'Standard, static public IPs. With Virtual Machines selected, one per VM, attached to its NIC.',
  use: 'Direct inbound access to a VM for labs. In production, put VMs behind a load balancer, App Gateway or Bastion instead.',
  fields: [{ k: 'zones', l: 'Zone redundancy', t: 'select', o: ['Zone-redundant (1, 2, 3)', 'No zone'], d: 'Zone-redundant (1, 2, 3)' }],
  guide: ['A public IP on a VM exposes it to internet scanning; pair it with a tight NSG.'],
  gen(c, x) {
    const z = c.zones === 'No zone' ? null : 'zones = ["1", "2", "3"]';
    if (x.vm()) {
      x.o('vm_public_ips', '{ for k, ip in azurerm_public_ip.vm : k => ip.ip_address }', 'Public IP of each VM');
      return R('resource "azurerm_public_ip" "vm"', ['for_each = var.vms', '', 'name = "pip-${local.name_prefix}-${each.key}"', ...x.rgArgs('networking'), 'allocation_method = "Static"', 'sku = "Standard"', '# A VM public IP must be in the same zone as the VM (or have no zone).', 'zones = each.value.zone == null ? null : [each.value.zone]', '', x.tags]);
    }
    x.o('public_ip_address', 'azurerm_public_ip.main.ip_address', 'The public IP address');
    return R('resource "azurerm_public_ip" "main"', ['name = ' + x.n('pip'), ...x.rgArgs('networking'), 'allocation_method = "Static"', 'sku = "Standard"', z, '', x.tags]);
  },
});

S({
  id: 'lb', name: 'Azure Load Balancer', cat: 'networking', diff: 'Intermediate', file: 'load_balancer',
  res: ['azurerm_lb', 'azurerm_public_ip', 'azurerm_lb_backend_address_pool', 'azurerm_lb_probe', 'azurerm_lb_rule', 'azurerm_network_interface_backend_address_pool_association'],
  deps: ['resource_group'], kw: 'load balancer layer 4 tcp backend pool health probe rule standard',
  azdoc: MS + 'load-balancer/load-balancer-overview',
  suggest: (c, has) => c.type === 'Internal' ? ['subnet'] : [],
  desc: 'A Standard layer-4 load balancer with a backend pool, health probe and rule. Selected VMs or the scale set join the pool.',
  use: 'Spread TCP traffic across VMs or a scale set, publicly or on a private IP.',
  fields: [
    { k: 'type', l: 'Frontend', t: 'select', o: ['Public', 'Internal'], d: 'Public' },
    { k: 'port', l: 'Frontend / backend port', t: 'number', d: 80 },
    { k: 'probe', l: 'Probe protocol', t: 'select', o: ['Tcp', 'Http'], d: 'Tcp' },
    { k: 'path', l: 'HTTP probe path', t: 'text', d: '/', when: c => c.probe === 'Http' },
  ],
  assume: ['Outbound SNAT through the load balancer is disabled; use a NAT gateway for egress.'],
  gen(c, x) {
    const pub = c.type === 'Public';
    x.v('lb_port', 'number', 'Frontend and backend port for the load-balancing rule', +c.port);
    const parts = [];
    if (pub) parts.push(R('resource "azurerm_public_ip" "lb"', ['name = ' + x.n('pip', 'lb'), ...x.rgArgs('networking'), 'allocation_method = "Static"', 'sku = "Standard"', 'zones = ["1", "2", "3"]', '', x.tags]));
    parts.push(R('resource "azurerm_lb" "main"', ['name = ' + x.n('lbe'), ...x.rgArgs('networking'), 'sku = "Standard"', '',
      B('frontend_ip_configuration', pub ? ['name = "frontend"', 'public_ip_address_id = azurerm_public_ip.lb.id'] : ['name = "frontend"', 'subnet_id = ' + x.subnetId('app'), 'private_ip_address_allocation = "Dynamic"', 'zones = ["1", "2", "3"]']), '', x.tags]));
    parts.push(R('resource "azurerm_lb_backend_address_pool" "main"', ['name = "backend"', 'loadbalancer_id = azurerm_lb.main.id']));
    parts.push(R('resource "azurerm_lb_probe" "main"', ['name = "probe"', 'loadbalancer_id = azurerm_lb.main.id', `protocol = "${c.probe}"`, 'port = var.lb_port', c.probe === 'Http' ? `request_path = ${hq(c.path)}` : null, 'interval_in_seconds = 5', 'number_of_probes = 2']));
    parts.push(R('resource "azurerm_lb_rule" "main"', ['name = "rule-tcp-${var.lb_port}"', 'loadbalancer_id = azurerm_lb.main.id', 'protocol = "Tcp"', 'frontend_port = var.lb_port', 'backend_port = var.lb_port', 'frontend_ip_configuration_name = "frontend"', 'backend_address_pool_ids = [azurerm_lb_backend_address_pool.main.id]', 'probe_id = azurerm_lb_probe.main.id', 'disable_outbound_snat = true', 'tcp_reset_enabled = true']));
    if (x.vm()) parts.push('# Put each VM NIC into the backend pool.', R('resource "azurerm_network_interface_backend_address_pool_association" "vm"', ['for_each = azurerm_network_interface.vm', '', 'network_interface_id = each.value.id', 'ip_configuration_name = "internal"', 'backend_address_pool_id = azurerm_lb_backend_address_pool.main.id']));
    x.o('lb_frontend_ip', pub ? 'azurerm_public_ip.lb.ip_address' : 'azurerm_lb.main.frontend_ip_configuration[0].private_ip_address', 'Frontend IP of the load balancer');
    return parts.join('\n\n');
  },
});

S({
  id: 'appgw', name: 'Application Gateway', cat: 'networking', diff: 'Intermediate', file: 'application_gateway',
  res: ['azurerm_application_gateway', 'azurerm_public_ip', 'azurerm_network_interface_application_gateway_backend_address_pool_association'],
  deps: ['subnet'], kw: 'application gateway layer 7 http https reverse proxy waf ingress',
  azdoc: MS + 'application-gateway/overview',
  suggest: () => ['appgw_waf'],
  desc: 'A v2 layer-7 load balancer with autoscaling, in its own subnet. Selected VMs or the scale set are the backend.',
  use: 'Path-based routing and TLS termination in front of web servers, optionally with a WAF.',
  fields: [
    { k: 'sku', l: 'SKU', t: 'select', o: ['Standard_v2', 'WAF_v2'], d: 'WAF_v2' },
    { k: 'min', l: 'Autoscale minimum', t: 'number', d: 1 },
    { k: 'max', l: 'Autoscale maximum', t: 'number', d: 3 },
  ],
  assume: ['The listener is HTTP on port 80 to keep certificates out of the code. Add an HTTPS listener with a Key Vault certificate for production.'],
  gen(c, x) {
    x.v('appgw_min_capacity', 'number', 'Minimum Application Gateway instances', +c.min);
    x.v('appgw_max_capacity', 'number', 'Maximum Application Gateway instances', +c.max);
    x.local('appgw_names', hv({ gateway_ip: 'gateway-ipcfg', frontend_ip: 'frontend-public', frontend_port: 'port-80', backend_pool: 'pool-app', http_settings: 'settings-http', listener: 'listener-http', rule: 'rule-http', probe: 'probe-http' }));
    const waf = x.has('appgw_waf') && c.sku === 'WAF_v2';
    const parts = [
      R('resource "azurerm_public_ip" "appgw"', ['name = ' + x.n('pip', 'agw'), ...x.rgArgs('networking'), 'allocation_method = "Static"', 'sku = "Standard"', 'zones = ["1", "2", "3"]', '', x.tags]),
      R('resource "azurerm_application_gateway" "main"', [
        'name = ' + x.n('agw'), ...x.rgArgs('networking'), 'zones = ["1", "2", "3"]', waf ? 'firewall_policy_id = azurerm_web_application_firewall_policy.main.id' : null, '',
        B('sku', [`name = "${c.sku}"`, `tier = "${c.sku}"`]), '',
        B('autoscale_configuration', ['min_capacity = var.appgw_min_capacity', 'max_capacity = var.appgw_max_capacity']), '',
        B('gateway_ip_configuration', ['name = local.appgw_names.gateway_ip', 'subnet_id = ' + x.subnetId('appgw')]), '',
        B('frontend_ip_configuration', ['name = local.appgw_names.frontend_ip', 'public_ip_address_id = azurerm_public_ip.appgw.id']), '',
        B('frontend_port', ['name = local.appgw_names.frontend_port', 'port = 80']), '',
        B('backend_address_pool', ['name = local.appgw_names.backend_pool']), '',
        B('probe', ['name = local.appgw_names.probe', 'protocol = "Http"', 'path = "/"', 'interval = 30', 'timeout = 30', 'unhealthy_threshold = 3', 'pick_host_name_from_backend_http_settings = true']), '',
        B('backend_http_settings', ['name = local.appgw_names.http_settings', 'cookie_based_affinity = "Disabled"', 'port = 80', 'protocol = "Http"', 'request_timeout = 30', 'probe_name = local.appgw_names.probe', 'pick_host_name_from_backend_address = true']), '',
        B('http_listener', ['name = local.appgw_names.listener', 'frontend_ip_configuration_name = local.appgw_names.frontend_ip', 'frontend_port_name = local.appgw_names.frontend_port', 'protocol = "Http"']), '',
        B('request_routing_rule', ['name = local.appgw_names.rule', 'priority = 100', 'rule_type = "Basic"', 'http_listener_name = local.appgw_names.listener', 'backend_address_pool_name = local.appgw_names.backend_pool', 'backend_http_settings_name = local.appgw_names.http_settings']), '',
        x.tags,
      ]),
    ];
    if (c.sku === 'WAF_v2' && !x.has('appgw_waf')) x.note('WAF_v2 is selected without a WAF policy. Select "Application Gateway WAF Policy" to attach managed rules.');
    if (x.vm()) parts.push(R('resource "azurerm_network_interface_application_gateway_backend_address_pool_association" "vm"', ['for_each = azurerm_network_interface.vm', '', 'network_interface_id = each.value.id', 'ip_configuration_name = "internal"', 'backend_address_pool_id = one(azurerm_application_gateway.main.backend_address_pool[*].id)']));
    x.o('appgw_public_ip', 'azurerm_public_ip.appgw.ip_address', 'Public IP of the Application Gateway');
    return parts.join('\n\n');
  },
});

S({
  id: 'appgw_waf', name: 'Application Gateway WAF Policy', cat: 'networking', diff: 'Intermediate', file: 'appgw_waf',
  res: ['azurerm_web_application_firewall_policy'], deps: ['appgw'], kw: 'waf web application firewall owasp policy managed rules bot',
  azdoc: MS + 'web-application-firewall/ag/ag-overview',
  desc: 'A WAF policy with managed OWASP or Microsoft default rule sets and bot protection, attached to the Application Gateway.',
  use: 'Block SQL injection, XSS and known bad bots before they reach the app.',
  fields: [
    { k: 'mode', l: 'Mode', t: 'select', o: ['Detection', 'Prevention'], d: 'Prevention', h: 'Start in Detection to tune false positives, then switch to Prevention.' },
    { k: 'ruleset', l: 'Managed rule set', t: 'select', o: ['Microsoft_DefaultRuleSet 2.1', 'OWASP 3.2'], d: 'Microsoft_DefaultRuleSet 2.1' },
  ],
  gen(c, x) {
    const [type, ver] = c.ruleset.split(' ');
    x.o('waf_policy_id', 'azurerm_web_application_firewall_policy.main.id', 'ID of the WAF policy');
    x.v('waf_mode', 'string', 'Detection or Prevention', c.mode, { condition: 'contains(["Detection", "Prevention"], var.waf_mode)', error: 'waf_mode must be Detection or Prevention.' });
    return R('resource "azurerm_web_application_firewall_policy" "main"', ['name = ' + x.n('waf'), ...x.rgArgs('networking'), '',
      B('policy_settings', ['enabled = true', 'mode = var.waf_mode', 'request_body_check = true', 'max_request_body_size_in_kb = 128', 'file_upload_limit_in_mb = 100']), '',
      B('managed_rules', [B('managed_rule_set', [`type = "${type}"`, `version = "${ver}"`]), '', B('managed_rule_set', ['type = "Microsoft_BotManagerRuleSet"', 'version = "1.1"'])]), '', x.tags]);
  },
});

S({
  id: 'frontdoor', name: 'Azure Front Door', cat: 'networking', diff: 'Advanced', file: 'front_door',
  res: ['azurerm_cdn_frontdoor_profile', 'azurerm_cdn_frontdoor_endpoint', 'azurerm_cdn_frontdoor_origin_group', 'azurerm_cdn_frontdoor_origin', 'azurerm_cdn_frontdoor_route', 'azurerm_cdn_frontdoor_firewall_policy', 'azurerm_cdn_frontdoor_security_policy'],
  deps: ['resource_group'], kw: 'front door cdn global edge waf anycast routing',
  azdoc: MS + 'frontdoor/front-door-overview',
  desc: 'A global edge entry point: profile, endpoint, origin group, origin and route, with an optional edge WAF.',
  use: 'Serve a web app worldwide with TLS at the edge, caching and DDoS absorption.',
  fields: [
    { k: 'sku', l: 'Tier', t: 'select', o: ['Standard_AzureFrontDoor', 'Premium_AzureFrontDoor'], d: 'Premium_AzureFrontDoor', h: 'Premium adds managed WAF rules and Private Link origins.' },
    { k: 'waf', l: 'Edge WAF policy', t: 'bool', d: true },
    { k: 'origin', l: 'Origin host when no web app or App Gateway is selected', t: 'text', d: 'www.example.com' },
  ],
  assume: ['The origin is the selected Web App, else the Application Gateway public IP, else the host you enter.'],
  gen(c, x) {
    let host, https = true;
    if (x.has('web_app')) host = 'azurerm_linux_web_app.main.default_hostname';
    else if (x.has('function_app')) host = 'azurerm_function_app_flex_consumption.main.default_hostname';
    else if (x.has('appgw')) { host = 'azurerm_public_ip.appgw.ip_address'; https = false; }
    else host = x.v('frontdoor_origin_host', 'string', 'Host name of the origin Front Door forwards to', c.origin);
    const waf = c.waf;
    const parts = [
      R('resource "azurerm_cdn_frontdoor_profile" "main"', ['name = ' + x.n('afd'), 'resource_group_name = ' + x.rg('networking').name, `sku_name = "${c.sku}"`, 'response_timeout_seconds = 60', '', x.tags]),
      R('resource "azurerm_cdn_frontdoor_endpoint" "main"', ['name = ' + x.n('fde'), 'cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.main.id', '', x.tags]),
      R('resource "azurerm_cdn_frontdoor_origin_group" "main"', ['name = "origins"', 'cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.main.id', 'session_affinity_enabled = false', '',
        B('load_balancing', ['sample_size = 4', 'successful_samples_required = 3']), '',
        B('health_probe', [`protocol = "${https ? 'Https' : 'Http'}"`, 'path = "/"', 'request_type = "HEAD"', 'interval_in_seconds = 100'])]),
      R('resource "azurerm_cdn_frontdoor_origin" "main"', ['name = "primary"', 'cdn_frontdoor_origin_group_id = azurerm_cdn_frontdoor_origin_group.main.id', 'enabled = true', '', `host_name = ${host}`, `origin_host_header = ${host}`, 'http_port = 80', 'https_port = 443', 'priority = 1', 'weight = 1000', `certificate_name_check_enabled = ${https}`]),
      R('resource "azurerm_cdn_frontdoor_route" "main"', ['name = "default"', 'cdn_frontdoor_endpoint_id = azurerm_cdn_frontdoor_endpoint.main.id', 'cdn_frontdoor_origin_group_id = azurerm_cdn_frontdoor_origin_group.main.id', 'cdn_frontdoor_origin_ids = [azurerm_cdn_frontdoor_origin.main.id]', '', 'supported_protocols = ["Http", "Https"]', 'patterns_to_match = ["/*"]', `forwarding_protocol = "${https ? 'HttpsOnly' : 'HttpOnly'}"`, 'https_redirect_enabled = true', 'link_to_default_domain = true']),
    ];
    if (waf) {
      x.v('frontdoor_waf_mode', 'string', 'Detection or Prevention', 'Prevention', { condition: 'contains(["Detection", "Prevention"], var.frontdoor_waf_mode)', error: 'Use Detection or Prevention.' });
      const managed = c.sku === 'Premium_AzureFrontDoor';
      parts.push('# Front Door WAF policy names allow letters and digits only.',
        R('resource "azurerm_cdn_frontdoor_firewall_policy" "main"', ['name = "waf${replace(local.name_prefix, "-", "")}"', 'resource_group_name = ' + x.rg('networking').name, `sku_name = "${c.sku}"`, 'enabled = true', 'mode = var.frontdoor_waf_mode', '',
          managed ? B('managed_rule', ['type = "Microsoft_DefaultRuleSet"', 'version = "2.1"', 'action = "Block"']) : null, managed ? '' : null,
          managed ? B('managed_rule', ['type = "Microsoft_BotManagerRuleSet"', 'version = "1.1"', 'action = "Block"']) : '# Managed rule sets need the Premium tier; add custom_rule blocks for Standard.', '', x.tags]),
        R('resource "azurerm_cdn_frontdoor_security_policy" "main"', ['name = "waf"', 'cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.main.id', '',
          B('security_policies', [B('firewall', ['cdn_frontdoor_firewall_policy_id = azurerm_cdn_frontdoor_firewall_policy.main.id', '', B('association', ['patterns_to_match = ["/*"]', '', B('domain', ['cdn_frontdoor_domain_id = azurerm_cdn_frontdoor_endpoint.main.id'])])])])]));
    }
    x.o('frontdoor_endpoint_hostname', 'azurerm_cdn_frontdoor_endpoint.main.host_name', 'Front Door endpoint host name (*.azurefd.net)');
    return parts.join('\n\n');
  },
});

S({
  id: 'vpn_gw', name: 'VPN Gateway', cat: 'networking', diff: 'Advanced', file: 'vpn_gateway',
  res: ['azurerm_virtual_network_gateway', 'azurerm_public_ip', 'azurerm_local_network_gateway', 'azurerm_virtual_network_gateway_connection'],
  deps: ['subnet'], kw: 'vpn gateway site-to-site ipsec ike local network gateway hybrid on-premises',
  azdoc: MS + 'vpn-gateway/vpn-gateway-about-vpngateways',
  desc: 'A route-based, zone-redundant VPN gateway with a local network gateway and a site-to-site IPsec connection.',
  use: 'Connect an on-premises network or branch office over an encrypted tunnel.',
  fields: [
    { k: 'sku', l: 'Gateway SKU', t: 'select', o: ['VpnGw1AZ', 'VpnGw2AZ', 'VpnGw3AZ'], d: 'VpnGw1AZ' },
    { k: 'onprem_ip', l: 'On-premises VPN device public IP', t: 'text', d: '203.0.113.10' },
    { k: 'onprem_space', l: 'On-premises address space', t: 'list', d: '192.168.0.0/16' },
  ],
  assume: ['The IPsec shared key is a sensitive input variable with no default. Set TF_VAR_vpn_shared_key from a secret store.', 'Gateway creation takes 30-45 minutes.'],
  guide: ['Shared keys end up in Terraform state: keep state in an encrypted backend with restricted access.'],
  gen(c, x) {
    const h = x.hub();
    const gen = c.sku === 'VpnGw1AZ' ? 'Generation1' : 'Generation2';
    x.v('vpn_onprem_gateway_ip', 'string', 'Public IP of the on-premises VPN device', c.onprem_ip);
    x.v('vpn_onprem_address_space', 'list(string)', 'On-premises address prefixes reachable through the tunnel', csv(c.onprem_space));
    x.v('vpn_shared_key', 'string', 'IPsec pre-shared key. Supply via TF_VAR_vpn_shared_key; never commit it.', undefined, { condition: 'length(var.vpn_shared_key) >= 16', error: 'Use a pre-shared key of at least 16 characters.' }, { sensitive: true });
    const a = x.hubArgs();
    x.o('vpn_gateway_public_ip', 'azurerm_public_ip.vpngw.ip_address', 'Public IP of the VPN gateway (configure it on the on-premises device)');
    return [
      R('resource "azurerm_public_ip" "vpngw"', ['name = ' + x.n('pip', 'vpng'), ...a, 'allocation_method = "Static"', 'sku = "Standard"', 'zones = ["1", "2", "3"]', '', x.tags]),
      R('resource "azurerm_virtual_network_gateway" "main"', ['name = ' + x.n('vpng'), ...a, 'type = "Vpn"', 'vpn_type = "RouteBased"', `sku = "${c.sku}"`, `generation = "${gen}"`, 'active_active = false', 'bgp_enabled = false', '',
        B('ip_configuration', ['name = "vnetGatewayConfig"', 'public_ip_address_id = azurerm_public_ip.vpngw.id', 'private_ip_address_allocation = "Dynamic"', 'subnet_id = ' + x.specialSubnetId('GatewaySubnet')]), '', x.tags]),
      R('resource "azurerm_local_network_gateway" "onprem"', ['name = ' + x.n('lgw', 'onprem'), ...a, 'gateway_address = var.vpn_onprem_gateway_ip', 'address_space = var.vpn_onprem_address_space', '', x.tags]),
      R('resource "azurerm_virtual_network_gateway_connection" "onprem"', ['name = ' + x.n('vcn', 'onprem'), ...a, 'type = "IPsec"', 'virtual_network_gateway_id = azurerm_virtual_network_gateway.main.id', 'local_network_gateway_id = azurerm_local_network_gateway.onprem.id', 'shared_key = var.vpn_shared_key', 'connection_protocol = "IKEv2"', '', x.tags]),
    ].join('\n\n');
  },
});

S({
  id: 'expressroute', name: 'ExpressRoute Circuit', cat: 'networking', diff: 'Advanced', file: 'expressroute',
  res: ['azurerm_express_route_circuit'], deps: ['resource_group'], kw: 'expressroute private connection hybrid circuit peering provider',
  azdoc: MS + 'expressroute/expressroute-introduction',
  desc: 'A private, provider-delivered circuit to Microsoft. Peerings and a gateway connection follow once the provider provisions it.',
  use: 'Predictable, private bandwidth from a data centre to Azure that does not cross the internet.',
  fields: [
    { k: 'provider', l: 'Service provider', t: 'text', d: 'Equinix' },
    { k: 'location', l: 'Peering location', t: 'text', d: 'Singapore' },
    { k: 'bandwidth', l: 'Bandwidth (Mbps)', t: 'select', o: ['50', '100', '200', '500', '1000', '2000'], d: '50' },
    { k: 'tier', l: 'SKU tier', t: 'select', o: ['Standard', 'Premium', 'Local'], d: 'Standard' },
  ],
  assume: ['Peerings (azurerm_express_route_circuit_peering) and the ExpressRoute gateway connection are added after the provider provisions the circuit.'],
  gen(c, x) {
    x.v('er_service_provider', 'string', 'ExpressRoute connectivity provider name as listed by Azure', c.provider);
    x.v('er_peering_location', 'string', 'ExpressRoute peering location', c.location);
    x.v('er_bandwidth_mbps', 'number', 'Circuit bandwidth in Mbps', +c.bandwidth);
    x.o('er_service_key', 'azurerm_express_route_circuit.main.service_key', 'Service key to give the connectivity provider', true);
    return R('resource "azurerm_express_route_circuit" "main"', ['name = ' + x.n('erc'), ...x.hubArgs(), 'service_provider_name = var.er_service_provider', 'peering_location = var.er_peering_location', 'bandwidth_in_mbps = var.er_bandwidth_mbps', 'allow_classic_operations = false', '',
      B('sku', [`tier = "${c.tier}"`, 'family = "MeteredData"']), '', x.tags]);
  },
});

S({
  id: 'vwan', name: 'Virtual WAN', cat: 'networking', diff: 'Advanced', file: 'virtual_wan',
  res: ['azurerm_virtual_wan', 'azurerm_virtual_hub', 'azurerm_virtual_hub_connection'],
  deps: ['vnet'], kw: 'virtual wan vwan hub transit branch global',
  azdoc: MS + 'virtual-wan/virtual-wan-about',
  desc: 'A Microsoft-managed hub: Virtual WAN, a Standard virtual hub and a connection to the spoke VNet.',
  use: 'Global transit between many VNets, branches and users without building your own hub VNet.',
  fields: [{ k: 'prefix', l: 'Hub address prefix (/23 or larger)', t: 'text', d: '10.200.0.0/23' }],
  gen(c, x) {
    x.v('vhub_address_prefix', 'string', 'Address prefix of the virtual hub', c.prefix);
    x.o('virtual_hub_id', 'azurerm_virtual_hub.main.id', 'ID of the virtual hub');
    const a = x.hubArgs();
    return [
      R('resource "azurerm_virtual_wan" "main"', ['name = ' + x.n('vwan'), ...a, 'type = "Standard"', 'allow_branch_to_branch_traffic = true', '', x.tags]),
      R('resource "azurerm_virtual_hub" "main"', ['name = ' + x.n('vhub'), ...a, 'virtual_wan_id = azurerm_virtual_wan.main.id', 'address_prefix = var.vhub_address_prefix', 'sku = "Standard"', '', x.tags]),
      R('resource "azurerm_virtual_hub_connection" "spoke"', [x.hub().prov, 'name = "conn-spoke"', 'virtual_hub_id = azurerm_virtual_hub.main.id', 'remote_virtual_network_id = ' + x.vnetId(), 'internet_security_enabled = false']),
    ].join('\n\n');
  },
});

S({
  id: 'hub_spoke', name: 'Hub-and-Spoke Network', cat: 'networking', diff: 'Advanced', file: 'hub_spoke',
  res: ['azurerm_virtual_network_peering', 'azurerm_virtual_network', 'azurerm_subnet', 'azurerm_resource_group'],
  deps: ['vnet'], kw: 'hub spoke peering topology shared services connectivity landing zone',
  azdoc: MS + 'architecture/networking/architecture/hub-spoke',
  desc: 'A hub VNet for shared services (firewall, Bastion, VPN gateway) peered both ways with the workload VNet and extra spokes.',
  use: 'Centralise inspection and hybrid connectivity once, and let every application VNet use it.',
  suggest: () => ['firewall', 'bastion', 'route_table', 'private_dns'],
  fields: [
    { k: 'hub_space', l: 'Hub address space', t: 'text', d: '10.100.0.0/16' },
    { k: 'shared', l: 'Hub shared-services subnet', t: 'text', d: '10.100.10.0/24' },
    { k: 'firewall', l: 'Hub AzureFirewallSubnet', t: 'text', d: '10.100.1.0/26', when: (c, has) => has('firewall') },
    { k: 'bastion', l: 'Hub AzureBastionSubnet', t: 'text', d: '10.100.2.0/26', when: (c, has) => has('bastion') },
    { k: 'gateway', l: 'Hub GatewaySubnet', t: 'text', d: '10.100.3.0/27', when: (c, has) => has('vpn_gw') },
    { k: 'spokes', l: 'Additional spokes (name=CIDR)', t: 'list', d: 'nonprod=10.2.0.0/16, shared=10.3.0.0/16', h: 'The selected Virtual Network is the first spoke.' },
  ],
  assume: ['In multi-subscription mode the hub is created in the connectivity subscription through the azurerm.connectivity provider alias.', 'Peering is non-transitive: spoke-to-spoke traffic needs the firewall (or another NVA) in the hub plus route tables.'],
  gen(c, x) {
    const h = x.hub();
    const subnets = { shared: [c.shared] };
    if (x.has('firewall')) subnets.AzureFirewallSubnet = [c.firewall];
    if (x.has('bastion')) subnets.AzureBastionSubnet = [c.bastion];
    if (x.has('vpn_gw')) subnets.GatewaySubnet = [c.gateway];
    x.v('hub_address_space', 'list(string)', 'Address space of the hub VNet', [c.hub_space]);
    x.v('hub_subnets', 'map(list(string))', 'Hub subnets: name => address prefixes', subnets);
    x.v('additional_spokes', 'map(string)', 'Extra spoke VNets: name => address space', kvList(c.spokes));
    const gw = x.has('vpn_gw');
    const prov = h.prov;
    const parts = [];
    if (x.multi()) parts.push('# Connectivity subscription: the hub has its own resource group.', R('resource "azurerm_resource_group" "connectivity"', [prov, '', 'name = "rg-${local.name_prefix}-connectivity"', 'location = var.location', '', x.tags]));
    parts.push(
      R('resource "azurerm_virtual_network" "hub"', [prov, prov ? '' : null, 'name = ' + x.n('vnet', 'hub'), 'resource_group_name = ' + h.name, 'location = ' + h.loc, 'address_space = var.hub_address_space', x.has('ddos') ? '' : null, x.has('ddos') ? B('ddos_protection_plan', ['id = azurerm_network_ddos_protection_plan.main.id', 'enable = true']) : null, '', x.tags]),
      R('resource "azurerm_subnet" "hub"', [prov, 'for_each = var.hub_subnets', '', 'name = each.key == "shared" ? "snet-shared" : each.key', 'resource_group_name = ' + h.name, 'virtual_network_name = azurerm_virtual_network.hub.name', 'address_prefixes = each.value']),
      '# Peering is configured on both sides. The hub offers its gateway; the spoke uses it.',
      R('resource "azurerm_virtual_network_peering" "hub_to_spoke"', [prov, prov ? '' : null, 'name = "peer-hub-to-spoke"', 'resource_group_name = ' + h.name, 'virtual_network_name = azurerm_virtual_network.hub.name', 'remote_virtual_network_id = ' + x.vnetId(), 'allow_virtual_network_access = true', 'allow_forwarded_traffic = true', `allow_gateway_transit = ${gw}`]),
      R('resource "azurerm_virtual_network_peering" "spoke_to_hub"', ['name = "peer-spoke-to-hub"', 'resource_group_name = ' + x.rg('networking').name, 'virtual_network_name = ' + x.vnetName(), 'remote_virtual_network_id = azurerm_virtual_network.hub.id', 'allow_virtual_network_access = true', 'allow_forwarded_traffic = true', `use_remote_gateways = ${gw}`,
        gw ? '' : null, gw ? '# use_remote_gateways fails until the hub gateway exists, and nothing references it: an explicit depends_on is the right tool here.' : null, gw ? 'depends_on = [azurerm_virtual_network_gateway.main, azurerm_virtual_network_peering.hub_to_spoke]' : null]),
      R('resource "azurerm_virtual_network" "spoke"', ['for_each = var.additional_spokes', '', 'name = "vnet-${local.name_prefix}-${each.key}"', ...x.rgArgs('networking'), 'address_space = [each.value]', '', 'tags = merge(local.common_tags, { Spoke = each.key })']),
      R('resource "azurerm_virtual_network_peering" "hub_to_spokes"', [prov, 'for_each = azurerm_virtual_network.spoke', '', 'name = "peer-hub-to-${each.key}"', 'resource_group_name = ' + h.name, 'virtual_network_name = azurerm_virtual_network.hub.name', 'remote_virtual_network_id = each.value.id', 'allow_forwarded_traffic = true', `allow_gateway_transit = ${gw}`]),
      R('resource "azurerm_virtual_network_peering" "spokes_to_hub"', ['for_each = azurerm_virtual_network.spoke', '', 'name = "peer-${each.key}-to-hub"', 'resource_group_name = each.value.resource_group_name', 'virtual_network_name = each.value.name', 'remote_virtual_network_id = azurerm_virtual_network.hub.id', 'allow_forwarded_traffic = true', `use_remote_gateways = ${gw}`, gw ? 'depends_on = [azurerm_virtual_network_gateway.main, azurerm_virtual_network_peering.hub_to_spokes]' : null]),
    );
    x.o('hub_vnet_id', 'azurerm_virtual_network.hub.id', 'ID of the hub VNet');
    x.o('spoke_vnet_ids', '{ for k, v in azurerm_virtual_network.spoke : k => v.id }', 'IDs of the additional spoke VNets');
    return parts.join('\n\n');
  },
});

S({
  id: 'private_dns', name: 'Private DNS Zone', cat: 'networking', diff: 'Intermediate', file: 'private_dns',
  res: ['azurerm_private_dns_zone', 'azurerm_private_dns_zone_virtual_network_link'],
  deps: ['vnet'], kw: 'private dns zone privatelink resolution vnet link',
  azdoc: MS + 'dns/private-dns-overview',
  desc: 'The privatelink.* zones your private endpoints and private databases need, linked to the VNet (and hub).',
  use: 'Make mystorage.blob.core.windows.net resolve to a private IP from inside the VNet.',
  assume: ['Zones are derived from the selected services; the zone names come from Microsoft\'s private endpoint DNS table.', 'With nothing that needs a zone selected, a privatelink.blob.core.windows.net zone is created as a starting point.'],
  gen(c, x) {
    let z = dnsZonesFor(x);
    if (!Object.keys(z).length) z = { blob: '"privatelink.blob.core.windows.net"' };
    x.local('private_dns_zones', '{\n' + Object.entries(z).map(([k, v]) => `  ${k} = ${v}`).join('\n') + '\n}');
    x.o('private_dns_zone_ids', '{ for k, z in azurerm_private_dns_zone.this : k => z.id }', 'Private DNS zone IDs keyed by service');
    const parts = [
      R('resource "azurerm_private_dns_zone" "this"', ['for_each = local.private_dns_zones', '', 'name = each.value', 'resource_group_name = ' + x.rg('networking').name, '', x.tags]),
      R('resource "azurerm_private_dns_zone_virtual_network_link" "spoke"', ['for_each = azurerm_private_dns_zone.this', '', 'name = "link-${each.key}-spoke"', 'private_dns_zone_id = each.value.id', 'virtual_network_id = ' + x.vnetId(), 'registration_enabled = false', '', x.tags]),
    ];
    if (x.has('hub_spoke')) parts.push(R('resource "azurerm_private_dns_zone_virtual_network_link" "hub"', ['for_each = azurerm_private_dns_zone.this', '', 'name = "link-${each.key}-hub"', 'private_dns_zone_id = each.value.id', 'virtual_network_id = azurerm_virtual_network.hub.id', 'registration_enabled = false', '', x.tags]));
    return parts.join('\n\n');
  },
});

S({
  id: 'private_endpoint', name: 'Private Endpoint', cat: 'networking', diff: 'Intermediate', file: 'private_endpoint',
  res: ['azurerm_private_endpoint'], deps: ['subnet', 'private_dns'], kw: 'private endpoint private link paas no public access',
  azdoc: MS + 'private-link/private-endpoint-overview',
  desc: 'A private IP in the endpoints subnet for each selected PaaS service, registered in its private DNS zone.',
  use: 'Reach Storage, SQL, Cosmos DB and others over the VNet only, with public network access turned off.',
  assume: ['Services with a private endpoint set public network access to disabled.', 'One endpoint per service and sub-resource (blob, file, sqlServer, Sql, registry, sites).'],
  gen(c, x) {
    const t = peTargets(x.has, x);
    if (!t.length) { x.note('No supported PaaS service is selected, so no private endpoint was generated.'); return '# No supported PaaS service is selected yet: choose Storage, SQL, Cosmos DB, Container Registry, Managed Redis, Web App or Function App.\n'; }
    const seen = new Set();
    return t.map(([key, sub, zone, , target, svc]) => {
      const zoneId = x.dnsZoneId(zone, sub);
      seen.add(key);
      x.o(`pe_${key}_ip`, `azurerm_private_endpoint.${key}.private_service_connection[0].private_ip_address`, `Private IP of the ${SVC[svc].name} endpoint`);
      return R(`resource "azurerm_private_endpoint" "${key}"`, ['name = ' + x.n('pep', key.replace(/_/g, '-')), ...x.rgArgs('networking'), 'subnet_id = ' + x.subnetId('endpoints'), 'custom_network_interface_name = ' + x.n('nic-pep', key.replace(/_/g, '-')), '',
        B('private_service_connection', [`name = "psc-${key.replace(/_/g, '-')}"`, `private_connection_resource_id = ${target}`, `subresource_names = ["${sub}"]`, 'is_manual_connection = false']), '',
        B('private_dns_zone_group', ['name = "default"', `private_dns_zone_ids = [${zoneId}]`]), '', x.tags]);
    }).join('\n\n');
  },
});

S({
  id: 'firewall', name: 'Azure Firewall', cat: 'networking', diff: 'Advanced', file: 'firewall',
  res: ['azurerm_firewall', 'azurerm_firewall_policy', 'azurerm_firewall_policy_rule_collection_group', 'azurerm_public_ip'],
  deps: ['subnet'], kw: 'firewall policy egress inspection fqdn threat intelligence hub nva',
  azdoc: MS + 'firewall/overview',
  suggest: () => ['route_table'],
  desc: 'A zone-redundant Azure Firewall with a firewall policy: DNS proxy, a DNS network rule and an FQDN allow-list.',
  use: 'Inspect and allow-list all outbound traffic from spokes in one place.',
  fields: [
    { k: 'tier', l: 'SKU tier', t: 'select', o: ['Standard', 'Premium'], d: 'Standard', h: 'Premium adds TLS inspection and IDPS.' },
    { k: 'fqdns', l: 'Allowed outbound FQDNs', t: 'list', d: '*.ubuntu.com, packages.microsoft.com, *.azure.com, mcr.microsoft.com' },
    { k: 'threat', l: 'Threat intelligence mode', t: 'select', o: ['Alert', 'Deny', 'Off'], d: 'Alert' },
  ],
  gen(c, x) {
    x.v('firewall_allowed_fqdns', 'list(string)', 'FQDNs workloads may reach over HTTP/HTTPS', csv(c.fqdns));
    const src = x.has('hub_spoke') ? 'concat(var.vnet_address_space, values(var.additional_spokes))' : x.vnetSpace();
    if (x.has('hub_spoke') && !x.has('vnet')) x.vnetSpace();
    const a = x.hubArgs();
    x.o('firewall_private_ip', 'azurerm_firewall.main.ip_configuration[0].private_ip_address', 'Private IP of Azure Firewall (next hop for route tables)');
    return [
      R('resource "azurerm_public_ip" "firewall"', ['name = ' + x.n('pip', 'afw'), ...a, 'allocation_method = "Static"', 'sku = "Standard"', 'zones = ["1", "2", "3"]', '', x.tags]),
      R('resource "azurerm_firewall_policy" "main"', ['name = ' + x.n('afwp'), ...a, `sku = "${c.tier}"`, `threat_intelligence_mode = "${c.threat}"`, '', B('dns', ['proxy_enabled = true']), '', x.tags]),
      R('resource "azurerm_firewall_policy_rule_collection_group" "main"', [x.hub().prov, 'name = "rcg-default"', 'firewall_policy_id = azurerm_firewall_policy.main.id', 'priority = 200', '',
        B('network_rule_collection', ['name = "allow-dns"', 'priority = 100', 'action = "Allow"', '', B('rule', ['name = "dns"', 'protocols = ["UDP", "TCP"]', `source_addresses = ${src}`, 'destination_addresses = ["*"]', 'destination_ports = ["53"]'])]), '',
        B('application_rule_collection', ['name = "allow-web"', 'priority = 200', 'action = "Allow"', '', B('rule', ['name = "allowed-fqdns"', `source_addresses = ${src}`, 'destination_fqdns = var.firewall_allowed_fqdns', '', B('protocols', ['type = "Https"', 'port = 443']), '', B('protocols', ['type = "Http"', 'port = 80'])])])]),
      R('resource "azurerm_firewall" "main"', ['name = ' + x.n('afw'), ...a, 'sku_name = "AZFW_VNet"', `sku_tier = "${c.tier}"`, 'firewall_policy_id = azurerm_firewall_policy.main.id', 'zones = ["1", "2", "3"]', '',
        B('ip_configuration', ['name = "ipconfig"', 'subnet_id = ' + x.specialSubnetId('AzureFirewallSubnet'), 'public_ip_address_id = azurerm_public_ip.firewall.id']), '', x.tags]),
    ].join('\n\n');
  },
});

S({
  id: 'ddos', name: 'DDoS Protection Plan', cat: 'networking', diff: 'Advanced', file: 'ddos',
  res: ['azurerm_network_ddos_protection_plan'], deps: ['vnet'], kw: 'ddos protection network attack mitigation',
  azdoc: MS + 'ddos-protection/ddos-protection-overview',
  desc: 'Azure DDoS Network Protection plan, enabled on the VNet (and hub).',
  use: 'Adaptive tuning, attack telemetry and cost protection for public IPs in the protected VNets.',
  assume: ['One plan can protect VNets across subscriptions in the tenant; share it rather than creating one per project.'],
  gen(c, x) {
    x.o('ddos_plan_id', 'azurerm_network_ddos_protection_plan.main.id', 'ID of the DDoS protection plan');
    return R('resource "azurerm_network_ddos_protection_plan" "main"', ['name = ' + x.n('ddos'), ...x.hubArgs(), '', x.tags]);
  },
});

S({
  id: 'bastion', name: 'Azure Bastion', cat: 'networking', diff: 'Intermediate', file: 'bastion',
  res: ['azurerm_bastion_host', 'azurerm_public_ip'], deps: ['subnet'], kw: 'bastion ssh rdp jump host secure access browser',
  azdoc: MS + 'bastion/bastion-overview',
  desc: 'Managed RDP and SSH to VMs over TLS, with no public IPs on the VMs.',
  use: 'Replace jump boxes and open management ports.',
  fields: [{ k: 'sku', l: 'SKU', t: 'select', o: ['Basic', 'Standard'], d: 'Standard', h: 'Standard adds native client tunnelling, scaling and shareable links.' }],
  gen(c, x) {
    const a = x.hubArgs();
    const std = c.sku === 'Standard';
    x.o('bastion_dns_name', 'azurerm_bastion_host.main.dns_name', 'DNS name of the Bastion host');
    return [
      R('resource "azurerm_public_ip" "bastion"', ['name = ' + x.n('pip', 'bas'), ...a, 'allocation_method = "Static"', 'sku = "Standard"', '', x.tags]),
      R('resource "azurerm_bastion_host" "main"', ['name = ' + x.n('bas'), ...a, `sku = "${c.sku}"`, std ? 'tunneling_enabled = true' : null, std ? 'copy_paste_enabled = true' : null, '',
        B('ip_configuration', ['name = "configuration"', 'subnet_id = ' + x.specialSubnetId('AzureBastionSubnet'), 'public_ip_address_id = azurerm_public_ip.bastion.id']), '', x.tags]),
    ].join('\n\n');
  },
});
