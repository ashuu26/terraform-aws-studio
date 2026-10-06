# Subnets
# App, data and private-endpoint subnets, plus the special and delegated subnets your other services need, created with for_each.
# Registry docs:
#   azurerm_subnet: https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/subnet
# Azure docs: https://learn.microsoft.com/azure/virtual-network/virtual-network-manage-subnet

resource "azurerm_subnet" "this" {
  for_each = var.subnets

  # Azure requires exact names for its special subnets; everything else is snet-<key>.
  name                            = startswith(each.key, "Azure") || each.key == "GatewaySubnet" ? each.key : "snet-${each.key}"
  resource_group_name             = azurerm_resource_group.main.name
  virtual_network_name            = azurerm_virtual_network.main.name
  address_prefixes                = each.value.address_prefixes
  default_outbound_access_enabled = contains(["AzureFirewallSubnet", "AzureBastionSubnet", "GatewaySubnet"], each.key) ? null : var.subnet_default_outbound_access

  dynamic "service_endpoint" {
    for_each = toset(each.value.service_endpoints)

    content {
      service = service_endpoint.value
    }
  }

  dynamic "delegation" {
    for_each = each.value.delegation == null ? [] : [each.value.delegation]

    content {
      name = "delegation"

      service_delegation {
        name    = delegation.value
        actions = local.subnet_delegation_actions[delegation.value]
      }
    }
  }
}
