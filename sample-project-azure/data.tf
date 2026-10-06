# data.tf
# Shared data sources: read-only lookups used by several services.

data "azurerm_subscription" "current" {}

data "azurerm_client_config" "current" {}
