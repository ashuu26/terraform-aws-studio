/* ==========================================================================
   catalog.js — AWS service metadata + per-service Terraform generators.
   Every resource type used here is a real hashicorp/aws resource; each
   service lists its types so the UI can link to the Registry docs.
   ========================================================================== */

const REGISTRY_BASE = 'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/';
function docUrl(t) {
  if (t === 'data.archive_file') return 'https://registry.terraform.io/providers/hashicorp/archive/latest/docs/data-sources/file';
  if (t.startsWith('data.aws_')) return REGISTRY_BASE + 'data-sources/' + t.slice(9);
  return REGISTRY_BASE + 'resources/' + t.replace(/^aws_/, '');
}

/* ---------- HCL value + block builders ---------- */
function hq(s) { return JSON.stringify(String(s)).replace(/\$\{/g, '$${').replace(/%\{/g, '%%{'); }
function hv(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  if (typeof v === 'string') return hq(v);
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    if (v.every(x => x === null || typeof x !== 'object')) return '[' + v.map(hv).join(', ') + ']';
    return '[\n' + v.map(x => indentLines(hv(x), '  ')).join(',\n') + ',\n]';
  }
  const ks = Object.keys(v);
  if (!ks.length) return '{}';
  const allScalar = ks.every(k => v[k] === null || typeof v[k] !== 'object');
  return '{\n' + ks.map(k => indentLines((/^[A-Za-z_][\w-]*$/.test(k) ? k : hq(k)) + ' = ' + hv(v[k]), '  ')).join('\n') + '\n}';
}
function indentLines(s, ind) { return s.split('\n').map(l => (l ? ind + l : l)).join('\n'); }
const B = (h, b) => ({ h, b });
function renderBlock(h, items, ind = '') {
  const inner = ind + '  ';
  const out = [ind + h + ' {'];
  for (const it of items) {
    if (it === null || it === undefined || it === false) continue;
    if (typeof it === 'string') {
      if (it === '') { out.push(''); continue; }
      const lines = it.split('\n');
      out.push(lines.map(l => (l ? inner + l : '')).join('\n'));
    } else out.push(renderBlock(it.h, it.b, inner));
  }
  out.push(ind + '}');
  return out.join('\n');
}
const R = (h, items) => renderBlock(h, items);
const N = s => `"\${local.name_prefix}-${s}"`;
const tags = (nameExpr, extra) => {
  const lines = ['Name = ' + nameExpr];
  if (extra) for (const k of Object.keys(extra)) lines.push(k + ' = ' + extra[k]);
  return 'tags = {\n' + lines.map(l => '  ' + l).join('\n') + '\n}';
};
const csv = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);

/* ---------- Service definitions ----------
   field: { k, l, t: text|number|bool|select|list|multi, d, o, h, when, presets }
     multi    checkboxes; the value is a comma-separated string of the ticked options.
     when     (config, has) => bool; hides the field in the drawer when false.
     presets  select only: { option: { otherKey: value } } applied when that option is picked.
   layout-only entries (no k): { t: 'section', l } and { t: 'note', l, level: 'info'|'warn' }.
   service extras:
     suggest(config, has)  extra dependency IDs that depend on the configuration.
     guide                 educational security and compliance notes shown in the drawer.
     gen(c, x)             returns HCL for <file>.tf, or [{ stem, title, body }] for several files.
*/
const CATS = {
  networking: { label: 'Networking', color: 'net' },
  compute: { label: 'Compute', color: 'cmp' },
  database: { label: 'Database', color: 'db' },
  storage: { label: 'Storage', color: 'sto' },
  backup: { label: 'Backup', color: 'bkp' },
  monitoring: { label: 'Monitoring', color: 'mon' },
  landingzone: { label: 'Landing Zone', color: 'lz' },
};

const SERVICES = [];
// Filled as services register, so later files (landingzone.js) can add services too.
const SVC = {};
function S(def) { def.fields = def.fields || []; def.deps = def.deps || []; def.kw = def.kw || ''; def.assume = def.assume || []; def.guide = def.guide || []; SERVICES.push(def); SVC[def.id] = def; }
// Static deps plus the ones a service suggests for its current configuration.
function depsOf(id, cfg, has) {
  const s = SVC[id];
  return [...new Set([...s.deps, ...(s.suggest ? s.suggest(cfg, has) : [])])].filter(d => d !== id && SVC[d]);
}

/* ============================ NETWORKING ============================ */
S({
  id: 'vpc', name: 'VPC', cat: 'networking', diff: 'Beginner', file: 'vpc',
  res: ['aws_vpc'], kw: 'vpc network cidr',
  desc: 'An isolated virtual network that every other networking resource lives inside.',
  use: 'The foundation for any workload that needs private IP addressing.',
  fields: [
    { k: 'name', l: 'VPC name', t: 'text', d: 'learning-vpc' },
    { k: 'cidr', l: 'CIDR block', t: 'text', d: '10.0.0.0/16', h: 'A /16 gives 65,536 addresses to carve into subnets.' },
    { k: 'dns_support', l: 'Enable DNS support', t: 'bool', d: true },
    { k: 'dns_hostnames', l: 'Enable DNS hostnames', t: 'bool', d: true, h: 'Needed for VPC endpoints with private DNS and for EKS.' },
  ],
  gen(c, x) {
    x.v('vpc_name', 'string', 'Name tag for the VPC', c.name);
    x.v('vpc_cidr', 'string', 'IPv4 CIDR block for the VPC', c.cidr, { condition: 'can(cidrhost(var.vpc_cidr, 0))', error: 'vpc_cidr must be a valid IPv4 CIDR block, for example 10.0.0.0/16.' });
    x.v('vpc_enable_dns_support', 'bool', 'Enable the Amazon-provided DNS resolver in the VPC', c.dns_support);
    x.v('vpc_enable_dns_hostnames', 'bool', 'Assign public DNS hostnames to instances with public IPs', c.dns_hostnames);
    x.o('vpc_id', 'aws_vpc.main.id', 'ID of the VPC');
    x.o('vpc_cidr_block', 'aws_vpc.main.cidr_block', 'CIDR block of the VPC');
    return R('resource "aws_vpc" "main"', [
      'cidr_block = var.vpc_cidr',
      'enable_dns_support = var.vpc_enable_dns_support',
      'enable_dns_hostnames = var.vpc_enable_dns_hostnames',
      '',
      tags('var.vpc_name'),
    ]);
  },
});

S({
  id: 'subnet', name: 'Subnet', cat: 'networking', diff: 'Beginner', file: 'subnet',
  res: ['aws_subnet', 'data.aws_availability_zones'], deps: ['vpc'], kw: 'vpc subnet public private az',
  desc: 'Public and private subnets spread across Availability Zones, created with for_each.',
  use: 'Placing load balancers in public subnets and apps or databases in private ones.',
  fields: [
    { k: 'public', l: 'Public subnet CIDRs', t: 'list', d: '10.0.1.0/24, 10.0.2.0/24', h: 'Comma-separated. Each one lands in a different AZ.' },
    { k: 'private', l: 'Private subnet CIDRs', t: 'list', d: '10.0.11.0/24, 10.0.12.0/24' },
    { k: 'map_public', l: 'Auto-assign public IPs in public subnets', t: 'bool', d: false, h: 'Off by default. Turn on only if instances in public subnets need direct internet access.' },
  ],
  assume: ['Subnets are assigned to AZs by index from the aws_availability_zones data source, so the plan adapts to your region.'],
  gen(c, x) {
    const mk = (list, p) => { const o = {}; list.forEach((cidr, i) => { o[`${p}-${'abcdef'[i] || i}`] = { cidr_block: cidr, az_index: i }; }); return o; };
    const t = 'map(object({ cidr_block = string, az_index = number }))';
    x.v('public_subnets', t, 'Public subnets keyed by name; az_index picks an Availability Zone', mk(csv(c.public), 'public'));
    x.v('private_subnets', t, 'Private subnets keyed by name; az_index picks an Availability Zone', mk(csv(c.private), 'private'));
    x.v('public_subnet_map_public_ip', 'bool', 'Auto-assign public IPv4 addresses to instances launched in public subnets', c.map_public);
    x.azData();
    x.o('public_subnet_ids', '[for s in aws_subnet.public : s.id]', 'IDs of the public subnets');
    x.o('private_subnet_ids', '[for s in aws_subnet.private : s.id]', 'IDs of the private subnets');
    const sub = (name, tier, mapIp) => R(`resource "aws_subnet" "${name}"`, [
      `for_each = var.${name}_subnets`,
      '',
      'vpc_id = ' + x.vpcId(),
      'cidr_block = each.value.cidr_block',
      'availability_zone = data.aws_availability_zones.available.names[each.value.az_index]',
      'map_public_ip_on_launch = ' + mapIp,
      '',
      tags('"${local.name_prefix}-${each.key}"', { Tier: hq(tier) }),
    ]);
    return sub('public', 'public', 'var.public_subnet_map_public_ip') + '\n\n' + sub('private', 'private', 'false');
  },
});

S({
  id: 'route_table', name: 'Route Table', cat: 'networking', diff: 'Beginner', file: 'route_table',
  res: ['aws_route_table', 'aws_route_table_association'], deps: ['vpc', 'subnet', 'igw'], kw: 'vpc route routing',
  desc: 'Public and private route tables, with routes to the internet or NAT gateway when those are selected.',
  use: 'Sending public subnet traffic to the internet gateway and private traffic through NAT.',
  assume: ['Routes are only added for gateways you have selected; otherwise the table holds just the local VPC route.'],
  gen(c, x) {
    const igw = x.has('igw'), nat = x.has('nat');
    let h = R('resource "aws_route_table" "public"', [
      'vpc_id = ' + x.vpcId(),
      igw ? '' : null,
      igw ? B('route', ['cidr_block = "0.0.0.0/0"', 'gateway_id = aws_internet_gateway.main.id']) : null,
      '',
      tags(N('public-rt')),
    ]) + '\n\n' + R('resource "aws_route_table" "private"', [
      'vpc_id = ' + x.vpcId(),
      nat ? '' : null,
      nat ? B('route', ['cidr_block = "0.0.0.0/0"', 'nat_gateway_id = aws_nat_gateway.main.id']) : null,
      '',
      tags(N('private-rt')),
    ]);
    if (x.has('subnet')) {
      for (const t of ['public', 'private']) {
        h += '\n\n' + R(`resource "aws_route_table_association" "${t}"`, [
          `for_each = aws_subnet.${t}`,
          '',
          'subnet_id = each.value.id',
          `route_table_id = aws_route_table.${t}.id`,
        ]);
      }
    } else x.note('Route table associations were skipped because the Subnet service is not selected.');
    x.o('public_route_table_id', 'aws_route_table.public.id', 'ID of the public route table');
    x.o('private_route_table_id', 'aws_route_table.private.id', 'ID of the private route table');
    return h;
  },
});

S({
  id: 'igw', name: 'Internet Gateway', cat: 'networking', diff: 'Beginner', file: 'internet_gateway',
  res: ['aws_internet_gateway'], deps: ['vpc'], kw: 'vpc igw internet',
  desc: 'Connects the VPC to the internet for resources in public subnets.',
  use: 'Giving public load balancers and bastion-free public endpoints a path to the internet.',
  gen(c, x) {
    x.o('internet_gateway_id', 'aws_internet_gateway.main.id', 'ID of the internet gateway');
    return R('resource "aws_internet_gateway" "main"', ['vpc_id = ' + x.vpcId(), '', tags(N('igw'))]);
  },
});

S({
  id: 'eip', name: 'Elastic IP', cat: 'networking', diff: 'Beginner', file: 'elastic_ip',
  res: ['aws_eip'], kw: 'eip ip address static',
  desc: 'A static public IPv4 address. Used by the NAT gateway when both are selected.',
  use: 'Stable egress IPs that partners can allow-list.',
  gen(c, x) {
    const n = x.has('nat') ? 'nat' : 'main';
    x.o('eip_public_ip', `aws_eip.${n}.public_ip`, 'Public IPv4 address of the Elastic IP');
    x.o('eip_allocation_id', `aws_eip.${n}.allocation_id`, 'Allocation ID of the Elastic IP');
    return R(`resource "aws_eip" "${n}"`, ['domain = "vpc"', '', tags(N(n === 'nat' ? 'nat-eip' : 'eip'))]);
  },
});

S({
  id: 'nat', name: 'NAT Gateway', cat: 'networking', diff: 'Intermediate', file: 'nat_gateway',
  res: ['aws_nat_gateway', 'aws_eip'], deps: ['vpc', 'subnet', 'igw', 'eip', 'route_table'], kw: 'vpc nat egress',
  desc: 'Lets resources in private subnets reach the internet without being reachable from it.',
  use: 'Package updates and outbound API calls from private instances or containers.',
  assume: ['A single NAT gateway is created in the first public subnet. Production designs often use one per AZ.'],
  gen(c, x) {
    let h = '';
    if (!x.has('eip')) h += R('resource "aws_eip" "nat"', ['domain = "vpc"', '', tags(N('nat-eip'))]) + '\n\n';
    h += R('resource "aws_nat_gateway" "main"', [
      'allocation_id = aws_eip.nat.id',
      'subnet_id = ' + x.firstPublic(),
      '',
      tags(N('nat')),
      x.has('igw') ? '' : null,
      x.has('igw') ? '# The AWS provider docs recommend this explicit dependency so the\n# internet gateway exists before the NAT gateway starts routing.\ndepends_on = [aws_internet_gateway.main]' : null,
    ]);
    x.o('nat_gateway_id', 'aws_nat_gateway.main.id', 'ID of the NAT gateway');
    x.o('nat_gateway_public_ip', 'aws_nat_gateway.main.public_ip', 'Public IP used for outbound traffic from private subnets');
    return h;
  },
});

S({
  id: 'sg', name: 'Security Group', cat: 'networking', diff: 'Beginner', file: 'security_group',
  res: ['aws_security_group', 'aws_vpc_security_group_ingress_rule', 'aws_vpc_security_group_egress_rule'], deps: ['vpc'], kw: 'vpc sg firewall security',
  desc: 'A stateful firewall, with each rule managed as its own resource (the current recommended pattern).',
  use: 'Controlling which ports and CIDRs can reach instances, databases and load balancers.',
  fields: [
    { k: 'ports', l: 'Allowed inbound TCP ports', t: 'list', d: '443, 80', h: 'Add 5432/3306 for databases, 2049 for EFS, 6379 for caches.' },
    { k: 'cidr', l: 'Allowed source CIDR', t: 'text', d: '10.0.0.0/16', h: 'Defaults to the VPC range. Avoid 0.0.0.0/0 except on public load balancers.' },
  ],
  assume: ['One shared security group is generated for simplicity. Real systems use one group per tier and reference groups instead of CIDRs.'],
  gen(c, x) {
    const rules = {};
    csv(c.ports).forEach(p => { const n = Number(p); if (!isNaN(n)) rules['tcp-' + n] = { port: n, cidr_ipv4: c.cidr, description: 'Allow TCP ' + n }; });
    x.v('sg_ingress_rules', 'map(object({ port = number, cidr_ipv4 = string, description = string }))', 'Inbound rules for the application security group', rules);
    x.o('security_group_id', 'aws_security_group.main.id', 'ID of the application security group');
    return R('resource "aws_security_group" "main"', [
      'name_prefix = "${local.name_prefix}-app-"',
      'description = "Application security group managed by Terraform"',
      'vpc_id = ' + x.vpcId(),
      '',
      tags(N('app-sg')),
      '',
      B('lifecycle', ['create_before_destroy = true']),
    ]) + '\n\n' + R('resource "aws_vpc_security_group_ingress_rule" "app"', [
      'for_each = var.sg_ingress_rules',
      '',
      'security_group_id = aws_security_group.main.id',
      'description = each.value.description',
      'cidr_ipv4 = each.value.cidr_ipv4',
      'from_port = each.value.port',
      'to_port = each.value.port',
      'ip_protocol = "tcp"',
    ]) + '\n\n' + R('resource "aws_vpc_security_group_egress_rule" "all"', [
      'security_group_id = aws_security_group.main.id',
      'description = "Allow all outbound traffic"',
      'cidr_ipv4 = "0.0.0.0/0"',
      'ip_protocol = "-1"',
    ]);
  },
});

S({
  id: 'nacl', name: 'Network ACL', cat: 'networking', diff: 'Intermediate', file: 'network_acl',
  res: ['aws_network_acl'], deps: ['vpc', 'subnet'], kw: 'vpc nacl acl firewall stateless',
  desc: 'A stateless subnet-level firewall. Return traffic must be allowed explicitly.',
  use: 'A coarse second layer of defence around private subnets.',
  fields: [{ k: 'cidr', l: 'Allowed internal CIDR', t: 'text', d: '10.0.0.0/16' }],
  assume: ['Rule 110 allows TCP ephemeral ports (1024-65535) inbound so replies to outbound NAT traffic are not dropped.'],
  gen(c, x) {
    x.v('nacl_internal_cidr', 'string', 'CIDR allowed to reach the private subnets on any protocol', c.cidr);
    x.o('network_acl_id', 'aws_network_acl.private.id', 'ID of the private network ACL');
    return R('resource "aws_network_acl" "private"', [
      'vpc_id = ' + x.vpcId(),
      x.has('subnet') ? 'subnet_ids = ' + x.privateIds() : null,
      '',
      B('ingress', ['protocol = "-1"', 'rule_no = 100', 'action = "allow"', 'cidr_block = var.nacl_internal_cidr', 'from_port = 0', 'to_port = 0']),
      '',
      '# NACLs are stateless: allow replies to outbound connections.',
      B('ingress', ['protocol = "tcp"', 'rule_no = 110', 'action = "allow"', 'cidr_block = "0.0.0.0/0"', 'from_port = 1024', 'to_port = 65535']),
      '',
      B('egress', ['protocol = "-1"', 'rule_no = 100', 'action = "allow"', 'cidr_block = "0.0.0.0/0"', 'from_port = 0', 'to_port = 0']),
      '',
      tags(N('private-nacl')),
    ]);
  },
});

S({
  id: 'vpc_endpoint', name: 'VPC Endpoint', cat: 'networking', diff: 'Intermediate', file: 'vpc_endpoint',
  res: ['aws_vpc_endpoint'], deps: ['vpc', 'route_table'], kw: 'vpc endpoint privatelink gateway s3 dynamodb',
  desc: 'A gateway endpoint so private subnets reach S3 or DynamoDB without the internet.',
  use: 'Cutting NAT data charges and keeping S3 traffic on the AWS network.',
  fields: [{ k: 'service', l: 'Gateway service', t: 'select', d: 's3', o: ['s3', 'dynamodb'] }],
  gen(c, x) {
    x.v('vpc_endpoint_service', 'string', 'Gateway endpoint service: s3 or dynamodb', c.service, { condition: 'contains(["s3", "dynamodb"], var.vpc_endpoint_service)', error: 'Gateway endpoints exist only for s3 and dynamodb.' });
    x.o('vpc_endpoint_id', 'aws_vpc_endpoint.gateway.id', 'ID of the gateway VPC endpoint');
    return R('resource "aws_vpc_endpoint" "gateway"', [
      'vpc_id = ' + x.vpcId(),
      'service_name = "com.amazonaws.${var.aws_region}.${var.vpc_endpoint_service}"',
      'vpc_endpoint_type = "Gateway"',
      x.has('route_table') ? 'route_table_ids = [aws_route_table.private.id]' : null,
      '',
      tags(N('endpoint-${var.vpc_endpoint_service}')),
    ]);
  },
});

S({
  id: 'tgw', name: 'Transit Gateway', cat: 'networking', diff: 'Advanced', file: 'transit_gateway',
  res: ['aws_ec2_transit_gateway'], kw: 'vpc tgw transit hub',
  desc: 'A regional hub that connects many VPCs and on-premises networks.',
  use: 'Hub-and-spoke landing zones with shared services and inspection VPCs.',
  fields: [{ k: 'asn', l: 'Amazon side ASN', t: 'number', d: 64512 }],
  gen(c, x) {
    x.v('tgw_amazon_side_asn', 'number', 'Private ASN for the Amazon side of BGP sessions', Number(c.asn));
    x.o('transit_gateway_id', 'aws_ec2_transit_gateway.main.id', 'ID of the transit gateway');
    return R('resource "aws_ec2_transit_gateway" "main"', [
      'description = "${local.name_prefix} transit gateway"',
      'amazon_side_asn = var.tgw_amazon_side_asn',
      'auto_accept_shared_attachments = "disable"',
      'default_route_table_association = "enable"',
      'default_route_table_propagation = "enable"',
      'dns_support = "enable"',
      '',
      tags(N('tgw')),
    ]);
  },
});

S({
  id: 'tgw_attach', name: 'Transit Gateway Attachment', cat: 'networking', diff: 'Advanced', file: 'transit_gateway_attachment',
  res: ['aws_ec2_transit_gateway_vpc_attachment'], deps: ['tgw', 'vpc', 'subnet'], kw: 'vpc tgw transit attachment',
  desc: 'Attaches this VPC to a transit gateway through the private subnets.',
  use: 'Joining a workload VPC to a shared network hub.',
  gen(c, x) {
    const tgw = x.has('tgw') ? 'aws_ec2_transit_gateway.main.id' : x.v('transit_gateway_id', 'string', 'ID of an existing transit gateway');
    x.o('transit_gateway_attachment_id', 'aws_ec2_transit_gateway_vpc_attachment.main.id', 'ID of the transit gateway VPC attachment');
    return R('resource "aws_ec2_transit_gateway_vpc_attachment" "main"', [
      'transit_gateway_id = ' + tgw,
      'vpc_id = ' + x.vpcId(),
      'subnet_ids = ' + x.privateIds(),
      '',
      tags(N('tgw-attachment')),
    ]);
  },
});

S({
  id: 'alb', name: 'Application Load Balancer', cat: 'networking', diff: 'Intermediate', file: 'alb',
  res: ['aws_lb'], deps: ['vpc', 'subnet', 'sg', 'tg', 'listener'], kw: 'alb load balancer elb http',
  desc: 'Layer 7 load balancer. The same aws_lb resource also builds NLBs; load_balancer_type decides.',
  use: 'HTTP/HTTPS routing to EC2, ECS or Lambda targets.',
  fields: [
    { k: 'name', l: 'Load balancer name', t: 'text', d: 'learning-alb', h: '32 characters max, letters, numbers and hyphens.' },
    { k: 'internal', l: 'Internal (private) load balancer', t: 'bool', d: false },
    { k: 'deletion_protection', l: 'Deletion protection', t: 'bool', d: false },
  ],
  gen(c, x) {
    x.v('alb_name', 'string', 'Name of the application load balancer', c.name, { condition: 'can(regex("^[a-zA-Z0-9-]{1,32}$", var.alb_name))', error: 'alb_name must be 1-32 characters: letters, numbers and hyphens.' });
    x.v('alb_internal', 'bool', 'Create an internal load balancer in private subnets instead of a public one', c.internal);
    x.v('alb_deletion_protection', 'bool', 'Protect the load balancer from accidental deletion', c.deletion_protection);
    const subnets = x.has('subnet') ? `var.alb_internal ? ${x.privateIds()} : ${x.publicIds()}` : x.v('alb_subnet_ids', 'list(string)', 'At least two subnet IDs in different AZs for the load balancer');
    x.o('alb_dns_name', 'aws_lb.app.dns_name', 'DNS name of the application load balancer');
    x.o('alb_arn', 'aws_lb.app.arn', 'ARN of the application load balancer');
    return R('resource "aws_lb" "app"', [
      'name = var.alb_name',
      'internal = var.alb_internal',
      'load_balancer_type = "application"',
      x.sgOpt('security_groups'),
      'subnets = ' + subnets,
      '',
      'drop_invalid_header_fields = true',
      'enable_deletion_protection = var.alb_deletion_protection',
      '',
      tags('var.alb_name'),
    ]);
  },
});

S({
  id: 'nlb', name: 'Network Load Balancer', cat: 'networking', diff: 'Intermediate', file: 'nlb',
  res: ['aws_lb'], deps: ['vpc', 'subnet', 'tg', 'listener'], kw: 'nlb load balancer elb tcp',
  desc: 'Layer 4 TCP/UDP load balancer built with aws_lb and load_balancer_type = "network".',
  use: 'Very high throughput TCP services, static IPs, or PrivateLink services.',
  fields: [
    { k: 'name', l: 'Load balancer name', t: 'text', d: 'learning-nlb' },
    { k: 'internal', l: 'Internal (private) load balancer', t: 'bool', d: true },
  ],
  gen(c, x) {
    x.v('nlb_name', 'string', 'Name of the network load balancer', c.name, { condition: 'can(regex("^[a-zA-Z0-9-]{1,32}$", var.nlb_name))', error: 'nlb_name must be 1-32 characters: letters, numbers and hyphens.' });
    x.v('nlb_internal', 'bool', 'Create an internal network load balancer', c.internal);
    const subnets = x.has('subnet') ? `var.nlb_internal ? ${x.privateIds()} : ${x.publicIds()}` : x.v('nlb_subnet_ids', 'list(string)', 'Subnet IDs for the network load balancer');
    x.o('nlb_dns_name', 'aws_lb.network.dns_name', 'DNS name of the network load balancer');
    return R('resource "aws_lb" "network"', [
      'name = var.nlb_name',
      'internal = var.nlb_internal',
      'load_balancer_type = "network"',
      'subnets = ' + subnets,
      'enable_cross_zone_load_balancing = true',
      '',
      tags('var.nlb_name'),
    ]);
  },
});

S({
  id: 'tg', name: 'Target Group', cat: 'networking', diff: 'Intermediate', file: 'target_group',
  res: ['aws_lb_target_group', 'aws_lb_target_group_attachment'], deps: ['vpc'], kw: 'target group alb nlb elb health check',
  desc: 'The pool of targets a load balancer sends traffic to, with health checks.',
  use: 'Registering EC2 instances, Auto Scaling groups or ECS tasks behind a load balancer.',
  fields: [
    { k: 'name', l: 'Target group name', t: 'text', d: 'learning-tg' },
    { k: 'protocol', l: 'Protocol', t: 'select', d: 'HTTP', o: ['HTTP', 'TCP'], h: 'HTTP for ALBs, TCP for NLBs.' },
    { k: 'port', l: 'Target port', t: 'number', d: 80 },
    { k: 'target_type', l: 'Target type', t: 'select', d: 'instance', o: ['instance', 'ip'], h: 'Use ip for ECS Fargate tasks.' },
    { k: 'path', l: 'Health check path', t: 'text', d: '/' },
  ],
  gen(c, x) {
    x.v('tg_name', 'string', 'Name of the target group', c.name);
    x.v('tg_port', 'number', 'Port the targets receive traffic on', Number(c.port));
    x.v('tg_target_type', 'string', 'Target type: instance or ip', c.target_type, { condition: 'contains(["instance", "ip"], var.tg_target_type)', error: 'tg_target_type must be instance or ip.' });
    const http = c.protocol === 'HTTP';
    if (http) x.v('tg_health_check_path', 'string', 'HTTP path used for target health checks', c.path);
    x.o('target_group_arn', 'aws_lb_target_group.app.arn', 'ARN of the target group');
    let h = R('resource "aws_lb_target_group" "app"', [
      'name = var.tg_name',
      'port = var.tg_port',
      `protocol = "${c.protocol}"`,
      'target_type = var.tg_target_type',
      'vpc_id = ' + x.vpcId(),
      '',
      B('health_check', http
        ? ['enabled = true', 'path = var.tg_health_check_path', 'protocol = "HTTP"', 'matcher = "200-399"', 'interval = 30', 'healthy_threshold = 3', 'unhealthy_threshold = 3']
        : ['enabled = true', 'protocol = "TCP"', 'interval = 30', 'healthy_threshold = 3', 'unhealthy_threshold = 3']),
      '',
      tags('var.tg_name'),
    ]);
    if (x.has('ec2') && c.target_type === 'instance') {
      h += '\n\n' + R('resource "aws_lb_target_group_attachment" "ec2"', [
        'target_group_arn = aws_lb_target_group.app.arn',
        'target_id = aws_instance.main.id',
        'port = var.tg_port',
      ]);
    }
    return h;
  },
});

S({
  id: 'route53_zone', name: 'Route 53 Hosted Zone', cat: 'networking', diff: 'Intermediate', file: 'route53_zone',
  res: ['aws_route53_zone'], kw: 'route53 dns zone domain',
  desc: 'A public hosted zone that holds DNS records for a domain.',
  use: 'Serving DNS for a domain you own or delegate from a registrar.',
  fields: [{ k: 'domain', l: 'Domain name', t: 'text', d: 'example.com' }],
  gen(c, x) {
    x.v('domain_name', 'string', 'Domain name for the hosted zone', c.domain);
    x.o('route53_zone_id', 'aws_route53_zone.main.zone_id', 'Hosted zone ID');
    x.o('route53_name_servers', 'aws_route53_zone.main.name_servers', 'Name servers to configure at your registrar');
    return R('resource "aws_route53_zone" "main"', ['name = var.domain_name', 'comment = "Managed by Terraform"']);
  },
});

S({
  id: 'route53_record', name: 'Route 53 Record', cat: 'networking', diff: 'Intermediate', file: 'route53_record',
  res: ['aws_route53_record'], deps: ['route53_zone'], kw: 'route53 dns record alias',
  desc: 'A DNS record. Becomes an alias to CloudFront or the ALB when those are selected.',
  use: 'Pointing app.example.com at your load balancer or CDN.',
  fields: [
    { k: 'name', l: 'Record name', t: 'text', d: 'app', h: 'Relative to the zone when the hosted zone is selected; otherwise a full name.' },
    { k: 'values', l: 'Record values (non-alias only)', t: 'list', d: '203.0.113.10' },
  ],
  gen(c, x) {
    x.v('record_name', 'string', 'DNS record name', c.name);
    const zone = x.has('route53_zone') ? 'aws_route53_zone.main.zone_id' : x.v('route53_zone_id', 'string', 'ID of an existing Route 53 hosted zone');
    const name = x.has('route53_zone') ? '"${var.record_name}.${var.domain_name}"' : 'var.record_name';
    let target = null;
    if (x.has('cloudfront')) target = ['aws_cloudfront_distribution.main.domain_name', 'aws_cloudfront_distribution.main.hosted_zone_id', 'false'];
    else if (x.has('alb')) target = ['aws_lb.app.dns_name', 'aws_lb.app.zone_id', 'true'];
    x.o('record_fqdn', 'aws_route53_record.app.fqdn', 'Fully qualified domain name of the record');
    if (target) return R('resource "aws_route53_record" "app"', [
      'zone_id = ' + zone, 'name = ' + name, 'type = "A"', '',
      B('alias', ['name = ' + target[0], 'zone_id = ' + target[1], 'evaluate_target_health = ' + target[2]]),
    ]);
    x.v('record_values', 'list(string)', 'IPv4 addresses for the A record', csv(c.values));
    return R('resource "aws_route53_record" "app"', ['zone_id = ' + zone, 'name = ' + name, 'type = "A"', 'ttl = 300', 'records = var.record_values']);
  },
});

S({
  id: 'waf', name: 'AWS WAF', cat: 'networking', diff: 'Advanced', file: 'waf',
  res: ['aws_wafv2_web_acl', 'aws_wafv2_web_acl_association'], deps: ['alb'], kw: 'waf firewall wafv2 security',
  desc: 'A WAFv2 web ACL with AWS managed rule groups. Scope follows what it protects.',
  use: 'Blocking common exploits (OWASP-style) in front of an ALB or CloudFront.',
  assume: ['With CloudFront selected the web ACL uses CLOUDFRONT scope, which must be created in us-east-1, so an aliased provider is added.'],
  gen(c, x) {
    const cf = x.has('cloudfront');
    if (cf) x.flags.useast1 = true;
    const rule = (name, pri, group) => B('rule', [
      `name = "${name}"`, `priority = ${pri}`, '',
      B('override_action', ['none {}']), '',
      B('statement', [B('managed_rule_group_statement', [`name = "${group}"`, 'vendor_name = "AWS"'])]), '',
      B('visibility_config', ['cloudwatch_metrics_enabled = true', `metric_name = "${name}"`, 'sampled_requests_enabled = true']),
    ]);
    let h = R('resource "aws_wafv2_web_acl" "main"', [
      cf ? '# CloudFront-scoped web ACLs must live in us-east-1.\nprovider = aws.us_east_1\n' : null,
      'name = "${local.name_prefix}-web-acl"',
      'description = "Baseline AWS managed rules"',
      `scope = "${cf ? 'CLOUDFRONT' : 'REGIONAL'}"`,
      '',
      B('default_action', ['allow {}']),
      '',
      rule('aws-common-rule-set', 1, 'AWSManagedRulesCommonRuleSet'),
      '',
      rule('aws-known-bad-inputs', 2, 'AWSManagedRulesKnownBadInputsRuleSet'),
      '',
      B('visibility_config', ['cloudwatch_metrics_enabled = true', 'metric_name = "${local.name_prefix}-web-acl"', 'sampled_requests_enabled = true']),
      '',
      tags(N('web-acl')),
    ]);
    if (!cf && x.has('alb')) h += '\n\n' + R('resource "aws_wafv2_web_acl_association" "alb"', ['resource_arn = aws_lb.app.arn', 'web_acl_arn = aws_wafv2_web_acl.main.arn']);
    x.o('web_acl_arn', 'aws_wafv2_web_acl.main.arn', 'ARN of the WAF web ACL');
    return h;
  },
});

S({
  id: 'cloudfront', name: 'CloudFront', cat: 'networking', diff: 'Advanced', file: 'cloudfront',
  res: ['aws_cloudfront_distribution', 'aws_cloudfront_origin_access_control', 'data.aws_cloudfront_cache_policy'], deps: ['s3', 'waf'], kw: 'cloudfront cdn distribution edge',
  desc: 'A global CDN distribution. Uses S3 with origin access control, or the ALB, as its origin.',
  use: 'Serving static sites or caching an application at the edge with HTTPS.',
  fields: [{ k: 'price_class', l: 'Price class', t: 'select', d: 'PriceClass_200', o: ['PriceClass_100', 'PriceClass_200', 'PriceClass_All'] }],
  assume: ['Uses the default *.cloudfront.net certificate. A custom domain needs an ACM certificate in us-east-1.', 'The ALB origin uses HTTP between CloudFront and the ALB for simplicity; use HTTPS end-to-end in production.'],
  gen(c, x) {
    const s3 = x.has('s3'), alb = !s3 && x.has('alb');
    x.v('cloudfront_price_class', 'string', 'CloudFront price class', c.price_class);
    const cache = s3 ? 'Managed-CachingOptimized' : 'Managed-CachingDisabled';
    let h = R('data "aws_cloudfront_cache_policy" "selected"', [`name = "${cache}"`]) + '\n\n';
    if (alb) h += R('data "aws_cloudfront_origin_request_policy" "all_viewer"', ['name = "Managed-AllViewer"']) + '\n\n';
    let origin;
    if (s3) {
      h += R('resource "aws_cloudfront_origin_access_control" "s3"', [
        'name = "${local.name_prefix}-s3-oac"', 'description = "CloudFront access to the S3 origin"',
        'origin_access_control_origin_type = "s3"', 'signing_behavior = "always"', 'signing_protocol = "sigv4"',
      ]) + '\n\n';
      origin = B('origin', ['origin_id = "primary"', 'domain_name = aws_s3_bucket.main.bucket_regional_domain_name', 'origin_access_control_id = aws_cloudfront_origin_access_control.s3.id']);
    } else {
      const dom = alb ? 'aws_lb.app.dns_name' : x.v('cloudfront_origin_domain', 'string', 'Domain name of a custom origin', 'origin.example.com');
      origin = B('origin', ['origin_id = "primary"', 'domain_name = ' + dom, '',
        B('custom_origin_config', ['http_port = 80', 'https_port = 443', `origin_protocol_policy = "${alb ? 'http-only' : 'https-only'}"`, 'origin_ssl_protocols = ["TLSv1.2"]'])]);
    }
    h += R('resource "aws_cloudfront_distribution" "main"', [
      'enabled = true', 'is_ipv6_enabled = true', 'comment = "${local.name_prefix} distribution"', 'price_class = var.cloudfront_price_class',
      s3 ? 'default_root_object = "index.html"' : null,
      x.has('waf') ? 'web_acl_id = aws_wafv2_web_acl.main.arn' : null,
      '', origin, '',
      B('default_cache_behavior', [
        'target_origin_id = "primary"', 'viewer_protocol_policy = "redirect-to-https"',
        s3 ? 'allowed_methods = ["GET", "HEAD", "OPTIONS"]' : 'allowed_methods = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]',
        'cached_methods = ["GET", "HEAD"]', 'compress = true', 'cache_policy_id = data.aws_cloudfront_cache_policy.selected.id',
        alb ? 'origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id' : null,
      ]), '',
      B('restrictions', [B('geo_restriction', ['restriction_type = "none"'])]), '',
      B('viewer_certificate', ['cloudfront_default_certificate = true']), '',
      tags(N('cdn')),
    ]);
    if (s3) {
      h += '\n\n' + R('data "aws_iam_policy_document" "cloudfront_s3"', [B('statement', [
        'sid = "AllowCloudFrontRead"', 'actions = ["s3:GetObject"]', 'resources = ["${aws_s3_bucket.main.arn}/*"]', '',
        B('principals', ['type = "Service"', 'identifiers = ["cloudfront.amazonaws.com"]']), '',
        B('condition', ['test = "StringEquals"', 'variable = "AWS:SourceArn"', 'values = [aws_cloudfront_distribution.main.arn]']),
      ])]) + '\n\n' + R('resource "aws_s3_bucket_policy" "cloudfront"', ['bucket = aws_s3_bucket.main.id', 'policy = data.aws_iam_policy_document.cloudfront_s3.json']);
    }
    x.o('cloudfront_domain_name', 'aws_cloudfront_distribution.main.domain_name', 'CloudFront distribution domain name');
    x.o('cloudfront_distribution_id', 'aws_cloudfront_distribution.main.id', 'CloudFront distribution ID');
    return h;
  },
});

S({
  id: 'vgw', name: 'VPN Gateway', cat: 'networking', diff: 'Advanced', file: 'vpn_gateway',
  res: ['aws_vpn_gateway'], deps: ['vpc'], kw: 'vpn vgw virtual private gateway hybrid',
  desc: 'The AWS-side anchor of a site-to-site VPN, attached to the VPC.',
  use: 'Connecting a single VPC to an on-premises network.',
  fields: [{ k: 'asn', l: 'Amazon side ASN', t: 'number', d: 64513 }],
  gen(c, x) {
    x.v('vgw_amazon_side_asn', 'number', 'Private ASN for the Amazon side of the VPN gateway', Number(c.asn));
    x.o('vpn_gateway_id', 'aws_vpn_gateway.main.id', 'ID of the VPN gateway');
    return R('resource "aws_vpn_gateway" "main"', ['vpc_id = ' + x.vpcId(), 'amazon_side_asn = var.vgw_amazon_side_asn', '', tags(N('vgw'))]);
  },
});

S({
  id: 'cgw', name: 'Customer Gateway', cat: 'networking', diff: 'Advanced', file: 'customer_gateway',
  res: ['aws_customer_gateway'], kw: 'vpn cgw customer gateway hybrid on-premises',
  desc: 'Describes your on-premises VPN device (its public IP and BGP ASN) to AWS.',
  use: 'The on-premises side of a site-to-site VPN.',
  fields: [
    { k: 'ip', l: 'On-premises public IP', t: 'text', d: '203.0.113.10', h: 'The example value is from the documentation range; replace it.' },
    { k: 'asn', l: 'BGP ASN', t: 'number', d: 65000 },
  ],
  gen(c, x) {
    x.v('cgw_ip_address', 'string', 'Public IPv4 address of the on-premises VPN device', c.ip, { condition: 'can(cidrhost("${var.cgw_ip_address}/32", 0))', error: 'cgw_ip_address must be a valid IPv4 address.' });
    x.v('cgw_bgp_asn', 'number', 'BGP ASN of the on-premises network', Number(c.asn));
    x.o('customer_gateway_id', 'aws_customer_gateway.main.id', 'ID of the customer gateway');
    return R('resource "aws_customer_gateway" "main"', ['bgp_asn = var.cgw_bgp_asn', 'ip_address = var.cgw_ip_address', 'type = "ipsec.1"', '', tags(N('cgw'))]);
  },
});

S({
  id: 'vpn', name: 'Site-to-Site VPN', cat: 'networking', diff: 'Advanced', file: 'vpn_connection',
  res: ['aws_vpn_connection'], deps: ['cgw', 'vgw'], kw: 'vpn site-to-site ipsec hybrid',
  desc: 'Two IPsec tunnels between the customer gateway and a VPN or transit gateway.',
  use: 'Encrypted hybrid connectivity while Direct Connect is pending, or as its backup.',
  fields: [{ k: 'static', l: 'Static routes only (no BGP)', t: 'bool', d: false }],
  assume: ['Tunnel pre-shared keys are generated by AWS. They end up in Terraform state, so protect the state backend.'],
  gen(c, x) {
    x.v('vpn_static_routes_only', 'bool', 'Use static routing instead of BGP', c.static);
    const cgw = x.has('cgw') ? 'aws_customer_gateway.main.id' : x.v('customer_gateway_id', 'string', 'ID of an existing customer gateway');
    const gw = x.has('vgw') ? 'vpn_gateway_id = aws_vpn_gateway.main.id'
      : x.has('tgw') ? 'transit_gateway_id = aws_ec2_transit_gateway.main.id'
      : 'vpn_gateway_id = ' + x.v('vpn_gateway_id', 'string', 'ID of an existing VPN gateway');
    x.o('vpn_connection_id', 'aws_vpn_connection.main.id', 'ID of the VPN connection');
    x.o('vpn_tunnel1_address', 'aws_vpn_connection.main.tunnel1_address', 'Public IP of the first VPN tunnel');
    return R('resource "aws_vpn_connection" "main"', ['customer_gateway_id = ' + cgw, gw, 'type = "ipsec.1"', 'static_routes_only = var.vpn_static_routes_only', '', tags(N('vpn'))]);
  },
});

/* ============================ COMPUTE ============================ */
function amiData(x, instanceType) {
  const arm = /^[a-z]+\d+[a-z]*g[a-z]*\./.test(instanceType || '');
  const arch = arm ? 'arm64' : 'x86_64';
  const name = 'al2023_' + arch;
  x.data(name, R(`data "aws_ami" "${name}"`, [
    'most_recent = true', 'owners = ["amazon"]', '',
    B('filter', ['name = "name"', `values = ["al2023-ami-2023.*-${arch}"]`]), '',
    B('filter', ['name = "virtualization-type"', 'values = ["hvm"]']),
  ]));
  return `data.aws_ami.${name}.id`;
}

S({
  id: 'ec2', name: 'EC2 Instance', cat: 'compute', diff: 'Beginner', file: 'ec2',
  res: ['aws_instance', 'data.aws_ami'], deps: ['vpc', 'subnet', 'sg', 'iam_role'], kw: 'ec2 instance vm server',
  desc: 'A virtual machine running the latest Amazon Linux 2023, with IMDSv2 and an encrypted gp3 root volume.',
  use: 'Web servers, jump hosts, and learning how compute fits into a VPC.',
  fields: [
    { k: 'name', l: 'Instance name', t: 'text', d: 'web-server' },
    { k: 'ami', l: 'AMI ID (optional)', t: 'text', d: '', h: 'Leave empty to look up the newest Amazon Linux 2023 AMI with a data source.' },
    { k: 'type', l: 'Instance type', t: 'select', d: 't3.micro', o: ['t3.micro', 't3.small', 't3.medium', 't4g.micro', 't4g.small', 'm7i.large'] },
    { k: 'placement', l: 'Subnet tier', t: 'select', d: 'private', o: ['private', 'public'] },
    { k: 'root', l: 'Root volume (GB)', t: 'number', d: 20 },
    { k: 'monitoring', l: 'Detailed monitoring', t: 'bool', d: true },
  ],
  assume: ['The AMI lookup matches the CPU architecture of the instance type chosen here (Graviton "g" types use arm64). Changing the type later to a different architecture needs a regenerate.'],
  gen(c, x) {
    const ami = amiData(x, c.type);
    x.v('ec2_instance_name', 'string', 'Name tag for the EC2 instance', c.name);
    x.v('ec2_ami_id', 'string', 'Explicit AMI ID. Leave null to use the latest Amazon Linux 2023 AMI', c.ami || null);
    x.v('ec2_instance_type', 'string', 'EC2 instance type', c.type);
    x.v('ec2_root_volume_size', 'number', 'Root volume size in GiB', Number(c.root), { condition: 'var.ec2_root_volume_size >= 8', error: 'Amazon Linux 2023 needs a root volume of at least 8 GiB.' });
    x.v('ec2_detailed_monitoring', 'bool', 'Enable 1-minute CloudWatch detailed monitoring', c.monitoring);
    const subnet = x.has('subnet') ? (c.placement === 'public' ? x.firstPublic() : x.firstPrivate()) : x.v('ec2_subnet_id', 'string', 'Subnet ID for the instance. Null uses the default VPC', null);
    x.o('ec2_instance_id', 'aws_instance.main.id', 'ID of the EC2 instance');
    x.o('ec2_private_ip', 'aws_instance.main.private_ip', 'Private IP address of the EC2 instance');
    return R('resource "aws_instance" "main"', [
      `ami = coalesce(var.ec2_ami_id, ${ami})`,
      'instance_type = var.ec2_instance_type',
      'subnet_id = ' + subnet,
      x.sgOpt('vpc_security_group_ids'),
      x.has('iam_role') ? 'iam_instance_profile = aws_iam_instance_profile.app.name' : null,
      'monitoring = var.ec2_detailed_monitoring',
      '',
      '# IMDSv2 only: blocks the SSRF credential-theft pattern that IMDSv1 allows.',
      B('metadata_options', ['http_endpoint = "enabled"', 'http_tokens = "required"']),
      '',
      B('root_block_device', ['volume_size = var.ec2_root_volume_size', 'volume_type = "gp3"', 'encrypted = true', x.kmsArn() ? 'kms_key_id = ' + x.kmsArn() : null]),
      '',
      tags('var.ec2_instance_name'),
    ]);
  },
});

S({
  id: 'lt', name: 'Launch Template', cat: 'compute', diff: 'Intermediate', file: 'launch_template',
  res: ['aws_launch_template'], deps: ['sg', 'iam_role'], kw: 'launch template ec2 asg',
  desc: 'A versioned blueprint for instances, used by Auto Scaling groups.',
  use: 'Defining AMI, type, disks and IMDS settings once for a whole fleet.',
  fields: [
    { k: 'type', l: 'Instance type', t: 'select', d: 't3.micro', o: ['t3.micro', 't3.small', 't3.medium', 't4g.micro', 't4g.small'] },
    { k: 'root', l: 'Root volume (GB)', t: 'number', d: 20 },
  ],
  gen(c, x) {
    const ami = amiData(x, c.type);
    x.v('lt_instance_type', 'string', 'Instance type for the launch template', c.type);
    x.v('lt_root_volume_size', 'number', 'Root volume size in GiB', Number(c.root));
    x.o('launch_template_id', 'aws_launch_template.main.id', 'ID of the launch template');
    x.o('launch_template_latest_version', 'aws_launch_template.main.latest_version', 'Latest version number of the launch template');
    return R('resource "aws_launch_template" "main"', [
      'name_prefix = "${local.name_prefix}-"',
      'image_id = ' + ami,
      'instance_type = var.lt_instance_type',
      x.sgOpt('vpc_security_group_ids'),
      'update_default_version = true',
      x.has('iam_role') ? '' : null,
      x.has('iam_role') ? B('iam_instance_profile', ['name = aws_iam_instance_profile.app.name']) : null,
      '',
      B('metadata_options', ['http_endpoint = "enabled"', 'http_tokens = "required"']),
      '',
      B('block_device_mappings', ['device_name = "/dev/xvda"', '', B('ebs', ['volume_size = var.lt_root_volume_size', 'volume_type = "gp3"', 'encrypted = true', 'delete_on_termination = true'])]),
      '',
      B('tag_specifications', ['resource_type = "instance"', '', tags(N('asg-instance'))]),
      '',
      tags(N('lt')),
    ]);
  },
});

S({
  id: 'asg', name: 'Auto Scaling Group', cat: 'compute', diff: 'Intermediate', file: 'autoscaling',
  res: ['aws_autoscaling_group'], deps: ['lt', 'subnet', 'tg'], kw: 'asg auto scaling group ec2',
  desc: 'Keeps a fleet of instances healthy and at the right size, across AZs.',
  use: 'Self-healing web tiers behind an ALB.',
  fields: [
    { k: 'min', l: 'Minimum size', t: 'number', d: 1 },
    { k: 'desired', l: 'Desired capacity', t: 'number', d: 2 },
    { k: 'max', l: 'Maximum size', t: 'number', d: 4 },
  ],
  gen(c, x) {
    x.v('asg_min_size', 'number', 'Minimum number of instances', Number(c.min));
    x.v('asg_desired_capacity', 'number', 'Desired number of instances', Number(c.desired));
    x.v('asg_max_size', 'number', 'Maximum number of instances', Number(c.max));
    const lt = x.has('lt') ? 'aws_launch_template.main.id' : x.v('launch_template_id', 'string', 'ID of an existing launch template');
    const tg = x.has('tg');
    x.o('asg_name', 'aws_autoscaling_group.main.name', 'Name of the Auto Scaling group');
    return R('resource "aws_autoscaling_group" "main"', [
      'name_prefix = "${local.name_prefix}-"',
      'min_size = var.asg_min_size',
      'desired_capacity = var.asg_desired_capacity',
      'max_size = var.asg_max_size',
      'vpc_zone_identifier = ' + x.privateIds(),
      `health_check_type = "${tg ? 'ELB' : 'EC2'}"`,
      'health_check_grace_period = 300',
      tg ? 'target_group_arns = [aws_lb_target_group.app.arn]' : null,
      '',
      B('launch_template', ['id = ' + lt, 'version = "$Latest"']),
      '',
      B('instance_refresh', ['strategy = "Rolling"', '', B('preferences', ['min_healthy_percentage = 50'])]),
      '',
      B('tag', ['key = "Name"', 'value = "${local.name_prefix}-asg"', 'propagate_at_launch = true']),
      '',
      '# Scaling policies change desired_capacity at runtime; do not fight them.',
      B('lifecycle', ['ignore_changes = [desired_capacity]']),
    ]);
  },
});

S({
  id: 'listener', name: 'Load Balancer Listener (ELB)', cat: 'compute', diff: 'Intermediate', file: 'lb_listener',
  res: ['aws_lb_listener'], deps: ['alb', 'tg'], kw: 'elb listener alb nlb https',
  desc: 'The port and protocol an Elastic Load Balancer listens on, and where it forwards traffic.',
  use: 'Wiring an ALB or NLB to its target group. Required before traffic flows.',
  fields: [
    { k: 'protocol', l: 'Protocol (ALB)', t: 'select', d: 'HTTP', o: ['HTTP', 'HTTPS'], h: 'HTTPS needs an ACM certificate ARN.' },
    { k: 'port', l: 'Listener port', t: 'number', d: 80 },
  ],
  gen(c, x) {
    const nlb = !x.has('alb') && x.has('nlb');
    const lb = x.has('alb') ? 'aws_lb.app.arn' : nlb ? 'aws_lb.network.arn' : x.v('load_balancer_arn', 'string', 'ARN of an existing load balancer');
    const proto = nlb ? 'TCP' : c.protocol;
    x.v('listener_port', 'number', 'Port the listener accepts traffic on', Number(c.port));
    const tg = x.has('tg') ? 'aws_lb_target_group.app.arn' : x.v('target_group_arn', 'string', 'ARN of an existing target group');
    const https = proto === 'HTTPS';
    if (https) x.v('certificate_arn', 'string', 'ARN of an ACM certificate for the HTTPS listener');
    x.o('listener_arn', 'aws_lb_listener.main.arn', 'ARN of the load balancer listener');
    return R('resource "aws_lb_listener" "main"', [
      'load_balancer_arn = ' + lb,
      'port = var.listener_port',
      `protocol = "${proto}"`,
      https ? 'ssl_policy = "ELBSecurityPolicy-TLS13-1-2-2021-06"' : null,
      https ? 'certificate_arn = var.certificate_arn' : null,
      '',
      B('default_action', ['type = "forward"', 'target_group_arn = ' + tg]),
    ]);
  },
});

S({
  id: 'lambda', name: 'Lambda Function', cat: 'compute', diff: 'Intermediate', file: 'lambda',
  res: ['aws_lambda_function', 'aws_iam_role', 'aws_cloudwatch_log_group', 'data.archive_file'], kw: 'lambda serverless function',
  desc: 'A function packaged from local source with the archive provider, with its own least-privilege role.',
  use: 'Event handlers, small APIs and scheduled jobs without servers.',
  fields: [
    { k: 'name', l: 'Function name', t: 'text', d: 'learning-fn' },
    { k: 'runtime', l: 'Runtime', t: 'select', d: 'python3.13', o: ['python3.13', 'python3.12', 'nodejs22.x'] },
    { k: 'memory', l: 'Memory (MB)', t: 'number', d: 256 },
    { k: 'timeout', l: 'Timeout (seconds)', t: 'number', d: 10 },
  ],
  assume: ['A starter handler is written to lambda_src/ in the ZIP and packaged by the hashicorp/archive provider at plan time.', 'The function runs outside the VPC unless both Subnet and Security Group are selected.'],
  gen(c, x) {
    x.flags.archive = true;
    const node = c.runtime.startsWith('nodejs');
    x.extraFiles[node ? 'lambda_src/index.mjs' : 'lambda_src/index.py'] = node
      ? 'export const handler = async (event) => {\n  return { statusCode: 200, body: JSON.stringify({ message: "Hello from Terraform" }) };\n};\n'
      : 'import json\n\n\ndef handler(event, context):\n    return {"statusCode": 200, "body": json.dumps({"message": "Hello from Terraform"})}\n';
    x.v('lambda_function_name', 'string', 'Name of the Lambda function', c.name);
    x.v('lambda_runtime', 'string', 'Lambda runtime identifier', c.runtime);
    x.v('lambda_memory_size', 'number', 'Memory in MB (also scales CPU)', Number(c.memory));
    x.v('lambda_timeout', 'number', 'Timeout in seconds', Number(c.timeout), { condition: 'var.lambda_timeout >= 1 && var.lambda_timeout <= 900', error: 'Lambda timeout must be between 1 and 900 seconds.' });
    const inVpc = x.has('subnet') && x.has('sg');
    x.o('lambda_function_arn', 'aws_lambda_function.main.arn', 'ARN of the Lambda function');
    x.o('lambda_function_name', 'aws_lambda_function.main.function_name', 'Name of the Lambda function');
    return R('data "archive_file" "lambda"', ['type = "zip"', 'source_dir = "${path.module}/lambda_src"', 'output_path = "${path.module}/build/lambda.zip"'])
      + '\n\n' + assumeDoc('lambda', 'lambda.amazonaws.com')
      + '\n\n' + R('resource "aws_iam_role" "lambda"', ['name_prefix = "${local.name_prefix}-lambda-"', 'assume_role_policy = data.aws_iam_policy_document.lambda_assume.json'])
      + '\n\n' + R('resource "aws_iam_role_policy_attachment" "lambda_basic"', ['role = aws_iam_role.lambda.name', `policy_arn = "arn:aws:iam::aws:policy/service-role/${inVpc ? 'AWSLambdaVPCAccessExecutionRole' : 'AWSLambdaBasicExecutionRole'}"`])
      + '\n\n' + R('resource "aws_cloudwatch_log_group" "lambda"', ['name = "/aws/lambda/${var.lambda_function_name}"', 'retention_in_days = 14'])
      + '\n\n' + R('resource "aws_lambda_function" "main"', [
        'function_name = var.lambda_function_name',
        'description = "Managed by Terraform"',
        'role = aws_iam_role.lambda.arn',
        'runtime = var.lambda_runtime',
        'handler = "index.handler"',
        'architectures = ["arm64"]',
        'memory_size = var.lambda_memory_size',
        'timeout = var.lambda_timeout',
        '',
        'filename = data.archive_file.lambda.output_path',
        'source_code_hash = data.archive_file.lambda.output_base64sha256',
        '',
        B('environment', ['variables = {\n  ENVIRONMENT = var.environment\n}']),
        '',
        B('logging_config', ['log_format = "JSON"', 'log_group = aws_cloudwatch_log_group.lambda.name']),
        inVpc ? '' : null,
        inVpc ? B('vpc_config', ['subnet_ids = ' + x.privateIds(), 'security_group_ids = [aws_security_group.main.id]']) : null,
        '',
        '# The role needs its log permissions before the first invocation.',
        'depends_on = [aws_iam_role_policy_attachment.lambda_basic]',
      ]);
  },
});

function assumeDoc(name, service) {
  return R(`data "aws_iam_policy_document" "${name}_assume"`, [B('statement', [
    'effect = "Allow"', 'actions = ["sts:AssumeRole"]', '',
    B('principals', ['type = "Service"', `identifiers = ["${service}"]`]),
  ])]);
}

S({
  id: 'ecs_cluster', name: 'ECS Cluster', cat: 'compute', diff: 'Intermediate', file: 'ecs_cluster',
  res: ['aws_ecs_cluster'], kw: 'ecs cluster containers docker fargate',
  desc: 'A logical grouping for ECS services and tasks. Part of the ECS trio with task definition and service.',
  use: 'Running containers on Fargate without managing servers.',
  fields: [{ k: 'insights', l: 'Container Insights', t: 'bool', d: true }],
  gen(c, x) {
    x.v('ecs_container_insights', 'bool', 'Enable CloudWatch Container Insights', c.insights);
    x.o('ecs_cluster_name', 'aws_ecs_cluster.main.name', 'Name of the ECS cluster');
    return R('resource "aws_ecs_cluster" "main"', [
      'name = "${local.name_prefix}-cluster"', '',
      B('setting', ['name = "containerInsights"', 'value = var.ecs_container_insights ? "enabled" : "disabled"']),
    ]);
  },
});

S({
  id: 'ecs_task', name: 'ECS Task Definition', cat: 'compute', diff: 'Intermediate', file: 'ecs_task_definition',
  res: ['aws_ecs_task_definition', 'aws_iam_role', 'aws_cloudwatch_log_group'], deps: ['ecs_cluster', 'ecr'], kw: 'ecs task definition container fargate',
  desc: 'The container spec (image, CPU, memory, ports, logs) that ECS runs, sized for Fargate.',
  use: 'Describing what to run, independently of where and how many.',
  fields: [
    { k: 'container', l: 'Container name', t: 'text', d: 'app' },
    { k: 'image', l: 'Container image', t: 'text', d: 'public.ecr.aws/nginx/nginx:stable', h: 'Ignored when ECR is selected; the repository URL is used instead.' },
    { k: 'port', l: 'Container port', t: 'number', d: 80 },
    { k: 'cpu', l: 'CPU units', t: 'select', d: '256', o: ['256', '512', '1024', '2048'] },
    { k: 'memory', l: 'Memory (MiB)', t: 'select', d: '512', o: ['512', '1024', '2048', '4096'] },
  ],
  gen(c, x) {
    x.v('ecs_container_name', 'string', 'Name of the container in the task definition', c.container);
    x.v('ecs_container_port', 'number', 'Port the container listens on', Number(c.port));
    x.v('ecs_task_cpu', 'string', 'Fargate task CPU units', c.cpu);
    x.v('ecs_task_memory', 'string', 'Fargate task memory in MiB', c.memory);
    let image;
    if (x.has('ecr')) { x.v('ecs_image_tag', 'string', 'Image tag to deploy from the ECR repository', 'latest'); image = '"${aws_ecr_repository.main.repository_url}:${var.ecs_image_tag}"'; }
    else image = x.v('ecs_container_image', 'string', 'Container image to run', c.image);
    x.o('ecs_task_definition_arn', 'aws_ecs_task_definition.app.arn', 'ARN of the task definition');
    return assumeDoc('ecs_tasks', 'ecs-tasks.amazonaws.com')
      + '\n\n' + R('resource "aws_iam_role" "ecs_task_execution"', ['name_prefix = "${local.name_prefix}-ecs-exec-"', 'assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json'])
      + '\n\n' + R('resource "aws_iam_role_policy_attachment" "ecs_task_execution"', ['role = aws_iam_role.ecs_task_execution.name', 'policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"'])
      + '\n\n' + R('resource "aws_cloudwatch_log_group" "ecs"', ['name = "/ecs/${local.name_prefix}-app"', 'retention_in_days = 14'])
      + '\n\n' + R('resource "aws_ecs_task_definition" "app"', [
        'family = "${local.name_prefix}-app"',
        'requires_compatibilities = ["FARGATE"]',
        'network_mode = "awsvpc"',
        'cpu = var.ecs_task_cpu',
        'memory = var.ecs_task_memory',
        'execution_role_arn = aws_iam_role.ecs_task_execution.arn',
        '',
        B('runtime_platform', ['operating_system_family = "LINUX"', 'cpu_architecture = "X86_64"']),
        '',
        'container_definitions = jsonencode([\n  {\n    name      = var.ecs_container_name\n    image     = ' + image + '\n    essential = true\n    portMappings = [\n      { containerPort = var.ecs_container_port, protocol = "tcp" }\n    ]\n    logConfiguration = {\n      logDriver = "awslogs"\n      options = {\n        "awslogs-group"         = aws_cloudwatch_log_group.ecs.name\n        "awslogs-region"        = var.aws_region\n        "awslogs-stream-prefix" = "app"\n      }\n    }\n  }\n])',
      ]);
  },
});

S({
  id: 'ecs_service', name: 'ECS Service', cat: 'compute', diff: 'Intermediate', file: 'ecs_service',
  res: ['aws_ecs_service'], deps: ['ecs_cluster', 'ecs_task', 'subnet', 'sg', 'tg'], kw: 'ecs service fargate containers',
  desc: 'Keeps the desired number of tasks running on Fargate, optionally behind a load balancer.',
  use: 'Long-running containerised web apps and workers.',
  fields: [{ k: 'count', l: 'Desired task count', t: 'number', d: 2 }],
  gen(c, x) {
    x.v('ecs_desired_count', 'number', 'Number of tasks to keep running', Number(c.count));
    const cluster = x.has('ecs_cluster') ? 'aws_ecs_cluster.main.id' : x.v('ecs_cluster_arn', 'string', 'ARN of an existing ECS cluster');
    const task = x.has('ecs_task') ? 'aws_ecs_task_definition.app.arn' : x.v('ecs_task_definition_arn', 'string', 'ARN of an existing task definition');
    const tg = x.has('tg');
    if (tg) { x.v('ecs_container_name', 'string', 'Name of the container in the task definition', 'app'); x.v('ecs_container_port', 'number', 'Port the container listens on', 80); }
    x.o('ecs_service_name', 'aws_ecs_service.app.name', 'Name of the ECS service');
    return R('resource "aws_ecs_service" "app"', [
      'name = "${local.name_prefix}-app"',
      'cluster = ' + cluster,
      'task_definition = ' + task,
      'desired_count = var.ecs_desired_count',
      'launch_type = "FARGATE"',
      '',
      B('network_configuration', ['subnets = ' + x.privateIds(), x.has('sg') ? 'security_groups = [aws_security_group.main.id]' : null, 'assign_public_ip = false']),
      '',
      B('deployment_circuit_breaker', ['enable = true', 'rollback = true']),
      tg ? '' : null,
      tg ? B('load_balancer', ['target_group_arn = aws_lb_target_group.app.arn', 'container_name = var.ecs_container_name', 'container_port = var.ecs_container_port']) : null,
      tg && x.has('listener') ? '\n# The target group must be attached to a listener before ECS registers tasks.\ndepends_on = [aws_lb_listener.main]' : null,
    ]);
  },
});

S({
  id: 'eks_cluster', name: 'EKS Cluster', cat: 'compute', diff: 'Advanced', file: 'eks_cluster',
  res: ['aws_eks_cluster', 'aws_iam_role', 'aws_iam_role_policy_attachment'], deps: ['vpc', 'subnet', 'sg', 'eks_node_group', 'kms'], kw: 'eks kubernetes k8s cluster',
  desc: 'A managed Kubernetes control plane with API-mode access entries and its IAM role.',
  use: 'Running Kubernetes workloads without operating the control plane.',
  fields: [
    { k: 'name', l: 'Cluster name', t: 'text', d: 'learning-eks' },
    { k: 'version', l: 'Kubernetes version (optional)', t: 'text', d: '', h: 'Leave empty to let EKS pick its current default. Pin it for production.' },
    { k: 'public', l: 'Public API endpoint', t: 'bool', d: true },
    { k: 'cidrs', l: 'Allowed public API CIDRs', t: 'list', d: '0.0.0.0/0', h: 'Narrow this to your office or VPN range.' },
  ],
  gen(c, x) {
    x.v('eks_cluster_name', 'string', 'Name of the EKS cluster', c.name);
    x.v('eks_kubernetes_version', 'string', 'Kubernetes version. Null lets EKS choose its default', c.version || null);
    x.v('eks_endpoint_public_access', 'bool', 'Expose the Kubernetes API endpoint publicly', c.public);
    x.v('eks_public_access_cidrs', 'list(string)', 'CIDRs allowed to reach the public API endpoint', csv(c.cidrs));
    x.o('eks_cluster_name', 'aws_eks_cluster.main.name', 'Name of the EKS cluster');
    x.o('eks_cluster_endpoint', 'aws_eks_cluster.main.endpoint', 'Kubernetes API server endpoint');
    return assumeDoc('eks_cluster', 'eks.amazonaws.com')
      + '\n\n' + R('resource "aws_iam_role" "eks_cluster"', ['name_prefix = "${local.name_prefix}-eks-"', 'assume_role_policy = data.aws_iam_policy_document.eks_cluster_assume.json'])
      + '\n\n' + R('resource "aws_iam_role_policy_attachment" "eks_cluster"', ['role = aws_iam_role.eks_cluster.name', 'policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"'])
      + '\n\n' + R('resource "aws_eks_cluster" "main"', [
        'name = var.eks_cluster_name',
        'role_arn = aws_iam_role.eks_cluster.arn',
        'version = var.eks_kubernetes_version',
        'enabled_cluster_log_types = ["api", "audit", "authenticator"]',
        '',
        B('access_config', ['authentication_mode = "API"', 'bootstrap_cluster_creator_admin_permissions = true']),
        '',
        B('vpc_config', ['subnet_ids = ' + x.privateIds(), x.has('sg') ? 'security_group_ids = [aws_security_group.main.id]' : null, 'endpoint_private_access = true', 'endpoint_public_access = var.eks_endpoint_public_access', 'public_access_cidrs = var.eks_public_access_cidrs']),
        x.has('kms') ? '' : null,
        x.has('kms') ? B('encryption_config', ['resources = ["secrets"]', '', B('provider', ['key_arn = aws_kms_key.main.arn'])]) : null,
        '',
        '# The role policy must be attached before EKS creates the control plane,\n# and must outlive it on destroy.',
        'depends_on = [aws_iam_role_policy_attachment.eks_cluster]',
      ]);
  },
});

S({
  id: 'eks_node_group', name: 'EKS Node Group', cat: 'compute', diff: 'Advanced', file: 'eks_node_group',
  res: ['aws_eks_node_group', 'aws_iam_role', 'aws_iam_role_policy_attachment'], deps: ['eks_cluster', 'subnet'], kw: 'eks kubernetes nodes worker node group',
  desc: 'Managed EC2 worker nodes for EKS, with the three AWS-managed node policies attached using for_each.',
  use: 'Adding compute capacity that Kubernetes schedules pods onto.',
  fields: [
    { k: 'type', l: 'Instance type', t: 'select', d: 't3.medium', o: ['t3.medium', 't3.large', 'm7i.large', 'm7i.xlarge'] },
    { k: 'capacity', l: 'Capacity type', t: 'select', d: 'ON_DEMAND', o: ['ON_DEMAND', 'SPOT'] },
    { k: 'min', l: 'Min nodes', t: 'number', d: 1 },
    { k: 'desired', l: 'Desired nodes', t: 'number', d: 2 },
    { k: 'max', l: 'Max nodes', t: 'number', d: 3 },
  ],
  gen(c, x) {
    x.v('eks_node_instance_type', 'string', 'EC2 instance type for worker nodes', c.type);
    x.v('eks_capacity_type', 'string', 'ON_DEMAND or SPOT', c.capacity, { condition: 'contains(["ON_DEMAND", "SPOT"], var.eks_capacity_type)', error: 'eks_capacity_type must be ON_DEMAND or SPOT.' });
    x.v('eks_node_min_size', 'number', 'Minimum node count', Number(c.min));
    x.v('eks_node_desired_size', 'number', 'Desired node count', Number(c.desired));
    x.v('eks_node_max_size', 'number', 'Maximum node count', Number(c.max));
    const cluster = x.has('eks_cluster') ? 'aws_eks_cluster.main.name' : x.v('eks_cluster_name', 'string', 'Name of the EKS cluster', 'learning-eks');
    x.o('eks_node_group_status', 'aws_eks_node_group.main.status', 'Status of the managed node group');
    return assumeDoc('eks_node', 'ec2.amazonaws.com')
      + '\n\n' + R('resource "aws_iam_role" "eks_node"', ['name_prefix = "${local.name_prefix}-node-"', 'assume_role_policy = data.aws_iam_policy_document.eks_node_assume.json'])
      + '\n\n' + R('resource "aws_iam_role_policy_attachment" "eks_node"', [
        'for_each = toset([\n  "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy",\n  "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy",\n  "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",\n])',
        '', 'role = aws_iam_role.eks_node.name', 'policy_arn = each.value',
      ])
      + '\n\n' + R('resource "aws_eks_node_group" "main"', [
        'cluster_name = ' + cluster,
        'node_group_name = "${local.name_prefix}-nodes"',
        'node_role_arn = aws_iam_role.eks_node.arn',
        'subnet_ids = ' + x.privateIds(),
        'ami_type = "AL2023_x86_64_STANDARD"',
        'instance_types = [var.eks_node_instance_type]',
        'capacity_type = var.eks_capacity_type',
        '',
        B('scaling_config', ['min_size = var.eks_node_min_size', 'desired_size = var.eks_node_desired_size', 'max_size = var.eks_node_max_size']),
        '',
        B('update_config', ['max_unavailable = 1']),
        '',
        'depends_on = [aws_iam_role_policy_attachment.eks_node]',
        '',
        '# Cluster Autoscaler or Karpenter adjusts this at runtime.',
        B('lifecycle', ['ignore_changes = [scaling_config[0].desired_size]']),
      ]);
  },
});

S({
  id: 'ecr', name: 'Elastic Container Registry', cat: 'compute', diff: 'Beginner', file: 'ecr',
  res: ['aws_ecr_repository', 'aws_ecr_lifecycle_policy'], deps: ['kms'], kw: 'ecr registry docker images containers',
  desc: 'A private image repository with scan-on-push and a lifecycle rule that expires untagged images.',
  use: 'Storing container images for ECS, EKS and Lambda.',
  fields: [
    { k: 'name', l: 'Repository name', t: 'text', d: 'learning-app' },
    { k: 'mutability', l: 'Tag mutability', t: 'select', d: 'IMMUTABLE', o: ['IMMUTABLE', 'MUTABLE'] },
  ],
  gen(c, x) {
    x.v('ecr_repository_name', 'string', 'Name of the ECR repository', c.name);
    x.v('ecr_image_tag_mutability', 'string', 'IMMUTABLE prevents overwriting an existing tag', c.mutability);
    x.o('ecr_repository_url', 'aws_ecr_repository.main.repository_url', 'URL to push and pull images');
    return R('resource "aws_ecr_repository" "main"', [
      'name = var.ecr_repository_name', 'image_tag_mutability = var.ecr_image_tag_mutability', 'force_delete = false', '',
      B('image_scanning_configuration', ['scan_on_push = true']), '',
      B('encryption_configuration', x.kmsArn() ? ['encryption_type = "KMS"', 'kms_key = aws_kms_key.main.arn'] : ['encryption_type = "AES256"']),
    ]) + '\n\n' + R('resource "aws_ecr_lifecycle_policy" "main"', [
      'repository = aws_ecr_repository.main.name', '',
      'policy = jsonencode({\n  rules = [{\n    rulePriority = 1\n    description  = "Expire untagged images after 14 days"\n    selection = {\n      tagStatus   = "untagged"\n      countType   = "sinceImagePushed"\n      countUnit   = "days"\n      countNumber = 14\n    }\n    action = { type = "expire" }\n  }]\n})',
    ]);
  },
});

S({
  id: 'ssm', name: 'Systems Manager', cat: 'compute', diff: 'Beginner', file: 'ssm',
  res: ['aws_ssm_parameter'], kw: 'ssm systems manager parameter store session manager',
  desc: 'A Parameter Store value for app config. With an IAM role selected, instances also get Session Manager access.',
  use: 'Central configuration, and shell access to instances without SSH keys or open port 22.',
  fields: [
    { k: 'key', l: 'Parameter key', t: 'text', d: 'app/log_level' },
    { k: 'value', l: 'Parameter value', t: 'text', d: 'info', h: 'Plain configuration only. Never put secrets in Terraform values; they are stored in state.' },
  ],
  gen(c, x) {
    x.v('ssm_parameter_key', 'string', 'Key under /<project>/<environment>/', c.key);
    x.v('ssm_parameter_value', 'string', 'Non-secret configuration value', c.value);
    x.o('ssm_parameter_name', 'aws_ssm_parameter.app_config.name', 'Full name of the SSM parameter');
    return R('resource "aws_ssm_parameter" "app_config"', [
      'name = "/${var.project_name}/${var.environment}/${var.ssm_parameter_key}"', 'description = "Application configuration managed by Terraform"',
      'type = "String"', 'tier = "Standard"', 'value = var.ssm_parameter_value',
    ]);
  },
});

S({
  id: 'iam_role', name: 'IAM Role', cat: 'compute', diff: 'Intermediate', file: 'iam_role',
  res: ['aws_iam_role', 'aws_iam_instance_profile', 'aws_iam_role_policy_attachment', 'data.aws_iam_policy_document'], kw: 'iam role identity trust instance profile',
  desc: 'A role for your application with a trust policy built from a data source, plus an instance profile for EC2.',
  use: 'Giving workloads temporary credentials instead of access keys.',
  fields: [
    { k: 'service', l: 'Trusted service', t: 'select', d: 'ec2.amazonaws.com', o: ['ec2.amazonaws.com', 'ecs-tasks.amazonaws.com', 'lambda.amazonaws.com'] },
    { k: 'ssm_core', l: 'Allow Session Manager (EC2)', t: 'bool', d: true },
  ],
  gen(c, x) {
    x.v('iam_role_trusted_service', 'string', 'AWS service principal allowed to assume the role', c.service);
    const ec2 = x.has('ec2') || x.has('lt');
    x.o('iam_role_arn', 'aws_iam_role.app.arn', 'ARN of the application IAM role');
    let h = R('data "aws_iam_policy_document" "app_assume"', [B('statement', ['effect = "Allow"', 'actions = ["sts:AssumeRole"]', '', B('principals', ['type = "Service"', 'identifiers = [var.iam_role_trusted_service]'])])])
      + '\n\n' + R('resource "aws_iam_role" "app"', ['name_prefix = "${local.name_prefix}-app-"', 'description = "Application role managed by Terraform"', 'assume_role_policy = data.aws_iam_policy_document.app_assume.json', 'max_session_duration = 3600']);
    if (ec2) h += '\n\n' + R('resource "aws_iam_instance_profile" "app"', ['name_prefix = "${local.name_prefix}-app-"', 'role = aws_iam_role.app.name']);
    if (c.ssm_core && ec2) h += '\n\n' + R('resource "aws_iam_role_policy_attachment" "ssm_core"', ['role = aws_iam_role.app.name', 'policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"']);
    if (x.has('iam_policy')) h += '\n\n' + R('resource "aws_iam_role_policy_attachment" "app_custom"', ['role = aws_iam_role.app.name', 'policy_arn = aws_iam_policy.app.arn']);
    return h;
  },
});

S({
  id: 'iam_policy', name: 'IAM Policy', cat: 'compute', diff: 'Intermediate', file: 'iam_policy',
  res: ['aws_iam_policy', 'data.aws_iam_policy_document', 'data.aws_caller_identity'], deps: ['iam_role'], kw: 'iam policy permissions least privilege',
  desc: 'A least-privilege customer managed policy that adapts to the services you selected.',
  use: 'Granting an application exactly the S3, SSM or logs access it needs.',
  gen(c, x) {
    x.caller();
    const st = [];
    if (x.has('s3')) {
      st.push(B('statement', ['sid = "ListAppBucket"', 'actions = ["s3:ListBucket"]', 'resources = [aws_s3_bucket.main.arn]']));
      st.push(B('statement', ['sid = "ReadWriteAppObjects"', 'actions = ["s3:GetObject", "s3:PutObject"]', 'resources = ["${aws_s3_bucket.main.arn}/*"]']));
    }
    if (x.has('ssm')) st.push(B('statement', ['sid = "ReadAppParameter"', 'actions = ["ssm:GetParameter"]', 'resources = [aws_ssm_parameter.app_config.arn]']));
    if (x.has('dynamodb')) st.push(B('statement', ['sid = "UseAppTable"', 'actions = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query", "dynamodb:UpdateItem"]', 'resources = [aws_dynamodb_table.main.arn]']));
    st.push(B('statement', ['sid = "WriteAppLogs"', 'actions = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]', 'resources = ["arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/${var.project_name}/*"]']));
    const items = []; st.forEach((s, i) => { if (i) items.push(''); items.push(s); });
    x.o('iam_policy_arn', 'aws_iam_policy.app.arn', 'ARN of the application IAM policy');
    return R('data "aws_iam_policy_document" "app"', items)
      + '\n\n' + R('resource "aws_iam_policy" "app"', ['name_prefix = "${local.name_prefix}-app-"', 'description = "Least-privilege application policy"', 'policy = data.aws_iam_policy_document.app.json']);
  },
});

/* ============================ DATABASE ============================ */
S({
  id: 'dbsg', name: 'DB Subnet Group', cat: 'database', diff: 'Beginner', file: 'db_subnet_group',
  res: ['aws_db_subnet_group'], deps: ['subnet'], kw: 'rds aurora subnet group database',
  desc: 'Tells RDS and Aurora which private subnets (at least two AZs) they may use.',
  use: 'Required placement for any RDS instance or Aurora cluster in a VPC.',
  gen(c, x) {
    x.o('db_subnet_group_name', 'aws_db_subnet_group.main.name', 'Name of the DB subnet group');
    return R('resource "aws_db_subnet_group" "main"', ['name_prefix = "${local.name_prefix}-"', 'description = "Private subnets for databases"', 'subnet_ids = ' + x.privateIds(), '', tags(N('db-subnets'))]);
  },
});

function rdsService(id, name, engineLocked, resName, extraDesc) {
  const pfx = id;
  const fields = [];
  if (!engineLocked) fields.push({ k: 'engine', l: 'Engine', t: 'select', d: 'postgres', o: ['postgres', 'mysql', 'mariadb', 'sqlserver-ex'] });
  const sql = engineLocked === 'sqlserver-ex';
  fields.push(
    { k: 'class', l: 'Instance class', t: 'select', d: sql ? 'db.t3.small' : 'db.t4g.micro', o: sql ? ['db.t3.small', 'db.t3.medium', 'db.m6i.large'] : ['db.t4g.micro', 'db.t4g.small', 'db.t4g.medium', 'db.m7g.large'] },
    { k: 'storage', l: 'Allocated storage (GB)', t: 'number', d: 20 },
    { k: 'version', l: 'Engine version (optional)', t: 'text', d: '', h: 'Empty uses the RDS default for the engine. Pin a version for production.' },
  );
  if (!sql) fields.push({ k: 'dbname', l: 'Initial database name', t: 'text', d: 'appdb' });
  fields.push(
    { k: 'username', l: 'Master username', t: 'text', d: 'dbadmin' },
    { k: 'multi_az', l: 'Multi-AZ', t: 'bool', d: false, h: sql ? 'SQL Server Express does not support Multi-AZ.' : '' },
    { k: 'backup', l: 'Backup retention (days)', t: 'number', d: 7 },
    { k: 'deletion_protection', l: 'Deletion protection', t: 'bool', d: true, h: 'Turn off before running terraform destroy.' },
  );
  S({
    id, name, cat: 'database', diff: 'Intermediate', file: id,
    res: ['aws_db_instance'], deps: ['vpc', 'subnet', 'dbsg', 'sg', 'kms'], kw: 'rds database sql ' + (engineLocked || 'postgres mysql mariadb sqlserver'),
    desc: extraDesc,
    use: 'Managed relational databases with automated backups and patching.',
    fields,
    assume: ['The master password is never generated: manage_master_user_password stores it in AWS Secrets Manager.', 'skip_final_snapshot is false, so destroy takes a final snapshot.'],
    gen(c, x) {
      const engine = engineLocked || c.engine;
      const isSql = engine.startsWith('sqlserver');
      x.v(`${pfx}_instance_class`, 'string', `Instance class for ${name}`, c.class);
      x.v(`${pfx}_allocated_storage`, 'number', 'Initial storage in GiB', Number(c.storage), { condition: `var.${pfx}_allocated_storage >= 20`, error: 'RDS needs at least 20 GiB of gp3 storage.' });
      x.v(`${pfx}_engine_version`, 'string', 'Engine version. Null uses the RDS default', c.version || null);
      if (!isSql) x.v(`${pfx}_db_name`, 'string', 'Name of the initial database', c.dbname);
      x.v(`${pfx}_username`, 'string', 'Master username (the password is managed in Secrets Manager)', c.username);
      x.v(`${pfx}_multi_az`, 'bool', 'Deploy a synchronous standby in another AZ', isSql && engine === 'sqlserver-ex' ? false : c.multi_az);
      x.v(`${pfx}_backup_retention_days`, 'number', 'Days to keep automated backups', Number(c.backup));
      x.v(`${pfx}_deletion_protection`, 'bool', 'Block deletion of the database', c.deletion_protection);
      const sg = x.has('dbsg') ? 'aws_db_subnet_group.main.name' : x.v('db_subnet_group_name', 'string', 'Name of an existing DB subnet group');
      const kms = x.kmsArn();
      x.o(`${pfx}_address`, `aws_db_instance.${resName}.address`, `Hostname of ${name}`);
      x.o(`${pfx}_port`, `aws_db_instance.${resName}.port`, `Port of ${name}`);
      x.o(`${pfx}_master_secret_arn`, `aws_db_instance.${resName}.master_user_secret[0].secret_arn`, 'Secrets Manager ARN holding the master password');
      return R(`resource "aws_db_instance" "${resName}"`, [
        `identifier = ${N(id.replace(/_/g, '-'))}`,
        `engine = "${engine}"`,
        `engine_version = var.${pfx}_engine_version`,
        `instance_class = var.${pfx}_instance_class`,
        isSql ? 'license_model = "license-included"' : null,
        '',
        `allocated_storage = var.${pfx}_allocated_storage`,
        `max_allocated_storage = var.${pfx}_allocated_storage * 5`,
        'storage_type = "gp3"',
        'storage_encrypted = true',
        kms ? 'kms_key_id = ' + kms : null,
        '',
        isSql ? null : `db_name = var.${pfx}_db_name`,
        `username = var.${pfx}_username`,
        '# No password in code or state: RDS generates it and stores it in Secrets Manager.',
        'manage_master_user_password = true',
        '',
        'db_subnet_group_name = ' + sg,
        x.sgOpt('vpc_security_group_ids'),
        'publicly_accessible = false',
        `multi_az = var.${pfx}_multi_az`,
        '',
        `backup_retention_period = var.${pfx}_backup_retention_days`,
        'copy_tags_to_snapshot = true',
        'auto_minor_version_upgrade = true',
        `deletion_protection = var.${pfx}_deletion_protection`,
        'skip_final_snapshot = false',
        `final_snapshot_identifier = ${N(id.replace(/_/g, '-') + '-final')}`,
        '',
        tags(N(id.replace(/_/g, '-'))),
      ]);
    },
  });
}
rdsService('rds', 'RDS (choose engine)', null, 'main', 'One aws_db_instance resource covers PostgreSQL, MySQL, MariaDB and SQL Server; the engine argument decides.');
rdsService('rds_postgres', 'RDS PostgreSQL', 'postgres', 'postgres', 'aws_db_instance with engine = "postgres". Same resource as the other RDS cards.');
rdsService('rds_mysql', 'RDS MySQL', 'mysql', 'mysql', 'aws_db_instance with engine = "mysql". Same resource, different engine argument.');
rdsService('rds_sqlserver', 'RDS SQL Server', 'sqlserver-ex', 'sqlserver', 'aws_db_instance with engine = "sqlserver-ex" and license_model. db_name must be omitted for SQL Server.');

S({
  id: 'aurora', name: 'Aurora', cat: 'database', diff: 'Advanced', file: 'aurora',
  res: ['aws_rds_cluster', 'aws_rds_cluster_instance'], deps: ['vpc', 'subnet', 'dbsg', 'sg', 'kms'], kw: 'aurora rds cluster postgres mysql database',
  desc: 'An Aurora cluster (shared storage) plus writer and reader instances created with count.',
  use: 'High-throughput relational workloads with fast failover and read scaling.',
  fields: [
    { k: 'engine', l: 'Engine', t: 'select', d: 'aurora-postgresql', o: ['aurora-postgresql', 'aurora-mysql'] },
    { k: 'class', l: 'Instance class', t: 'select', d: 'db.t4g.medium', o: ['db.t4g.medium', 'db.r7g.large'] },
    { k: 'count', l: 'Instances (writer + readers)', t: 'number', d: 2 },
    { k: 'dbname', l: 'Initial database name', t: 'text', d: 'appdb' },
    { k: 'username', l: 'Master username', t: 'text', d: 'dbadmin' },
    { k: 'deletion_protection', l: 'Deletion protection', t: 'bool', d: true },
  ],
  assume: ['The password is managed by RDS in Secrets Manager via manage_master_user_password.'],
  gen(c, x) {
    x.v('aurora_instance_class', 'string', 'Instance class for Aurora instances', c.class);
    x.v('aurora_instance_count', 'number', 'Number of instances; the first becomes the writer', Number(c.count), { condition: 'var.aurora_instance_count >= 1', error: 'Aurora needs at least one instance.' });
    x.v('aurora_database_name', 'string', 'Name of the initial database', c.dbname);
    x.v('aurora_master_username', 'string', 'Master username (password managed in Secrets Manager)', c.username);
    x.v('aurora_deletion_protection', 'bool', 'Block deletion of the cluster', c.deletion_protection);
    const sg = x.has('dbsg') ? 'aws_db_subnet_group.main.name' : x.v('db_subnet_group_name', 'string', 'Name of an existing DB subnet group');
    const kms = x.kmsArn();
    x.o('aurora_endpoint', 'aws_rds_cluster.main.endpoint', 'Writer endpoint of the Aurora cluster');
    x.o('aurora_reader_endpoint', 'aws_rds_cluster.main.reader_endpoint', 'Load-balanced reader endpoint');
    return R('resource "aws_rds_cluster" "main"', [
      'cluster_identifier = "${local.name_prefix}-aurora"', `engine = "${c.engine}"`, '',
      'database_name = var.aurora_database_name', 'master_username = var.aurora_master_username', 'manage_master_user_password = true', '',
      'db_subnet_group_name = ' + sg, x.sgOpt('vpc_security_group_ids'), '',
      'storage_encrypted = true', kms ? 'kms_key_id = ' + kms : null, 'backup_retention_period = 7', 'copy_tags_to_snapshot = true',
      'deletion_protection = var.aurora_deletion_protection', 'skip_final_snapshot = false', 'final_snapshot_identifier = "${local.name_prefix}-aurora-final"',
    ]) + '\n\n' + R('resource "aws_rds_cluster_instance" "main"', [
      'count = var.aurora_instance_count', '',
      'identifier = "${local.name_prefix}-aurora-${count.index}"', 'cluster_identifier = aws_rds_cluster.main.id',
      'instance_class = var.aurora_instance_class', 'engine = aws_rds_cluster.main.engine', 'engine_version = aws_rds_cluster.main.engine_version',
      'db_subnet_group_name = aws_rds_cluster.main.db_subnet_group_name', 'publicly_accessible = false',
    ]);
  },
});

S({
  id: 'dynamodb', name: 'DynamoDB', cat: 'database', diff: 'Beginner', file: 'dynamodb',
  res: ['aws_dynamodb_table'], deps: ['kms'], kw: 'dynamodb nosql table key-value',
  desc: 'An on-demand table with point-in-time recovery. The sort key uses a dynamic block.',
  use: 'Serverless key-value and document workloads.',
  fields: [
    { k: 'name', l: 'Table name', t: 'text', d: 'learning-items' },
    { k: 'hash', l: 'Partition key', t: 'text', d: 'pk' },
    { k: 'range', l: 'Sort key (optional)', t: 'text', d: 'sk' },
    { k: 'deletion_protection', l: 'Deletion protection', t: 'bool', d: true },
  ],
  gen(c, x) {
    x.v('dynamodb_table_name', 'string', 'Name of the DynamoDB table', c.name);
    x.v('dynamodb_hash_key', 'string', 'Partition key attribute name (string type)', c.hash);
    x.v('dynamodb_range_key', 'string', 'Sort key attribute name. Null for a partition-key-only table', c.range || null);
    x.v('dynamodb_deletion_protection', 'bool', 'Block deletion of the table', c.deletion_protection);
    const kms = x.kmsArn();
    x.o('dynamodb_table_name', 'aws_dynamodb_table.main.name', 'Name of the DynamoDB table');
    x.o('dynamodb_table_arn', 'aws_dynamodb_table.main.arn', 'ARN of the DynamoDB table');
    return R('resource "aws_dynamodb_table" "main"', [
      'name = var.dynamodb_table_name', 'billing_mode = "PAY_PER_REQUEST"', 'hash_key = var.dynamodb_hash_key', 'range_key = var.dynamodb_range_key',
      'deletion_protection_enabled = var.dynamodb_deletion_protection', '',
      B('attribute', ['name = var.dynamodb_hash_key', 'type = "S"']), '',
      '# Declare the sort key attribute only when a sort key is set.',
      B('dynamic "attribute"', ['for_each = var.dynamodb_range_key == null ? [] : [var.dynamodb_range_key]', '', B('content', ['name = attribute.value', 'type = "S"'])]), '',
      B('point_in_time_recovery', ['enabled = true']), '',
      B('server_side_encryption', ['enabled = true', kms ? 'kms_key_arn = ' + kms : null]), '',
      tags('var.dynamodb_table_name'),
    ]);
  },
});

S({
  id: 'elasticache', name: 'ElastiCache', cat: 'database', diff: 'Intermediate', file: 'elasticache',
  res: ['aws_elasticache_replication_group', 'aws_elasticache_subnet_group'], deps: ['subnet', 'sg', 'kms'], kw: 'elasticache redis valkey cache',
  desc: 'A Valkey or Redis OSS replication group with encryption in transit and at rest.',
  use: 'Sessions, caching and rate limiting in front of a database.',
  fields: [
    { k: 'engine', l: 'Engine', t: 'select', d: 'valkey', o: ['valkey', 'redis'] },
    { k: 'node', l: 'Node type', t: 'select', d: 'cache.t4g.micro', o: ['cache.t4g.micro', 'cache.t4g.small', 'cache.r7g.large'] },
    { k: 'nodes', l: 'Nodes (primary + replicas)', t: 'number', d: 2 },
  ],
  gen(c, x) {
    x.v('elasticache_engine', 'string', 'Cache engine: valkey or redis', c.engine);
    x.v('elasticache_node_type', 'string', 'Cache node type', c.node);
    x.v('elasticache_num_cache_clusters', 'number', 'Number of nodes; more than one enables automatic failover', Number(c.nodes));
    const kms = x.kmsArn();
    x.o('elasticache_primary_endpoint', 'aws_elasticache_replication_group.main.primary_endpoint_address', 'Primary endpoint for writes');
    return R('resource "aws_elasticache_subnet_group" "main"', ['name = "${local.name_prefix}-cache"', 'subnet_ids = ' + x.privateIds()])
      + '\n\n' + R('resource "aws_elasticache_replication_group" "main"', [
        'replication_group_id = "${local.name_prefix}-cache"', 'description = "Application cache managed by Terraform"',
        'engine = var.elasticache_engine', 'node_type = var.elasticache_node_type', 'num_cache_clusters = var.elasticache_num_cache_clusters', 'port = 6379', '',
        'automatic_failover_enabled = var.elasticache_num_cache_clusters > 1', 'multi_az_enabled = var.elasticache_num_cache_clusters > 1', '',
        'subnet_group_name = aws_elasticache_subnet_group.main.name', x.has('sg') ? 'security_group_ids = [aws_security_group.main.id]' : null, '',
        'at_rest_encryption_enabled = true', 'transit_encryption_enabled = true', kms ? 'kms_key_id = ' + kms : null, 'snapshot_retention_limit = 1', '',
        tags(N('cache')),
      ]);
  },
});

S({
  id: 'memorydb', name: 'MemoryDB', cat: 'database', diff: 'Advanced', file: 'memorydb',
  res: ['aws_memorydb_cluster', 'aws_memorydb_subnet_group'], deps: ['subnet', 'sg', 'kms'], kw: 'memorydb redis valkey durable in-memory',
  desc: 'A durable in-memory database cluster with TLS, sharding and replicas.',
  use: 'In-memory primary databases where data must survive node failures.',
  fields: [
    { k: 'node', l: 'Node type', t: 'select', d: 'db.t4g.small', o: ['db.t4g.small', 'db.t4g.medium', 'db.r7g.large'] },
    { k: 'shards', l: 'Shards', t: 'number', d: 1 },
    { k: 'replicas', l: 'Replicas per shard', t: 'number', d: 1 },
  ],
  assume: ['Uses the built-in open-access ACL so you can connect while learning. Create users and an ACL before production.'],
  gen(c, x) {
    x.v('memorydb_node_type', 'string', 'MemoryDB node type', c.node);
    x.v('memorydb_num_shards', 'number', 'Number of shards', Number(c.shards));
    x.v('memorydb_replicas_per_shard', 'number', 'Replicas per shard', Number(c.replicas));
    const kms = x.kmsArn();
    x.o('memorydb_endpoint', 'aws_memorydb_cluster.main.cluster_endpoint[0].address', 'Cluster configuration endpoint');
    return R('resource "aws_memorydb_subnet_group" "main"', ['name = "${local.name_prefix}-memorydb"', 'subnet_ids = ' + x.privateIds()])
      + '\n\n' + R('resource "aws_memorydb_cluster" "main"', [
        'name = "${local.name_prefix}-memorydb"', '# Replace with a real ACL before production.', 'acl_name = "open-access"',
        'node_type = var.memorydb_node_type', 'num_shards = var.memorydb_num_shards', 'num_replicas_per_shard = var.memorydb_replicas_per_shard', '',
        'subnet_group_name = aws_memorydb_subnet_group.main.id', x.has('sg') ? 'security_group_ids = [aws_security_group.main.id]' : null,
        'tls_enabled = true', kms ? 'kms_key_arn = ' + kms : null, 'snapshot_retention_limit = 7', '',
        tags(N('memorydb')),
      ]);
  },
});

/* ============================ STORAGE ============================ */
S({
  id: 's3', name: 'S3 Bucket', cat: 'storage', diff: 'Beginner', file: 's3',
  res: ['aws_s3_bucket', 'aws_s3_bucket_public_access_block', 'aws_s3_bucket_ownership_controls'], deps: ['s3_versioning', 's3_encryption'], kw: 's3 bucket object storage',
  desc: 'A bucket with public access fully blocked and ACLs disabled. Versioning, encryption and lifecycle are separate resources.',
  use: 'Static assets, data lakes, backups and logs.',
  fields: [
    { k: 'name', l: 'Bucket name (optional)', t: 'text', d: '', h: 'Globally unique. Leave empty to use bucket_prefix and let AWS add a unique suffix.' },
    { k: 'force_destroy', l: 'Allow destroy when not empty', t: 'bool', d: false },
  ],
  gen(c, x) {
    x.v('s3_bucket_name', 'string', 'Explicit globally unique bucket name. Null uses a generated name', c.name || null);
    x.v('s3_force_destroy', 'bool', 'Delete all objects when the bucket is destroyed', c.force_destroy);
    x.o('s3_bucket_name', 'aws_s3_bucket.main.bucket', 'Name of the S3 bucket');
    x.o('s3_bucket_arn', 'aws_s3_bucket.main.arn', 'ARN of the S3 bucket');
    return R('resource "aws_s3_bucket" "main"', [
      'bucket = var.s3_bucket_name', 'bucket_prefix = var.s3_bucket_name == null ? "${local.name_prefix}-" : null', 'force_destroy = var.s3_force_destroy', '', tags(N('bucket')),
    ]) + '\n\n' + R('resource "aws_s3_bucket_public_access_block" "main"', [
      'bucket = aws_s3_bucket.main.id', '', 'block_public_acls = true', 'block_public_policy = true', 'ignore_public_acls = true', 'restrict_public_buckets = true',
    ]) + '\n\n' + R('resource "aws_s3_bucket_ownership_controls" "main"', ['bucket = aws_s3_bucket.main.id', '', B('rule', ['object_ownership = "BucketOwnerEnforced"'])]);
  },
});

const s3Ref = x => x.has('s3') ? 'aws_s3_bucket.main.id' : x.v('s3_bucket_id', 'string', 'Name of an existing S3 bucket');
S({
  id: 's3_versioning', name: 'S3 Bucket Versioning', cat: 'storage', diff: 'Beginner', file: 's3_versioning',
  res: ['aws_s3_bucket_versioning'], deps: ['s3'], kw: 's3 versioning bucket',
  desc: 'Keeps every version of every object so overwrites and deletes can be undone.',
  use: 'Protection against accidental deletion and ransomware-style overwrites.',
  fields: [{ k: 'status', l: 'Status', t: 'select', d: 'Enabled', o: ['Enabled', 'Suspended'] }],
  gen(c, x) {
    x.v('s3_versioning_status', 'string', 'Enabled or Suspended', c.status);
    return R('resource "aws_s3_bucket_versioning" "main"', ['bucket = ' + s3Ref(x), '', B('versioning_configuration', ['status = var.s3_versioning_status'])]);
  },
});
S({
  id: 's3_encryption', name: 'S3 Encryption', cat: 'storage', diff: 'Beginner', file: 's3_encryption',
  res: ['aws_s3_bucket_server_side_encryption_configuration'], deps: ['s3', 'kms'], kw: 's3 encryption sse kms bucket',
  desc: 'Default encryption for new objects: SSE-KMS with a bucket key when KMS is selected, otherwise SSE-S3.',
  use: 'Meeting encryption-at-rest requirements with your own key.',
  gen(c, x) {
    const kms = x.has('kms');
    return R('resource "aws_s3_bucket_server_side_encryption_configuration" "main"', ['bucket = ' + s3Ref(x), '',
      B('rule', [B('apply_server_side_encryption_by_default', kms ? ['sse_algorithm = "aws:kms"', 'kms_master_key_id = aws_kms_key.main.arn'] : ['sse_algorithm = "AES256"']), kms ? '# Bucket keys cut KMS request costs.\nbucket_key_enabled = true' : null])]);
  },
});
S({
  id: 's3_lifecycle', name: 'S3 Lifecycle Configuration', cat: 'storage', diff: 'Intermediate', file: 's3_lifecycle',
  res: ['aws_s3_bucket_lifecycle_configuration'], deps: ['s3', 's3_versioning'], kw: 's3 lifecycle glacier transition expiration',
  desc: 'Moves objects to cheaper storage classes over time and cleans up old versions and failed uploads.',
  use: 'Controlling storage cost for logs and archives.',
  fields: [
    { k: 'ia', l: 'Move to Standard-IA after (days)', t: 'number', d: 30 },
    { k: 'glacier', l: 'Move to Glacier Flexible Retrieval after (days)', t: 'number', d: 90 },
    { k: 'expire', l: 'Expire after (days)', t: 'number', d: 365 },
  ],
  gen(c, x) {
    x.v('s3_transition_ia_days', 'number', 'Days before moving objects to STANDARD_IA', Number(c.ia), { condition: 'var.s3_transition_ia_days >= 30', error: 'S3 requires at least 30 days before STANDARD_IA.' });
    x.v('s3_transition_glacier_days', 'number', 'Days before moving objects to GLACIER', Number(c.glacier));
    x.v('s3_expiration_days', 'number', 'Days before objects expire', Number(c.expire));
    return R('resource "aws_s3_bucket_lifecycle_configuration" "main"', ['bucket = ' + s3Ref(x), '',
      B('rule', ['id = "tiering-and-cleanup"', 'status = "Enabled"', '',
        '# An empty filter applies the rule to every object.', 'filter {}', '',
        B('transition', ['days = var.s3_transition_ia_days', 'storage_class = "STANDARD_IA"']), '',
        B('transition', ['days = var.s3_transition_glacier_days', 'storage_class = "GLACIER"']), '',
        B('expiration', ['days = var.s3_expiration_days']), '',
        B('noncurrent_version_expiration', ['noncurrent_days = 30']), '',
        B('abort_incomplete_multipart_upload', ['days_after_initiation = 7']),
      ]),
      x.has('s3_versioning') ? '\n# The provider docs recommend this so versioning is configured first.\ndepends_on = [aws_s3_bucket_versioning.main]' : null,
    ]);
  },
});
S({
  id: 'ebs', name: 'EBS Volume', cat: 'storage', diff: 'Beginner', file: 'ebs',
  res: ['aws_ebs_volume', 'aws_volume_attachment'], deps: ['ec2', 'kms'], kw: 'ebs volume disk block storage',
  desc: 'An encrypted gp3 block volume, attached to the EC2 instance when one is selected.',
  use: 'Extra data disks that outlive instance replacement.',
  fields: [
    { k: 'size', l: 'Size (GB)', t: 'number', d: 50 },
    { k: 'iops', l: 'IOPS', t: 'number', d: 3000 },
    { k: 'throughput', l: 'Throughput (MB/s)', t: 'number', d: 125 },
  ],
  gen(c, x) {
    x.v('ebs_size', 'number', 'Volume size in GiB', Number(c.size));
    x.v('ebs_iops', 'number', 'Provisioned IOPS (gp3 baseline is 3000)', Number(c.iops));
    x.v('ebs_throughput', 'number', 'Throughput in MB/s (gp3 baseline is 125)', Number(c.throughput));
    const ec2 = x.has('ec2');
    if (!ec2) x.azData();
    const kms = x.kmsArn();
    x.o('ebs_volume_id', 'aws_ebs_volume.data.id', 'ID of the EBS volume');
    let h = R('resource "aws_ebs_volume" "data"', [
      'availability_zone = ' + (ec2 ? 'aws_instance.main.availability_zone' : 'data.aws_availability_zones.available.names[0]'),
      'size = var.ebs_size', 'type = "gp3"', 'iops = var.ebs_iops', 'throughput = var.ebs_throughput', 'encrypted = true', kms ? 'kms_key_id = ' + kms : null, '', tags(N('data-volume')),
    ]);
    if (ec2) h += '\n\n' + R('resource "aws_volume_attachment" "data"', ['device_name = "/dev/sdf"', 'volume_id = aws_ebs_volume.data.id', 'instance_id = aws_instance.main.id']);
    return h;
  },
});
S({
  id: 'efs', name: 'EFS', cat: 'storage', diff: 'Intermediate', file: 'efs',
  res: ['aws_efs_file_system', 'aws_efs_mount_target'], deps: ['subnet', 'sg', 'kms'], kw: 'efs nfs file system shared storage',
  desc: 'An encrypted NFS file system with a mount target in every private subnet via for_each.',
  use: 'Shared storage for many instances or containers at once.',
  fields: [{ k: 'throughput', l: 'Throughput mode', t: 'select', d: 'elastic', o: ['elastic', 'bursting'] }],
  assume: ['Clients reach mount targets on TCP 2049; add that port to the security group.'],
  gen(c, x) {
    x.v('efs_throughput_mode', 'string', 'elastic or bursting', c.throughput);
    const kms = x.kmsArn();
    x.o('efs_id', 'aws_efs_file_system.main.id', 'ID of the EFS file system');
    x.o('efs_dns_name', 'aws_efs_file_system.main.dns_name', 'DNS name to mount the file system');
    const sub = x.has('subnet');
    return R('resource "aws_efs_file_system" "main"', [
      'creation_token = "${local.name_prefix}-efs"', 'encrypted = true', kms ? 'kms_key_id = ' + kms : null,
      'performance_mode = "generalPurpose"', 'throughput_mode = var.efs_throughput_mode', '',
      B('lifecycle_policy', ['transition_to_ia = "AFTER_30_DAYS"']), '', tags(N('efs')),
    ]) + '\n\n' + R('resource "aws_efs_mount_target" "main"', [
      'for_each = ' + (sub ? 'aws_subnet.private' : 'toset(' + x.privateIds() + ')'), '',
      'file_system_id = aws_efs_file_system.main.id', 'subnet_id = ' + (sub ? 'each.value.id' : 'each.value'),
      x.has('sg') ? 'security_groups = [aws_security_group.main.id]' : null,
    ]);
  },
});
S({
  id: 'fsx', name: 'FSx for Lustre', cat: 'storage', diff: 'Advanced', file: 'fsx',
  res: ['aws_fsx_lustre_file_system'], deps: ['subnet', 'sg'], kw: 'fsx lustre hpc file system',
  desc: 'A high-performance Lustre file system. FSx also offers Windows, ONTAP and OpenZFS as separate resources.',
  use: 'HPC, ML training and media rendering that need very fast parallel reads.',
  fields: [
    { k: 'deployment', l: 'Deployment type', t: 'select', d: 'SCRATCH_2', o: ['SCRATCH_2', 'PERSISTENT_2'], h: 'SCRATCH_2 is cheapest for short-lived learning.' },
    { k: 'capacity', l: 'Storage capacity (GiB)', t: 'number', d: 1200 },
  ],
  assume: ['Lustre clients need TCP 988 and 1018-1023 open in the security group.'],
  gen(c, x) {
    x.v('fsx_deployment_type', 'string', 'SCRATCH_2 or PERSISTENT_2', c.deployment, { condition: 'contains(["SCRATCH_2", "PERSISTENT_2"], var.fsx_deployment_type)', error: 'fsx_deployment_type must be SCRATCH_2 or PERSISTENT_2.' });
    x.v('fsx_storage_capacity', 'number', 'Storage in GiB (1200, 2400, or multiples of 2400)', Number(c.capacity));
    x.o('fsx_dns_name', 'aws_fsx_lustre_file_system.main.dns_name', 'DNS name of the Lustre file system');
    x.o('fsx_mount_name', 'aws_fsx_lustre_file_system.main.mount_name', 'Mount name to use with the Lustre client');
    return R('resource "aws_fsx_lustre_file_system" "main"', [
      'storage_capacity = var.fsx_storage_capacity', 'subnet_ids = [' + x.firstPrivate() + ']', 'deployment_type = var.fsx_deployment_type',
      'file_system_type_version = "2.15"', 'per_unit_storage_throughput = var.fsx_deployment_type == "PERSISTENT_2" ? 125 : null',
      x.has('sg') ? 'security_group_ids = [aws_security_group.main.id]' : null, '', tags(N('lustre')),
    ]);
  },
});
S({
  id: 'kms', name: 'KMS Key', cat: 'storage', diff: 'Intermediate', file: 'kms',
  res: ['aws_kms_key', 'aws_kms_alias'], kw: 'kms encryption key cmk',
  desc: 'A customer managed key with rotation on. Other services pick it up automatically when selected.',
  use: 'Encrypting S3, EBS, RDS, EFS and more with a key you control and can audit.',
  fields: [{ k: 'window', l: 'Deletion window (days)', t: 'number', d: 30 }],
  gen(c, x) {
    x.v('kms_deletion_window_days', 'number', 'Waiting period before a scheduled key deletion completes', Number(c.window), { condition: 'var.kms_deletion_window_days >= 7 && var.kms_deletion_window_days <= 30', error: 'The KMS deletion window must be 7 to 30 days.' });
    x.o('kms_key_arn', 'aws_kms_key.main.arn', 'ARN of the KMS key');
    // CloudWatch Logs can only use a customer managed key whose key policy allows the Logs service.
    const cw = x.has('cloudwatch') ? x.cfgOf('cloudwatch') : null;
    const logs = cw && cw.log_group && cw.log_kms;
    let h = '';
    if (logs) {
      x.caller();
      h = R('data "aws_iam_policy_document" "kms"', [
        '# Keeps the default behaviour: the account administers the key through IAM.',
        B('statement', ['sid = "AccountAdministration"', 'actions = ["kms:*"]', 'resources = ["*"]', '', B('principals', ['type = "AWS"', 'identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]'])]),
        '',
        '# Lets CloudWatch Logs in this Region encrypt log groups in this account.',
        B('statement', ['sid = "AllowCloudWatchLogs"', 'actions = [\n  "kms:Encrypt*",\n  "kms:Decrypt*",\n  "kms:ReEncrypt*",\n  "kms:GenerateDataKey*",\n  "kms:Describe*",\n]', 'resources = ["*"]', '',
          B('principals', ['type = "Service"', 'identifiers = ["logs.${var.aws_region}.amazonaws.com"]']), '',
          B('condition', ['test = "ArnLike"', 'variable = "kms:EncryptionContext:aws:logs:arn"', 'values = ["arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:*"]'])]),
      ]) + '\n\n';
    }
    return h + R('resource "aws_kms_key" "main"', ['description = "${local.name_prefix} customer managed key"', 'enable_key_rotation = true', 'deletion_window_in_days = var.kms_deletion_window_days', logs ? 'policy = data.aws_iam_policy_document.kms.json' : null, '', tags(N('cmk'))])
      + '\n\n' + R('resource "aws_kms_alias" "main"', ['name = "alias/${local.name_prefix}"', 'target_key_id = aws_kms_key.main.key_id']);
  },
});

/* ============================== BACKUP ============================== */
// "By resource type" uses the wildcard ARN patterns from the AWS Backup developer guide.
const BACKUP_TYPE_ARNS = {
  EC2: 'arn:aws:ec2:*:*:instance/*', EBS: 'arn:aws:ec2:*:*:volume/*', RDS: 'arn:aws:rds:*:*:db:*', Aurora: 'arn:aws:rds:*:*:cluster:*',
  DynamoDB: 'arn:aws:dynamodb:*:*:table/*', EFS: 'arn:aws:elasticfilesystem:*:*:file-system/*', S3: 'arn:aws:s3:::*',
};
const RDS_RES = [['rds', 'main'], ['rds_postgres', 'postgres'], ['rds_mysql', 'mysql'], ['rds_sqlserver', 'sqlserver']];
// Selected services AWS Backup can protect, with the reference to their ARN. x only needs has().
function backupTargets(x) {
  const t = [];
  for (const [id, r] of RDS_RES) if (x.has(id)) t.push({ id, type: 'RDS', arn: `aws_db_instance.${r}.arn` });
  if (x.has('aurora')) t.push({ id: 'aurora', type: 'Aurora', arn: 'aws_rds_cluster.main.arn' });
  if (x.has('dynamodb')) t.push({ id: 'dynamodb', type: 'DynamoDB', arn: 'aws_dynamodb_table.main.arn' });
  if (x.has('efs')) t.push({ id: 'efs', type: 'EFS', arn: 'aws_efs_file_system.main.arn' });
  if (x.has('ebs')) t.push({ id: 'ebs', type: 'EBS', arn: 'aws_ebs_volume.data.arn' });
  if (x.has('ec2')) t.push({ id: 'ec2', type: 'EC2', arn: 'aws_instance.main.arn' });
  if (x.has('s3')) t.push({ id: 's3', type: 'S3', arn: 'aws_s3_bucket.main.arn' });
  return t;
}
const hclList = items => items.length ? '[\n' + items.map(a => '  ' + a + ',').join('\n') + '\n]' : '[]';
const onLock = c => c.lock;
const bySelTags = c => c.selection === 'Selected services and tags' || c.selection === 'By resource tags';

S({
  id: 'backup', name: 'AWS Backup', cat: 'backup', diff: 'Intermediate', file: 'backup_vault',
  res: ['aws_backup_vault', 'aws_backup_plan', 'aws_backup_selection', 'aws_backup_vault_lock_configuration', 'aws_backup_vault_policy', 'aws_iam_role', 'aws_iam_role_policy_attachment', 'data.aws_iam_policy_document'],
  kw: 'backup vault plan rule selection retention recovery point restore vault lock disaster recovery',
  desc: 'Centralized backups for supported AWS resources: a vault, a plan with a scheduled rule, a resource selection and the IAM role AWS Backup uses.',
  use: 'Central, policy-driven backups with retention you can audit, for databases, volumes, file systems and buckets.',
  suggest: c => (c.encryption === 'AWS managed key' ? [] : ['kms']),
  fields: [
    { t: 'section', l: 'Backup vault' },
    { k: 'vault_name', l: 'Vault name (after the name prefix)', t: 'text', d: 'vault', h: 'The vault is named local.name_prefix plus this, for example tf-learning-dev-vault.' },
    { k: 'encryption', l: 'Encryption', t: 'select', d: 'Auto', o: ['Auto', 'AWS managed key', 'Customer managed KMS key'], h: 'Auto uses the KMS Key service when it is selected, otherwise the AWS managed key for AWS Backup. A customer managed key without the KMS Key service becomes an input variable.' },
    { k: 'force_destroy', l: 'Let terraform destroy delete recovery points', t: 'bool', d: false, h: 'Handy while learning. Leave it off for real data: without it, a vault that still holds recovery points cannot be deleted.' },
    { k: 'vault_policy', l: 'Deny deleting recovery points (vault access policy)', t: 'bool', d: false, h: 'Adds aws_backup_vault_policy that denies DeleteRecoveryPoint and UpdateRecoveryPointLifecycle to every principal. Lifecycle expiry by AWS Backup still works.' },
    { t: 'section', l: 'Backup plan and rule' },
    { k: 'plan_name', l: 'Plan name (after the name prefix)', t: 'text', d: 'backup-plan' },
    { k: 'rule_name', l: 'Rule name', t: 'text', d: 'daily-backup' },
    { k: 'schedule', l: 'Schedule (cron)', t: 'text', d: 'cron(0 18 * * ? *)', h: 'Evaluated in the time zone below. 18:00 UTC is 02:00 in Kuala Lumpur and Singapore.' },
    { k: 'timezone', l: 'Schedule time zone', t: 'text', d: 'Etc/UTC', h: 'An IANA name such as Asia/Kuala_Lumpur. Sets schedule_expression_timezone.' },
    { k: 'start_window', l: 'Start window (minutes)', t: 'number', d: 60, h: 'At least 60. A job that cannot start in this window is marked EXPIRED.' },
    { k: 'completion_window', l: 'Completion window (minutes)', t: 'number', d: 180, h: 'At least 60 minutes longer than the start window.' },
    { k: 'retention', l: 'Retention (days)', t: 'number', d: 35 },
    { k: 'cold', l: 'Move recovery points to cold storage', t: 'bool', d: false, h: 'Only some resource types support cold storage. Retention must then be at least 90 days longer than the cold storage delay.' },
    { k: 'cold_after', l: 'Cold storage after (days)', t: 'number', d: 30, when: c => c.cold },
    { k: 'continuous', l: 'Enable continuous backup (point-in-time restore)', t: 'bool', d: false, h: 'Supported for RDS, Aurora, S3 and SAP HANA on EC2. Continuous recovery points are kept for 1 to 35 days and cannot move to cold storage.' },
    { k: 'copy_vault_arn', l: 'Copy to another vault (ARN, optional)', t: 'text', d: '', h: 'Cross-Region or cross-account copies need a vault that already exists at the destination. Leave empty for no copy.' },
    { t: 'note', level: 'info', l: 'Restores are not a Terraform resource: you start them on demand from the AWS Backup console, CLI or API. The role created here can be used for restores when "Allow restores" is on.' },
    { t: 'section', l: 'Resource selection' },
    { k: 'selection', l: 'Choose resources', t: 'select', d: 'Selected services and tags', o: ['Selected services and tags', 'By resource tags', 'By resource ARN', 'By resource type'], h: 'Selected services uses the ARNs of the databases, volumes, file systems, instances and buckets selected in this project.' },
    { k: 'tag_key', l: 'Tag key', t: 'text', d: 'Backup', when: bySelTags },
    { k: 'tag_value', l: 'Tag value', t: 'text', d: 'true', when: bySelTags },
    { k: 'types', l: 'Resource types', t: 'multi', d: 'EBS, RDS, DynamoDB', o: Object.keys(BACKUP_TYPE_ARNS), when: c => c.selection === 'By resource type', h: 'Every resource of a ticked type in the Region is backed up, whatever its opt-in setting.' },
    { k: 'role', l: 'IAM backup role', t: 'select', d: 'Create new', o: ['Create new', 'Use existing'] },
    { k: 'restores', l: 'Allow restores with this role', t: 'bool', d: true, when: c => c.role !== 'Use existing', h: 'Attaches AWSBackupServiceRolePolicyForRestores next to the backup policy.' },
    { t: 'section', l: 'Vault Lock' },
    { k: 'lock', l: 'Enable Vault Lock', t: 'bool', d: false },
    { t: 'note', level: 'warn', l: 'Vault Lock can have operational and compliance implications. Review retention requirements before applying. In compliance mode the lock becomes immutable after the grace period: nobody, including the root user, can remove it or shorten retention.', when: onLock },
    { k: 'lock_mode', l: 'Lock mode', t: 'select', d: 'Governance', o: ['Governance', 'Compliance'], when: onLock, h: 'Governance mode omits changeable_for_days, so users with the right permissions can remove the lock.' },
    { k: 'lock_min', l: 'Minimum retention (days)', t: 'number', d: 7, when: onLock },
    { k: 'lock_max', l: 'Maximum retention (days)', t: 'number', d: 365, when: onLock },
    { k: 'lock_changeable', l: 'Changeable for (days)', t: 'number', d: 3, when: c => c.lock && c.lock_mode === 'Compliance', h: 'Grace period before the compliance lock becomes immutable. At least 3 days.' },
  ],
  assume: [
    'Vault and plan names are local.name_prefix plus the names you choose.',
    '"By resource type" uses wildcard ARNs such as arn:aws:rds:*:*:db:*. They include every matching resource in the Region, whatever its opt-in setting.',
    'Tag and service selections only pick up resource types that are opted in under AWS Backup settings for the Region. Those settings are account-wide (aws_backup_region_settings), so this generator does not change them.',
    'S3 backups need versioning on the bucket; the role gets the S3 backup and restore policies when an S3 bucket can be selected.',
  ],
  guide: [
    'Consider encryption with a customer managed AWS KMS key when you need to control and audit key use.',
    'Review backup retention against your legal and business requirements before you pick numbers.',
    'Consider cross-account backup (copy_action to a vault in another account) for resilience against account compromise.',
    'Consider cross-Region backup (copy_action to a vault in another Region) for disaster recovery.',
    'Review Vault Lock before enabling it: compliance mode cannot be undone after the grace period.',
    'Follow least-privilege IAM practices: the AWS managed backup policies are broad, so scope a custom policy for production.',
  ],
  gen(c, x) {
    const createRole = c.role !== 'Use existing';
    const mode = c.selection;
    const byTags = bySelTags(c);
    const targets = backupTargets(x);
    const types = csv(c.types).filter(t => BACKUP_TYPE_ARNS[t]);
    const s3 = mode === 'By resource type' ? types.includes('S3') : x.has('s3');
    const compliance = c.lock && c.lock_mode === 'Compliance';

    x.v('backup_vault_name', 'string', 'Backup vault name, appended to local.name_prefix', c.vault_name, { condition: 'can(regex("^[A-Za-z0-9_-]{1,20}$", var.backup_vault_name))', error: 'backup_vault_name must be 1-20 letters, numbers, hyphens or underscores.' });
    x.v('backup_vault_force_destroy', 'bool', 'Delete all recovery points when the vault is destroyed', c.force_destroy);
    let kms = null;
    if (c.encryption === 'Customer managed KMS key') kms = x.kmsArn() || x.v('backup_kms_key_arn', 'string', 'ARN of an existing customer managed KMS key for the vault (the KMS Key service is not selected)');
    else if (c.encryption === 'Auto') kms = x.kmsArn();
    x.v('backup_plan_name', 'string', 'Backup plan name, appended to local.name_prefix', c.plan_name);
    x.v('backup_rule_name', 'string', 'Name of the scheduled backup rule', c.rule_name);
    x.v('backup_schedule', 'string', 'Backup schedule as an AWS cron expression', c.schedule, { condition: 'can(regex("^cron\\\\(.+\\\\)$", var.backup_schedule))', error: 'backup_schedule must be a cron() expression, for example cron(0 18 * * ? *).' });
    x.v('backup_schedule_timezone', 'string', 'IANA time zone the schedule is written in', c.timezone);
    x.v('backup_start_window_minutes', 'number', 'Minutes a job may wait to start before it is marked EXPIRED', Number(c.start_window), { condition: 'var.backup_start_window_minutes >= 60', error: 'The start window must be at least 60 minutes.' });
    x.v('backup_completion_window_minutes', 'number', 'Minutes a job may run before AWS Backup cancels it', Number(c.completion_window), { condition: 'var.backup_completion_window_minutes >= 120', error: 'The completion window must be at least 120 minutes (60 more than the minimum start window).' });
    x.v('backup_retention_days', 'number', 'Days to keep recovery points', Number(c.retention), { condition: 'var.backup_retention_days >= 1', error: 'Retention must be at least 1 day.' });
    if (c.cold) x.v('backup_cold_storage_after_days', 'number', 'Days before recovery points move to cold storage', Number(c.cold_after), { condition: 'var.backup_cold_storage_after_days >= 1', error: 'Cold storage must start after at least 1 day.' });
    x.v('backup_enable_continuous', 'bool', 'Continuous backup for point-in-time restore (RDS, Aurora, S3, SAP HANA on EC2)', c.continuous);
    if (c.copy_vault_arn) x.v('backup_copy_destination_vault_arn', 'string', 'ARN of the destination vault for copies in another Region or account', c.copy_vault_arn, { condition: 'can(regex("^arn:aws[a-z-]*:backup:", var.backup_copy_destination_vault_arn))', error: 'Use the ARN of an existing backup vault.' });
    if (byTags) {
      x.v('backup_selection_tag_key', 'string', 'Tag key that marks resources for backup', c.tag_key);
      x.v('backup_selection_tag_value', 'string', 'Tag value that marks resources for backup', c.tag_value);
    }
    let resources = null;
    if (mode === 'By resource type') resources = x.v('backup_resource_type_patterns', 'list(string)', 'Wildcard ARN patterns; every matching resource in the Region is backed up', types.map(t => BACKUP_TYPE_ARNS[t]));
    else if (mode === 'By resource ARN') resources = targets.length ? hclList(targets.map(t => t.arn)) : x.v('backup_resource_arns', 'list(string)', 'ARNs of existing resources to back up', []);
    else if (mode === 'Selected services and tags' && targets.length) resources = hclList(targets.map(t => t.arn));
    const roleArn = createRole ? 'aws_iam_role.backup.arn' : x.v('backup_iam_role_arn', 'string', 'ARN of an existing IAM role that AWS Backup can assume');
    if (c.lock) {
      x.v('backup_lock_min_retention_days', 'number', 'Shortest retention a backup rule may set while the vault is locked', Number(c.lock_min), { condition: 'var.backup_lock_min_retention_days >= 1', error: 'Minimum retention must be at least 1 day.' });
      x.v('backup_lock_max_retention_days', 'number', 'Longest retention a backup rule may set while the vault is locked', Number(c.lock_max), { condition: 'var.backup_lock_max_retention_days >= 1 && var.backup_lock_max_retention_days <= 36500', error: 'Maximum retention must be 1 to 36500 days.' });
      if (compliance) x.v('backup_lock_changeable_for_days', 'number', 'Grace period before the compliance-mode lock becomes immutable', Number(c.lock_changeable), { condition: 'var.backup_lock_changeable_for_days >= 3', error: 'changeable_for_days must be at least 3.' });
    }

    x.o('backup_vault_name', 'aws_backup_vault.main.name', 'Name of the backup vault');
    x.o('backup_vault_arn', 'aws_backup_vault.main.arn', 'ARN of the backup vault');
    x.o('backup_plan_id', 'aws_backup_plan.main.id', 'ID of the backup plan');
    x.o('backup_plan_arn', 'aws_backup_plan.main.arn', 'ARN of the backup plan');
    x.o('backup_selection_id', 'aws_backup_selection.main.id', 'ID of the backup selection');
    if (createRole) x.o('backup_iam_role_arn', 'aws_iam_role.backup.arn', 'ARN of the role AWS Backup assumes');

    x.note('Terraform manages the backup configuration, not individual recovery points or restore jobs. Start restores from the AWS Backup console, CLI or API.');
    if (byTags) x.note(`Resources are protected only when they carry the tag ${c.tag_key}=${c.tag_value}${mode === 'Selected services and tags' && targets.length ? ', in addition to the selected services listed in resources' : ''}.`);

    const files = [];
    let vault = R('resource "aws_backup_vault" "main"', [
      'name = "${local.name_prefix}-${var.backup_vault_name}"',
      kms ? 'kms_key_arn = ' + kms : '# No kms_key_arn: AWS Backup encrypts recovery points with its AWS managed key.',
      'force_destroy = var.backup_vault_force_destroy',
    ]);
    if (c.vault_policy) {
      vault += '\n\n' + R('data "aws_iam_policy_document" "backup_vault"', [B('statement', [
        'sid = "DenyRecoveryPointDeletion"', 'effect = "Deny"', 'actions = [\n  "backup:DeleteRecoveryPoint",\n  "backup:UpdateRecoveryPointLifecycle",\n]', 'resources = ["*"]', '',
        B('principals', ['type = "AWS"', 'identifiers = ["*"]']),
      ])]) + '\n\n' + R('resource "aws_backup_vault_policy" "main"', ['backup_vault_name = aws_backup_vault.main.name', 'policy = data.aws_iam_policy_document.backup_vault.json']);
    }
    files.push({ stem: 'backup_vault', title: 'Backup vault', desc: 'The encrypted container that stores recovery points' + (c.vault_policy ? ', and its access policy.' : '.'), body: vault });

    files.push({ stem: 'backup_plan', title: 'Backup plan and rule', desc: 'When backups run, how long recovery points are kept and where copies go.', body: R('resource "aws_backup_plan" "main"', [
      'name = "${local.name_prefix}-${var.backup_plan_name}"', '',
      B('rule', [
        'rule_name = var.backup_rule_name',
        'target_vault_name = aws_backup_vault.main.name',
        'schedule = var.backup_schedule',
        'schedule_expression_timezone = var.backup_schedule_timezone',
        'start_window = var.backup_start_window_minutes',
        'completion_window = var.backup_completion_window_minutes',
        'enable_continuous_backup = var.backup_enable_continuous',
        '',
        B('lifecycle', [c.cold ? 'cold_storage_after = var.backup_cold_storage_after_days' : null, 'delete_after = var.backup_retention_days']),
        c.copy_vault_arn ? '' : null,
        c.copy_vault_arn ? B('copy_action', ['destination_vault_arn = var.backup_copy_destination_vault_arn', '', B('lifecycle', ['delete_after = var.backup_retention_days'])]) : null,
      ]),
    ]) });

    let sel = '';
    if (createRole) {
      const pols = [['backup', 'arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup']];
      if (c.restores) pols.push(['backup_restores', 'arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores']);
      if (s3) pols.push(['backup_s3', 'arn:aws:iam::aws:policy/AWSBackupServiceRolePolicyForS3Backup']);
      if (s3 && c.restores) pols.push(['backup_s3_restore', 'arn:aws:iam::aws:policy/AWSBackupServiceRolePolicyForS3Restore']);
      sel = assumeDoc('backup', 'backup.amazonaws.com')
        + '\n\n' + R('resource "aws_iam_role" "backup"', ['name_prefix = "${local.name_prefix}-backup-"', 'description = "Role AWS Backup assumes to back up' + (c.restores ? ' and restore' : '') + ' resources"', 'assume_role_policy = data.aws_iam_policy_document.backup_assume.json'])
        + pols.map(([n, arn]) => '\n\n' + R(`resource "aws_iam_role_policy_attachment" "${n}"`, ['role = aws_iam_role.backup.name', `policy_arn = "${arn}"`])).join('')
        + '\n\n';
    }
    sel += R('resource "aws_backup_selection" "main"', [
      'name = "${local.name_prefix}-selection"',
      'plan_id = aws_backup_plan.main.id',
      'iam_role_arn = ' + roleArn,
      resources ? 'resources = ' + resources : null,
      byTags ? '' : null,
      byTags ? B('selection_tag', ['type = "STRINGEQUALS"', 'key = var.backup_selection_tag_key', 'value = var.backup_selection_tag_value']) : null,
    ]);
    files.push({ stem: 'backup_selection', title: 'Backup selection and IAM role', desc: 'Which resources the plan protects, and the role AWS Backup assumes to read them.', body: sel });

    if (c.lock) files.push({ stem: 'backup_vault_lock', title: 'Vault Lock', desc: 'Retention limits enforced on the vault (' + (compliance ? 'compliance' : 'governance') + ' mode).', body: R('resource "aws_backup_vault_lock_configuration" "main"', [
      'backup_vault_name = aws_backup_vault.main.name',
      'min_retention_days = var.backup_lock_min_retention_days',
      'max_retention_days = var.backup_lock_max_retention_days',
      compliance ? 'changeable_for_days = var.backup_lock_changeable_for_days' : '# No changeable_for_days, so the lock is in governance mode and can be removed.',
    ]) });
    return files;
  },
});

/* ============================ MONITORING ============================ */
const LOG_RETENTION = [1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653, 0];
const CW_WIDGETS = ['EC2 CPU', 'EC2 Network', 'ALB Requests', 'ALB 5XX', 'RDS CPU', 'RDS Connections', 'Lambda Invocations', 'Lambda Errors', 'Lambda Duration', 'EKS CPU', 'EKS Memory', 'Backup Jobs', 'Application Errors', 'Log Events'];
// Dimensions of a selected resource as [name, Terraform reference], or null when nothing suitable is selected.
function cwDims(kind, x) {
  if (kind === 'ec2') return x.has('ec2') ? ['InstanceId', 'aws_instance.main.id'] : x.has('asg') ? ['AutoScalingGroupName', 'aws_autoscaling_group.main.name'] : null;
  if (kind === 'alb') return x.has('alb') ? ['LoadBalancer', 'aws_lb.app.arn_suffix'] : null;
  if (kind === 'rds') { const r = RDS_RES.find(([id]) => x.has(id)); return r ? ['DBInstanceIdentifier', `aws_db_instance.${r[1]}.identifier`] : x.has('aurora') ? ['DBClusterIdentifier', 'aws_rds_cluster.main.cluster_identifier'] : null; }
  if (kind === 'lambda') return x.has('lambda') ? ['FunctionName', 'aws_lambda_function.main.function_name'] : null;
  if (kind === 'eks') return x.has('eks_cluster') ? ['ClusterName', 'aws_eks_cluster.main.name'] : null;
  return null;
}
const CW_TARGET = {
  'EC2 CPU': { kind: 'ec2', ns: 'AWS/EC2', metric: 'CPUUtilization', res: 'ec2_cpu_high', dim: 'InstanceId', v: 'cloudwatch_alarm_instance_id', vd: 'ID of the EC2 instance to watch (EC2 Instance is not selected)', svc: ['ec2', 'asg'] },
  'ALB 5XX errors': { kind: 'alb', ns: 'AWS/ApplicationELB', metric: 'HTTPCode_ELB_5XX_Count', res: 'alb_5xx', dim: 'LoadBalancer', v: 'cloudwatch_alarm_load_balancer', vd: 'ARN suffix of the load balancer to watch, for example app/my-alb/0123456789abcdef', svc: ['alb'] },
  'RDS CPU': { kind: 'rds', ns: 'AWS/RDS', metric: 'CPUUtilization', res: 'rds_cpu_high', dim: 'DBInstanceIdentifier', v: 'cloudwatch_alarm_db_instance_id', vd: 'Identifier of the RDS DB instance to watch', svc: ['rds', 'rds_postgres', 'rds_mysql', 'rds_sqlserver', 'aurora'] },
  'Lambda errors': { kind: 'lambda', ns: 'AWS/Lambda', metric: 'Errors', res: 'lambda_errors', dim: 'FunctionName', v: 'cloudwatch_alarm_function_name', vd: 'Name of the Lambda function to watch', svc: ['lambda'] },
  'Custom metric': { kind: null, res: 'custom_metric' },
};
const cwOn = k => c => c[k];
const onLogGroup = cwOn('log_group');
const onFilter = cwOn('metric_filter');
const onAlarm = cwOn('alarm');
const onCustom = c => c.alarm && c.alarm_target === 'Custom metric';
const onBackup = (c, has) => has('backup');

S({
  id: 'cloudwatch', name: 'Amazon CloudWatch', cat: 'monitoring', diff: 'Intermediate', file: 'cloudwatch_log_group',
  res: ['aws_cloudwatch_log_group', 'aws_cloudwatch_log_stream', 'aws_cloudwatch_log_metric_filter', 'aws_cloudwatch_metric_alarm', 'aws_cloudwatch_composite_alarm', 'aws_cloudwatch_dashboard', 'aws_cloudwatch_event_rule', 'aws_cloudwatch_event_target', 'aws_cloudwatch_log_resource_policy', 'aws_sns_topic', 'aws_sns_topic_policy', 'aws_sns_topic_subscription', 'aws_backup_vault_notifications', 'data.aws_iam_policy_document'],
  kw: 'cloudwatch monitoring logs log group metrics alarm dashboard metric filter eventbridge events sns notification observability',
  desc: 'Monitoring, logging, alarms and operational visibility: log groups, metric filters, alarms, a dashboard, EventBridge rules and SNS notifications.',
  use: 'Seeing how your workload behaves, and being told when something breaks, including failed backup jobs.',
  suggest(c, has) {
    const out = [];
    const t = CW_TARGET[c.alarm_target];
    if (c.alarm && t && t.svc && !t.svc.some(has)) out.push(t.svc[0]);
    if (c.log_group && c.log_kms) out.push('kms');
    return out;
  },
  fields: [
    { t: 'section', l: 'Log group' },
    { k: 'log_group', l: 'Create a log group', t: 'bool', d: true },
    { k: 'log_group_name', l: 'Log group name', t: 'text', d: '/aws/terraform/application', when: onLogGroup },
    { k: 'retention', l: 'Retention (days)', t: 'select', d: '30', o: LOG_RETENTION.map(String), when: onLogGroup, h: '0 keeps logs forever. Long retention costs more; keep only what you need.' },
    { k: 'log_class', l: 'Log class', t: 'select', d: 'STANDARD', o: ['STANDARD', 'INFREQUENT_ACCESS'], when: onLogGroup, h: 'Infrequent Access costs less to ingest but does not support metric filters.' },
    { k: 'log_kms', l: 'Encrypt with the KMS Key service', t: 'bool', d: false, when: onLogGroup, h: 'Also adds a key policy statement so CloudWatch Logs in this Region can use the key.' },
    { k: 'log_stream', l: 'Create a log stream', t: 'bool', d: false, when: onLogGroup, h: 'AWS services and the CloudWatch agent create their own streams. Create one only for a writer that expects it to exist.' },
    { k: 'stream_name', l: 'Log stream name', t: 'text', d: 'app', when: c => c.log_group && c.log_stream },
    { t: 'section', l: 'Log metric filter' },
    { k: 'metric_filter', l: 'Turn matching log lines into a metric', t: 'bool', d: true },
    { k: 'filter_pattern', l: 'Filter pattern', t: 'text', d: 'ERROR', when: onFilter },
    { k: 'filter_namespace', l: 'Metric namespace', t: 'text', d: 'Application', when: onFilter },
    { k: 'filter_metric', l: 'Metric name', t: 'text', d: 'ApplicationErrors', when: onFilter },
    { k: 'filter_value', l: 'Metric value per match', t: 'text', d: '1', when: onFilter },
    { k: 'filter_alarm', l: 'Alarm when the pattern matches', t: 'bool', d: true, when: onFilter },
    { t: 'section', l: 'Metric alarm' },
    { k: 'alarm', l: 'Create a metric alarm', t: 'bool', d: true },
    { k: 'alarm_target', l: 'What to watch', t: 'select', d: 'EC2 CPU', o: Object.keys(CW_TARGET), when: onAlarm, h: 'Dimensions reference the selected service directly. When it is not selected they become input variables.',
      presets: {
        'EC2 CPU': { alarm_name: 'high-cpu', statistic: 'Average', threshold: 80, comparison: 'GreaterThanThreshold', alarm_desc: 'EC2 CPU utilization is high' },
        'ALB 5XX errors': { alarm_name: 'alb-5xx', statistic: 'Sum', threshold: 10, comparison: 'GreaterThanThreshold', alarm_desc: 'The load balancer is returning 5XX errors' },
        'RDS CPU': { alarm_name: 'rds-high-cpu', statistic: 'Average', threshold: 80, comparison: 'GreaterThanThreshold', alarm_desc: 'RDS CPU utilization is high' },
        'Lambda errors': { alarm_name: 'lambda-errors', statistic: 'Sum', threshold: 0, comparison: 'GreaterThanThreshold', alarm_desc: 'The Lambda function reported errors' },
        'Custom metric': { alarm_name: 'custom-metric', statistic: 'Average', alarm_desc: 'A custom metric crossed its threshold' },
      } },
    { k: 'alarm_namespace', l: 'Namespace', t: 'text', d: 'Custom/Application', when: onCustom },
    { k: 'alarm_metric', l: 'Metric name', t: 'text', d: 'RequestLatency', when: onCustom },
    { k: 'alarm_dim', l: 'Dimension name (optional)', t: 'text', d: '', when: onCustom, h: 'Its value becomes an input variable, never a hard-coded ID.' },
    { k: 'alarm_name', l: 'Alarm name (after the name prefix)', t: 'text', d: 'high-cpu', when: onAlarm },
    { k: 'statistic', l: 'Statistic', t: 'select', d: 'Average', o: ['Average', 'Sum', 'Minimum', 'Maximum', 'SampleCount'], when: onAlarm, h: 'Use Sum for counts such as 5XX responses and Lambda errors.' },
    { k: 'period', l: 'Period (seconds)', t: 'number', d: 300, when: onAlarm },
    { k: 'eval', l: 'Evaluation periods', t: 'number', d: 2, when: onAlarm },
    { k: 'threshold', l: 'Threshold', t: 'number', d: 80, when: onAlarm },
    { k: 'comparison', l: 'Comparison', t: 'select', d: 'GreaterThanThreshold', o: ['GreaterThanThreshold', 'GreaterThanOrEqualToThreshold', 'LessThanThreshold', 'LessThanOrEqualToThreshold'], when: onAlarm },
    { k: 'missing', l: 'Treat missing data', t: 'select', d: 'notBreaching', o: ['missing', 'ignore', 'breaching', 'notBreaching'], when: onAlarm },
    { k: 'alarm_desc', l: 'Alarm description', t: 'text', d: 'EC2 CPU utilization is high', when: onAlarm },
    { k: 'composite', l: 'Composite alarm that fires when any alarm fires', t: 'bool', d: false, h: 'Generated only when there are at least two metric alarms (the metric alarm plus the metric filter alarm).' },
    { t: 'section', l: 'Dashboard' },
    { k: 'dashboard', l: 'Create a dashboard', t: 'bool', d: true },
    { k: 'dashboard_name', l: 'Dashboard name (after the name prefix)', t: 'text', d: 'monitoring', when: cwOn('dashboard') },
    { k: 'widgets', l: 'Widgets', t: 'multi', d: CW_WIDGETS.join(', '), o: CW_WIDGETS, when: cwOn('dashboard'), h: 'Widgets for services that are not selected are skipped, so the dashboard follows your selection.' },
    { t: 'section', l: 'Notifications and events' },
    { k: 'sns', l: 'SNS topic for alarm and event notifications', t: 'bool', d: true },
    { k: 'email', l: 'Email subscription (optional)', t: 'text', d: '', when: cwOn('sns'), h: 'Becomes var.cloudwatch_alerts_email. AWS emails a confirmation link and nothing is delivered until it is confirmed.' },
    { k: 'ec2_events', l: 'EventBridge rule for EC2 stop and terminate events', t: 'bool', d: false, h: 'Generated when EC2 Instance or Auto Scaling Group is selected.' },
    { t: 'section', l: 'AWS Backup monitoring', when: onBackup },
    { t: 'note', level: 'info', l: 'Select AWS Backup as well to add backup job and vault monitoring here.', when: (c, has) => !has('backup') },
    { k: 'bk_failed', l: 'Backup job failure monitoring', t: 'bool', d: true, when: onBackup, h: 'FAILED, ABORTED and EXPIRED backup jobs in this vault.' },
    { k: 'bk_completed', l: 'Backup job completion monitoring', t: 'bool', d: false, when: onBackup },
    { k: 'bk_vault', l: 'Backup vault monitoring (vault notifications to SNS)', t: 'bool', d: false, when: onBackup, h: 'Restore, copy and recovery point events sent straight from the vault. Needs the SNS topic.' },
    { k: 'bk_eventbridge', l: 'Route backup job events through EventBridge', t: 'bool', d: true, when: onBackup, h: 'Off: job events use vault notifications instead, which need the SNS topic.' },
  ],
  assume: [
    'Alarm dimensions reference the selected EC2 instance, Auto Scaling group, load balancer, database or function. When none is selected, the dimension value becomes an input variable.',
    'EventBridge targets the SNS topic when it is enabled, otherwise a /aws/events/ log group with the resource policy EventBridge needs.',
    'The SNS topic is not KMS-encrypted: publishing from EventBridge, CloudWatch alarms and AWS Backup to an encrypted topic needs extra key policy statements.',
    'EKS widgets read Container Insights metrics, which appear only after the CloudWatch Observability add-on is installed in the cluster.',
  ],
  guide: [
    'Avoid unnecessarily long log retention: it costs money and keeps data you may not need.',
    'Encrypt sensitive logs with a customer managed KMS key where required.',
    'Never log credentials, tokens or other secrets; metric filters and dashboards can expose log content.',
    'Set alarm thresholds from real baselines so alarms stay meaningful, and test that notifications arrive.',
    'Apply least-privilege permissions: the SNS topic policy here only lets the services that publish to it do so.',
  ],
  gen(c, x) {
    const files = [];
    const backup = x.has('backup');
    const sns = !!c.sns;
    const snsArn = 'aws_sns_topic.alerts.arn';
    const alarmActions = sns ? ['', `alarm_actions = [${snsArn}]`, `ok_actions = [${snsArn}]`] : [];
    const alarms = [];

    // ---- log group, stream and metric filter
    let logs = '';
    if (c.log_group) {
      const kms = c.log_kms ? x.kmsArn() : null;
      x.v('cloudwatch_log_group_name', 'string', 'Name of the application log group', c.log_group_name, { condition: 'length(var.cloudwatch_log_group_name) >= 1 && length(var.cloudwatch_log_group_name) <= 512', error: 'Log group names are 1 to 512 characters.' });
      x.v('cloudwatch_log_retention_days', 'number', 'Days to keep log events (0 keeps them forever)', Number(c.retention), { condition: `contains([${LOG_RETENTION.join(', ')}], var.cloudwatch_log_retention_days)`, error: 'Use a retention value CloudWatch Logs supports, such as 7, 14, 30, 90 or 365.' });
      x.v('cloudwatch_log_group_class', 'string', 'STANDARD or INFREQUENT_ACCESS', c.log_class, { condition: 'contains(["STANDARD", "INFREQUENT_ACCESS"], var.cloudwatch_log_group_class)', error: 'cloudwatch_log_group_class must be STANDARD or INFREQUENT_ACCESS.' });
      x.o('cloudwatch_log_group_name', 'aws_cloudwatch_log_group.app.name', 'Name of the application log group');
      x.o('cloudwatch_log_group_arn', 'aws_cloudwatch_log_group.app.arn', 'ARN of the application log group');
      if (c.log_kms && !kms) x.note('Log group encryption was requested but the KMS Key service is not selected, so the log group uses CloudWatch Logs default encryption.');
      logs = R('resource "aws_cloudwatch_log_group" "app"', [
        'name = var.cloudwatch_log_group_name',
        'retention_in_days = var.cloudwatch_log_retention_days',
        'log_group_class = var.cloudwatch_log_group_class',
        kms ? 'kms_key_id = ' + kms : null,
      ]);
      if (c.log_stream) {
        x.v('cloudwatch_log_stream_name', 'string', 'Name of the log stream', c.stream_name, { condition: '!strcontains(var.cloudwatch_log_stream_name, ":")', error: 'Log stream names cannot contain a colon.' });
        logs += '\n\n' + R('resource "aws_cloudwatch_log_stream" "app"', ['name = var.cloudwatch_log_stream_name', 'log_group_name = aws_cloudwatch_log_group.app.name']);
      }
    }
    if (c.metric_filter) {
      const lg = c.log_group ? 'aws_cloudwatch_log_group.app.name' : x.v('cloudwatch_filter_log_group_name', 'string', 'Existing log group the metric filter reads (no log group is created here)');
      x.v('cloudwatch_filter_pattern', 'string', 'CloudWatch Logs filter pattern', c.filter_pattern);
      x.v('cloudwatch_filter_metric_namespace', 'string', 'Namespace the filter publishes its metric to', c.filter_namespace);
      x.v('cloudwatch_filter_metric_name', 'string', 'Name of the metric the filter publishes', c.filter_metric);
      x.v('cloudwatch_filter_metric_value', 'string', 'Value published for each matching log event', String(c.filter_value));
      logs += (logs ? '\n\n' : '') + R('resource "aws_cloudwatch_log_metric_filter" "app_errors"', [
        'name = "${local.name_prefix}-application-errors"',
        'log_group_name = ' + lg,
        'pattern = var.cloudwatch_filter_pattern',
        '',
        '# default_value = "0" publishes 0 when nothing matches, which keeps the metric continuous for alarms.',
        B('metric_transformation', ['name = var.cloudwatch_filter_metric_name', 'namespace = var.cloudwatch_filter_metric_namespace', 'value = var.cloudwatch_filter_metric_value', 'default_value = "0"']),
      ]);
    }
    if (logs) files.push({ stem: 'cloudwatch_log_group', title: 'Logs', desc: 'Where application logs go, and the metric filter that counts matching lines.', body: logs });

    // ---- metric alarms
    let alarmTxt = '';
    if (c.alarm) {
      const t = CW_TARGET[c.alarm_target] || CW_TARGET['EC2 CPU'];
      let ns, metric, dim = null;
      if (t.kind) {
        ns = hq(t.ns); metric = hq(t.metric);
        dim = cwDims(t.kind, x) || [t.dim, x.v(t.v, 'string', t.vd)];
      } else {
        ns = x.v('cloudwatch_alarm_namespace', 'string', 'Namespace of the custom metric', c.alarm_namespace);
        metric = x.v('cloudwatch_alarm_metric_name', 'string', 'Name of the custom metric', c.alarm_metric);
        if (c.alarm_dim) dim = [c.alarm_dim, x.v('cloudwatch_alarm_dimension_value', 'string', `Value of the ${c.alarm_dim} dimension`)];
      }
      x.v('cloudwatch_alarm_name', 'string', 'Alarm name, appended to local.name_prefix', c.alarm_name);
      x.v('cloudwatch_alarm_description', 'string', 'Description shown with the alarm', c.alarm_desc);
      x.v('cloudwatch_alarm_statistic', 'string', 'Average, Sum, Minimum, Maximum or SampleCount', c.statistic, { condition: 'contains(["Average", "Sum", "Minimum", "Maximum", "SampleCount"], var.cloudwatch_alarm_statistic)', error: 'Use Average, Sum, Minimum, Maximum or SampleCount.' });
      x.v('cloudwatch_alarm_period', 'number', 'Seconds in each evaluation period', Number(c.period), { condition: 'contains([10, 20, 30], var.cloudwatch_alarm_period) || var.cloudwatch_alarm_period % 60 == 0', error: 'The period must be 10, 20, 30 or a multiple of 60 seconds.' });
      x.v('cloudwatch_alarm_evaluation_periods', 'number', 'Periods compared with the threshold before the alarm changes state', Number(c.eval), { condition: 'var.cloudwatch_alarm_evaluation_periods >= 1', error: 'Evaluate at least 1 period.' });
      x.v('cloudwatch_alarm_threshold', 'number', 'Value the statistic is compared with', Number(c.threshold));
      x.v('cloudwatch_alarm_comparison_operator', 'string', 'How the statistic is compared with the threshold', c.comparison, { condition: 'contains(["GreaterThanThreshold", "GreaterThanOrEqualToThreshold", "LessThanThreshold", "LessThanOrEqualToThreshold"], var.cloudwatch_alarm_comparison_operator)', error: 'Use one of the four static threshold comparison operators.' });
      x.v('cloudwatch_alarm_treat_missing_data', 'string', 'missing, ignore, breaching or notBreaching', c.missing, { condition: 'contains(["missing", "ignore", "breaching", "notBreaching"], var.cloudwatch_alarm_treat_missing_data)', error: 'Use missing, ignore, breaching or notBreaching.' });
      const key = dim && (/^[A-Za-z_][\w-]*$/.test(dim[0]) ? dim[0] : hq(dim[0]));
      alarms.push(`aws_cloudwatch_metric_alarm.${t.res}`);
      x.o('cloudwatch_alarm_arn', `aws_cloudwatch_metric_alarm.${t.res}.arn`, 'ARN of the metric alarm');
      alarmTxt = R(`resource "aws_cloudwatch_metric_alarm" "${t.res}"`, [
        'alarm_name = "${local.name_prefix}-${var.cloudwatch_alarm_name}"',
        'alarm_description = var.cloudwatch_alarm_description',
        'namespace = ' + ns,
        'metric_name = ' + metric,
        'statistic = var.cloudwatch_alarm_statistic',
        'period = var.cloudwatch_alarm_period',
        'evaluation_periods = var.cloudwatch_alarm_evaluation_periods',
        'threshold = var.cloudwatch_alarm_threshold',
        'comparison_operator = var.cloudwatch_alarm_comparison_operator',
        'treat_missing_data = var.cloudwatch_alarm_treat_missing_data',
        dim ? '' : null,
        dim ? `dimensions = {\n  ${key} = ${dim[1]}\n}` : null,
        ...alarmActions,
      ]);
    }
    if (c.metric_filter && c.filter_alarm) {
      alarms.push('aws_cloudwatch_metric_alarm.app_errors');
      x.o('cloudwatch_app_errors_alarm_arn', 'aws_cloudwatch_metric_alarm.app_errors.arn', 'ARN of the alarm on the metric filter');
      alarmTxt += (alarmTxt ? '\n\n' : '') + R('resource "aws_cloudwatch_metric_alarm" "app_errors"', [
        'alarm_name = "${local.name_prefix}-application-errors"',
        'alarm_description = "Log events matched the metric filter pattern"',
        'namespace = var.cloudwatch_filter_metric_namespace',
        'metric_name = var.cloudwatch_filter_metric_name',
        'statistic = "Sum"',
        'period = 300',
        'evaluation_periods = 1',
        'threshold = 1',
        'comparison_operator = "GreaterThanOrEqualToThreshold"',
        'treat_missing_data = "notBreaching"',
        '# Metric filters publish without dimensions, so this alarm has none.',
        ...alarmActions,
      ]);
    }
    if (c.composite && alarms.length >= 2) {
      x.o('cloudwatch_composite_alarm_arn', 'aws_cloudwatch_composite_alarm.any.arn', 'ARN of the composite alarm');
      alarmTxt += '\n\n' + R('resource "aws_cloudwatch_composite_alarm" "any"', [
        'alarm_name = "${local.name_prefix}-any-alarm"',
        'alarm_description = "In ALARM when any of the metric alarms is in ALARM"',
        'alarm_rule = ' + hq(alarms.map(a => 'ALARM(${' + a + '.alarm_name})').join(' OR ')).replace(/\$\$\{/g, '${'),
        ...alarmActions,
      ]);
    } else if (c.composite) x.note('The composite alarm needs at least two metric alarms, so it was not generated. Turn on both the metric alarm and the metric filter alarm.');
    if (alarmTxt) files.push({ stem: 'cloudwatch_alarm', title: 'Alarms', desc: 'Alarms that watch metrics and notify the SNS topic when they change state.', body: alarmTxt });

    // ---- dashboard
    if (c.dashboard) {
      const want = new Set(csv(c.widgets));
      const m = (ns, metric, d) => '[' + [hq(ns), hq(metric), ...(d ? [hq(d[0]), d[1]] : [])].join(', ') + ']';
      const search = (id, metric, label) => `[{ expression = ${hq(`SEARCH(' Namespace="AWS/Backup" MetricName="${metric}" ', 'Sum')`)}, id = "${id}", label = "${label}" }]`;
      const d = k => cwDims(k, x);
      const W = {
        'EC2 CPU': () => d('ec2') && ['EC2 CPU utilization (%)', 'Average', [m('AWS/EC2', 'CPUUtilization', d('ec2'))]],
        'EC2 Network': () => d('ec2') && ['EC2 network (bytes)', 'Sum', [m('AWS/EC2', 'NetworkIn', d('ec2')), m('AWS/EC2', 'NetworkOut', d('ec2'))]],
        'ALB Requests': () => d('alb') && ['ALB requests', 'Sum', [m('AWS/ApplicationELB', 'RequestCount', d('alb'))]],
        'ALB 5XX': () => d('alb') && ['ALB 5XX errors', 'Sum', [m('AWS/ApplicationELB', 'HTTPCode_ELB_5XX_Count', d('alb'))]],
        'RDS CPU': () => d('rds') && ['RDS CPU utilization (%)', 'Average', [m('AWS/RDS', 'CPUUtilization', d('rds'))]],
        'RDS Connections': () => d('rds') && ['RDS connections', 'Average', [m('AWS/RDS', 'DatabaseConnections', d('rds'))]],
        'Lambda Invocations': () => d('lambda') && ['Lambda invocations', 'Sum', [m('AWS/Lambda', 'Invocations', d('lambda'))]],
        'Lambda Errors': () => d('lambda') && ['Lambda errors', 'Sum', [m('AWS/Lambda', 'Errors', d('lambda'))]],
        'Lambda Duration': () => d('lambda') && ['Lambda duration (ms)', 'Average', [m('AWS/Lambda', 'Duration', d('lambda'))]],
        'EKS CPU': () => d('eks') && ['EKS node CPU (%)', 'Average', [m('ContainerInsights', 'node_cpu_utilization', d('eks'))]],
        'EKS Memory': () => d('eks') && ['EKS node memory (%)', 'Average', [m('ContainerInsights', 'node_memory_utilization', d('eks'))]],
        'Backup Jobs': () => backup && ['AWS Backup jobs', 'Sum', [search('failed', 'NumberOfBackupJobsFailed', 'Failed'), search('completed', 'NumberOfBackupJobsCompleted', 'Completed')]],
        'Application Errors': () => c.metric_filter && ['Application errors (metric filter)', 'Sum', ['[var.cloudwatch_filter_metric_namespace, var.cloudwatch_filter_metric_name]']],
        'Log Events': () => c.log_group && ['Log events ingested', 'Sum', [m('AWS/Logs', 'IncomingLogEvents', ['LogGroupName', 'aws_cloudwatch_log_group.app.name'])]],
      };
      const list = [], skipped = [];
      for (const k of CW_WIDGETS) if (want.has(k)) { const w = W[k](); if (w) list.push(w); else skipped.push(k); }
      if (skipped.length) x.note(`Dashboard widgets skipped because their service is not selected: ${skipped.join(', ')}.`);
      const widget = (props, i, type = 'metric', width = 12) => ['{', `  type = "${type}"`, `  x = ${(i % 2) * 12}`, `  y = ${Math.floor(i / 2) * 6}`, `  width = ${width}`, `  height = ${type === 'text' ? 3 : 6}`, '  properties = {', ...props.map(p => '    ' + p), '  }', '},'].join('\n');
      const ws = list.length
        ? list.map(([title, stat, metrics], i) => widget([`title = ${hq(title)}`, 'region = var.aws_region', `stat = "${stat}"`, 'period = 300', 'view = "timeSeries"', 'metrics = [', ...metrics.map(l => '  ' + l + ','), ']'], i))
        : [widget(['markdown = "No metric widgets match the selected services yet. Select EC2, an ALB, RDS, Lambda, EKS or AWS Backup, or turn on the log group, then regenerate."'], 0, 'text', 24)];
      x.v('cloudwatch_dashboard_name', 'string', 'Dashboard name, appended to local.name_prefix', c.dashboard_name, { condition: 'can(regex("^[A-Za-z0-9_-]{1,200}$", var.cloudwatch_dashboard_name))', error: 'Dashboard names use letters, numbers, hyphens and underscores.' });
      x.o('cloudwatch_dashboard_arn', 'aws_cloudwatch_dashboard.main.dashboard_arn', 'ARN of the CloudWatch dashboard');
      files.push({ stem: 'cloudwatch_dashboard', title: 'Dashboard', desc: 'A dashboard built from the selected services. jsonencode() turns the HCL object into the JSON CloudWatch expects, with Terraform references resolved at apply time.', body: R('resource "aws_cloudwatch_dashboard" "main"', [
        'dashboard_name = "${local.name_prefix}-${var.cloudwatch_dashboard_name}"', '',
        'dashboard_body = jsonencode({\n  widgets = [\n' + indentLines(ws.join('\n'), '    ') + '\n  ]\n})',
      ]) });
    }

    // ---- EventBridge rules
    const rules = [];
    const jobs = backup && (c.bk_failed || c.bk_completed);
    if (jobs && c.bk_eventbridge) {
      const bk = (res, states, what) => rules.push({ res, desc: `AWS Backup jobs in this vault that ${what}`, pattern: ['source = ["aws.backup"]', '"detail-type" = ["Backup Job State Change"]', `detail = {\n  state = [${states.map(s => `"${s}"`).join(', ')}]\n  backupVaultName = [aws_backup_vault.main.name]\n}`] });
      if (c.bk_failed) bk('backup_failed', ['FAILED', 'ABORTED', 'EXPIRED'], 'failed, were aborted or expired');
      if (c.bk_completed) bk('backup_completed', ['COMPLETED'], 'completed');
    }
    if (c.ec2_events && (x.has('ec2') || x.has('asg'))) rules.push({ res: 'ec2_state', desc: x.has('ec2') ? 'The EC2 instance stopped or was terminated' : 'Any EC2 instance in the Region stopped or was terminated', pattern: ['source = ["aws.ec2"]', '"detail-type" = ["EC2 Instance State-change Notification"]', `detail = {\n  state = ["stopped", "terminated"]${x.has('ec2') ? '\n  "instance-id" = [aws_instance.main.id]' : ''}\n}`] });
    else if (c.ec2_events) x.note('The EC2 state-change rule needs EC2 Instance or Auto Scaling Group selected, so it was not generated.');
    if (rules.length) {
      let ev = '# EventBridge was called CloudWatch Events, which is why its Terraform resources are named aws_cloudwatch_event_*.';
      if (!sns) {
        x.data('events_to_logs', R('data "aws_iam_policy_document" "events_to_logs"', [B('statement', ['sid = "EventBridgeToLogs"', 'actions = ["logs:CreateLogStream", "logs:PutLogEvents"]', 'resources = ["${aws_cloudwatch_log_group.events.arn}:*"]', '', B('principals', ['type = "Service"', 'identifiers = ["events.amazonaws.com", "delivery.logs.amazonaws.com"]'])])]));
        ev += '\n\n' + R('resource "aws_cloudwatch_log_group" "events"', ['name = "/aws/events/${local.name_prefix}"', 'retention_in_days = 30'])
          + '\n\n# EventBridge needs a resource policy on CloudWatch Logs before it can write events.\n' + R('resource "aws_cloudwatch_log_resource_policy" "events"', ['policy_name = "${local.name_prefix}-events-to-logs"', 'policy_document = data.aws_iam_policy_document.events_to_logs.json']);
      }
      for (const r of rules) {
        ev += '\n\n' + R(`resource "aws_cloudwatch_event_rule" "${r.res}"`, ['name = "${local.name_prefix}-' + r.res.replace(/_/g, '-') + '"', `description = ${hq(r.desc)}`, 'state = "ENABLED"', '', 'event_pattern = jsonencode({\n' + indentLines(r.pattern.join('\n'), '  ') + '\n})'])
          + '\n\n' + R(`resource "aws_cloudwatch_event_target" "${r.res}"`, [`rule = aws_cloudwatch_event_rule.${r.res}.name`, `target_id = "${sns ? 'sns' : 'logs'}"`, 'arn = ' + (sns ? snsArn : 'aws_cloudwatch_log_group.events.arn')]);
      }
      x.o('eventbridge_rule_arns', hclList(rules.map(r => `aws_cloudwatch_event_rule.${r.res}.arn`)), 'ARNs of the EventBridge rules');
      files.push({ stem: 'eventbridge', title: 'EventBridge rules', desc: 'Rules that match service events and send them to ' + (sns ? 'the SNS topic.' : 'a CloudWatch log group.'), body: ev });
    }

    // ---- AWS Backup vault notifications
    const vaultEvents = [];
    if (backup && jobs && !c.bk_eventbridge) { if (c.bk_failed) vaultEvents.push('BACKUP_JOB_FAILED', 'BACKUP_JOB_EXPIRED'); if (c.bk_completed) vaultEvents.push('BACKUP_JOB_COMPLETED'); }
    if (backup && c.bk_vault) vaultEvents.push('RESTORE_JOB_COMPLETED', 'RESTORE_JOB_FAILED', 'COPY_JOB_FAILED', 'RECOVERY_POINT_MODIFIED');
    const notify = vaultEvents.length && sns;
    if (vaultEvents.length && !sns) x.note('Backup vault notifications need the SNS topic, so they were not generated. Turn on the SNS topic or route job events through EventBridge.');

    // ---- SNS topic
    if (sns) {
      const st = [];
      const ruleArns = rules.map(r => `aws_cloudwatch_event_rule.${r.res}.arn`);
      if (alarms.length) {
        x.caller();
        st.push(B('statement', ['sid = "AllowCloudWatchAlarms"', 'actions = ["sns:Publish"]', 'resources = [aws_sns_topic.alerts.arn]', '', B('principals', ['type = "Service"', 'identifiers = ["cloudwatch.amazonaws.com"]']), '', B('condition', ['test = "StringEquals"', 'variable = "aws:SourceAccount"', 'values = [data.aws_caller_identity.current.account_id]'])]));
      }
      if (ruleArns.length) st.push(B('statement', ['sid = "AllowEventBridgeRules"', 'actions = ["sns:Publish"]', 'resources = [aws_sns_topic.alerts.arn]', '', B('principals', ['type = "Service"', 'identifiers = ["events.amazonaws.com"]']), '', B('condition', ['test = "ArnEquals"', 'variable = "aws:SourceArn"', 'values = ' + hclList(ruleArns)])]));
      if (notify) st.push(B('statement', ['sid = "AllowAWSBackup"', 'actions = ["sns:Publish"]', 'resources = [aws_sns_topic.alerts.arn]', '', B('principals', ['type = "Service"', 'identifiers = ["backup.amazonaws.com"]'])]));
      x.v('cloudwatch_alerts_email', 'string', 'Email address subscribed to the alerts topic. Null creates no subscription', c.email || null, { condition: 'var.cloudwatch_alerts_email == null || can(regex("^[^@\\\\s]+@[^@\\\\s]+$", var.cloudwatch_alerts_email))', error: 'cloudwatch_alerts_email must be an email address or null.' });
      x.o('sns_topic_arn', 'aws_sns_topic.alerts.arn', 'ARN of the alerts SNS topic');
      let t = R('resource "aws_sns_topic" "alerts"', ['name = "${local.name_prefix}-alerts"']);
      if (st.length) {
        t += '\n\n# The topic policy lets only these AWS services publish.\n' + R('data "aws_iam_policy_document" "sns_alerts"', st.flatMap((s, i) => (i ? ['', s] : [s])))
          + '\n\n' + R('resource "aws_sns_topic_policy" "alerts"', ['arn = aws_sns_topic.alerts.arn', 'policy = data.aws_iam_policy_document.sns_alerts.json']);
      } else x.note('Nothing publishes to the SNS topic yet: turn on an alarm, an EventBridge rule or backup vault notifications.');
      t += '\n\n' + R('resource "aws_sns_topic_subscription" "email"', ['count = var.cloudwatch_alerts_email == null ? 0 : 1', '', 'topic_arn = aws_sns_topic.alerts.arn', 'protocol = "email"', 'endpoint = var.cloudwatch_alerts_email']);
      files.push({ stem: 'sns', title: 'SNS notifications', desc: 'The topic alarms and events publish to, with a policy for each publishing service and an optional email subscription.', body: t });
    }
    if (notify) files.push({ stem: 'backup_notifications', title: 'Backup vault notifications', desc: 'AWS Backup vault events sent straight to the SNS topic.', body: R('resource "aws_backup_vault_notifications" "main"', [
      'backup_vault_name = aws_backup_vault.main.name',
      'sns_topic_arn = aws_sns_topic.alerts.arn',
      'backup_vault_events = ' + hclList(vaultEvents.map(e => `"${e}"`)),
      '',
      '# AWS Backup checks it can publish before saving the configuration.',
      'depends_on = [aws_sns_topic_policy.alerts]',
    ]) });

    if (!files.length) files.push({ stem: 'cloudwatch', title: 'CloudWatch', desc: 'Nothing is turned on yet.', body: '# Every CloudWatch component is turned off in the configuration panel.\n# Turn on a log group, alarm, dashboard or notification to generate resources.' });
    return files;
  },
});


const PRESETS = [
  { name: 'Guided example: web server in a VPC', ids: ['vpc', 'subnet', 'route_table', 'igw', 'nat', 'sg', 'ec2'] },
  { name: 'Three-tier web app', ids: ['vpc', 'subnet', 'route_table', 'igw', 'nat', 'sg', 'alb', 'tg', 'listener', 'lt', 'asg', 'iam_role', 'dbsg', 'rds_postgres', 'kms'], cfg: { sg: { ports: '443, 80, 5432' } } },
  { name: 'Containers on ECS Fargate', ids: ['vpc', 'subnet', 'route_table', 'igw', 'nat', 'sg', 'alb', 'tg', 'listener', 'ecr', 'ecs_cluster', 'ecs_task', 'ecs_service'], cfg: { tg: { target_type: 'ip' } } },
  { name: 'Kubernetes on EKS', ids: ['vpc', 'subnet', 'route_table', 'igw', 'nat', 'sg', 'kms', 'eks_cluster', 'eks_node_group', 'ecr'] },
  { name: 'Serverless API backend', ids: ['lambda', 'dynamodb', 'kms'] },
  { name: 'Static website on the edge', ids: ['s3', 's3_versioning', 's3_encryption', 'cloudfront', 'waf', 'route53_zone', 'route53_record'] },
  { name: 'Backup and monitoring for a web server', ids: ['vpc', 'subnet', 'route_table', 'igw', 'nat', 'sg', 'ec2', 'ebs', 'kms', 'backup', 'cloudwatch'] },
];

if (typeof module !== 'undefined') module.exports = { SERVICES, SVC, CATS, PRESETS, docUrl, hv, hq, R, B, depsOf, backupTargets, cwDims, CW_TARGET };
