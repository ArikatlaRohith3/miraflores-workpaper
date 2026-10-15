import { html, useState, useApp, Money, Badge, Ref, Section, Delta, fmtDate } from '../ui.js';
import { AREAS, areaOf, fmtValue, personName } from '../model.js';
import { adjustmentFor, signoffState, scopeFingerprint, preparersOf } from '../ledger.js';
import { checkResolution } from './readiness.js';
import { PANELS } from './panels.js';

export function AreaView({ areaId }) {
  const app = useApp();
  const { model, st, checks } = app;
  const area = AREAS.find(a => a.id === areaId);
  if (!area) return html`<div class="page"><p>Unknown area.</p></div>`;
  const lines = model.current.lines.filter(l => areaOf(l.key) === areaId);
  const areaChecks = checks.filter(c => c.area === areaId && c.status !== 'pass');
  const Panel = PANELS[areaId];
  return html`<div class="page">
    <div class="page-h"><div><h1>${area.name}</h1><div class="muted">${lines.length} return lines · ${areaChecks.length} open findings</div></div>
      <${SignoffBar} scope=${areaId} /></div>
    ${areaChecks.length > 0 && html`<div class="findings-strip">${areaChecks.map(c => html`<a class=${'finding ' + c.status + ' ' + checkResolution(c, st)} href="#/checks" onClick=${() => sessionStorage.setItem('mwp.focusCheck', c.id)}>
      <${Badge} kind=${c.status === 'fail' ? 'bad' : 'warn'}>${checkResolution(c, st) === 'open' ? c.status : checkResolution(c, st)}</${Badge}> ${c.title}</a>`)}</div>`}
    ${Panel && html`<${Panel} />`}
    <${LinesTable} lines=${lines} />
    <${TimePanel} area=${area} />
  </div>`;
}

export function SignoffBar({ scope }) {
  const app = useApp();
  const { model, st, user } = app;
  const levels = st.standards.review_levels || ['preparer', 'reviewer', 'partner'];
  const prepared = preparersOf(st, scope);
  const sign = level => {
    if (!app.can('signoff:' + level)) { app.notify(`Only a ${level} can sign off at this level.`, 'error'); return; }
    if (level !== 'preparer' && prepared.has(user.id) && /may not review/i.test(st.standards.rules.join(' '))) { app.notify('Firm rule: you may not review or sign off on work you prepared.', 'error'); return; }
    if (level !== 'preparer' && scope === 'return') {
      const blocking = [...st.notes.values()].filter(n => n.status === 'open' && n.blocking);
      if (blocking.length && level === 'partner') { app.notify(`${blocking.length} open review note(s) block partner sign-off.`, 'error'); return; }
    }
    const e = app.act('signoff', { scope, level, fingerprint: scopeFingerprint(model, st, scope) }, { perm: 'signoff:' + level });
    if (e) app.notify(`Signed off ${scope} as ${level}`, 'ok', () => app.undo([e.id], 'sign-off'));
  };
  return html`<div class="signoffs">${levels.map(l => {
    const s = signoffState(model, st, scope, l);
    return html`<div class=${'signoff ' + s.state} title=${s.signoff ? `${personName(model, s.signoff.by)} · ${fmtDate(s.signoff.at)}` : ''}>
      <span class="muted small">${l}</span>
      ${s.state === 'signed' ? html`<b>✓ ${personName(model, s.signoff.by).split(' ')[0]}</b>`
        : s.state === 'reopened' ? html`<b class="warn-t">reopened</b> <button class="link small" onClick=${() => sign(l)}>re-sign</button>`
        : app.can('signoff:' + l) ? html`<button class="small" onClick=${() => sign(l)}>Sign off</button>` : html`<span class="muted">—</span>`}
    </div>`;
  })}</div>`;
}

function LinesTable({ lines }) {
  const app = useApp();
  const { model, st } = app;
  const [sel, setSel] = useState(new Set());
  const [filter, setFilter] = useState('');
  const [showLots, setShowLots] = useState(false);
  const isLot = l => /^F8949\.[A-Z]\.(?!total)/.test(l.key);
  const shown = lines.filter(l => (showLots || !isLot(l)) && (!filter || (l.key + ' ' + l.label).toLowerCase().includes(filter.toLowerCase())));
  const lotCount = lines.filter(isLot).length;
  const byForm = new Map();
  for (const l of shown) { if (!byForm.has(l.form)) byForm.set(l.form, []); byForm.get(l.form).push(l); }
  const bulkVerify = () => {
    const method = st.standards.verification_types[0];
    const stored = app.actMany([...sel].map(k => ({ type: 'verify', data: { target: 'line:' + k, method, note: 'Bulk verified' } })), { perm: 'verify' });
    setSel(new Set());
    if (stored.length) app.notify(`Verified ${stored.length} lines`, 'ok', () => app.undo(stored.map(s => s.id), `${stored.length} verifications`));
  };
  return html`<${Section} title="Return lines" right=${html`
    <input class="filter" placeholder="Filter lines…" value=${filter} onInput=${e => setFilter(e.target.value)} />
    ${lotCount > 0 && html`<label class="check small"><input type="checkbox" checked=${showLots} onChange=${e => setShowLots(e.target.checked)} /> show ${lotCount} individual lots</label>`}
    ${sel.size > 0 && html`<button class="primary small" onClick=${bulkVerify}>Verify ${sel.size} selected</button>`}`}>
    ${[...byForm].map(([form, ls]) => html`<h4 class="sub">${form}</h4>
      <table class="list lines"><tbody>${ls.map(l => {
        const adj = adjustmentFor(st, l.key);
        const ver = st.verifications.get('line:' + l.key);
        const notes = [...st.notes.values()].filter(n => n.target === 'line:' + l.key && n.status === 'open').length;
        return html`<tr class=${adj ? 'adjusted' : ''}>
          <td class="cb">${app.can('verify') && html`<input type="checkbox" checked=${sel.has(l.key)} onChange=${e => { const on = e.target.checked; setSel(prev => { const s = new Set(prev); on ? s.add(l.key) : s.delete(l.key); return s; }); }} />`}</td>
          <td class="key"><button class="link" onClick=${() => app.openTrace(l.key)}>${l.key}</button></td>
          <td>${l.label}${l.note ? html`<span class="muted small" title=${l.note}> ⓘ</span>` : ''}</td>
          <td class="r">${adj ? html`<s class="muted">${fmtValue(l)}</s>` : fmtValue(l)}</td>
          <td class="r">${adj ? html`<b><${Money} v=${adj.to} cents=${l.key.startsWith('F8949')} /></b> <${Badge} kind=${adj.status === 'approved' ? 'ok' : 'warn'}>${adj.status.replace('_', ' ')}</${Badge}>` : ''}</td>
          <td class="small muted">${(l.sources || []).length ? `${l.sources.length} src` : l.inputs?.length ? `${l.inputs.length} in` : ''}</td>
          <td>${ver ? html`<span class="ok-t" title=${ver.map(v => v.method).join(', ')}>✓</span>` : ''}${notes ? html`<${Badge} kind="warn">${notes}</${Badge}>` : ''}</td>
        </tr>`;
      })}</tbody></table>`)}
  </${Section}>`;
}

function TimePanel({ area }) {
  const app = useApp();
  const { model, st } = app;
  const [h, setH] = useState('');
  const [note, setNote] = useState('');
  const entries = st.time.filter(t => t.area === area.id);
  const total = entries.reduce((s, t) => s + Number(t.hours), 0);
  const budget = model.packet.firm.budget_hours[area.budget];
  return html`<${Section} title="Time" right=${html`<span class=${total > budget ? 'warn-t' : 'muted'}>${total} of ${budget ?? '—'} budgeted hours (${area.budget.replace(/_/g, ' ')})</span>`}>
    ${entries.map(t => html`<div class="act-row">${t.hours}h · ${personName(model, t.by)} · ${fmtDate(t.at)} ${t.note ? '— ' + t.note : ''}</div>`)}
    ${app.can('time') && html`<div class="row"><input type="number" step="0.25" min="0" placeholder="hours" value=${h} onInput=${e => setH(e.target.value)} style="width:90px" />
      <input placeholder="What was done" value=${note} onInput=${e => setNote(e.target.value)} />
      <button class="small" onClick=${() => { if (Number(h) > 0) { app.act('time', { area: area.id, hours: Number(h), note }, { perm: 'time' }); setH(''); setNote(''); } }}>Log time</button></div>`}
  </${Section}>`;
}
