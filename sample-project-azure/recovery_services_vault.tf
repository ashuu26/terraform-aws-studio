# Recovery Services Vault
# The vault that stores VM and Azure Files recovery points, with storage redundancy, immutability and built-in job failure alerts.
# Registry docs:
#   azurerm_recovery_services_vault: https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/recovery_services_vault
# Azure docs: https://learn.microsoft.com/azure/backup/backup-azure-recovery-services-vault-overview

resource "azurerm_recovery_services_vault" "main" {
  name                         = "rsv-${local.name_prefix}"
  resource_group_name          = azurerm_resource_group.main.name
  location                     = azurerm_resource_group.main.location
  sku                          = "Standard"
  storage_mode_type            = var.recovery_vault_storage_mode
  cross_region_restore_enabled = false
  immutability                 = "Unlocked"

  monitoring {
    alerts_for_all_job_failures_enabled            = true
    alerts_for_critical_operation_failures_enabled = true
  }

  tags = local.common_tags
}
