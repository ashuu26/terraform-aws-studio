# Azure SQL Server
# A logical SQL server with Microsoft Entra-only authentication (no SQL password), TLS 1.2 and a managed identity.
# Registry docs:
#   azurerm_mssql_server: https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/mssql_server
# Azure docs: https://learn.microsoft.com/azure/azure-sql/database/sql-database-paas-overview

resource "azurerm_mssql_server" "main" {
  name                          = substr("sql-${local.name_prefix}-${local.unique_suffix}", 0, 63)
  resource_group_name           = azurerm_resource_group.main.name
  location                      = azurerm_resource_group.main.location
  version                       = "12.0"
  minimum_tls_version           = "1.2"
  public_network_access_enabled = false

  # Entra ID only: no administrator_login or password exists on this server.
  azuread_administrator {
    login_username              = var.sql_entra_admin_login
    object_id                   = coalesce(var.sql_entra_admin_object_id, data.azurerm_client_config.current.object_id)
    tenant_id                   = data.azurerm_client_config.current.tenant_id
    azuread_authentication_only = true
  }

  identity {
    type = "SystemAssigned"
  }

  tags = local.common_tags
}
