# variables.tf
# Every tunable value lives here. Override them in terraform.tfvars or TF_VAR_* environment variables.

# Global

variable "subscription_id" {
  description = "Target subscription ID. Leave null to use ARM_SUBSCRIPTION_ID or the Azure CLI default subscription."
  type        = string
  default     = null
}

variable "location" {
  description = "Azure region for every resource, for example southeastasia"
  type        = string
  default     = "southeastasia"

  validation {
    condition     = can(regex("^[a-z]+[a-z0-9]*$", var.location))
    error_message = "location must be a region name such as southeastasia (lowercase, no spaces)."
  }
}

variable "project_name" {
  description = "Short project name used in resource names (lowercase, hyphens)"
  type        = string
  default     = "tfstudio"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,14}$", var.project_name))
    error_message = "project_name must be 2-15 lowercase letters, numbers or hyphens, starting with a letter."
  }
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "test", "prod"], var.environment)
    error_message = "environment must be dev, test or prod."
  }
}

variable "additional_tags" {
  description = "Extra tags merged into local.common_tags"
  type        = map(string)
  default     = {}
}

# Resource Group

variable "resource_group_name" {
  description = "Name of the Azure Resource Group"
  type        = string
  default     = "rg-tfstudio-dev"

  validation {
    condition     = can(regex("^[-\\w._()]{1,89}[-\\w_()]$", var.resource_group_name))
    error_message = "Resource group names are 1-90 characters: letters, digits, underscores, hyphens, periods and parentheses, not ending in a period."
  }
}

# Azure Policy

variable "policy_allowed_locations" {
  description = "Regions where resources may be deployed"
  type        = list(string)
  default     = ["southeastasia", "eastasia"]

  validation {
    condition     = length(var.policy_allowed_locations) > 0
    error_message = "Allow at least one location."
  }
}

variable "policy_required_tags" {
  description = "Tags every resource group must carry"
  type        = list(string)
  default     = ["Environment", "Owner"]
}

variable "policy_allowed_environments" {
  description = "Allowed values for the Environment tag"
  type        = list(string)
  default     = ["dev", "test", "prod"]
}

# Role-Based Access Control

variable "role_assignments" {
  description = "Built-in role assignments, keyed by a short label. principal_id is an Entra object ID."
  type = map(object({
    role_definition_name = string
    principal_id         = string
    principal_type       = optional(string, "Group")
  }))
  default = {}

  validation {
    condition     = alltrue([for a in values(var.role_assignments) : contains(["User", "Group", "ServicePrincipal"], a.principal_type)])
    error_message = "principal_type must be User, Group or ServicePrincipal."
  }
}

variable "vm_operator_principal_ids" {
  description = "Entra object IDs (groups) that get the custom VM Operator role"
  type        = list(string)
  default     = []
}

# Virtual Network

variable "vnet_address_space" {
  description = "Address space of the virtual network"
  type        = list(string)
  default     = ["10.0.0.0/16"]

  validation {
    condition     = alltrue([for c in var.vnet_address_space : can(cidrhost(c, 0))])
    error_message = "Each entry must be a valid IPv4 CIDR, for example 10.0.0.0/16."
  }
}

variable "vnet_dns_servers" {
  description = "Custom DNS servers; an empty list uses Azure-provided DNS"
  type        = list(string)
  default     = []
}

# Subnets

variable "subnets" {
  description = "Subnets keyed by short name. Special names (AzureFirewallSubnet, GatewaySubnet, AzureBastionSubnet) are used as-is."
  type = map(object({
    address_prefixes  = list(string)
    delegation        = optional(string)
    service_endpoints = optional(list(string), [])
  }))
  default = {
    app = {
      address_prefixes = ["10.0.1.0/24"]
    }
    data = {
      address_prefixes = ["10.0.2.0/24"]
    }
    endpoints = {
      address_prefixes = ["10.0.3.0/24"]
    }
  }
}

variable "subnet_default_outbound_access" {
  description = "Allow implicit default outbound internet access. false makes subnets private: egress then needs a NAT gateway or firewall."
  type        = bool
  default     = true
}

# Network Security Group

variable "nsg_allowed_ports" {
  description = "Destination ports allowed inbound from var.nsg_allowed_source"
  type        = list(string)
  default     = ["443"]
}

variable "nsg_allowed_source" {
  description = "Service tag or CIDR allowed to reach the app ports"
  type        = string
  default     = "VirtualNetwork"
}

# Virtual Machines

variable "admin_username" {
  description = "Administrator user name for VMs and scale sets"
  type        = string
  default     = "azureuser"

  validation {
    condition     = !contains(["admin", "administrator", "root", "azureadmin"], lower(var.admin_username))
    error_message = "That user name is reserved by Azure."
  }
}

variable "admin_ssh_public_key" {
  description = "SSH public key (contents of ~/.ssh/id_ed25519.pub or id_rsa.pub). Public keys are not secrets; no private key is ever generated."
  type        = string

  validation {
    condition     = can(regex("^(ssh-rsa|ssh-ed25519|ecdsa-sha2-nistp256) ", var.admin_ssh_public_key))
    error_message = "Provide an OpenSSH public key."
  }
}

variable "vms" {
  description = "Virtual machines keyed by short name; zone spreads them across availability zones"
  type = map(object({
    zone = optional(string)
  }))
  default = {
    web-01 = {
      zone = "1"
    }
    web-02 = {
      zone = "2"
    }
  }
}

variable "vm_size" {
  description = "VM size"
  type        = string
  default     = "Standard_B2s"
}

variable "vm_os_disk_type" {
  description = "Storage type of the OS disk"
  type        = string
  default     = "Premium_LRS"
}

variable "vm_os_disk_size_gb" {
  description = "OS disk size in GB"
  type        = number
  default     = 64
}

# Storage Account

variable "storage_account_name" {
  description = "Storage account name; null builds a unique one from the project name"
  type        = string
  default     = null

  validation {
    condition     = var.storage_account_name == null || can(regex("^[a-z0-9]{3,24}$", var.storage_account_name))
    error_message = "Storage account names are 3-24 lowercase letters and digits."
  }
}

variable "storage_replication_type" {
  description = "Replication: LRS, ZRS, GRS, RAGRS, GZRS or RAGZRS"
  type        = string
  default     = "ZRS"

  validation {
    condition     = contains(["LRS", "ZRS", "GRS", "RAGRS", "GZRS", "RAGZRS"], var.storage_replication_type)
    error_message = "Unknown replication type."
  }
}

variable "storage_soft_delete_days" {
  description = "Days deleted blobs and containers are kept"
  type        = number
  default     = 14

  validation {
    condition     = var.storage_soft_delete_days >= 1 && var.storage_soft_delete_days <= 365
    error_message = "Use 1 to 365 days."
  }
}

# Azure SQL Server

variable "sql_entra_admin_login" {
  description = "Display name of the Entra administrator (group or user)"
  type        = string
  default     = "sql-admins"
}

variable "sql_entra_admin_object_id" {
  description = "Object ID of the Entra administrator; null uses the identity running Terraform"
  type        = string
  default     = null
}

# Azure SQL Database

variable "sql_database_name" {
  description = "Name of the database"
  type        = string
  default     = "appdb"
}

variable "sql_database_sku" {
  description = "Database SKU"
  type        = string
  default     = "GP_S_Gen5_2"
}

# Recovery Services Vault

variable "recovery_vault_storage_mode" {
  description = "GeoRedundant, ZoneRedundant or LocallyRedundant"
  type        = string
  default     = "GeoRedundant"
}

# Log Analytics Workspace

variable "log_analytics_retention_days" {
  description = "Days logs are retained (30-730)"
  type        = number
  default     = 30

  validation {
    condition     = var.log_analytics_retention_days >= 30 && var.log_analytics_retention_days <= 730
    error_message = "Use 30 to 730 days."
  }
}

variable "log_analytics_daily_quota_gb" {
  description = "Daily ingestion cap in GB; -1 for no cap"
  type        = number
  default     = -1
}
