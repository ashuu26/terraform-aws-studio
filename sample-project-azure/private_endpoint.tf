# Private Endpoint
# A private IP in the endpoints subnet for each selected PaaS service, registered in its private DNS zone.
# Registry docs:
#   azurerm_private_endpoint: https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/private_endpoint
# Azure docs: https://learn.microsoft.com/azure/private-link/private-endpoint-overview

resource "azurerm_private_endpoint" "storage_blob" {
  name                          = "pep-${local.name_prefix}-storage-blob"
  resource_group_name           = azurerm_resource_group.main.name
  location                      = azurerm_resource_group.main.location
  subnet_id                     = azurerm_subnet.this["endpoints"].id
  custom_network_interface_name = "nic-pep-${local.name_prefix}-storage-blob"

  private_service_connection {
    name                           = "psc-storage-blob"
    private_connection_resource_id = azurerm_storage_account.main.id
    subresource_names              = ["blob"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = [azurerm_private_dns_zone.this["blob"].id]
  }

  tags = local.common_tags
}

resource "azurerm_private_endpoint" "sql" {
  name                          = "pep-${local.name_prefix}-sql"
  resource_group_name           = azurerm_resource_group.main.name
  location                      = azurerm_resource_group.main.location
  subnet_id                     = azurerm_subnet.this["endpoints"].id
  custom_network_interface_name = "nic-pep-${local.name_prefix}-sql"

  private_service_connection {
    name                           = "psc-sql"
    private_connection_resource_id = azurerm_mssql_server.main.id
    subresource_names              = ["sqlServer"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = [azurerm_private_dns_zone.this["sql"].id]
  }

  tags = local.common_tags
}
