/* ==========================================================================
   gen_backup.js — Backup generator: Recovery Services vault, VM and file
   share backup, Backup vault (blob operational backup) and Azure Site
   Recovery for disaster recovery.
   ========================================================================== */

const VM_POLICIES = {
  'Daily-30Days': { freq: 'Daily', daily: 30, weekly: 12, monthly: 12, yearly: 0 },
  'Daily-7Days': { freq: 'Daily', daily: 7, weekly: 0, monthly: 0, yearly: 0 },
  'Weekly-12Weeks': { freq: 'Weekly', daily: 0, weekly: 12, monthly: 12, yearly: 1 },
};
const rsvName = x => x.has('recovery_vault') ? 'azurerm_recovery_services_vault.main.name' : x.v('recovery_vault_name', 'string', 'Name of an existing Recovery Services vault (the vault service is not selected)');
const rsvRg = x => x.has('recovery_vault') ? 'azurerm_recovery_services_vault.main.resource_group_name' : x.rg('backup').name;

S({
  id: 'recovery_vault', name: 'Recovery Services Vault', cat: 'backup', diff: 'Intermediate', file: 'recovery_services_vault',
  res: ['azurerm_recovery_services_vault'], deps: ['resource_group'], kw: 'recovery services vault backup rsv immutability cross region restore',
  azdoc: MS + 'backup/backup-azure-recovery-services-vault-overview',
  suggest: () => ['vm_backup'],
  desc: 'The vault that stores VM and Azure Files recovery points, with storage redundancy, immutability and built-in job failure alerts.',
  use: 'Central, protected storage for backups of VMs and file shares.',
  fields: [
    { k: 'redundancy', l: 'Storage redundancy', t: 'select', o: ['GeoRedundant', 'ZoneRedundant', 'LocallyRedundant'], d: 'GeoRedundant', h: 'Set before the first item is protected; it cannot change afterwards.' },
    { k: 'crr', l: 'Cross Region Restore', t: 'bool', d: false, h: 'Restore in the paired region. Needs GeoRedundant.' },
    { k: 'immutability', l: 'Immutability', t: 'select', o: ['Disabled', 'Unlocked', 'Locked'], d: 'Unlocked', h: 'Locked is irreversible.' },
  ],
  assume: ['Soft delete is enabled by Azure by default (14 days). azurerm 5.x no longer exposes a soft-delete argument for this vault.'],
  guide: ['Enable multi-user authorization with a Resource Guard for production vaults.'],
  gen(c, x) {
    x.v('recovery_vault_storage_mode', 'string', 'GeoRedundant, ZoneRedundant or LocallyRedundant', c.redundancy);
    x.o('recovery_vault_id', 'azurerm_recovery_services_vault.main.id', 'ID of the Recovery Services vault');
    return R('resource "azurerm_recovery_services_vault" "main"', ['name = ' + x.n('rsv'), ...x.rgArgs('backup'), 'sku = "Standard"', 'storage_mode_type = var.recovery_vault_storage_mode', `cross_region_restore_enabled = ${!!c.crr}`, `immutability = "${c.immutability}"`, '',
      B('monitoring', ['alerts_for_all_job_failures_enabled = true', 'alerts_for_critical_operation_failures_enabled = true']), '', x.tags]);
  },
});

S({
  id: 'vm_backup', name: 'VM Backup', cat: 'backup', diff: 'Intermediate', file: 'backup_vm',
  res: ['azurerm_backup_policy_vm', 'azurerm_backup_protected_vm'], deps: ['recovery_vault', 'vm'], kw: 'vm backup policy retention daily weekly monthly protected item enhanced',
  azdoc: MS + 'backup/backup-azure-vms-introduction',
  desc: 'An Enhanced (V2) VM backup policy with daily, weekly, monthly and yearly retention, protecting every selected VM.',
  use: 'Recover a VM, a disk or individual files after deletion, corruption or ransomware.',
  fields: [
    { k: 'preset', l: 'Policy', t: 'select', o: Object.keys(VM_POLICIES), d: 'Daily-30Days', presets: Object.fromEntries(Object.entries(VM_POLICIES).map(([k, v]) => [k, { daily: v.daily, weekly: v.weekly, monthly: v.monthly, yearly: v.yearly }])) },
    { k: 'time', l: 'Backup time (UTC, HH:MM)', t: 'text', d: '23:00' },
    { k: 'daily', l: 'Keep daily (days)', t: 'number', d: 30 },
    { k: 'weekly', l: 'Keep weekly (weeks, 0 = off)', t: 'number', d: 12 },
    { k: 'monthly', l: 'Keep monthly (months, 0 = off)', t: 'number', d: 12 },
    { k: 'yearly', l: 'Keep yearly (years, 0 = off)', t: 'number', d: 0 },
    { k: 'instant', l: 'Instant restore snapshots (days)', t: 'number', d: 7 },
  ],
  assume: ['Enhanced (V2) policies are needed for Trusted Launch VMs, which this studio generates.', 'With the VM service unselected, VMs to protect come from var.backup_vm_ids.'],
  gen(c, x) {
    const p = VM_POLICIES[c.preset];
    const vm = x.vm();
    const daily = p.freq === 'Daily';
    const rows = [
      'name = ' + x.n('bkpol-vm', c.preset.toLowerCase()), 'resource_group_name = ' + rsvRg(x), 'recovery_vault_name = ' + rsvName(x), 'policy_type = "V2"', 'timezone = "UTC"', `instant_restore_retention_days = ${+c.instant}`, '',
      B('backup', [`frequency = "${p.freq}"`, `time = ${hq(c.time)}`, daily ? null : 'weekdays = ["Sunday"]']), '',
      daily && +c.daily ? B('retention_daily', [`count = ${+c.daily}`]) : null, daily && +c.daily ? '' : null,
      +c.weekly ? B('retention_weekly', [`count = ${+c.weekly}`, 'weekdays = ["Sunday"]']) : null, +c.weekly ? '' : null,
      +c.monthly ? B('retention_monthly', [`count = ${+c.monthly}`, 'weekdays = ["Sunday"]', 'weeks = ["First"]']) : null, +c.monthly ? '' : null,
      +c.yearly ? B('retention_yearly', [`count = ${+c.yearly}`, 'weekdays = ["Sunday"]', 'weeks = ["First"]', 'months = ["January"]']) : null,
    ];
    const targets = vm ? vm.ids : x.v('backup_vm_ids', 'map(string)', 'VM resource IDs to protect, keyed by a short name', {});
    x.o('vm_backup_policy_id', 'azurerm_backup_policy_vm.main.id', 'ID of the VM backup policy');
    return [
      R('resource "azurerm_backup_policy_vm" "main"', rows),
      R('resource "azurerm_backup_protected_vm" "this"', [`for_each = ${targets}`, '', 'resource_group_name = ' + rsvRg(x), 'recovery_vault_name = ' + rsvName(x), 'source_vm_id = each.value', 'backup_policy_id = azurerm_backup_policy_vm.main.id']),
    ].join('\n\n');
  },
});

S({
  id: 'file_share_backup', name: 'Azure Files Backup', cat: 'backup', diff: 'Intermediate', file: 'backup_file_share',
  res: ['azurerm_backup_container_storage_account', 'azurerm_backup_policy_file_share', 'azurerm_backup_protected_file_share'], deps: ['recovery_vault', 'file_share'],
  kw: 'azure files backup file share snapshot policy',
  azdoc: MS + 'backup/azure-file-share-backup-overview',
  desc: 'Registers the storage account with the vault and protects the file share with a daily snapshot policy.',
  use: 'Recover files or a whole share after accidental deletion.',
  fields: [{ k: 'daily', l: 'Keep daily (days)', t: 'number', d: 30 }, { k: 'weekly', l: 'Keep weekly (weeks, 0 = off)', t: 'number', d: 12 }],
  gen(c, x) {
    const st = x.has('storage_account') ? 'azurerm_storage_account.main.id' : x.v('storage_account_id', 'string', 'ID of the storage account that holds the share');
    const share = x.has('file_share') ? 'azurerm_storage_share.main.name' : x.v('file_share_name', 'string', 'Name of the file share to protect');
    x.o('protected_file_share_id', 'azurerm_backup_protected_file_share.main.id', 'ID of the protected file share');
    return [
      R('resource "azurerm_backup_container_storage_account" "main"', ['resource_group_name = ' + rsvRg(x), 'recovery_vault_name = ' + rsvName(x), `storage_account_id = ${st}`]),
      R('resource "azurerm_backup_policy_file_share" "main"', ['name = ' + x.n('bkpol-files'), 'resource_group_name = ' + rsvRg(x), 'recovery_vault_name = ' + rsvName(x), 'timezone = "UTC"', '',
        B('backup', ['frequency = "Daily"', 'time = "23:00"']), '', B('retention_daily', [`count = ${+c.daily}`]), +c.weekly ? '' : null, +c.weekly ? B('retention_weekly', [`count = ${+c.weekly}`, 'weekdays = ["Sunday"]']) : null]),
      R('resource "azurerm_backup_protected_file_share" "main"', ['resource_group_name = ' + rsvRg(x), 'recovery_vault_name = ' + rsvName(x), `source_storage_account_id = ${st}`, `source_file_share_name = ${share}`, 'backup_policy_id = azurerm_backup_policy_file_share.main.id', '', '# The storage account must be registered with the vault first; no attribute links them.', 'depends_on = [azurerm_backup_container_storage_account.main]']),
    ].join('\n\n');
  },
});

S({
  id: 'backup_vault', name: 'Backup Vault (Blob)', cat: 'backup', diff: 'Intermediate', file: 'backup_vault',
  res: ['azurerm_data_protection_backup_vault', 'azurerm_role_assignment', 'azurerm_data_protection_backup_policy_blob_storage', 'azurerm_data_protection_backup_instance_blob_storage'],
  deps: ['resource_group'], kw: 'backup vault data protection blob operational backup soft delete immutability',
  azdoc: MS + 'backup/backup-vault-overview',
  suggest: () => ['storage_account'],
  desc: 'A Backup vault (Data Protection) with soft delete and immutability; with Storage selected, operational backup for its blobs.',
  use: 'Protect blobs (and disks, PostgreSQL, AKS) with policies managed outside the storage account.',
  fields: [
    { k: 'redundancy', l: 'Redundancy', t: 'select', o: ['LocallyRedundant', 'ZoneRedundant', 'GeoRedundant'], d: 'LocallyRedundant' },
    { k: 'soft_delete', l: 'Soft delete', t: 'select', o: ['On', 'AlwaysOn', 'Off'], d: 'On', h: 'AlwaysOn cannot be turned off later.' },
    { k: 'immutability', l: 'Immutability', t: 'select', o: ['Disabled', 'Unlocked', 'Locked'], d: 'Disabled' },
    { k: 'crr', l: 'Cross Region Restore', t: 'bool', d: false },
    { k: 'retention', l: 'Blob operational retention (days)', t: 'number', d: 30 },
  ],
  gen(c, x) {
    const parts = [R('resource "azurerm_data_protection_backup_vault" "main"', ['name = ' + x.n('bvault'), ...x.rgArgs('backup'), 'datastore_type = "VaultStore"', `redundancy = "${c.redundancy}"`, `soft_delete = "${c.soft_delete}"`, 'retention_duration_in_days = 14', `immutability = "${c.immutability}"`, c.redundancy === 'GeoRedundant' ? `cross_region_restore_enabled = ${!!c.crr}` : null, '', B('identity', ['type = "SystemAssigned"']), '', x.tags])];
    if (x.has('storage_account')) {
      parts.push('# The vault identity needs this role on the storage account to manage operational backup.',
        R('resource "azurerm_role_assignment" "backup_vault_storage"', ['scope = azurerm_storage_account.main.id', 'role_definition_name = "Storage Account Backup Contributor"', 'principal_id = azurerm_data_protection_backup_vault.main.identity[0].principal_id', 'principal_type = "ServicePrincipal"']),
        R('resource "azurerm_data_protection_backup_policy_blob_storage" "main"', ['name = ' + x.n('bkpol-blob'), 'vault_id = azurerm_data_protection_backup_vault.main.id', `operational_default_retention_duration = "P${+c.retention}D"`]),
        R('resource "azurerm_data_protection_backup_instance_blob_storage" "main"', ['name = ' + x.n('bkinst-blob'), 'vault_id = azurerm_data_protection_backup_vault.main.id', 'location = ' + x.rg('backup').loc, 'storage_account_id = azurerm_storage_account.main.id', 'backup_policy_id = azurerm_data_protection_backup_policy_blob_storage.main.id', '', 'depends_on = [azurerm_role_assignment.backup_vault_storage]']));
    } else x.note('Select Storage Account to add blob operational backup to this vault.');
    x.o('backup_vault_id', 'azurerm_data_protection_backup_vault.main.id', 'ID of the Backup vault');
    return parts.join('\n\n');
  },
});

S({
  id: 'site_recovery', name: 'Azure Site Recovery', cat: 'backup', diff: 'Advanced', file: 'site_recovery',
  res: ['azurerm_site_recovery_fabric', 'azurerm_recovery_services_vault', 'azurerm_resource_group', 'azurerm_site_recovery_protection_container', 'azurerm_site_recovery_replication_policy', 'azurerm_site_recovery_protection_container_mapping', 'azurerm_site_recovery_replication_recovery_plan'],
  deps: ['resource_group'], kw: 'site recovery asr disaster recovery dr replication failover recovery plan',
  azdoc: MS + 'site-recovery/site-recovery-overview',
  suggest: () => ['vm'],
  desc: 'Azure-to-Azure disaster recovery scaffolding: a vault in the DR region, fabrics, protection containers, a replication policy, a container mapping and a recovery plan.',
  use: 'Fail VMs over to another region with an ordered recovery plan.',
  fields: [
    { k: 'dr_region', l: 'Disaster recovery region (blank = paired region)', t: 'text', d: '' },
    { k: 'retention', l: 'Recovery point retention (hours)', t: 'number', d: 24 },
    { k: 'app_consistent', l: 'App-consistent snapshot frequency (hours)', t: 'number', d: 4 },
  ],
  assume: ['Replicating individual VMs (azurerm_site_recovery_replicated_vm) needs a target VNet, cache storage account and disk mapping per VM; add it per VM once the DR network exists.'],
  gen(c, x) {
    const dr = c.dr_region || REGION_PAIR[x.g.region] || 'eastasia';
    x.v('dr_location', 'string', 'Region that VMs fail over to', dr);
    x.o('site_recovery_vault_id', 'azurerm_recovery_services_vault.dr.id', 'ID of the Site Recovery vault in the DR region');
    const v = ['resource_group_name = azurerm_resource_group.dr.name', 'recovery_vault_name = azurerm_recovery_services_vault.dr.name'];
    return [
      '# Site Recovery vaults live in the target (DR) region.',
      R('resource "azurerm_resource_group" "dr"', ['name = "rg-${local.name_prefix}-dr"', 'location = var.dr_location', '', x.tags]),
      R('resource "azurerm_recovery_services_vault" "dr"', ['name = ' + x.n('rsv', 'dr'), 'resource_group_name = azurerm_resource_group.dr.name', 'location = azurerm_resource_group.dr.location', 'sku = "Standard"', '', x.tags]),
      R('resource "azurerm_site_recovery_fabric" "primary"', ['name = "fabric-primary"', ...v, 'location = var.location']),
      R('resource "azurerm_site_recovery_fabric" "secondary"', ['name = "fabric-secondary"', ...v, 'location = var.dr_location']),
      R('resource "azurerm_site_recovery_protection_container" "primary"', ['name = "container-primary"', ...v, 'recovery_fabric_name = azurerm_site_recovery_fabric.primary.name']),
      R('resource "azurerm_site_recovery_protection_container" "secondary"', ['name = "container-secondary"', ...v, 'recovery_fabric_name = azurerm_site_recovery_fabric.secondary.name']),
      R('resource "azurerm_site_recovery_replication_policy" "main"', ['name = "policy-a2a"', ...v, `recovery_point_retention_in_minutes = ${+c.retention * 60}`, `application_consistent_snapshot_frequency_in_minutes = ${+c.app_consistent * 60}`]),
      R('resource "azurerm_site_recovery_protection_container_mapping" "main"', ['name = "mapping-primary-to-secondary"', ...v, 'recovery_fabric_name = azurerm_site_recovery_fabric.primary.name', 'recovery_source_protection_container_name = azurerm_site_recovery_protection_container.primary.name', 'recovery_target_protection_container_id = azurerm_site_recovery_protection_container.secondary.id', 'recovery_replication_policy_id = azurerm_site_recovery_replication_policy.main.id']),
      R('resource "azurerm_site_recovery_replication_recovery_plan" "main"', ['name = "plan-${local.name_prefix}"', 'recovery_vault_id = azurerm_recovery_services_vault.dr.id', 'source_recovery_fabric_id = azurerm_site_recovery_fabric.primary.id', 'target_recovery_fabric_id = azurerm_site_recovery_fabric.secondary.id', '',
        B('shutdown_recovery_group', []), '', B('failover_recovery_group', []), '', B('boot_recovery_group', [])]),
    ].join('\n\n');
  },
});
