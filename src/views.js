/* ==========================================================================
   views.js — Terraform files editor, architecture diagram, modules,
   learning topics, CLI helper, and app start-up.
   ========================================================================== */

/* ---------------- Terraform files view ---------------- */
function renderFiles(m) {
  if (!state.gen) {
    m.innerHTML = `<div class="panel gen-empty"><h2>No Terraform generated yet</h2>
      <p>Select services, adjust their settings, then generate. You get providers.tf, variables.tf, one file per service, outputs.tf and a terraform.tfvars.example, all referencing each other.</p>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
        <button class="btn primary" id="eGen" ${state.sel.length ? '' : 'disabled'}>Generate Terraform${state.sel.length ? ` for ${state.sel.length} service${state.sel.length > 1 ? 's' : ''}` : ''}</button>
        <button class="btn" id="eGuided">Load the guided example</button></div></div>`;
    $('#eGen', m).onclick = generate;
    $('#eGuided', m).onclick = () => { applyPreset(PRESETS[0]); };
    return;
  }
  const files = currentFiles();
  let f = files.find(x => x.name === state.curFile);
  if (!f) { f = files[0]; state.curFile = f.name; }
  const root = files.filter(x => x.cat === 'root' && x.name !== 'outputs.tf' && x.name !== 'terraform.tfvars.example');
  const svcFiles = files.filter(x => x.svc);
  const tail = files.filter(x => x.name === 'outputs.tf' || x.name === 'terraform.tfvars.example');
  const extras = files.filter(x => x.cat === 'extra');
  const fbtn = x => `<button class="file-btn" data-file="${esc(x.name)}" aria-current="${x.name === f.name}">${x.svc ? `<span class="dot" style="background:${CAT_VAR[x.cat]}"></span>` : ''}${esc(x.name)}${x.edited ? '<span class="edited">edited</span>' : ''}</button>`;
  const edCount = files.filter(x => x.edited).length;
  m.innerHTML = `
    ${isStale() ? `<div class="banner" role="status"><span>Your selection or settings changed after this code was generated.</span><button class="btn sm primary" id="regen">Regenerate</button></div>` : ''}
    <div class="toolbar-row">
      <span class="hint">File organization</span>
      <div class="seg" role="group" aria-label="File organization">
        <button data-layout="flat" aria-pressed="${state.g.layout === 'flat'}">Flat</button>
        <button data-layout="category" aria-pressed="${state.g.layout === 'category'}" title="Prefixes each service file with its category, e.g. networking_vpc.tf">Category prefixed</button>
        <button data-layout="module" aria-pressed="false" title="See the Modules tab">Module based</button>
      </div>
      <span class="grow"></span>
      ${edCount ? `<button class="btn sm ghost" id="resetAll">${IC.undo} Reset all edits (${edCount})</button>` : ''}
      <button class="btn sm" id="copyAll">${IC.copy} Copy all</button>
      <button class="btn sm primary" id="zipAll">${IC.dl} Download ZIP</button>
    </div>
    <div class="files-layout ${state.expanded ? 'expanded' : ''}">
      <nav class="panel file-nav" aria-label="Generated files">
        <h3>Root configuration</h3>${root.map(fbtn).join('')}
        ${svcFiles.length ? `<h3>Services</h3>${svcFiles.map(fbtn).join('')}` : ''}
        <h3>Outputs and values</h3>${tail.map(fbtn).join('')}
        ${extras.length ? `<h3>Supporting files</h3>${extras.map(fbtn).join('')}` : ''}
      </nav>
      <div style="min-width:0">
        <div class="panel editor-card">
          <div class="ed-toolbar">
            <span class="fname">${f.svc ? glyph(f.svc, 22) : ''}${esc(f.name)}<span class="pill" id="edPill" style="color:var(--warn)" ${f.edited ? '' : 'hidden'}>edited</span></span>
            <div class="code-search" role="search">
              <label class="sr" for="codeQ">Search in this file</label>
              <input class="inp mono" id="codeQ" placeholder="Find in file" value="${esc(state.codeQ)}" spellcheck="false">
              <span class="cnt" id="codeCnt" aria-live="polite"></span>
              <button class="icon-btn" id="prevHit" aria-label="Previous match">${IC.up}</button>
              <button class="icon-btn" id="nextHit" aria-label="Next match">${IC.down}</button>
            </div>
            <button class="btn sm" id="copyFile">${IC.copy} Copy</button>
            <button class="btn sm" id="dlFile" title=".tf is not an allowed download type here, so single files download inside a .zip">${IC.dl} Download</button>
            <button class="btn sm ghost" id="resetFile" title="Discard edits to this file" ${f.edited ? '' : 'hidden'}>${IC.undo} Reset</button>
            <button class="icon-btn" id="expand" aria-label="${state.expanded ? 'Collapse editor' : 'Expand editor'}" title="${state.expanded ? 'Collapse' : 'Expand'}">${state.expanded ? IC.collapse : IC.expand}</button>
          </div>
          <div class="ed">
            <div class="gutter code" aria-hidden="true" id="gutter"></div>
            <div class="ed-main">
              <pre class="code" id="hl" aria-hidden="true"></pre>
              <textarea id="ta" class="code" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" aria-label="Editable contents of ${esc(f.name)}"></textarea>
            </div>
          </div>
        </div>
        <div class="below">
          <div class="panel" id="fileInfo"></div>
          <div class="panel" id="valPanel"></div>
        </div>
      </div>
    </div>`;
  const rg = $('#regen', m); if (rg) rg.onclick = generate;
  $$('[data-layout]', m).forEach(b => b.onclick = () => {
    if (b.dataset.layout === 'module') { toast('Module-based layouts are explained in the Modules tab'); setTab('modules'); return; }
    if (state.g.layout === b.dataset.layout) return;
    const cur = state.curFile, svc = f.svc;
    state.g.layout = b.dataset.layout; persist();
    if (Object.keys(state.edits).length && !confirm('Changing the layout regenerates the files and discards your edits. Continue?')) { state.g.layout = state.g.layout === 'flat' ? 'category' : 'flat'; persist(); renderMain(); return; }
    state.edits = {};
    generate();
    if (svc) { const nf = state.gen.files.find(x => x.svc === svc); if (nf) state.curFile = nf.name; } else state.curFile = cur;
    renderMain();
  });
  $$('[data-file]', m).forEach(b => b.onclick = () => { state.curFile = b.dataset.file; state.codeHit = 0; renderMain(); const nb = $(`[data-file="${CSS.escape(state.curFile)}"]`); if (nb) nb.focus(); });
  const ra = $('#resetAll', m); if (ra) ra.onclick = () => { if (confirm('Discard edits in every file?')) { state.edits = {}; renderMain(); renderSummary(); } };
  $('#copyAll', m).onclick = () => copyText(files.filter(x => x.name.endsWith('.tf')).map(x => `# ===== ${x.name} =====\n${x.content}`).join('\n'), 'all .tf files');
  $('#zipAll', m).onclick = downloadZip;
  $('#copyFile', m).onclick = () => copyText(currentFiles().find(x => x.name === state.curFile).content, state.curFile);
  $('#dlFile', m).onclick = () => downloadOne(currentFiles().find(x => x.name === state.curFile));
  const rf = $('#resetFile', m); rf.onclick = () => { delete state.edits[f.name]; renderMain(); renderSummary(); $('#copyFile').focus(); };
  $('#expand', m).onclick = () => { state.expanded = !state.expanded; renderMain(); $('#expand').focus(); };
  setupEditor(f);
  renderFileInfo(f);
  renderValidation();
}

function setupEditor(f) {
  const ta = $('#ta'), hl = $('#hl'), gut = $('#gutter'), qi = $('#codeQ');
  const isHcl = /\.tf$|\.tfvars/.test(f.name);
  ta.value = f.content;
  let ranges = [];
  const paint = () => {
    const src = ta.value;
    let html, count = 0;
    if (isHcl) { const r = highlightHCL(src, state.codeQ); html = r.html; count = r.count; ranges = r.ranges; }
    else {
      ranges = [];
      const q = state.codeQ.toLowerCase();
      if (q) { const low = src.toLowerCase(); let k = low.indexOf(q); while (k >= 0) { ranges.push([k, k + q.length]); k = low.indexOf(q, k + q.length); } }
      let p = 0; html = '';
      ranges.forEach(([a, b], j) => { html += esc(src.slice(p, a)) + `<mark data-i="${j}">` + esc(src.slice(a, b)) + '</mark>'; p = b; });
      html += esc(src.slice(p)); count = ranges.length;
    }
    hl.innerHTML = html + '<span class="endpad"> </span>';
    const lines = src.split('\n').length;
    gut.innerHTML = Array.from({ length: lines }, (_, i) => i + 1).join('<br>') + '<div style="height:40px"></div>';
    if (state.codeHit >= count) state.codeHit = 0;
    $('#codeCnt').textContent = state.codeQ ? (count ? `${state.codeHit + 1}/${count}` : '0') : '';
    $$('mark', hl).forEach(mk => mk.classList.toggle('cur', +mk.dataset.i === state.codeHit));
    sync();
  };
  const sync = () => { hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft; gut.scrollTop = ta.scrollTop; };
  const goHit = (d) => {
    if (!ranges.length) return;
    state.codeHit = (state.codeHit + d + ranges.length) % ranges.length;
    $$('mark', hl).forEach(mk => mk.classList.toggle('cur', +mk.dataset.i === state.codeHit));
    $('#codeCnt').textContent = `${state.codeHit + 1}/${ranges.length}`;
    const line = ta.value.slice(0, ranges[state.codeHit][0]).split('\n').length - 1;
    ta.scrollTop = Math.max(0, line * 20 - ta.clientHeight / 2 + 20);
    sync();
  };
  paint();
  const onEdit = debounce(() => {
    const orig = [...state.gen.files, ...state.gen.extras].find(x => x.name === f.name).content;
    if (ta.value === orig) delete state.edits[f.name]; else state.edits[f.name] = ta.value;
    const nb = $(`[data-file="${CSS.escape(f.name)}"]`);
    if (nb) { const e = $('.edited', nb); if (state.edits[f.name] != null && !e) nb.insertAdjacentHTML('beforeend', '<span class="edited">edited</span>'); if (state.edits[f.name] == null && e) e.remove(); }
    $('#resetFile').hidden = $('#edPill').hidden = state.edits[f.name] == null;
    renderFileInfo(Object.assign({}, f, { content: ta.value }));
    renderValidation(); renderSummary();
  }, 400);
  ta.addEventListener('input', () => { paint(); onEdit(); });
  ta.addEventListener('scroll', sync);
  ta.addEventListener('keydown', e => {
    if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Tab inserts two spaces; press Escape first to move focus out with Tab.
      if (ta.dataset.escaped === '1') { ta.dataset.escaped = ''; return; }
      e.preventDefault();
      const s = ta.selectionStart, en = ta.selectionEnd;
      ta.setRangeText('  ', s, en, 'end');
      paint(); onEdit();
    } else if (e.key === 'Escape') { ta.dataset.escaped = '1'; e.stopPropagation(); }
    else ta.dataset.escaped = '';
  });
  qi.addEventListener('input', () => { state.codeQ = qi.value; state.codeHit = 0; paint(); if (ranges.length) goHit(0); });
  qi.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); goHit(e.shiftKey ? -1 : 1); } });
  $('#nextHit').onclick = () => goHit(1);
  $('#prevHit').onclick = () => goHit(-1);
}

function renderFileInfo(f) {
  const el = $('#fileInfo');
  if (!el) return;
  const s = f.svc ? SVC[f.svc] : null;
  const blocks = /\.tf$/.test(f.name) ? blocksOf(f.content) : [];
  const notes = s ? state.gen.notes.filter(n => n.svc === f.svc) : [];
  let role = FILE_ROLE[f.name] || (s ? s.desc : '');
  if (f.name === '.gitignore') role = 'Keeps state files, plans, local caches and real tfvars out of Git. Commit .terraform.lock.hcl.';
  else if (f.cat === 'extra') role = 'Source code packaged by the archive_file data source in lambda.tf. Replace it with your function.';
  el.innerHTML = `<h3>${s ? 'Resources in this file' : 'About this file'}</h3>
    <p class="hint" style="margin-bottom:10px">${esc(role)}</p>
    ${blocks.length ? `<ul class="res-list">${blocks.map((b, i) => `<li><span class="addr" title="${esc(b.addr)}">${esc(b.addr)}</span>${extLink(docUrl(b.type), 'Docs', 'btn sm ghost')}<button class="btn sm" data-lb="${i}">${IC.book} Learn</button></li>`).join('')}</ul>` : ''}
    ${f.name === 'variables.tf' || f.name === 'outputs.tf' ? `<button class="btn sm ghost" id="lTopic" style="margin-top:6px">${IC.book} Learn about ${f.name === 'variables.tf' ? 'variables' : 'outputs'}</button>` : ''}
    ${notes.length ? `<div class="callout" style="margin-top:12px">${notes.map(n => esc(n.text)).join('<br>')}</div>` : ''}
    ${s && s.assume.length ? `<details style="margin-top:10px"><summary class="hint" style="cursor:pointer">Assumptions made for ${esc(s.name)}</summary><ul class="hint" style="padding-left:18px">${s.assume.map(a => `<li>${esc(a)}</li>`).join('')}</ul></details>` : ''}`;
  $$('[data-lb]', el).forEach(b => b.onclick = () => openLearn(blocks[+b.dataset.lb].type, blocks[+b.dataset.lb], f.name));
  const lt = $('#lTopic', el);
  if (lt) lt.onclick = () => { state.learnQ = f.name === 'variables.tf' ? 'Variables' : 'Outputs'; setTab('learn'); };
}

function renderValidation() {
  const el = $('#valPanel');
  if (!el) return;
  const v = validation();
  const lvLabel = { ok: 'passed', warn: 'warnings', error: 'errors', info: 'info' };
  el.innerHTML = `<h3>Static checks</h3>
    <p class="callout" style="margin:0 0 10px">These run in your browser against the generated text. They are not <code>terraform validate</code>, which needs the provider schema: run <code>terraform init</code> and <code>terraform validate</code> locally.</p>
    <div class="checks">${Object.entries(v).map(([k, c]) => {
      const sym = c.status === 'ok' ? '✓' : c.status === 'warn' ? '!' : '✕';
      const open = c.status !== 'ok' ? 'open' : '';
      return `<details class="check" ${open}><summary><span class="mark ${c.status}" aria-hidden="true">${sym}</span>${esc(c.label)}<span class="lvl">${lvLabel[c.status]}</span></summary>
        <ul>${c.items.map(i => `<li><span class="mark ${i.level}" aria-hidden="true">${i.level === 'ok' ? '✓' : i.level === 'warn' ? '!' : i.level === 'error' ? '✕' : 'i'}</span><span><span class="sr">${i.level}: </span>${esc(i.msg)}</span></li>`).join('')}</ul></details>`;
    }).join('')}</div>`;
}

/* ---------------- architecture ---------------- */
const ARCH_ROWS = [
  { key: 'internet', label: 'Internet', ids: ['@internet'] },
  { key: 'edge', label: 'Edge and DNS', ids: ['route53_zone', 'route53_record', 'waf', 'cloudfront'] },
  { key: 'pub', label: 'Public subnets', vpc: true, ids: ['igw', 'eip', 'nat', 'alb', 'nlb', 'listener', 'tg'] },
  { key: 'app', label: 'Private subnets: compute', vpc: true, ids: ['ec2', 'lt', 'asg', 'ecs_cluster', 'ecs_service', 'ecs_task', 'eks_cluster', 'eks_node_group', 'ebs'] },
  { key: 'data', label: 'Private subnets: data', vpc: true, ids: ['dbsg', 'rds', 'rds_postgres', 'rds_mysql', 'rds_sqlserver', 'aurora', 'elasticache', 'memorydb', 'efs', 'fsx'] },
  { key: 'fabric', label: 'Network foundation', vpc: true, ids: ['vpc', 'subnet', 'route_table', 'sg', 'nacl', 'vpc_endpoint'] },
  { key: 'hybrid', label: 'Hybrid and transit', ids: ['tgw', 'tgw_attach', 'vgw', 'vpn', 'cgw', '@onprem'] },
  { key: 'regional', label: 'Regional services', ids: ['lambda', 's3', 's3_versioning', 's3_encryption', 's3_lifecycle', 'dynamodb', 'ecr', 'ssm', 'backup'] },
  { key: 'identity', label: 'Identity and encryption', ids: ['iam_role', 'iam_policy', 'kms'] },
];
const DB_IDS = ['rds', 'rds_postgres', 'rds_mysql', 'rds_sqlserver', 'aurora', 'elasticache', 'memorydb', 'efs', 'fsx'];
function archGraph() {
  const has = id => state.archDeps && id.startsWith('@') ? false : id === '@internet' ? ['igw', 'cloudfront', 'route53_zone', 'route53_record', 'alb', 'nlb'].some(isSel) : id === '@onprem' ? ['cgw', 'vpn'].some(isSel) : isSel(id);
  const fold = isSel('s3') ? ['s3_versioning', 's3_encryption', 's3_lifecycle'].filter(isSel) : [];
  const present = id => has(id) && !fold.includes(id);
  const E = [];
  const e = (a, b, kind = 'flow', label) => { if (present(a) && present(b)) E.push({ a, b, kind, label }); };
  if (state.archDeps) {
    for (const id of state.sel) for (const d of SVC[id].deps) { const t = fold.includes(id) ? 's3' : id; if (t !== d) e(d, t, 'dep'); }
  } else {
    e('@internet', 'route53_zone'); e('route53_zone', 'route53_record');
    if (isSel('cloudfront')) e('route53_record', 'cloudfront'); else e('route53_record', 'alb');
    e('@internet', 'cloudfront');
    if (isSel('cloudfront')) e('waf', 'cloudfront', 'attach', 'protects'); else e('waf', 'alb', 'attach', 'protects');
    if (isSel('s3')) e('cloudfront', 's3'); else e('cloudfront', 'alb');
    e('@internet', 'igw'); e('igw', 'alb'); e('igw', 'nlb');
    if (isSel('listener')) { e('alb', 'listener'); e('nlb', 'listener'); e('listener', 'tg'); } else { e('alb', 'tg'); e('nlb', 'tg'); }
    ['ec2', 'asg', 'ecs_service'].forEach(c => e('tg', c));
    e('lt', 'asg', 'attach', 'template'); e('ecs_cluster', 'ecs_service', 'attach'); e('ecs_service', 'ecs_task', 'attach', 'runs');
    e('ecr', 'ecs_task', 'attach', 'images'); e('eks_cluster', 'eks_node_group', 'attach'); e('ecr', 'eks_node_group', 'attach', 'images');
    e('ebs', 'ec2', 'attach', 'attached'); e('eip', 'nat', 'attach'); e('nat', 'igw', 'flow', 'egress');
    const comp = ['asg', 'ec2', 'ecs_service', 'eks_node_group', 'lambda'].find(present);
    if (comp) DB_IDS.forEach(d => e(comp, d));
    ['rds', 'rds_postgres', 'rds_mysql', 'rds_sqlserver', 'aurora'].forEach(d => e('dbsg', d, 'attach'));
    if (isSel('lambda')) e('lambda', 'dynamodb'); else if (comp) e(comp, 'dynamodb');
    e('@onprem', 'cgw'); e('cgw', 'vpn', 'attach'); e('vpn', 'vgw'); e('tgw_attach', 'tgw', 'attach');
    e('vpc_endpoint', 's3', 'attach', 'private path'); e('vpc_endpoint', 'dynamodb', 'attach', 'private path');
    const bk = ['rds', 'rds_postgres', 'rds_mysql', 'rds_sqlserver', 'aurora', 'efs', 'dynamodb', 'ebs'].find(present);
    if (bk) e('backup', bk, 'attach', 'backs up');
  }
  return { present, fold, E };
}
function renderArch(m) {
  m.innerHTML = `<div class="panel arch-wrap">
    <div class="arch-head"><h2>Architecture of your selection</h2>
      <div class="seg" role="group" aria-label="Diagram mode"><button data-am="flow" aria-pressed="${!state.archDeps}">Traffic flow</button><button data-am="dep" aria-pressed="${state.archDeps}">Terraform dependencies</button></div></div>
    <div class="arch-canvas" id="archCanvas"></div>
    <div class="legend">${state.archDeps ? '<span><i></i>arrow points from the dependency to the resource that references it</span>' : '<span><i></i>traffic or data flow</span><span><i class="dash"></i>attachment, protection or configuration</span>'}
      ${Object.entries(CATS).map(([k, c]) => `<span><span class="dot" style="background:${CAT_VAR[k]}"></span>${c.label}</span>`).join('')}<span>Select a box to configure it.</span></div></div>`;
  $$('[data-am]', m).forEach(b => b.onclick = () => { state.archDeps = b.dataset.am === 'dep'; renderMain(); });
  const cv = $('#archCanvas', m);
  if (!state.sel.length) { cv.innerHTML = `<div class="empty"><h3>Nothing to draw yet</h3><p>Select services and the diagram builds itself, layer by layer.</p><button class="btn" id="aG">Load the guided example</button></div>`; $('#aG', cv).onclick = () => applyPreset(PRESETS[0]); return; }
  const { present, fold, E } = archGraph();
  const NW = 154, NH = 50, GX = 18, GY = 34, LBL = 186, PAD = 24, PER = 6;
  const rows = [];
  for (const r of ARCH_ROWS) {
    const ids = r.ids.filter(present);
    for (let i = 0; i < ids.length; i += PER) rows.push({ r, ids: ids.slice(i, i + PER), first: i === 0 });
  }
  const maxN = Math.max(...rows.map(r => r.ids.length));
  const W = LBL + PAD * 2 + maxN * NW + (maxN - 1) * GX + 20;
  const pos = {};
  let y = PAD;
  const vpcRows = [];
  rows.forEach((row, i) => {
    const prev = rows[i - 1];
    if (prev && prev.r.vpc !== row.r.vpc) y += prev.r.vpc ? 30 : 22;
    const rw = row.ids.length * NW + (row.ids.length - 1) * GX;
    const x0 = LBL + PAD + ((W - LBL - PAD * 2 - 20) - rw) / 2 + 10;
    row.y = y;
    row.ids.forEach((id, j) => { pos[id] = { x: x0 + j * (NW + GX), y, row: i }; });
    if (row.r.vpc) vpcRows.push(row);
    y += NH + GY;
  });
  const H = y - GY + PAD + 10;
  const col = id => id.startsWith('@') ? 'var(--muted)' : CAT_VAR[SVC[id].cat];
  const edgePath = ({ a, b }) => {
    const A = pos[a], Bp = pos[b];
    const ax = A.x + NW / 2, bx = Bp.x + NW / 2;
    if (A.row === Bp.row) {
      const left = A.x < Bp.x;
      const sx = left ? A.x + NW : A.x, tx = left ? Bp.x : Bp.x + NW, yy = A.y + NH / 2;
      if (Math.abs(A.x - Bp.x) <= NW + GX) return `M${sx},${yy} L${tx},${yy}`;
      return `M${ax},${A.y} C${ax},${A.y - 26} ${bx},${Bp.y - 26} ${bx},${Bp.y}`;
    }
    const down = Bp.y > A.y;
    const sy = down ? A.y + NH : A.y, ty = down ? Bp.y : Bp.y + NH;
    const my = (sy + ty) / 2;
    return `M${ax},${sy} C${ax},${my} ${bx},${my} ${bx},${ty}`;
  };
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Architecture diagram of ${state.sel.length} selected services" style="width:100%;max-width:${W}px;min-width:${Math.min(W, 760)}px;height:auto;font-family:var(--sans)">
    <defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--muted)"/></marker></defs>`;
  if (vpcRows.length) {
    const top = vpcRows[0].y - 30, bot = vpcRows[vpcRows.length - 1].y + NH + 30, right = W - 14;
    svg += `<rect x="${LBL - 6}" y="${top}" width="${right - LBL + 6}" height="${bot - top}" rx="12" fill="color-mix(in srgb, var(--net) 5%, transparent)" stroke="var(--net)" stroke-width="1.5" stroke-dasharray="6 4"/>
      <text x="${right - 12}" y="${bot - 9}" text-anchor="end" font-size="12.5" font-weight="600" fill="var(--net)">${isSel('vpc') ? `VPC  aws_vpc.main  ${esc(cfgOf('vpc').cidr || '')}` : 'Existing VPC (passed in as var.vpc_id)'}</text>`;
  }
  let lastLabel = null;
  rows.forEach(row => {
    if (row.first && row.r.label !== lastLabel) {
      svg += `<text x="${PAD - 4}" y="${row.y + NH / 2 + 4}" font-size="12" fill="var(--muted)">${esc(row.r.label)}</text>`;
      lastLabel = row.r.label;
    }
  });
  for (const ed of E) {
    const dash = ed.kind === 'attach' ? ' stroke-dasharray="5 4"' : ed.kind === 'dep' ? ' stroke-dasharray="2 3"' : '';
    svg += `<path d="${edgePath(ed)}" fill="none" stroke="var(--muted)" stroke-opacity=".75" stroke-width="1.4"${dash} marker-end="url(#ah)"/>`;
  }
  for (const [id, p] of Object.entries(pos)) {
    if (id.startsWith('@')) {
      const label = id === '@internet' ? 'Internet' : 'On-premises';
      svg += `<g><rect x="${p.x}" y="${p.y}" width="${NW}" height="${NH}" rx="25" fill="var(--panel-2)" stroke="var(--line)" stroke-width="1.5"/><text x="${p.x + NW / 2}" y="${p.y + NH / 2 + 5}" text-anchor="middle" font-size="13.5" font-weight="600" fill="var(--ink)">${label}</text></g>`;
      continue;
    }
    const s = SVC[id];
    const sub = id === 's3' && fold.length ? '+ ' + fold.map(f => SVC[f].name.replace(/^S3 (Bucket )?/, '').toLowerCase()).join(', ') : s.res[0];
    const nm = s.name.split(' (')[0].replace('Application Load Balancer', 'App Load Balancer').replace('Network Load Balancer', 'Net Load Balancer').replace('Load Balancer Listener', 'LB Listener').replace('Elastic Container Registry', 'ECR Repository');
    svg += `<g class="node" tabindex="0" role="button" data-node="${id}" aria-label="Configure ${esc(s.name)}">
      <title>${esc(s.name)}: ${esc(s.res.join(', '))}</title>
      <rect class="body" x="${p.x}" y="${p.y}" width="${NW}" height="${NH}" rx="8" fill="var(--panel)" stroke="${col(id)}" stroke-width="1.5"/>
      <rect x="${p.x}" y="${p.y}" width="5" height="${NH}" rx="2" fill="${col(id)}"/>
      <text x="${p.x + 14}" y="${p.y + 21}" font-size="12.5" font-weight="600" fill="var(--ink)">${esc(nm.length > 19 ? nm.slice(0, 18) + '…' : nm)}</text>
      <text x="${p.x + 14}" y="${p.y + 38}" font-size="10.5" font-family="var(--mono)" fill="var(--muted)">${esc(sub.length > 22 ? sub.slice(0, 21) + '…' : sub)}</text></g>`;
  }
  svg += '</svg>';
  cv.innerHTML = svg;
  $$('[data-node]', cv).forEach(n => {
    n.onclick = () => openConfig(n.dataset.node);
    n.onkeydown = ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openConfig(n.dataset.node); } };
  });
}

/* ---------------- modules view ---------------- */
function renderModules(m) {
  const ids = state.sel.length ? SERVICES.filter(s => isSel(s.id)).map(s => s.id) : SERVICES.map(s => s.id);
  const groups = new Map(), none = [];
  for (const id of ids) { const mod = moduleFor(id); if (mod) { if (!groups.has(mod.key)) groups.set(mod.key, { mod, ids: [] }); groups.get(mod.key).ids.push(id); } else none.push(id); }
  const files = state.gen ? currentFiles() : live().files;
  m.innerHTML = `<div class="stack">
    <div class="panel intro"><h2>Provider resources, your configuration, and reusable modules</h2>
      <p>An <b>AWS provider resource</b> (for example <code>aws_vpc</code>) is one API object defined by hashicorp/aws. A <b>Terraform Registry module</b> is a packaged folder of many resources with its own inputs and outputs, called with a <code>module</code> block. This dashboard generates plain resources so you can see every argument; the modules below are the community-maintained terraform-aws-modules equivalents you might adopt later. Versions are not hard-coded here: pin the current release shown on each module's Registry page.</p>
      ${state.sel.length ? '' : '<p class="hint" style="margin-top:8px">No services selected, so every module is listed.</p>'}</div>
    ${[...groups.values()].map(({ mod, ids }) => {
      const src = `terraform-aws-modules/${mod.m}/aws${mod.sub ? '//' + mod.sub : ''}`;
      const svcFiles = ids.map(id => files.find(f => f.svc === id)).filter(Boolean).map(f => f.name);
      const snippet = `module "${mod.key}" {\n  source = "${src}"\n  # version = "..." # pin the current release from the Registry page\n\n${(mod.inputs || []).slice(0, 4).map(i => `  # ${i} = ...`).join('\n')}\n}`;
      return `<article class="panel"><div class="mod-title">${ids.slice(0, 4).map(id => glyph(id, 26)).join('')}<h3>${ids.map(id => esc(SVC[id].name)).join(', ')}</h3></div>
        <div class="chain">
          <div class="step"><h4><span class="source-tag reg">AWS provider resource</span></h4>${[...new Set(ids.flatMap(id => SVC[id].res))].map(t => extLink(docUrl(t), `<span class="mono">${esc(t)}</span>`)).join('')}</div>
          <div class="arrow" aria-hidden="true">${IC.arrow}</div>
          <div class="step"><h4><span class="source-tag gen">Terraform configuration</span></h4>${svcFiles.length ? svcFiles.map(n => `<span class="mono">${esc(n)}</span>`).join('') : '<span class="hint">Select these services to generate files</span>'}<span class="hint">Resources written directly in your root module.</span></div>
          <div class="arrow" aria-hidden="true">${IC.arrow}</div>
          <div class="step module"><h4><span class="source-tag mod">Terraform Registry module</span></h4>
            <span><b>Name</b> <span class="mono">${esc(mod.m)}${mod.sub ? ' (submodule ' + esc(mod.sub.split('/').pop()) + ')' : ''}</span></span>
            <span><b>Source</b> <span class="mono">${esc(src)}</span></span>
            <span><b>Version</b> <span class="hint">pin from the Registry Versions list</span></span>
            ${mod.inputs ? `<span><b>Key inputs</b></span><div class="chips">${mod.inputs.map(i => `<span class="chip">${esc(i)}</span>`).join('')}</div>` : ''}
            ${mod.outputs ? `<span><b>Key outputs</b></span><div class="chips">${mod.outputs.map(i => `<span class="chip">${esc(i)}</span>`).join('')}</div>` : ''}
            ${!mod.inputs && !mod.outputs ? '<span class="hint">See the Inputs and Outputs tabs on the Registry page.</span>' : ''}
            ${extLink(moduleUrl(mod), 'Open module on the Registry ' + IC.ext.replace('<svg', '<svg width="12" height="12"'))}
          </div>
        </div>
        <details style="padding:0 14px 14px"><summary class="hint" style="cursor:pointer">Show a module block</summary><pre class="snippet code" style="margin-top:8px">${highlightHCL(snippet).html}</pre></details>
      </article>`;
    }).join('')}
    ${none.length ? `<div class="panel intro"><h2 style="font-size:15px">No module suggested</h2><p>${none.map(id => esc(SVC[id].name)).join(', ')}: there is no widely used terraform-aws-modules module for ${none.length > 1 ? 'these' : 'this'}, or the resource is simple enough that a module adds little. Use the provider resource directly, or wrap it in your own small module.</p></div>` : ''}
  </div>`;
}

/* ---------------- learn view ---------------- */
function renderLearn(m) {
  const lq = state.learnQ;
  const glossary = [
    ['Resource', 'Something Terraform creates and manages, such as aws_vpc.main.'],
    ['Argument', 'A setting you write inside a block, such as cidr_block = var.vpc_cidr.'],
    ['Attribute', 'A value available after creation, such as aws_vpc.main.id.'],
    ['Variable', 'An input declared in variables.tf and used as var.name.'],
    ['Reference', 'An expression that reads another block, such as aws_subnet.private["private-a"].id.'],
    ['Dependency', 'The order Terraform works out from references. Explicit depends_on is the exception.'],
    ['State', 'Terraform\'s record of which real object belongs to which address.'],
  ];
  const types = Object.keys(RES_INFO).sort();
  m.innerHTML = `<div class="stack">
    <div class="panel intro"><h2>Learn Terraform</h2><p>Core vocabulary first, then topics grouped by level. Every generated file also has Learn buttons that explain these ideas against your own code.</p>
      <dl class="concepts" style="margin-top:12px">${glossary.map(([t, d]) => `<div class="concept"><dt>${t}</dt><dd>${esc(d)}</dd></div>`).join('')}</dl></div>
    <div class="topic-cols">${DIFFS.map(level => `<section class="topic-col"><h2><span class="pill ${level}">${level}</span></h2>
      ${TOPICS.filter(t => t[0] === level).map(t => `<details class="topic" ${lq && t[1] === lq ? 'open' : ''} data-topic="${esc(t[1])}"><summary>${esc(t[1])}</summary><div class="tb"><p style="margin:0">${esc(t[2])}</p>${t[3] ? `<pre class="snippet code">${/^terraform /.test(t[3]) ? esc(t[3]) : highlightHCL(t[3]).html}</pre>` : ''}</div></details>`).join('')}
    </section>`).join('')}</div>
    <div class="panel intro"><h2 style="font-size:15px">Resource reference</h2><p>Every resource and data source this dashboard can generate, with a plain-language summary and a link to its Registry page.</p>
      <div style="margin-top:12px;max-width:340px"><label class="sr" for="resQ">Filter resources</label><input class="inp mono" id="resQ" placeholder="Filter, e.g. aws_lb" spellcheck="false"></div>
      <ul class="res-list" id="resRef" style="margin-top:10px">${types.map(t => `<li data-t="${esc(t)}"><span class="addr">${esc(t)}</span><span class="hint" style="flex:2;font-family:var(--sans);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(RES_INFO[t][0])}</span><button class="btn sm" data-lt="${esc(t)}">${IC.book} Learn</button></li>`).join('')}</ul></div>
  </div>`;
  if (lq) { const d = $(`[data-topic="${CSS.escape(lq)}"]`, m); if (d) setTimeout(() => d.scrollIntoView({ block: 'center' }), 50); state.learnQ = ''; }
  $('#resQ', m).oninput = e => { const q = e.target.value.toLowerCase(); $$('#resRef li', m).forEach(li => { li.hidden = !li.dataset.t.includes(q); }); };
  $$('[data-lt]', m).forEach(b => b.onclick = () => {
    const t = b.dataset.lt;
    let block = null, fname = null;
    if (state.gen) for (const f of currentFiles()) { const hit = blocksOf(f.content).find(x => x.type === t); if (hit) { block = hit; fname = f.name; break; } }
    openLearn(t, block, fname);
  });
}

/* ---------------- CLI & auth view ---------------- */
function renderCli(m) {
  const flow = ['Write .tf files', 'terraform fmt', 'terraform validate', 'terraform plan', 'terraform apply'];
  const deploy = `# 1. Authenticate (no keys in code)\naws sso login --profile ${state.g.project}\nexport AWS_PROFILE=${state.g.project}\n\n# 2. Set your values\ncp terraform.tfvars.example terraform.tfvars\n\n# 3. Initialise, check, plan, apply\nterraform init\nterraform fmt -recursive\nterraform validate\nterraform plan -out=tfplan\nterraform apply tfplan\n\n# 4. Clean up when finished learning\nterraform destroy`;
  m.innerHTML = `<div class="stack">
    <div class="panel"><div class="intro" style="padding-bottom:4px"><h2>Recommended workflow</h2><p>Each step catches a different class of problem before anything changes in AWS.</p></div>
      <div class="flow">${flow.map((s, i) => `<span class="st ${i === 0 ? 'first' : ''}">${esc(s)}</span>${i < flow.length - 1 ? `<span class="ar" aria-hidden="true">${IC.arrow}</span>` : ''}`).join('')}</div></div>
    <div class="panel"><div class="intro" style="padding-bottom:10px"><h2>Commands</h2><p>Run these in the folder you unzip. Plan output is safe to read; apply and destroy change real resources and cost money.</p></div>
      ${CLI.map(([c, d]) => `<div class="cmd"><code>${esc(c)}</code><p>${esc(d)}</p><button class="icon-btn" data-copy="${esc(c)}" aria-label="Copy ${esc(c)}">${IC.copy}</button></div>`).join('')}</div>
    <div class="panel"><div class="intro" style="padding-bottom:10px;display:flex;align-items:flex-start;gap:12px"><div style="flex:1"><h2>Deploy the generated project</h2><p>From an unzipped download, end to end.</p></div><button class="btn sm" id="copyDeploy">${IC.copy} Copy</button></div>
      <div style="padding:0 16px 16px"><pre class="snippet code">${esc(deploy)}</pre></div></div>
    <div class="panel"><div class="intro" style="padding-bottom:12px"><h2>How Terraform gets AWS credentials</h2>
      <p>This dashboard never generates access keys, secret keys, passwords or private keys, and the generated providers.tf has no credentials in it. The AWS provider finds credentials through the standard chain below. Database passwords are handled by <code>manage_master_user_password</code>, which stores them in AWS Secrets Manager.</p></div>
      <div class="auth-grid">${AUTH.map(([t, d, c]) => `<div class="box"><h3>${esc(t)}</h3><p>${esc(d)}</p>${c ? `<pre class="snippet code">${esc(c)}</pre>` : ''}</div>`).join('')}</div></div>
  </div>`;
  $$('[data-copy]', m).forEach(b => b.onclick = () => copyText(b.dataset.copy, b.dataset.copy));
  $('#copyDeploy', m).onclick = () => copyText(deploy, 'deployment commands');
}

/* ---------------- start-up ---------------- */
function start() {
  load();
  const yr = document.getElementById('yr'); if (yr) yr.textContent = new Date().getFullYear();
  applyTheme();
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!state.theme) { applyTheme(); if (state.tab === 'arch') renderMain(); } }); } catch (e) { /* old browsers */ }
  initHeader();
  renderSummary();
  renderMain();
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#drawer').hidden) { closeDrawer(); return; }
    const t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey) { e.preventDefault(); $('#q').focus(); $('#q').select(); }
  });
  $('#drawer').addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const f = $$('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])', $('#drawer')).filter(x => x.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
