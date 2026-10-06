# Role-Based Access Control
# Role assignments for Microsoft Entra groups, plus an optional least-privilege custom role.
# Registry docs:
#   azurerm_role_definition: https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/role_definition
#   azurerm_role_assignment: https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/role_assignment
# Azure docs: https://learn.microsoft.com/azure/role-based-access-control/overview

resource "azurerm_role_definition" "vm_operator" {
  name        = "VM Operator (${local.name_prefix})"
  scope       = azurerm_resource_group.main.id
  description = "Read, start, restart and deallocate virtual machines."

  permissions {
    actions = [
      "Microsoft.Compute/virtualMachines/read",
      "Microsoft.Compute/virtualMachines/start/action",
      "Microsoft.Compute/virtualMachines/restart/action",
      "Microsoft.Compute/virtualMachines/deallocate/action",
      "Microsoft.Compute/virtualMachines/powerOff/action",
    ]
    not_actions = []
  }

  assignable_scopes = [azurerm_resource_group.main.id]
}

resource "azurerm_role_assignment" "this" {
  for_each = var.role_assignments

  scope                = azurerm_resource_group.main.id
  role_definition_name = each.value.role_definition_name
  principal_id         = each.value.principal_id
  principal_type       = each.value.principal_type
}

resource "azurerm_role_assignment" "vm_operator" {
  for_each = toset(var.vm_operator_principal_ids)

  scope              = azurerm_resource_group.main.id
  role_definition_id = azurerm_role_definition.vm_operator.role_definition_resource_id
  principal_id       = each.value
  principal_type     = "Group"
}
