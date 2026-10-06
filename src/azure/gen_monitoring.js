/* ==========================================================================
   gen_monitoring.js — Monitoring generator: Log Analytics, Application
   Insights, diagnostic settings (resources and Activity Log), action
   groups, metric/log/activity alerts, a workbook and VM Insights
   data collection.
   ========================================================================== */

// Resources whose diagnostic logs and metrics are sent to Log Analytics: [service id, key, target expression].
function diagTargets(x) {
  const t = [];
  const add = (id, key, expr) => { if (x.has(id)) t.push([key, expr]); };
  add('nsg', 'nsg', 'azurerm_network_security_group.main.id');
  add('firewall', 'firewall', 'azurerm_firewall.main.id');
  add('appgw', 'appgw', 'azurerm_application_gateway.main.id');
  add('lb', 'lb', 'azurerm_lb.main.id');
  add('frontdoor', 'frontdoor', 'azurerm_cdn_frontdoor_profile.main.id');
  add('bastion', 'bastion', 'azurerm_bastion_host.main.id');
  add('vpn_gw', 'vpn_gateway', 'azurerm_virtual_network_gateway.main.id');
  add('storage_account', 'storage_blob', '"${azurerm_storage_account.main.id}/blobServices/default"');
  add('sql_database', 'sql_database', 'azurerm_mssql_database.main.id');
  add('postgres', 'postgres', 'azurerm_postgresql_flexible_server.main.id');
  add('mysql', 'mysql', 'azurerm_mysql_flexible_server.main.id');
  add('cosmos', 'cosmos', 'azurerm_cosmosdb_account.main.id');
  add('aks', 'aks', 'azurerm_kubernetes_cluster.main.id');
  add('acr', 'acr', 'azurerm_container_registry.main.id');
  add('web_app', 'web_app', 'azurerm_linux_web_app.main.id');
  add('function_app', 'function_app', 'azurerm_function_app_flex_consumption.main.id');
  add('recovery_vault', 'recovery_vault', 'azurerm_recovery_services_vault.main.id');
  add('container_apps', 'container_apps', 'azurerm_container_app_environment.main.id');
  return t;
}

S({
  id: 'log_analytics', name: 'Log Analytics Workspace', cat: 'monitoring', diff: 'Beginner', file: 'log_analytics',
  res: ['azurerm_log_analytics_workspace', 'azurerm_resource_group'], deps: ['resource_group'], kw: 'log analytics workspace kql logs azure monitor law retention',
  azdoc: MS + 'azure-monitor/logs/log-analytics-workspace-overview',
  suggest: () => ['diagnostics'],
  desc: 'The central store for logs and metrics, queried with KQL. Diagnostic settings, AKS, VM Insights and App Insights all send here.',
  use: 'One place to search, alert on and retain operational logs.',
  fields: [
    { k: 'retention', l: 'Retention (days)', t: 'number', d: 30 },
    { k: 'quota', l: 'Daily cap (GB, -1 = none)', t: 'number', d: -1 },
  ],
  assume: ['In multi-subscription mode the workspace is created in the management subscription through the azurerm.management provider alias.'],
  gen(c, x) {
    const multi = x.multi();
    x.v('log_analytics_retention_days', 'number', 'Days logs are retained (30-730)', +c.retention, { condition: 'var.log_analytics_retention_days >= 30 && var.log_analytics_retention_days <= 730', error: 'Use 30 to 730 days.' });
    x.v('log_analytics_daily_quota_gb', 'number', 'Daily ingestion cap in GB; -1 for no cap', +c.quota);
    x.o('log_analytics_workspace_id', 'azurerm_log_analytics_workspace.main.id', 'Resource ID of the Log Analytics workspace');
    x.o('log_analytics_customer_id', 'azurerm_log_analytics_workspace.main.workspace_id', 'Workspace (customer) ID used by agents and queries');
    const parts = [];
    let rg = x.rg('monitoring');
    if (multi) {
      x.flags.management = true;
      parts.push('# Management subscription: central logging has its own resource group.', R('resource "azurerm_resource_group" "management"', ['provider = azurerm.management', '', 'name = "rg-${local.name_prefix}-management"', 'location = var.location', '', x.tags]));
      rg = { name: 'azurerm_resource_group.management.name', loc: 'azurerm_resource_group.management.location' };
    }
    parts.push(R('resource "azurerm_log_analytics_workspace" "main"', [multi ? 'provider = azurerm.management' : null, multi ? '' : null, 'name = ' + x.n('log'), 'resource_group_name = ' + rg.name, 'location = ' + rg.loc, 'sku = "PerGB2018"', 'retention_in_days = var.log_analytics_retention_days', 'daily_quota_gb = var.log_analytics_daily_quota_gb', '', x.tags]));
    return parts.join('\n\n');
  },
});

S({
  id: 'app_insights', name: 'Application Insights', cat: 'monitoring', diff: 'Intermediate', file: 'application_insights',
  res: ['azurerm_application_insights'], deps: ['log_analytics'], kw: 'application insights apm telemetry tracing requests opentelemetry',
  azdoc: MS + 'azure-monitor/app/app-insights-overview',
  desc: 'Workspace-based application performance monitoring. Web and function apps get its connection string automatically.',
  use: 'Request rates, failures, dependencies and distributed traces for your code.',
  fields: [{ k: 'type', l: 'Application type', t: 'select', o: ['web', 'other', 'java', 'Node.JS'], d: 'web' }],
  gen(c, x) {
    x.o('app_insights_connection_string', 'azurerm_application_insights.main.connection_string', 'Connection string for SDKs and OpenTelemetry exporters', true);
    return R('resource "azurerm_application_insights" "main"', ['name = ' + x.n('appi'), ...x.rgArgs('monitoring'), `workspace_id = ${x.lawOrVar()}`, `application_type = "${c.type}"`, '', x.tags]);
  },
});

S({
  id: 'diagnostics', name: 'Diagnostic Settings', cat: 'monitoring', diff: 'Intermediate', file: 'diagnostic_settings',
  res: ['azurerm_monitor_diagnostic_setting', 'data.azurerm_monitor_diagnostic_categories', 'data.azurerm_subscription'], deps: ['log_analytics'],
  kw: 'diagnostic settings logs metrics activity log audit categories',
  azdoc: MS + 'azure-monitor/essentials/diagnostic-settings',
  desc: 'Sends every selected resource\'s logs and metrics, plus the subscription Activity Log, to Log Analytics.',
  use: 'Resource logs are off by default in Azure; this turns them on consistently.',
  fields: [
    { k: 'resources', l: 'Resource logs and metrics for selected services', t: 'bool', d: true },
    { k: 'activity', l: 'Subscription Activity Log', t: 'bool', d: true },
  ],
  assume: ['Log categories are read from data.azurerm_monitor_diagnostic_categories, so each resource gets exactly the categories it supports (allLogs where available).'],
  gen(c, x) {
    const law = x.lawOrVar();
    const t = diagTargets(x);
    const parts = [];
    if (c.resources && t.length) {
      x.o('diagnostic_setting_ids', '{ for k, d in azurerm_monitor_diagnostic_setting.this : k => d.id }', 'Diagnostic setting ID per resource');
      x.local('diagnostic_targets', '{\n' + t.map(([k, v]) => `  ${k} = ${v}`).join('\n') + '\n}');
      parts.push('# Ask Azure which log categories and metrics each resource supports.',
        R('data "azurerm_monitor_diagnostic_categories" "this"', ['for_each = local.diagnostic_targets', '', 'resource_id = each.value']),
        R('resource "azurerm_monitor_diagnostic_setting" "this"', ['for_each = local.diagnostic_targets', '', 'name = "diag-to-law"', 'target_resource_id = each.value', `log_analytics_workspace_id = ${law}`, '',
          '# Prefer the allLogs category group; fall back to individual categories.',
          B('dynamic "enabled_log"', ['for_each = contains(data.azurerm_monitor_diagnostic_categories.this[each.key].log_category_groups, "allLogs") ? ["allLogs"] : []', '', B('content', ['category_group = enabled_log.value'])]), '',
          B('dynamic "enabled_log"', ['for_each = contains(data.azurerm_monitor_diagnostic_categories.this[each.key].log_category_groups, "allLogs") ? [] : data.azurerm_monitor_diagnostic_categories.this[each.key].log_category_types', '', B('content', ['category = enabled_log.value'])]), '',
          B('dynamic "enabled_metric"', ['for_each = data.azurerm_monitor_diagnostic_categories.this[each.key].metrics', '', B('content', ['category = enabled_metric.value'])])]));
    } else if (c.resources) x.note('No selected service supports resource diagnostic settings yet, so only the Activity Log is exported.');
    if (c.activity) {
      x.o('activity_log_diagnostic_setting_id', 'azurerm_monitor_diagnostic_setting.activity_log.id', 'ID of the Activity Log export');
      x.v('activity_log_categories', 'list(string)', 'Activity Log categories exported to Log Analytics', ['Administrative', 'Security', 'ServiceHealth', 'Alert', 'Recommendation', 'Policy', 'Autoscale', 'ResourceHealth']);
      parts.push('# The Activity Log is a subscription-level diagnostic setting.',
        R('resource "azurerm_monitor_diagnostic_setting" "activity_log"', ['name = "activity-to-law"', `target_resource_id = ${x.sub()}.id`, `log_analytics_workspace_id = ${law}`, '', B('dynamic "enabled_log"', ['for_each = toset(var.activity_log_categories)', '', B('content', ['category = enabled_log.value'])])]));
    }
    if (!parts.length) return '# Turn on resource logs or the Activity Log in the Diagnostic Settings panel.\n';
    return parts.join('\n\n');
  },
});

S({
  id: 'action_group', name: 'Action Group', cat: 'monitoring', diff: 'Beginner', file: 'action_group',
  res: ['azurerm_monitor_action_group'], deps: ['resource_group'], kw: 'action group notification email sms webhook alert routing',
  azdoc: MS + 'azure-monitor/alerts/action-groups',
  desc: 'Who gets notified when an alert or budget fires: email receivers using the common alert schema.',
  use: 'Route alerts to the on-call team.',
  fields: [{ k: 'emails', l: 'Email receivers (name=address)', t: 'list', d: 'oncall=oncall@example.com' }, { k: 'short', l: 'Short name (max 12)', t: 'text', d: 'ops' }],
  gen(c, x) {
    x.v('alert_email_receivers', 'map(string)', 'Alert email receivers: name => email address', kvList(c.emails));
    x.o('action_group_id', 'azurerm_monitor_action_group.main.id', 'ID of the action group');
    return R('resource "azurerm_monitor_action_group" "main"', ['name = ' + x.n('ag'), 'resource_group_name = ' + x.rg('monitoring').name, `short_name = ${hq(String(c.short).slice(0, 12))}`, '',
      B('dynamic "email_receiver"', ['for_each = var.alert_email_receivers', '', B('content', ['name = email_receiver.key', 'email_address = email_receiver.value', 'use_common_alert_schema = true'])]), '', x.tags]);
  },
});

// Metric alerts per selected service: [service, local name, namespace, metric, aggregation, operator, threshold, scope expression, description].
function metricAlerts(x) {
  const a = [], vm = x.vm(), ss = x.vmss();
  if (vm) a.push(['vm', 'vm_cpu', 'Microsoft.Compute/virtualMachines', 'Percentage CPU', 'Average', 'GreaterThan', 80, `[for vm in ${vm.res} : vm.id]`, 'VM CPU above 80%']);
  if (ss) a.push(['vmss', 'vmss_cpu', 'Microsoft.Compute/virtualMachineScaleSets', 'Percentage CPU', 'Average', 'GreaterThan', 80, `[${ss.res}.id]`, 'Scale set CPU above 80%']);
  if (x.has('aks')) a.push(['aks', 'aks_node_cpu', 'Microsoft.ContainerService/managedClusters', 'node_cpu_usage_percentage', 'Average', 'GreaterThan', 80, '[azurerm_kubernetes_cluster.main.id]', 'AKS node CPU above 80%']);
  if (x.has('sql_database')) a.push(['sql_database', 'sql_cpu', 'Microsoft.Sql/servers/databases', 'cpu_percent', 'Average', 'GreaterThan', 80, '[azurerm_mssql_database.main.id]', 'SQL database CPU above 80%']);
  if (x.has('postgres')) a.push(['postgres', 'pg_cpu', 'Microsoft.DBforPostgreSQL/flexibleServers', 'cpu_percent', 'Average', 'GreaterThan', 80, '[azurerm_postgresql_flexible_server.main.id]', 'PostgreSQL CPU above 80%']);
  if (x.has('mysql')) a.push(['mysql', 'mysql_cpu', 'Microsoft.DBforMySQL/flexibleServers', 'cpu_percent', 'Average', 'GreaterThan', 80, '[azurerm_mysql_flexible_server.main.id]', 'MySQL CPU above 80%']);
  if (x.has('cosmos')) a.push(['cosmos', 'cosmos_ru', 'Microsoft.DocumentDB/databaseAccounts', 'NormalizedRUConsumption', 'Maximum', 'GreaterThan', 90, '[azurerm_cosmosdb_account.main.id]', 'Cosmos DB normalized RU above 90%']);
  if (x.has('storage_account')) a.push(['storage_account', 'storage_availability', 'Microsoft.Storage/storageAccounts', 'Availability', 'Average', 'LessThan', 99, '[azurerm_storage_account.main.id]', 'Storage availability below 99%']);
  if (x.has('appgw')) a.push(['appgw', 'appgw_unhealthy', 'Microsoft.Network/applicationGateways', 'UnhealthyHostCount', 'Average', 'GreaterThan', 0, '[azurerm_application_gateway.main.id]', 'Application Gateway has unhealthy backends']);
  if (x.has('lb')) a.push(['lb', 'lb_health', 'Microsoft.Network/loadBalancers', 'DipAvailability', 'Average', 'LessThan', 90, '[azurerm_lb.main.id]', 'Load balancer health probe availability below 90%']);
  if (x.has('firewall')) a.push(['firewall', 'firewall_health', 'Microsoft.Network/azureFirewalls', 'FirewallHealth', 'Average', 'LessThan', 90, '[azurerm_firewall.main.id]', 'Azure Firewall health below 90%']);
  if (x.has('web_app')) a.push(['web_app', 'web_5xx', 'Microsoft.Web/sites', 'Http5xx', 'Total', 'GreaterThan', 10, '[azurerm_linux_web_app.main.id]', 'Web app returned more than 10 HTTP 5xx']);
  return a;
}

S({
  id: 'alerts', name: 'Alerts', cat: 'monitoring', diff: 'Intermediate', file: 'alerts',
  res: ['azurerm_monitor_metric_alert', 'azurerm_monitor_scheduled_query_rules_alert_v2', 'azurerm_monitor_activity_log_alert'], deps: ['action_group'],
  kw: 'alerts metric alert log query alert activity log service health severity',
  azdoc: MS + 'azure-monitor/alerts/alerts-overview',
  suggest: () => ['log_analytics'],
  desc: 'Metric alerts for each selected service, a log query alert (VM heartbeat or failed operations) and Service Health and delete alerts.',
  use: 'Find problems before users do, and know when Azure itself has an incident in your region.',
  fields: [
    { k: 'severity', l: 'Metric alert severity', t: 'select', o: ['0 - Critical', '1 - Error', '2 - Warning', '3 - Informational', '4 - Verbose'], d: '2 - Warning' },
    { k: 'metric', l: 'Metric alerts', t: 'bool', d: true },
    { k: 'log', l: 'Log query alert', t: 'bool', d: true },
    { k: 'activity', l: 'Service Health and resource group delete alerts', t: 'bool', d: true },
  ],
  gen(c, x) {
    const sev = +String(c.severity)[0];
    const ag = x.has('action_group') ? 'azurerm_monitor_action_group.main.id' : null;
    const rg = x.rg('monitoring');
    const parts = [];
    x.v('alert_severity', 'number', 'Severity for metric alerts (0 critical to 4 verbose)', sev, { condition: 'var.alert_severity >= 0 && var.alert_severity <= 4', error: 'Severity is 0 to 4.' });
    if (c.metric) for (const [, local, ns, metric, agg, op, thr, scopes, desc] of metricAlerts(x)) {
      const multi = local === 'vm_cpu';
      parts.push(R(`resource "azurerm_monitor_metric_alert" "${local}"`, ['name = ' + x.n('alert', local.replace(/_/g, '-')), 'resource_group_name = ' + rg.name, `scopes = ${scopes}`, `description = "${desc}"`, 'severity = var.alert_severity', 'frequency = "PT1M"', 'window_size = "PT5M"',
        multi ? '# One rule watches every VM; multi-resource alerts need the type and region.' : null, multi ? `target_resource_type = "${ns}"` : null, multi ? 'target_resource_location = var.location' : null, '',
        B('criteria', [`metric_namespace = "${ns}"`, `metric_name = "${metric}"`, `aggregation = "${agg}"`, `operator = "${op}"`, `threshold = ${thr}`]),
        ag ? '' : null, ag ? B('action', [`action_group_id = ${ag}`]) : null, '', x.tags]));
    }
    const mas = c.metric ? metricAlerts(x) : [];
    if (mas.length) x.o('metric_alert_ids', '{\n' + mas.map(a => `  ${a[1]} = azurerm_monitor_metric_alert.${a[1]}.id`).join('\n') + '\n}', 'IDs of the metric alerts');
    if (c.activity) x.o('service_health_alert_id', 'azurerm_monitor_activity_log_alert.service_health.id', 'ID of the Service Health alert');
    if (c.metric && !metricAlerts(x).length) x.note('No selected service has a metric alert template yet; select VMs, AKS, a database, storage or a gateway.');
    const law = x.law();
    if (c.log && law) {
      const vm = x.vm() && x.has('dcr');
      const q = vm ? 'Heartbeat\n| summarize LastHeartbeat = max(TimeGenerated) by Computer\n| where LastHeartbeat < ago(10m)' : 'AzureActivity\n| where ActivityStatusValue == "Failure"';
      parts.push(R('resource "azurerm_monitor_scheduled_query_rules_alert_v2" "log"', ['name = ' + x.n('alert', vm ? 'vm-heartbeat' : 'failed-operations'), ...x.rgArgs('monitoring'), `description = "${vm ? 'A VM stopped sending heartbeats for 10 minutes' : 'An Azure operation failed in the subscription'}"`, `scopes = [${law}]`, 'severity = 1', 'evaluation_frequency = "PT5M"', 'window_duration = "PT15M"', '',
        B('criteria', [`query = <<-KQL\n  ${q.split('\n').join('\n  ')}\nKQL`, 'time_aggregation_method = "Count"', 'operator = "GreaterThan"', 'threshold = 0', '', B('failing_periods', ['minimum_failing_periods_to_trigger_alert = 1', 'number_of_evaluation_periods = 1'])]),
        ag ? '' : null, ag ? B('action', [`action_groups = [${ag}]`]) : null, '', x.tags]));
    } else if (c.log) x.note('The log query alert needs the Log Analytics workspace selected.');
    if (c.activity) {
      const sub = x.sub();
      parts.push(R('resource "azurerm_monitor_activity_log_alert" "service_health"', ['name = ' + x.n('alert', 'service-health'), 'resource_group_name = ' + rg.name, 'location = "global"', `scopes = [${sub}.id]`, 'description = "Azure service incidents affecting this region"', '',
        B('criteria', ['category = "ServiceHealth"', '', B('service_health', ['events = ["Incident", "Maintenance"]', 'locations = [var.location]'])]), ag ? '' : null, ag ? B('action', [`action_group_id = ${ag}`]) : null, '', x.tags]));
      parts.push(R('resource "azurerm_monitor_activity_log_alert" "rg_delete"', ['name = ' + x.n('alert', 'rg-delete'), 'resource_group_name = ' + rg.name, 'location = "global"', `scopes = [${sub}.id]`, 'description = "A resource group was deleted"', '',
        B('criteria', ['category = "Administrative"', 'operation_name = "Microsoft.Resources/subscriptions/resourceGroups/delete"']), ag ? '' : null, ag ? B('action', [`action_group_id = ${ag}`]) : null, '', x.tags]));
    }
    if (!parts.length) return '# No alert type is turned on.\n';
    return parts.join('\n\n');
  },
});

S({
  id: 'workbook', name: 'Azure Monitor Workbook', cat: 'monitoring', diff: 'Intermediate', file: 'workbook',
  res: ['azurerm_application_insights_workbook'], deps: ['log_analytics'], kw: 'workbook dashboard visualization report kql',
  azdoc: MS + 'azure-monitor/visualize/workbooks-overview',
  desc: 'An operations workbook on the Log Analytics workspace, built with jsonencode() so it can reference Terraform values.',
  use: 'A shared, versioned dashboard for the team.',
  gen(c, x) {
    const law = x.lawOrVar();
    x.o('workbook_id', 'azurerm_application_insights_workbook.ops.id', 'ID of the operations workbook');
    const tiles = [
      '{\n      type    = 1\n      name    = "title"\n      content = { json = "## ${local.name_prefix} operations\\nActivity and health for this project." }\n    }',
      '{\n      type = 3\n      name = "operations"\n      content = {\n        version       = "KqlItem/1.0"\n        query         = "AzureActivity | summarize count() by ActivityStatusValue"\n        size          = 0\n        queryType     = 0\n        resourceType  = "microsoft.operationalinsights/workspaces"\n        visualization = "piechart"\n      }\n    }',
    ];
    if (x.has('dcr') && x.vm()) tiles.push('{\n      type = 3\n      name = "vm-cpu"\n      content = {\n        version       = "KqlItem/1.0"\n        query         = "InsightsMetrics | where Namespace == \\"Processor\\" and Name == \\"UtilizationPercentage\\" | summarize avg(Val) by bin(TimeGenerated, 5m), Computer"\n        size          = 0\n        queryType     = 0\n        resourceType  = "microsoft.operationalinsights/workspaces"\n        visualization = "timechart"\n      }\n    }');
    return R('resource "azurerm_application_insights_workbook" "ops"', ['# Workbook names must be GUIDs; uuidv5 gives a stable one.', 'name = uuidv5("url", "https://terraform-studio/${local.name_prefix}/ops-workbook")', ...x.rgArgs('monitoring'), 'display_name = "${local.name_prefix} operations"', `source_id = lower(${law})`, 'category = "workbook"', '',
      `data_json = jsonencode({\n  version = "Notebook/1.0"\n  items = [\n    ${tiles.join(',\n    ')},\n  ]\n  isLocked            = false\n  fallbackResourceIds = [${law}]\n})`, '', x.tags]);
  },
});

S({
  id: 'dcr', name: 'VM Insights (Data Collection Rule)', cat: 'monitoring', diff: 'Advanced', file: 'data_collection',
  res: ['azurerm_monitor_data_collection_rule', 'azurerm_monitor_data_collection_endpoint', 'azurerm_virtual_machine_extension', 'azurerm_monitor_data_collection_rule_association'],
  deps: ['log_analytics', 'vm'], kw: 'dcr data collection rule azure monitor agent ama vm insights performance syslog event',
  azdoc: MS + 'azure-monitor/vm/vminsights-overview',
  desc: 'The Azure Monitor Agent on each VM plus a data collection rule for VM Insights performance counters and Syslog or Windows events.',
  use: 'CPU, memory, disk and network metrics and OS logs from every VM in Log Analytics.',
  fields: [{ k: 'dce', l: 'Create a data collection endpoint', t: 'bool', d: false, h: 'Needed for private link (AMPLS) ingestion.' }],
  assume: ['The agent authenticates with the VM\'s user-assigned identity when Managed Identity is selected, otherwise with its system-assigned identity.'],
  gen(c, x) {
    const vm = x.vm();
    const win = vm && vm.win;
    const law = x.lawOrVar();
    const u = x.uai();
    const parts = [];
    if (c.dce) parts.push(R('resource "azurerm_monitor_data_collection_endpoint" "main"', ['name = ' + x.n('dce'), ...x.rgArgs('monitoring'), '', x.tags]));
    parts.push(R('resource "azurerm_monitor_data_collection_rule" "vm_insights"', ['name = ' + x.n('dcr', 'vminsights'), ...x.rgArgs('monitoring'), 'description = "VM Insights performance counters and OS logs"', c.dce ? 'data_collection_endpoint_id = azurerm_monitor_data_collection_endpoint.main.id' : null, '',
      B('destinations', [B('log_analytics', ['name = "law"', `workspace_resource_id = ${law}`])]), '',
      B('data_flow', ['streams = ["Microsoft-InsightsMetrics"]', 'destinations = ["law"]']), '',
      B('data_flow', [win ? 'streams = ["Microsoft-Event"]' : 'streams = ["Microsoft-Syslog"]', 'destinations = ["law"]']), '',
      B('data_sources', [B('performance_counter', ['name = "VMInsightsPerfCounters"', 'streams = ["Microsoft-InsightsMetrics"]', 'sampling_frequency_in_seconds = 60', 'counter_specifiers = ["\\\\VmInsights\\\\DetailedMetrics"]']), '',
        win ? B('windows_event_log', ['name = "eventlogs"', 'streams = ["Microsoft-Event"]', 'x_path_queries = ["System!*[System[(Level=1 or Level=2 or Level=3)]]", "Application!*[System[(Level=1 or Level=2 or Level=3)]]"]'])
          : B('syslog', ['name = "syslog"', 'streams = ["Microsoft-Syslog"]', 'facility_names = ["auth", "authpriv", "daemon", "kern", "syslog", "user"]', 'log_levels = ["Warning", "Error", "Critical", "Alert", "Emergency"]'])]), '', x.tags]));
    if (vm) {
      const settings = u ? `settings = jsonencode({\n  authentication = {\n    managedIdentity = {\n      identifier-name  = "mi_res_id"\n      identifier-value = ${u}.id\n    }\n  }\n})` : null;
      parts.push(R('resource "azurerm_virtual_machine_extension" "ama"', [`for_each = ${vm.res}`, '', `name = "${win ? 'AzureMonitorWindowsAgent' : 'AzureMonitorLinuxAgent'}"`, 'virtual_machine_id = each.value.id', 'publisher = "Microsoft.Azure.Monitor"', `type = "${win ? 'AzureMonitorWindowsAgent' : 'AzureMonitorLinuxAgent'}"`, 'type_handler_version = "1.0"', 'auto_upgrade_minor_version = true', 'automatic_upgrade_enabled = true', settings, '', x.tags]));
      parts.push(R('resource "azurerm_monitor_data_collection_rule_association" "vm"', [`for_each = ${vm.res}`, '', 'name = "dcra-${each.key}"', 'target_resource_id = each.value.id', 'data_collection_rule_id = azurerm_monitor_data_collection_rule.vm_insights.id']));
    } else x.note('Select Virtual Machines to install the agent and associate the rule.');
    x.o('data_collection_rule_id', 'azurerm_monitor_data_collection_rule.vm_insights.id', 'ID of the VM Insights data collection rule');
    return parts.join('\n\n');
  },
});
