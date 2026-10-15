import { html, useState, useApp, Badge, Ref, Section, Tabs, fmtDate } from '../ui.js';
import { AREAS, personName } from '../model.js';
import { signoffState } from '../ledger.js';
import { NoteCard } from './trace.js';
import { SignoffBar } from './area.js';
import { NoteForm, JudgmentForm } from './forms.js';

export function ReviewView() {
  const app = useApp();
  const { st, user, model } = app;
  const notes = [...st.notes.values()].sort((a, b) => b.at.localeCompare(a.at) || 0);
  const mine = notes.filter(n => n.status === 'open' && (n.to === user.id || (n.kind === 'review' && n.by !== user.id && myArea(app, n)) || n.replies.some(r => r.by !== user.id) && n.by === user.id));
  const [tab, setTab] = useState(mine.length ? 'inbox' : 'notes');
  const [filter, setFilter] = useState('open');
  const shown = notes.filter(n => filter === 'all' || (filter === 'open' ? n.status === 'open' : filter === 'blocking' ? n.blocking && n.status === 'open' : n.kind === 'question'));
  return html`<div class="page">
    <div class="page-h"><div><h1>Review & questions</h1><div class="muted">Review notes can block filing. Questions to the client or colleagues become evidence on the item they are attached to.</div></div></div>
    <${Tabs} value=${tab} onChange=${setTab} tabs=${[{ id: 'inbox', label: 'My inbox', count: mine.length }, { id: 'notes', label: 'All notes', count: notes.filter(n => n.status === 'open').length }, { id: 'signoffs', label: 'Sign-offs' }, { id: 'judgments', label: 'Judgments & elections', count: st.judgments.length }, { id: 'team', label: 'Assignments & deadlines' }]} />
    ${tab === 'inbox' && html`<div>${mine.length ? mine.map(n => html`<${NoteCard} n=${n} full=${true} />`) : html`<div class="empty">Nothing waiting for you.</div>`}</div>`}
    ${tab === 'notes' && html`<div>
      <div class="row filters">${['open', 'blocking', 'questions', 'all'].map(f => html`<button class=${'chip' + (filter === f ? ' on' : '')} onClick=${() => setFilter(f)}>${f}</button>`)}</div>
      <${Section} title="New note on the whole return"><${NoteForm} target="return" area=${null} /></${Section}>
      ${shown.map(n => html`<${NoteCard} n=${n} full=${true} />`)}
      ${!shown.length && html`<div class="empty">No notes.</div>`}
    </div>`}
    ${tab === 'signoffs' && html`<div>
      <${Section} title="Whole return"><${SignoffBar} scope="return" /><p class="muted small">A sign-off records a fingerprint of everything in its scope (changes, verifications, blocking notes). If any of it changes afterwards, the sign-off reopens on its own. Partner sign-off is blocked while review notes are open. You cannot sign off on work you prepared.</p></${Section}>
      <${Section} title="By area"><table class="list"><thead><tr><th>Area</th>${st.standards.review_levels.map(l => html`<th>${l}</th>`)}</tr></thead><tbody>
        ${AREAS.map(a => html`<tr><td><a href=${'#/area/' + a.id}>${a.name}</a></td>${st.standards.review_levels.map(l => { const s = signoffState(model, st, a.id, l); return html`<td>${s.state === 'signed' ? html`<${Badge} kind="ok">✓ ${personName(model, s.signoff.by)}</${Badge}>` : s.state === 'reopened' ? html`<${Badge} kind="bad">reopened</${Badge}>` : html`<span class="muted">—</span>`}</td>`; })}</tr>`)}
      </tbody></table></${Section}>
    </div>`}
    ${tab === 'judgments' && html`<div>
      <${Section} title="Record a judgment, election, due diligence or penalty decision"><${JudgmentForm} target="return" /></${Section}>
      <${Section} title="Suggested decisions for this return"><ul class="small">
        <li>Election: equipment — 100% special depreciation vs §179 vs MACRS (see What-ifs; CA differs).</li>
        <li>Due diligence (Form 8867): CTC for Theo, ODC for Ada (student, lived with you 12 months), AOTC (phased out).</li>
        <li>Penalty: estimated-tax penalty method (regular vs annualized — engine shows no difference); late-payment interest after 04/15.</li>
        <li>Judgment: crypto C6 basis on client statement + bank record; ISO California sourcing; SEP excess; home office square footage in 2024.</li>
      </ul></${Section}>
      <table class="list"><thead><tr><th>Kind</th><th>Item</th><th>Decision</th><th>Authority</th><th>By</th></tr></thead><tbody>
        ${st.judgments.map(j => html`<tr><td><${Badge}>${j.kind.replace(/_/g, ' ')}</${Badge}></td><td>${j.target && j.target !== 'return' && !j.target.startsWith('diag:') && !j.target.startsWith('check:') ? html`<${Ref} r=${j.target.replace(/^line:/, '')} />` : html`<code>${j.target}</code>`}</td><td>${j.decision}</td><td class="small">${j.authority}</td><td class="small">${personName(model, j.by)} · ${fmtDate(j.at)}</td></tr>`)}
      </tbody></table>
    </div>`}
    ${tab === 'team' && html`<${Team} />`}
  </div>`;
}

function myArea(app, n) {
  const a = app.st.assignments;
  return a.preparer === app.user.id || (n.area && a[n.area] === app.user.id);
}

function Team() {
  const app = useApp();
  const { model, st, clock } = app;
  const roles = ['preparer', 'reviewer', 'partner'];
  return html`<div>
    <${Section} title="Assignments">
      <table class="list"><tbody>${roles.map(r => html`<tr><td>${r}</td><td>${app.can('assign')
        ? html`<select value=${st.assignments[r]} onChange=${e => app.act('assign', { [r]: e.target.value }, { perm: 'assign' })}>${app.users.filter(u => u.role !== 'client').map(u => html`<option value=${u.id}>${u.name} (${u.role})</option>`)}</select>`
        : personName(model, st.assignments[r])}</td></tr>`)}</tbody></table>
      ${!app.can('assign') && html`<p class="muted small">Only the firm administrator changes assignments.</p>`}
    </${Section}>
    <${Section} title="Deadlines">
      <table class="list"><tbody>${model.packet.firm.deadlines.map(d => { const past = d.date < clock.slice(0, 10); return html`<tr class=${past ? 'muted' : ''}><td>${d.date}</td><td>${d.what}</td><td>${past ? html`<${Badge}>passed</${Badge}>` : html`<${Badge} kind="info">in ${Math.ceil((new Date(d.date) - new Date(clock)) / 864e5)} days</${Badge}>`}</td></tr>`; })}</tbody></table>
    </${Section}>
  </div>`;
}
