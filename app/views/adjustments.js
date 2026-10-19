import { html, useState, useApp, Money, Delta, Badge, Ref, Refs, Section, Tabs, fmtDate, fmtDateTime } from '../ui.js';
import { personName, fmtMoney, AREAS } from '../model.js';
import { partnerThreshold, position } from '../ledger.js';
import { effectText } from './forms.js';
import { describe } from './overview.js';

export function AdjustmentsView() {
  const [tab, setTab] = useState('changes');
  const { st } = useApp();
  return html`<div class="page">
    <div class="page-h"><div><h1>Changes & versions</h1><div class="muted">Every change keeps the original, who made it, why, and its tax effect. Nothing is overwritten.</div></div></div>
    <${Tabs} value=${tab} onChange=${setTab} tabs=${[{ id: 'changes', label: 'Workpaper changes', count: st.adjustments.size }, { id: 'compare', label: 'Compare versions' }, { id: 'whatif', label: 'What-ifs' }, { id: 'prior', label: 'Prior preparer vs us' }, { id: 'log', label: 'Activity log', count: st.events.length }]} />
    ${tab === 'changes' && html`<${Changes} />`}
    ${tab === 'compare' && html`<${Compare} />`}
    ${tab === 'whatif' && html`<${WhatIfs} />`}
    ${tab === 'prior' && html`<${PriorVsUs} />`}
    ${tab === 'log' && html`<${Log} />`}
  </div>`;
}

function Changes() {
  const app = useApp();
  const { st, model, user } = app;
  const [filter, setFilter] = useState('pending');
  const [sel, setSel] = useState(new Set());
  const thr = partnerThreshold(st.standards);
  const all = [...st.adjustments.values()].sort((a, b) => b.seq - a.seq);
  const list = all.filter(a => filter === 'all' || (filter === 'pending' ? ['proposed', 'awaiting_partner'].includes(a.status) : a.status === filter));
  const decide = (items, decision) => {
    const errs = [];
    const evs = [];
    for (const a of items) {
      if (a.by === user.id) { errs.push(`${a.key}: you prepared it`); continue; }
      const big = Math.max(Math.abs(a.effect.fedTax), Math.abs(a.effect.caTax)) > thr;
      if (decision === 'approve' && big && user.role !== 'partner' && a.status === 'awaiting_partner') { errs.push(`${a.key}: needs partner`); continue; }
      if (!app.can('approve')) { errs.push('not allowed'); break; }
      evs.push({ type: 'adjust.decide', data: { adjId: a.id, decision } });
    }
    if (errs.length) app.notify(`Skipped: ${errs.join('; ')}`, 'error');
    if (evs.length) { const s = app.actMany(evs, { perm: 'approve' }); setSel(new Set()); app.notify(`${decision === 'approve' ? 'Approved' : 'Rejected'} ${s.length}`, 'ok', () => app.undo(s.map(x => x.id), `${s.length} decisions`)); }
  };
  const pos = position(model, st);
  return html`<div>
    <div class="row filters">
      ${['pending', 'approved', 'rejected', 'all'].map(f => html`<button class=${'chip' + (filter === f ? ' on' : '')} onClick=${() => setFilter(f)}>${f}</button>`)}
      <span class="muted small">Changes over ${fmtMoney(thr)} of tax need partner approval (firm standard). You may not approve your own change.</span>
      ${!app.can('approve') && list.some(a => ['proposed', 'awaiting_partner'].includes(a.status)) && html`<span class="badge info">You are ${user.name} (${user.role}): switch to the reviewer or partner to approve.</span>`}
      ${sel.size > 0 && html`<button class="primary small" onClick=${() => decide(list.filter(a => sel.has(a.id)), 'approve')}>Approve ${sel.size}</button><button class="small" onClick=${() => decide(list.filter(a => sel.has(a.id)), 'reject')}>Reject ${sel.size}</button>`}
    </div>
    ${!list.length && html`<div class="empty">No changes here. Adopt findings from <a href="#/checks">Independent checks</a> or use "Adjust" on any line.</div>`}
    ${list.length > 0 && html`<table class="list adjs"><thead><tr><th></th><th>Line</th><th class="r">Engine</th><th class="r">Workpaper</th><th>Why / authority</th><th>Tax effect</th><th>By</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map(a => html`<tr class=${a.layer === 'amendment' ? 'amend' : ''}>
        <td>${['proposed', 'awaiting_partner'].includes(a.status) && app.can('approve') && a.by !== user.id && html`<input type="checkbox" checked=${sel.has(a.id)} onChange=${e => { const on = e.target.checked; setSel(prev => { const s = new Set(prev); on ? s.add(a.id) : s.delete(a.id); return s; }); }} />`}</td>
        <td><${Ref} r=${a.key.startsWith('household') ? a.key.split('.')[0] : a.key} label=${a.key} /><div class="small muted">${a.label || ''}</div></td>
        <td class="r"><${Money} v=${a.from} /></td><td class="r"><b><${Money} v=${a.to} /></b></td>
        <td class="small">${a.reason}<div class="muted">${a.authority || ''}${a.checkId ? ` · from check ${a.checkId}` : ''}${a.whatIf ? ` · engine what-if ${a.whatIf}` : ''}</div></td>
        <td class="small">${effectText(a.effect)}${Math.max(Math.abs(a.effect.fedTax), Math.abs(a.effect.caTax)) > thr ? html` <${Badge} kind="warn">partner</${Badge}>` : ''}</td>
        <td class="small">${personName(model, a.by)}<div class="muted">${fmtDate(a.at)}</div></td>
        <td><${Badge} kind=${a.status === 'approved' ? 'ok' : a.status === 'rejected' ? 'bad' : 'warn'}>${a.status.replace('_', ' ')}</${Badge}>${a.layer === 'amendment' ? html` <${Badge} kind="info">amendment</${Badge}>` : ''}
          ${a.history.map(h => html`<div class="small muted">${h.decision} · ${personName(model, h.by)}</div>`)}</td>
        <td>${['proposed', 'awaiting_partner'].includes(a.status) && app.can('approve') && a.by !== user.id && html`<button class="small" onClick=${() => decide([a], 'approve')}>Approve</button>`}
          ${(a.by === user.id || app.can('approve')) && a.status !== 'rejected' && html`<button class="link small" onClick=${() => app.undo([a.id], `change on ${a.key}`)}>withdraw</button>`}</td>
      </tr>`)}
    </tbody></table>`}
    <div class="muted small">With all live changes: federal balance <${Money} v=${pos.federal.balance_due} /> · California <${Money} v=${pos.california.balance_due} /></div>
  </div>`;
}

function Compare() {
  const app = useApp();
  const { model, st } = app;
  const opts = [...model.versions.map(v => v.version), 'workpaper'];
  const [a, setA] = useState('v1');
  const [b, setB] = useState('workpaper');
  const [q, setQ] = useState('');
  const valOf = (ver, key) => {
    if (ver === 'workpaper') { let adj = null; for (const x of st.adjustments.values()) if (x.key === key && x.status !== 'rejected') adj = x; return adj ? adj.to : model.current.byKey.get(key)?.value; }
    return model.versions.find(v => v.version === ver).byKey.get(key)?.value;
  };
  const keys = new Set([...model.versions.flatMap(v => v.lines.map(l => l.key)), ...[...st.adjustments.values()].map(x => x.key).filter(k => !k.startsWith('household'))]);
  const diffs = [...keys].filter(k => valOf(a, k) !== valOf(b, k) && (!q || k.toLowerCase().includes(q.toLowerCase())));
  const sum = ver => ver === 'workpaper' ? position(model, st) : model.versions.find(v => v.version === ver).summary;
  return html`<div>
    <div class="row filters">Compare <select value=${a} onChange=${e => setA(e.target.value)}>${opts.map(o => html`<option>${o}</option>`)}</select> with <select value=${b} onChange=${e => setB(e.target.value)}>${opts.map(o => html`<option>${o}</option>`)}</select>
      <input placeholder="Filter keys…" value=${q} onInput=${e => setQ(e.target.value)} /> <span class="muted small">${diffs.length} lines differ</span></div>
    <div class="positions">${['federal', 'california'].map(j => html`<div class="card pos"><h3>${j}</h3><table class="mini"><tbody>
      ${['total_tax', 'payments', 'balance_due'].map(f => html`<tr><td>${f.replace('_', ' ')}</td><td class="r"><${Money} v=${sum(a)[j][f]} /></td><td class="r"><${Money} v=${sum(b)[j][f]} /></td><td class="r"><${Delta} v=${sum(b)[j][f] - sum(a)[j][f]} /></td></tr>`)}
    </tbody></table></div>`)}</div>
    <div class="muted small">${model.versions.map(v => html`<div><b>${v.version}</b> ${fmtDateTime(v.computed_at)} — ${v.trigger}</div>`)}</div>
    <table class="list"><thead><tr><th>Line</th><th>Label</th><th class="r">${a}</th><th class="r">${b}</th><th class="r">Change</th></tr></thead><tbody>
      ${diffs.slice(0, 300).map(k => { const va = valOf(a, k), vb = valOf(b, k); return html`<tr><td><${Ref} r=${k} label=${k} /></td><td class="small">${model.current.byKey.get(k)?.label || ''}</td><td class="r">${va === undefined ? html`<span class="muted">—</span>` : html`<${Money} v=${va} />`}</td><td class="r">${vb === undefined ? html`<span class="muted">removed</span>` : html`<${Money} v=${vb} />`}</td><td class="r">${typeof va === 'number' && typeof vb === 'number' ? html`<${Delta} v=${Math.round((vb - va) * 100) / 100} />` : ''}</td></tr>`; })}
    </tbody></table>
  </div>`;
}

function WhatIfs() {
  const app = useApp();
  const { model, st } = app;
  const adopt = w => {
    const line = w.changed_lines?.[0];
    const e = app.act('adjust', { key: line?.key || 'whatif:' + w.id, label: w.description, from: line?.base ?? line?.old ?? 0, to: line?.alternative ?? line?.new ?? 0, reason: `Adopt engine what-if: ${w.description}`, authority: 'Engine what-if result', whatIf: w.id, fixed: { fedTax: w.federal.total_tax_change, caTax: w.california.total_tax_change, fedPay: 0, caPay: 0 }, area: 'taxcalc' }, { perm: 'adjust' });
    if (e) app.notify('What-if adopted as a proposed change', 'ok', () => app.undo([e.id], 'what-if'));
  };
  return html`<div>
    <p class="muted">Engine results for specific alternatives (base ${model.packet.what_if.alternatives[0].base_version}). Adopting one records it as a change with the engine's exact tax effect.</p>
    ${model.packet.what_if.alternatives.map(w => {
      const adopted = [...st.adjustments.values()].some(a => a.whatIf === w.id && a.status !== 'rejected');
      return html`<div class="card whatif"><header class="card-h"><h3>${w.description}</h3><div class="card-r">${adopted ? html`<${Badge} kind="info">adopted</${Badge}>` : app.can('adjust') && html`<button class="small" onClick=${() => adopt(w)}>Adopt</button>`}</div></header>
        <table class="mini"><thead><tr><th></th><th class="r">Base tax</th><th class="r">Alternative</th><th class="r">Change</th><th class="r">Penalty change</th></tr></thead><tbody>
          ${['federal', 'california'].map(j => html`<tr><td>${j}</td><td class="r"><${Money} v=${w[j].base.total_tax} /></td><td class="r"><${Money} v=${w[j].alternative.total_tax} /></td><td class="r"><${Delta} v=${w[j].total_tax_change} /></td><td class="r"><${Delta} v=${w[j].penalty_change || 0} /></td></tr>`)}
        </tbody></table>
        <details><summary class="small">${w.changed_lines.length} changed lines</summary><table class="mini"><tbody>${w.changed_lines.slice(0, 80).map(c => html`<tr><td><${Ref} r=${c.key} label=${c.key} /></td><td class="r">${fmtMoney(c.base ?? c.old)}</td><td class="r">${fmtMoney(c.alternative ?? c.new)}</td></tr>`)}</tbody></table></details>
      </div>`;
    })}
  </div>`;
}

function PriorVsUs() {
  const app = useApp();
  const pw = app.model.py.prior_preparer_workpaper;
  const rows = [
    ['Home office', 'Simplified, 300 sq ft ("2 rooms combined?" — unconfirmed)', 'Simplified, measured 220 sq ft (Sacramento) / 260 (Austin), average 240', 'D24'],
    ['Vehicle', 'Standard mileage, 7,400 miles', 'Standard mileage; log has a duplicate page — 8,100 unique miles', 'D23'],
    ['Woodworks basis', '"Assumed basis sufficient"; 2023 K-1 missing', 'Rolled forward with the 2023 K-1 (D40): 2,300 entering 2025; 21,215 excess distribution gain', 'D40'],
    ['IRA basis', '7,000 per client; Form 5498 not obtained', '7,000 confirmed by 2024 Form 5498 (D42); client\'s "no prior basis" answer overridden', 'D42'],
    ['Foreign account', 'FBAR filed by client; 8938 filed', 'FBAR flagged as outside filing; 8938 required (149,567 max); 2023 Form 3520 still unresolved', 'D36'],
    ['Rentals', 'Both passive, losses suspended', 'Losses freed (positive passive income + condo disposition)', 'D51'],
    ['Repairs', '—', 'HVAC system replacement capitalized (restoration)', 'D47'],
    ['California', 'Full-year resident (540)', 'Part-year (540NR); wage sourcing corrected to move date', 'D73'],
  ];
  return html`<div>
    <${Section} title="Prior preparer's memo (Delta River Tax Services)"><p>${pw.summary_memo}</p>
      <h4 class="sub">Open items they left</h4><ul>${pw.open_items_left_by_prior_preparer.map(o => html`<li>${o}</li>`)}</ul></${Section}>
    <${Section} title="What they did vs what we changed">
      <table class="list"><thead><tr><th>Area</th><th>2024 (prior preparer)</th><th>2025 (this workpaper)</th><th>Evidence</th></tr></thead><tbody>
        ${rows.map(r => html`<tr><td>${r[0]}</td><td class="small">${r[1]}</td><td class="small">${r[2]}</td><td><${Ref} r=${r[3]} /></td></tr>`)}
      </tbody></table>
    </${Section}>
  </div>`;
}

function Log() {
  const app = useApp();
  const { model, events, st } = app;
  const activeIds = new Set(st.events.map(e => e.id));
  return html`<div>
    <p class="muted small">The append-only log behind everything above. Undo never deletes: it appends a revert.</p>
    <table class="list"><tbody>${[...events].reverse().slice(0, 400).map(e => html`<tr class=${activeIds.has(e.id) || e.type === 'revert' ? '' : 'reverted'}>
      <td class="small muted">#${e.seq}</td><td class="small">${fmtDateTime(e.at)}<div class="muted">season ${fmtDate(e.clock)}</div></td>
      <td><b>${personName(model, e.actor)}</b> <span class="muted small">${e.role}</span></td><td>${describe(e, st)}</td>
      <td>${e.type !== 'revert' && activeIds.has(e.id) && html`<button class="link small" onClick=${() => app.undo([e.id], e.type)}>undo</button>`}${!activeIds.has(e.id) && e.type !== 'revert' ? html`<span class="small muted">undone</span>` : ''}</td>
    </tr>`)}</tbody></table>
  </div>`;
}
