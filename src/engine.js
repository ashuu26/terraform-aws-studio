/* ==========================================================================
   engine.js — turns a selection + config into Terraform files, and
   performs client-side static checks. It never runs Terraform itself.
   ========================================================================== */

const DEFAULT_GLOBAL = {
  tf: '1.8', provider: '~> 6.0', region: 'ap-southeast-1', project: 'tf-learning', env: 'dev', layout: 'flat',
};
const PROVIDER_SNAPSHOT = { latestSeen: '6.56.0', checked: '2026-09-25' };
const TF_VERSIONS = ['1.15', '1.14', '1.13', '1.12', '1.11', '1.10', '1.9', '1.8'];
const REGIONS = ['ap-southeast-1', 'ap-southeast-5', 'ap-southeast-2', 'ap-southeast-3', 'ap-northeast-1', 'ap-south-1', 'us-east-1', 'us-west-2', 'eu-west-1', 'eu-central-1'];

function defaultConfig(svc) { const o = {}; for (const f of svc.fields) o[f.k] = f.d; return o; }

function makeCtx(sel, cfg) {
  const vars = new Map(), outs = new Map(), data = new Map(), notes = [], flags = { archive: false, useast1: false }, extraFiles = {};
  let current = null;
  const x = {
    has: id => sel.has(id),
    setCurrent(id) { current = id; },
    v(name, type, desc, def, val) {
      if (!vars.has(name)) vars.set(name, { type, desc, def, val, svc: current });
      return 'var.' + name;
    },
    o(name, value, desc) { outs.set(name, { value, desc, svc: current }); },
    data(key, hcl) { if (!data.has(key)) data.set(key, hcl); },
    note(s) { notes.push({ svc: current, text: s }); },
    flags, extraFiles,
    azData() { x.data('azs', R('data "aws_availability_zones" "available"', ['state = "available"'])); },
    caller() { x.data('caller', 'data "aws_caller_identity" "current" {}'); },
    vpcId() { return x.has('vpc') ? 'aws_vpc.main.id' : x.v('vpc_id', 'string', 'ID of an existing VPC (the VPC service is not selected)'); },
    privateIds() { return x.has('subnet') ? 'values(aws_subnet.private)[*].id' : x.v('private_subnet_ids', 'list(string)', 'IDs of existing private subnets (the Subnet service is not selected)'); },
    publicIds() { return x.has('subnet') ? 'values(aws_subnet.public)[*].id' : x.v('public_subnet_ids', 'list(string)', 'IDs of existing public subnets (the Subnet service is not selected)'); },
    firstPrivate() { return x.has('subnet') ? 'values(aws_subnet.private)[0].id' : x.privateIds() + '[0]'; },
    firstPublic() { return x.has('subnet') ? 'values(aws_subnet.public)[0].id' : x.publicIds() + '[0]'; },
    sgOpt(arg) { return x.has('sg') ? `${arg} = [aws_security_group.main.id]` : null; },
    kmsArn() { return x.has('kms') ? 'aws_kms_key.main.arn' : null; },
  };
  return { x, vars, outs, data, notes, flags, extraFiles };
}

/* ---------- formatting: tidy blank lines + align "=" like terraform fmt ---------- */
function tidy(text) {
  let lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') {
      const prev = out.length ? out[out.length - 1].trim() : '';
      const next = (lines.slice(i + 1).find(s => s.trim() !== '') || '').trim();
      if (!out.length || prev === '' || /[{[(]$/.test(prev) || /^[}\])]/.test(next)) continue;
    }
    out.push(l.replace(/\s+$/, ''));
  }
  return alignEquals(out).join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
function alignEquals(lines) {
  const res = lines.slice();
  let group = [];
  const flush = () => {
    if (group.length > 1) {
      const w = Math.max(...group.map(g => g.key.length));
      for (const g of group) res[g.i] = g.ind + g.key.padEnd(w) + ' = ' + g.val;
    }
    group = [];
  };
  let depthStack = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)([A-Za-z_][\w-]*|"[^"]+")\s*=\s(?!=)(.*)$/);
    const opensMulti = m && /[{[(]\s*$/.test(m[3]) && !/^\s*[{[(].*[}\])]\s*$/.test(m[3]);
    if (m && !opensMulti && m[1] !== undefined) {
      if (group.length && group[0].ind !== m[1]) flush();
      group.push({ i, ind: m[1], key: m[2], val: m[3] });
    } else if (m && opensMulti) {
      if (group.length && group[0].ind === m[1]) {
        group.push({ i, ind: m[1], key: m[2], val: m[3] });
      }
      flush();
    } else flush();
  }
  flush();
  return res;
}

/* ---------- main generator ---------- */
function generateProject(selIds, cfgAll, g) {
  const sel = new Set(selIds);
  const { x, vars, outs, data, notes, flags, extraFiles } = makeCtx(sel, cfgAll);
  const ordered = SERVICES.filter(s => sel.has(s.id));
  const svcFiles = [];

  // global variables first
  x.setCurrent('_global');
  x.v('aws_region', 'string', 'AWS region to deploy into', g.region, { condition: 'can(regex("^[a-z]{2}(-[a-z]+)+-\\\\d$", var.aws_region))', error: 'aws_region must look like ap-southeast-1.' });
  x.v('project_name', 'string', 'Short project name used in resource names (lowercase, hyphens)', g.project, { condition: 'can(regex("^[a-z][a-z0-9-]{1,20}$", var.project_name))', error: 'project_name must be 2-21 lowercase letters, numbers or hyphens, starting with a letter.' });
  x.v('environment', 'string', 'Deployment environment', g.env, { condition: 'contains(["dev", "staging", "prod"], var.environment)', error: 'environment must be dev, staging or prod.' });
  x.v('additional_tags', 'map(string)', 'Extra tags merged into the provider default_tags', {});

  for (const s of ordered) {
    x.setCurrent(s.id);
    const c = Object.assign(defaultConfig(s), cfgAll[s.id] || {});
    const body = s.gen(c, x);
    svcFiles.push({ svc: s, body });
  }

  const files = [];
  const header = (title, lines) => `# ${title}\n` + lines.map(l => '# ' + l).join('\n') + '\n\n';

  // providers.tf
  const reqProv = [
    'aws = {\n  source  = "hashicorp/aws"\n  version = ' + hq(g.provider) + '\n}',
    flags.archive ? 'archive = {\n  source  = "hashicorp/archive"\n  version = "~> 2.7"\n}' : null,
  ].filter(Boolean);
  let providers = header('providers.tf', [
    'Terraform and provider requirements.',
    'Authentication is NOT configured here: the AWS provider uses the standard',
    'credential chain (AWS_PROFILE / IAM Identity Center, environment, or an IAM role).',
  ]) + R('terraform', [
    `required_version = ">= ${g.tf}.0"`, '',
    B('required_providers', [reqProv.join('\n')]), '',
    '# Remote state with native S3 locking (Terraform 1.10+). Uncomment after creating the bucket.',
    '# backend "s3" {\n#   bucket       = "my-terraform-state-bucket"\n#   key          = "tf-learning/terraform.tfstate"\n#   region       = "ap-southeast-1"\n#   encrypt      = true\n#   use_lockfile = true\n# }',
  ]) + '\n\n' + R('provider "aws"', ['region = var.aws_region', '', B('default_tags', ['tags = local.common_tags'])]);
  if (flags.useast1) providers += '\n\n' + '# CloudFront-scoped resources (WAF, ACM certificates) must be created in us-east-1.\n' + R('provider "aws"', ['alias = "us_east_1"', 'region = "us-east-1"', '', B('default_tags', ['tags = local.common_tags'])]);
  files.push({ name: 'providers.tf', cat: 'root', content: tidy(providers) });

  // locals.tf
  files.push({ name: 'locals.tf', cat: 'root', content: tidy(header('locals.tf', ['Values computed once and reused everywhere.']) + R('locals', [
    'name_prefix = "${var.project_name}-${var.environment}"', '',
    'common_tags = merge(\n  {\n    Project     = var.project_name\n    Environment = var.environment\n    ManagedBy   = "Terraform"\n  },\n  var.additional_tags,\n)',
  ])) });

  // variables.tf
  let varsTxt = header('variables.tf', ['Every tunable value lives here. Override them in terraform.tfvars.']);
  let lastSvc = null;
  for (const [name, v] of vars) {
    if (v.svc !== lastSvc) { varsTxt += (lastSvc ? '\n' : '') + '# ' + (v.svc === '_global' ? 'Global' : SVC[v.svc].name) + '\n\n'; lastSvc = v.svc; }
    const items = ['description = ' + hq(v.desc), 'type = ' + v.type];
    if (v.def !== undefined) items.push('default = ' + hv(v.def));
    if (v.val) items.push('', B('validation', ['condition = ' + v.val.condition, 'error_message = ' + hq(v.val.error)]));
    varsTxt += R(`variable "${name}"`, items) + '\n\n';
  }
  files.push({ name: 'variables.tf', cat: 'root', content: tidy(varsTxt) });

  // data.tf (shared data sources)
  if (data.size) files.push({ name: 'data.tf', cat: 'root', content: tidy(header('data.tf', ['Shared data sources: read-only lookups used by several services.']) + [...data.values()].join('\n\n')) });

  // service files
  for (const f of svcFiles) {
    const s = f.svc;
    const links = s.res.map(t => '  ' + t + ': ' + docUrl(t));
    const name = (g.layout === 'category' ? s.cat + '_' : '') + s.file + '.tf';
    files.push({ name, cat: s.cat, svc: s.id, content: tidy(header(`${s.name}`, [s.desc, 'Registry docs:', ...links]) + f.body) });
  }

  // outputs.tf
  let outTxt = header('outputs.tf', ['Values printed after apply and readable by other configurations.']);
  lastSvc = null;
  for (const [name, o] of outs) {
    if (o.svc !== lastSvc) { outTxt += (lastSvc ? '\n' : '') + '# ' + SVC[o.svc].name + '\n\n'; lastSvc = o.svc; }
    outTxt += R(`output "${name}"`, ['description = ' + hq(o.desc), 'value = ' + o.value]) + '\n\n';
  }
  if (!outs.size) outTxt += '# Select services to generate outputs.\n';
  files.push({ name: 'outputs.tf', cat: 'root', content: tidy(outTxt) });

  // terraform.tfvars.example
  let tfv = '# Copy to terraform.tfvars and adjust. Never put credentials or passwords here.\n\n';
  for (const [name, v] of vars) {
    if (v.def === undefined) tfv += `${name} = "REPLACE_ME" # required\n`;
    else tfv += `# ${name} = ${hv(v.def).split('\n').join('\n# ')}\n`;
  }
  files.push({ name: 'terraform.tfvars.example', cat: 'root', content: tfv });

  // order: providers, locals, variables, data, services, outputs, tfvars
  const extras = Object.entries(extraFiles).map(([name, content]) => ({ name, content, cat: 'extra' }));
  return { files, extras, notes, vars, outs, flags };
}

/* ---------- static validation ---------- */
function stripComments(t) {
  // Remove comments while preserving strings (so '#' inside strings survives).
  let out = '', i = 0, inStr = false;
  while (i < t.length) {
    const ch = t[i];
    if (inStr) { out += ch; if (ch === '\\') { out += t[i + 1] || ''; i += 2; continue; } if (ch === '"') inStr = false; i++; continue; }
    if (ch === '"') { inStr = true; out += ch; i++; continue; }
    if (ch === '#' || (ch === '/' && t[i + 1] === '/')) { while (i < t.length && t[i] !== '\n') i++; continue; }
    if (ch === '/' && t[i + 1] === '*') { const e = t.indexOf('*/', i + 2); i = e < 0 ? t.length : e + 2; continue; }
    out += ch; i++;
  }
  return out;
}
function balance(t) {
  const pairs = { '{': '}', '[': ']', '(': ')' }, stack = [];
  let line = 1, inStr = false, interp = 0;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === '\n') { line++; if (inStr && !interp) return `Unterminated string on line ${line - 1}`; }
    if (inStr && !interp) {
      if (ch === '\\') { i++; continue; }
      if (ch === '$' && t[i + 1] === '{') { interp++; stack.push({ ch: '{', line, interp: true }); i++; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (pairs[ch]) stack.push({ ch, line });
    else if ('}])'.includes(ch)) {
      const top = stack.pop();
      if (!top || pairs[top.ch] !== ch) return `Unexpected "${ch}" on line ${line}`;
      if (top.interp) { interp--; inStr = true; }
    }
  }
  if (inStr) return 'Unterminated string at end of file';
  if (stack.length) return `Unclosed "${stack[stack.length - 1].ch}" opened on line ${stack[stack.length - 1].line}`;
  return null;
}

function validateProject(files, selIds, cfgAll, g) {
  const sel = new Set(selIds);
  const checks = {
    syntax: { label: 'Terraform syntax (brackets and strings)', items: [] },
    variables: { label: 'Variables', items: [] },
    refs: { label: 'Resource and data references', items: [] },
    outputs: { label: 'Outputs', items: [] },
    provider: { label: 'Provider configuration', items: [] },
    security: { label: 'Security', items: [] },
    design: { label: 'Dependencies and design', items: [] },
  };
  const add = (k, level, msg) => checks[k].items.push({ level, msg });
  const tf = files.filter(f => f.name.endsWith('.tf'));
  const declared = { vars: new Map(), res: new Map(), data: new Map(), outs: new Map(), locals: new Set(), aliases: new Set() };
  const all = [];
  for (const f of tf) {
    const b = balance(f.content);
    if (b) add('syntax', 'error', `${f.name}: ${b}`);
    const code = stripComments(f.content);
    all.push({ f, code });
    for (const m of code.matchAll(/^\s*variable\s+"([^"]+)"/gm)) { if (declared.vars.has(m[1])) add('variables', 'error', `Variable "${m[1]}" is declared twice (${declared.vars.get(m[1])} and ${f.name}).`); declared.vars.set(m[1], f.name); }
    for (const m of code.matchAll(/^\s*resource\s+"([^"]+)"\s+"([^"]+)"/gm)) { const a = m[1] + '.' + m[2]; if (declared.res.has(a)) add('refs', 'error', `Duplicate resource address ${a} (${declared.res.get(a)} and ${f.name}).`); declared.res.set(a, f.name); }
    for (const m of code.matchAll(/^\s*data\s+"([^"]+)"\s+"([^"]+)"/gm)) { const a = m[1] + '.' + m[2]; if (declared.data.has(a)) add('refs', 'error', `Duplicate data source data.${a} (${declared.data.get(a)} and ${f.name}).`); declared.data.set(a, f.name); }
    for (const m of code.matchAll(/^\s*output\s+"([^"]+)"/gm)) { if (declared.outs.has(m[1])) add('outputs', 'error', `Output "${m[1]}" is declared twice.`); declared.outs.set(m[1], f.name); }
    const lb = code.match(/^locals\s*\{([\s\S]*?)^\}/m);
    if (lb) for (const m of lb[1].matchAll(/^ {2}([A-Za-z_][\w-]*)\s*=/gm)) declared.locals.add(m[1]);
    for (const m of code.matchAll(/provider\s+"aws"\s*\{[^}]*?alias\s*=\s*"([^"]+)"/g)) declared.aliases.add(m[1]);
  }
  const usedVars = new Set();
  for (const { f, code } of all) {
    const scan = code.replace(/^\s*(variable|output|resource|data)\s+"[^"]+"(\s+"[^"]+")?/gm, '');
    for (const m of scan.matchAll(/\bvar\.([A-Za-z_][\w-]*)/g)) { usedVars.add(m[1]); if (!declared.vars.has(m[1])) add('variables', 'error', `${f.name}: var.${m[1]} is used but never declared.`); }
    for (const m of scan.matchAll(/\blocal\.([A-Za-z_][\w-]*)/g)) if (!declared.locals.has(m[1])) add('refs', 'error', `${f.name}: local.${m[1]} is not defined in a locals block.`);
    for (const m of scan.matchAll(/\bdata\.([a-z0-9_]+)\.([A-Za-z_][\w-]*)/g)) if (!declared.data.has(m[1] + '.' + m[2])) add('refs', 'error', `${f.name}: data.${m[1]}.${m[2]} is referenced but not declared.`);
    for (const m of scan.matchAll(/(?<![\w.:"/-])(aws_[a-z0-9_]+)\.([A-Za-z_][\w-]*)/g)) {
      const a = m[1] + '.' + m[2];
      if (!declared.res.has(a)) add(f.name === 'outputs.tf' ? 'outputs' : 'refs', 'error', `${f.name}: ${a} is referenced but no such resource exists.`);
    }
    for (const m of scan.matchAll(/provider\s*=\s*aws\.([A-Za-z_][\w-]*)/g)) if (!declared.aliases.has(m[1])) add('provider', 'error', `${f.name}: provider alias aws.${m[1]} is not configured.`);
  }
  for (const [n, file] of declared.vars) if (!usedVars.has(n)) add('variables', 'warn', `var.${n} is declared in ${file} but never used.`);
  const joined = all.map(a => a.code).join('\n');
  if (!/required_providers\s*\{[\s\S]*?aws\s*=\s*\{[\s\S]*?source\s*=\s*"hashicorp\/aws"/.test(joined)) add('provider', 'error', 'required_providers does not declare hashicorp/aws.');
  if (!/provider\s+"aws"\s*\{/.test(joined)) add('provider', 'error', 'No provider "aws" block found.');
  if (!/required_version\s*=/.test(joined)) add('provider', 'warn', 'No required_version constraint for Terraform itself.');
  if (/data\s+"archive_file"/.test(joined) && !/hashicorp\/archive/.test(joined)) add('provider', 'error', 'archive_file is used but hashicorp/archive is not in required_providers.');
  if (!declared.outs.size) add('outputs', 'warn', 'No outputs are defined.');

  // Security
  const raw = files.map(f => f.content).join('\n');
  if (/AKIA[0-9A-Z]{16}/.test(raw)) add('security', 'error', 'Something that looks like an AWS access key ID is present. Remove it and rotate the key.');
  if (/\b(access_key|secret_key|token)\s*=/.test(joined)) add('security', 'error', 'Credentials are set in code. Use AWS_PROFILE, IAM Identity Center or an IAM role instead.');
  if (/\b(password|master_password)\s*=\s*"/.test(joined)) add('security', 'error', 'A literal password is set. Use manage_master_user_password or Secrets Manager.');
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(raw)) add('security', 'error', 'A private key is embedded in the configuration.');
  if (/cidr_ipv4\s*=\s*"0\.0\.0\.0\/0"/.test(joined.replace(/aws_vpc_security_group_egress_rule[\s\S]*?\n\}/g, ''))) add('security', 'warn', 'An ingress rule is open to 0.0.0.0/0.');
  const sgCfg = Object.assign(sel.has('sg') ? defaultConfig(SVC.sg) : {}, cfgAll.sg || {});
  if (sel.has('sg') && sgCfg.cidr === '0.0.0.0/0') add('security', 'warn', 'The security group allows the whole internet. Keep that for public load balancers only.');
  if (sel.has('eks_cluster')) { const c = Object.assign(defaultConfig(SVC.eks_cluster), cfgAll.eks_cluster || {}); if (c.public && csv(c.cidrs).includes('0.0.0.0/0')) add('security', 'warn', 'The EKS API endpoint is public to 0.0.0.0/0. Narrow eks_public_access_cidrs.'); }
  if (sel.has('memorydb')) add('security', 'warn', 'MemoryDB uses the open-access ACL. Replace it before production.');
  if (!checks.security.items.some(i => i.level === 'error')) add('security', 'ok', 'No access keys, secrets, passwords or private keys found in the generated code.');

  // Design / dependency checks
  for (const id of sel) for (const d of SVC[id].deps) if (!sel.has(d)) add('design', 'info', `${SVC[id].name} usually pairs with ${SVC[d].name}. It will use an input variable or a default instead.`);
  const ports = sel.has('sg') ? csv(sgCfg.ports).map(Number) : null;
  const needPort = (ids, port, what) => { if (ports && ids.some(i => sel.has(i)) && !ports.includes(port)) add('design', 'warn', `${what} needs TCP ${port} in the security group; it is not in the allowed ports.`); };
  const cfgOf = id => Object.assign(defaultConfig(SVC[id]), cfgAll[id] || {});
  if (sel.has('rds') || sel.has('rds_postgres') || sel.has('aurora')) {
    const pg = sel.has('rds_postgres') || (sel.has('rds') && cfgOf('rds').engine === 'postgres') || (sel.has('aurora') && cfgOf('aurora').engine === 'aurora-postgresql');
    if (pg) needPort(['rds', 'rds_postgres', 'aurora'], 5432, 'PostgreSQL');
  }
  needPort(['rds_mysql'], 3306, 'MySQL');
  needPort(['rds_sqlserver'], 1433, 'SQL Server');
  needPort(['efs'], 2049, 'EFS (NFS)');
  needPort(['elasticache', 'memorydb'], 6379, 'The cache');
  if (sel.has('tg') && sel.has('ecs_service') && cfgOf('tg').target_type !== 'ip') add('design', 'error', 'ECS Fargate tasks register by IP. Set the target group type to ip.');
  if (sel.has('asg')) { const c = cfgOf('asg'); if (!(+c.min <= +c.desired && +c.desired <= +c.max)) add('design', 'error', 'Auto Scaling sizes must satisfy min <= desired <= max.'); }
  if (sel.has('subnet')) {
    const c = cfgOf('subnet');
    if (csv(c.private).length === 0) add('design', 'error', 'At least one private subnet is required by the services that reference private subnets.');
    if (csv(c.private).length < 2 && ['dbsg', 'eks_cluster', 'aurora', 'elasticache'].some(i => sel.has(i))) add('design', 'error', 'RDS subnet groups, Aurora, ElastiCache and EKS need private subnets in at least two AZs.');
    if (csv(c.public).length < 2 && sel.has('alb')) add('design', 'error', 'An Application Load Balancer needs at least two subnets in different AZs.');
    if (sel.has('nat') && csv(c.public).length === 0) add('design', 'error', 'The NAT gateway needs a public subnet.');
  }
  if (sel.has('nat') && !sel.has('route_table')) add('design', 'warn', 'The NAT gateway is created but no route table sends private traffic to it.');
  if (sel.has('igw') && !sel.has('route_table')) add('design', 'warn', 'The internet gateway is not referenced by any route table, so nothing routes to it yet.');
  if (sel.has('alb') && !sel.has('listener')) add('design', 'warn', 'The ALB has no listener, so it will not accept traffic.');
  if (sel.has('iam_role') && (sel.has('ec2') || sel.has('lt')) && cfgOf('iam_role').service !== 'ec2.amazonaws.com') add('design', 'error', 'EC2 instance profiles need the IAM role to trust ec2.amazonaws.com.');
  if (sel.has('tg') && sel.has('nlb') && !sel.has('alb') && cfgOf('tg').protocol !== 'TCP') add('design', 'error', 'A Network Load Balancer needs a TCP target group.');
  if (sel.has('listener') && sel.has('alb') && cfgOf('listener').protocol === 'HTTPS') add('design', 'info', 'The HTTPS listener needs certificate_arn set in terraform.tfvars.');
  if (sel.has('fsx') && ports && !ports.includes(988)) add('design', 'warn', 'FSx for Lustre needs TCP 988 and 1018-1023 in the security group.');
  if (!checks.design.items.length) add('design', 'ok', 'Selected services have the pieces they depend on.');

  for (const k of Object.keys(checks)) {
    const c = checks[k];
    if (!c.items.length) c.items.push({ level: 'ok', msg: { syntax: 'All brackets, braces and strings are balanced.', variables: 'Every var.* reference is declared and every variable is used.', refs: 'Every resource, data and local reference resolves.', outputs: 'All outputs reference resources that exist.', provider: 'hashicorp/aws is required and configured.' }[k] || 'OK' });
    const lv = c.items.map(i => i.level);
    c.status = lv.includes('error') ? 'error' : lv.includes('warn') ? 'warn' : 'ok';
  }
  return checks;
}

/* ---------- syntax highlighting ---------- */
const HCL_BLOCKS = new Set(['resource', 'data', 'variable', 'output', 'locals', 'module', 'provider', 'terraform', 'dynamic', 'content', 'backend', 'required_providers', 'lifecycle', 'validation']);
const HCL_META = new Set(['for_each', 'count', 'depends_on', 'provider', 'lifecycle', 'for', 'in', 'if', 'each', 'self', 'path']);
function tokenizeHCL(src) {
  const toks = []; let i = 0;
  const push = (c, t) => toks.push([c, t]);
  const re = {
    comment: /#[^\n]*|\/\/[^\n]*|\/\*[\s\S]*?\*\//y,
    num: /\b\d+(?:\.\d+)?\b/y,
    word: /[A-Za-z_][\w-]*/y,
  };
  while (i < src.length) {
    const ch = src[i];
    let m;
    re.comment.lastIndex = i;
    if ((ch === '#' || ch === '/') && (m = re.comment.exec(src))) { push('c', m[0]); i += m[0].length; continue; }
    if (ch === '"') {
      let j = i + 1, buf = '"';
      while (j < src.length && src[j] !== '"' && src[j] !== '\n') {
        if (src[j] === '\\') { buf += src[j] + (src[j + 1] || ''); j += 2; continue; }
        if (src[j] === '$' && src[j + 1] === '{') {
          push('s', buf); buf = '';
          let d = 0, k = j;
          for (; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) break; } }
          push('i', src.slice(j, k + 1)); j = k + 1; continue;
        }
        buf += src[j]; j++;
      }
      if (src[j] === '"') { buf += '"'; j++; }
      push('s', buf); i = j; continue;
    }
    re.num.lastIndex = i;
    if (/\d/.test(ch) && (m = re.num.exec(src))) { push('n', m[0]); i += m[0].length; continue; }
    re.word.lastIndex = i;
    if (/[A-Za-z_]/.test(ch) && (m = re.word.exec(src))) {
      const w = m[0]; const rest = src.slice(i + w.length, i + w.length + 40);
      const lineStart = src.lastIndexOf('\n', i - 1) + 1;
      const atStart = /^\s*$/.test(src.slice(lineStart, i));
      let cls = 'p';
      if (w === 'true' || w === 'false' || w === 'null') cls = 'b';
      else if (atStart && HCL_BLOCKS.has(w) && /^\s*("|\{)/.test(rest)) cls = 'k';
      else if (/^\s*=(?!=)/.test(rest)) cls = HCL_META.has(w) ? 'm' : 'a';
      else if (/^\(/.test(rest)) cls = 'f';
      else if (['var', 'local', 'data', 'each', 'count', 'path', 'module'].includes(w) && rest[0] === '.') cls = 'r';
      else if (/^aws_/.test(w) && rest[0] === '.') cls = 'r';
      else if (atStart && /^\s*\{/.test(rest)) cls = 'k';
      push(cls, w); i += w.length; continue;
    }
    push('p', ch); i++;
  }
  return toks;
}
function escHtml(s) { return s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function highlightHCL(src, query) {
  const toks = tokenizeHCL(src);
  const q = (query || '').toLowerCase();
  let html = '', pos = 0;
  const markRanges = [];
  if (q) { const low = src.toLowerCase(); let k = low.indexOf(q); while (k >= 0) { markRanges.push([k, k + q.length]); k = low.indexOf(q, k + q.length); } }
  let mi = 0;
  for (const [cls, text] of toks) {
    const start = pos, end = pos + text.length;
    let piece = '';
    if (!markRanges.length) piece = escHtml(text);
    else {
      let p = start;
      while (mi < markRanges.length && markRanges[mi][1] <= start) mi++;
      let j = mi;
      while (j < markRanges.length && markRanges[j][0] < end) {
        const [a, b] = markRanges[j];
        const s = Math.max(a, start), e = Math.min(b, end);
        if (s > p) piece += escHtml(src.slice(p, s));
        piece += '<mark data-i="' + j + '">' + escHtml(src.slice(s, e)) + '</mark>';
        p = e;
        if (b > end) break;
        j++;
      }
      if (p < end) piece += escHtml(src.slice(p, end));
    }
    html += cls === 'p' ? piece : `<span class="t-${cls}">${piece}</span>`;
    pos = end;
  }
  return { html, count: markRanges.length, ranges: markRanges };
}

if (typeof module !== 'undefined') module.exports = { generateProject, validateProject, highlightHCL, tidy, DEFAULT_GLOBAL, TF_VERSIONS, REGIONS, PROVIDER_SNAPSHOT, defaultConfig };
