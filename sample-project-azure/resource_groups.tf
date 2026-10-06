# Resource Group
# A logical container that holds related resources sharing one lifecycle, access policy and region of metadata.
# Registry docs:
#   azurerm_resource_group: https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/resource_group
# Azure docs: https://learn.microsoft.com/azure/azure-resource-manager/management/manage-resource-groups-portal

resource "azurerm_resource_group" "main" {
  name     = var.resource_group_name
  location = var.location

  tags = local.common_tags
}
