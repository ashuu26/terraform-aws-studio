# Storage Account
# A StorageV2 account: HTTPS only, TLS 1.2, no anonymous access, Entra ID by default, blob versioning, soft delete and point-in-time restore.
# Registry docs:
#   azurerm_storage_account: https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/storage_account
# Azure docs: https://learn.microsoft.com/azure/storage/common/storage-account-overview

resource "azurerm_storage_account" "main" {
  name                     = local.storage_account_name
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_kind             = "StorageV2"
  account_tier             = "Standard"
  account_replication_type = var.storage_replication_type
  access_tier              = "Hot"

  https_traffic_only_enabled       = true
  min_tls_version                  = "TLS1_2"
  allow_nested_items_to_be_public  = false
  cross_tenant_replication_enabled = false
  shared_access_key_enabled        = false
  default_to_oauth_authentication  = true
  public_network_access            = "Disabled"

  blob_properties {
    versioning_enabled  = true
    change_feed_enabled = true

    delete_retention_policy {
      days = var.storage_soft_delete_days
    }

    container_delete_retention_policy {
      days = var.storage_soft_delete_days
    }

    # Point-in-time restore needs versioning, change feed and soft delete; its window must be shorter than soft delete.
    restore_policy {
      days = var.storage_soft_delete_days - 1
    }
  }

  network_rules {
    default_action = "Deny"
    bypass         = ["AzureServices"]
  }

  identity {
    type = "SystemAssigned"
  }

  tags = local.common_tags
}
