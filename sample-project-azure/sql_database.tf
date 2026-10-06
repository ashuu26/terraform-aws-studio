# Azure SQL Database
# A database on the server: serverless or provisioned, with short-term PITR and long-term weekly, monthly and yearly backups.
# Registry docs:
#   azurerm_mssql_database: https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/mssql_database
# Azure docs: https://learn.microsoft.com/azure/azure-sql/database/sql-database-paas-overview

resource "azurerm_mssql_database" "main" {
  name                                = var.sql_database_name
  server_id                           = azurerm_mssql_server.main.id
  sku_name                            = var.sql_database_sku
  max_size_gb                         = 32
  collation                           = "SQL_Latin1_General_CP1_CI_AS"
  storage_account_type                = "Geo"
  transparent_data_encryption_enabled = true
  auto_pause_delay_in_minutes         = 60
  min_capacity                        = 0.5

  short_term_retention_policy {
    retention_days           = 7
    backup_interval_in_hours = 12
  }

  long_term_retention_policy {
    weekly_retention  = "P4W"
    monthly_retention = "P12M"
    yearly_retention  = "P5Y"
    week_of_year      = 1
  }

  tags = local.common_tags
}
