# outputs.tf
# Values printed after apply and readable by other configurations.

# Resource Group

output "resource_group_name" {
  description = "Name of the Azure Resource Group"
  value       = azurerm_resource_group.main.name
}

output "resource_group_id" {
  description = "ID of the Azure Resource Group"
  value       = azurerm_resource_group.main.id
}

# Azure Policy

output "policy_initiative_id" {
  description = "ID of the governance initiative"
  value       = azurerm_policy_set_definition.governance.id
}

output "policy_assignment_id" {
  description = "ID of the governance initiative assignment"
  value       = azurerm_subscription_policy_assignment.governance.id
}

# Role-Based Access Control

output "vm_operator_role_id" {
  description = "Resource ID of the custom VM Operator role"
  value       = azurerm_role_definition.vm_operator.role_definition_resource_id
}

# Virtual Network

output "vnet_id" {
  description = "ID of the virtual network"
  value       = azurerm_virtual_network.main.id
}

output "vnet_name" {
  description = "Name of the virtual network"
  value       = azurerm_virtual_network.main.name
}

# Subnets

output "subnet_ids" {
  description = "Subnet IDs keyed by short name"
  value       = { for k, s in azurerm_subnet.this : k => s.id }
}

# Network Security Group

output "nsg_id" {
  description = "ID of the network security group"
  value       = azurerm_network_security_group.main.id
}

# Private DNS Zone

output "private_dns_zone_ids" {
  description = "Private DNS zone IDs keyed by service"
  value       = { for k, z in azurerm_private_dns_zone.this : k => z.id }
}

# Private Endpoint

output "pe_storage_blob_ip" {
  description = "Private IP of the Storage Account endpoint"
  value       = azurerm_private_endpoint.storage_blob.private_service_connection[0].private_ip_address
}

output "pe_sql_ip" {
  description = "Private IP of the Azure SQL Server endpoint"
  value       = azurerm_private_endpoint.sql.private_service_connection[0].private_ip_address
}

# Virtual Machines

output "vm_ids" {
  description = "IDs of the virtual machines"
  value       = { for k, vm in azurerm_linux_virtual_machine.main : k => vm.id }
}

output "vm_private_ips" {
  description = "Private IP of each VM"
  value       = { for k, nic in azurerm_network_interface.vm : k => nic.private_ip_address }
}

output "vm_principal_ids" {
  description = "System-assigned identity principal ID of each VM"
  value       = { for k, vm in azurerm_linux_virtual_machine.main : k => vm.identity[0].principal_id }
}

# Storage Account

output "storage_account_id" {
  description = "ID of the storage account"
  value       = azurerm_storage_account.main.id
}

output "storage_account_name" {
  description = "Name of the storage account"
  value       = azurerm_storage_account.main.name
}

output "storage_primary_blob_endpoint" {
  description = "Primary blob endpoint"
  value       = azurerm_storage_account.main.primary_blob_endpoint
}

# Azure SQL Server

output "sql_server_fqdn" {
  description = "FQDN of the SQL server"
  value       = azurerm_mssql_server.main.fully_qualified_domain_name
}

# Azure SQL Database

output "sql_database_id" {
  description = "ID of the SQL database"
  value       = azurerm_mssql_database.main.id
}

# Recovery Services Vault

output "recovery_vault_id" {
  description = "ID of the Recovery Services vault"
  value       = azurerm_recovery_services_vault.main.id
}

# VM Backup

output "vm_backup_policy_id" {
  description = "ID of the VM backup policy"
  value       = azurerm_backup_policy_vm.main.id
}

# Log Analytics Workspace

output "log_analytics_workspace_id" {
  description = "Resource ID of the Log Analytics workspace"
  value       = azurerm_log_analytics_workspace.main.id
}

output "log_analytics_customer_id" {
  description = "Workspace (customer) ID used by agents and queries"
  value       = azurerm_log_analytics_workspace.main.workspace_id
}
