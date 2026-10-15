import { html, useState, useEffect, useApp, Badge, Refs, Ref, Section, Tabs, Delta } from '../ui.js';
import { AREAS, areaOf } from '../model.js';
import { taxEffect } from '../ledger.js';
import { checkResolution } from './readiness.js';
import { effectText } from './forms.js';

export function ChecksView() {
  const app = useApp();
  const { checks, st } = app;
  const [tab, setTab] = useState('open');
  const [selected, setSelected] = useState(new Set());
  const [focus, setFocus] = useState(() => sessionStorage.getItem('mwp.focusCheck'));
  useEffect(() => { if (focus) { sessionStorage.removeItem('mwp.focusCheck'); setTimeout(() => document.getElementById('chk-' + focus)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); } }, []);
  const withRes = checks.map(c => ({ c, res: checkResolution(c, st) }));
  const groups = {
    open: withRes.filter(x => x.c.status === 'fail' && ['open', 'partial'].includes(x.res)),
    warn: withRes.filter(x => (x.c.status === 'warn' || x.c.status === 'info') && x.res === 'open'),
    resolved: withRes.filter(x => ['adopted', 'dismissed', 'judged'].includes(x.res)),
    pass: withRes.filter(x => x.c.status === 'pass'),
  };
  const list = groups[tab];
  const adoptable = list.filter(x => (x.c.proposals || []).length && x.res !== 'adopted');

  const adopt = items => {
    const evs = [];
    for (const { c } of items) for (const p of c.proposals || []) {
      if (p.override) {
        if (!st.overrides.has(p.key)) evs.push({ type: 'override', data: { target: p.key, from: p.from, value: p.to, reason: p.reason, checkId: c.id, evidence: c.refs } });
        continue;
      }
      if ([...st.adjustments.values()].some(a => a.checkId === c.id && a.key === p.key && a.status !== 'rejected')) continue;
      evs.push({ type: 'adjust', data: { key: p.key, label: p.label || app.model.current.byKey.get(p.key)?.label, from: p.from, to: p.to, effects: p.effects, fixed: p.fixed, reason: p.reason, authority: p.authority, checkId: c.id, area: c.area, evidence: c.refs, newLine: p.newLine, whatIf: p.whatIf } });
    }
    if (!evs.length) return;
    if (!app.can('adjust')) { app.notify(`${app.user.role} cannot propose adjustments.`, 'error'); return; }
    const stored = app.actMany(evs, { perm: 'adjust' });
    setSelected(new Set());
    app.notify(`Proposed ${stored.length} change(s) from ${items.length} check(s)`, 'ok', () => app.undo(stored.map(s => s.id), `${stored.length} adopted change(s)`));
  };
  const dismiss = (c, reason) => {
    const e = app.act('check.dismiss', { checkId: c.id, reason }, { perm: 'judgment' });
    if (e) app.notify('Dismissed', 'ok', () => app.undo([e.id], 'dismissal'));
  };
  const ask = c => {
    const stored = app.actMany((c.questions || []).map(q => ({ type: 'note', data: { kind: 'question', to: 'client', text: q, target: 'check:' + c.id, area: c.area } })), { perm: 'question' });
    if (stored.length) app.notify(`Sent ${stored.length} question(s) to the client`, 'ok', () => app.undo(stored.map(s => s.id), 'questions'));
  };
  const totalEffect = adoptable.flatMap(x => x.c.proposals).reduce((t, p) => { const e = taxEffect(app.model, p); return { fed: t.fed + e.fedTax - e.fedPay, ca: t.ca + e.caTax - e.caPay }; }, { fed: 0, ca: 0 });

  return html`<div class="page">
    <div class="page-h"><div><h1>Independent checks</h1>
      <div class="muted">${checks.length} checks recompute the return from the documents themselves, without trusting the engine. Each failure carries its evidence and, where the fix is mechanical, a proposed change.</div></div></div>
    <${Tabs} value=${tab} onChange=${t => { setTab(t); setSelected(new Set()); }} tabs=${[
      { id: 'open', label: 'Failing', count: groups.open.length }, { id: 'warn', label: 'Needs judgment', count: groups.warn.length },
      { id: 'resolved', label: 'Resolved', count: groups.resolved.length }, { id: 'pass', label: 'Passing', count: groups.pass.length }]} />
    ${adoptable.length > 0 && html`<div class="bulkbar">
      <label class="check"><input type="checkbox" checked=${selected.size === adoptable.length} onChange=${e => setSelected(e.target.checked ? new Set(adoptable.map(x => x.c.id)) : new Set())} /> Select all with proposals (${adoptable.length})</label>
      <span class="muted small">If all adopted: federal balance <${Delta} v=${totalEffect.fed} />, California <${Delta} v=${totalEffect.ca} /></span>
      <button class="primary small" disabled=${!selected.size} onClick=${() => adopt(adoptable.filter(x => selected.has(x.c.id)))}>Adopt ${selected.size || ''} selected</button>
    </div>`}
    <div class="checks">${list.map(({ c, res }) => html`<${CheckCard} c=${c} res=${res} focused=${focus === c.id}
      selectable=${(c.proposals || []).length && res !== 'adopted'} selected=${selected.has(c.id)}
      onSelect=${on => setSelected(prev => { const s = new Set(prev); on ? s.add(c.id) : s.delete(c.id); return s; })}
      onAdopt=${() => adopt([{ c }])} onDismiss=${r => dismiss(c, r)} onAsk=${() => ask(c)} />`)}
      ${!list.length && html`<div class="empty">Nothing here.</div>`}
    </div>
  </div>`;
}

function CheckCard({ c, res, selectable, selected, onSelect, onAdopt, onDismiss, onAsk, focused }) {
  const app = useApp();
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState('');
  const area = AREAS.find(a => a.id === c.area);
  const kind = c.status === 'fail' ? 'bad' : c.status === 'pass' ? 'ok' : 'warn';
  const asked = [...app.st.notes.values()].filter(n => n.target === 'check:' + c.id);
  return html`<article class=${'check-card ' + c.status + (focused ? ' focused' : '')} id=${'chk-' + c.id}>
    <header>
      ${selectable ? html`<input type="checkbox" checked=${selected} onChange=${e => onSelect(e.target.checked)} aria-label="Select" />` : ''}
      <${Badge} kind=${kind}>${c.status}</${Badge}>
      <h3>${c.title}</h3>
      <span class="muted small">${area?.name}</span>
      ${res !== 'open' && res !== 'pass' && html`<${Badge} kind="info">${res}</${Badge}>`}
    </header>
    <p>${c.why}</p>
    ${c.rows?.length > 0 && html`<table class="mini recon"><tbody>${c.rows.map(r => html`<tr><td>${r[0]}</td><td class="r">${r[1]}</td></tr>`)}</tbody></table>`}
    <div class="refs-line"><span class="muted small">Evidence</span> <${Refs} list=${c.refs} /></div>
    ${c.lines?.length > 0 && html`<div class="refs-line"><span class="muted small">Lines</span> ${c.lines.slice(0, 10).map(k => html`<${Ref} r=${k} label=${k} />`)}${c.lines.length > 10 ? html`<span class="muted small"> +${c.lines.length - 10} more</span>` : ''}</div>`}
    ${c.proposals?.length > 0 && html`<div class="proposals">
      <div class="muted small">Proposed ${c.proposals.length > 1 ? 'changes' : 'change'}</div>
      ${c.proposals.map(p => { const e = taxEffect(app.model, p); return html`<div class="proposal"><code>${p.key}</code> <span class="num">${fmt(p.from)} → <b>${fmt(p.to)}</b></span> <span class="muted small">${p.reason}</span> <span class="eff">${effectText(e)}</span></div>`; })}
    </div>`}
    ${asked.length > 0 && html`<div class="small muted">Asked: ${asked.map(n => html`<div>“${n.text}” — ${n.replies.length ? html`<b>answered:</b> ${n.replies[n.replies.length - 1].text}` : 'awaiting answer'}</div>`)}</div>`}
    ${app.st.dismissed.has(c.id) && html`<div class="small muted">Dismissed: ${app.st.dismissed.get(c.id).reason}</div>`}
    ${c.status !== 'pass' && res !== 'adopted' && html`<footer>
      ${c.proposals?.length > 0 && html`<button class="primary small" onClick=${onAdopt}>Adopt</button>`}
      ${c.questions?.length > 0 && !asked.length && html`<button class="small" onClick=${onAsk}>Ask client</button>`}
      ${!app.st.dismissed.has(c.id) && html`<button class="small" onClick=${() => setDismissing(!dismissing)}>Dismiss…</button>`}
    </footer>`}
    ${dismissing && html`<div class="row"><input placeholder="Why this is not an issue (required)" value=${reason} onInput=${e => setReason(e.target.value)} /><button class="small" onClick=${() => { if (reason.trim()) { onDismiss(reason); setDismissing(false); } }}>Dismiss</button></div>`}
  </article>`;
}

const fmt = v => typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(v);
