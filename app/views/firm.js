import { html, useState, useApp, Badge, Section, fmtDateTime } from '../ui.js';
import { AREAS, personName } from '../model.js';
import { readiness } from './readiness.js';

export function FirmView() {
  const app = useApp();
  const { model, st } = app;
  const R = readiness(app);
  return html`<div class="page">
    <div class="page-h"><div><h1>Firm</h1><div class="muted">Standards, access, time and status. Standards are edited by the firm administrator and apply immediately.</div></div></div>
    <${Section} title="Status board">
      <table class="list"><thead><tr><th>Client</th><th>Status</th><th>Failing checks</th><th>Blocking notes</th><th>Steps</th><th>Hours</th><th>Due</th></tr></thead><tbody>
        <tr><td>${model.packet.packet.name} <span class="muted small">${model.packet.packet.client_id}</span></td><td><${Badge} kind="info">${st.filing.status.replace(/_/g, ' ')}</${Badge}></td>
          <td>${R.openChecks.length}</td><td>${R.blockingNotes.length}</td><td>${R.list.filter(s => s.done).length}/${R.list.length}</td>
          <td>${st.time.reduce((s, t) => s + Number(t.hours), 0)} / ${Object.values(model.packet.firm.budget_hours).reduce((a, b) => a + b, 0)}</td><td>2026-10-15 (extended)</td></tr>
      </tbody></table>
      <p class="muted small">One client in this prototype; the same record shape works across the firm's book.</p>
    </${Section}>
    <${Standards} />
    <${Section} title="Time against budget">
      <table class="list"><thead><tr><th>Budget area</th><th class="r">Budget</th><th class="r">Logged</th><th></th></tr></thead><tbody>
        ${Object.entries(model.packet.firm.budget_hours).map(([k, b]) => { const areas = AREAS.filter(a => a.budget === k).map(a => a.id); const h = st.time.filter(t => areas.includes(t.area) || t.area === k).reduce((s, t) => s + Number(t.hours), 0); return html`<tr><td>${k.replace(/_/g, ' ')}</td><td class="r">${b}</td><td class=${'r' + (h > b ? ' warn-t' : '')}>${h}</td><td><div class="bar"><div style=${`width:${Math.min(100, h / b * 100)}%`} class=${h > b ? 'over' : ''}></div></div></td></tr>`; })}
      </tbody></table>
    </${Section}>
    <${Section} title="People and access">
      <table class="list"><thead><tr><th>Name</th><th>Role</th><th>Credential</th><th>Sensitive data</th><th>Active from</th><th>Note</th></tr></thead><tbody>
        ${model.packet.firm.staff.map(s => html`<tr><td>${s.name}</td><td>${s.role.replace('_', ' ')}</td><td>${s.credential || ''}</td><td>${s.sensitive_data_clearance ? html`<${Badge} kind="ok">cleared</${Badge}>` : html`<${Badge} kind="bad">masked</${Badge}>`}</td><td>${s.active_from}</td><td class="small">${s.note || ''}</td></tr>`)}
      </tbody></table>
    </${Section}>
    <${Section} title=${`Sensitive data view log (${st.viewLog.length})`}>
      ${app.can('view_logs') ? html`<table class="list"><tbody>${[...st.viewLog].reverse().map(v => html`<tr><td class="small">${fmtDateTime(v.at)}</td><td>${personName(model, v.by)} <span class="muted small">${v.role}</span></td><td>${v.what}</td></tr>`)}</tbody></table>
        ${!st.viewLog.length && html`<p class="muted">No unmasked views yet. Every reveal of an SSN, account number or PIN is logged here.</p>`}`
        : html`<p class="muted">Only the firm administrator and quality reviewer see the view log.</p>`}
    </${Section}>
  </div>`;
}

function Standards() {
  const app = useApp();
  const s = app.st.standards;
  const editable = app.can('standards');
  const [pct, setPct] = useState(s.variance_review.flag_if_change_over_percent);
  const [amt, setAmt] = useState(s.variance_review.and_over_amount);
  const [newRule, setNewRule] = useState('');
  const [newType, setNewType] = useState('');
  const save = patch => { const e = app.act('standards.update', { patch }, { perm: 'standards' }); if (e) app.notify('Standards updated', 'ok', () => app.undo([e.id], 'standards change')); };
  return html`<${Section} title="Firm standards" right=${!editable && html`<span class="muted small">Read-only for ${app.user.role}</span>`}>
    <div class="grid2">
      <div>
        <h4>Variance review</h4>
        <div class="row">Flag if change over <input type="number" value=${pct} onInput=${e => setPct(e.target.value)} disabled=${!editable} style="width:70px" />% and over <input type="number" value=${amt} onInput=${e => setAmt(e.target.value)} disabled=${!editable} style="width:90px" />
          ${editable && html`<button class="small" onClick=${() => save({ variance_review: { ...s.variance_review, flag_if_change_over_percent: Number(pct), and_over_amount: Number(amt) } })}>Save</button>`}</div>
        <h4>Verification types</h4>
        <ul>${s.verification_types.map(t => html`<li>${t.replace(/_/g, ' ')}</li>`)}</ul>
        ${editable && html`<div class="row"><input placeholder="new type, e.g. recomputed_independently" value=${newType} onInput=${e => setNewType(e.target.value)} /><button class="small" onClick=${() => { if (newType) { save({ verification_types: [...s.verification_types, newType.replace(/\s+/g, '_')] }); setNewType(''); } }}>Add</button></div>`}
        <h4>Review levels</h4><p>${s.review_levels.join(' → ')}</p>
      </div>
      <div>
        <h4>Rules (enforced)</h4>
        <ul class="rules">${s.rules.map((r, i) => html`<li>${r}${editable && html` <button class="link small" onClick=${() => save({ rules: s.rules.filter((_, j) => j !== i) })}>remove</button>`}</li>`)}</ul>
        ${editable && html`<div class="row"><input placeholder="Add a rule" value=${newRule} onInput=${e => setNewRule(e.target.value)} /><button class="small" onClick=${() => { if (newRule) { save({ rules: [...s.rules, newRule] }); setNewRule(''); } }}>Add</button></div>`}
        <h4>Required steps</h4><ol class="small">${s.required_steps.map(x => html`<li>${x}</li>`)}</ol>
      </div>
    </div>
  </${Section}>`;
}
