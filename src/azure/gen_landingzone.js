/* ==========================================================================
   gen_landingzone.js — Landing Zone generator: resource groups, management
   groups, Azure Policy (definitions, initiatives, assignments), RBAC,
   resource locks and cost governance.
   ========================================================================== */

// Built-in Azure Policy definitions, referenced by their fixed GUID names (verified on AzAdvertizer).
const BUILTIN_POLICY = {
  allowed_locations: ['e56962a6-4747-49cd-b67b-bf8b01975c4c', 'Allowed locations'],
  allowed_locations_rg: ['e765b5de-1225-4ba3-bd56-1ac6695af988', 'Allowed locations for resource groups'],
  require_tag_rg: ['96670d01-0a4d-4649-9c89-2d3abc0a5025', 'Require a tag on resource groups'],
  inherit_tag: ['ea3f2387-9b95-492a-a190-fcdc54f7b070', 'Inherit a tag from the resource group if missing'],
  storage_https: ['404c3081-a854-4457-ae30-26a93ef643f9', 'Secure transfer to storage accounts should be enabled'],
  storage_public: ['4fa4b6c0-31ca-4c0d-b10d-24b96f62a751', 'Storage account public access should be disallowed'],
  vm_skus: ['cccc23c7-8427-4f53-ad12-b6a63eb452b3', 'Allowed virtual machine size SKUs'],
  nic_public_ip: ['83a86a26-fd1f-447c-b59d-e51f44264114', 'Network interfaces should not have public IPs'],
};
const MCSB_INITIATIVE = ['1f3afdf9-d0c9-4c3d-847f-89da613e70a8', 'Microsoft cloud security benchmark'];

// Management group hierarchies. Enterprise follows the Azure landing zone (CAF) reference archetypes.
const MG_MODELS = {
  Enterprise: {
    level1: { platform: 'Platform', landingzones: 'Landing Zones', sandbox: 'Sandbox', decommissioned: 'Decommissioned' },
    level2: { management: ['platform', 'Management'], connectivity: ['platform', 'Connectivity'], identity: ['platform', 'Identity'], corp: ['landingzones', 'Corp'], online: ['landingzones', 'Online'] },
  },
  Standard: {
    level1: { prod: 'Production', nonprod: 'Non-Production', sandbox: 'Sandbox' },
    level2: {},
  },
};
const mgKeys = model => [...Object.keys(MG_MODELS[model].level1), ...Object.keys(MG_MODELS[model].level2)];
const mgAddr = (model, key) => MG_MODELS[model].level1[key] ? `azurerm_management_group.level1["${key}"]` : `azurerm_management_group.level2["${key}"]`;

S({
  id: 'resource_group', name: 'Resource Group', cat: 'landingzone', diff: 'Beginner', file: 'resource_groups',
  res: ['azurerm_resource_group'], kw: 'rg resource group container lifecycle',
  azdoc: MS + 'azure-resource-manager/management/manage-resource-groups-portal',
  desc: 'A logical container that holds related resources sharing one lifecycle, access policy and region of metadata.',
  use: 'Every Azure resource lives in exactly one resource group. Group by lifecycle: what you deploy and delete together.',
  fields: [
    { k: 'layout', l: 'Layout', t: 'select', o: ['Single resource group', 'One per workload layer'], d: 'Single resource group', h: 'Per layer creates network, app, data and ops groups. Each service lands in the group for its category.' },
  ],
  assume: ['Group names follow rg-<project>-<environment>[-<layer>].', 'Every resource in the project is placed in one of these groups.'],
  guide: ['Assign RBAC at resource group scope for workload teams; keep subscription-level Owner rare.', 'Use a CanNotDelete lock on production groups (see Resource Locks).'],
  gen(c, x) {
    if (c.layout === 'One per workload layer') {
      const g = x.g, m = {};
      for (const l of ['network', 'app', 'data', 'ops']) m[l] = `rg-${g.project}-${g.env}-${l}`;
      x.v('resource_groups', 'map(string)', 'Resource group name per workload layer (network, app, data, ops)', m, { condition: 'alltrue([for k in ["network", "app", "data", "ops"] : contains(keys(var.resource_groups), k)])', error: 'resource_groups must define network, app, data and ops.' });
      x.o('resource_group_names', '{ for k, rg in azurerm_resource_group.layer : k => rg.name }', 'Resource group name per layer');
      x.o('resource_group_ids', '{ for k, rg in azurerm_resource_group.layer : k => rg.id }', 'Resource group ID per layer');
      return R('resource "azurerm_resource_group" "layer"', ['for_each = var.resource_groups', '', 'name = each.value', 'location = var.location', '', 'tags = merge(local.common_tags, { Layer = each.key })']);
    }
    x.v('resource_group_name', 'string', 'Name of the Azure Resource Group', `rg-${x.g.project}-${x.g.env}`, { condition: 'can(regex("^[-\\\\w._()]{1,89}[-\\\\w_()]$", var.resource_group_name))', error: 'Resource group names are 1-90 characters: letters, digits, underscores, hyphens, periods and parentheses, not ending in a period.' });
    x.o('resource_group_name', 'azurerm_resource_group.main.name', 'Name of the Azure Resource Group');
    x.o('resource_group_id', 'azurerm_resource_group.main.id', 'ID of the Azure Resource Group');
    return R('resource "azurerm_resource_group" "main"', ['name = var.resource_group_name', 'location = var.location', '', x.tags]);
  },
});

S({
  id: 'mgmt_groups', name: 'Management Groups', cat: 'landingzone', diff: 'Advanced', file: 'management_groups',
  res: ['azurerm_management_group', 'azurerm_management_group_subscription_association', 'azurerm_subscription', 'data.azurerm_subscription'],
  kw: 'management group hierarchy tenant root landing zone alz caf subscription organization enterprise',
  azdoc: MS + 'governance/management-groups/overview',
  desc: 'A management group hierarchy under the tenant root group, with subscriptions placed into it.',
  use: 'Apply policy and RBAC once at a management group, and every subscription below inherits it.',
  suggest: () => ['policy', 'rbac'],
  fields: [
    { k: 'model', l: 'Landing zone type', t: 'select', o: ['Enterprise', 'Standard'], d: 'Enterprise', h: 'Enterprise: Platform (Management, Connectivity, Identity), Landing Zones (Corp, Online), Sandbox, Decommissioned. Standard: Production, Non-Production, Sandbox.' },
    { k: 'root_id', l: 'Intermediate root ID', t: 'text', d: 'contoso', h: 'Lowercase ID of the top management group you own. Child IDs are prefixed with it.' },
    { k: 'root_name', l: 'Intermediate root display name', t: 'text', d: 'Contoso' },
    { k: 'place_current', l: 'Place the current subscription in', t: 'select', o: ['Do not move it', 'corp', 'online', 'management', 'connectivity', 'identity', 'prod', 'nonprod', 'sandbox'], d: 'Do not move it', h: 'Moving a subscription changes which policies and roles it inherits.' },
    { k: 'create_subs', l: 'Create subscriptions with subscription aliases', t: 'bool', d: false, h: 'Needs a billing account role (EA, MCA or MPA). Off by default.' },
    { k: 'note', t: 'note', l: 'Management group operations need tenant-level permissions (for example Management Group Contributor at the tenant root) and a subscription that has registered Microsoft.Management.', level: 'warn' },
  ],
  assume: ['The hierarchy hangs off the Tenant Root Group, which Azure creates for you.', 'Additional subscriptions are placed with var.subscription_placement (subscription ID to management group key).'],
  guide: ['Keep the hierarchy shallow (3-4 levels). Azure allows six levels below the root.', 'Assign policy at the intermediate root, not the Tenant Root Group, so you can test changes in a second hierarchy.'],
  gen(c, x) {
    const m = MG_MODELS[c.model] || MG_MODELS.Enterprise;
    const keys = mgKeys(c.model);
    x.v('mg_root_id', 'string', 'ID of the intermediate root management group (lowercase, no spaces)', c.root_id, { condition: 'can(regex("^[a-z0-9][a-z0-9-]{1,40}$", var.mg_root_id))', error: 'mg_root_id must be lowercase letters, digits and hyphens.' });
    x.v('mg_root_display_name', 'string', 'Display name of the intermediate root management group', c.root_name);
    x.v('subscription_placement', 'map(string)', `Subscription IDs (GUIDs) to place, mapped to a management group key: ${keys.join(', ')}`, {}, { condition: `alltrue([for mg in values(var.subscription_placement) : contains(${hv(keys)}, mg)])`, error: 'Each value must be one of the management group keys.' });
    x.local('mg_level1', hv(m.level1));
    if (Object.keys(m.level2).length) x.local('mg_level2', hv(Object.fromEntries(Object.entries(m.level2).map(([k, [p, n]]) => [k, { parent: p, display_name: n }]))));
    const parts = [
      '# The Tenant Root Group is the implicit parent of the intermediate root.',
      R('resource "azurerm_management_group" "root"', ['name = var.mg_root_id', 'display_name = var.mg_root_display_name']),
      R('resource "azurerm_management_group" "level1"', ['for_each = local.mg_level1', '', 'name = "${var.mg_root_id}-${each.key}"', 'display_name = each.value', 'parent_management_group_id = azurerm_management_group.root.id']),
    ];
    if (Object.keys(m.level2).length) parts.push(R('resource "azurerm_management_group" "level2"', ['for_each = local.mg_level2', '', 'name = "${var.mg_root_id}-${each.key}"', 'display_name = each.value.display_name', 'parent_management_group_id = azurerm_management_group.level1[each.value.parent].id']));
    const mgIdMap = Object.keys(m.level2).length ? 'merge(\n  { for k, mg in azurerm_management_group.level1 : k => mg.id },\n  { for k, mg in azurerm_management_group.level2 : k => mg.id },\n)' : '{ for k, mg in azurerm_management_group.level1 : k => mg.id }';
    x.local('mg_ids', mgIdMap);
    parts.push('# A subscription belongs to exactly one management group. Associating it moves it.', R('resource "azurerm_management_group_subscription_association" "placement"', ['for_each = var.subscription_placement', '', 'management_group_id = local.mg_ids[each.value]', 'subscription_id = "/subscriptions/${each.key}"']));
    if (c.place_current !== 'Do not move it' && keys.includes(c.place_current)) {
      parts.push(R('resource "azurerm_management_group_subscription_association" "current"', [`management_group_id = ${mgAddr(c.model, c.place_current)}.id`, `subscription_id = ${x.sub()}.id`]));
    } else if (c.place_current !== 'Do not move it') x.note(`"${c.place_current}" is not part of the ${c.model} hierarchy, so the current subscription is not moved.`);
    if (c.create_subs) {
      x.v('billing_scope_id', 'string', 'Billing scope for new subscriptions, for example an MCA invoice section or EA enrollment account resource ID');
      x.v('new_subscriptions', 'map(object({ management_group = string, workload = optional(string, "Production") }))', 'Subscriptions to create, keyed by display name', { [`sub-${x.g.project}-${x.g.env}`]: { management_group: keys.includes('corp') ? 'corp' : 'nonprod' } });
      parts.push('# Subscription aliases create subscriptions. Destroying the alias cancels the subscription (Azure keeps it disabled for a grace period).',
        R('resource "azurerm_subscription" "this"', ['for_each = var.new_subscriptions', '', 'alias = each.key', 'subscription_name = each.key', 'billing_scope_id = var.billing_scope_id', 'workload = each.value.workload', '', x.tags]),
        R('resource "azurerm_management_group_subscription_association" "new"', ['for_each = var.new_subscriptions', '', 'management_group_id = local.mg_ids[each.value.management_group]', 'subscription_id = "/subscriptions/${azurerm_subscription.this[each.key].subscription_id}"']));
      x.o('new_subscription_ids', '{ for k, s in azurerm_subscription.this : k => s.subscription_id }', 'IDs of the subscriptions created by alias');
    }
    x.o('management_group_root_id', 'azurerm_management_group.root.id', 'Resource ID of the intermediate root management group');
    x.o('management_group_ids', 'local.mg_ids', 'Resource ID of each child management group');
    return parts.join('\n\n');
  },
});

S({
  id: 'policy', name: 'Azure Policy', cat: 'landingzone', diff: 'Advanced', file: 'policy',
  res: ['azurerm_policy_definition', 'azurerm_management_group_policy_set_definition', 'azurerm_policy_set_definition', 'azurerm_management_group_policy_assignment', 'azurerm_subscription_policy_assignment', 'azurerm_role_assignment', 'data.azurerm_policy_definition_built_in', 'data.azurerm_policy_set_definition'],
  kw: 'policy governance initiative definition assignment compliance allowed locations tags deny audit modify mcsb',
  azdoc: MS + 'governance/policy/overview',
  desc: 'Guardrails: a custom definition, a governance initiative, and assignments for locations, tags, storage and the Microsoft cloud security benchmark.',
  use: 'Deny deployments outside approved regions, require tags, and audit security posture across every subscription.',
  suggest: (c, has) => has('mgmt_groups') ? [] : ['mgmt_groups'],
  fields: [
    { k: 'locations', l: 'Allowed locations', t: 'list', d: 'southeastasia, eastasia', h: 'Comma-separated region names. Deployments elsewhere are denied.' },
    { k: 'tags', l: 'Required tags on resource groups', t: 'list', d: 'Environment, Owner', h: 'Resource groups must carry these tags; resources inherit them when missing.' },
    { k: 'env_values', l: 'Allowed Environment tag values', t: 'list', d: 'dev, test, prod' },
    { k: 'inherit', l: 'Inherit required tags from the resource group (Modify effect)', t: 'bool', d: true, h: 'Creates a managed identity per assignment with Contributor at the scope.' },
    { k: 'mcsb', l: 'Assign the Microsoft cloud security benchmark (audit)', t: 'bool', d: true },
    { k: 'storage', l: 'Storage guardrails', t: 'select', o: ['Audit', 'Deny', 'Off'], d: 'Audit', h: 'Secure transfer required and public network access disallowed.' },
    { k: 'nic_public_ip', l: 'Deny public IPs on network interfaces', t: 'bool', d: false },
    { k: 'vm_skus', l: 'Allowed VM sizes (blank = no restriction)', t: 'list', d: '' },
  ],
  assume: ['Built-in definitions are looked up by their fixed GUIDs, so renamed display names do not break the code.', 'Assignments target the intermediate root management group when Management Groups is selected; otherwise the current subscription.'],
  guide: ['Roll out new Deny policies with enforce = false (DoNotEnforce) first, check compliance, then enforce.', 'Modify and DeployIfNotExists assignments need a managed identity and a role assignment, or remediation fails.'],
  gen(c, x) {
    const sc = x.scope(), mg = sc.kind === 'mg';
    const parts = [];
    const tagsList = csv(c.tags);
    x.v('policy_allowed_locations', 'list(string)', 'Regions where resources may be deployed', csv(c.locations), { condition: 'length(var.policy_allowed_locations) > 0', error: 'Allow at least one location.' });
    x.v('policy_required_tags', 'list(string)', 'Tags every resource group must carry', tagsList);
    x.v('policy_allowed_environments', 'list(string)', 'Allowed values for the Environment tag', csv(c.env_values));
    const builtins = ['allowed_locations', 'allowed_locations_rg', 'require_tag_rg'];
    if (c.inherit && tagsList.length) builtins.push('inherit_tag');
    if (c.storage !== 'Off') builtins.push('storage_https', 'storage_public');
    if (c.nic_public_ip) builtins.push('nic_public_ip');
    if (csv(c.vm_skus).length) builtins.push('vm_skus');
    parts.push('# Built-in definitions by GUID (display name in the comment).');
    for (const b of builtins) parts.push(`# ${BUILTIN_POLICY[b][1]}\n` + R(`data "azurerm_policy_definition_built_in" "${b}"`, [`name = "${BUILTIN_POLICY[b][0]}"`]));
    if (c.mcsb) parts.push(`# ${MCSB_INITIATIVE[1]} (built-in initiative)\n` + R('data "azurerm_policy_set_definition" "mcsb"', [`name = "${MCSB_INITIATIVE[0]}"`]));

    // Custom definition
    parts.push('# A custom policy definition: the Environment tag, when present, must use an approved value.',
      R('resource "azurerm_policy_definition" "environment_tag_values"', [
        'name = "${local.name_prefix}-env-tag-values"', 'display_name = "Environment tag must use an approved value"', 'description = "Denies resources whose Environment tag is not in the allowed list."',
        'policy_type = "Custom"', 'mode = "Indexed"', mg ? 'management_group_id = azurerm_management_group.root.id' : null, '',
        'metadata = jsonencode({\n  category = "Tags"\n  version  = "1.0.0"\n})', '',
        'parameters = jsonencode({\n  allowedValues = {\n    type     = "Array"\n    metadata = { displayName = "Allowed Environment values" }\n  }\n})', '',
        'policy_rule = jsonencode({\n  "if" = {\n    allOf = [\n      { field = "tags[\'Environment\']", exists = "true" },\n      { field = "tags[\'Environment\']", notIn = "[parameters(\'allowedValues\')]" },\n    ]\n  }\n  "then" = { effect = "deny" }\n})',
      ]));

    // Initiative
    const setType = mg ? 'azurerm_management_group_policy_set_definition' : 'azurerm_policy_set_definition';
    parts.push('# An initiative (policy set) groups related definitions so they are assigned and reported together.',
      R(`resource "${setType}" "governance"`, [
        'name = "${local.name_prefix}-governance"', 'display_name = "Governance baseline (${local.name_prefix})"', 'policy_type = "Custom"', mg ? 'management_group_id = azurerm_management_group.root.id' : null, '',
        'parameters = jsonencode({\n  allowedLocations = {\n    type     = "Array"\n    metadata = { displayName = "Allowed locations", strongType = "location" }\n  }\n  allowedEnvironments = {\n    type     = "Array"\n    metadata = { displayName = "Allowed Environment tag values" }\n  }\n})', '',
        B('policy_definition_reference', ['policy_definition_id = data.azurerm_policy_definition_built_in.allowed_locations.id', 'reference_id = "allowedLocations"', 'parameter_values = jsonencode({\n  listOfAllowedLocations = { value = "[parameters(\'allowedLocations\')]" }\n})']),
        B('policy_definition_reference', ['policy_definition_id = data.azurerm_policy_definition_built_in.allowed_locations_rg.id', 'reference_id = "allowedLocationsResourceGroups"', 'parameter_values = jsonencode({\n  listOfAllowedLocations = { value = "[parameters(\'allowedLocations\')]" }\n})']),
        B('policy_definition_reference', ['policy_definition_id = azurerm_policy_definition.environment_tag_values.id', 'reference_id = "environmentTagValues"', 'parameter_values = jsonencode({\n  allowedValues = { value = "[parameters(\'allowedEnvironments\')]" }\n})']),
        B('dynamic "policy_definition_reference"', ['for_each = toset(var.policy_required_tags)', '', B('content', ['policy_definition_id = data.azurerm_policy_definition_built_in.require_tag_rg.id', 'reference_id = "requireTag${replace(policy_definition_reference.value, " ", "")}"', 'parameter_values = jsonencode({\n  tagName = { value = policy_definition_reference.value }\n})'])]),
      ]));

    // Assignments
    const scopeArg = mg ? 'management_group_id = azurerm_management_group.root.id' : `subscription_id = ${sc.id}`;
    const aType = mg ? 'azurerm_management_group_policy_assignment' : 'azurerm_subscription_policy_assignment';
    const assign = (local, name, display, def, extra) => R(`resource "${aType}" "${local}"`, [name, `display_name = "${display}"`, scopeArg, `policy_definition_id = ${def}`, ...(extra || [])]);
    parts.push(`# Assignments apply definitions to ${sc.label}. Management group assignment names are limited to 24 characters.`,
      assign('governance', 'name = "gov-baseline"', 'Governance baseline', `${setType}.governance.id`, ['', 'parameters = jsonencode({\n  allowedLocations    = { value = var.policy_allowed_locations }\n  allowedEnvironments = { value = var.policy_allowed_environments }\n})', '', B('non_compliance_message', ['content = "Deploy only to approved regions, tag resource groups and use an approved Environment value."'])]));
    if (c.mcsb) parts.push(assign('mcsb', 'name = "mcsb-audit"', 'Microsoft cloud security benchmark', 'data.azurerm_policy_set_definition.mcsb.id'));
    if (c.storage !== 'Off') {
      parts.push(assign('storage_https', 'name = "storage-https"', 'Secure transfer to storage accounts', 'data.azurerm_policy_definition_built_in.storage_https.id', ['', `parameters = jsonencode({ effect = { value = "${c.storage}" } })`]));
      parts.push(assign('storage_public', 'name = "storage-no-public"', 'Storage public network access disallowed', 'data.azurerm_policy_definition_built_in.storage_public.id', ['', `parameters = jsonencode({ effect = { value = "${c.storage}" } })`]));
    }
    if (c.nic_public_ip) parts.push(assign('nic_public_ip', 'name = "deny-nic-public-ip"', 'Network interfaces should not have public IPs', 'data.azurerm_policy_definition_built_in.nic_public_ip.id'));
    if (csv(c.vm_skus).length) {
      x.v('policy_allowed_vm_skus', 'list(string)', 'VM sizes that may be deployed', csv(c.vm_skus));
      parts.push(assign('vm_skus', 'name = "allowed-vm-skus"', 'Allowed virtual machine size SKUs', 'data.azurerm_policy_definition_built_in.vm_skus.id', ['', 'parameters = jsonencode({ listOfAllowedSKUs = { value = var.policy_allowed_vm_skus } })']));
    }
    if (c.inherit && tagsList.length) {
      parts.push('# Modify policies change resources, so each assignment gets a managed identity and a role to do it.',
        R(`resource "${aType}" "inherit_tag"`, ['for_each = toset(var.policy_required_tags)', '', 'name = substr("inherit-${lower(replace(each.value, " ", ""))}", 0, 24)', 'display_name = "Inherit ${each.value} tag from the resource group"', scopeArg, 'policy_definition_id = data.azurerm_policy_definition_built_in.inherit_tag.id', 'location = var.location', '', 'parameters = jsonencode({ tagName = { value = each.value } })', '', B('identity', ['type = "SystemAssigned"'])]),
        '# The built-in definition lists Contributor as the role its Modify effect needs.',
        R('resource "azurerm_role_assignment" "policy_inherit_tag"', [`for_each = ${aType}.inherit_tag`, '', `scope = ${sc.id}`, 'role_definition_name = "Contributor"', 'principal_id = each.value.identity[0].principal_id', 'principal_type = "ServicePrincipal"']));
    }
    x.o('policy_initiative_id', `${setType}.governance.id`, 'ID of the governance initiative');
    x.o('policy_assignment_id', `${aType}.governance.id`, 'ID of the governance initiative assignment');
    return parts.join('\n\n');
  },
});

S({
  id: 'rbac', name: 'Role-Based Access Control', cat: 'landingzone', diff: 'Intermediate', file: 'rbac',
  res: ['azurerm_role_definition', 'azurerm_role_assignment'],
  kw: 'rbac iam role assignment custom role entra permissions least privilege access',
  azdoc: MS + 'role-based-access-control/overview',
  desc: 'Role assignments for Microsoft Entra groups, plus an optional least-privilege custom role.',
  use: 'Give a platform team Contributor on a landing zone and an operations group a custom "VM Operator" role.',
  fields: [
    { k: 'scope', l: 'Assignment scope', t: 'select', o: ['Resource group', 'Subscription', 'Management group'], d: 'Resource group', h: 'Management group falls back to the subscription when Management Groups is not selected.' },
    { k: 'custom_role', l: 'Create a custom "VM Operator" role', t: 'bool', d: true, h: 'Start, restart and deallocate VMs, nothing else.' },
    { k: 'note', t: 'note', l: 'Principal IDs are Entra object IDs, set in terraform.tfvars. Assign roles to groups, not individual users.' },
  ],
  assume: ['var.role_assignments is empty by default. Fill it with group object IDs and built-in role names.'],
  guide: ['Prefer built-in roles. Custom roles need maintenance when Azure adds actions.', 'Use Privileged Identity Management for standing Owner or User Access Administrator access.'],
  gen(c, x) {
    let scope;
    if (c.scope === 'Management group' && x.has('mgmt_groups')) scope = 'azurerm_management_group.root.id';
    else if (c.scope === 'Resource group') scope = x.rg('landingzone').id;
    else scope = x.sub() + '.id';
    x.v('role_assignments', 'map(object({\n  role_definition_name = string\n  principal_id         = string\n  principal_type       = optional(string, "Group")\n}))', 'Built-in role assignments, keyed by a short label. principal_id is an Entra object ID.', {}, { condition: 'alltrue([for a in values(var.role_assignments) : contains(["User", "Group", "ServicePrincipal"], a.principal_type)])', error: 'principal_type must be User, Group or ServicePrincipal.' });
    const parts = [R('resource "azurerm_role_assignment" "this"', ['for_each = var.role_assignments', '', `scope = ${scope}`, 'role_definition_name = each.value.role_definition_name', 'principal_id = each.value.principal_id', 'principal_type = each.value.principal_type'])];
    if (c.custom_role) {
      x.v('vm_operator_principal_ids', 'list(string)', 'Entra object IDs (groups) that get the custom VM Operator role', []);
      parts.unshift(R('resource "azurerm_role_definition" "vm_operator"', [
        'name = "VM Operator (${local.name_prefix})"', `scope = ${scope}`, 'description = "Read, start, restart and deallocate virtual machines."', '',
        B('permissions', ['actions = [\n  "Microsoft.Compute/virtualMachines/read",\n  "Microsoft.Compute/virtualMachines/start/action",\n  "Microsoft.Compute/virtualMachines/restart/action",\n  "Microsoft.Compute/virtualMachines/deallocate/action",\n  "Microsoft.Compute/virtualMachines/powerOff/action",\n]', 'not_actions = []']), '',
        `assignable_scopes = [${scope}]`,
      ]));
      parts.push(R('resource "azurerm_role_assignment" "vm_operator"', ['for_each = toset(var.vm_operator_principal_ids)', '', `scope = ${scope}`, 'role_definition_id = azurerm_role_definition.vm_operator.role_definition_resource_id', 'principal_id = each.value', 'principal_type = "Group"']));
      x.o('vm_operator_role_id', 'azurerm_role_definition.vm_operator.role_definition_resource_id', 'Resource ID of the custom VM Operator role');
    }
    return parts.join('\n\n');
  },
});

S({
  id: 'locks', name: 'Resource Locks', cat: 'landingzone', diff: 'Beginner', file: 'locks',
  res: ['azurerm_management_lock'], deps: ['resource_group'], kw: 'lock cannotdelete readonly protect delete governance',
  azdoc: MS + 'azure-resource-manager/management/lock-resources',
  desc: 'A CanNotDelete or ReadOnly lock on the project resource groups.',
  use: 'Stop an accidental delete of a production resource group, even by an Owner.',
  fields: [
    { k: 'level', l: 'Lock level', t: 'select', o: ['CanNotDelete', 'ReadOnly'], d: 'CanNotDelete', h: 'ReadOnly also blocks many write operations, such as listing storage keys or scaling. Use it sparingly.' },
  ],
  assume: ['terraform destroy fails while the lock exists. Remove the lock (or this file) first.'],
  gen(c, x) {
    x.v('lock_level', 'string', 'CanNotDelete or ReadOnly', c.level, { condition: 'contains(["CanNotDelete", "ReadOnly"], var.lock_level)', error: 'lock_level must be CanNotDelete or ReadOnly.' });
    const per = x.has('resource_group') && x.cfgOf('resource_group').layout === 'One per workload layer';
    x.o('lock_ids', per ? '{ for k, l in azurerm_management_lock.rg : k => l.id }' : 'azurerm_management_lock.rg.id', 'ID of each resource lock');
    if (per) return R('resource "azurerm_management_lock" "rg"', ['for_each = azurerm_resource_group.layer', '', 'name = "lock-${each.value.name}"', 'scope = each.value.id', 'lock_level = var.lock_level', 'notes = "Managed by Terraform. Remove the lock before deleting this resource group."']);
    return R('resource "azurerm_management_lock" "rg"', ['name = "lock-${local.name_prefix}"', `scope = ${x.rg('landingzone').id}`, 'lock_level = var.lock_level', 'notes = "Managed by Terraform. Remove the lock before deleting this resource group."']);
  },
});

S({
  id: 'budget', name: 'Cost Governance (Budget)', cat: 'landingzone', diff: 'Intermediate', file: 'budget',
  res: ['azurerm_consumption_budget_subscription', 'azurerm_consumption_budget_resource_group'],
  kw: 'budget cost management finops spend alert governance',
  azdoc: MS + 'cost-management-billing/costs/tutorial-acm-create-budgets',
  desc: 'A monthly budget with actual and forecast alerts to email and, when selected, the action group.',
  use: 'Find out at 80% of the monthly budget, not when the invoice arrives.',
  suggest: () => ['action_group'],
  fields: [
    { k: 'scope', l: 'Budget scope', t: 'select', o: ['Subscription', 'Resource group'], d: 'Subscription' },
    { k: 'amount', l: 'Monthly amount (billing currency)', t: 'number', d: 500 },
    { k: 'emails', l: 'Contact emails', t: 'list', d: 'finops@example.com' },
  ],
  assume: ['The budget starts on the first day of the current month; Azure requires the first of a month.', 'Budgets alert. They never stop or delete resources.'],
  gen(c, x) {
    const d = new Date();
    const start = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01T00:00:00Z`;
    x.v('budget_amount', 'number', 'Monthly budget in the billing currency', +c.amount, { condition: 'var.budget_amount > 0', error: 'budget_amount must be positive.' });
    x.v('budget_start_date', 'string', 'Budget start, the first day of a month in RFC3339', start);
    x.v('budget_contact_emails', 'list(string)', 'Emails that receive budget alerts', csv(c.emails));
    const groups = x.has('action_group') ? 'contact_groups = [azurerm_monitor_action_group.main.id]' : null;
    const sub = c.scope === 'Subscription';
    const body = [
      'name = "budget-${local.name_prefix}"', sub ? `subscription_id = ${x.sub()}.id` : `resource_group_id = ${x.rg('landingzone').id}`, 'amount = var.budget_amount', 'time_grain = "Monthly"', '',
      B('time_period', ['start_date = var.budget_start_date']), '',
      B('notification', ['enabled = true', 'threshold = 80', 'threshold_type = "Actual"', 'operator = "GreaterThan"', 'contact_emails = var.budget_contact_emails', groups]), '',
      B('notification', ['enabled = true', 'threshold = 100', 'threshold_type = "Forecasted"', 'operator = "GreaterThan"', 'contact_emails = var.budget_contact_emails', groups]), '',
      '# Azure normalises the start date; ignoring it avoids a perpetual diff.',
      B('lifecycle', ['ignore_changes = [time_period]']),
    ];
    x.o('budget_id', `${sub ? 'azurerm_consumption_budget_subscription' : 'azurerm_consumption_budget_resource_group'}.main.id`, 'ID of the budget');
    return R(`resource "${sub ? 'azurerm_consumption_budget_subscription' : 'azurerm_consumption_budget_resource_group'}" "main"`, body);
  },
});
