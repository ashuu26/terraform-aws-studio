/* ==========================================================================
   lz.js — Azure Landing Zone designer: Enterprise or Standard template,
   subscription architecture, a live hierarchy diagram and a governance
   checklist. Templates never add services without showing them first.
   ========================================================================== */

// Governance areas and the services that implement them.
const GOV_AREAS = [
  ['Management groups', 'mgmt_groups', 'Hierarchy above subscriptions for inherited governance.'],
  ['Resource groups', 'resource_group', 'Lifecycle containers, one per workload layer in enterprise designs.'],
  ['Azure Policy', 'policy', 'Allowed locations, required tags, storage guardrails, security benchmark.'],
  ['RBAC', 'rbac', 'Role assignments to Entra groups and a least-privilege custom role.'],
  ['Tags', 'policy', 'Required on resource groups and inherited by resources (Modify policy).'],
  ['Resource locks', 'locks', 'CanNotDelete on resource groups.'],
  ['Networking', 'hub_spoke', 'Hub-and-spoke with central egress (or a single VNet for Standard).'],
  ['Security', 'firewall', 'Central firewall and private connectivity.'],
  ['Centralized monitoring', 'log_analytics', 'One workspace for platform and workload logs.'],
  ['Diagnostic settings', 'diagnostics', 'Resource logs and the Activity Log sent to the workspace.'],
  ['Cost governance', 'budget', 'A monthly budget with actual and forecast alerts.'],
];

function lzTreeSvg() {
  const mgSel = isSel('mgmt_groups');
  const mc = mgSel ? cfgOf('mgmt_groups') : { model: state.lzType, root_id: 'contoso', root_name: 'Contoso', place_current: state.lzType === 'Enterprise' ? 'corp' : 'prod' };
  const model = MG_MODELS[mc.model] || MG_MODELS.Enterprise;
  const multi = state.g.subMode === 'multi';
  const l1 = Object.entries(model.level1);
  const l2 = Object.entries(model.level2);
  const colW = 150, gap = 10, top = 16, rowH = 64;
  const W = Math.max(720, l1.length * (colW + gap) + 60);
  const cx = W / 2;
  const node = (x, y, w, label, sub, kind) => `<g><rect x="${x - w / 2}" y="${y}" width="${w}" height="40" rx="8" fill="var(--panel)" stroke="${kind === 'mg' ? 'var(--lz)' : kind === 'sub' ? 'var(--net)' : kind === 'rg' ? 'var(--cmp)' : 'var(--line)'}" stroke-width="1.5"/><text x="${x}" y="${y + 17}" text-anchor="middle" font-size="12" font-weight="600" fill="var(--ink)">${esc(label)}</text>${sub ? `<text x="${x}" y="${y + 31}" text-anchor="middle" font-size="10" font-family="var(--mono)" fill="var(--muted)">${esc(sub)}</text>` : ''}</g>`;
  const line = (x1, y1, x2, y2) => `<path d="M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}" fill="none" stroke="var(--muted)" stroke-opacity=".7" stroke-width="1.3"/>`;
  let s = '', y = top;
  s += node(cx, y, 200, 'Microsoft Entra ID tenant', 'identity for every subscription', 'x'); s += line(cx, y + 40, cx, y + rowH);
  y += rowH; s += node(cx, y, 200, 'Tenant Root Group', 'created by Azure', 'x'); s += line(cx, y + 40, cx, y + rowH);
  y += rowH; s += node(cx, y, 200, mc.root_name || 'Contoso', `${mc.root_id} (intermediate root)`, 'mg');
  const y1 = y + rowH;
  const x0 = cx - (l1.length * (colW + gap) - gap) / 2 + colW / 2;
  const pos = {};
  l1.forEach(([k, n], i) => { const x = x0 + i * (colW + gap); pos[k] = x; s += line(cx, y + 40, x, y1); s += node(x, y1, colW, n, `${mc.root_id}-${k}`, 'mg'); });
  let y2 = y1, maxY = y1 + 40;
  if (l2.length) {
    y2 = y1 + rowH;
    const byParent = {};
    l2.forEach(([k, [p, n]]) => { (byParent[p] = byParent[p] || []).push([k, n]); });
    for (const [p, kids] of Object.entries(byParent)) kids.forEach(([k, n], j) => {
      const x = pos[p], yy = y2 + j * 50;
      pos[k] = x;
      s += `<path d="M${x - colW / 2 + 8},${y1 + 40} V${yy + 20} H${x - colW / 2 + 14}" fill="none" stroke="var(--muted)" stroke-opacity=".7" stroke-width="1.3"/>`;
      s += `<g><rect x="${x - colW / 2 + 14}" y="${yy}" width="${colW - 14}" height="40" rx="8" fill="var(--panel)" stroke="var(--lz)" stroke-width="1.5"/><text x="${x + 7}" y="${yy + 17}" text-anchor="middle" font-size="12" font-weight="600" fill="var(--ink)">${esc(n)}</text><text x="${x + 7}" y="${yy + 31}" text-anchor="middle" font-size="10" font-family="var(--mono)" fill="var(--muted)">${esc(k)}</text></g>`;
      maxY = Math.max(maxY, yy + 40);
    });
  }
  // Subscriptions: in multi mode the connectivity and management subscriptions host shared services.
  const subs = [];
  const place = mc.place_current && pos[mc.place_current] ? mc.place_current : null;
  if (place) subs.push([place, 'This subscription', 'workloads']);
  if (multi && pos.connectivity) subs.push(['connectivity', 'Connectivity sub', 'hub, firewall, gateways']);
  if (multi && pos.management) subs.push(['management', 'Management sub', 'Log Analytics']);
  if (multi && !pos.connectivity && pos.prod) subs.push(['prod', 'Connectivity + mgmt', 'shared via aliases']);
  const ys = maxY + 34;
  const used = {};
  subs.forEach(([k, n, sub]) => { const x = pos[k] + (used[k] || 0) * 6; used[k] = (used[k] || 0) + 1; s += `<path d="M${x},${ys - 34 + 4} V${ys}" fill="none" stroke="var(--net)" stroke-dasharray="4 3" stroke-width="1.3"/>`; s += node(x, ys, colW, n, sub, 'sub'); });
  let H = ys + 50;
  if (place) {
    const rgc = isSel('resource_group') ? cfgOf('resource_group') : null;
    const rgs = rgc && rgc.layout === 'One per workload layer' ? ['network', 'app', 'data', 'ops'] : ['rg-' + state.g.project + '-' + state.g.env];
    const yr = ys + 70, xp = pos[place];
    const rw = 104, total = rgs.length * (rw + 8) - 8;
    rgs.forEach((r, i) => { const x = Math.min(Math.max(xp - total / 2 + rw / 2 + i * (rw + 8), rw / 2 + 4), W - rw / 2 - 4); s += line(xp, ys + 40, x, yr); s += node(x, yr, rw, r.startsWith('rg-') ? 'Resource group' : r, r.startsWith('rg-') ? r : 'resource group', 'rg'); });
    const n = state.sel.filter(id => !['mgmt_groups', 'policy', 'rbac', 'budget', 'resource_group', 'locks'].includes(id)).length;
    s += `<text x="${xp}" y="${yr + 62}" text-anchor="middle" font-size="12" fill="var(--muted)">${n} workload service${n === 1 ? '' : 's'} from your selection</text>`;
    H = yr + 76;
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Management group and subscription hierarchy for the ${esc(mc.model)} landing zone" style="width:100%;min-width:${Math.min(W, 680)}px;height:auto;font-family:var(--sans)">${s}</svg>`;
}

function renderLanding(m) {
  const t = LZ_TEMPLATES[state.lzType];
  const missing = t.ids.filter(id => !isSel(id));
  const mgc = cfgOf('mgmt_groups');
  const gov = GOV_AREAS.map(([label, id, d]) => ({ label, id, d, on: isSel(id) }));
  m.innerHTML = `<div class="stack">
    <section class="panel intro lz-hero"><p class="lz-kicker">Azure Landing Zone designer</p><h2>Generate a landing zone</h2>
      <p>Pick a template, review exactly which services it adds, then generate. Every part stays editable as a normal service afterwards.</p>
      <div class="lz-picks" style="margin-top:14px" role="radiogroup" aria-label="Landing zone type">${Object.entries(LZ_TEMPLATES).map(([k, tp]) => `
        <div class="panel lz-pick" style="${state.lzType === k ? 'box-shadow:0 0 0 2px var(--lz)' : ''}">
          <label class="chk" style="font-weight:600"><input type="radio" name="lzType" value="${k}" ${state.lzType === k ? 'checked' : ''}> ${esc(tp.title)}</label>
          <p class="hint" style="margin:0">${esc(tp.summary)}</p>
          <p class="hint" style="margin:0">${tp.ids.length} services · ${tp.subMode === 'multi' ? 'multi-subscription' : 'single subscription'}</p>
        </div>`).join('')}</div>
    </section>
    <div class="lz-split" style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:start">
      <section class="panel intro" aria-labelledby="lzCfgH"><h2 id="lzCfgH" style="font-size:16px">Configuration</h2>
        <div class="form-grid" style="margin-top:10px">
          <div class="field wide"><span id="lzSubL">Subscription architecture</span><div class="seg" role="group" aria-labelledby="lzSubL"><button data-sub="single" aria-pressed="${state.g.subMode !== 'multi'}">Single subscription</button><button data-sub="multi" aria-pressed="${state.g.subMode === 'multi'}">Multi subscription</button></div>
            <p class="hint">${state.g.subMode === 'multi' ? 'Hub networking deploys to the connectivity subscription and Log Analytics to the management subscription through provider aliases. You need permissions in each subscription; moving subscriptions between management groups needs tenant-level rights.' : 'Everything deploys to one subscription.'}</p></div>
          <label class="field"><span>Intermediate root ID</span><input class="inp mono" id="lzRoot" value="${esc(mgc.root_id)}" spellcheck="false"></label>
          <label class="field"><span>Display name</span><input class="inp" id="lzRootName" value="${esc(mgc.root_name)}"></label>
          <label class="field"><span>Region</span><select class="inp" id="lzRegion">${REGIONS.map(([r, l]) => `<option value="${r}" ${r === state.g.region ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
          <label class="field"><span>Environment</span><select class="inp" id="lzEnv">${['dev', 'test', 'prod'].map(e => `<option ${e === state.g.env ? 'selected' : ''}>${e}</option>`).join('')}</select></label>
        </div>
        <div style="margin-top:14px"><p class="sec-title">This template adds</p>
          <ul class="foundation">${t.ids.map(id => `<li><span class="mark ${isSel(id) ? 'ok' : 'warn'}" aria-hidden="true">${isSel(id) ? '✓' : '+'}</span>${esc(SVC[id].name)}<code class="hint" style="margin-left:auto">${esc(SVC[id].res[0])}</code></li>`).join('')}</ul>
          <p class="hint" style="margin-top:6px">${missing.length ? `${missing.length} service${missing.length > 1 ? 's are' : ' is'} not selected yet. Nothing is added until you choose an option below.` : 'Everything in this template is already selected.'}</p></div>
        <div class="actions" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn primary" id="lzApplyGen">Add to selection and generate</button>
          <button class="btn" id="lzApply" ${missing.length ? '' : 'disabled'}>Add ${missing.length} to selection</button>
          <button class="btn ghost" id="lzReplace">Replace selection with template</button>
        </div>
      </section>
      <section class="panel intro" aria-labelledby="lzGovH"><h2 id="lzGovH" style="font-size:16px">Governance checklist</h2>
        <ul class="foundation" style="margin-top:10px">${gov.map(g => `<li style="align-items:flex-start"><span class="mark ${g.on ? 'ok' : 'off'}" aria-hidden="true">${g.on ? '✓' : ''}</span><span><b>${esc(g.label)}</b><br><span class="hint">${esc(g.d)}</span></span>${g.on ? `<button class="icon-btn" style="margin-left:auto" data-gcfg="${g.id}" aria-label="Configure ${esc(SVC[g.id].name)}" title="Configure">${IC.gear}</button>` : `<button class="btn sm ghost" style="margin-left:auto" data-gadd="${g.id}">Add ${esc(SVC[g.id].name)}</button>`}</li>`).join('')}</ul>
      </section>
    </div>
    <section class="panel arch-wrap"><div class="arch-head"><h2>Hierarchy: ${esc(isSel('mgmt_groups') ? mgc.model : state.lzType)} landing zone</h2>${isSel('mgmt_groups') ? '<button class="btn sm" id="lzMgCfg">Configure management groups</button>' : '<span class="hint">Preview: select Management Groups to generate it</span>'}</div>
      <div class="lz-svgwrap" style="margin:0 14px 14px">${lzTreeSvg()}</div>
      <div class="legend"><span><span class="dot" style="background:var(--lz)"></span>Management group</span><span><span class="dot" style="background:var(--net)"></span>Subscription</span><span><span class="dot" style="background:var(--cmp)"></span>Resource group</span><span>Policies and roles assigned to a management group apply to everything below it.</span></div></section>
    <section class="panel intro"><h2 style="font-size:16px">Learn the governance model</h2><p>Each area of the checklist is explained in the Learn Terraform tab, with the Terraform resources that implement it.</p>
      <div class="chips" style="margin-top:10px">${LZ_TOPICS.map(tp => `<button class="btn sm ghost" data-lzt="${esc(tp.t)}">${esc(tp.t)}</button>`).join('')}</div></section>
  </div>`;
  $$('input[name="lzType"]', m).forEach(r => r.onchange = () => { state.lzType = r.value; persist(); renderMain(); });
  $$('[data-sub]', m).forEach(b => b.onclick = () => { state.g.subMode = b.dataset.sub; changed(); });
  const setMg = (k, v) => { state.cfg.mgmt_groups = Object.assign({}, state.cfg.mgmt_groups || {}, { [k]: v }); persist(); };
  $('#lzRoot', m).oninput = debounce(e => { if (/^[a-z0-9][a-z0-9-]{1,40}$/.test(e.target.value)) { setMg('root_id', e.target.value); changed(); } }, 300);
  $('#lzRootName', m).oninput = debounce(e => { setMg('root_name', e.target.value); changed(); }, 300);
  $('#lzRegion', m).onchange = e => { state.g.region = e.target.value; changed(); };
  $('#lzEnv', m).onchange = e => { state.g.env = e.target.value; changed(); };
  const apply = (replace, gen) => {
    const tp = LZ_TEMPLATES[state.lzType];
    if (replace) { if (state.sel.length && !confirm(`Replace your ${state.sel.length} selected services with the ${tp.title}?`)) return; state.sel = []; }
    for (const id of tp.ids) if (!isSel(id)) state.sel.push(id);
    for (const [k, v] of Object.entries(tp.cfg)) state.cfg[k] = Object.assign({}, v, state.cfg[k] || {}, k === 'mgmt_groups' ? { model: tp.cfg.mgmt_groups.model } : {});
    state.g.subMode = tp.subMode;
    toast(`${tp.title}: ${tp.ids.length} services in the selection`);
    changed();
    if (gen) generate();
  };
  $('#lzApplyGen', m).onclick = () => apply(false, true);
  $('#lzApply', m).onclick = () => apply(false, false);
  $('#lzReplace', m).onclick = () => apply(true, false);
  const mc = $('#lzMgCfg', m); if (mc) mc.onclick = () => openConfig('mgmt_groups');
  $$('[data-gadd]', m).forEach(b => b.onclick = () => { addRecommended([b.dataset.gadd]); });
  $$('[data-gcfg]', m).forEach(b => b.onclick = () => openConfig(b.dataset.gcfg));
  $$('[data-lzt]', m).forEach(b => b.onclick = () => { state.learnQ = b.dataset.lzt; setTab('learn'); });
}
