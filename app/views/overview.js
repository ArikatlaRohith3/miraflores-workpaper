import { html, useState, useApp, Money, Delta, Badge, Ref, Section, fmtDate, fmtDateTime } from '../ui.js';
import { AREAS, areaOf, personName, fmtMoney } from '../model.js';
import { position, adjustmentFor, signoffState } from '../ledger.js';
import { readiness, checkResolution } from './readiness.js';
import { JudgmentForm } from './forms.js';

const SUMMARY_LINES = ['F1040.1z', 'F1040.2b', 'F1040.3b', 'F1040.4b', 'F1040.7', 'F1040.8', 'F1040.9', 'F1040.10', 'F1040.11', 'F1040.12', 'F1040.13', 'F1040.15', 'F1040.16', 'F1040.19', 'F1040.23', 'F1040.24', 'F1040.25a', 'F1040.26', 'F1040.33', 'F1040.37'];
const CA_LINES = ['F540NR.17', 'F540NR.32', 'F540NR.35', 'F540NR.64', 'F540NR.71', 'F540NR.72', 'F540NR.78', 'F540NR.97'];

export function Overview({ sinceSeen }) {
  const app = useApp();
  const { model, st, events, user } = app;
  const R = readiness(app);
  const base = model.current.summary;
  const approved = position(model, st, ['approved']);
  const all = position(model, st);
  const [explain, setExplain] = useState(null);
  const recent = events.filter(e => e.seq > (st.lastSeen[user.id] || 0) && e.actor !== user.id && !['seen', 'view.sensitive'].includes(e.type)).slice(-12).reverse();

  return html`<div class="page">
    <div class="page-h">
      <div><h1>Return overview</h1><div class="muted">Engine ${model.current.version} (${fmtDate(model.current.computed_at)}) + ${st.adjustments.size} workpaper changes · status <b>${st.filing.status.replace(/_/g, ' ')}</b></div></div>
    </div>

    ${sinceSeen > 0 && html`<div class="card since">
      <header class="card-h"><h3>${sinceSeen} change(s) by others since you last looked</h3>
      <div class="card-r"><button class="small" onClick=${() => app.act('seen', { seq: events[events.length - 1].seq })}>Mark all seen</button></div></header>
      <ul class="feed">${recent.map(e => html`<li><b>${personName(model, e.actor)}</b> ${describe(e, st)} <span class="muted small">${fmtDateTime(e.at)}</span></li>`)}</ul>
    </div>`}

    <div class="positions">
      ${['federal', 'california'].map(j => html`<div class="card pos">
        <h3>${j === 'federal' ? 'Federal' : 'California 540NR'}</h3>
        <table class="mini"><thead><tr><th></th><th class="r">Engine v3</th><th class="r">Approved</th><th class="r">Incl. proposed</th></tr></thead><tbody>
          <tr><td>Total tax</td><td class="r"><${Money} v=${base[j].total_tax} /></td><td class="r"><${Money} v=${approved[j].total_tax} /></td><td class="r"><${Money} v=${all[j].total_tax} /></td></tr>
          <tr><td>Payments</td><td class="r"><${Money} v=${base[j].payments} /></td><td class="r"><${Money} v=${approved[j].payments} /></td><td class="r"><${Money} v=${all[j].payments} /></td></tr>
          <tr class="strong"><td>${j === 'federal' ? 'Balance due / (refund)' : 'Balance due / (refund)'}</td><td class="r"><${Money} v=${base[j].balance_due} /></td><td class="r"><${Money} v=${approved[j].balance_due} /></td><td class="r"><${Money} v=${all[j].balance_due} /></td></tr>
        </tbody></table>
        <div class="muted small">Change vs engine (incl. proposed): tax <${Delta} v=${all[j].total_tax - base[j].total_tax} />${j === 'federal' ? html` · penalty ${fmtMoney(base.federal.penalty)} (engine; recompute)` : ''}</div>
      </div>`)}
      <div class="card pos">
        <h3>Ready to file?</h3>
        <ul class="ready">
          <li class=${R.openChecks.length ? 'no' : 'yes'}><a href="#/checks">${R.openChecks.length} failing checks unresolved</a></li>
          <li class=${R.blockingNotes.length ? 'no' : 'yes'}><a href="#/review">${R.blockingNotes.length} blocking review notes</a></li>
          <li class=${R.pendingPartner.length ? 'no' : 'yes'}><a href="#/adjustments">${R.pendingPartner.length} changes awaiting approval</a></li>
          <li class=${R.list.every(s => s.done) ? 'yes' : 'no'}>${R.list.filter(s => s.done).length} of ${R.list.length} required steps</li>
        </ul>
      </div>
    </div>

    <${Section} title="Required steps (firm standard)">
      <ul class="steps">${R.list.map(s => html`<li class=${s.done ? 'done' : ''}>
        <span class="tick">${s.done ? '✓' : '○'}</span><span>${s.name}</span>
        <span class="muted small">${s.detail || ''}${s.auto ? ' · tracked automatically' : ''}</span>
        ${!s.auto && !s.done && app.can('step') && html`<button class="small" onClick=${() => app.act('step', { step: s.name }, { perm: 'step' })}>Mark done</button>`}
      </li>`)}</ul>
    </${Section}>

    <${Section} title="Return summary vs last year" right=${html`<span class="muted small">Flags: change over ${st.standards.variance_review.flag_if_change_over_percent}% and ${fmtMoney(st.standards.variance_review.and_over_amount)}</span>`}>
      <${SummaryTable} keys=${SUMMARY_LINES} flags=${R.flags} explained=${R.explained} onExplain=${setExplain} />
      <h4 class="sub">California</h4>
      <${SummaryTable} keys=${CA_LINES} flags=${R.flags} explained=${R.explained} onExplain=${setExplain} />
      ${explain && html`<div class="inline-form"><b>Explain variance on ${explain}</b><${JudgmentForm} target=${'line:' + explain} kinds=${['variance_explanation']} onDone=${() => setExplain(null)} /></div>`}
    </${Section}>

    <${Section} title="Areas">
      <div class="area-grid">${AREAS.map(a => html`<${AreaTile} a=${a} />`)}</div>
    </${Section}>

    <${Section} title=${`Engine diagnostics (${model.current.diagnostics.length})`}>
      <table class="list"><tbody>${model.current.diagnostics.map(d => {
        const j = st.judgments.filter(x => x.target === 'diag:' + d.code).pop();
        return html`<tr><td><${Badge} kind=${d.severity === 'warning' ? 'warn' : 'neutral'}>${d.severity}</${Badge}></td><td><code>${d.code}</code><div>${d.message}</div><div class="refs">${d.refs.map(r => html`<${Ref} r=${r} />`)}</div></td>
          <td>${j ? html`<span class="small">✓ ${j.decision} <span class="muted">— ${personName(model, j.by)}</span></span>` : html`<${DiagResolve} code=${d.code} />`}</td></tr>`;
      })}</tbody></table>
    </${Section}>
  </div>`;
}

function DiagResolve({ code }) {
  const [open, setOpen] = useState(false);
  return open ? html`<${JudgmentForm} target=${'diag:' + code} kinds=${['disposition', 'judgment']} onDone=${() => setOpen(false)} />` : html`<button class="small" onClick=${() => setOpen(true)}>Disposition</button>`;
}

function SummaryTable({ keys, flags, explained, onExplain }) {
  const { model, st } = useApp();
  return html`<table class="list summary"><thead><tr><th>Line</th><th class="r">2024</th><th class="r">2025 engine</th><th class="r">Workpaper</th><th class="r">Change</th><th></th></tr></thead><tbody>
    ${keys.map(k => {
      const l = model.current.byKey.get(k); if (!l) return null;
      const py = model.pyLines[k];
      const adj = adjustmentFor(st, k);
      const f = flags.find(x => x.key === k);
      return html`<tr class=${f ? 'flag' : ''}>
        <td><${Ref} r=${k} label=${k} /> <span class="muted">${l.label}</span></td>
        <td class="r">${py !== undefined ? html`<${Money} v=${py} />` : html`<span class="muted">—</span>`}</td>
        <td class="r"><${Money} v=${l.value} /></td>
        <td class="r">${adj ? html`<b><${Money} v=${adj.to} /></b>` : html`<span class="muted">same</span>`}</td>
        <td class="r">${py !== undefined && typeof l.value === 'number' ? html`<${Delta} v=${l.value - py} />` : ''}</td>
        <td>${f ? (explained(f) ? html`<${Badge} kind="ok">explained</${Badge}>` : html`<button class="small" onClick=${() => onExplain(k)}>Explain</button>`) : ''}</td>
      </tr>`;
    })}</tbody></table>`;
}

function AreaTile({ a }) {
  const app = useApp();
  const { model, st, checks } = app;
  const lines = model.current.lines.filter(l => areaOf(l.key) === a.id && typeof l.value === 'number');
  const verified = lines.filter(l => st.verifications.has('line:' + l.key)).length;
  const fails = checks.filter(c => c.area === a.id && c.status === 'fail' && ['open', 'partial'].includes(checkResolution(c, st))).length;
  const notes = [...st.notes.values()].filter(n => n.area === a.id && n.status === 'open').length;
  const so = ['preparer', 'reviewer'].map(l => [l, signoffState(model, st, a.id, l).state]);
  const hours = st.time.filter(t => t.area === a.id).reduce((s, t) => s + Number(t.hours), 0);
  const budget = model.packet.firm.budget_hours[a.budget];
  return html`<a class="area-tile" href=${'#/area/' + a.id}>
    <b>${a.name}</b>
    <div class="bar"><div style=${`width:${lines.length ? verified / lines.length * 100 : 0}%`}></div></div>
    <div class="small muted">${verified}/${lines.length} lines verified</div>
    <div class="tile-badges">
      ${fails ? html`<${Badge} kind="bad">${fails} failing</${Badge}>` : html`<${Badge} kind="ok">checks ok</${Badge}>`}
      ${notes ? html`<${Badge} kind="warn">${notes} notes</${Badge}>` : ''}
      ${so.map(([l, s]) => html`<${Badge} kind=${s === 'signed' ? 'ok' : s === 'reopened' ? 'bad' : 'neutral'} title=${l + ' sign-off'}>${l[0].toUpperCase()} ${s === 'signed' ? '✓' : s === 'reopened' ? 'reopened' : '—'}</${Badge}>`)}
      ${budget ? html`<span class=${'small ' + (hours > budget ? 'warn-t' : 'muted')}>${hours}/${budget}h</span>` : ''}
    </div>
  </a>`;
}

export function describe(e, st) {
  const d = e.data || {};
  switch (e.type) {
    case 'adjust': return html`proposed a change on <${Ref} r=${d.key} label=${d.key} /> (${d.reason})`;
    case 'adjust.decide': return `${d.decision}d an adjustment${d.note ? ': ' + d.note : ''}`;
    case 'verify': return html`verified <${Ref} r=${d.target.replace(/^line:/, '')} label=${d.target.replace(/^line:/, '')} /> (${d.method.replace(/_/g, ' ')})`;
    case 'note': return `added a ${d.kind}${d.kind === 'question' ? ' to ' + (d.to === 'client' ? 'the client' : d.to) : ''}: "${d.text.slice(0, 80)}"`;
    case 'note.reply': return `replied: "${d.text.slice(0, 80)}"`;
    case 'note.status': return `marked a note ${d.status}`;
    case 'signoff': return `signed off ${d.scope} as ${d.level}`;
    case 'judgment': return `recorded a ${d.kind.replace(/_/g, ' ')}: ${d.decision.slice(0, 80)}`;
    case 'attach': return `attached ${d.name}`;
    case 'check.dismiss': return `dismissed check ${d.checkId}`;
    case 'replay': return `replayed: ${d.event.replace(/_/g, ' ')}`;
    case 'filing': return `filing: ${d.action.replace(/_/g, ' ')}`;
    case 'override': return `corrected ${d.target}`;
    case 'standards.update': return 'updated firm standards';
    case 'time': return `logged ${d.hours}h on ${d.area}`;
    case 'step': return `completed step "${d.step}"`;
    case 'ai': return `used AI (${d.task.replace(/_/g, ' ')}) on ${d.target}`;
    case 'ai.decision': return `${d.decision}ed an AI suggestion`;
    case 'link': return html`linked <${Ref} r=${d.from.replace(/^line:/, '')} /> to <${Ref} r=${d.to} />`;
    case 'revert': return `undid ${d.label || d.ids.length + ' change(s)'}`;
    default: return e.type;
  }
}
