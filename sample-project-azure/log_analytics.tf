# Log Analytics Workspace
# The central store for logs and metrics, queried with KQL. Diagnostic settings, AKS, VM Insights and App Insights all send here.
# Registry docs:
#   azurerm_log_analytics_workspace: https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/log_analytics_workspace
# Azure docs: https://learn.microsoft.com/azure/azure-monitor/logs/log-analytics-workspace-overview

resource "azurerm_log_analytics_workspace" "main" {
  name                = "log-${local.name_prefix}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "PerGB2018"
  retention_in_days   = var.log_analytics_retention_days
  daily_quota_gb      = var.log_analytics_daily_quota_gb

  tags = local.common_tags
}
