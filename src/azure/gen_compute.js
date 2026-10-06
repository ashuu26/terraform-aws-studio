/* ==========================================================================
   gen_compute.js — Compute generator: virtual machines, scale sets,
   managed disks, managed identity, AKS, container registry, container
   instances, container apps, App Service and Azure Functions.
   ========================================================================== */

const VM_IMAGES = {
  'Ubuntu 24.04 LTS': ['Canonical', 'ubuntu-24_04-lts', 'server'],
  'Ubuntu 22.04 LTS': ['Canonical', '0001-com-ubuntu-server-jammy', '22_04-lts-gen2'],
  'Windows Server 2022 Azure Edition': ['MicrosoftWindowsServer', 'WindowsServer', '2022-datacenter-azure-edition'],
  'Windows Server 2025 Azure Edition': ['MicrosoftWindowsServer', 'WindowsServer', '2025-datacenter-azure-edition'],
};
const imageBlock = name => { const [p, o, s] = VM_IMAGES[name]; return B('source_image_reference', [`publisher = "${p}"`, `offer = "${o}"`, `sku = "${s}"`, 'version = "latest"']); };
const sshVars = x => {
  x.v('admin_username', 'string', 'Administrator user name for VMs and scale sets', 'azureuser', { condition: '!contains(["admin", "administrator", "root", "azureadmin"], lower(var.admin_username))', error: 'That user name is reserved by Azure.' });
  x.v('admin_ssh_public_key', 'string', 'SSH public key (contents of ~/.ssh/id_ed25519.pub or id_rsa.pub). Public keys are not secrets; no private key is ever generated.', undefined, { condition: 'can(regex("^(ssh-rsa|ssh-ed25519|ecdsa-sha2-nistp256) ", var.admin_ssh_public_key))', error: 'Provide an OpenSSH public key.' });
};
const winVars = x => {
  x.v('admin_username', 'string', 'Administrator user name for VMs and scale sets', 'azureuser', { condition: '!contains(["admin", "administrator", "root", "azureadmin"], lower(var.admin_username))', error: 'That user name is reserved by Azure.' });
  x.v('admin_password', 'string', 'Windows administrator password. Supply via TF_VAR_admin_password from a secret store; it is never written in code.', undefined, { condition: 'length(var.admin_password) >= 12', error: 'Use at least 12 characters.' }, { sensitive: true });
};

S({
  id: 'vm', name: 'Virtual Machines', cat: 'compute', diff: 'Beginner', file: 'vm',
  res: ['azurerm_linux_virtual_machine', 'azurerm_windows_virtual_machine', 'azurerm_network_interface', 'azurerm_availability_set'],
  deps: ['subnet', 'nsg'], kw: 'vm virtual machine linux windows ubuntu server nic network interface compute iaas trusted launch',
  azdoc: MS + 'virtual-machines/overview',
  suggest: () => ['identity', 'managed_disk', 'vm_backup', 'dcr'],
  desc: 'Linux or Windows VMs with Trusted Launch, a NIC each in the app subnet, managed boot diagnostics and a managed identity.',
  use: 'Lift-and-shift servers, or anything that needs full OS control.',
  fields: [
    { k: 'os', l: 'Operating system', t: 'select', o: ['Linux', 'Windows'], d: 'Linux', presets: { Linux: { image: 'Ubuntu 24.04 LTS' }, Windows: { image: 'Windows Server 2022 Azure Edition' } } },
    { k: 'image', l: 'Image', t: 'select', o: Object.keys(VM_IMAGES), d: 'Ubuntu 24.04 LTS' },
    { k: 'count', l: 'Number of VMs', t: 'number', d: 2 },
    { k: 'name', l: 'VM name prefix', t: 'text', d: 'web', h: 'VMs are named <prefix>-01, <prefix>-02 ... Windows computer names are limited to 15 characters.' },
    { k: 'size', l: 'VM size', t: 'select', o: ['Standard_B2s', 'Standard_B2ms', 'Standard_D2s_v5', 'Standard_D4s_v5', 'Standard_E2s_v5'], d: 'Standard_B2s' },
    { k: 'availability', l: 'Availability', t: 'select', o: ['Availability zones', 'Availability set', 'None'], d: 'Availability zones', h: 'Zones spread VMs across data centres in the region.' },
    { k: 'disk_type', l: 'OS disk type', t: 'select', o: ['Premium_LRS', 'StandardSSD_LRS', 'Premium_ZRS', 'Standard_LRS'], d: 'Premium_LRS' },
    { k: 'disk_size', l: 'OS disk size (GB)', t: 'number', d: 64 },
    { k: 'host_encryption', l: 'Encryption at host', t: 'bool', d: false, h: 'Needs the EncryptionAtHost feature registered on the subscription.' },
  ],
  assume: ['Linux VMs use SSH keys only (password authentication disabled). Windows passwords come from a sensitive variable.', 'Trusted Launch (Secure Boot and vTPM) needs a Generation 2 image; all listed images are Gen2.', 'Patching is AutomaticByPlatform.'],
  guide: ['Reach VMs through Azure Bastion rather than public IPs.', 'Use a managed identity to call Azure APIs from the VM instead of stored credentials.'],
  gen(c, x) {
    const win = c.os === 'Windows';
    win ? winVars(x) : sshVars(x);
    const n = Math.max(1, Math.min(10, +c.count || 1));
    const vms = {};
    for (let i = 1; i <= n; i++) vms[`${c.name}-${String(i).padStart(2, '0')}`] = { zone: c.availability === 'Availability zones' ? String(((i - 1) % 3) + 1) : null };
    x.v('vms', 'map(object({\n  zone = optional(string)\n}))', 'Virtual machines keyed by short name; zone spreads them across availability zones', vms, win ? { condition: 'alltrue([for k in keys(var.vms) : length(k) <= 15])', error: 'Windows computer names are limited to 15 characters.' } : undefined);
    x.v('vm_size', 'string', 'VM size', c.size);
    x.v('vm_os_disk_type', 'string', 'Storage type of the OS disk', c.disk_type);
    x.v('vm_os_disk_size_gb', 'number', 'OS disk size in GB', +c.disk_size);
    const as = c.availability === 'Availability set';
    const res = win ? 'azurerm_windows_virtual_machine' : 'azurerm_linux_virtual_machine';
    const parts = [];
    if (as) parts.push(R('resource "azurerm_availability_set" "main"', ['name = ' + x.n('avail'), ...x.rgArgs('compute'), 'platform_fault_domain_count = 2', 'platform_update_domain_count = 5', 'managed = true', '', x.tags]));
    parts.push(R('resource "azurerm_network_interface" "vm"', ['for_each = var.vms', '', 'name = "nic-${local.name_prefix}-${each.key}"', ...x.rgArgs('compute'), '',
      B('ip_configuration', ['name = "internal"', 'subnet_id = ' + x.subnetId('app'), 'private_ip_address_allocation = "Dynamic"', x.has('public_ip') ? 'public_ip_address_id = azurerm_public_ip.vm[each.key].id' : null]), '', x.tags]));
    const ident = x.identityBlock();
    parts.push(R(`resource "${res}" "main"`, [
      'for_each = var.vms', '', 'name = "vm-${local.name_prefix}-${each.key}"', win ? 'computer_name = each.key' : null, ...x.rgArgs('compute'), 'size = var.vm_size',
      as ? 'availability_set_id = azurerm_availability_set.main.id' : 'zone = each.value.zone', 'network_interface_ids = [azurerm_network_interface.vm[each.key].id]', '',
      'admin_username = var.admin_username', win ? 'admin_password = var.admin_password' : 'disable_password_authentication = true',
      win ? null : '', win ? null : B('admin_ssh_key', ['username = var.admin_username', 'public_key = var.admin_ssh_public_key']), '',
      '# Trusted Launch: Secure Boot and a virtual TPM.', 'secure_boot_enabled = true', 'vtpm_enabled = true', c.host_encryption ? 'encryption_at_host_enabled = true' : null,
      'patch_mode = "AutomaticByPlatform"', 'patch_assessment_mode = "AutomaticByPlatform"', win ? 'hotpatching_enabled = false' : null, '',
      B('os_disk', ['caching = "ReadWrite"', 'storage_account_type = var.vm_os_disk_type', 'disk_size_gb = var.vm_os_disk_size_gb']), '',
      imageBlock(c.image), '',
      '# Managed boot diagnostics: no storage account needed.', B('boot_diagnostics', []), '',
      ident, '', x.tags,
    ]));
    x.o('vm_ids', `{ for k, vm in ${res}.main : k => vm.id }`, 'IDs of the virtual machines');
    x.o('vm_private_ips', '{ for k, nic in azurerm_network_interface.vm : k => nic.private_ip_address }', 'Private IP of each VM');
    if (!x.uai()) x.o('vm_principal_ids', `{ for k, vm in ${res}.main : k => vm.identity[0].principal_id }`, 'System-assigned identity principal ID of each VM');
    return parts.join('\n\n');
  },
});

S({
  id: 'managed_disk', name: 'Managed Disks', cat: 'compute', diff: 'Beginner', file: 'managed_disk',
  res: ['azurerm_managed_disk', 'azurerm_virtual_machine_data_disk_attachment'], deps: ['vm'], kw: 'disk managed disk data disk premium ssd attach lun',
  azdoc: MS + 'virtual-machines/managed-disks-overview',
  desc: 'An empty data disk per VM, created in the VM\'s zone and attached at LUN 10.',
  use: 'Keep application data off the OS disk so it survives VM rebuilds.',
  fields: [
    { k: 'size', l: 'Size (GB)', t: 'number', d: 128 },
    { k: 'type', l: 'Storage type', t: 'select', o: ['Premium_LRS', 'PremiumV2_LRS', 'StandardSSD_LRS', 'Premium_ZRS', 'Standard_LRS'], d: 'Premium_LRS' },
  ],
  assume: ['The disk is attached but not formatted or mounted. Do that with cloud-init or a configuration tool.'],
  gen(c, x) {
    x.v('data_disk_size_gb', 'number', 'Size of each data disk in GB', +c.size);
    x.v('data_disk_type', 'string', 'Storage type of the data disks', c.type);
    const vm = x.vm();
    if (!vm) {
      x.o('data_disk_id', 'azurerm_managed_disk.data.id', 'ID of the data disk');
      return R('resource "azurerm_managed_disk" "data"', ['name = ' + x.n('disk', 'data'), ...x.rgArgs('compute'), 'storage_account_type = var.data_disk_type', 'create_option = "Empty"', 'disk_size_gb = var.data_disk_size_gb', '', x.tags]);
    }
    x.o('data_disk_ids', '{ for k, d in azurerm_managed_disk.data : k => d.id }', 'ID of each data disk');
    return [
      R('resource "azurerm_managed_disk" "data"', ['for_each = var.vms', '', 'name = "disk-${local.name_prefix}-${each.key}-data"', ...x.rgArgs('compute'), 'storage_account_type = var.data_disk_type', 'create_option = "Empty"', 'disk_size_gb = var.data_disk_size_gb', '# A disk must be in the same zone as the VM it attaches to.', 'zone = each.value.zone', '', x.tags]),
      R('resource "azurerm_virtual_machine_data_disk_attachment" "data"', ['for_each = azurerm_managed_disk.data', '', 'managed_disk_id = each.value.id', `virtual_machine_id = ${vm.res}[each.key].id`, 'lun = 10', 'caching = "ReadOnly"']),
    ].join('\n\n');
  },
});

S({
  id: 'identity', name: 'Managed Identity', cat: 'compute', diff: 'Beginner', file: 'identity',
  res: ['azurerm_user_assigned_identity'], deps: ['resource_group'], kw: 'managed identity user assigned msi entra workload credentials',
  azdoc: 'https://learn.microsoft.com/entra/identity/managed-identities-azure-resources/overview',
  desc: 'A user-assigned managed identity shared by VMs, AKS, apps and containers, so nothing stores credentials.',
  use: 'Let workloads call Key Vault, Storage or SQL with Entra tokens instead of keys.',
  guide: ['Grant the identity the narrowest role at the narrowest scope that works.'],
  gen(c, x) {
    x.o('identity_id', 'azurerm_user_assigned_identity.main.id', 'Resource ID of the managed identity');
    x.o('identity_principal_id', 'azurerm_user_assigned_identity.main.principal_id', 'Principal (object) ID, used in role assignments');
    x.o('identity_client_id', 'azurerm_user_assigned_identity.main.client_id', 'Client ID, used by SDKs to request tokens');
    return R('resource "azurerm_user_assigned_identity" "main"', ['name = ' + x.n('id'), ...x.rgArgs('compute'), '', x.tags]);
  },
});

S({
  id: 'vmss', name: 'Virtual Machine Scale Set', cat: 'compute', diff: 'Intermediate', file: 'vmss',
  res: ['azurerm_linux_virtual_machine_scale_set', 'azurerm_windows_virtual_machine_scale_set', 'azurerm_monitor_autoscale_setting'],
  deps: ['subnet'], kw: 'vmss scale set autoscale uniform instances horizontal',
  azdoc: MS + 'virtual-machine-scale-sets/overview',
  suggest: (c, has) => has('appgw') ? [] : ['lb'],
  desc: 'A zone-spread scale set behind the load balancer or Application Gateway, with CPU-based autoscale.',
  use: 'Stateless web or worker tiers that scale out and in with demand.',
  fields: [
    { k: 'os', l: 'Operating system', t: 'select', o: ['Linux', 'Windows'], d: 'Linux', presets: { Linux: { image: 'Ubuntu 24.04 LTS' }, Windows: { image: 'Windows Server 2022 Azure Edition' } } },
    { k: 'image', l: 'Image', t: 'select', o: Object.keys(VM_IMAGES), d: 'Ubuntu 24.04 LTS' },
    { k: 'sku', l: 'Instance size', t: 'select', o: ['Standard_B2s', 'Standard_D2s_v5', 'Standard_D4s_v5'], d: 'Standard_D2s_v5' },
    { k: 'instances', l: 'Initial instances', t: 'number', d: 2 },
    { k: 'autoscale', l: 'CPU autoscale', t: 'bool', d: true },
    { k: 'min', l: 'Minimum instances', t: 'number', d: 2, when: c => c.autoscale },
    { k: 'max', l: 'Maximum instances', t: 'number', d: 6, when: c => c.autoscale },
  ],
  gen(c, x) {
    const win = c.os === 'Windows';
    win ? winVars(x) : sshVars(x);
    x.v('vmss_sku', 'string', 'Scale set instance size', c.sku);
    x.v('vmss_instances', 'number', 'Initial number of instances', +c.instances);
    const res = win ? 'azurerm_windows_virtual_machine_scale_set' : 'azurerm_linux_virtual_machine_scale_set';
    const ipcfg = ['name = "internal"', 'primary = true', 'subnet_id = ' + x.subnetId('app'),
      x.has('lb') ? 'load_balancer_backend_address_pool_ids = [azurerm_lb_backend_address_pool.main.id]' : null,
      x.has('appgw') ? 'application_gateway_backend_address_pool_ids = [one(azurerm_application_gateway.main.backend_address_pool[*].id)]' : null];
    const parts = [R(`resource "${res}" "main"`, [
      'name = ' + x.n('vmss'), ...x.rgArgs('compute'), 'sku = var.vmss_sku', 'instances = var.vmss_instances', 'zones = ["1", "2", "3"]', 'upgrade_mode = "Manual"', win ? 'computer_name_prefix = "vmss"' : null, '',
      'admin_username = var.admin_username', win ? 'admin_password = var.admin_password' : 'disable_password_authentication = true',
      win ? null : '', win ? null : B('admin_ssh_key', ['username = var.admin_username', 'public_key = var.admin_ssh_public_key']), '',
      'secure_boot_enabled = true', 'vtpm_enabled = true', '',
      imageBlock(c.image), '',
      B('os_disk', ['caching = "ReadWrite"', 'storage_account_type = "Premium_LRS"']), '',
      B('network_interface', ['name = "nic"', 'primary = true', '', B('ip_configuration', ipcfg)]), '',
      B('boot_diagnostics', []), '', x.identityBlock(), '', x.tags,
      c.autoscale ? '' : null, c.autoscale ? '# Autoscale owns the instance count after the first apply.' : null, c.autoscale ? B('lifecycle', ['ignore_changes = [instances]']) : null,
    ])];
    if (c.autoscale) {
      x.v('vmss_min_instances', 'number', 'Autoscale minimum', +c.min);
      x.v('vmss_max_instances', 'number', 'Autoscale maximum', +c.max);
      const rule = (dir, op, thr) => B('rule', [B('metric_trigger', ['metric_name = "Percentage CPU"', `metric_resource_id = ${res}.main.id`, 'time_grain = "PT1M"', 'statistic = "Average"', 'time_window = "PT5M"', 'time_aggregation = "Average"', `operator = "${op}"`, `threshold = ${thr}`]), '', B('scale_action', [`direction = "${dir}"`, 'type = "ChangeCount"', 'value = "1"', 'cooldown = "PT5M"'])]);
      parts.push(R('resource "azurerm_monitor_autoscale_setting" "vmss"', ['name = ' + x.n('autoscale', 'vmss'), ...x.rgArgs('compute'), `target_resource_id = ${res}.main.id`, '',
        B('profile', ['name = "cpu"', '', B('capacity', ['default = var.vmss_instances', 'minimum = var.vmss_min_instances', 'maximum = var.vmss_max_instances']), '', rule('Increase', 'GreaterThan', 75), '', rule('Decrease', 'LessThan', 25)]), '', x.tags]));
    }
    x.o('vmss_id', `${res}.main.id`, 'ID of the scale set');
    return parts.join('\n\n');
  },
});

S({
  id: 'aks', name: 'Azure Kubernetes Service', cat: 'compute', diff: 'Advanced', file: 'aks',
  res: ['azurerm_kubernetes_cluster', 'azurerm_kubernetes_cluster_node_pool', 'azurerm_role_assignment'],
  deps: ['subnet', 'identity'], kw: 'aks kubernetes k8s cluster containers node pool cni overlay cilium workload identity',
  azdoc: MS + 'aks/what-is-aks',
  suggest: () => ['acr', 'log_analytics', 'nsg'],
  desc: 'An AKS cluster with Azure CNI Overlay and Cilium, Entra ID RBAC, workload identity, autoscaling node pools and Container Insights.',
  use: 'Run containerised microservices with Kubernetes, without managing the control plane.',
  fields: [
    { k: 'tier', l: 'Pricing tier', t: 'select', o: ['Free', 'Standard'], d: 'Standard', h: 'Standard adds the uptime SLA. Use it for production.' },
    { k: 'version', l: 'Kubernetes version (blank = AKS default)', t: 'text', d: '' },
    { k: 'vm_size', l: 'System pool VM size', t: 'select', o: ['Standard_D2s_v5', 'Standard_D4s_v5', 'Standard_D2as_v5'], d: 'Standard_D4s_v5' },
    { k: 'min', l: 'System pool minimum nodes', t: 'number', d: 2 },
    { k: 'max', l: 'System pool maximum nodes', t: 'number', d: 4 },
    { k: 'user_pool', l: 'Add a user node pool', t: 'bool', d: true },
    { k: 'private', l: 'Private API server', t: 'bool', d: false },
    { k: 'policy', l: 'Azure Policy add-on', t: 'bool', d: true },
  ],
  assume: ['Local accounts are disabled: cluster access uses Microsoft Entra ID and Azure RBAC.', 'Outbound type follows the network: NAT gateway, firewall route table, or the load balancer.'],
  guide: ['Grant cluster access with Azure Kubernetes Service RBAC roles to Entra groups.', 'Use workload identity for pods instead of secrets.'],
  gen(c, x) {
    const u = x.uai();
    const law = x.law();
    const outbound = x.has('nat_gateway') ? 'userAssignedNATGateway' : (x.has('firewall') && x.has('route_table')) ? 'userDefinedRouting' : 'loadBalancer';
    x.v('aks_kubernetes_version', 'string', 'Kubernetes version; null lets AKS pick its current default', c.version || null);
    x.v('aks_system_vm_size', 'string', 'VM size for the system node pool', c.vm_size);
    x.v('aks_system_min_count', 'number', 'Minimum system nodes', +c.min);
    x.v('aks_system_max_count', 'number', 'Maximum system nodes', +c.max);
    const client = x.client();
    const parts = [];
    if (u) parts.push('# With a user-assigned identity, AKS needs Network Contributor on its subnet before the cluster is created.',
      R('resource "azurerm_role_assignment" "aks_network"', [`scope = ${x.subnetId('aks')}`, 'role_definition_name = "Network Contributor"', `principal_id = ${u}.principal_id`, 'principal_type = "ServicePrincipal"']));
    parts.push(R('resource "azurerm_kubernetes_cluster" "main"', [
      'name = ' + x.n('aks'), ...x.rgArgs('compute'), 'dns_prefix = "aks-${local.name_prefix}"', 'kubernetes_version = var.aks_kubernetes_version', `sku_tier = "${c.tier}"`, '',
      'automatic_upgrade_channel = "patch"', 'node_os_upgrade_channel = "NodeImage"', 'oidc_issuer_enabled = true', 'workload_identity_enabled = true', 'local_account_disabled = true', 'role_based_access_control_enabled = true', `azure_policy_enabled = ${c.policy}`, `private_cluster_enabled = ${c.private}`, '',
      B('default_node_pool', ['name = "system"', 'vm_size = var.aks_system_vm_size', 'vnet_subnet_id = ' + x.subnetId('aks'), 'zones = ["1", "2", "3"]', 'auto_scaling_enabled = true', 'min_count = var.aks_system_min_count', 'max_count = var.aks_system_max_count', `only_critical_addons_enabled = ${c.user_pool}`, 'os_sku = "AzureLinux"', 'temporary_name_for_rotation = "systemtmp"', '', B('upgrade_settings', ['max_surge = "10%"'])]), '',
      '# Required in azurerm 5.x. Manual: node pools are the ones declared here, not auto-provisioned (Karpenter).',
      B('node_provisioning_profile', ['mode = "Manual"']), '',
      u ? B('identity', ['type = "UserAssigned"', `identity_ids = [${u}.id]`]) : B('identity', ['type = "SystemAssigned"']), '',
      B('azure_active_directory_role_based_access_control', ['azure_rbac_enabled = true', `tenant_id = ${client}.tenant_id`]), '',
      B('network_profile', ['network_plugin = "azure"', 'network_plugin_mode = "overlay"', 'network_data_plane = "cilium"', 'network_policy = "cilium"', 'pod_cidr = "192.168.0.0/16"', 'service_cidr = "172.16.0.0/16"', 'dns_service_ip = "172.16.0.10"', `outbound_type = "${outbound}"`, 'load_balancer_sku = "standard"']), '',
      law ? B('oms_agent', [`log_analytics_workspace_id = ${law}`, 'msi_auth_for_monitoring_enabled = true']) : null, law ? '' : null,
      x.tags, '', '# The cluster autoscaler changes node_count; Terraform should not fight it.', B('lifecycle', ['ignore_changes = [default_node_pool[0].node_count]']),
      u ? '' : null, u ? 'depends_on = [azurerm_role_assignment.aks_network]' : null,
    ]));
    if (c.user_pool) parts.push(R('resource "azurerm_kubernetes_cluster_node_pool" "user"', ['name = "user"', 'kubernetes_cluster_id = azurerm_kubernetes_cluster.main.id', 'mode = "User"', 'vm_size = var.aks_system_vm_size', 'vnet_subnet_id = ' + x.subnetId('aks'), 'zones = ["1", "2", "3"]', 'auto_scaling_enabled = true', 'min_count = 1', 'max_count = 5', 'os_sku = "AzureLinux"', '', x.tags, '', B('lifecycle', ['ignore_changes = [node_count]'])]));
    if (x.has('acr')) parts.push('# Nodes pull images from ACR with the kubelet identity: no image pull secrets.', R('resource "azurerm_role_assignment" "aks_acr_pull"', ['scope = azurerm_container_registry.main.id', 'role_definition_name = "AcrPull"', 'principal_id = azurerm_kubernetes_cluster.main.kubelet_identity[0].object_id', 'principal_type = "ServicePrincipal"', 'skip_service_principal_aad_check = true']));
    x.o('aks_cluster_id', 'azurerm_kubernetes_cluster.main.id', 'ID of the AKS cluster');
    x.o('aks_cluster_name', 'azurerm_kubernetes_cluster.main.name', 'Name of the AKS cluster');
    x.o('aks_cluster_fqdn', 'azurerm_kubernetes_cluster.main.fqdn', 'FQDN of the AKS API server');
    x.o('aks_oidc_issuer_url', 'azurerm_kubernetes_cluster.main.oidc_issuer_url', 'OIDC issuer URL for workload identity federation');
    return parts.join('\n\n');
  },
});

S({
  id: 'acr', name: 'Container Registry', cat: 'compute', diff: 'Intermediate', file: 'acr',
  res: ['azurerm_container_registry', 'azurerm_role_assignment'], deps: ['resource_group'], kw: 'acr container registry docker images oci',
  azdoc: MS + 'container-registry/container-registry-intro',
  desc: 'A private OCI registry with the admin user off. AKS and the managed identity pull with Entra ID.',
  use: 'Store and serve container images close to AKS, Container Apps and App Service.',
  fields: [
    { k: 'sku', l: 'SKU', t: 'select', o: ['Basic', 'Standard', 'Premium'], d: 'Premium', h: 'Premium is needed for private endpoints, geo-replication and zone redundancy.' },
    { k: 'geo', l: 'Geo-replicate to the paired region', t: 'bool', d: false, when: c => c.sku === 'Premium' },
  ],
  gen(c, x) {
    const prem = c.sku === 'Premium', pe = x.has('private_endpoint') && prem;
    const pair = REGION_PAIR[x.g.region] || 'eastasia';
    const parts = [R('resource "azurerm_container_registry" "main"', [
      '# Registry names are 5-50 letters and digits, globally unique.', 'name = ' + x.uname('acr', 50, false), ...x.rgArgs('compute'), `sku = "${c.sku}"`, 'admin_enabled = false', 'anonymous_pull_enabled = false',
      prem ? `public_network_access_enabled = ${!pe}` : null, prem ? 'zone_redundancy_enabled = true' : null,
      prem && c.geo ? '' : null, prem && c.geo ? B('georeplications', [`location = "${pair}"`, 'zone_redundancy_enabled = true', 'global_endpoint_routing_enabled = true']) : null, '', x.tags])];
    if (x.uai()) parts.push(R('resource "azurerm_role_assignment" "identity_acr_pull"', ['scope = azurerm_container_registry.main.id', 'role_definition_name = "AcrPull"', `principal_id = ${x.uai()}.principal_id`, 'principal_type = "ServicePrincipal"']));
    x.o('acr_login_server', 'azurerm_container_registry.main.login_server', 'Login server, for example myacr.azurecr.io');
    return parts.join('\n\n');
  },
});

S({
  id: 'aci', name: 'Container Instances', cat: 'compute', diff: 'Intermediate', file: 'container_instance',
  res: ['azurerm_container_group'], deps: ['resource_group'], kw: 'aci container instance serverless container group',
  azdoc: MS + 'container-instances/container-instances-overview',
  suggest: c => c.ip === 'Private' ? ['subnet'] : [],
  desc: 'A container group running one container, on a public DNS name or privately in a delegated subnet.',
  use: 'Short-lived jobs, build agents or a quick demo container without a cluster.',
  fields: [
    { k: 'image', l: 'Image', t: 'text', d: 'mcr.microsoft.com/azuredocs/aci-helloworld:latest' },
    { k: 'ip', l: 'IP address', t: 'select', o: ['Public', 'Private'], d: 'Public' },
    { k: 'cpu', l: 'CPU cores', t: 'number', d: 1 },
    { k: 'memory', l: 'Memory (GB)', t: 'number', d: 1.5 },
  ],
  gen(c, x) {
    const pub = c.ip === 'Public';
    x.v('aci_image', 'string', 'Container image', c.image);
    if (pub) x.o('aci_fqdn', 'azurerm_container_group.main.fqdn', 'Public FQDN of the container group');
    x.o('aci_ip_address', 'azurerm_container_group.main.ip_address', 'IP address of the container group');
    return R('resource "azurerm_container_group" "main"', ['name = ' + x.n('ci'), ...x.rgArgs('compute'), 'os_type = "Linux"', 'restart_policy = "Always"', `ip_address_type = "${c.ip}"`,
      pub ? 'dns_name_label = ' + x.uname('ci', 63) : 'subnet_ids = [' + x.subnetId('aci') + ']', '',
      B('container', ['name = "app"', 'image = var.aci_image', `cpu = ${+c.cpu}`, `memory = ${+c.memory}`, '', B('ports', ['port = 80', 'protocol = "TCP"'])]), '',
      x.uai() ? x.identityBlock() : null, x.uai() ? '' : null, x.tags]);
  },
});

S({
  id: 'container_apps', name: 'Container Apps', cat: 'compute', diff: 'Intermediate', file: 'container_apps',
  res: ['azurerm_container_app_environment', 'azurerm_container_app'], deps: ['resource_group'], kw: 'container apps aca serverless containers dapr keda revisions',
  azdoc: MS + 'container-apps/overview',
  suggest: () => ['log_analytics'],
  desc: 'A Container Apps environment with a consumption workload profile and one app with HTTP ingress and scale rules.',
  use: 'Serverless microservices and APIs that scale to zero, without running Kubernetes yourself.',
  fields: [
    { k: 'image', l: 'Image', t: 'text', d: 'mcr.microsoft.com/k8se/quickstart:latest' },
    { k: 'port', l: 'Target port', t: 'number', d: 80 },
    { k: 'min', l: 'Minimum replicas', t: 'number', d: 0 },
    { k: 'max', l: 'Maximum replicas', t: 'number', d: 5 },
    { k: 'vnet', l: 'Integrate with the VNet', t: 'bool', d: false },
  ],
  gen(c, x) {
    const law = x.law();
    x.v('containerapp_image', 'string', 'Container image for the app', c.image);
    const u = x.uai();
    const acr = x.has('acr') && u;
    x.o('containerapp_fqdn', 'azurerm_container_app.main.ingress[0].fqdn', 'Public FQDN of the container app');
    return [
      R('resource "azurerm_container_app_environment" "main"', ['name = ' + x.n('cae'), ...x.rgArgs('compute'), law ? `log_analytics_workspace_id = ${law}` : null, law ? 'logs_destination = "log-analytics"' : null,
        c.vnet ? 'infrastructure_subnet_id = ' + x.subnetId('aca') : null, c.vnet ? 'internal_load_balancer_enabled = false' : null, '',
        B('workload_profile', ['name = "Consumption"', 'workload_profile_type = "Consumption"']), '', x.tags]),
      R('resource "azurerm_container_app" "main"', ['name = ' + x.n('ca'), 'container_app_environment_id = azurerm_container_app_environment.main.id', 'resource_group_name = ' + x.rg('compute').name, 'revision_mode = "Single"', 'workload_profile_name = "Consumption"', '',
        B('template', [`min_replicas = ${+c.min}`, `max_replicas = ${+c.max}`, '', B('container', ['name = "app"', 'image = var.containerapp_image', 'cpu = 0.5', 'memory = "1Gi"']), '', B('http_scale_rule', ['name = "http"', 'concurrent_requests = "50"'])]), '',
        B('ingress', ['external_enabled = true', `target_port = ${+c.port}`, '', B('traffic_weight', ['percentage = 100', 'latest_revision = true'])]), '',
        u ? B('identity', ['type = "UserAssigned"', `identity_ids = [${u}.id]`]) : null, u ? '' : null,
        acr ? B('registry', ['server = azurerm_container_registry.main.login_server', `identity = ${u}.id`]) : null, acr ? '' : null, x.tags]),
    ].join('\n\n');
  },
});

S({
  id: 'app_service_plan', name: 'App Service Plan', cat: 'compute', diff: 'Intermediate', file: 'app_service_plan',
  res: ['azurerm_service_plan'], deps: ['resource_group'], kw: 'app service plan server farm sku linux hosting',
  azdoc: MS + 'app-service/overview-hosting-plans',
  desc: 'The Linux compute that web apps run on. Its SKU sets size, instance count and features.',
  use: 'Host one or more web apps on shared, scalable compute.',
  fields: [
    { k: 'sku', l: 'SKU', t: 'select', o: ['B1', 'S1', 'P0v3', 'P1v3', 'P1mv3'], d: 'P0v3', h: 'Premium v3 supports zone redundancy and better price/performance.' },
    { k: 'workers', l: 'Instances', t: 'number', d: 1 },
  ],
  gen(c, x) {
    x.v('app_service_plan_workers', 'number', 'Number of plan instances', +c.workers);
    x.v('app_service_plan_sku', 'string', 'App Service plan SKU', c.sku);
    x.o('app_service_plan_id', 'azurerm_service_plan.main.id', 'ID of the App Service plan');
    return R('resource "azurerm_service_plan" "main"', ['name = ' + x.n('asp'), ...x.rgArgs('compute'), 'os_type = "Linux"', 'sku_name = var.app_service_plan_sku', 'worker_count = var.app_service_plan_workers', '', x.tags]);
  },
});

S({
  id: 'web_app', name: 'Web App (App Service)', cat: 'compute', diff: 'Intermediate', file: 'web_app',
  res: ['azurerm_linux_web_app'], deps: ['app_service_plan'], kw: 'web app app service paas website api linux node python dotnet',
  azdoc: MS + 'app-service/overview',
  suggest: () => ['app_insights', 'identity'],
  desc: 'A Linux web app on the plan: HTTPS only, TLS 1.2, FTP and basic publishing off, managed identity and Application Insights.',
  use: 'Host a web site or API without managing servers.',
  fields: [
    { k: 'stack', l: 'Runtime', t: 'select', o: ['Node 22 LTS', 'Python 3.12', '.NET 8'], d: 'Node 22 LTS' },
    { k: 'vnet', l: 'VNet integration (outbound through the VNet)', t: 'bool', d: false },
  ],
  gen(c, x) {
    const stack = { 'Node 22 LTS': 'node_version = "22-lts"', 'Python 3.12': 'python_version = "3.12"', '.NET 8': 'dotnet_version = "8.0"' }[c.stack];
    const pe = x.has('private_endpoint');
    const appi = x.appiConn();
    const plan = x.has('app_service_plan') ? 'azurerm_service_plan.main.id' : x.v('app_service_plan_id', 'string', 'ID of an existing Linux App Service plan');
    const sku = x.has('app_service_plan') ? x.cfgOf('app_service_plan').sku : 'P0v3';
    x.o('web_app_hostname', 'azurerm_linux_web_app.main.default_hostname', 'Default host name of the web app');
    return R('resource "azurerm_linux_web_app" "main"', [
      'name = ' + x.uname('app', 60), ...x.rgArgs('compute'), `service_plan_id = ${plan}`, 'https_only = true', `public_network_access_enabled = ${!pe}`, 'ftp_publish_basic_authentication_enabled = false', 'webdeploy_publish_basic_authentication_enabled = false',
      c.vnet ? 'virtual_network_subnet_id = ' + x.subnetId('appsvc') : null, '',
      B('site_config', [`always_on = ${sku !== 'F1'}`, 'minimum_tls_version = "1.2"', 'ftps_state = "Disabled"', 'http2_enabled = true', 'health_check_path = "/"', 'health_check_eviction_time_in_min = 5', c.vnet ? 'vnet_route_all_enabled = true' : null, '', B('application_stack', [stack])]), '',
      appi ? `app_settings = {\n  APPLICATIONINSIGHTS_CONNECTION_STRING = ${appi}\n}` : null, appi ? '' : null,
      x.identityBlock(), '', x.tags,
    ]);
  },
});

S({
  id: 'function_app', name: 'Function App (Flex Consumption)', cat: 'compute', diff: 'Intermediate', file: 'function_app',
  res: ['azurerm_function_app_flex_consumption', 'azurerm_service_plan', 'azurerm_storage_account', 'azurerm_storage_container', 'azurerm_user_assigned_identity', 'azurerm_role_assignment'],
  deps: ['resource_group'], kw: 'functions serverless function app flex consumption event driven trigger',
  azdoc: MS + 'azure-functions/flex-consumption-plan',
  suggest: () => ['app_insights'],
  desc: 'A Flex Consumption function app: its own FC1 plan, a deployment storage account reached with a managed identity (no keys), and Application Insights.',
  use: 'Event-driven code that scales to zero: queues, timers, HTTP APIs.',
  fields: [
    { k: 'runtime', l: 'Runtime', t: 'select', o: ['node 22', 'python 3.12', 'dotnet-isolated 8.0', 'java 21', 'powershell 7.4'], d: 'python 3.12' },
    { k: 'memory', l: 'Instance memory (MB)', t: 'select', o: ['512', '2048', '4096'], d: '2048' },
    { k: 'max', l: 'Maximum instances', t: 'number', d: 100 },
    { k: 'vnet', l: 'VNet integration', t: 'bool', d: false },
  ],
  assume: ['The function storage account has shared keys turned off. The host reaches it with the managed identity (AzureWebJobsStorage__credential = managedidentity).'],
  gen(c, x) {
    const [rt, ver] = c.runtime.split(' ');
    const u = x.uai() || 'azurerm_user_assigned_identity.func';
    const pe = x.has('private_endpoint');
    const appi = x.appiConn();
    const parts = [
      R('resource "azurerm_storage_account" "func"', ['# Deployment and host storage for the function app.', 'name = ' + x.uname('stfn', 24, false), ...x.rgArgs('compute'), 'account_tier = "Standard"', 'account_replication_type = "LRS"', 'min_tls_version = "TLS1_2"', 'https_traffic_only_enabled = true', 'allow_nested_items_to_be_public = false', 'shared_access_key_enabled = false', 'default_to_oauth_authentication = true', '', x.tags]),
      R('resource "azurerm_storage_container" "func"', ['name = "app-package"', 'storage_account_id = azurerm_storage_account.func.id', 'container_access_type = "private"']),
      R('resource "azurerm_service_plan" "func"', ['name = ' + x.n('asp', 'func'), ...x.rgArgs('compute'), 'os_type = "Linux"', 'sku_name = "FC1"', '', x.tags]),
    ];
    if (!x.uai()) parts.push(R('resource "azurerm_user_assigned_identity" "func"', ['name = ' + x.n('id', 'func'), ...x.rgArgs('compute'), '', x.tags]));
    x.flags.storageAad = true;
    parts.push('# The identity must be able to read and write deployment packages before the app starts.',
      R('resource "azurerm_role_assignment" "func_storage"', ['scope = azurerm_storage_account.func.id', 'role_definition_name = "Storage Blob Data Owner"', `principal_id = ${u}.principal_id`, 'principal_type = "ServicePrincipal"']),
      R('resource "azurerm_function_app_flex_consumption" "main"', [
        'name = ' + x.uname('func', 60), ...x.rgArgs('compute'), 'service_plan_id = azurerm_service_plan.func.id', '',
        'storage_container_type = "blobContainer"', 'storage_container_endpoint = "${azurerm_storage_account.func.primary_blob_endpoint}${azurerm_storage_container.func.name}"', 'storage_authentication_type = "UserAssignedIdentity"', `storage_user_assigned_identity_id = ${u}.id`, '',
        `runtime_name = "${rt}"`, `runtime_version = "${ver}"`, `instance_memory_in_mb = ${+c.memory}`, `maximum_instance_count = ${+c.max}`, 'https_only = true', `public_network_access_enabled = ${!pe}`,
        c.vnet ? 'virtual_network_subnet_id = ' + x.subnetId('func') : null, '',
        `app_settings = {\n  AzureWebJobsStorage__accountName = azurerm_storage_account.func.name\n  AzureWebJobsStorage__credential  = "managedidentity"\n  AzureWebJobsStorage__clientId    = ${u}.client_id\n}`, '',
        B('site_config', ['minimum_tls_version = "1.2"', appi ? `application_insights_connection_string = ${appi}` : null]), '',
        B('identity', ['type = "UserAssigned"', `identity_ids = [${u}.id]`]), '', x.tags, '',
        '# Nothing in this block references the role assignment, so the ordering is explicit.', 'depends_on = [azurerm_role_assignment.func_storage]',
      ]));
    x.o('function_app_hostname', 'azurerm_function_app_flex_consumption.main.default_hostname', 'Default host name of the function app');
    return parts.join('\n\n');
  },
});
