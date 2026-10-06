# Azure Policy
# Guardrails: a custom definition, a governance initiative, and assignments for locations, tags, storage and the Microsoft cloud security benchmark.
# Registry docs:
#   data.azurerm_policy_definition_built_in: https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/data-sources/policy_definition_built_in
#   data.azurerm_policy_set_definition: https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/data-sources/policy_set_definition
#   azurerm_policy_definition: https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/policy_definition
#   azurerm_policy_set_definition: https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/policy_set_definition
#   azurerm_subscription_policy_assignment: https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/subscription_policy_assignment
#   azurerm_role_assignment: https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/role_assignment
# Azure docs: https://learn.microsoft.com/azure/governance/policy/overview

# Built-in definitions by GUID (display name in the comment).

# Allowed locations
data "azurerm_policy_definition_built_in" "allowed_locations" {
  name = "e56962a6-4747-49cd-b67b-bf8b01975c4c"
}

# Allowed locations for resource groups
data "azurerm_policy_definition_built_in" "allowed_locations_rg" {
  name = "e765b5de-1225-4ba3-bd56-1ac6695af988"
}

# Require a tag on resource groups
data "azurerm_policy_definition_built_in" "require_tag_rg" {
  name = "96670d01-0a4d-4649-9c89-2d3abc0a5025"
}

# Inherit a tag from the resource group if missing
data "azurerm_policy_definition_built_in" "inherit_tag" {
  name = "ea3f2387-9b95-492a-a190-fcdc54f7b070"
}

# Secure transfer to storage accounts should be enabled
data "azurerm_policy_definition_built_in" "storage_https" {
  name = "404c3081-a854-4457-ae30-26a93ef643f9"
}

# Storage account public access should be disallowed
data "azurerm_policy_definition_built_in" "storage_public" {
  name = "4fa4b6c0-31ca-4c0d-b10d-24b96f62a751"
}

# Microsoft cloud security benchmark (built-in initiative)
data "azurerm_policy_set_definition" "mcsb" {
  name = "1f3afdf9-d0c9-4c3d-847f-89da613e70a8"
}

# A custom policy definition: the Environment tag, when present, must use an approved value.

resource "azurerm_policy_definition" "environment_tag_values" {
  name         = "${local.name_prefix}-env-tag-values"
  display_name = "Environment tag must use an approved value"
  description  = "Denies resources whose Environment tag is not in the allowed list."
  policy_type  = "Custom"
  mode         = "Indexed"

  metadata = jsonencode({
    category = "Tags"
    version  = "1.0.0"
  })

  parameters = jsonencode({
    allowedValues = {
      type     = "Array"
      metadata = { displayName = "Allowed Environment values" }
    }
  })

  policy_rule = jsonencode({
    "if" = {
      allOf = [
        { field = "tags['Environment']", exists = "true" },
        { field = "tags['Environment']", notIn = "[parameters('allowedValues')]" },
      ]
    }
    "then" = { effect = "deny" }
  })
}

# An initiative (policy set) groups related definitions so they are assigned and reported together.

resource "azurerm_policy_set_definition" "governance" {
  name         = "${local.name_prefix}-governance"
  display_name = "Governance baseline (${local.name_prefix})"
  policy_type  = "Custom"

  parameters = jsonencode({
    allowedLocations = {
      type     = "Array"
      metadata = { displayName = "Allowed locations", strongType = "location" }
    }
    allowedEnvironments = {
      type     = "Array"
      metadata = { displayName = "Allowed Environment tag values" }
    }
  })

  policy_definition_reference {
    policy_definition_id = data.azurerm_policy_definition_built_in.allowed_locations.id
    reference_id         = "allowedLocations"
    parameter_values = jsonencode({
      listOfAllowedLocations = { value = "[parameters('allowedLocations')]" }
    })
  }
  policy_definition_reference {
    policy_definition_id = data.azurerm_policy_definition_built_in.allowed_locations_rg.id
    reference_id         = "allowedLocationsResourceGroups"
    parameter_values = jsonencode({
      listOfAllowedLocations = { value = "[parameters('allowedLocations')]" }
    })
  }
  policy_definition_reference {
    policy_definition_id = azurerm_policy_definition.environment_tag_values.id
    reference_id         = "environmentTagValues"
    parameter_values = jsonencode({
      allowedValues = { value = "[parameters('allowedEnvironments')]" }
    })
  }
  dynamic "policy_definition_reference" {
    for_each = toset(var.policy_required_tags)

    content {
      policy_definition_id = data.azurerm_policy_definition_built_in.require_tag_rg.id
      reference_id         = "requireTag${replace(policy_definition_reference.value, " ", "")}"
      parameter_values = jsonencode({
        tagName = { value = policy_definition_reference.value }
      })
    }
  }
}

# Assignments apply definitions to the current subscription. Management group assignment names are limited to 24 characters.

resource "azurerm_subscription_policy_assignment" "governance" {
  name                 = "gov-baseline"
  display_name         = "Governance baseline"
  subscription_id      = data.azurerm_subscription.current.id
  policy_definition_id = azurerm_policy_set_definition.governance.id

  parameters = jsonencode({
    allowedLocations    = { value = var.policy_allowed_locations }
    allowedEnvironments = { value = var.policy_allowed_environments }
  })

  non_compliance_message {
    content = "Deploy only to approved regions, tag resource groups and use an approved Environment value."
  }
}

resource "azurerm_subscription_policy_assignment" "mcsb" {
  name                 = "mcsb-audit"
  display_name         = "Microsoft cloud security benchmark"
  subscription_id      = data.azurerm_subscription.current.id
  policy_definition_id = data.azurerm_policy_set_definition.mcsb.id
}

resource "azurerm_subscription_policy_assignment" "storage_https" {
  name                 = "storage-https"
  display_name         = "Secure transfer to storage accounts"
  subscription_id      = data.azurerm_subscription.current.id
  policy_definition_id = data.azurerm_policy_definition_built_in.storage_https.id

  parameters = jsonencode({ effect = { value = "Audit" } })
}

resource "azurerm_subscription_policy_assignment" "storage_public" {
  name                 = "storage-no-public"
  display_name         = "Storage public network access disallowed"
  subscription_id      = data.azurerm_subscription.current.id
  policy_definition_id = data.azurerm_policy_definition_built_in.storage_public.id

  parameters = jsonencode({ effect = { value = "Audit" } })
}

# Modify policies change resources, so each assignment gets a managed identity and a role to do it.

resource "azurerm_subscription_policy_assignment" "inherit_tag" {
  for_each = toset(var.policy_required_tags)

  name                 = substr("inherit-${lower(replace(each.value, " ", ""))}", 0, 24)
  display_name         = "Inherit ${each.value} tag from the resource group"
  subscription_id      = data.azurerm_subscription.current.id
  policy_definition_id = data.azurerm_policy_definition_built_in.inherit_tag.id
  location             = var.location

  parameters = jsonencode({ tagName = { value = each.value } })

  identity {
    type = "SystemAssigned"
  }
}

# The built-in definition lists Contributor as the role its Modify effect needs.

resource "azurerm_role_assignment" "policy_inherit_tag" {
  for_each = azurerm_subscription_policy_assignment.inherit_tag

  scope                = data.azurerm_subscription.current.id
  role_definition_name = "Contributor"
  principal_id         = each.value.identity[0].principal_id
  principal_type       = "ServicePrincipal"
}
