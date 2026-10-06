# Virtual Network
# An isolated private network in one region. Subnets, NICs and private endpoints all live inside it.
# Registry docs:
#   azurerm_virtual_network: https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/virtual_network
# Azure docs: https://learn.microsoft.com/azure/virtual-network/virtual-networks-overview

resource "azurerm_virtual_network" "main" {
  name                = "vnet-${local.name_prefix}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  address_space       = var.vnet_address_space
  dns_servers         = var.vnet_dns_servers

  tags = local.common_tags
}
