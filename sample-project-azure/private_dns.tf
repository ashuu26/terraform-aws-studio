# Private DNS Zone
# The privatelink.* zones your private endpoints and private databases need, linked to the VNet (and hub).
# Registry docs:
#   azurerm_private_dns_zone: https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/private_dns_zone
#   azurerm_private_dns_zone_virtual_network_link: https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/private_dns_zone_virtual_network_link
# Azure docs: https://learn.microsoft.com/azure/dns/private-dns-overview

resource "azurerm_private_dns_zone" "this" {
  for_each = local.private_dns_zones

  name                = each.value
  resource_group_name = azurerm_resource_group.main.name

  tags = local.common_tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "spoke" {
  for_each = azurerm_private_dns_zone.this

  name                 = "link-${each.key}-spoke"
  private_dns_zone_id  = each.value.id
  virtual_network_id   = azurerm_virtual_network.main.id
  registration_enabled = false

  tags = local.common_tags
}
