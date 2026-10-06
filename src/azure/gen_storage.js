/* ==========================================================================
   gen_storage.js — Storage generator: storage account with secure
   defaults and data protection, blob containers, file shares, queues,
   tables, lifecycle management and network rules.
   ========================================================================== */

const stAccount = x => x.has('storage_account') ? 'azurerm_storage_account.main.id' : x.v('storage_account_id', 'string', 'Resource ID of an existing storage account (the Storage Account service is not selected)');

S({
  id: 'storage_account', name: 'Storage Account', cat: 'storage', diff: 'Beginner', file: 'storage_account',
  res: ['azurerm_storage_account'], deps: ['resource_group'], kw: 'storage account blob general purpose v2 encryption versioning soft delete tls',
  azdoc: MS + 'storage/common/storage-account-overview',
  suggest: (c, has) => ['blob_container', ...(has('vnet') ? ['private_endpoint'] : [])],
  desc: 'A StorageV2 account: HTTPS only, TLS 1.2, no anonymous access, Entra ID by default, blob versioning, soft delete and point-in-time restore.',
  use: 'Durable object, file, queue and table storage for applications, backups and data.',
  fields: [
    { k: 'name', l: 'Name (blank = generated, globally unique)', t: 'text', d: '', h: '3-24 lowercase letters and digits.' },
    { k: 'kind', l: 'Account kind', t: 'select', o: ['StorageV2', 'BlockBlobStorage', 'FileStorage'], d: 'StorageV2', presets: { StorageV2: { tier: 'Standard' }, BlockBlobStorage: { tier: 'Premium', replication: 'LRS' }, FileStorage: { tier: 'Premium', replication: 'LRS' } } },
    { k: 'tier', l: 'Performance', t: 'select', o: ['Standard', 'Premium'], d: 'Standard' },
    { k: 'replication', l: 'Replication', t: 'select', o: ['LRS', 'ZRS', 'GRS', 'RAGRS', 'GZRS', 'RAGZRS'], d: 'ZRS' },
    { k: 'access_tier', l: 'Default access tier', t: 'select', o: ['Hot', 'Cool', 'Cold'], d: 'Hot', when: c => c.kind === 'StorageV2' },
    { k: 'public', l: 'Public network access', t: 'select', o: ['Enabled', 'Disabled'], d: 'Enabled', h: 'Disabled automatically when Private Endpoint is selected.' },
    { k: 'deny_default', l: 'Deny traffic by default (firewall)', t: 'bool', d: true, h: 'Only trusted Azure services and the network rules get through. Terraform still manages containers through Azure Resource Manager.' },
    { k: 'shared_key', l: 'Allow shared key (account key) access', t: 'bool', d: false, h: 'Off forces Microsoft Entra ID for data access.' },
    { k: 'versioning', l: 'Blob versioning', t: 'bool', d: true, when: c => c.kind !== 'FileStorage' },
    { k: 'soft_delete', l: 'Soft delete retention (days)', t: 'number', d: 14 },
    { k: 'pitr', l: 'Point-in-time restore for blobs', t: 'bool', d: true, when: c => c.kind === 'StorageV2' && c.versioning },
    { k: 'infra_enc', l: 'Infrastructure (double) encryption', t: 'bool', d: false, h: 'Set at creation only.' },
  ],
  assume: ['Data is encrypted at rest with Microsoft-managed keys. Customer-managed keys need a Key Vault and are not generated.', 'The generated name is st<project><env><6-char hash of the subscription> so it is stable and unique.'],
  guide: ['Keep shared key access off and grant Storage Blob Data roles to identities.', 'Turn off public network access and use private endpoints for production data.'],
  gen(c, x) {
    const pe = x.has('private_endpoint');
    const blob = c.kind !== 'FileStorage';
    x.flags.storageAad = true;
    x.v('storage_account_name', 'string', 'Storage account name; null builds a unique one from the project name', c.name || null, { condition: 'var.storage_account_name == null || can(regex("^[a-z0-9]{3,24}$", var.storage_account_name))', error: 'Storage account names are 3-24 lowercase letters and digits.' });
    x.v('storage_replication_type', 'string', 'Replication: LRS, ZRS, GRS, RAGRS, GZRS or RAGZRS', c.replication, { condition: 'contains(["LRS", "ZRS", "GRS", "RAGRS", "GZRS", "RAGZRS"], var.storage_replication_type)', error: 'Unknown replication type.' });
    x.v('storage_soft_delete_days', 'number', 'Days deleted blobs and containers are kept', +c.soft_delete, { condition: 'var.storage_soft_delete_days >= 1 && var.storage_soft_delete_days <= 365', error: 'Use 1 to 365 days.' });
    x.local('storage_account_name', 'coalesce(var.storage_account_name, substr("st${local.name_compact}${local.unique_suffix}", 0, 24))');
    x.flags.suffix = true; x.client();
    const pitr = blob && c.kind === 'StorageV2' && c.versioning && c.pitr;
    const net = !x.has('storage_network_rules') && (c.deny_default || pe);
    x.o('storage_account_id', 'azurerm_storage_account.main.id', 'ID of the storage account');
    x.o('storage_account_name', 'azurerm_storage_account.main.name', 'Name of the storage account');
    x.o('storage_primary_blob_endpoint', 'azurerm_storage_account.main.primary_blob_endpoint', 'Primary blob endpoint');
    return R('resource "azurerm_storage_account" "main"', [
      'name = local.storage_account_name', ...x.rgArgs('storage'), `account_kind = "${c.kind}"`, `account_tier = "${c.tier}"`, 'account_replication_type = var.storage_replication_type', c.kind === 'StorageV2' ? `access_tier = "${c.access_tier}"` : null, '',
      'https_traffic_only_enabled = true', 'min_tls_version = "TLS1_2"', 'allow_nested_items_to_be_public = false', 'cross_tenant_replication_enabled = false',
      `shared_access_key_enabled = ${!!c.shared_key}`, 'default_to_oauth_authentication = true', `public_network_access = "${pe ? 'Disabled' : c.public}"`, c.infra_enc ? 'infrastructure_encryption_enabled = true' : null, '',
      blob ? B('blob_properties', [`versioning_enabled = ${!!c.versioning}`, `change_feed_enabled = ${pitr}`, '', B('delete_retention_policy', ['days = var.storage_soft_delete_days']), '', B('container_delete_retention_policy', ['days = var.storage_soft_delete_days']),
        pitr ? '' : null, pitr ? '# Point-in-time restore needs versioning, change feed and soft delete; its window must be shorter than soft delete.' : null, pitr ? B('restore_policy', ['days = var.storage_soft_delete_days - 1']) : null]) : null, blob ? '' : null,
      net ? B('network_rules', ['default_action = "Deny"', 'bypass = ["AzureServices"]']) : null, net ? '' : null,
      B('identity', ['type = "SystemAssigned"']), '', x.tags,
    ]);
  },
});

S({
  id: 'blob_container', name: 'Blob Containers', cat: 'storage', diff: 'Beginner', file: 'blob',
  res: ['azurerm_storage_container'], deps: ['storage_account'], kw: 'blob container object storage private',
  azdoc: MS + 'storage/blobs/storage-blobs-introduction',
  desc: 'Private blob containers, created with for_each through Azure Resource Manager.',
  use: 'Organise objects such as uploads, logs and exports, each with its own access control.',
  fields: [{ k: 'names', l: 'Container names', t: 'list', d: 'data, uploads, exports' }],
  gen(c, x) {
    x.v('storage_containers', 'set(string)', 'Blob container names (3-63 lowercase letters, digits and hyphens)', csv(c.names), { condition: 'alltrue([for n in var.storage_containers : can(regex("^[a-z0-9][a-z0-9-]{2,62}$", n))])', error: 'Container names are 3-63 lowercase letters, digits and hyphens.' });
    x.o('storage_container_ids', '{ for k, c in azurerm_storage_container.this : k => c.id }', 'IDs of the blob containers');
    return R('resource "azurerm_storage_container" "this"', ['for_each = var.storage_containers', '', 'name = each.value', `storage_account_id = ${stAccount(x)}`, 'container_access_type = "private"']);
  },
});

S({
  id: 'file_share', name: 'File Share', cat: 'storage', diff: 'Beginner', file: 'file_share',
  res: ['azurerm_storage_share'], deps: ['storage_account'], kw: 'azure files smb nfs file share lift and shift',
  azdoc: MS + 'storage/files/storage-files-introduction',
  suggest: () => ['file_share_backup'],
  desc: 'An SMB Azure Files share with a quota and access tier.',
  use: 'Shared file storage for lift-and-shift apps and VMs.',
  fields: [
    { k: 'name', l: 'Share name', t: 'text', d: 'shared' },
    { k: 'quota', l: 'Quota (GB)', t: 'number', d: 100 },
    { k: 'tier', l: 'Access tier', t: 'select', o: ['TransactionOptimized', 'Hot', 'Cool'], d: 'TransactionOptimized' },
  ],
  gen(c, x) {
    x.v('file_share_name', 'string', 'Name of the file share', c.name);
    x.v('file_share_quota_gb', 'number', 'Maximum size of the share in GB', +c.quota);
    x.o('file_share_id', 'azurerm_storage_share.main.id', 'ID of the file share');
    return R('resource "azurerm_storage_share" "main"', ['name = var.file_share_name', `storage_account_id = ${stAccount(x)}`, 'quota = var.file_share_quota_gb', `access_tier = "${c.tier}"`, 'enabled_protocol = "SMB"']);
  },
});

S({
  id: 'storage_queue', name: 'Storage Queue', cat: 'storage', diff: 'Beginner', file: 'queue',
  res: ['azurerm_storage_queue'], deps: ['storage_account'], kw: 'queue messaging async decouple',
  azdoc: MS + 'storage/queues/storage-queues-introduction',
  desc: 'Simple, durable message queues in the storage account.',
  use: 'Decouple a web front end from background workers.',
  fields: [{ k: 'names', l: 'Queue names', t: 'list', d: 'orders, notifications' }],
  gen(c, x) {
    x.v('storage_queues', 'set(string)', 'Queue names', csv(c.names));
    x.o('storage_queue_ids', '{ for k, q in azurerm_storage_queue.this : k => q.id }', 'IDs of the storage queues');
    return R('resource "azurerm_storage_queue" "this"', ['for_each = var.storage_queues', '', 'name = each.value', `storage_account_id = ${stAccount(x)}`]);
  },
});

S({
  id: 'storage_table', name: 'Storage Table', cat: 'storage', diff: 'Beginner', file: 'table',
  res: ['azurerm_storage_table'], deps: ['storage_account'], kw: 'table nosql key value entity',
  azdoc: MS + 'storage/tables/table-storage-overview',
  desc: 'Schemaless key-value tables in the storage account.',
  use: 'Cheap storage for structured, non-relational data such as device state.',
  fields: [{ k: 'names', l: 'Table names', t: 'list', d: 'devices' }],
  gen(c, x) {
    x.v('storage_tables', 'set(string)', 'Table names (letters and digits, starting with a letter)', csv(c.names));
    x.o('storage_table_ids', '{ for k, t in azurerm_storage_table.this : k => t.id }', 'IDs of the storage tables');
    return R('resource "azurerm_storage_table" "this"', ['for_each = var.storage_tables', '', 'name = each.value', `storage_account_id = ${stAccount(x)}`]);
  },
});

S({
  id: 'storage_lifecycle', name: 'Lifecycle Management', cat: 'storage', diff: 'Intermediate', file: 'lifecycle',
  res: ['azurerm_storage_management_policy'], deps: ['storage_account'], kw: 'lifecycle tiering cool archive cold delete retention cost',
  azdoc: MS + 'storage/blobs/lifecycle-management-overview',
  desc: 'Rules that move blobs to cooler tiers and delete old blobs, snapshots and versions.',
  use: 'Cut storage cost automatically as data ages.',
  fields: [
    { k: 'prefix', l: 'Blob prefix filter (blank = all)', t: 'text', d: '' },
    { k: 'cool', l: 'Move to Cool after (days, 0 = off)', t: 'number', d: 30 },
    { k: 'archive', l: 'Move to Archive after (days, 0 = off)', t: 'number', d: 0, h: 'Archive is not available with ZRS, GZRS or RA-GZRS replication.' },
    { k: 'delete', l: 'Delete after (days, 0 = off)', t: 'number', d: 730 },
    { k: 'versions', l: 'Delete old versions after (days)', t: 'number', d: 90 },
  ],
  gen(c, x) {
    x.o('storage_management_policy_id', 'azurerm_storage_management_policy.main.id', 'ID of the lifecycle management policy');
    const base = [];
    if (+c.cool) base.push(`tier_to_cool_after_days_since_modification_greater_than = ${+c.cool}`);
    if (+c.archive) base.push(`tier_to_archive_after_days_since_modification_greater_than = ${+c.archive}`);
    if (+c.delete) base.push(`delete_after_days_since_modification_greater_than = ${+c.delete}`);
    return R('resource "azurerm_storage_management_policy" "main"', [`storage_account_id = ${stAccount(x)}`, '',
      B('rule', ['name = "age-based-tiering"', 'enabled = true', '', B('filters', ['blob_types = ["blockBlob"]', c.prefix ? `prefix_match = [${hq(c.prefix)}]` : null]), '',
        B('actions', [base.length ? B('base_blob', base) : null, base.length ? '' : null, B('snapshot', [`delete_after_days_since_creation_greater_than = ${+c.versions}`]), '', B('version', [`delete_after_days_since_creation = ${+c.versions}`])])])]);
  },
});

S({
  id: 'storage_network_rules', name: 'Storage Network Rules', cat: 'storage', diff: 'Intermediate', file: 'storage_network_rules',
  res: ['azurerm_storage_account_network_rules'], deps: ['storage_account', 'subnet'], kw: 'storage firewall network rules service endpoint ip allow',
  azdoc: MS + 'storage/common/storage-network-security',
  desc: 'The storage firewall as its own resource: deny by default, allow the app subnet (service endpoint) and listed IPs.',
  use: 'Restrict the account to your VNet and office IPs when private endpoints are not an option.',
  fields: [{ k: 'ips', l: 'Allowed public IPs or ranges', t: 'list', d: '', h: 'IPv4 addresses or CIDRs, without /31 or /32.' }],
  assume: ['The app subnet gets a Microsoft.Storage service endpoint so it can be allowed by subnet ID.', 'When this resource exists, the storage account omits its inline network_rules block (both would fight).'],
  gen(c, x) {
    x.v('storage_allowed_ips', 'list(string)', 'Public IPs or CIDR ranges allowed through the storage firewall', csv(c.ips));
    x.o('storage_network_rules_id', 'azurerm_storage_account_network_rules.main.id', 'ID of the storage network rules');
    return R('resource "azurerm_storage_account_network_rules" "main"', [`storage_account_id = ${stAccount(x)}`, 'default_action = "Deny"', 'bypass = ["AzureServices", "Logging", "Metrics"]', 'ip_rules = var.storage_allowed_ips', `virtual_network_subnet_ids = [${x.subnetId('app')}]`]);
  },
});
