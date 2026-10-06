/* ==========================================================================
   gen_database.js — Database generator: Azure SQL, PostgreSQL and MySQL
   flexible servers, Cosmos DB and Azure Managed Redis. No password is ever
   written: SQL and PostgreSQL use Microsoft Entra ID only, MySQL takes a
   write-only password from an ephemeral variable.
   ========================================================================== */

S({
  id: 'sql_server', name: 'Azure SQL Server', cat: 'database', diff: 'Intermediate', file: 'sql_server',
  res: ['azurerm_mssql_server', 'azurerm_mssql_firewall_rule', 'data.azurerm_client_config'], deps: ['resource_group'],
  kw: 'sql server mssql azure sql logical server entra authentication firewall tls',
  azdoc: MS + 'azure-sql/database/sql-database-paas-overview',
  suggest: (c, has) => ['sql_database', ...(has('vnet') ? ['private_endpoint'] : [])],
  desc: 'A logical SQL server with Microsoft Entra-only authentication (no SQL password), TLS 1.2 and a managed identity.',
  use: 'The host for Azure SQL databases and elastic pools.',
  fields: [
    { k: 'admin_login', l: 'Entra admin display name', t: 'text', d: 'sql-admins', h: 'The Entra group or user that administers the server.' },
    { k: 'allow_azure', l: 'Allow Azure services (0.0.0.0 rule)', t: 'bool', d: false, h: 'Lets any Azure service in any tenant try to connect. Prefer private endpoints.' },
    { k: 'ips', l: 'Allowed client IP ranges (name=start-end)', t: 'list', d: '' },
  ],
  assume: ['The Entra administrator defaults to the identity running Terraform (data.azurerm_client_config). Set sql_entra_admin_object_id to a group for real use.'],
  guide: ['Entra-only authentication removes SQL logins and passwords entirely.', 'Transparent Data Encryption is on by default with a service-managed key.'],
  gen(c, x) {
    const pe = x.has('private_endpoint');
    const cl = x.client();
    x.v('sql_entra_admin_login', 'string', 'Display name of the Entra administrator (group or user)', c.admin_login);
    x.v('sql_entra_admin_object_id', 'string', 'Object ID of the Entra administrator; null uses the identity running Terraform', null);
    const ranges = Object.fromEntries(Object.entries(kvList(c.ips)).map(([k, v]) => { const [a, b] = v.split('-').map(s => s.trim()); return [k, { start: a, end: b || a }]; }));
    const parts = [R('resource "azurerm_mssql_server" "main"', [
      'name = ' + x.uname('sql', 63), ...x.rgArgs('database'), 'version = "12.0"', 'minimum_tls_version = "1.2"', `public_network_access_enabled = ${!pe}`, '',
      '# Entra ID only: no administrator_login or password exists on this server.',
      B('azuread_administrator', ['login_username = var.sql_entra_admin_login', `object_id = coalesce(var.sql_entra_admin_object_id, ${cl}.object_id)`, `tenant_id = ${cl}.tenant_id`, 'azuread_authentication_only = true']), '',
      B('identity', ['type = "SystemAssigned"']), '', x.tags,
    ])];
    if (!pe && c.allow_azure) parts.push(R('resource "azurerm_mssql_firewall_rule" "azure_services"', ['name = "AllowAllWindowsAzureIps"', 'server_id = azurerm_mssql_server.main.id', 'start_ip_address = "0.0.0.0"', 'end_ip_address = "0.0.0.0"']));
    if (!pe) {
      x.v('sql_allowed_ip_ranges', 'map(object({ start = string, end = string }))', 'Client IP ranges allowed through the SQL firewall', ranges);
      parts.push(R('resource "azurerm_mssql_firewall_rule" "clients"', ['for_each = var.sql_allowed_ip_ranges', '', 'name = each.key', 'server_id = azurerm_mssql_server.main.id', 'start_ip_address = each.value.start', 'end_ip_address = each.value.end']));
    }
    x.o('sql_server_fqdn', 'azurerm_mssql_server.main.fully_qualified_domain_name', 'FQDN of the SQL server');
    return parts.join('\n\n');
  },
});

S({
  id: 'sql_database', name: 'Azure SQL Database', cat: 'database', diff: 'Intermediate', file: 'sql_database',
  res: ['azurerm_mssql_database'], deps: ['sql_server'], kw: 'sql database serverless vcore dtu backup retention ltr',
  azdoc: MS + 'azure-sql/database/sql-database-paas-overview',
  suggest: (c, has) => has('vnet') ? ['private_endpoint', 'private_dns', 'diagnostics'] : ['diagnostics'],
  desc: 'A database on the server: serverless or provisioned, with short-term PITR and long-term weekly, monthly and yearly backups.',
  use: 'A managed relational database for applications, with backups handled by Azure.',
  fields: [
    { k: 'name', l: 'Database name', t: 'text', d: 'appdb' },
    { k: 'sku', l: 'SKU', t: 'select', o: ['GP_S_Gen5_2', 'GP_Gen5_2', 'S0', 'Basic', 'HS_Gen5_2'], d: 'GP_S_Gen5_2', h: 'GP_S is General Purpose serverless: it auto-pauses when idle.' },
    { k: 'max_size', l: 'Max size (GB)', t: 'number', d: 32 },
    { k: 'backup_redundancy', l: 'Backup storage redundancy', t: 'select', o: ['Geo', 'Zone', 'Local'], d: 'Geo' },
    { k: 'pitr_days', l: 'Point-in-time restore (days)', t: 'number', d: 7 },
    { k: 'ltr', l: 'Long-term retention', t: 'bool', d: true },
  ],
  gen(c, x) {
    const pool = x.has('sql_elastic_pool');
    const serverless = !pool && /_S_/.test(c.sku);
    const server = x.has('sql_server') ? 'azurerm_mssql_server.main.id' : x.v('sql_server_id', 'string', 'ID of an existing SQL server');
    x.v('sql_database_name', 'string', 'Name of the database', c.name);
    if (!pool) x.v('sql_database_sku', 'string', 'Database SKU', c.sku);
    x.o('sql_database_id', 'azurerm_mssql_database.main.id', 'ID of the SQL database');
    return R('resource "azurerm_mssql_database" "main"', [
      'name = var.sql_database_name', `server_id = ${server}`, pool ? 'elastic_pool_id = azurerm_mssql_elasticpool.main.id' : null, pool ? 'sku_name = "ElasticPool"' : 'sku_name = var.sql_database_sku',
      `max_size_gb = ${+c.max_size}`, 'collation = "SQL_Latin1_General_CP1_CI_AS"', `storage_account_type = "${c.backup_redundancy}"`, 'transparent_data_encryption_enabled = true',
      serverless ? 'auto_pause_delay_in_minutes = 60' : null, serverless ? 'min_capacity = 0.5' : null, '',
      B('short_term_retention_policy', [`retention_days = ${+c.pitr_days}`, 'backup_interval_in_hours = 12']), c.ltr ? '' : null,
      c.ltr ? B('long_term_retention_policy', ['weekly_retention = "P4W"', 'monthly_retention = "P12M"', 'yearly_retention = "P5Y"', 'week_of_year = 1']) : null, '', x.tags,
    ]);
  },
});

S({
  id: 'sql_elastic_pool', name: 'SQL Elastic Pool', cat: 'database', diff: 'Advanced', file: 'sql_elastic_pool',
  res: ['azurerm_mssql_elasticpool'], deps: ['sql_server', 'sql_database'], kw: 'elastic pool shared resources multi tenant saas',
  azdoc: MS + 'azure-sql/database/elastic-pool-overview',
  desc: 'Shared compute for many databases with unpredictable, staggered usage.',
  use: 'SaaS apps with a database per tenant.',
  fields: [{ k: 'size', l: 'Pool size', t: 'select', o: ['GeneralPurpose Gen5 2 vCores', 'GeneralPurpose Gen5 4 vCores', 'Standard 50 eDTU'], d: 'GeneralPurpose Gen5 2 vCores' }],
  gen(c, x) {
    const dtu = /eDTU/.test(c.size);
    const cap = dtu ? 50 : +c.size.match(/(\d+) vCores/)[1];
    const sku = dtu ? ['name = "StandardPool"', 'tier = "Standard"', 'capacity = 50'] : ['name = "GP_Gen5"', 'tier = "GeneralPurpose"', 'family = "Gen5"', `capacity = ${cap}`];
    const server = x.has('sql_server') ? 'azurerm_mssql_server.main.name' : x.v('sql_server_name', 'string', 'Name of an existing SQL server in the same resource group');
    x.o('sql_elastic_pool_id', 'azurerm_mssql_elasticpool.main.id', 'ID of the elastic pool');
    return R('resource "azurerm_mssql_elasticpool" "main"', ['name = ' + x.n('sqlep'), ...x.rgArgs('database'), `server_name = ${server}`, dtu ? 'max_size_gb = 50' : 'max_size_gb = 32', '',
      B('sku', sku), '', B('per_database_settings', ['min_capacity = 0', `max_capacity = ${cap}`]), '', x.tags]);
  },
});

S({
  id: 'postgres', name: 'PostgreSQL Flexible Server', cat: 'database', diff: 'Intermediate', file: 'postgresql',
  res: ['azurerm_postgresql_flexible_server', 'azurerm_postgresql_flexible_server_database', 'azurerm_postgresql_flexible_server_active_directory_administrator', 'azurerm_postgresql_flexible_server_firewall_rule'],
  deps: ['resource_group'], kw: 'postgresql postgres flexible server database open source entra ha zone redundant',
  azdoc: MS + 'postgresql/flexible-server/overview',
  suggest: c => c.network === 'Private (VNet integration)' ? ['vnet', 'subnet', 'private_dns'] : [],
  desc: 'PostgreSQL Flexible Server with Entra-only authentication, private VNet integration, configurable backups and zone-redundant HA.',
  use: 'Managed open-source relational database for applications.',
  fields: [
    { k: 'version', l: 'PostgreSQL version', t: 'select', o: ['17', '16', '15'], d: '16' },
    { k: 'sku', l: 'Compute SKU', t: 'select', o: ['B_Standard_B1ms', 'B_Standard_B2s', 'GP_Standard_D2ds_v5', 'GP_Standard_D4ds_v5', 'MO_Standard_E2ds_v5'], d: 'GP_Standard_D2ds_v5' },
    { k: 'storage', l: 'Storage (MB)', t: 'select', o: ['32768', '65536', '131072', '262144'], d: '32768' },
    { k: 'network', l: 'Networking', t: 'select', o: ['Private (VNet integration)', 'Public (firewall rules)'], d: 'Private (VNet integration)' },
    { k: 'ha', l: 'Zone-redundant high availability', t: 'bool', d: false },
    { k: 'backup_days', l: 'Backup retention (days)', t: 'number', d: 14 },
    { k: 'geo_backup', l: 'Geo-redundant backups', t: 'bool', d: false, h: 'Set at creation only.' },
    { k: 'admin_name', l: 'Entra admin principal name', t: 'text', d: 'pg-admins' },
    { k: 'admin_type', l: 'Entra admin principal type', t: 'select', o: ['Group', 'User', 'ServicePrincipal'], d: 'Group' },
  ],
  assume: ['Password authentication is disabled: only Microsoft Entra ID logins work.', 'The private DNS zone ends in .private.postgres.database.azure.com, as Azure requires for VNet-integrated servers.'],
  gen(c, x) {
    const priv = c.network === 'Private (VNet integration)';
    const cl = x.client();
    x.v('pg_sku_name', 'string', 'PostgreSQL compute SKU', c.sku);
    x.v('pg_backup_retention_days', 'number', 'Backup retention, 7-35 days', +c.backup_days, { condition: 'var.pg_backup_retention_days >= 7 && var.pg_backup_retention_days <= 35', error: 'Use 7 to 35 days.' });
    x.v('pg_entra_admin_name', 'string', 'Display name of the Entra administrator', c.admin_name);
    x.v('pg_entra_admin_object_id', 'string', 'Object ID of the Entra administrator; null uses the identity running Terraform', null);
    const parts = [R('resource "azurerm_postgresql_flexible_server" "main"', [
      'name = ' + x.uname('psql', 63), ...x.rgArgs('database'), `version = "${c.version}"`, 'sku_name = var.pg_sku_name', `storage_mb = ${+c.storage}`, 'auto_grow_enabled = true', 'zone = "1"', '',
      'backup_retention_days = var.pg_backup_retention_days', `geo_redundant_backup_enabled = ${!!c.geo_backup}`, '',
      priv ? 'delegated_subnet_id = ' + x.subnetId('postgres') : null, priv ? 'private_dns_zone_id = ' + x.dnsZoneId('postgres', 'PostgreSQL') : null, `public_network_access_enabled = ${!priv}`, '',
      '# Microsoft Entra ID only: no administrator_login or password.', B('authentication', ['active_directory_auth_enabled = true', 'password_auth_enabled = false', `tenant_id = ${cl}.tenant_id`]), '',
      c.ha ? B('high_availability', ['mode = "ZoneRedundant"', 'standby_availability_zone = "2"']) : null, c.ha ? '' : null,
      B('maintenance_window', ['day_of_week = 0', 'start_hour = 2', 'start_minute = 0']), '', x.tags, '',
      '# After a failover Azure swaps the zones; ignoring them stops Terraform from failing back.', B('lifecycle', ['ignore_changes = [zone, high_availability[0].standby_availability_zone]']),
      priv && x.has('private_dns') ? '' : null, priv && x.has('private_dns') ? '# The zone must be linked to the VNet before the server is created.' : null, priv && x.has('private_dns') ? 'depends_on = [azurerm_private_dns_zone_virtual_network_link.spoke]' : null,
    ])];
    parts.push(R('resource "azurerm_postgresql_flexible_server_active_directory_administrator" "main"', ['server_name = azurerm_postgresql_flexible_server.main.name', 'resource_group_name = ' + x.rg('database').name, `tenant_id = ${cl}.tenant_id`, `object_id = coalesce(var.pg_entra_admin_object_id, ${cl}.object_id)`, 'principal_name = var.pg_entra_admin_name', `principal_type = "${c.admin_type}"`]));
    parts.push(R('resource "azurerm_postgresql_flexible_server_database" "app"', ['name = "appdb"', 'server_id = azurerm_postgresql_flexible_server.main.id', 'charset = "UTF8"', 'collation = "en_US.utf8"']));
    if (!priv) {
      x.v('pg_allowed_ip_ranges', 'map(object({ start = string, end = string }))', 'Client IP ranges allowed through the PostgreSQL firewall', {});
      parts.push(R('resource "azurerm_postgresql_flexible_server_firewall_rule" "clients"', ['for_each = var.pg_allowed_ip_ranges', '', 'name = each.key', 'server_id = azurerm_postgresql_flexible_server.main.id', 'start_ip_address = each.value.start', 'end_ip_address = each.value.end']));
    }
    x.o('pg_server_fqdn', 'azurerm_postgresql_flexible_server.main.fqdn', 'FQDN of the PostgreSQL server');
    return parts.join('\n\n');
  },
});

S({
  id: 'mysql', name: 'MySQL Flexible Server', cat: 'database', diff: 'Intermediate', file: 'mysql',
  res: ['azurerm_mysql_flexible_server', 'azurerm_mysql_flexible_database'], deps: ['resource_group'],
  kw: 'mysql flexible server database open source write-only password ephemeral',
  azdoc: MS + 'mysql/flexible-server/overview',
  suggest: c => c.network === 'Private (VNet integration)' ? ['vnet', 'subnet', 'private_dns'] : [],
  desc: 'MySQL Flexible Server with private VNet integration, backups and HA. The admin password is write-only: never in code or state.',
  use: 'Managed MySQL for applications such as WordPress or Laravel.',
  fields: [
    { k: 'sku', l: 'Compute SKU', t: 'select', o: ['B_Standard_B1ms', 'B_Standard_B2s', 'GP_Standard_D2ds_v4', 'GP_Standard_D4ds_v4'], d: 'GP_Standard_D2ds_v4' },
    { k: 'storage', l: 'Storage (GB)', t: 'number', d: 32 },
    { k: 'network', l: 'Networking', t: 'select', o: ['Private (VNet integration)', 'Public (firewall rules)'], d: 'Private (VNet integration)' },
    { k: 'ha', l: 'Zone-redundant high availability', t: 'bool', d: false },
    { k: 'backup_days', l: 'Backup retention (days)', t: 'number', d: 14 },
  ],
  assume: ['administrator_password_wo is a write-only argument (Terraform 1.11+): the value comes from an ephemeral variable and is never stored in state. Bump mysql_admin_password_version to rotate it.'],
  guide: ['Add a Microsoft Entra administrator after creation so applications can use tokens instead of the password.'],
  gen(c, x) {
    const priv = c.network === 'Private (VNet integration)';
    x.v('mysql_admin_login', 'string', 'MySQL administrator login', 'mysqladmin');
    x.v('mysql_admin_password', 'string', 'MySQL administrator password. Ephemeral and write-only: set TF_VAR_mysql_admin_password at plan and apply time.', undefined, { condition: 'length(var.mysql_admin_password) >= 12', error: 'Use at least 12 characters.' }, { sensitive: true, ephemeral: true });
    x.v('mysql_admin_password_version', 'number', 'Increment to rotate the write-only administrator password', 1);
    x.v('mysql_backup_retention_days', 'number', 'Backup retention, 1-35 days', +c.backup_days);
    x.o('mysql_server_fqdn', 'azurerm_mysql_flexible_server.main.fqdn', 'FQDN of the MySQL server');
    return [
      R('resource "azurerm_mysql_flexible_server" "main"', [
        'name = ' + x.uname('mysql', 63), ...x.rgArgs('database'), 'version = "8.0.21"', `sku_name = "${c.sku}"`, 'zone = "1"', '',
        'administrator_login = var.mysql_admin_login', '# Write-only: sent to Azure, never saved in the plan or state.', 'administrator_password_wo = var.mysql_admin_password', 'administrator_password_wo_version = var.mysql_admin_password_version', '',
        'backup_retention_days = var.mysql_backup_retention_days', 'geo_redundant_backup_enabled = false', '',
        priv ? 'delegated_subnet_id = ' + x.subnetId('mysql') : null, priv ? 'private_dns_zone_id = ' + x.dnsZoneId('mysql', 'MySQL') : null, `public_network_access = "${priv ? 'Disabled' : 'Enabled'}"`, '',
        B('storage', [`size_gb = ${+c.storage}`, 'auto_grow_enabled = true', 'io_scaling_enabled = true']), '',
        c.ha ? B('high_availability', ['mode = "ZoneRedundant"', 'standby_availability_zone = "2"']) : null, c.ha ? '' : null, x.tags, '',
        B('lifecycle', ['ignore_changes = [zone, high_availability[0].standby_availability_zone]']),
        priv && x.has('private_dns') ? 'depends_on = [azurerm_private_dns_zone_virtual_network_link.spoke]' : null,
      ]),
      R('resource "azurerm_mysql_flexible_database" "app"', ['name = "appdb"', 'resource_group_name = ' + x.rg('database').name, 'server_name = azurerm_mysql_flexible_server.main.name', 'charset = "utf8mb4"', 'collation = "utf8mb4_unicode_ci"']),
    ].join('\n\n');
  },
});

S({
  id: 'cosmos', name: 'Azure Cosmos DB', cat: 'database', diff: 'Intermediate', file: 'cosmosdb',
  res: ['azurerm_cosmosdb_account', 'azurerm_cosmosdb_sql_database', 'azurerm_cosmosdb_sql_container', 'azurerm_cosmosdb_mongo_database', 'azurerm_cosmosdb_mongo_collection', 'azurerm_cosmosdb_sql_role_assignment'],
  deps: ['resource_group'], kw: 'cosmos db nosql document mongodb global distribution consistency serverless',
  azdoc: MS + 'cosmos-db/introduction',
  suggest: (c, has) => has('vnet') ? ['private_endpoint'] : [],
  desc: 'A Cosmos DB account (NoSQL or MongoDB API) with a database and container, chosen consistency, continuous backup and optional second region.',
  use: 'Globally distributed, low-latency NoSQL data for web, mobile and IoT apps.',
  fields: [
    { k: 'api', l: 'API', t: 'select', o: ['NoSQL', 'MongoDB'], d: 'NoSQL' },
    { k: 'consistency', l: 'Consistency level', t: 'select', o: ['Session', 'Strong', 'BoundedStaleness', 'ConsistentPrefix', 'Eventual'], d: 'Session' },
    { k: 'serverless', l: 'Serverless capacity', t: 'bool', d: false },
    { k: 'free_tier', l: 'Free tier (one per subscription)', t: 'bool', d: false },
    { k: 'secondary', l: 'Replicate to the paired region', t: 'bool', d: false },
    { k: 'backup', l: 'Backup', t: 'select', o: ['Continuous7Days', 'Continuous30Days', 'Periodic'], d: 'Continuous7Days' },
    { k: 'partition', l: 'Partition key path', t: 'text', d: '/tenantId' },
  ],
  assume: ['NoSQL accounts disable key-based auth (local_authentication_enabled = false); apps use Entra ID data-plane roles. MongoDB accounts keep keys because the Mongo wire protocol needs them.'],
  gen(c, x) {
    const mongo = c.api === 'MongoDB';
    const pe = x.has('private_endpoint');
    const pair = REGION_PAIR[x.g.region] || 'eastasia';
    const rg = x.rg('database');
    const bounded = c.consistency === 'BoundedStaleness';
    x.v('cosmos_autoscale_max_throughput', 'number', 'Autoscale maximum RU/s for the database (ignored when serverless)', 1000);
    const parts = [R('resource "azurerm_cosmosdb_account" "main"', [
      'name = ' + x.uname('cosmos', 44), ...x.rgArgs('database'), 'offer_type = "Standard"', `kind = "${mongo ? 'MongoDB' : 'GlobalDocumentDB'}"`, mongo ? 'mongo_server_version = "7.0"' : null, '',
      `free_tier_enabled = ${!!c.free_tier}`, `automatic_failover_enabled = ${!!c.secondary}`, `local_authentication_enabled = ${mongo}`, `public_network_access_enabled = ${!pe}`, 'minimal_tls_version = "Tls12"', '',
      B('consistency_policy', [`consistency_level = "${c.consistency}"`, bounded ? 'max_interval_in_seconds = 300' : null, bounded ? 'max_staleness_prefix = 100000' : null]), '',
      B('geo_location', ['location = ' + rg.loc, 'failover_priority = 0', 'zone_redundant = false']), c.secondary ? '' : null,
      c.secondary ? B('geo_location', [`location = "${pair}"`, 'failover_priority = 1']) : null, '',
      c.serverless ? B('capabilities', ['name = "EnableServerless"']) : null, c.serverless ? '' : null,
      mongo ? B('capabilities', ['name = "EnableMongo"']) : null, mongo ? '' : null,
      c.backup === 'Periodic' ? B('backup', ['type = "Periodic"', 'interval_in_minutes = 240', 'retention_in_hours = 8', 'storage_redundancy = "Geo"']) : B('backup', ['type = "Continuous"', `tier = "${c.backup}"`]), '', x.tags,
    ])];
    const thr = c.serverless ? null : B('autoscale_settings', ['max_throughput = var.cosmos_autoscale_max_throughput']);
    if (mongo) {
      parts.push(R('resource "azurerm_cosmosdb_mongo_database" "main"', ['name = "appdb"', 'resource_group_name = ' + rg.name, 'account_name = azurerm_cosmosdb_account.main.name', thr ? '' : null, thr]));
      parts.push(R('resource "azurerm_cosmosdb_mongo_collection" "items"', ['name = "items"', 'resource_group_name = ' + rg.name, 'account_name = azurerm_cosmosdb_account.main.name', 'database_name = azurerm_cosmosdb_mongo_database.main.name', `shard_key = ${hq(c.partition.replace(/^\//, ''))}`, '', B('index', ['keys = ["_id"]', 'unique = true'])]));
    } else {
      parts.push(R('resource "azurerm_cosmosdb_sql_database" "main"', ['name = "appdb"', 'resource_group_name = ' + rg.name, 'account_name = azurerm_cosmosdb_account.main.name', thr ? '' : null, thr]));
      parts.push(R('resource "azurerm_cosmosdb_sql_container" "items"', ['name = "items"', 'resource_group_name = ' + rg.name, 'account_name = azurerm_cosmosdb_account.main.name', 'database_name = azurerm_cosmosdb_sql_database.main.name', `partition_key_paths = [${hq(c.partition)}]`, 'partition_key_version = 2', '',
        B('indexing_policy', ['indexing_mode = "consistent"', '', B('included_path', ['path = "/*"'])])]));
      if (x.uai()) parts.push('# Data-plane access with Entra ID: the built-in "Cosmos DB Built-in Data Contributor" role.', R('resource "azurerm_cosmosdb_sql_role_assignment" "identity"', ['resource_group_name = ' + rg.name, 'account_name = azurerm_cosmosdb_account.main.name', 'role_definition_id = "${azurerm_cosmosdb_account.main.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002"', `principal_id = ${x.uai()}.principal_id`, 'scope = azurerm_cosmosdb_account.main.id']));
    }
    x.o('cosmos_endpoint', 'azurerm_cosmosdb_account.main.endpoint', 'Cosmos DB account endpoint');
    return parts.join('\n\n');
  },
});

S({
  id: 'redis', name: 'Azure Managed Redis', cat: 'database', diff: 'Intermediate', file: 'redis',
  res: ['azurerm_managed_redis'], deps: ['resource_group'], kw: 'redis cache in-memory session managed redis',
  azdoc: MS + 'redis/overview',
  suggest: (c, has) => has('vnet') ? ['private_endpoint'] : [],
  desc: 'Azure Managed Redis (the successor to Azure Cache for Redis) with Entra ID auth, TLS-only and high availability.',
  use: 'Caching, session state and fast counters in front of a database.',
  fields: [
    { k: 'sku', l: 'SKU', t: 'select', o: ['Balanced_B0', 'Balanced_B1', 'Balanced_B3', 'MemoryOptimized_M10', 'ComputeOptimized_X3'], d: 'Balanced_B1' },
    { k: 'ha', l: 'High availability', t: 'bool', d: true },
  ],
  assume: ['Access keys are disabled; clients authenticate with Microsoft Entra ID.', 'azurerm_redis_cache (Basic, Standard, Premium) is still in the provider, but Microsoft recommends Azure Managed Redis for new deployments.'],
  gen(c, x) {
    const pe = x.has('private_endpoint');
    x.o('redis_hostname', 'azurerm_managed_redis.main.hostname', 'Host name of the Redis instance');
    return R('resource "azurerm_managed_redis" "main"', ['name = ' + x.uname('redis', 60), ...x.rgArgs('database'), `sku_name = "${c.sku}"`, `high_availability_enabled = ${!!c.ha}`, `public_network_access = "${pe ? 'Disabled' : 'Enabled'}"`, '',
      B('default_database', ['access_keys_authentication_enabled = false', 'client_protocol = "Encrypted"', 'clustering_policy = "OSSCluster"', 'eviction_policy = "VolatileLRU"']), '', x.tags]);
  },
});
