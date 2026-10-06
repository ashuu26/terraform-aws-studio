# Network Security Group
# A stateful allow/deny rule set attached to workload subnets, with rules as separate resources.
# Registry docs:
#   azurerm_network_security_group: https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/network_security_group
#   azurerm_network_security_rule: https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/network_security_rule
#   azurerm_subnet_network_security_group_association: https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/subnet_network_security_group_association
# Azure docs: https://learn.microsoft.com/azure/virtual-network/network-security-groups-overview

resource "azurerm_network_security_group" "main" {
  name                = "nsg-${local.name_prefix}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location

  tags = local.common_tags
}

# Rules as separate resources: easier to review in a plan than inline security_rule blocks.

resource "azurerm_network_security_rule" "this" {
  for_each = local.nsg_rules

  name                        = each.key
  resource_group_name         = azurerm_resource_group.main.name
  network_security_group_name = azurerm_network_security_group.main.name
  priority                    = each.value.priority
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_ranges     = each.value.ports
  source_address_prefix       = each.value.source
  destination_address_prefix  = "VirtualNetwork"
}

resource "azurerm_subnet_network_security_group_association" "this" {
  for_each = { for k in ["app", "data"] : k => azurerm_subnet.this[k].id }

  subnet_id                 = each.value
  network_security_group_id = azurerm_network_security_group.main.id
}
