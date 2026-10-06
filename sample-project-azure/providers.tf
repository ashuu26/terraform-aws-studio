# providers.tf
# Terraform and provider requirements.
# Authentication is NOT configured here. The azurerm provider signs in with the Azure CLI,
# a managed identity, or OIDC / workload identity federation, read from ARM_* environment variables.

terraform {
  required_version = ">= 1.11.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 5.0"
    }
  }

  # Remote state in Azure Storage with Entra ID auth. Blob leases lock the state. Uncomment after creating the account.
  # backend "azurerm" {
  #   resource_group_name  = "rg-tfstate"
  #   storage_account_name = "sttfstate001"
  #   container_name       = "tfstate"
  #   key                  = "terraform-studio.tfstate"
  #   use_azuread_auth     = true
  # }
}

provider "azurerm" {
  subscription_id = var.subscription_id

  features {
    recovery_service {
      vm_backup_stop_protection_and_retain_data_on_destroy = true
      purge_protected_items_from_vault_on_destroy          = false
    }
    log_analytics_workspace {
      permanently_delete_on_destroy = false
    }
    resource_group {
      prevent_deletion_if_contains_resources = true
    }
  }

  # Use Microsoft Entra ID (not account keys) for storage data-plane calls.
  storage_use_azuread = true
}
