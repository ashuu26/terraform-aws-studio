/* ==========================================================================
   landingzone.js — AWS Landing Zone: the configuration model, starter
   templates, SCP templates, the AWS Control Tower control catalog, static
   checks and the Terraform generator for the landing_zone service.

   Sources of truth (checked 2026-10-01):
   - hashicorp/aws docs for aws_organizations_organization, _organizational_unit,
     _account, _policy, _policy_attachment, aws_controltower_landing_zone,
     aws_controltower_baseline, aws_controltower_control and
     aws_servicecatalog_provisioned_product.
   - AWS Control Tower user guide: "Launch your landing zone using the APIs"
     (manifest for landing zone 4.0), "Configure your landing zone" (service
     roles), "Compatibility of OU baselines" (baseline 5.0 for LZ 4.0),
     "Identifiers for legacy controls" and "Automate account provisioning".
   - aws-samples/service-control-policy-examples for the SCP templates.
   Nothing here is generated for a capability the provider does not support.
   ========================================================================== */

const LZ_ID = 'landing_zone';
const LZ_MODEL_INFO = {
  enterprise: { label: 'Enterprise', title: 'Enterprise Landing Zone', sub: 'AWS Control Tower + AWS Organizations' },
  'non-enterprise': { label: 'Non-Enterprise', title: 'Non-Enterprise Landing Zone', sub: 'AWS Organizations based multi-account foundation' },
};
// Factual capability comparison: no column is ranked above the other.
const LZ_COMPARE = [
  ['AWS Organizations', '✓', '✓'],
  ['Organizational Units', '✓', '✓'],
  ['Multiple AWS accounts', '✓', '✓'],
  ['SCP governance', '✓', '✓'],
  ['AWS Control Tower', '✓', 'Not selected'],
  ['Account Factory capabilities', '✓ (Service Catalog product)', 'Not applicable'],
  ['Centralized logging and audit accounts', 'Configured by Control Tower', 'User-defined'],
  ['Managed controls (preventive and detective)', 'Control Tower controls', 'Customer SCPs only'],
  ['Landing zone automation', 'Control Tower-oriented', 'Terraform-oriented'],
  ['Terraform resources involved', 'aws_organizations_* + aws_controltower_*', 'aws_organizations_*'],
];
// Real service principals that support trusted access with AWS Organizations.
const LZ_PRINCIPALS = [
  'cloudtrail.amazonaws.com', 'config.amazonaws.com', 'config-multiaccountsetup.amazonaws.com', 'sso.amazonaws.com',
  'controltower.amazonaws.com', 'member.org.stacksets.cloudformation.amazonaws.com', 'securityhub.amazonaws.com',
  'guardduty.amazonaws.com', 'access-analyzer.amazonaws.com', 'ram.amazonaws.com', 'backup.amazonaws.com',
  'account.amazonaws.com', 'ipam.amazonaws.com',
];
const LZ_ENVS = ['production', 'non-production', 'development', 'shared', 'security', 'sandbox'];
const LZ_ACCT_TYPES = ['Workload', 'Security', 'Logging', 'Network', 'Shared services', 'Sandbox'];
// Core accounts. "need" is what the selected architecture asks for, never stronger than AWS documents.
const LZ_CORE = {
  enterprise: [
    { core: 'log_archive', name: 'log-archive', type: 'Logging', ou: 'security', env: 'security', need: 'Required', why: 'Control Tower centralized logging needs a log archive account (landing zone manifest centralizedLogging.accountId).' },
    { core: 'audit', name: 'audit', type: 'Security', ou: 'security', env: 'security', need: 'Required', why: 'Control Tower security roles and AWS Config integration need an audit account (securityRoles.accountId and config.accountId).' },
    { core: 'network', name: 'network', type: 'Network', ou: 'infrastructure', env: 'shared', need: 'Optional', why: 'A common home for Transit Gateway, VPN and shared VPCs.' },
    { core: 'shared_services', name: 'shared-services', type: 'Shared services', ou: 'infrastructure', env: 'shared', need: 'Recommended', why: 'Shared tooling such as CI/CD, monitoring or backup administration.' },
  ],
  'non-enterprise': [
    { core: 'security', name: 'security', type: 'Security', ou: 'security', env: 'security', need: 'Recommended', why: 'A delegated administrator account for security services keeps security tooling out of workload accounts.' },
    { core: 'log_archive', name: 'log-archive', type: 'Logging', ou: 'security', env: 'security', need: 'Recommended', why: 'Central, tamper-resistant storage for CloudTrail and AWS Config logs.' },
    { core: 'shared_services', name: 'shared-services', type: 'Shared services', ou: 'infrastructure', env: 'shared', need: 'Optional', why: 'Shared tooling such as CI/CD, monitoring or backup administration.' },
    { core: 'network', name: 'network', type: 'Network', ou: 'infrastructure', env: 'shared', need: 'Optional', why: 'A common home for Transit Gateway, VPN and shared VPCs.' },
  ],
};

/* ---------------- helpers ---------------- */
const lzClone = o => JSON.parse(JSON.stringify(o));
const LZ_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
function lzKey(name, taken) {
  let k = String(name || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'item';
  if (/^[0-9]/.test(k)) k = 'n_' + k;
  let out = k, i = 2;
  while (taken && taken.has(out)) out = k + '_' + i++;
  return out;
}
function lzOuDepth(c, key) {
  let d = 0, k = key;
  const seen = new Set();
  while (k && k !== 'root') {
    const ou = c.ous.find(o => o.key === k);
    if (!ou || seen.has(k)) return 99;
    seen.add(k); d++; k = ou.parent;
  }
  return d;
}
// Parents before children, then in the order the user created them.
function lzOuOrder(c) { return c.ous.map((o, i) => ({ o, i, d: lzOuDepth(c, o.key) })).sort((a, b) => a.d - b.d || a.i - b.i).map(x => x.o); }
const lzOu = (c, k) => c.ous.find(o => o.key === k);
const lzActiveAccounts = c => c.accounts.filter(a => a.enabled !== false);
const lzFactory = (c, a) => c.model === 'enterprise' && c.ct.enabled && a.mode === 'create' && a.factory && !a.core;
const lzCtOn = c => c.model === 'enterprise' && c.ct.enabled;
const lzCtCreate = c => lzCtOn(c) && c.ct.mode === 'create';
function lzOuPath(c, key) {
  const parts = [];
  let k = key; const seen = new Set();
  while (k && k !== 'root' && !seen.has(k)) { seen.add(k); const o = lzOu(c, k); if (!o) break; parts.unshift(o.name); k = o.parent; }
  return 'Root' + (parts.length ? ' / ' + parts.join(' / ') : '');
}
// True when OU ouKey is the ancestor OU itself or sits anywhere below it.
function lzUnder(c, ouKey, ancestor) { let k = ouKey; const seen = new Set(); while (k && k !== 'root' && !seen.has(k)) { if (k === ancestor) return true; seen.add(k); const o = lzOu(c, k); k = o ? o.parent : null; } return false; }
function lzTopOu(c, key) { let k = key; const seen = new Set(); while (k && !seen.has(k)) { seen.add(k); const o = lzOu(c, k); if (!o || o.parent === 'root') return o ? o.key : null; k = o.parent; } return null; }
function lzTargets(c, scp) {
  // Valid targets the user picked: root, an OU, or an account Terraform knows the ID of.
  return (scp.targets || []).map(t => {
    if (t === 'root') return { t, kind: 'root', label: 'Root' };
    const [kind, key] = t.split(':');
    if (kind === 'ou') { const o = lzOu(c, key); return o ? { t, kind, key, label: o.name + ' OU' } : { t, kind, key, missing: true, label: key }; }
    const a = lzActiveAccounts(c).find(x => x.key === key);
    return a ? { t, kind: 'acct', key, label: a.name, acct: a } : { t, kind: 'acct', key, missing: true, label: key };
  });
}

/* ---------------- starter templates ---------------- */
function lzAccount(over) {
  return Object.assign({ key: '', name: '', email: '', core: null, enabled: true, type: 'Workload', env: 'production', ou: 'root', mode: 'create', id: '', factory: false, tags: {}, sso: { email: '', first: '', last: '' } }, over);
}
function lzTemplate(model, region) {
  const ent = model === 'enterprise';
  const ou = (key, name, parent, desc) => ({ key, name, parent, desc });
  const ous = ent ? [
    ou('security', 'Security', 'root', 'Log archive and audit accounts used by Control Tower'),
    ou('infrastructure', 'Infrastructure', 'root', 'Shared network and shared services accounts'),
    ou('workloads', 'Workloads', 'root', 'Business application accounts'),
    ou('production', 'Production', 'workloads', 'Production workload accounts'),
    ou('non_production', 'Non-Production', 'workloads', 'Development and test workload accounts'),
    ou('sandbox', 'Sandbox', 'root', 'Experimentation accounts with no production data'),
    ou('suspended', 'Suspended', 'root', 'Accounts waiting to be closed'),
  ] : [
    ou('security', 'Security', 'root', 'Security tooling and log storage'),
    ou('infrastructure', 'Infrastructure', 'root', 'Shared network and shared services accounts'),
    ou('production', 'Production', 'root', 'Production workload accounts'),
    ou('non_production', 'Non-Production', 'root', 'Development and test workload accounts'),
    ou('sandbox', 'Sandbox', 'root', 'Experimentation accounts with no production data'),
  ];
  const accounts = LZ_CORE[model].map(d => lzAccount({
    key: d.core, name: d.name, email: `aws-${d.name}@example.com`, core: d.core, type: d.type, env: d.env, ou: d.ou,
    enabled: d.need !== 'Optional',
  }));
  const w = (name, env, ouKey, tags) => lzAccount({ key: lzKey(name), name, email: `aws-${name}@example.com`, env, ou: ouKey, tags });
  accounts.push(
    w('payments-prod', 'production', 'production', { Application: 'Payments', Owner: 'Finance', CostCenter: 'FIN001' }),
    w('payments-nonprod', 'non-production', 'non_production', { Application: 'Payments', Owner: 'Finance', CostCenter: 'FIN001' }),
    Object.assign(w('sandbox-dev', 'sandbox', 'sandbox', { Owner: 'Platform' }), { type: 'Sandbox' }),
  );
  return {
    model,
    org: { mode: 'create', id: '', label: 'my-aws-organization', feature_set: 'ALL', scp: true, trusted: true, protect: true,
      principals: ent ? ['cloudtrail.amazonaws.com', 'config.amazonaws.com', 'sso.amazonaws.com'] : ['cloudtrail.amazonaws.com', 'config.amazonaws.com', 'sso.amazonaws.com', 'ram.amazonaws.com'] },
    mgmt: { name: 'management', env: 'production', email: 'management@example.com' },
    ous, accounts,
    // Control Tower enrolls accounts through AWSControlTowerExecution, an admin role trusted by the management account.
    acct: { strategy: 'create', role_name: ent ? 'AWSControlTowerExecution' : 'OrganizationAccountAccessRole', billing: 'ALLOW', close_on_deletion: false, protect: true },
    scps: [],
    ct: {
      enabled: ent, mode: 'create', version: '4.0', regions: [region || 'ap-southeast-1'], log_days: 365, access_days: 3650,
      config: true, security_roles: true, access_mgmt: true, kms: false, roles: true,
      baseline_version: '5.0', baselines: ent ? ['infrastructure', 'workloads', 'production', 'non_production', 'sandbox'] : [],
      controls: ent ? [{ id: 'AWS-GR_RESTRICT_ROOT_USER_ACCESS_KEYS', ous: ['workloads'] }] : [],
      factory: false,
    },
  };
}

/* ---------------- SCP templates (from aws-samples/service-control-policy-examples) ---------------- */
const SCP_TEMPLATES = {
  region: { name: 'Region restriction', slug: 'deny-unapproved-regions', desc: 'Deny actions outside approved AWS Regions. Global services (IAM, Organizations, Route 53, CloudFront and others) stay allowed.' },
  root: { name: 'Root user restrictions', slug: 'restrict-root-user', desc: 'Deny actions by the root user of member accounts, except centralized root access sessions (aws:AssumedRoot).' },
  security: { name: 'Security service protection', slug: 'protect-security-services', desc: 'Prevent disabling or disassociating GuardDuty, Security Hub and AWS Config.' },
  logging: { name: 'Logging protection', slug: 'protect-central-logging', desc: 'Prevent stopping, deleting or changing CloudTrail trails and deleting or shortening central log groups.' },
  encryption: { name: 'Encryption requirements', slug: 'require-encryption', desc: 'Prevent turning off EBS encryption by default and, optionally, deny S3 uploads without an encryption header.' },
  leave: { name: 'Account leave organization', slug: 'deny-leave-organization', desc: 'Prevent member accounts from leaving the organization.' },
  custom: { name: 'Custom JSON', slug: 'custom-policy', desc: 'Write the policy document yourself.' },
};
const SCP_REGION_NOT_ACTIONS = ['a4b:*', 'acm:*', 'aws-marketplace-management:*', 'aws-marketplace:*', 'aws-portal:*', 'budgets:*', 'ce:*', 'chime:*', 'cloudfront:*', 'config:*', 'cur:*', 'directconnect:*', 'ec2:DescribeRegions', 'ec2:DescribeTransitGateways', 'ec2:DescribeVpnGateways', 'fms:*', 'globalaccelerator:*', 'health:*', 'iam:*', 'importexport:*', 'kms:*', 'mobileanalytics:*', 'networkmanager:*', 'organizations:*', 'pricing:*', 'route53:*', 'route53domains:*', 'route53-recovery-cluster:*', 'route53-recovery-control-config:*', 'route53-recovery-readiness:*', 's3:GetAccountPublic*', 's3:ListAllMyBuckets', 's3:ListMultiRegionAccessPoints', 's3:PutAccountPublic*', 'shield:*', 'sts:*', 'support:*', 'trustedadvisor:*', 'waf-regional:*', 'waf:*', 'wafv2:*', 'wellarchitected:*'];
const SCP_SECURITY_ACTIONS = {
  GuardDuty: ['guardduty:DeleteDetector', 'guardduty:DisassociateFromMasterAccount', 'guardduty:DisassociateMembers', 'guardduty:StopMonitoringMembers', 'guardduty:UpdateDetector'],
  'Security Hub': ['securityhub:BatchDisableStandards', 'securityhub:DeleteMembers', 'securityhub:DisableSecurityHub', 'securityhub:DisassociateFromAdministratorAccount', 'securityhub:DisassociateFromMasterAccount', 'securityhub:DisassociateMembers'],
  'AWS Config': ['config:DeleteConfigurationAggregator', 'config:DeleteConfigurationRecorder', 'config:DeleteDeliveryChannel', 'config:DeleteRetentionConfiguration', 'config:StopConfigurationRecorder'],
};
function lzNewScp(c, template, region) {
  const t = SCP_TEMPLATES[template] || SCP_TEMPLATES.custom;
  const taken = new Set(c.scps.map(s => s.key));
  const ent = c.model === 'enterprise';
  return {
    key: lzKey(t.slug, taken), name: t.slug, desc: t.desc, mode: template === 'custom' ? 'json' : 'template', template: template === 'custom' ? 'region' : template,
    regions: [region || 'ap-southeast-1'],
    exempt: ent ? 'arn:aws:iam::*:role/AWSControlTowerExecution' : '',
    services: 'GuardDuty, Security Hub, AWS Config',
    trails: 'arn:aws:cloudtrail:*:*:trail/*',
    log_groups: ent ? 'arn:aws:logs:*:*:log-group:aws-controltower/CloudTrailLogs*' : 'arn:aws:logs:*:*:log-group:org-trail*',
    enc_ebs: true, enc_s3: false,
    json: '{\n  "Version": "2012-10-17",\n  "Statement": [\n    {\n      "Sid": "DenyExample",\n      "Effect": "Deny",\n      "Action": "organizations:LeaveOrganization",\n      "Resource": "*"\n    }\n  ]\n}',
    targets: [], enabled: true,
  };
}
// Returns the policy document as a plain object. opts.regions can replace the region list (for example with a variable reference).
function scpPolicy(s, opts = {}) {
  if (s.mode === 'json') { try { return JSON.parse(s.json); } catch (e) { return null; } }
  const exempt = csv(s.exempt);
  const notExempt = exempt.length ? { ArnNotLike: { 'aws:PrincipalARN': exempt.length === 1 ? exempt[0] : exempt } } : {};
  const st = [];
  if (s.template === 'region') st.push({ Sid: 'DenyOutsideApprovedRegions', Effect: 'Deny', NotAction: SCP_REGION_NOT_ACTIONS, Resource: '*', Condition: Object.assign({ StringNotEquals: { 'aws:RequestedRegion': opts.regions || s.regions } }, notExempt) });
  if (s.template === 'root') st.push({ Sid: 'DenyRootUser', Effect: 'Deny', Action: '*', Resource: '*', Condition: { ArnLike: { 'aws:PrincipalArn': ['arn:aws:iam::*:root'] }, Null: { 'aws:AssumedRoot': 'true' } } });
  if (s.template === 'security') {
    const acts = csv(s.services).flatMap(k => SCP_SECURITY_ACTIONS[k] || []);
    if (acts.length) st.push(Object.assign({ Sid: 'DenySecurityServiceChanges', Effect: 'Deny', Action: acts, Resource: '*' }, exempt.length ? { Condition: notExempt } : {}));
  }
  if (s.template === 'logging') {
    const trails = csv(s.trails), groups = csv(s.log_groups);
    if (trails.length) st.push(Object.assign({ Sid: 'DenyCloudTrailChanges', Effect: 'Deny', Action: ['cloudtrail:DeleteTrail', 'cloudtrail:PutEventSelectors', 'cloudtrail:StopLogging', 'cloudtrail:UpdateTrail'], Resource: trails.length === 1 ? trails[0] : trails }, exempt.length ? { Condition: notExempt } : {}));
    if (groups.length) st.push(Object.assign({ Sid: 'DenyCentralLogGroupChanges', Effect: 'Deny', Action: ['logs:DeleteLogGroup', 'logs:DeleteLogStream', 'logs:PutRetentionPolicy'], Resource: groups.length === 1 ? groups[0] : groups }, exempt.length ? { Condition: notExempt } : {}));
  }
  if (s.template === 'encryption') {
    if (s.enc_ebs) st.push(Object.assign({ Sid: 'DenyDisablingEbsEncryptionByDefault', Effect: 'Deny', Action: ['ec2:DisableEbsEncryptionByDefault'], Resource: '*' }, exempt.length ? { Condition: notExempt } : {}));
    if (s.enc_s3) st.push({ Sid: 'DenyS3UploadsWithoutEncryptionHeader', Effect: 'Deny', Action: 's3:PutObject', Resource: '*', Condition: { Null: { 's3:x-amz-server-side-encryption': 'true' } } });
  }
  if (s.template === 'leave') st.push({ Sid: 'DenyLeaveOrganization', Effect: 'Deny', Action: ['organizations:LeaveOrganization'], Resource: '*' });
  return { Version: '2012-10-17', Statement: st };
}
// SCP size limit is 5,120 characters; jsonencode() sends minified JSON.
const scpSize = doc => JSON.stringify(doc).length;

/* ---------------- AWS Control Tower control catalog ----------------
   Legacy Regional identifiers from "Identifiers for legacy controls". The provider
   accepts strongly recommended and elective controls (plus Region deny). */
const CT_CONTROLS = [
  { id: 'AWS-GR_RESTRICT_ROOT_USER_ACCESS_KEYS', name: 'Disallow creation of access keys for the root user', beh: 'Preventive', impl: 'SCP', guid: 'Strongly recommended', cat: 'Security', purpose: 'Denies iam:CreateAccessKey for the root user, so long-term root keys cannot be created.' },
  { id: 'AWS-GR_RESTRICT_ROOT_USER', name: 'Disallow actions as a root user', beh: 'Preventive', impl: 'SCP', guid: 'Strongly recommended', cat: 'Account Governance', purpose: 'Denies all actions by the root user of member accounts.' },
  { id: 'AWS-GR_ROOT_ACCOUNT_MFA_ENABLED', name: 'Detect whether MFA for the root user is enabled', beh: 'Detective', impl: 'AWS Config rule', guid: 'Strongly recommended', cat: 'Security', purpose: 'Reports accounts whose root user has no MFA.' },
  { id: 'AWS-GR_MFA_ENABLED_FOR_IAM_CONSOLE_ACCESS', name: 'Detect whether MFA is enabled for IAM users with console access', beh: 'Detective', impl: 'AWS Config rule', guid: 'Elective', cat: 'Security', purpose: 'Reports IAM users who can sign in to the console without MFA.' },
  { id: 'AWS-GR_ENCRYPTED_VOLUMES', name: 'Detect whether EBS volumes attached to EC2 instances are encrypted', beh: 'Detective', impl: 'AWS Config rule', guid: 'Strongly recommended', cat: 'Compliance', purpose: 'Reports attached EBS volumes that are not encrypted.' },
  { id: 'AWS-GR_RDS_STORAGE_ENCRYPTED', name: 'Detect whether storage encryption is enabled for RDS DB instances', beh: 'Detective', impl: 'AWS Config rule', guid: 'Strongly recommended', cat: 'Compliance', purpose: 'Reports RDS DB instances without encryption at rest.' },
  { id: 'AWS-GR_S3_VERSIONING_ENABLED', name: 'Detect whether versioning is enabled for S3 buckets', beh: 'Detective', impl: 'AWS Config rule', guid: 'Elective', cat: 'Compliance', purpose: 'Reports buckets without versioning.' },
  { id: 'AWS-GR_RESTRICT_S3_CROSS_REGION_REPLICATION', name: 'Disallow cross-Region replication for S3 buckets', beh: 'Preventive', impl: 'SCP', guid: 'Elective', cat: 'Compliance', purpose: 'Denies s3:PutReplicationConfiguration to keep data in one Region.' },
  { id: 'AWS-GR_RDS_INSTANCE_PUBLIC_ACCESS_CHECK', name: 'Detect whether public access to RDS DB instances is enabled', beh: 'Detective', impl: 'AWS Config rule', guid: 'Strongly recommended', cat: 'Security', purpose: 'Reports RDS instances that are publicly accessible.' },
  { id: 'AWS-GR_S3_BUCKET_PUBLIC_READ_PROHIBITED', name: 'Detect whether public read access to S3 buckets is allowed', beh: 'Detective', impl: 'AWS Config rule', guid: 'Strongly recommended', cat: 'Security', purpose: 'Reports buckets whose policy or ACL allows public reads.' },
  { id: 'AWS-GR_S3_BUCKET_PUBLIC_WRITE_PROHIBITED', name: 'Detect whether public write access to S3 buckets is allowed', beh: 'Detective', impl: 'AWS Config rule', guid: 'Strongly recommended', cat: 'Security', purpose: 'Reports buckets whose policy or ACL allows public writes.' },
  { id: 'AWS-GR_AUDIT_BUCKET_POLICY_CHANGES_PROHIBITED', name: 'Disallow policy changes to an S3 bucket', beh: 'Preventive', impl: 'SCP', guid: 'Elective', cat: 'Governance', purpose: 'Denies s3:PutBucketPolicy except for AWSControlTowerExecution.' },
  { id: 'AWS-GR_RESTRICT_S3_DELETE_WITHOUT_MFA', name: 'Disallow delete actions on S3 buckets without MFA', beh: 'Preventive', impl: 'SCP', guid: 'Elective', cat: 'Governance', purpose: 'Denies object and bucket deletes when MFA is not present.' },
  { id: 'AWS-GR_EC2_VOLUME_INUSE_CHECK', name: 'Detect whether EBS volumes are attached to EC2 instances', beh: 'Detective', impl: 'AWS Config rule', guid: 'Strongly recommended', cat: 'Governance', purpose: 'Reports unattached EBS volumes.' },
  { id: 'AWS-GR_DETECT_CLOUDTRAIL_ENABLED_ON_MEMBER_ACCOUNTS', name: 'Detect whether an account has CloudTrail or CloudTrail Lake enabled', beh: 'Detective', impl: 'AWS Config rule', guid: 'Strongly recommended', cat: 'Logging', purpose: 'Reports accounts with neither CloudTrail nor CloudTrail Lake enabled.' },
  { id: 'AWS-GR_AUDIT_BUCKET_LOGGING_ENABLED', name: 'Disallow modification of server access logging for an S3 bucket', beh: 'Preventive', impl: 'SCP', guid: 'Elective', cat: 'Logging', purpose: 'Denies s3:PutBucketLogging except for AWSControlTowerExecution.' },
  { id: 'AWS-GR_RESTRICTED_SSH', name: 'Detect whether unrestricted SSH from the internet is allowed', beh: 'Detective', impl: 'AWS Config rule', guid: 'Strongly recommended', cat: 'Networking', purpose: 'Reports security groups that allow SSH from 0.0.0.0/0 or ::/0.' },
  { id: 'AWS-GR_RESTRICTED_COMMON_PORTS', name: 'Detect whether unrestricted incoming TCP traffic is allowed', beh: 'Detective', impl: 'AWS Config rule', guid: 'Strongly recommended', cat: 'Networking', purpose: 'Reports security groups open to the internet on ports such as 3389 and 3306.' },
  { id: 'AWS-GR_DISALLOW_VPC_INTERNET_ACCESS', name: 'Disallow internet access for a customer-managed VPC', beh: 'Preventive', impl: 'SCP', guid: 'Elective', cat: 'Networking', purpose: 'Denies creating or attaching internet, egress-only and carrier gateways.' },
  { id: 'AWS-GR_DISALLOW_VPN_CONNECTIONS', name: 'Disallow VPN connections', beh: 'Preventive', impl: 'SCP', guid: 'Elective', cat: 'Networking', purpose: 'Denies Site-to-Site VPN and Client VPN creation and changes.' },
  { id: 'AWS-GR_DISALLOW_CROSS_REGION_NETWORKING', name: 'Disallow cross-Region networking', beh: 'Preventive', impl: 'SCP', guid: 'Elective', cat: 'Networking', purpose: 'Denies VPC and Transit Gateway peering, CloudFront and Global Accelerator changes.' },
];
const CT_CATS = ['Security', 'Compliance', 'Governance', 'Logging', 'Networking', 'Account Governance'];
const ctControl = id => CT_CONTROLS.find(x => x.id === id);

/* ---------------- static checks on the model ---------------- */
// Each item: { level: error|warn|info|ok, area, msg, step }. step is the wizard step that fixes it.
function lzCheck(c, g) {
  const out = [];
  const add = (level, area, msg, step) => out.push({ level, area, msg, step });
  if (!c || !c.model) { add('error', 'Model', 'Choose Enterprise or Non-Enterprise.', 0); return out; }
  const ent = c.model === 'enterprise';
  const region = (g && g.region) || 'ap-southeast-1';
  // Organization
  const fsAll = c.org.feature_set === 'ALL';
  if (c.org.mode === 'import' && !/^o-[a-z0-9]{10,32}$/.test(c.org.id || '')) add('error', 'Organization', 'Importing an organization needs its ID, such as o-a1b2c3d4e5.', 1);
  if (!fsAll && (c.org.scp || c.org.trusted)) add('error', 'Organization', 'SCPs and trusted access need the ALL feature set. CONSOLIDATED_BILLING supports neither.', 1);
  if (!fsAll && lzCtOn(c)) add('error', 'Organization', 'AWS Control Tower needs an organization with all features enabled.', 1);
  if (c.org.mode === 'existing') add('info', 'Organization', 'The organization is read with a data source. Terraform will not enable SCPs or trusted access on it: make sure they are already enabled.', 1);
  if (c.mgmt.email && !LZ_EMAIL_RE.test(c.mgmt.email)) add('warn', 'Organization', `Management account email "${c.mgmt.email}" does not look like an email address.`, 1);
  // OUs
  const names = new Map();
  for (const o of c.ous) {
    if (!o.name || !o.name.trim()) add('error', 'OUs', 'An OU has no name.', 2);
    else if (o.name.length > 128) add('error', 'OUs', `OU name "${o.name.slice(0, 20)}…" is longer than 128 characters.`, 2);
    if (o.parent !== 'root' && !lzOu(c, o.parent)) add('error', 'OUs', `OU "${o.name}" has a parent that no longer exists.`, 2);
    const d = lzOuDepth(c, o.key);
    if (d === 99) add('error', 'OUs', `OU "${o.name}" is part of a parent loop.`, 2);
    else if (d > 5) add('error', 'OUs', `OU "${o.name}" is ${d} levels deep. AWS Organizations allows five levels of OUs under the root.`, 2);
    const k = o.parent + '/' + String(o.name).toLowerCase();
    if (names.has(k)) add('error', 'OUs', `Duplicate OU name "${o.name}" under the same parent.`, 2); else names.set(k, o);
  }
  const parentsByName = {};
  for (const o of c.ous) { const n = String(o.name).toLowerCase(); (parentsByName[n] = parentsByName[n] || new Set()).add(o.parent); }
  for (const [n, ps] of Object.entries(parentsByName)) if (n && ps.size > 1) add('warn', 'OUs', `The OU name "${n}" is used under ${ps.size} different parents. It is allowed, but easy to confuse.`, 2);
  if (!c.ous.length) add('warn', 'OUs', 'No OUs: every account will sit directly under the root.', 2);
  // Accounts
  const acts = lzActiveAccounts(c);
  const emails = new Map(), anames = new Map(), ids = new Map();
  for (const a of acts) {
    const label = a.name || '(unnamed account)';
    if (!a.name || !a.name.trim()) add('error', 'Accounts', 'An account has no name.', 3);
    else if (a.name.length > 50) add('error', 'Accounts', `Account name "${a.name}" is longer than 50 characters.`, 3);
    if (a.mode !== 'reference') {
      if (!LZ_EMAIL_RE.test(a.email || '')) add('error', 'Accounts', `Account "${label}" needs a valid email address.`, 3);
      else if (a.email.length > 64) add('error', 'Accounts', `The email for "${label}" is longer than 64 characters.`, 3);
      const e = String(a.email || '').toLowerCase();
      if (e && emails.has(e)) add('error', 'Accounts', `Accounts "${emails.get(e)}" and "${label}" use the same email. Every AWS account needs a unique email address.`, 3); else if (e) emails.set(e, label);
    }
    if (a.mode !== 'create' && !/^\d{12}$/.test(a.id || '')) add('error', 'Accounts', `Existing account "${label}" needs its 12-digit account ID.`, 3);
    if (a.mode !== 'create' && a.id) { if (ids.has(a.id)) add('error', 'Accounts', `Accounts "${ids.get(a.id)}" and "${label}" have the same account ID.`, 3); else ids.set(a.id, label); }
    const n = String(a.name || '').toLowerCase();
    if (n && anames.has(n)) add('warn', 'Accounts', `Two accounts are named "${a.name}". AWS allows it, but it makes the console confusing.`, 3); else if (n) anames.set(n, 1);
    if (a.mode !== 'reference') {
      if (!a.ou || a.ou === 'root') add('warn', 'Placement', `Account "${label}" has no target OU, so it is placed directly under the root.`, 4);
      else if (!lzOu(c, a.ou)) add('error', 'Placement', `Account "${label}" points at an OU that no longer exists.`, 4);
    }
    if (lzFactory(c, a)) {
      const reg = new Set([...c.ct.baselines, lzTopOu(c, (acts.find(x => x.core === 'log_archive') || {}).ou)]);
      if (!reg.has(a.ou)) add('error', 'Control Tower', `Account Factory can only place "${label}" in an OU registered with Control Tower. Register its OU in the Control Tower step.`, 6);
    }
  }
  if (!acts.length) add('info', 'Accounts', 'No member accounts yet.', 3);
  if (acts.some(a => a.mode === 'create')) add('info', 'Accounts', 'Creating accounts needs organizations:CreateAccount in the management account and a unique email per account. Closing an account later is limited by AWS quotas.', 3);
  // SCPs
  const perTarget = new Map();
  for (const s of c.scps) {
    const label = s.name || '(unnamed SCP)';
    if (!s.name || !/^[\w+=,.@-]{1,128}$/.test(s.name)) add('error', 'SCPs', `SCP name "${label}" must be 1-128 letters, numbers or + = , . @ - _ characters.`, 5);
    const doc = scpPolicy(s);
    if (!doc) { add('error', 'SCPs', `SCP "${label}": the JSON policy is not valid JSON.`, 5); continue; }
    if (doc.Version !== '2012-10-17') add('error', 'SCPs', `SCP "${label}": "Version" must be "2012-10-17".`, 5);
    if (!Array.isArray(doc.Statement) && typeof doc.Statement !== 'object') add('error', 'SCPs', `SCP "${label}" has no Statement.`, 5);
    else if (Array.isArray(doc.Statement) && !doc.Statement.length) add('error', 'SCPs', `SCP "${label}" has no statements. Pick at least one option for the template.`, 5);
    else for (const st of [].concat(doc.Statement)) {
      if (!['Allow', 'Deny'].includes(st.Effect)) add('error', 'SCPs', `SCP "${label}": every statement needs "Effect": "Allow" or "Deny".`, 5);
      if (!st.Action && !st.NotAction) add('error', 'SCPs', `SCP "${label}": every statement needs Action or NotAction.`, 5);
      if (st.Principal || st.NotPrincipal) add('error', 'SCPs', `SCP "${label}": SCPs do not support Principal or NotPrincipal. Use a condition on aws:PrincipalArn.`, 5);
    }
    if (s.template === 'region' && s.mode === 'template' && !(s.regions || []).length) add('error', 'SCPs', `SCP "${label}" allows no Regions, which would deny almost everything.`, 5);
    const size = scpSize(doc);
    if (size > 5120) add('error', 'SCPs', `SCP "${label}" is ${size} characters. The limit is 5,120.`, 5);
    if (s.enabled === false) { add('info', 'SCPs', `SCP "${label}" is disabled: the policy is created but not attached.`, 5); continue; }
    const ts = lzTargets(c, s);
    if (!ts.length) add('warn', 'SCPs', `SCP "${label}" has no attachment target.`, 5);
    for (const t of ts) {
      if (t.missing) add('error', 'SCPs', `SCP "${label}" targets ${t.kind === 'ou' ? 'an OU' : 'an account'} that no longer exists.`, 5);
      else if (t.kind === 'acct' && lzFactory(c, t.acct)) add('error', 'SCPs', `SCP "${label}" targets "${t.label}", which Account Factory creates. Terraform cannot read that account ID; attach the SCP to its OU instead.`, 5);
      perTarget.set(t.t, (perTarget.get(t.t) || []).concat(label));
    }
  }
  if (c.scps.length && !c.org.scp) add('error', 'SCPs', 'SCPs are defined but the SERVICE_CONTROL_POLICY policy type is not enabled in the Organization step.', 1);
  for (const [t, list] of perTarget) {
    const label = t === 'root' ? 'the root' : (lzTargets(c, { targets: [t] })[0] || {}).label;
    if (list.length > 4) add('error', 'SCPs', `${label} would have ${list.length + 1} SCPs including FullAWSAccess. The quota is 5 per root, OU or account.`, 5);
    else if (lzCtOn(c) && list.length > 2 && t.startsWith('ou:')) add('warn', 'SCPs', `${label}: Control Tower attaches its own SCPs to registered OUs and they count toward the 5-SCP quota.`, 5);
  }
  if (c.scps.some(s => (s.targets || []).includes('root'))) add('info', 'SCPs', 'SCPs attached to the root apply to every member account, but never to the management account.', 5);
  // Control Tower
  if (lzCtOn(c)) {
    const ct = c.ct;
    const log = acts.find(a => a.core === 'log_archive'), audit = acts.find(a => a.core === 'audit');
    if (ct.mode === 'create') {
      if (!log) add('error', 'Control Tower', 'Control Tower centralized logging needs the Log Archive account. Turn it on in the Accounts step.', 3);
      if (!audit) add('error', 'Control Tower', 'Control Tower security roles and AWS Config need the Audit account. Turn it on in the Accounts step.', 3);
      if (log && audit && log.ou !== audit.ou) add('error', 'Control Tower', 'Landing zone 4.0 needs the Log Archive and Audit accounts in the same OU.', 4);
      if (log && log.ou && log.ou !== 'root' && lzOu(c, log.ou) && lzOu(c, log.ou).parent !== 'root') add('error', 'Control Tower', 'The OU that holds the Log Archive and Audit accounts must sit directly under the root.', 4);
      if (log && (!log.ou || log.ou === 'root')) add('error', 'Control Tower', 'Put the Log Archive and Audit accounts in a dedicated OU (for example Security) directly under the root.', 4);
      if (log && audit && log.key === audit.key) add('error', 'Control Tower', 'The Log Archive and Audit accounts must be different accounts.', 3);
      if (!ct.config && (ct.security_roles || ct.access_mgmt)) add('error', 'Control Tower', 'With AWS Config integration off, security roles and IAM Identity Center access management must also be off (landing zone 4.0 rule).', 6);
      if (!(ct.regions || []).includes(region)) add('error', 'Control Tower', `Governed Regions must include the home Region ${region} (the provider region where the landing zone is created).`, 6);
      if (!(+ct.log_days >= 1) || !(+ct.access_days >= 1)) add('error', 'Control Tower', 'Log retention days must be at least 1.', 6);
      if (!/^\d+\.\d+$/.test(ct.version)) add('error', 'Control Tower', 'Landing zone version must look like 4.0.', 6);
      else if (ct.version !== '4.0') add('warn', 'Control Tower', `The manifest is written in the landing zone 4.0 format. Version ${ct.version} may expect a different manifest.`, 6);
      if (!ct.roles) add('info', 'Control Tower', 'Service roles are not generated: AWSControlTowerAdmin, AWSControlTowerCloudTrailRole and AWSControlTowerStackSetRole must already exist in /service-role/.', 6);
    }
    const secOu = log ? lzTopOu(c, log.ou) : null;
    for (const k of ct.baselines) {
      const o = lzOu(c, k);
      if (!o) { add('error', 'Control Tower', 'A registered OU no longer exists.', 6); continue; }
      if (k === secOu) add('warn', 'Control Tower', `OU "${o.name}" holds the service integration accounts. The landing zone governs it; do not register it again with a baseline.`, 6);
      if (o.parent !== 'root' && !ct.baselines.includes(o.parent)) add('warn', 'Control Tower', `OU "${o.name}" is nested under "${lzOu(c, o.parent) ? lzOu(c, o.parent).name : '?'}", which is not registered. Register the parent first.`, 6);
    }
    for (const cc of ct.controls) {
      const d = ctControl(cc.id);
      if (!d) add('error', 'Control Tower', `Unknown control ${cc.id}.`, 6);
      if (!cc.ous.length) add('warn', 'Control Tower', `Control ${cc.id} has no target OU, so it is not generated.`, 6);
      for (const k of cc.ous) if (!lzOu(c, k)) add('error', 'Control Tower', `Control ${cc.id} targets an OU that no longer exists.`, 6);
        else if (!ct.baselines.includes(k) && k !== secOu) add('error', 'Control Tower', `Control ${cc.id} targets "${lzOu(c, k).name}", which is not registered with Control Tower. Controls can only be enabled on registered OUs.`, 6);
    }
    const enrolled = acts.filter(a => a.mode === 'create' && !lzFactory(c, a) && !a.core && ct.baselines.includes(a.ou));
    if (enrolled.length && c.acct.role_name !== 'AWSControlTowerExecution') add('warn', 'Control Tower', `Accounts created in registered OUs (${enrolled.map(a => a.name).join(', ')}) are enrolled only if they have the AWSControlTowerExecution role. Set the account role name to AWSControlTowerExecution.`, 3);
    if (acts.some(a => a.mode !== 'create' && (a.core === 'log_archive' || a.core === 'audit')) && ct.mode === 'create') add('info', 'Control Tower', 'Existing accounts can be the Log Archive or Audit account only during initial landing zone setup.', 3);
    if (ct.access_mgmt && ct.baselines.length) add('info', 'Control Tower', 'With IAM Identity Center enabled, registering an OU needs the IdentityCenterEnabledBaselineArn parameter. Set controltower_identity_center_enabled_baseline_arn after the landing zone exists.', 6);
    if (acts.some(a => lzFactory(c, a))) add('info', 'Control Tower', 'Account Factory accounts need account_factory_provisioning_artifact_id, and the caller must be a principal of the Account Factory portfolio in Service Catalog.', 6);
  }
  if (!out.some(i => i.level === 'error')) add('ok', 'All', 'The landing zone configuration is consistent.', 7);
  return out;
}

/* ---------------- HCL with raw expressions ---------------- */
const RAW = s => ({ __raw: s });
// Quotes user-supplied text as a literal HCL string. IAM policy variables such as ${aws:PrincipalAccount}
// must become $${...} or Terraform treats them as interpolation. (hq() passes ${ through, which some generators rely on.)
const lzq = s => JSON.stringify(String(s)).replace(/\$\{/g, '$$$${').replace(/%\{/g, '%%{');
function lzHv(v) {
  if (v && v.__raw) return v.__raw;
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    if (v.every(x => x === null || typeof x !== 'object' || x.__raw)) { const one = '[' + v.map(lzHv).join(', ') + ']'; if (one.length <= 72) return one; }
    return '[\n' + v.map(x => indentLines(lzHv(x), '  ')).join(',\n') + ',\n]';
  }
  if (v && typeof v === 'object') {
    const ks = Object.keys(v);
    if (!ks.length) return '{}';
    return '{\n' + ks.map(k => indentLines((/^[A-Za-z_][\w-]*$/.test(k) ? k : lzq(k)) + ' = ' + lzHv(v[k]), '  ')).join('\n') + '\n}';
  }
  return typeof v === 'string' ? lzq(v) : hv(v);
}
const lzTagMap = obj => { const ks = Object.keys(obj); return ks.length ? 'tags = {\n' + ks.map(k => '  ' + (/^[A-Za-z_][\w-]*$/.test(k) ? k : lzq(k)) + ' = ' + (obj[k] && obj[k].__raw ? obj[k].__raw : lzq(obj[k]))).join('\n') + '\n}' : null; };

/* ---------------- Terraform generator ---------------- */
function lzGenerate(c, x) {
  const ent = c.model === 'enterprise';
  const ctOn = lzCtOn(c), ctCreate = lzCtCreate(c);
  const acts = lzActiveAccounts(c);
  const ous = lzOuOrder(c).filter(o => lzOuDepth(c, o.key) < 99);
  const files = [];
  const orgAddr = c.org.mode === 'existing' ? 'data.aws_organizations_organization.this' : 'aws_organizations_organization.this';
  const ouRef = k => `aws_organizations_organizational_unit.${k}`;
  const parentExpr = k => (!k || k === 'root' || !lzOu(c, k)) ? 'local.organization_root_id' : ouRef(k) + '.id';
  const acctIdExpr = a => a.mode === 'reference' ? `var.existing_account_ids[${hq(a.key)}]` : `aws_organizations_account.${a.key}.id`;
  const lzTag = { LandingZone: RAW('var.landing_zone_name') };

  x.v('landing_zone_name', 'string', 'Label for this landing zone. AWS Organizations has no organization name, so it is used as a LandingZone tag', c.org.label || 'landing-zone', { condition: 'can(regex("^[A-Za-z0-9][A-Za-z0-9 ._-]{0,62}$", var.landing_zone_name))', error: 'landing_zone_name must be 1-63 letters, numbers, spaces, dots, hyphens or underscores.' });

  /* organization.tf */
  let org = '';
  if (c.org.mode === 'existing') {
    org = '# The organization already exists and is not managed here: it is only read.\n' + 'data "aws_organizations_organization" "this" {}';
  } else {
    x.v('organization_feature_set', 'string', 'AWS Organizations feature set. ALL is needed for SCPs, trusted access and Control Tower', c.org.feature_set, { condition: 'contains(["ALL", "CONSOLIDATED_BILLING"], var.organization_feature_set)', error: 'organization_feature_set must be ALL or CONSOLIDATED_BILLING.' });
    const all = c.org.feature_set === 'ALL';
    if (all && c.org.trusted) x.v('organization_service_access_principals', 'list(string)', 'AWS services given trusted access to the organization', c.org.principals);
    const life = [
      c.org.protect ? '# Deleting an organization is rarely intended. Remove this line only if you mean it.\nprevent_destroy = true' : null,
      ctOn ? '# Control Tower enables trusted access and policy types for the services it integrates.\nignore_changes = [aws_service_access_principals, enabled_policy_types]' : null,
    ].filter(Boolean);
    if (c.org.mode === 'import') org += R('import', ['to = aws_organizations_organization.this', 'id = ' + hq(c.org.id)]) + '\n\n';
    org += R('resource "aws_organizations_organization" "this"', [
      'feature_set = var.organization_feature_set',
      all && c.org.trusted ? 'aws_service_access_principals = var.organization_service_access_principals' : null,
      all && c.org.scp ? 'enabled_policy_types = ["SERVICE_CONTROL_POLICY"]' : null,
      life.length ? '' : null,
      life.length ? B('lifecycle', life) : null,
    ]);
  }
  org += '\n\n' + R('locals', [`organization_root_id = ${orgAddr}.roots[0].id`]);
  x.o('organization_id', orgAddr + '.id', 'AWS Organizations organization ID');
  x.o('organization_arn', orgAddr + '.arn', 'ARN of the organization');
  x.o('organization_root_id', 'local.organization_root_id', 'ID of the organization root');
  x.o('management_account_id', orgAddr + '.master_account_id', 'Account ID of the management account (the account Terraform runs in)');
  x.note(`Management account "${c.mgmt.name}" (${c.mgmt.email}): Terraform runs with its credentials and does not create or move it. It always stays in the root, and SCPs never restrict it.`);
  files.push({ stem: 'organization', title: 'AWS Organization', desc: c.org.mode === 'existing' ? 'Reads the existing organization and exposes its root ID.' : 'The organization, its feature set, enabled policy types and trusted service access.', body: org });

  /* organizational_units.tf */
  if (ous.length) {
    x.v('organizational_unit_names', 'map(string)', 'Display name of each organizational unit, by key', Object.fromEntries(ous.map(o => [o.key, o.name])), { condition: 'alltrue([for n in values(var.organizational_unit_names) : length(n) >= 1 && length(n) <= 128])', error: 'Every OU name must be 1-128 characters.' });
    const body = ous.map(o => (o.desc ? '# ' + o.desc.replace(/\n/g, ' ') + '\n' : '') + R(`resource "aws_organizations_organizational_unit" "${o.key}"`, [
      `name = var.organizational_unit_names[${hq(o.key)}]`,
      'parent_id = ' + parentExpr(o.parent),
      '',
      lzTagMap(lzTag),
    ])).join('\n\n');
    x.o('organizational_unit_ids', '{\n' + ous.map(o => `  ${o.key} = ${ouRef(o.key)}.id`).join('\n') + '\n}', 'Organizational unit IDs by key');
    x.o('organizational_unit_arns', '{\n' + ous.map(o => `  ${o.key} = ${ouRef(o.key)}.arn`).join('\n') + '\n}', 'Organizational unit ARNs by key (Control Tower targets OUs by ARN)');
    files.push({ stem: 'organizational_units', title: 'Organizational units', desc: 'The OU hierarchy. Nested OUs reference their parent OU, so Terraform creates parents first.', body });
  }

  /* accounts */
  const managed = acts.filter(a => a.mode !== 'reference' && !lzFactory(c, a));
  const factory = acts.filter(a => lzFactory(c, a));
  const refs = acts.filter(a => a.mode === 'reference');
  if (managed.length || factory.length) {
    x.v('accounts', 'map(object({\n  name        = string\n  email       = string\n  environment = string\n}))', 'Member accounts managed by this configuration, by key. Each email must be unique across AWS', Object.fromEntries([...managed, ...factory].map(a => [a.key, { name: a.name, email: a.email, environment: a.env }])), { condition: 'alltrue([for a in values(var.accounts) : can(regex("^[^@\\\\s]+@[^@\\\\s]+\\\\.[^@\\\\s]+$", a.email))])', error: 'Every account email must be a valid email address.' });
  }
  if (managed.some(a => a.mode === 'create')) {
    x.v('account_role_name', 'string', 'IAM role Organizations creates in each new account, trusted by the management account', c.acct.role_name);
    x.v('account_iam_user_access_to_billing', 'string', 'Whether IAM users and roles in new accounts can see billing (ALLOW or DENY). Changing it later recreates the account', c.acct.billing, { condition: 'contains(["ALLOW", "DENY"], var.account_iam_user_access_to_billing)', error: 'account_iam_user_access_to_billing must be ALLOW or DENY.' });
  }
  if (managed.length) x.v('account_close_on_deletion', 'bool', 'Close the account when it is removed from Terraform (false only removes it from the organization)', !!c.acct.close_on_deletion);
  const acctBlock = a => {
    const imported = a.mode === 'import';
    const tags = Object.assign({ Environment: RAW(`var.accounts[${hq(a.key)}].environment`), AccountType: a.type }, a.tags || {}, lzTag);
    const life = [];
    if (c.acct.protect || imported) life.push('prevent_destroy = true');
    if (imported) life.push('# Name, email and billing access cannot be changed safely after import; Terraform manages the OU and tags.\nignore_changes = [name, email]');
    else life.push('# The Organizations API cannot read role_name back, so ignore it to avoid a permanent diff.\nignore_changes = [role_name]');
    return (imported ? `# Existing account ${a.id}: imported, then moved to its target OU.\n` : '') + R(`resource "aws_organizations_account" "${a.key}"`, [
      `name = var.accounts[${hq(a.key)}].name`,
      `email = var.accounts[${hq(a.key)}].email`,
      'parent_id = ' + parentExpr(a.ou),
      imported ? null : 'role_name = var.account_role_name',
      imported ? null : 'iam_user_access_to_billing = var.account_iam_user_access_to_billing',
      'close_on_deletion = var.account_close_on_deletion',
      '',
      lzTagMap(tags), '',
      B('lifecycle', life),
    ]);
  };
  const core = managed.filter(a => a.core), custom = managed.filter(a => !a.core);
  if (core.length) files.push({ stem: 'default_accounts', title: 'Default / core accounts', desc: 'Core accounts (log archive, audit or security, network, shared services). parent_id places each one in its OU.', body: core.map(acctBlock).join('\n\n') });
  if (custom.length) files.push({ stem: 'custom_accounts', title: 'Custom accounts', desc: 'Workload and sandbox accounts. parent_id places each one in its OU.', body: custom.map(acctBlock).join('\n\n') });
  const imports = managed.filter(a => a.mode === 'import');
  if (imports.length || refs.length) {
    let body = imports.map(a => R('import', [`to = aws_organizations_account.${a.key}`, 'id = ' + hq(a.id)])).join('\n\n');
    if (refs.length) {
      x.v('existing_account_ids', 'map(string)', 'Existing accounts referenced but not managed here, by key', Object.fromEntries(refs.map(a => [a.key, a.id])), { condition: 'alltrue([for id in values(var.existing_account_ids) : can(regex("^[0-9]{12}$", id))])', error: 'Account IDs must be 12 digits.' });
      body += (body ? '\n\n' : '') + '# Referenced accounts (not managed, never moved or recreated):\n' + refs.map(a => `#   ${a.key} = ${a.id} (${a.name})`).join('\n') + '\n# Their IDs come from var.existing_account_ids and are used only as SCP targets and in outputs.';
    }
    files.push({ stem: 'existing_accounts', title: 'Existing account onboarding', desc: 'Import blocks bring existing accounts under Terraform so parent_id can move them. Referenced accounts are only used by ID.', body });
    if (imports.length) x.note('Import blocks need Terraform 1.5 or newer. terraform plan shows each import and the OU move before anything changes. Importing an account does not recreate it.');
  }
  const idMap = [...managed.map(a => [a.key, `aws_organizations_account.${a.key}.id`]), ...refs.map(a => [a.key, acctIdExpr(a)])];
  if (idMap.length) x.o('account_ids', '{\n' + idMap.map(([k, v]) => `  ${k} = ${v}`).join('\n') + '\n}', 'Member account IDs by key');
  if (managed.length) x.o('account_parent_ids', '{\n' + managed.map(a => `  ${a.key} = aws_organizations_account.${a.key}.parent_id`).join('\n') + '\n}', 'Root or OU ID each managed account is placed in');
  if (managed.some(a => a.mode === 'create')) x.note('AWS account creation needs organizations:CreateAccount permissions in the management account and a unique email address for every account. Root credentials of new accounts are never set by Terraform: use password recovery or centralized root access.');

  /* service control policies */
  const scps = c.scps.filter(s => scpPolicy(s));
  if (scps.length) {
    let body = '';
    for (const s of scps) {
      let doc;
      if (s.mode === 'template' && s.template === 'region') {
        const vn = `scp_${s.key}_allowed_regions`;
        x.v(vn, 'list(string)', `Regions allowed by the ${s.name} SCP`, s.regions, { condition: `length(var.${vn}) > 0`, error: 'Allow at least one Region.' });
        doc = scpPolicy(s, { regions: RAW('var.' + vn) });
      } else doc = scpPolicy(s);
      body += (body ? '\n\n' : '') + (s.mode === 'json' ? '# Written in JSON mode, converted to HCL for jsonencode().\n' : `# Template: ${SCP_TEMPLATES[s.template].name}\n`) + R(`resource "aws_organizations_policy" "${s.key}"`, [
        'name = ' + hq(s.name),
        s.desc ? 'description = ' + lzq(s.desc.slice(0, 512)) : null,
        'type = "SERVICE_CONTROL_POLICY"',
        '',
        'content = jsonencode(' + lzHv(doc) + ')',
        '',
        lzTagMap(lzTag),
      ]);
    }
    x.o('scp_ids', '{\n' + scps.map(s => `  ${s.key} = aws_organizations_policy.${s.key}.id`).join('\n') + '\n}', 'Service control policy IDs by key');
    files.push({ stem: 'service_control_policies', title: 'Service control policies', desc: 'Each SCP sets the maximum permissions for the accounts it applies to. SCPs never grant permissions.', body });
    // attachments
    const att = [];
    const targetsOut = [];
    for (const s of scps) {
      if (s.enabled === false) continue;
      const tl = [];
      for (const t of lzTargets(c, s)) {
        if (t.missing || (t.kind === 'acct' && lzFactory(c, t.acct))) continue;
        const tid = t.kind === 'root' ? 'local.organization_root_id' : t.kind === 'ou' ? ouRef(t.key) + '.id' : acctIdExpr(t.acct);
        const nm = `${s.key}_${t.kind === 'root' ? 'root' : t.key}`;
        att.push(`# ${s.name} -> ${t.kind === 'root' ? 'Root (every member account)' : t.kind === 'ou' ? lzOuPath(c, t.key) : 'account ' + t.label}\n` + R(`resource "aws_organizations_policy_attachment" "${nm}"`, [`policy_id = aws_organizations_policy.${s.key}.id`, 'target_id = ' + tid]));
        tl.push(tid);
      }
      if (tl.length) targetsOut.push(`  ${s.key} = [${tl.join(', ')}]`);
    }
    if (att.length) {
      files.push({ stem: 'scp_attachments', title: 'SCP attachments', desc: 'Attaches SCPs to the root, OUs or accounts. An SCP on an OU applies to every account below it.', body: att.join('\n\n') });
      x.o('scp_attachment_targets', '{\n' + targetsOut.join('\n') + '\n}', 'Root, OU or account IDs each SCP is attached to');
    }
  }

  /* Control Tower */
  if (ctOn) {
    const ct = c.ct;
    const log = acts.find(a => a.core === 'log_archive'), audit = acts.find(a => a.core === 'audit');
    const secOu = log ? lzTopOu(c, log.ou) : null;
    if (ctCreate && ct.roles) {
      const role = (n, name, svc, extra) => assumeDoc(n, svc) + '\n\n' + R(`resource "aws_iam_role" "${n}"`, [`name = "${name}"`, 'path = "/service-role/"', `assume_role_policy = data.aws_iam_policy_document.${n}_assume.json`]) + extra;
      const inline = (n, polName, actions, res) => '\n\n' + R(`data "aws_iam_policy_document" "${n}"`, [B('statement', ['effect = "Allow"', `actions = [${actions.map(hq).join(', ')}]`, `resources = [${res.map(hq).join(', ')}]`])]) + '\n\n' + R(`resource "aws_iam_role_policy" "${n}"`, [`name = "${polName}"`, `role = aws_iam_role.${n}.id`, `policy = data.aws_iam_policy_document.${n}.json`]);
      const managedPol = (n, arn) => '\n\n' + R(`resource "aws_iam_role_policy_attachment" "${n}"`, [`role = aws_iam_role.${n}.name`, `policy_arn = "${arn}"`]);
      const body = '# Service roles AWS Control Tower needs before CreateLandingZone, as documented in\n# "Step 1: Configure your landing zone" of the Control Tower user guide.\n\n' +
        role('controltower_admin', 'AWSControlTowerAdmin', 'controltower.amazonaws.com', inline('controltower_admin', 'AWSControlTowerAdminPolicy', ['ec2:DescribeAvailabilityZones'], ['*']) + managedPol('controltower_admin', 'arn:aws:iam::aws:policy/service-role/AWSControlTowerServiceRolePolicy')) + '\n\n' +
        role('controltower_cloudtrail', 'AWSControlTowerCloudTrailRole', 'cloudtrail.amazonaws.com', managedPol('controltower_cloudtrail', 'arn:aws:iam::aws:policy/service-role/AWSControlTowerCloudTrailRolePolicy')) + '\n\n' +
        role('controltower_stackset', 'AWSControlTowerStackSetRole', 'cloudformation.amazonaws.com', inline('controltower_stackset', 'AWSControlTowerStackSetRolePolicy', ['sts:AssumeRole'], ['arn:aws:iam::*:role/AWSControlTowerExecution']));
      files.push({ stem: 'control_tower_roles', title: 'Control Tower service roles', desc: 'AWSControlTowerAdmin, AWSControlTowerCloudTrailRole and AWSControlTowerStackSetRole in the /service-role/ path. Landing zone 4.0 does not need the Config aggregator role.', body });
    }
    if (ctCreate && log && audit) {
      x.v('controltower_landing_zone_version', 'string', 'AWS Control Tower landing zone version', ct.version, { condition: 'can(regex("^[0-9]+\\\\.[0-9]+$", var.controltower_landing_zone_version))', error: 'Use a version such as 4.0.' });
      x.v('controltower_governed_regions', 'list(string)', 'Regions Control Tower governs. Must include the home Region (the provider region)', ct.regions, { condition: 'contains(var.controltower_governed_regions, var.aws_region)', error: 'controltower_governed_regions must include var.aws_region, the home Region.' });
      x.v('controltower_log_retention_days', 'number', 'Days to keep logs in the central logging bucket', +ct.log_days, { condition: 'var.controltower_log_retention_days >= 1', error: 'Retention must be at least 1 day.' });
      x.v('controltower_access_log_retention_days', 'number', 'Days to keep S3 access logs for the logging bucket', +ct.access_days, { condition: 'var.controltower_access_log_retention_days >= 1', error: 'Retention must be at least 1 day.' });
      if (ct.kms) x.v('controltower_kms_key_arn', 'string', 'Customer managed KMS key ARN for Control Tower log encryption');
      const conf = Object.assign({ loggingBucket: { retentionDays: RAW('var.controltower_log_retention_days') }, accessLoggingBucket: { retentionDays: RAW('var.controltower_access_log_retention_days') } }, ct.kms ? { kmsKeyArn: RAW('var.controltower_kms_key_arn') } : {});
      const manifest = {
        governedRegions: RAW('var.controltower_governed_regions'),
        accessManagement: { enabled: !!ct.access_mgmt },
        backup: { enabled: false },
        centralizedLogging: { accountId: RAW(acctIdExpr(log)), enabled: true, configurations: conf },
        config: Object.assign({ accountId: RAW(acctIdExpr(audit)), enabled: !!ct.config }, ct.config ? { configurations: conf } : {}),
        securityRoles: Object.assign({ enabled: !!ct.security_roles }, ct.security_roles ? { accountId: RAW(acctIdExpr(audit)) } : {}),
      };
      const deps = [];
      if (ct.roles) deps.push('aws_iam_role_policy_attachment.controltower_admin', 'aws_iam_role_policy_attachment.controltower_cloudtrail', 'aws_iam_role_policy.controltower_stackset');
      if (secOu) deps.push(ouRef(secOu));
      const body = '# Landing zone 4.0 manifest. AWS Backup integration is off: it needs backup admin and central backup accounts.\n' + R('resource "aws_controltower_landing_zone" "this"', [
        'version = var.controltower_landing_zone_version', '',
        'manifest_json = jsonencode(' + lzHv(manifest) + ')',
        '',
        deps.length ? 'depends_on = [\n' + deps.map(d => '  ' + d + ',').join('\n') + '\n]' : null,
        deps.length ? '' : null,
        B('timeouts', ['create = "120m"', 'update = "120m"', 'delete = "120m"']),
      ]);
      x.o('controltower_landing_zone_arn', 'aws_controltower_landing_zone.this.arn', 'ARN of the Control Tower landing zone');
      x.o('controltower_landing_zone_latest_available_version', 'aws_controltower_landing_zone.this.latest_available_version', 'Newest landing zone version available to update to');
      files.push({ stem: 'control_tower', title: 'Control Tower landing zone', desc: 'aws_controltower_landing_zone with a manifest that points at the Log Archive and Audit accounts.', body });
      x.note('Control Tower creates and owns many resources (CloudTrail organization trail, AWS Config, IAM Identity Center setup, StackSets, its own SCPs). Terraform manages only the landing zone resource; it does not manage those child resources.');
    }
    const regOus = ct.baselines.filter(k => lzOu(c, k) && k !== secOu);
    const lzDep = ctCreate && log && audit ? 'aws_controltower_landing_zone.this' : null;
    if (regOus.length) {
      x.v('controltower_baseline_id', 'string', 'ID of the AWSControlTowerBaseline baseline (aws controltower list-baselines)', '17BSJV3IGJ2QSGA2');
      x.v('controltower_baseline_version', 'string', 'AWSControlTowerBaseline version compatible with the landing zone version (5.0 for landing zone 4.0)', ct.baseline_version);
      x.v('controltower_identity_center_enabled_baseline_arn', 'string', 'ARN of the enabled IdentityCenterBaseline, needed when IAM Identity Center access management is on', null);
      const body = R('locals', ['controltower_baseline_arn = "arn:aws:controltower:${var.aws_region}::baseline/${var.controltower_baseline_id}"']) + '\n\n' +
        regOus.map(k => {
          const o = lzOu(c, k);
          const dep = [lzDep, o.parent !== 'root' && regOus.includes(o.parent) ? `aws_controltower_baseline.${o.parent}` : null].filter(Boolean);
          return `# Registers the ${o.name} OU with Control Tower; accounts in it become governed.\n` + R(`resource "aws_controltower_baseline" "${k}"`, [
            'baseline_identifier = local.controltower_baseline_arn',
            'baseline_version = var.controltower_baseline_version',
            `target_identifier = ${ouRef(k)}.arn`, '',
            B('dynamic "parameters"', ['for_each = var.controltower_identity_center_enabled_baseline_arn == null ? [] : [var.controltower_identity_center_enabled_baseline_arn]', '', B('content', ['key = "IdentityCenterEnabledBaselineArn"', 'value = parameters.value'])]),
            dep.length ? '' : null,
            dep.length ? `depends_on = [${dep.join(', ')}]` : null,
          ]);
        }).join('\n\n');
      x.o('controltower_registered_ou_baselines', '{\n' + regOus.map(k => `  ${k} = aws_controltower_baseline.${k}.arn`).join('\n') + '\n}', 'Enabled baseline ARN for each OU registered with Control Tower');
      files.push({ stem: 'control_tower_baselines', title: 'Control Tower OU registration', desc: 'aws_controltower_baseline enables AWSControlTowerBaseline on each OU, which registers it and enrolls its accounts.', body });
    }
    const ctls = ct.controls.filter(cc => ctControl(cc.id)).flatMap(cc => cc.ous.filter(k => lzOu(c, k) && (regOus.includes(k) || k === secOu)).map(k => ({ cc, k })));
    if (ctls.length) {
      const body = ctls.map(({ cc, k }) => {
        const d = ctControl(cc.id);
        const dep = [regOus.includes(k) ? `aws_controltower_baseline.${k}` : lzDep].filter(Boolean);
        return `# ${d.name}\n# ${d.beh} control implemented as ${d.impl === 'SCP' ? 'an SCP that Control Tower manages' : 'an AWS Config rule that Control Tower deploys'} (${d.guid}).\n` + R(`resource "aws_controltower_control" "${lzKey(cc.id.replace(/^AWS-GR_/, ''))}_${k}"`, [
          `control_identifier = "arn:aws:controltower:\${var.aws_region}::control/${cc.id}"`,
          `target_identifier = ${ouRef(k)}.arn`,
          dep.length ? '' : null,
          dep.length ? `depends_on = [${dep.join(', ')}]` : null,
        ]);
      }).join('\n\n');
      x.o('controltower_enabled_controls', '{\n' + ctls.map(({ cc, k }) => `  ${lzKey(cc.id.replace(/^AWS-GR_/, ''))}_${k} = aws_controltower_control.${lzKey(cc.id.replace(/^AWS-GR_/, ''))}_${k}.arn`).join('\n') + '\n}', 'ARNs of the enabled Control Tower controls');
      files.push({ stem: 'control_tower_controls', title: 'Control Tower controls', desc: 'aws_controltower_control enables Control Tower controls on registered OUs, using the documented control identifiers.', body });
    }
    if (factory.length) {
      x.v('account_factory_provisioning_artifact_id', 'string', 'Provisioning artifact ID of the "AWS Control Tower Account Factory" product (aws servicecatalog describe-product --name "AWS Control Tower Account Factory")');
      x.v('account_factory_sso_users', 'map(object({\n  email      = string\n  first_name = string\n  last_name  = string\n}))', 'IAM Identity Center user for each Account Factory account. Placeholders are accepted when Identity Center is off', Object.fromEntries(factory.map(a => [a.key, { email: a.sso.email || a.email, first_name: a.sso.first || 'Account', last_name: a.sso.last || 'Owner' }])));
      const body = '# Account Factory is an AWS Service Catalog product that Control Tower publishes.\n# Terraform provisions it; Control Tower creates and enrolls the account.\n\n' + factory.map(a => {
        const dep = [regOus.includes(a.ou) ? `aws_controltower_baseline.${a.ou}` : lzDep].filter(Boolean);
        const p = (k, v) => B('provisioning_parameters', ['key = ' + hq(k), 'value = ' + v]);
        return R(`resource "aws_servicecatalog_provisioned_product" "${a.key}"`, [
          `name = var.accounts[${hq(a.key)}].name`,
          'product_name = "AWS Control Tower Account Factory"',
          'provisioning_artifact_id = var.account_factory_provisioning_artifact_id', '',
          p('AccountName', `var.accounts[${hq(a.key)}].name`), '',
          p('AccountEmail', `var.accounts[${hq(a.key)}].email`), '',
          p('ManagedOrganizationalUnit', `"\${${ouRef(a.ou)}.name} (\${${ouRef(a.ou)}.id})"`), '',
          p('SSOUserEmail', `var.account_factory_sso_users[${hq(a.key)}].email`), '',
          p('SSOUserFirstName', `var.account_factory_sso_users[${hq(a.key)}].first_name`), '',
          p('SSOUserLastName', `var.account_factory_sso_users[${hq(a.key)}].last_name`), '',
          lzTagMap(Object.assign({ Environment: RAW(`var.accounts[${hq(a.key)}].environment`) }, a.tags || {}, lzTag)),
          dep.length ? '' : null,
          dep.length ? `depends_on = [${dep.join(', ')}]` : null,
        ]);
      }).join('\n\n');
      x.o('account_factory_provisioned_product_ids', '{\n' + factory.map(a => `  ${a.key} = aws_servicecatalog_provisioned_product.${a.key}.id`).join('\n') + '\n}', 'Service Catalog provisioned product ID for each Account Factory account');
      files.push({ stem: 'account_factory', title: 'Control Tower Account Factory', desc: 'Accounts created and enrolled by Control Tower through its Account Factory product in AWS Service Catalog.', body });
    }
    if (ct.mode === 'existing') x.note('Control Tower is already set up, so no aws_controltower_landing_zone is generated. OU registration, controls and Account Factory use the existing landing zone.');
  }
  return files;
}

/* ---------------- service registration ---------------- */
S({
  id: LZ_ID, name: 'AWS Landing Zone', cat: 'landingzone', diff: 'Advanced', file: 'organization', wizard: true,
  res: ['aws_organizations_organization', 'data.aws_organizations_organization', 'aws_organizations_organizational_unit', 'aws_organizations_account', 'aws_organizations_policy', 'aws_organizations_policy_attachment', 'aws_controltower_landing_zone', 'aws_controltower_baseline', 'aws_controltower_control', 'aws_servicecatalog_provisioned_product', 'aws_iam_role', 'aws_iam_role_policy', 'aws_iam_role_policy_attachment', 'data.aws_iam_policy_document'],
  kw: 'landing zone control tower aws organizations organization organizational unit ou aws account account factory enrollment scp service control policy multi-account multi account governance guardrails controls management account log archive audit security account shared services sandbox enterprise non-enterprise',
  desc: 'A governed multi-account foundation: AWS Organizations, OUs, core and workload accounts, SCPs and, for Enterprise, AWS Control Tower.',
  use: 'Separate security, logging, shared services and workloads into their own AWS accounts under one organization, with guardrails applied by OU.',
  assume: [
    'Terraform runs in the management account with Organizations permissions. The management account itself is never created, moved or restricted by SCPs.',
    'Account placement is the parent_id argument of aws_organizations_account. There is no separate account-to-OU attachment resource.',
    'Existing accounts are either referenced by ID only, or imported with an import block and then moved. They are never recreated.',
    'Control Tower capabilities without a Terraform resource (drift repair, console-only settings, Account Factory customization) are explained, not generated.',
  ],
  guide: [
    'An SCP is a permission boundary for member accounts. It never grants permissions: IAM policies still have to.',
    'Test SCPs on a sandbox OU before attaching them to production OUs or the root.',
    'Keep the management account for organization administration only; run workloads in member accounts.',
    'Protect the log archive account with SCPs or Control Tower controls so logs cannot be deleted from inside member accounts.',
  ],
  defaults: () => lzTemplate('non-enterprise', 'ap-southeast-1'),
  gen: (c, x) => lzGenerate(c, x),
});

// Starter templates in the shared preset list.
PRESETS.push(
  { name: 'Enterprise Control Tower Landing Zone', ids: [LZ_ID], cfg: { [LZ_ID]: lzTemplate('enterprise', 'ap-southeast-1') } },
  { name: 'Multi-Account AWS Foundation', ids: [LZ_ID], cfg: { [LZ_ID]: lzTemplate('non-enterprise', 'ap-southeast-1') } },
);

// Capability index for the global search and the catalog tree.
const LZ_CAPS = [
  { name: 'AWS Organizations', models: 'both', step: 1, res: 'aws_organizations_organization', kw: 'organization org feature set trusted access management account' },
  { name: 'Organizational Units', models: 'both', step: 2, res: 'aws_organizations_organizational_unit', kw: 'ou organizational unit hierarchy' },
  { name: 'Default Accounts', models: 'both', step: 3, res: 'aws_organizations_account', kw: 'core account log archive audit security network shared services management' },
  { name: 'Custom Accounts', models: 'both', step: 3, res: 'aws_organizations_account', kw: 'aws account workload create existing' },
  { name: 'Account Placement', models: 'non-enterprise', step: 4, res: 'aws_organizations_account (parent_id)', kw: 'move account placement onboarding' },
  { name: 'Account Enrollment', models: 'enterprise', step: 4, res: 'aws_controltower_baseline', kw: 'enroll enrollment register ou governed' },
  { name: 'Service Control Policy', models: 'both', step: 5, res: 'aws_organizations_policy', kw: 'scp service control policy guardrail deny' },
  { name: 'AWS Organizations Policy', models: 'both', step: 5, res: 'aws_organizations_policy', kw: 'policy scp organizations policy' },
  { name: 'SCP Attachment', models: 'both', step: 5, res: 'aws_organizations_policy_attachment', kw: 'scp attachment attach inheritance' },
  { name: 'Control Tower', models: 'enterprise', step: 6, res: 'aws_controltower_landing_zone', kw: 'control tower landing zone governance' },
  { name: 'Control Tower Controls', models: 'enterprise', step: 6, res: 'aws_controltower_control', kw: 'control tower controls guardrails scp config detective preventive' },
  { name: 'Account Factory', models: 'enterprise', step: 6, res: 'aws_servicecatalog_provisioned_product', kw: 'account factory service catalog vending' },
];

if (typeof module !== 'undefined') module.exports = { lzTemplate, lzCheck, lzGenerate, scpPolicy, CT_CONTROLS, SCP_TEMPLATES };
