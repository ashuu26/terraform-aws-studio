# locals.tf
# Values computed once and reused everywhere. azurerm has no provider-level default tags,
# so every taggable resource sets tags = local.common_tags.

locals {
  name_prefix = "${var.project_name}-${var.environment}"

  common_tags = merge(
    {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "Terraform"
    },
    var.additional_tags,
  )

  # Globally unique names (storage, SQL, Cosmos DB, registries) get a stable suffix per subscription.
  name_compact  = substr(replace(local.name_prefix, "-", ""), 0, 13)
  unique_suffix = substr(sha1("${data.azurerm_client_config.current.subscription_id}-${local.name_prefix}"), 0, 6)

  subnet_delegation_actions = {
    "Microsoft.DBforPostgreSQL/flexibleServers"   = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    "Microsoft.DBforMySQL/flexibleServers"        = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    "Microsoft.Web/serverFarms"                   = ["Microsoft.Network/virtualNetworks/subnets/action"]
    "Microsoft.App/environments"                  = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    "Microsoft.ContainerInstance/containerGroups" = ["Microsoft.Network/virtualNetworks/subnets/action"]
  }

  nsg_rules = {
    "allow-app-inbound" = {
      priority = 100
      ports    = var.nsg_allowed_ports
      source   = var.nsg_allowed_source
    }
  }

  private_dns_zones = {
    blob = "privatelink.blob.core.windows.net"
    sql  = "privatelink.database.windows.net"
  }

  storage_account_name = coalesce(var.storage_account_name, substr("st${local.name_compact}${local.unique_suffix}", 0, 24))
}
