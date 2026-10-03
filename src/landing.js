/* ==========================================================================
   landing.js — AWS Landing Zone dashboard and wizard: model choice, OU
   builder, accounts and placement, SCP builder, Control Tower, review,
   generation, and the organization tree diagram. Uses the model and checks
   in landingzone.js and the shared UI helpers in ui.js.
   ========================================================================== */

const LZ_STEPS = [['type', 'Type'], ['org', 'Organization'], ['ous', 'OUs'], ['accounts', 'Accounts'], ['placement', 'Placement'], ['governance', 'Governance'], ['ct', 'Control Tower'], ['review', 'Review'], ['generate', 'Generate']];
const LZ_NEED_CLS = { Required: 'error', Recommended: 'warn', Optional: 'off' };

function lzC() { return isSel(LZ_ID) ? cfgOf(LZ_ID) : null; }
function lzPut(c) { state.cfg[LZ_ID] = c; persist(); renderTabs(); renderSummary(); }
function lzStart(model) {
  const cur = lzC();
  if (cur && cur.model && !confirm(`Replace your current ${LZ_MODEL_INFO[cur.model].label} landing zone with the ${LZ_MODEL_INFO[model].label} starter template?`)) return;
  state.cfg[LZ_ID] = lzTemplate(model, state.g.region);
  if (!isSel(LZ_ID)) state.sel.push(LZ_ID);
  state.lzStep = 1;
  changed();
  toast(`${LZ_MODEL_INFO[model].title} template loaded. Everything in it can be changed.`);
  setTab('landing');
}
const lzStepOff = (c, i) => LZ_STEPS[i][0] === 'ct' && c.model !== 'enterprise';
function lzGo(i) {
  const c = lzC(); if (!c) return;
  if (lzStepOff(c, i)) i += i > state.lzStep ? 1 : -1;
  state.lzStep = Math.max(0, Math.min(LZ_STEPS.length - 1, i));
  persist(); renderMain();
  const h = $('#lzStepTitle'); if (h) h.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}
function setPath(o, path, v) { const ks = path.split('.'); let t = o; for (let i = 0; i < ks.length - 1; i++) t = t[ks[i]]; t[ks[ks.length - 1]] = v; }
function getPath(o, path) { return path.split('.').reduce((t, k) => (t == null ? t : t[k]), o); }
const lzTagsText = t => Object.entries(t || {}).map(([k, v]) => `${k} = ${v}`).join('\n');
function lzParseTags(s) { const o = {}; for (const l of String(s).split('\n')) { const m = l.match(/^\s*([A-Za-z0-9_.:/+@ -]{1,128}?)\s*=\s*(.*?)\s*$/); if (m && m[1]) o[m[1]] = m[2]; } return o; }
const lzOuOpts = (c, sel, opts = {}) => (opts.root !== false ? `<option value="root" ${sel === 'root' ? 'selected' : ''}>Root (no OU)</option>` : '') + lzOuOrder(c).filter(o => o.key !== opts.exclude).map(o => `<option value="${esc(o.key)}" ${o.key === sel ? 'selected' : ''}>${esc('— '.repeat(Math.max(0, lzOuDepth(c, o.key) - 1)) + o.name)}</option>`).join('');
const lzSel = (path, val, opts, label) => `<select class="inp" data-lz="${path}" data-t="sel" ${label ? `aria-label="${esc(label)}"` : ''}>${opts.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`;
const lzTxt = (path, val, attrs = '') => `<input class="inp" data-lz="${path}" data-t="text" value="${esc(val)}" spellcheck="false" ${attrs}>`;
const lzChk = (path, val, label, attrs = '') => `<label class="chk"><input type="checkbox" data-lz="${path}" data-t="bool" ${val ? 'checked' : ''} ${attrs}>${label}</label>`;

/* ---------------- account status ---------------- */
function lzStatus(c, a, checks) {
  if (checks.some(i => i.level === 'error' && a.name && i.msg.includes(`"${a.name}"`))) return ['Validation Required', 'error'];
  if (state.gen && !isStale() && a.mode !== 'reference') return ['Configured', 'ok'];
  if (a.mode === 'reference') return ['Existing', 'ok'];
  if (a.mode === 'import') return ['To Move', 'info'];
  return [lzFactory(c, a) ? 'To Create (Account Factory)' : 'To Create', 'info'];
}
const lzSym = l => ({ ok: '✓', warn: '!', error: '✕', info: 'i', off: '' }[l]);

/* ---------------- summary (also used in the side panel) ---------------- */
function lzStats(c) {
  const acts = lzActiveAccounts(c);
  const lv = live();
  const lzFiles = lv.files.filter(f => f.svc === LZ_ID);
  const att = c.scps.filter(s => s.enabled !== false && scpPolicy(s)).reduce((n, s) => n + lzTargets(c, s).filter(t => !t.missing).length, 0);
  return {
    acts, files: lzFiles,
    res: lzFiles.reduce((n, f) => n + (f.content.match(/^resource\s+"/gm) || []).length, 0),
    newA: acts.filter(a => a.mode === 'create').length,
    existA: acts.filter(a => a.mode !== 'create').length,
    placed: acts.filter(a => a.mode !== 'reference' && a.ou && a.ou !== 'root' && lzOu(c, a.ou)).length,
    att,
  };
}
function lzSummaryHtml(c, checks) {
  const s = lzStats(c);
  const areas = ['Organization', 'OUs', 'Accounts', 'Placement', 'SCPs', 'Control Tower'];
  const lvl = a => { const it = checks.filter(i => i.area === a); return it.some(i => i.level === 'error') ? 'error' : it.some(i => i.level === 'warn') ? 'warn' : 'ok'; };
  const ctOn = lzCtOn(c);
  return `<p class="sec-title">Landing zone summary</p>
    <dl class="kv">
      <dt>Model</dt><dd>${esc(LZ_MODEL_INFO[c.model].label)}</dd>
      <dt>Control Tower</dt><dd>${c.model === 'enterprise' ? (ctOn ? `<span style="color:var(--ok)">✓ ${c.ct.mode === 'existing' ? 'Existing' : 'Enabled'}</span>` : 'Off') : '<span style="color:var(--muted);font-weight:400">Not selected</span>'}</dd>
      <dt>Organization</dt><dd><span style="color:var(--ok)">✓</span> ${{ create: 'Create', import: 'Import', existing: 'Existing' }[c.org.mode]}</dd>
      <dt>Organizational units</dt><dd>${c.ous.length}</dd>
      <dt>Accounts (incl. management)</dt><dd>${s.acts.length + 1}</dd>
      <dt>New accounts</dt><dd>${s.newA}</dd>
      <dt>Existing accounts</dt><dd>${s.existA + 1}</dd>
      <dt>Account placements</dt><dd>${s.placed}</dd>
      <dt>SCPs</dt><dd>${c.scps.length}</dd>
      <dt>SCP attachments</dt><dd>${s.att}</dd>
      ${ctOn ? `<dt>Registered OUs</dt><dd>${c.ct.baselines.length}</dd><dt>Control Tower controls</dt><dd>${c.ct.controls.reduce((n, x) => n + x.ous.length, 0)}</dd>` : ''}
      <dt>Terraform resources</dt><dd>${s.res}</dd>
    </dl>
    <p class="sec-title" style="margin-top:12px">Validation</p>
    <ul class="foundation">${areas.filter(a => a !== 'Control Tower' || c.model === 'enterprise').map(a => { const l = lvl(a); return `<li><span class="mark ${l}" aria-hidden="true">${lzSym(l)}</span>${a === 'SCPs' ? 'SCP JSON and targets' : a}<span class="hint" style="margin-left:auto">${l === 'ok' ? 'valid' : l === 'warn' ? 'warning' : 'error'}</span></li>`; }).join('')}
      <li><span class="mark ${checks.some(i => i.level === 'error') ? 'error' : 'ok'}" aria-hidden="true">${checks.some(i => i.level === 'error') ? '✕' : '✓'}</span>Dependencies<span class="hint" style="margin-left:auto">${checks.some(i => i.level === 'error') ? 'missing' : 'resolved'}</span></li></ul>`;
}

/* ---------------- landing page ---------------- */
function lzLandingPage() {
  const capList = model => LZ_CAPS.filter(x => x.models === 'both' || x.models === model).map(x => `<li><span>${esc(x.name)}</span><code class="hint">${esc(x.res)}</code></li>`).join('');
  return `<div class="stack lz">
    <div class="panel intro lz-hero"><h2>AWS Landing Zone Builder</h2>
      <p class="lz-kicker">Enterprise &amp; Non-Enterprise · Multi-Account AWS Foundation</p>
      <p>Design a governed AWS multi-account environment, select your landing zone model, configure accounts and OUs, apply governance policies, and generate Terraform configuration.</p></div>
    <div class="lz-picks">
      <article class="panel lz-pick"><h3><span aria-hidden="true">🏢</span> Enterprise Landing Zone</h3>
        <ul><li>AWS Control Tower</li><li>AWS Organizations</li><li>Multi-account governance</li><li>OUs &amp; Account Factory</li><li>SCP governance</li></ul>
        <button class="btn primary" data-act="start" data-arg="enterprise">Select Enterprise</button></article>
      <article class="panel lz-pick"><h3><span aria-hidden="true">☁</span> Non-Enterprise Landing Zone</h3>
        <ul><li>AWS Organizations</li><li>OUs</li><li>AWS accounts</li><li>SCP governance</li></ul>
        <button class="btn primary" data-act="start" data-arg="non-enterprise">Select Non-Enterprise</button></article>
    </div>
    <div class="panel intro"><h2 style="font-size:15px">What each model includes</h2>
      <p>The two models include different capabilities. Neither is better in general: Control Tower adds AWS-managed governance, while the Organizations-only model keeps every piece in your own Terraform.</p>
      ${lzCompareTable()}</div>
    <div class="panel intro"><h2 style="font-size:15px">Landing Zone in the service catalog</h2>
      <div class="lz-cat"><div><p class="sec-title">Enterprise</p><ul class="lz-caps">${capList('enterprise')}</ul></div><div><p class="sec-title">Non-Enterprise</p><ul class="lz-caps">${capList('non-enterprise')}</ul></div></div>
      <p class="hint" style="margin-top:10px">Starter templates are also listed under "Start from an example" on the Services tab. <button class="btn sm ghost" data-act="learn" data-arg="What is a Landing Zone?">${IC.book} Learn AWS Landing Zones</button></p></div>
  </div>`;
}
function lzCompareTable() {
  return `<div class="lz-table-wrap"><table class="lz-table"><thead><tr><th scope="col">Capability</th><th scope="col">Enterprise</th><th scope="col">Non-Enterprise</th></tr></thead>
    <tbody>${LZ_COMPARE.map(r => `<tr><th scope="row">${esc(r[0])}</th><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')}</tbody></table></div>`;
}

/* ---------------- wizard ---------------- */
function renderLanding(m) {
  const c = lzC();
  if (!c || !c.model) {
    m.innerHTML = lzLandingPage();
    lzBind(m.firstElementChild, m);
    return;
  }
  if (lzStepOff(c, state.lzStep)) state.lzStep = 7;
  const checks = lzCheck(c, state.g);
  const i = state.lzStep;
  const stepChecks = checks.filter(x => x.step === i && x.level !== 'ok');
  m.innerHTML = `<div class="lz" data-lzroot>
    <div class="lz-top"><div><h2>${esc(LZ_MODEL_INFO[c.model].title)}</h2><p class="hint">${esc(LZ_MODEL_INFO[c.model].sub)}</p></div>
      <span class="grow"></span>
      <button class="btn sm ghost" data-act="learn" data-arg="What is a Landing Zone?">${IC.book} Learn</button>
      <button class="btn sm" data-act="go" data-arg="8">${IC.dl} Generate</button></div>
    <nav class="lz-steps" aria-label="Landing zone steps"><ol>${LZ_STEPS.map(([k, l], j) => {
      const off = lzStepOff(c, j);
      const err = checks.some(x => x.step === j && x.level === 'error');
      return `<li><button data-act="go" data-arg="${j}" ${j === i ? 'aria-current="step"' : ''} ${off ? 'disabled title="Control Tower is part of the Enterprise model"' : ''} class="${err ? 'has-err' : ''}"><span class="n">${j + 1}</span>${esc(l)}${off ? ' <small>(not selected)</small>' : ''}</button></li>`;
    }).join('')}</ol></nav>
    <div class="lz-body">
      <section class="panel lz-main" aria-labelledby="lzStepTitle">
        <h2 id="lzStepTitle" tabindex="-1">${i + 1}. ${esc(LZ_STEPS[i][1])}</h2>
        ${[lzStepType, lzStepOrg, lzStepOus, lzStepAccounts, lzStepPlacement, lzStepGov, lzStepCt, lzStepReview, lzStepGenerate][i](c, checks)}
        ${stepChecks.length && i !== 7 ? `<div class="lz-checks" role="status">${stepChecks.map(x => `<p class="callout ${x.level === 'error' || x.level === 'warn' ? 'warn' : ''}"><span class="mark ${x.level}" aria-hidden="true">${lzSym(x.level)}</span> ${esc(x.msg)}</p>`).join('')}</div>` : ''}
        <div class="lz-nav">
          <button class="btn" data-act="go" data-arg="${i - 1}" ${i === 0 ? 'disabled' : ''}>Back</button><span class="grow"></span>
          ${i < LZ_STEPS.length - 1 ? `<button class="btn primary" data-act="go" data-arg="${i + 1}">Next: ${esc(LZ_STEPS[lzStepOff(c, i + 1) ? i + 2 : i + 1][1])}</button>` : ''}
        </div>
      </section>
      <aside class="panel lz-side" id="lzSide" aria-label="Landing zone summary">${lzSummaryHtml(c, checks)}</aside>
    </div></div>`;
  lzBind(m.firstElementChild, m);
}
function lzRefreshSide() {
  const c = lzC(); const el = $('#lzSide');
  if (c && el) el.innerHTML = lzSummaryHtml(c, lzCheck(c, state.g));
}

/* Step 1: type */
function lzStepType(c) {
  const opt = (k) => `<label class="lz-radio ${c.model === k ? 'on' : ''}"><input type="radio" name="lzModel" data-act-change="model" value="${k}" ${c.model === k ? 'checked' : ''}><span><b>${esc(LZ_MODEL_INFO[k].label)}</b><br><span class="hint">${esc(LZ_MODEL_INFO[k].sub)}</span></span></label>`;
  return `<p class="hint">Landing zone model. Switching keeps your OUs, accounts and SCPs; Enterprise adds the Control Tower step and the Log Archive and Audit accounts it needs.</p>
    <div class="lz-radios">${opt('enterprise')}${opt('non-enterprise')}</div>
    ${lzCompareTable()}
    <div class="box note"><h3>Start again from a template</h3><p class="hint" style="margin-bottom:8px">Replaces OUs, accounts, SCPs and Control Tower settings with the starter template for the selected model. Templates are only a starting point.</p>
      <button class="btn sm" data-act="template">Load ${esc(LZ_MODEL_INFO[c.model].label)} starter template</button></div>`;
}

/* Step 2: organization */
function lzStepOrg(c) {
  const all = c.org.feature_set === 'ALL';
  return `<div class="form-grid">
    <p class="form-sec">AWS Organization</p>
    <div class="field wide"><span>How Terraform handles the organization</span><div class="seg" role="group" aria-label="Organization mode">${[['create', 'Create a new organization'], ['import', 'Import an existing one'], ['existing', 'Read existing (data source)']].map(([v, l]) => `<button data-act="set" data-path="org.mode" data-arg="${v}" aria-pressed="${c.org.mode === v}">${l}</button>`).join('')}</div>
      <p class="hint">${{ create: 'Creates aws_organizations_organization. The account you run Terraform in becomes the management account.', import: 'Adds an import block, so Terraform adopts the organization you already have and then manages its settings.', existing: 'Reads the organization with data.aws_organizations_organization. Terraform does not change its feature set, policy types or trusted access.' }[c.org.mode]}</p></div>
    ${c.org.mode === 'import' ? `<label class="field"><span>Organization ID</span>${lzTxt('org.id', c.org.id, 'placeholder="o-a1b2c3d4e5"')}<p class="hint">From aws organizations describe-organization.</p></label>` : ''}
    <label class="field"><span>Organization name (label)</span>${lzTxt('org.label', c.org.label)}<p class="hint">AWS Organizations has no name field. This becomes var.landing_zone_name, used as a LandingZone tag.</p></label>
    ${c.org.mode !== 'existing' ? `<label class="field"><span>Feature set</span>${lzSel('org.feature_set', c.org.feature_set, ['ALL', 'CONSOLIDATED_BILLING'])}<p class="hint">ALL is needed for SCPs, trusted access and Control Tower.</p></label>
    <div class="field wide">${lzChk('org.scp', c.org.scp && all, 'Enable Service Control Policies (enabled_policy_types)', all ? '' : 'disabled')}
      ${lzChk('org.trusted', c.org.trusted && all, 'Enable trusted access for AWS services', all ? '' : 'disabled')}
      ${lzChk('org.protect', c.org.protect, 'Protect the organization with prevent_destroy')}</div>
    ${all && c.org.trusted ? `<div class="field wide"><span>Trusted service principals</span><div class="multi">${LZ_PRINCIPALS.map(p => `<label class="chk"><input type="checkbox" data-lz="org.principals" data-t="multi" value="${p}" ${c.org.principals.includes(p) ? 'checked' : ''}><code>${p}</code></label>`).join('')}</div>
      ${lzCtOn(c) ? '<p class="hint">Control Tower enables trusted access for the services it integrates, so the generated organization ignores later changes to this list.</p>' : ''}</div>` : ''}` : ''}
    <p class="form-sec">Management account</p>
    <label class="field"><span>Account name</span>${lzTxt('mgmt.name', c.mgmt.name)}</label>
    <label class="field"><span>Environment</span>${lzSel('mgmt.env', c.mgmt.env, LZ_ENVS)}</label>
    <label class="field wide"><span>Contact email</span>${lzTxt('mgmt.email', c.mgmt.email, 'type="email"')}<p class="hint">Documentation only. The management account already exists: it is the account whose credentials run Terraform.</p></label>
    <p class="callout">No credentials, access keys, passwords or root credentials are generated. Terraform uses your AWS credential chain (IAM Identity Center or a role) in the management account. New member accounts get no root password: use password recovery or centralized root access.</p>
  </div>`;
}

/* Step 3: OUs */
function lzStepOus(c) {
  const rows = [];
  const walk = (parent, depth) => {
    for (const o of c.ous.filter(x => x.parent === parent)) {
      const i = c.ous.indexOf(o);
      rows.push(`<li class="lz-ou-row" style="--d:${depth}">
        <div class="lz-ou-fields">
          <label class="field"><span>OU name</span>${lzTxt(`ous.${i}.name`, o.name)}</label>
          <label class="field"><span>Parent</span><select class="inp" data-lz="ous.${i}.parent" data-t="sel">${lzOuOpts(c, o.parent, { exclude: o.key })}</select></label>
          <label class="field"><span>Description</span>${lzTxt(`ous.${i}.desc`, o.desc)}</label>
        </div>
        <div class="lz-row-act"><button class="btn sm ghost" data-act="addChild" data-arg="${esc(o.key)}" title="Add a child OU">+ Child</button><button class="icon-btn" data-act="delOu" data-arg="${esc(o.key)}" aria-label="Remove OU ${esc(o.name)}">${IC.x}</button></div></li>`);
      walk(o.key, depth + 1);
    }
  };
  walk('root', 0);
  const orphans = c.ous.filter(o => o.parent !== 'root' && !lzOu(c, o.parent));
  return `<p class="hint">Root is created with the organization. Nested OUs reference their parent, so Terraform creates parents first. Rename, move, remove or add OUs freely: no structure is forced.</p>
    <ul class="lz-ous" aria-label="OU hierarchy"><li class="lz-ou-root"><b>Root</b> <span class="hint">management account lives here</span></li>${rows.join('')}${orphans.map(o => `<li class="hint">"${esc(o.name)}" has a missing parent. Pick a new parent above.</li>`).join('')}</ul>
    <div class="box"><h3>Add OU</h3><div class="form-grid">
      <label class="field"><span>OU name</span><input class="inp" id="lzNewOuName" placeholder="Production" spellcheck="false"></label>
      <label class="field"><span>Parent</span><select class="inp" id="lzNewOuParent">${lzOuOpts(c, 'root')}</select></label>
      <label class="field wide"><span>Description</span><input class="inp" id="lzNewOuDesc" placeholder="Production workload accounts"></label></div>
      <button class="btn sm primary" data-act="addOu" style="margin-top:10px">+ Add OU</button></div>
    <div class="box note"><h3>Default OUs</h3><p class="hint" style="margin-bottom:8px">${c.model === 'enterprise' ? 'Enterprise starter: Security, Infrastructure, Workloads (Production, Non-Production), Sandbox, Suspended.' : 'Non-Enterprise starter: Security, Infrastructure, Production, Non-Production, Sandbox.'} Accounts in removed OUs move to the root.</p>
      <button class="btn sm" data-act="defaultOus">Replace OUs with the starter set</button></div>`;
}

/* Step 4: accounts */
function lzStepAccounts(c, checks) {
  const core = LZ_CORE[c.model];
  const ctOn = lzCtOn(c);
  const modeSel = (i, a) => `<label class="field"><span>Provisioning</span>${lzSel(`accounts.${i}.mode`, a.mode, [['create', 'Create with Terraform'], ['import', 'Existing: import and move'], ['reference', 'Existing: reference only']])}</label>`;
  const idField = (i, a) => a.mode !== 'create' ? `<label class="field"><span>Account ID</span>${lzTxt(`accounts.${i}.id`, a.id, 'inputmode="numeric" placeholder="123456789012" maxlength="12"')}</label>` : '';
  const coreRows = core.map(d => {
    const i = c.accounts.findIndex(a => a.core === d.core);
    const a = c.accounts[i];
    const req = d.need === 'Required' && !ctOn ? 'Recommended' : d.need;
    return `<li class="lz-core ${a && a.enabled !== false ? 'on' : ''}">
      <div class="lz-core-head"><label class="chk"><input type="checkbox" data-act-change="core" value="${d.core}" ${a && a.enabled !== false ? 'checked' : ''}>${esc(a ? a.name : d.name)}</label>
        <span class="pill lz-need ${LZ_NEED_CLS[req]}">${req}</span></div>
      <p class="hint">${esc(d.why)}</p>
      ${a && a.enabled !== false ? `<div class="form-grid lz-acct-grid">
        <label class="field"><span>Account name</span>${lzTxt(`accounts.${i}.name`, a.name)}</label>
        <label class="field"><span>Account email</span>${lzTxt(`accounts.${i}.email`, a.email, 'type="email"')}</label>
        ${c.acct.strategy === 'mixed' || a.mode !== 'create' ? modeSel(i, a) : ''}${idField(i, a)}</div>` : ''}</li>`;
  }).join('');
  const custom = c.accounts.map((a, i) => [a, i]).filter(([a]) => !a.core);
  return `<p class="callout warn"><b>Account creation:</b> AWS account creation requires Organizations permissions in the management account and a unique email address per account. Emails are placeholders in variables; nothing secret is generated.</p>
    <div class="field"><span>Account provisioning</span><div class="seg" role="group" aria-label="Account provisioning">${[['create', 'Create accounts using Terraform'], ['existing', 'Reference existing AWS accounts'], ['mixed', 'Mixed']].map(([v, l]) => `<button data-act="strategy" data-arg="${v}" aria-pressed="${(c.acct.strategy || 'create') === v}">${l}</button>`).join('')}</div>
      <p class="hint">${{ create: 'Every account is created with aws_organizations_account.', existing: 'Accounts are existing ones: import them to move them into OUs, or reference them by ID only. Nothing is recreated.', mixed: 'Choose per account: create, import and move, or reference only.' }[c.acct.strategy || 'create']}</p></div>
    <h3 class="lz-h3">Default / core accounts</h3>
    <ul class="lz-cores"><li class="lz-core on"><div class="lz-core-head"><span class="chk"><input type="checkbox" checked disabled aria-label="Management account is always present">${esc(c.mgmt.name)} (management)</span><span class="pill lz-need error">Required</span></div><p class="hint">Already exists: it owns the organization. Not created, moved or restricted by SCPs.</p></li>${coreRows}</ul>
    <p class="hint">Required = needed by the selected architecture (Control Tower needs Log Archive and Audit). Recommended = AWS multi-account guidance. Optional = add when you need it.</p>
    <h3 class="lz-h3">Custom accounts <span class="hint">(${custom.length})</span></h3>
    <ol class="lz-accts">${custom.map(([a, i]) => `<li class="panel lz-acct">
      <div class="lz-acct-head"><b>${esc(a.name || 'New account')}</b> <span class="pill">${esc(lzStatus(c, a, checks)[0])}</span><span class="grow"></span><button class="icon-btn" data-act="delAcct" data-arg="${esc(a.key)}" aria-label="Remove account ${esc(a.name)}">${IC.x}</button></div>
      <div class="form-grid lz-acct-grid">
        <label class="field"><span>Account name</span>${lzTxt(`accounts.${i}.name`, a.name, 'maxlength="50"')}</label>
        ${a.mode !== 'reference' ? `<label class="field"><span>Account email</span>${lzTxt(`accounts.${i}.email`, a.email, 'type="email"')}</label>` : ''}
        <label class="field"><span>Account type</span>${lzSel(`accounts.${i}.type`, a.type, LZ_ACCT_TYPES)}</label>
        <label class="field"><span>Environment</span>${lzSel(`accounts.${i}.env`, a.env, LZ_ENVS)}</label>
        <label class="field"><span>Parent OU</span><select class="inp" data-lz="accounts.${i}.ou" data-t="sel">${lzOuOpts(c, a.ou)}</select></label>
        ${c.acct.strategy === 'mixed' ? modeSel(i, a) : ''}${idField(i, a)}
        <label class="field wide"><span>Tags (one Key = Value per line)</span><textarea class="inp mono" rows="3" data-lz="accounts.${i}.tags" data-t="tags" spellcheck="false">${esc(lzTagsText(a.tags))}</textarea></label>
        ${ctOn && a.mode === 'create' ? `<div class="field wide">${lzChk(`accounts.${i}.factory`, a.factory, 'Create through Control Tower Account Factory instead of aws_organizations_account')}</div>` : ''}
        ${lzFactory(c, a) ? `<label class="field"><span>IAM Identity Center user email (optional)</span>${lzTxt(`accounts.${i}.sso.email`, a.sso.email, 'type="email"')}</label>
          <label class="field"><span>First name</span>${lzTxt(`accounts.${i}.sso.first`, a.sso.first)}</label><label class="field"><span>Last name</span>${lzTxt(`accounts.${i}.sso.last`, a.sso.last)}</label>` : ''}
      </div></li>`).join('')}</ol>
    <button class="btn sm primary" data-act="addAcct">+ Add custom account</button>
    <div class="box" style="margin-top:14px"><h3>Settings for created accounts</h3><div class="form-grid">
      <label class="field"><span>Account access role (role_name)</span>${lzTxt('acct.role_name', c.acct.role_name)}<p class="hint">${c.model === 'enterprise' ? 'AWSControlTowerExecution lets Control Tower enroll the account when its OU is registered.' : 'Organizations creates this admin role in each new account, trusted by the management account.'}</p></label>
      <label class="field"><span>IAM access to billing</span>${lzSel('acct.billing', c.acct.billing, ['ALLOW', 'DENY'])}<p class="hint">Changing it after creation recreates the account, so choose now.</p></label>
      <div class="field wide">${lzChk('acct.protect', c.acct.protect, 'Protect accounts with prevent_destroy')}${lzChk('acct.close_on_deletion', c.acct.close_on_deletion, 'Close accounts when removed from Terraform (close_on_deletion)')}
        <p class="hint">Without close_on_deletion, removing an account from Terraform only removes it from the organization.</p></div></div></div>`;
}

/* Step 5: placement */
function lzStepPlacement(c, checks) {
  const acts = lzActiveAccounts(c);
  const chip = a => `<span class="lz-chip ${a.mode === 'reference' ? 'ref' : ''}" ${a.mode !== 'reference' ? `draggable="true" data-drag="${esc(a.key)}"` : ''} title="${a.mode === 'reference' ? 'Referenced only: switch it to import to move it' : 'Drag to another OU'}">${esc(a.name)}<small>${esc(lzStatus(c, a, checks)[0])}</small></span>`;
  const scpBadges = t => c.scps.filter(s => s.enabled !== false && (s.targets || []).includes(t)).map(s => `<span class="lz-scp">SCP: ${esc(s.name)}</span>`).join('');
  const node = key => {
    const o = lzOu(c, key);
    const kids = c.ous.filter(x => x.parent === key);
    const here = acts.filter(a => (a.ou || 'root') === key && a.mode !== 'reference');
    const reg = lzCtOn(c) && c.ct.baselines.includes(key);
    return `<li><div class="lz-drop" data-drop="${esc(key)}" aria-label="${esc(o.name)} OU"><div class="lz-drop-head"><b>${esc(o.name)}</b>${reg ? '<span class="lz-ct">Control Tower</span>' : ''}${scpBadges('ou:' + key)}</div>
      <div class="lz-chips">${here.map(chip).join('') || '<span class="hint">No accounts</span>'}</div></div>
      ${kids.length ? `<ul>${kids.map(k => node(k.key)).join('')}</ul>` : ''}</li>`;
  };
  const rootAccts = acts.filter(a => (!a.ou || a.ou === 'root' || !lzOu(c, a.ou)) && a.mode !== 'reference');
  const refs = acts.filter(a => a.mode === 'reference');
  return `<p class="hint">Drag an account onto an OU, or use the form below. Placement is the parent_id argument of aws_organizations_account; Terraform moves the account when parent_id changes.</p>
    <div class="lz-tree" data-dnd>
      <div class="lz-drop root" data-drop="root"><div class="lz-drop-head"><b>AWS Organization (Root)</b>${scpBadges('root')}</div>
        <div class="lz-chips"><span class="lz-chip mgmt">${esc(c.mgmt.name)}<small>Management · Existing</small></span>${rootAccts.map(chip).join('')}</div></div>
      <ul>${c.ous.filter(o => o.parent === 'root').map(o => node(o.key)).join('')}</ul></div>
    ${refs.length ? `<p class="hint">Referenced only (not managed, not moved): ${refs.map(a => esc(a.name)).join(', ')}.</p>` : ''}
    <div class="box"><h3>Move account</h3><div class="form-grid">
      <label class="field"><span>Account</span><select class="inp" id="lzMoveAcct">${acts.filter(a => a.mode !== 'reference').map(a => `<option value="${esc(a.key)}">${esc(a.name)}</option>`).join('')}</select></label>
      <label class="field"><span>Target OU</span><select class="inp" id="lzMoveOu">${lzOuOpts(c, 'root')}</select></label></div>
      <button class="btn sm primary" data-act="move" style="margin-top:10px">Move account</button></div>
    <h3 class="lz-h3">Account onboarding status</h3>
    <div class="lz-table-wrap"><table class="lz-table"><thead><tr><th scope="col">Account</th><th scope="col">Target</th><th scope="col">Status</th></tr></thead><tbody>
      <tr><th scope="row">${esc(c.mgmt.name)}</th><td>Root</td><td><span class="mark ok">✓</span> Existing</td></tr>
      ${acts.map(a => { const [st, l] = lzStatus(c, a, checks); return `<tr><th scope="row">${esc(a.name)}</th><td>${a.mode === 'reference' ? '<span class="hint">not managed</span>' : esc(lzOuPath(c, a.ou))}</td><td><span class="mark ${l}" aria-hidden="true">${lzSym(l)}</span> ${esc(st)}</td></tr>`; }).join('')}
    </tbody></table></div>`;
}

/* Step 6: governance / SCPs */
function lzStepGov(c) {
  const tOpts = (s, si) => {
    const on = new Set(s.targets || []);
    const box = (t, label, depth = 0, extra = '') => `<label class="chk" style="padding-left:${depth * 16}px"><input type="checkbox" data-lz="scps.${si}.targets" data-t="multi" value="${esc(t)}" ${on.has(t) ? 'checked' : ''} ${extra}>${label}</label>`;
    return `<div class="lz-targets"><div><p class="sec-title">Root and OUs</p>${box('root', 'Root <span class="hint">(every member account)</span>')}${(function walk(p, d) { return c.ous.filter(o => o.parent === p).map(o => box('ou:' + o.key, esc(o.name) + ' OU', d) + walk(o.key, d + 1)).join(''); })('root', 1)}</div>
      <div><p class="sec-title">Accounts</p>${lzActiveAccounts(c).map(a => box('acct:' + a.key, esc(a.name), 0, lzFactory(c, a) ? 'disabled title="Account Factory accounts are targeted through their OU"' : '')).join('') || '<span class="hint">No accounts</span>'}</div></div>`;
  };
  const tplFields = (s, si) => {
    if (s.template === 'region') return `<div class="field wide"><span>Allowed Regions</span><div class="multi">${REGIONS.map(r => `<label class="chk"><input type="checkbox" data-lz="scps.${si}.regions" data-t="multi" value="${r}" ${(s.regions || []).includes(r) ? 'checked' : ''}>${r}</label>`).join('')}</div></div>`;
    if (s.template === 'security') return `<div class="field wide"><span>Protected services</span><div class="multi">${Object.keys(SCP_SECURITY_ACTIONS).map(k => `<label class="chk"><input type="checkbox" data-lz="scps.${si}.services" data-t="csvmulti" value="${k}" ${csv(s.services).includes(k) ? 'checked' : ''}>${k}</label>`).join('')}</div></div>`;
    if (s.template === 'logging') return `<label class="field wide"><span>Protected CloudTrail trail ARNs (comma separated)</span>${lzTxt(`scps.${si}.trails`, s.trails)}</label><label class="field wide"><span>Protected log group ARN patterns (comma separated)</span>${lzTxt(`scps.${si}.log_groups`, s.log_groups)}</label>`;
    if (s.template === 'encryption') return `<div class="field wide">${lzChk(`scps.${si}.enc_ebs`, s.enc_ebs, 'Deny turning off EBS encryption by default (ec2:DisableEbsEncryptionByDefault)')}${lzChk(`scps.${si}.enc_s3`, s.enc_s3, 'Deny S3 uploads without an x-amz-server-side-encryption header')}<p class="hint">S3 encrypts new objects by default; the header rule also blocks clients that rely on that default, so test it first.</p></div>`;
    return '';
  };
  const scpCard = (s, si) => {
    const doc = scpPolicy(s);
    const size = doc ? scpSize(doc) : 0;
    const usesExempt = s.mode === 'template' && ['region', 'security', 'logging', 'encryption'].includes(s.template);
    return `<li class="panel lz-scpcard">
      <div class="lz-acct-head"><b>${esc(s.name)}</b><span class="pill">${s.mode === 'json' ? 'JSON' : esc(SCP_TEMPLATES[s.template].name)}</span><span class="pill ${s.enabled === false ? '' : 'ok-pill'}">${s.enabled === false ? 'Disabled' : 'Enabled'}</span><span class="grow"></span><button class="icon-btn" data-act="delScp" data-arg="${esc(s.key)}" aria-label="Delete SCP ${esc(s.name)}">${IC.x}</button></div>
      <div class="form-grid">
        <label class="field"><span>Policy name</span>${lzTxt(`scps.${si}.name`, s.name, 'maxlength="128"')}</label>
        <label class="field"><span>Policy mode</span>${lzSel(`scps.${si}.enabled`, s.enabled === false ? 'false' : 'true', [['true', 'Enabled (attached)'], ['false', 'Disabled (created, not attached)']])}</label>
        <label class="field wide"><span>Description</span>${lzTxt(`scps.${si}.desc`, s.desc, 'maxlength="512"')}</label>
        <div class="field wide"><span>Builder</span><div class="seg" role="group" aria-label="SCP builder mode"><button data-act="scpMode" data-arg="${si}:template" aria-pressed="${s.mode === 'template'}">Template mode</button><button data-act="scpMode" data-arg="${si}:json" aria-pressed="${s.mode === 'json'}">JSON policy mode</button></div></div>
        ${s.mode === 'template' ? `<label class="field"><span>Policy type</span>${lzSel(`scps.${si}.template`, s.template, Object.keys(SCP_TEMPLATES).filter(k => k !== 'custom').map(k => [k, SCP_TEMPLATES[k].name]))}</label>
          ${usesExempt ? `<label class="field"><span>Exempt principal ARNs (comma separated)</span>${lzTxt(`scps.${si}.exempt`, s.exempt, 'placeholder="arn:aws:iam::*:role/BreakGlass"')}</label>` : ''}
          <p class="hint wide" style="grid-column:1/-1">${esc(SCP_TEMPLATES[s.template].desc)}</p>
          ${tplFields(s, si)}
          <details class="wide" style="grid-column:1/-1"><summary class="hint" style="cursor:pointer">Generated JSON (${size} of 5,120 characters)</summary><pre class="snippet code">${esc(JSON.stringify(doc, null, 2))}</pre></details>`
        : `<label class="field wide"><span>Policy JSON</span><textarea class="inp mono lz-json" rows="12" data-lz="scps.${si}.json" data-t="json" data-key="${esc(s.key)}" spellcheck="false">${esc(s.json)}</textarea>
          <p class="hint" data-jsonstat="${esc(s.key)}">${lzJsonStatus(s)}</p></label>`}
        <div class="field wide"><span>Attach to</span>${tOpts(s, si)}</div>
      </div></li>`;
  };
  return `<p class="callout warn"><b>SCP warning:</b> an SCP establishes permission boundaries for accounts and OUs. It does not grant permissions; IAM policies are still required to grant them. SCPs never restrict the management account.</p>
    <div class="box note"><h3>Create SCP</h3><p class="hint" style="margin-bottom:8px">Templates are educational starting points from AWS's published examples. Nothing is attached until you pick targets.</p>
      <div class="lz-tpl">${Object.entries(SCP_TEMPLATES).map(([k, t]) => `<button class="btn sm" data-act="addScp" data-arg="${k}" title="${esc(t.desc)}">+ ${esc(t.name)}</button>`).join('')}</div></div>
    ${c.scps.length ? `<ul class="lz-scps">${c.scps.map(scpCard).join('')}</ul>` : '<p class="hint">No SCPs yet. The organization keeps only the default FullAWSAccess policy.</p>'}
    ${c.scps.length ? `<h3 class="lz-h3">Where policies apply</h3>${lzScpHierarchy(c)}
      <p class="hint">SCPs are inherited: a policy on an OU affects every OU and account below it. A request is allowed only if every SCP from the root down to the account allows it and none denies it. Each root, OU or account can have at most 5 SCPs, including FullAWSAccess.</p>` : ''}`;
}
function lzJsonStatus(s) {
  let doc;
  try { doc = JSON.parse(s.json); } catch (e) { return `<span style="color:var(--err)">✕ Invalid JSON: ${esc(e.message)}</span>`; }
  const issues = [];
  if (doc.Version !== '2012-10-17') issues.push('Version must be "2012-10-17"');
  if (!doc.Statement || (Array.isArray(doc.Statement) && !doc.Statement.length)) issues.push('add at least one Statement');
  const size = JSON.stringify(doc).length;
  if (size > 5120) issues.push(`${size} characters is over the 5,120 limit`);
  return issues.length ? `<span style="color:var(--warn)">! ${esc(issues.join('; '))}</span>` : `<span style="color:var(--ok)">✓ Valid JSON, ${size} of 5,120 characters</span>`;
}
function lzScpHierarchy(c) {
  const on = t => c.scps.filter(s => s.enabled !== false && (s.targets || []).includes(t)).map(s => s.name);
  const line = (label, t, pre) => { const n = on(t); return `${pre}${label}${n.length ? '  ← SCP: ' + n.join(', ') : ''}`; };
  const out = [line('Root', 'root', '')];
  const walk = (p, pre) => {
    const kids = c.ous.filter(o => o.parent === p);
    kids.forEach((o, i) => {
      const last = i === kids.length - 1;
      out.push(line(o.name, 'ou:' + o.key, pre + (last ? '└── ' : '├── ')));
      const np = pre + (last ? '    ' : '│   ');
      for (const a of lzActiveAccounts(c).filter(a => a.ou === o.key && on('acct:' + a.key).length)) out.push(line(a.name + ' (account)', 'acct:' + a.key, np + '• '));
      walk(o.key, np);
    });
  };
  walk('root', ' ');
  return `<pre class="snippet code lz-ascii">${esc(out.join('\n'))}</pre>`;
}

/* Step 7: Control Tower */
function lzStepCt(c) {
  const ct = c.ct;
  const acts = lzActiveAccounts(c);
  const log = acts.find(a => a.core === 'log_archive');
  const secOu = log ? lzTopOu(c, log.ou) : null;
  const ctlOus = c.ous.filter(o => ct.baselines.includes(o.key) || o.key === secOu);
  const tfManaged = ['aws_organizations_organization', 'aws_organizations_organizational_unit', 'aws_organizations_account', 'aws_organizations_policy (customer SCPs)', 'aws_iam_role x3 (Control Tower service roles)', 'aws_controltower_landing_zone', 'aws_controltower_baseline (OU registration)', 'aws_controltower_control', 'aws_servicecatalog_provisioned_product (Account Factory)'];
  const ctManaged = ['Organization CloudTrail trail and log buckets', 'AWS Config recorders and the organization aggregator', 'IAM Identity Center setup and permission sets', 'StackSets in every enrolled account', 'Mandatory controls and the SCPs behind controls', 'Drift detection and landing zone repair (reset)', 'Account Factory network settings and blueprints'];
  const byCat = CT_CATS.map(cat => [cat, CT_CONTROLS.filter(x => x.cat === cat)]);
  const ctlEntry = id => ct.controls.find(x => x.id === id);
  return `<p class="callout warn"><b>Control Tower:</b> some Control Tower operations are managed through Control Tower itself and have no direct Terraform AWS Provider equivalent. They are listed below, not generated as Terraform.</p>
    <div class="lz-gov"><div class="lz-flow" aria-label="Control Tower governance model"><span class="st">AWS Organizations</span><span aria-hidden="true">▼</span><span class="st ct">AWS Control Tower</span><span aria-hidden="true">▼</span>
      <div class="lz-fan"><span>Landing zone</span><span>Controls</span><span>OUs</span><span>Account Factory</span><span>Account governance</span></div></div>
      <div class="lz-split"><div class="box"><h3><span class="source-tag gen">Terraform-managed resources</span></h3><ul>${tfManaged.map(x => `<li><code>${esc(x)}</code></li>`).join('')}</ul></div>
        <div class="box note"><h3><span class="source-tag asm">Control Tower-managed capabilities</span></h3><ul>${ctManaged.map(x => `<li>${esc(x)}</li>`).join('')}</ul><p class="hint" style="margin-top:6px">Terraform provider support: not directly supported. Use the Control Tower console or APIs.</p></div></div></div>
    <div class="form-grid">
      <p class="form-sec">Landing zone</p>
      <div class="field wide">${lzChk('ct.enabled', ct.enabled, 'Enable Control Tower')}</div>
      ${ct.enabled ? `<div class="field wide"><span>Landing zone</span><div class="seg" role="group" aria-label="Landing zone setup">${[['create', 'Set up with Terraform'], ['existing', 'Already set up (manage OUs, controls, Account Factory only)']].map(([v, l]) => `<button data-act="set" data-path="ct.mode" data-arg="${v}" aria-pressed="${ct.mode === v}">${l}</button>`).join('')}</div></div>
      <label class="field"><span>Home Region</span><input class="inp" value="${esc(state.g.region)}" disabled><p class="hint">The provider region (var.aws_region). Change it in the project summary panel.</p></label>
      ${ct.mode === 'create' ? `<label class="field"><span>Landing zone version</span>${lzTxt('ct.version', ct.version)}<p class="hint">4.0 is the latest version documented when this studio was built. The manifest uses the 4.0 format.</p></label>
      <div class="field wide"><span>Governed Regions</span><div class="multi">${REGIONS.map(r => `<label class="chk"><input type="checkbox" data-lz="ct.regions" data-t="multi" value="${r}" ${ct.regions.includes(r) ? 'checked' : ''}>${r}</label>`).join('')}</div></div>
      <label class="field"><span>Log retention (days)</span><input class="inp" type="number" min="1" data-lz="ct.log_days" data-t="num" value="${esc(ct.log_days)}"></label>
      <label class="field"><span>Access log retention (days)</span><input class="inp" type="number" min="1" data-lz="ct.access_days" data-t="num" value="${esc(ct.access_days)}"></label>
      <div class="field wide"><span>Governance integrations</span>${lzChk('ct.config', ct.config, 'AWS Config integration (aggregator in the Audit account)')}${lzChk('ct.security_roles', ct.security_roles, 'Security roles in the Audit account')}${lzChk('ct.access_mgmt', ct.access_mgmt, 'IAM Identity Center access management')}${lzChk('ct.kms', ct.kms, 'Encrypt logs with a customer managed KMS key (variable)')}${lzChk('ct.roles', ct.roles, 'Create the Control Tower service roles (AWSControlTowerAdmin, CloudTrail, StackSet)')}
        <p class="hint">AWS Backup integration stays off: it needs separate backup administrator and central backup accounts.</p></div>` : ''}
      <p class="form-sec">OU registration (account enrollment)</p>
      <div class="field wide"><p class="hint">Registering an OU enables AWSControlTowerBaseline on it, which enrolls its accounts. ${secOu ? `"${esc(lzOu(c, secOu).name)}" holds the Log Archive and Audit accounts and is governed by the landing zone itself.` : ''}</p>
        <div class="multi">${lzOuOrder(c).filter(o => o.key !== secOu).map(o => `<label class="chk"><input type="checkbox" data-lz="ct.baselines" data-t="multi" value="${esc(o.key)}" ${ct.baselines.includes(o.key) ? 'checked' : ''}>${esc(lzOuPath(c, o.key).replace(/^Root \/ /, ''))}</label>`).join('')}</div></div>
      <label class="field"><span>Baseline version</span>${lzTxt('ct.baseline_version', ct.baseline_version)}<p class="hint">5.0 is the AWSControlTowerBaseline version for landing zone 4.0.</p></label>` : ''}
    </div>
    ${ct.enabled ? `<h3 class="lz-h3">Control Tower controls</h3>
      <div class="lz-split lz-kinds"><div class="box"><h3>Customer SCP</h3><p class="hint">You write it (Governance step). aws_organizations_policy. You own every statement.</p></div>
        <div class="box"><h3>Control Tower SCP-based control</h3><p class="hint">Preventive. Control Tower owns and attaches the SCP. aws_controltower_control.</p></div>
        <div class="box"><h3>AWS Config-based control</h3><p class="hint">Detective. Control Tower deploys an AWS Config rule that reports, never blocks. aws_controltower_control.</p></div></div>
      <p class="hint">Controls can target only registered OUs. Identifiers are the documented Regional identifiers, combined with the home Region.</p>
      ${byCat.map(([cat, list]) => `<details class="topic" ${list.some(x => ctlEntry(x.id)) ? 'open' : ''}><summary>${esc(cat)} <span class="hint">${list.filter(x => ctlEntry(x.id)).length}/${list.length} enabled</span></summary><div class="tb">
        ${list.map(x => { const e = ctlEntry(x.id); const tAccts = e ? lzActiveAccounts(c).filter(a => e.ous.some(k => lzUnder(c, a.ou, k))).map(a => a.name) : []; return `<div class="lz-ctl">
          <div><b>${esc(x.name)}</b><br><code class="hint">${esc(x.id)}</code></div>
          <dl class="lz-ctl-meta"><dt>Control type</dt><dd>${esc(x.beh)} · ${esc(x.guid)}</dd><dt>Purpose</dt><dd>${esc(x.purpose)}</dd><dt>Implementation</dt><dd>${x.impl === 'SCP' ? 'SCP-based control (owned by Control Tower)' : 'AWS Config-based control'}</dd><dt>Terraform support</dt><dd><code>aws_controltower_control</code> ✓</dd>
            <dt>Target OUs</dt><dd><div class="multi">${ctlOus.length ? ctlOus.map(o => `<label class="chk"><input type="checkbox" data-t="ctl" data-id="${esc(x.id)}" value="${esc(o.key)}" ${e && e.ous.includes(o.key) ? 'checked' : ''}>${esc(o.name)}</label>`).join('') : '<span class="hint">Register an OU first</span>'}</div></dd>
            <dt>Target accounts</dt><dd>${tAccts.length ? esc(tAccts.join(', ')) : '<span class="hint">none yet</span>'}</dd></dl></div>`; }).join('')}</div></details>`).join('')}
      <h3 class="lz-h3">Account Factory</h3>
      <p class="hint">Tick "Create through Control Tower Account Factory" on a custom account in the Accounts step. It is then provisioned with aws_servicecatalog_provisioned_product into a registered OU.</p>
      ${acts.filter(a => lzFactory(c, a)).length ? `<ul class="foundation">${acts.filter(a => lzFactory(c, a)).map(a => `<li><span class="mark ok">✓</span>${esc(a.name)}<span class="hint" style="margin-left:auto">${esc(lzOuPath(c, a.ou))}</span></li>`).join('')}</ul>` : '<p class="hint">No accounts use Account Factory yet.</p>'}
      <p class="callout">ℹ Network configuration (Default / Custom VPC for new accounts) and Account Factory customization require Control Tower Account Factory settings or an additional provisioning workflow. They are not generated as Terraform.</p>` : ''}`;
}

/* Step 8: review */
function lzStepReview(c, checks) {
  const ent = c.model === 'enterprise', ctOn = lzCtOn(c);
  const s = lzStats(c);
  const errs = checks.filter(x => x.level === 'error'), warns = checks.filter(x => x.level === 'warn'), infos = checks.filter(x => x.level === 'info');
  const has = t => s.files.some(f => new RegExp(`^resource\\s+"${t}"`, 'm').test(f.content));
  const chain = ent && ctOn ? [
    ['Organization', c.org.mode !== 'existing' ? has('aws_organizations_organization') : true, 'Organization'],
    ['Control Tower', c.ct.mode === 'existing' || has('aws_controltower_landing_zone'), 'Control Tower'],
    ['Landing zone', c.ct.mode === 'existing' || has('aws_controltower_landing_zone'), 'Control Tower'],
    ['Governed OUs', has('aws_controltower_baseline') || !c.ct.baselines.length, 'OUs'],
    ['Account Factory / enrollment', true, 'Accounts'],
  ] : [
    ['Organization', true, 'Organization'], ['Root', true, 'Organization'], ['OUs', c.ous.length > 0, 'OUs'], ['Accounts', s.acts.length > 0, 'Accounts'],
    ['Account placement', s.placed > 0, 'Placement'], ['SCPs', c.scps.length > 0, 'SCPs'], ['SCP attachments', s.att > 0, 'SCPs'],
  ];
  const others = SERVICES.filter(x => x.id !== LZ_ID && isSel(x.id));
  return `<div class="lz-split">
      <div class="box"><h3>Deployment model</h3><ul class="foundation">${[['Control Tower', ctOn], ['Organizations', true], ['OUs', c.ous.length > 0], ['Accounts', s.acts.length > 0], ['SCPs', c.scps.length > 0]].map(([l, on]) => `<li><span class="mark ${on ? 'ok' : 'off'}" aria-hidden="true">${on ? '✓' : '✕'}</span>${l}</li>`).join('')}</ul>
        <p class="hint" style="margin-top:6px">${esc(LZ_MODEL_INFO[c.model].title)}${ent && !ctOn ? ' with Control Tower turned off' : ''}.</p></div>
      <div class="box"><h3>Dependencies</h3><ol class="lz-chain">${chain.map(([l, ok, area]) => { const bad = checks.some(x => x.area === area && x.level === 'error'); return `<li><span class="mark ${bad ? 'error' : ok ? 'ok' : 'off'}" aria-hidden="true">${bad ? '✕' : ok ? '✓' : ''}</span>${esc(l)}${!ok && !bad ? ' <span class="hint">(none)</span>' : ''}</li>`; }).join('')}</ol></div></div>
    <h3 class="lz-h3">Validation</h3>
    <ul class="lz-val">${[...errs, ...warns, ...infos].map(x => `<li><span class="mark ${x.level}" aria-hidden="true">${lzSym(x.level)}</span><span><b>${esc(x.area)}:</b> ${esc(x.msg)}</span>${x.step != null && x.step < 7 ? `<button class="btn sm ghost" data-act="go" data-arg="${x.step}">Fix</button>` : ''}</li>`).join('') || '<li><span class="mark ok">✓</span>No issues.</li>'}
      ${!errs.length ? ['Organization configuration valid.', 'OU hierarchy valid.', 'Account emails and IDs valid.', 'Account-to-OU mappings valid.', 'SCP JSON valid.'].map(t => `<li><span class="mark ok" aria-hidden="true">✓</span>${t}</li>`).join('') : ''}</ul>
    <p class="hint">These checks run in your browser. They are not terraform validate; run terraform init and terraform validate on the downloaded project.</p>
    <h3 class="lz-h3">Architecture</h3>
    <div class="lz-svgwrap">${lzTreeSvg(c)}</div>
    <h3 class="lz-h3">Other services in this project</h3>
    ${others.length ? `<p class="hint">Conceptual placement only: the generated providers.tf deploys every selected service into the account whose credentials run Terraform. Cross-account resources are not generated; deploy into a member account with a separate configuration whose provider assumes a role there.</p>
      <label class="field" style="max-width:360px"><span>Show ${others.length} selected service${others.length > 1 ? 's' : ''} under account</span><select class="inp" data-act-change="target"><option value="">(not shown)</option>${lzActiveAccounts(c).map(a => `<option value="${esc(a.key)}" ${state.lzTarget === a.key ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
      <div class="chips" style="margin-top:8px">${others.map(x => `<span class="chip">${esc(x.name)}</span>`).join('')}</div>`
    : '<p class="hint">No other services are selected. VPC, Transit Gateway, S3, AWS Backup or CloudWatch from the Services tab can be shown inside a chosen account here.</p>'}`;
}

/* Step 9: generate */
function lzStepGenerate(c, checks) {
  const s = lzStats(c);
  const types = [...new Set(s.files.flatMap(f => [...f.content.matchAll(/^(resource|data)\s+"([^"]+)"/gm)].map(m => (m[1] === 'data' ? 'data.' : '') + m[2])))];
  const errs = checks.filter(x => x.level === 'error').length;
  const limits = [
    ['Landing zone repair, reset and drift remediation', 'Partly: remediation_types = ["INHERITANCE_DRIFT"] only', 'Control Tower console or ResetLandingZone API'],
    ['Mandatory controls', 'Not directly supported', 'Always on; Control Tower manages them'],
    ['Account Factory network and blueprint settings', 'Not directly supported', 'Control Tower console'],
    ['Enrolling a single account without registering its OU', 'Not directly supported', 'Console "Enroll account", or Account Factory provisioning'],
    ['Root user credentials of member accounts', 'Not supported (by design)', 'Password recovery or centralized root access'],
    ['Moving the management account into an OU', 'Not possible in AWS', 'It always stays in the root'],
    ['Cross-account resources (VPC, TGW, S3 in member accounts)', 'Supported, but in separate configurations', 'Provider assume_role into the member account'],
  ];
  return `<p class="hint">${s.files.length} landing zone file${s.files.length === 1 ? '' : 's'} with ${s.res} resources, plus providers.tf, variables.tf, outputs.tf and terraform.tfvars.example. Files are flat in one folder (Terraform only loads .tf files from the working directory).</p>
    ${errs ? `<p class="callout warn">Static checks found ${errs} error${errs > 1 ? 's' : ''}. Review step lists them; you can still generate and edit by hand.</p>` : ''}
    <ul class="res-list">${s.files.map(f => `<li><span class="addr">${esc(f.name)}</span><span class="hint">${esc(f.part || '')}</span></li>`).join('')}</ul>
    <div class="lz-gen-actions">
      <button class="btn primary" data-act="generate">Generate Terraform</button>
      <button class="btn" data-act="zip">${IC.dl} Download ZIP</button>
      <button class="btn" data-act="copyCfg">${IC.copy} Copy configuration</button>
      <button class="btn" data-act="copyTf">${IC.copy} Copy landing zone Terraform</button></div>
    <h3 class="lz-h3">Terraform Registry documentation</h3>
    <ul class="links lz-links">${types.map(t => `<li>${extLink(docUrl(t), esc(t) + ' ' + IC.ext.replace('<svg', '<svg width="12" height="12"'))}</li>`).join('')}</ul>
    <h3 class="lz-h3">Terraform provider limitations</h3>
    <div class="lz-table-wrap"><table class="lz-table"><thead><tr><th scope="col">Capability</th><th scope="col">Terraform provider support</th><th scope="col">Alternative</th></tr></thead><tbody>${limits.map(r => `<tr><th scope="row">${esc(r[0])}</th><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')}</tbody></table></div>`;
}

/* ---------------- organization tree (SVG) ---------------- */
function lzTreeSvg(c, opts = {}) {
  const acts = lzActiveAccounts(c);
  const scpsOn = t => c.scps.filter(s => s.enabled !== false && (s.targets || []).includes(t)).map(s => s.name);
  const acctNode = a => {
    const sub = a.mode === 'reference' ? 'existing (reference)' : a.mode === 'import' ? 'existing → move' : lzFactory(c, a) ? 'Account Factory' : 'to create';
    const n = { label: a.name, sub, kind: 'acct', scp: scpsOn('acct:' + a.key), kids: [] };
    const others = SERVICES.filter(x => x.id !== LZ_ID && isSel(x.id));
    if (state.lzTarget === a.key && others.length) n.kids.push({ label: 'Workload services', sub: others.map(x => ABBR[x.id] || x.id).join(' '), kind: 'svc', kids: [] });
    return n;
  };
  const ouNode = o => ({ label: o.name + ' OU', sub: lzCtOn(c) && c.ct.baselines.includes(o.key) ? 'registered with Control Tower' : '', kind: 'ou', scp: scpsOn('ou:' + o.key),
    kids: [...c.ous.filter(x => x.parent === o.key).map(ouNode), ...acts.filter(a => a.ou === o.key).map(acctNode)] });
  const top = [{ label: c.mgmt.name, sub: 'management account', kind: 'mgmt', kids: [] }, ...acts.filter(a => !a.ou || a.ou === 'root' || !lzOu(c, a.ou)).map(acctNode), ...c.ous.filter(o => o.parent === 'root').map(ouNode)];
  let tree = { label: 'AWS Organization', sub: c.org.label + ' (root)', kind: 'org', scp: scpsOn('root'), kids: top };
  if (lzCtOn(c)) tree = Object.assign({}, tree, { kids: [{ label: 'AWS Control Tower', sub: c.ct.mode === 'existing' ? 'existing landing zone' : 'landing zone ' + c.ct.version, kind: 'ct', kids: top }] });
  const NW = 150, NH = 46, GX = 18, VY = 86, PAD = 16;
  const width = n => (n.w = n.kids.length ? Math.max(NW, n.kids.reduce((s, k) => s + width(k), 0) + GX * (n.kids.length - 1)) : NW);
  width(tree);
  let maxY = 0;
  const nodes = [], edges = [];
  const place = (n, left, depth) => {
    n.x = left + (n.w - NW) / 2; n.y = PAD + depth * VY; maxY = Math.max(maxY, n.y);
    nodes.push(n);
    let l = left;
    for (const k of n.kids) { place(k, l, depth + 1); edges.push([n, k]); l += k.w + GX; }
  };
  place(tree, PAD, 0);
  const W = tree.w + PAD * 2, H = maxY + NH + PAD + 14;
  const col = { org: 'var(--lz)', ct: 'var(--plan)', ou: 'var(--lz)', acct: 'var(--muted)', mgmt: 'var(--warn)', svc: 'var(--net)' };
  const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Organization tree: ${c.ous.length} OUs and ${acts.length + 1} accounts" style="font-family:var(--sans);max-width:none">`;
  for (const [a, b] of edges) { const ax = a.x + NW / 2, bx = b.x + NW / 2, my = a.y + NH + (VY - NH) / 2; svg += `<path d="M${ax},${a.y + NH} V${my} H${bx} V${b.y}" fill="none" stroke="var(--line)" stroke-width="1.4"/>`; }
  for (const n of nodes) {
    const dashed = n.kind === 'svc' ? ' stroke-dasharray="4 3"' : '';
    svg += `<g><title>${esc(n.label + (n.sub ? ' — ' + n.sub : '') + (n.scp && n.scp.length ? ' — SCP: ' + n.scp.join(', ') : ''))}</title>
      <rect x="${n.x}" y="${n.y}" width="${NW}" height="${NH}" rx="${n.kind === 'acct' || n.kind === 'mgmt' ? 6 : 10}" fill="${n.kind === 'ou' || n.kind === 'org' ? 'color-mix(in srgb, var(--lz) 7%, var(--panel))' : 'var(--panel)'}" stroke="${col[n.kind]}" stroke-width="1.5"${dashed}/>
      <text x="${n.x + NW / 2}" y="${n.y + 19}" text-anchor="middle" font-size="12.5" font-weight="600" fill="var(--ink)">${esc(cut(n.label, 21))}</text>
      <text x="${n.x + NW / 2}" y="${n.y + 35}" text-anchor="middle" font-size="10.5" fill="var(--muted)">${esc(cut(n.sub || '', 26))}</text>
      ${n.scp && n.scp.length ? `<text x="${n.x + NW / 2}" y="${n.y + NH + 12}" text-anchor="middle" font-size="10" font-family="var(--mono)" fill="var(--err)">${esc(cut('SCP: ' + n.scp.join(', '), 23))}</text>` : ''}</g>`;
  }
  return svg + '</svg>';
}

/* ---------------- events ---------------- */
function lzBind(root, m) {
  if (!root) return;
  const rerender = () => { const y = window.scrollY; renderLanding(m); window.scrollTo({ top: y }); };
  const mutate = (fn, re = true) => { const c = lzC(); if (!c) return; fn(c); lzPut(c); if (re) rerender(); else lzRefreshSide(); };
  const apply = (el, re) => {
    const t = el.dataset.t, path = el.dataset.lz;
    mutate(c => {
      if (t === 'multi') { const arr = (getPath(c, path) || []).filter(x => x !== el.value); if (el.checked) arr.push(el.value); setPath(c, path, arr); }
      else if (t === 'csvmulti') { const arr = csv(getPath(c, path)).filter(x => x !== el.value); if (el.checked) arr.push(el.value); setPath(c, path, arr.join(', ')); }
      else if (t === 'bool') setPath(c, path, el.checked);
      else if (t === 'num') { const v = Number(el.value); if (el.value !== '' && !isNaN(v)) setPath(c, path, v); }
      else if (t === 'tags') setPath(c, path, lzParseTags(el.value));
      else if (t === 'sel' && /\.enabled$/.test(path) && path.startsWith('scps')) setPath(c, path, el.value === 'true');
      else setPath(c, path, el.value);
      if (path === 'org.feature_set' && el.value !== 'ALL') { c.org.scp = false; c.org.trusted = false; }
      if (/^accounts\.\d+\.mode$/.test(path) && el.value === 'reference') { const a = getPath(c, path.replace(/\.mode$/, '')); a.factory = false; }
      if (t === 'json') { const s = getPath(c, path.replace(/\.json$/, '')); const st = root.querySelector(`[data-jsonstat="${CSS.escape(el.dataset.key)}"]`); if (st) st.innerHTML = lzJsonStatus(s); }
    }, re);
  };
  root.addEventListener('input', e => { const el = e.target.closest('[data-lz]'); if (el && !['bool', 'sel', 'multi', 'csvmulti'].includes(el.dataset.t)) apply(el, false); });
  root.addEventListener('change', e => {
    const el = e.target.closest('[data-lz]');
    if (el && ['bool', 'sel', 'multi', 'csvmulti'].includes(el.dataset.t)) { apply(el, true); return; }
    const ctl = e.target.closest('[data-t="ctl"]');
    if (ctl) { mutate(c => { let x = c.ct.controls.find(y => y.id === ctl.dataset.id); if (!x) { x = { id: ctl.dataset.id, ous: [] }; c.ct.controls.push(x); } x.ous = x.ous.filter(k => k !== ctl.value); if (ctl.checked) x.ous.push(ctl.value); c.ct.controls = c.ct.controls.filter(y => y.ous.length); }); return; }
    const ac = e.target.closest('[data-act-change]');
    if (!ac) return;
    const kind = ac.dataset.actChange;
    if (kind === 'model') mutate(c => {
      c.model = ac.value; c.ct.enabled = ac.value === 'enterprise';
      if (ac.value === 'enterprise') for (const d of LZ_CORE.enterprise.filter(x => x.need === 'Required')) {
        const have = c.accounts.find(a => a.core === d.core);
        if (have) have.enabled = true;
        else { if (!lzOu(c, d.ou)) c.ous.unshift({ key: d.ou, name: 'Security', parent: 'root', desc: 'Log archive and audit accounts used by Control Tower' }); c.accounts.unshift(lzAccount({ key: lzKey(d.core, new Set(c.accounts.map(a => a.key))), name: d.name, email: `aws-${d.name}@example.com`, core: d.core, type: d.type, env: d.env, ou: d.ou })); }
      }
      if (ac.value === 'enterprise' && c.acct.role_name === 'OrganizationAccountAccessRole') c.acct.role_name = 'AWSControlTowerExecution';
    });
    if (kind === 'core') mutate(c => {
      const a = c.accounts.find(x => x.core === ac.value);
      if (a) a.enabled = ac.checked;
      else { const d = LZ_CORE[c.model].find(x => x.core === ac.value); c.accounts.push(lzAccount({ key: lzKey(d.core, new Set(c.accounts.map(x => x.key))), name: d.name, email: `aws-${d.name}@example.com`, core: d.core, type: d.type, env: d.env, ou: lzOu(c, d.ou) ? d.ou : 'root', mode: c.acct.strategy === 'existing' ? 'import' : 'create' })); }
    });
    if (kind === 'target') { state.lzTarget = ac.value; persist(); rerender(); }
  });
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act, arg = b.dataset.arg;
    if (act === 'start') return lzStart(arg);
    if (act === 'go') return lzGo(+arg);
    if (act === 'learn') { state.learnQ = arg; setTab('learn'); return; }
    if (act === 'set') return mutate(c => setPath(c, b.dataset.path, arg));
    if (act === 'template') { const c = lzC(); if (confirm('Replace OUs, accounts, SCPs and Control Tower settings with the starter template?')) { state.cfg[LZ_ID] = lzTemplate(c.model, state.g.region); persist(); renderSummary(); rerender(); toast('Starter template loaded'); } return; }
    if (act === 'defaultOus') {
      if (!confirm('Replace every OU with the starter set? Accounts in removed OUs move to the root and their SCP and Control Tower targets are cleared.')) return;
      return mutate(c => { c.ous = lzTemplate(c.model, state.g.region).ous; lzCleanup(c); });
    }
    if (act === 'addOu') {
      const name = $('#lzNewOuName', root).value.trim();
      if (!name) { toast('Enter an OU name'); $('#lzNewOuName', root).focus(); return; }
      return mutate(c => { c.ous.push({ key: lzKey(name, new Set(c.ous.map(o => o.key))), name, parent: $('#lzNewOuParent', root).value, desc: $('#lzNewOuDesc', root).value.trim() }); });
    }
    if (act === 'addChild') return mutate(c => { c.ous.push({ key: lzKey('new_ou', new Set(c.ous.map(o => o.key))), name: 'New OU', parent: arg, desc: '' }); });
    if (act === 'delOu') return mutate(c => {
      const o = lzOu(c, arg);
      for (const k of c.ous.filter(x => x.parent === arg)) k.parent = o.parent;
      for (const a of c.accounts.filter(x => x.ou === arg)) a.ou = o.parent;
      c.ous = c.ous.filter(x => x.key !== arg); lzCleanup(c);
      toast(`Removed ${o.name}. Its child OUs and accounts moved up one level.`);
    });
    if (act === 'addAcct') return mutate(c => {
      const taken = new Set(c.accounts.map(a => a.key));
      const key = lzKey('new-account', taken);
      const firstWorkload = c.ous.find(o => /prod/i.test(o.name)) || c.ous[0];
      c.accounts.push(lzAccount({ key, name: key.replace(/_/g, '-'), email: `aws-${key.replace(/_/g, '-')}@example.com`, ou: firstWorkload ? firstWorkload.key : 'root', mode: c.acct.strategy === 'existing' ? 'import' : 'create' }));
    });
    if (act === 'delAcct') return mutate(c => { c.accounts = c.accounts.filter(a => a.key !== arg); lzCleanup(c); });
    if (act === 'strategy') return mutate(c => { c.acct.strategy = arg; if (arg !== 'mixed') for (const a of c.accounts) if (arg === 'create') a.mode = 'create'; else if (a.mode === 'create') { a.mode = 'import'; a.factory = false; } });
    if (act === 'move') { const k = $('#lzMoveAcct', root).value, ou = $('#lzMoveOu', root).value; return lzMoveAccount(k, ou, rerender); }
    if (act === 'addScp') return mutate(c => { const s = lzNewScp(c, arg, state.g.region); c.scps.push(s); if (!c.org.scp && c.org.feature_set === 'ALL') c.org.scp = true; toast(`Added ${s.name}. Pick its targets to attach it.`); });
    if (act === 'delScp') return mutate(c => { c.scps = c.scps.filter(s => s.key !== arg); });
    if (act === 'scpMode') { const [i, mode] = arg.split(':'); return mutate(c => { const s = c.scps[+i]; if (mode === 'json' && s.mode !== 'json') { const d = scpPolicy(s); s.json = JSON.stringify(d, null, 2); } s.mode = mode; }); }
    if (act === 'generate') { generate(); return; }
    if (act === 'zip') { if (!state.gen || isStale()) generate(); if (state.gen) downloadZip(); return; }
    if (act === 'copyCfg') { copyText(JSON.stringify(lzC(), null, 2), 'landing zone configuration (JSON)'); return; }
    if (act === 'copyTf') { copyText(lzStats(lzC()).files.map(f => `# ===== ${f.name} =====\n${f.content}`).join('\n'), 'landing zone Terraform'); return; }
  });
  // Drag and drop for account placement
  root.addEventListener('dragstart', e => { const d = e.target.closest('[data-drag]'); if (!d) return; e.dataTransfer.setData('text/plain', d.dataset.drag); e.dataTransfer.effectAllowed = 'move'; d.classList.add('dragging'); });
  root.addEventListener('dragend', e => { const d = e.target.closest('[data-drag]'); if (d) d.classList.remove('dragging'); });
  root.addEventListener('dragover', e => { const z = e.target.closest('[data-drop]'); if (!z) return; e.preventDefault(); $$('.lz-drop.over', root).forEach(x => x !== z && x.classList.remove('over')); z.classList.add('over'); });
  root.addEventListener('dragleave', e => { const z = e.target.closest('[data-drop]'); if (z && !z.contains(e.relatedTarget)) z.classList.remove('over'); });
  root.addEventListener('drop', e => { const z = e.target.closest('[data-drop]'); if (!z) return; e.preventDefault(); z.classList.remove('over'); const k = e.dataTransfer.getData('text/plain'); if (k) lzMoveAccount(k, z.dataset.drop, rerender); });
}
function lzMoveAccount(key, ou, rerender) {
  const c = lzC();
  const a = c.accounts.find(x => x.key === key);
  if (!a) return;
  if (a.mode === 'reference') { toast('Referenced accounts are not managed. Switch it to "Existing: import and move" in the Accounts step to move it.'); return; }
  if ((a.ou || 'root') === ou) return;
  a.ou = ou;
  lzPut(c); rerender();
  toast(`${a.name} → ${ou === 'root' ? 'Root' : lzOu(c, ou).name}${a.mode === 'import' ? ' (moved after import)' : ''}`);
}
// Drop references to OUs and accounts that no longer exist.
function lzCleanup(c) {
  const ous = new Set(c.ous.map(o => o.key)), accts = new Set(c.accounts.map(a => a.key));
  for (const o of c.ous) if (o.parent !== 'root' && !ous.has(o.parent)) o.parent = 'root';
  for (const a of c.accounts) if (a.ou !== 'root' && !ous.has(a.ou)) a.ou = 'root';
  for (const s of c.scps) s.targets = (s.targets || []).filter(t => t === 'root' || (t.startsWith('ou:') ? ous.has(t.slice(3)) : accts.has(t.slice(5))));
  c.ct.baselines = c.ct.baselines.filter(k => ous.has(k));
  c.ct.controls = c.ct.controls.map(x => Object.assign(x, { ous: x.ous.filter(k => ous.has(k)) })).filter(x => x.ous.length);
}
