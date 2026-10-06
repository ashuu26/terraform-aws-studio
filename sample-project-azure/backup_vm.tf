# VM Backup
# An Enhanced (V2) VM backup policy with daily, weekly, monthly and yearly retention, protecting every selected VM.
# Registry docs:
#   azurerm_backup_policy_vm: https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/backup_policy_vm
#   azurerm_backup_protected_vm: https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/backup_protected_vm
# Azure docs: https://learn.microsoft.com/azure/backup/backup-azure-vms-introduction

resource "azurerm_backup_policy_vm" "main" {
  name                           = "bkpol-vm-${local.name_prefix}-daily-30days"
  resource_group_name            = azurerm_recovery_services_vault.main.resource_group_name
  recovery_vault_name            = azurerm_recovery_services_vault.main.name
  policy_type                    = "V2"
  timezone                       = "UTC"
  instant_restore_retention_days = 7

  backup {
    frequency = "Daily"
    time      = "23:00"
  }

  retention_daily {
    count = 30
  }

  retention_weekly {
    count    = 12
    weekdays = ["Sunday"]
  }

  retention_monthly {
    count    = 12
    weekdays = ["Sunday"]
    weeks    = ["First"]
  }
}

resource "azurerm_backup_protected_vm" "this" {
  for_each = { for k, vm in azurerm_linux_virtual_machine.main : k => vm.id }

  resource_group_name = azurerm_recovery_services_vault.main.resource_group_name
  recovery_vault_name = azurerm_recovery_services_vault.main.name
  source_vm_id        = each.value
  backup_policy_id    = azurerm_backup_policy_vm.main.id
}
