import { html, useState, useApp, Money, Badge, Ref, Refs, Section, Modal, fmtDate, fmtDateTime } from '../ui.js';
import { personName, fmtMoney, hash } from '../model.js';
import { position, scopeFingerprint, activeAdjustments } from '../ledger.js';
import { readiness } from './readiness.js';
import { checkResolution } from './readiness.js';

export function FilingView() {
  const app = useApp();
  return html`<div class="page">
    <div class="page-h"><div><h1>Filing & after</h1><div class="muted">Replay the season, file, handle the rejection, freeze, answer the notice, roll forward.</div></div></div>
    <${Workflow} />
    <${Timeline} />
    <${Notices} />
    <${NextYear} />
    <${Records} />
  </div>`;
}

function snapshot(app) {
  const { model, st } = app;
  const pos = position(model, st, ['approved']);
  return { position: { federal: pos.federal, california: pos.california }, approved: activeAdjustments(st, ['approved']).map(a => a.id), fingerprint: scopeFingerprint(model, st, 'return'), at: app.clock };
}

function Workflow() {
  const app = useApp();
  const { st, model } = app;
  const R = readiness(app);
  const f = st.filing;
  const [copy, setCopy] = useState(false);
  const gate = [
    ...R.blockingNotes.map(n => `Blocking review note: ${n.text.slice(0, 60)}`),
    ...R.list.filter(s => !s.done && !/Client approval/.test(s.name)).map(s => `Step: ${s.name}`),
    ...R.openChecks.map(c => `Failing check: ${c.title.slice(0, 70)}`),
  ];
  const ssnFixed = st.overrides.has('household:theo.ssn');
  const sendToClient = () => {
    if (gate.length && !confirm(`${gate.length} item(s) are not done:\n\n${gate.slice(0, 8).join('\n')}\n\nThe firm standard says these block filing. Record an override and send anyway? (The override is logged.)`)) return;
    app.act('filing', { action: 'ready', snapshot: snapshot(app), overriddenGate: gate }, { perm: 'filing' });
  };
  const transmit = () => {
    const ag = model.packet.tax_agency_records.efile;
    if (R.blockingNotes.length) { app.notify(`Firm rule: open review notes block filing (${R.blockingNotes.length} open). Resolve them in Review & questions.`, 'error'); return; }
    const reject = !ssnFixed && !f.submissions.some(s => s.status === 'rejected');
    const list = reject
      ? [{ type: 'filing', data: { action: 'transmit', submission: ag[0] }, clock: ag[0].date }, { type: 'filing', data: { action: 'transmit', submission: ag[1] }, clock: ag[1].date },
         { type: 'note', data: { kind: 'review', blocking: true, text: `E-file rejected: ${ag[0].errors[0].code} — ${ag[0].errors[0].message}`, target: 'household:theo', area: 'deductions' } },
         { type: 'replay', data: { timelineId: 'tl-21', event: 'efile_rejected', at: '2026-07-13T17:04:00Z' } }]
      : ssnFixed ? [{ type: 'filing', data: { action: 'transmit', submission: ag[2] }, clock: ag[2].date }, { type: 'filing', data: { action: 'transmit', submission: ag[3] }, clock: ag[3].date },
         { type: 'filing', data: { action: 'freeze', snapshot: snapshot(app) }, clock: ag[3].date },
         { type: 'replay', data: { timelineId: 'tl-23', event: 'efile_accepted_federal', at: '2026-07-14T16:22:00Z' } },
         { type: 'replay', data: { timelineId: 'tl-24', event: 'efile_accepted_california', at: '2026-07-15T02:10:00Z' } }]
      : null;
    if (!list) { app.notify('The rejection reason (dependent SSN) is not fixed yet. Correct Theo\'s SSN from the Social Security card first.', 'error'); return; }
    app.actMany(list, { perm: 'filing' });
    app.notify(reject ? 'Federal return rejected by the IRS — see the new blocking note.' : 'Accepted. The return is frozen; further changes go to an amendment layer.');
  };
  const steps = [
    ['Extension', f.extension || st.replayed.has('extension-2026-04-14') || app.clock > '2026-04-14', 'Form 4868 with 36,000 on 04/14/2026 (from v2)'],
    ['Ready for client', ['ready_for_client', 'client_approved', 'rejected', 'accepted', 'filed', 'amending'].includes(f.status) || !!f.clientApproval, 'Gate: reviews, sign-offs, checks'],
    ['Client approval & 8879', !!f.clientApproval, f.clientApproval ? `Signed ${fmtDate(f.clientApproval.at)}` : 'Client signs in the portal'],
    ['Transmitted', f.submissions.length > 0, f.submissions.map(s => `${s.jurisdiction} ${s.status}`).join(' · ')],
    ['Filed & frozen', !!f.frozen, f.frozen ? `Frozen ${fmtDateTime(f.frozen.at)} by ${personName(model, f.frozen.by)}` : ''],
  ];
  return html`<${Section} title="Filing workflow" right=${html`<${Badge} kind="info">${f.status.replace(/_/g, ' ')}</${Badge}>`}>
    <ol class="flow">${steps.map(([n, done, d]) => html`<li class=${done ? 'done' : ''}><b>${n}</b><span class="small muted">${d}</span></li>`)}</ol>
    <div class="row">
      ${!f.clientApproval && f.status === 'in_preparation' && html`<button class="primary" onClick=${sendToClient} disabled=${!app.can('filing')}>Send to client for approval</button>`}
      ${f.clientApproval && !f.frozen && html`<button class="primary" onClick=${transmit} disabled=${!app.can('filing')}>Transmit e-file</button>`}
      ${f.frozen && f.status !== 'amending' && html`<button onClick=${() => { const r = prompt('Reason for amendment (Form 1040-X / 540X)'); if (r) app.act('filing', { action: 'amend.start', reason: r }, { perm: 'freeze' }); }}>Start amendment</button>`}
      <button onClick=${() => setCopy(true)}>Client copy</button>
      ${!app.can('filing') && html`<span class="muted small">Filing actions need reviewer or partner role.</span>`}
    </div>
    ${f.submissions.length > 0 && html`<table class="list"><tbody>${f.submissions.map(s => html`<tr><td>${fmtDateTime(s.date)}</td><td>${s.jurisdiction}</td><td><code>${s.submission_id}</code></td><td><${Badge} kind=${s.status === 'accepted' ? 'ok' : 'bad'}>${s.status}</${Badge}></td><td class="small">${(s.errors || []).map(e => `${e.code}: ${e.message}`).join('; ')}</td></tr>`)}</tbody></table>`}
    ${f.frozen && html`<div class="banner info">Frozen snapshot: federal balance ${fmtMoney(f.frozen.snapshot.position.federal.balance_due)}, California ${fmtMoney(f.frozen.snapshot.position.california.balance_due)} · fingerprint <code>${f.frozen.snapshot.fingerprint}</code>. ${f.amendments.length ? `Amendment in progress: ${f.amendments[f.amendments.length - 1].reason}` : 'Any later change is recorded as an amendment on top of this snapshot.'}</div>`}
    ${copy && html`<${ClientCopy} onClose=${() => setCopy(false)} />`}
  </${Section}>`;
}

export function ClientCopy({ onClose }) {
  const app = useApp();
  const { model, st } = app;
  const pos = position(model, st, ['approved']);
  const hh = model.packet.household;
  return html`<${Modal} title="Client copy — 2025 returns" onClose=${onClose} wide=${true}>
    <div class="client-copy" id="client-copy">
      <h2>${hh.people[0].name} & ${hh.people[1].name} — 2025 Form 1040 and California 540NR</h2>
      <p>Prepared by ${model.packet.firm.name}, ${model.packet.firm.firm_identity.address}. Paid preparer: ${personName(model, model.packet.firm.firm_identity.paid_preparer_signing_returns)}.</p>
      <table class="list"><thead><tr><th></th><th class="r">Federal</th><th class="r">California</th></tr></thead><tbody>
        <tr><td>Total tax</td><td class="r"><${Money} v=${pos.federal.total_tax} /></td><td class="r"><${Money} v=${pos.california.total_tax} /></td></tr>
        <tr><td>Payments and withholding</td><td class="r"><${Money} v=${pos.federal.payments} /></td><td class="r"><${Money} v=${pos.california.payments} /></td></tr>
        <tr class="strong"><td>${pos.federal.balance_due >= 0 ? 'Balance due' : 'Refund'} / ${pos.california.balance_due >= 0 ? 'balance due' : 'refund'}</td><td class="r"><${Money} v=${Math.abs(pos.federal.balance_due)} /></td><td class="r"><${Money} v=${Math.abs(pos.california.balance_due)} /></td></tr>
      </tbody></table>
      <p class="small">Amounts reflect approved workpaper changes on top of engine ${model.current.version}. Interest and the failure-to-pay penalty apply to any federal balance paid after April 15, 2026.</p>
      <h3>Things you need to do outside this return</h3>
      <ul><li>File FinCEN Form 114 (FBAR) for the Sparbanken account by October 15, 2026.</li><li>Issue Forms 1099-NEC to the two contractors (late).</li><li>Decide on the SEP excess contribution before the extended due date.</li><li>Discuss the 2023 Form 3520 (foreign inheritance) with us.</li></ul>
      <p class="small muted">Generated ${fmtDateTime(new Date().toISOString())} · record ${scopeFingerprint(model, st, 'return')}</p>
    </div>
    <footer class="modal-f"><button onClick=${() => window.print()}>Print</button><button class="primary" onClick=${onClose}>Close</button></footer>
  </${Modal}>`;
}

const SIDE_EFFECTS = {
  client_approved_and_signed_8879: (t, app) => [{ type: 'filing', data: { action: 'client_approve', snapshot: snapshot(app), detail: t.detail } }],
  notice_received: () => [],
  efile_rejected: null, efile_accepted_federal: null, efile_accepted_california: null, // driven by "Transmit e-file"
};

function Timeline() {
  const app = useApp();
  const { model, st, clock } = app;
  const tl = model.packet.timeline;
  const next = tl.find(t => t.at > clock && !st.replayed.has(t.id));
  const replay = t => {
    if (SIDE_EFFECTS[t.event] === null) { app.notify('This event is produced by the filing workflow above (Transmit e-file).', 'error'); return; }
    const extra = SIDE_EFFECTS[t.event]?.(t, app) || [];
    const stored = app.actMany([{ type: 'replay', data: { timelineId: t.id, event: t.event, at: t.at, detail: t.detail, noticeId: t.event === 'notice_received' ? 'N-2025-L566' : undefined } }, ...extra], { perm: 'replay' });
    if (stored.length) app.notify(`Replayed ${t.event.replace(/_/g, ' ')} (${fmtDate(t.at)})`, 'ok', () => app.undo(stored.map(s => s.id), 'replay'));
  };
  return html`<${Section} title="Season timeline" right=${next && html`<button class="primary small" onClick=${() => replay(next)}>Replay next: ${next.event.replace(/_/g, ' ')} (${fmtDate(next.at)})</button>`}>
    <ol class="timeline">${tl.map(t => {
      const done = t.at <= clock || st.replayed.has(t.id);
      return html`<li class=${done ? 'done' : 'future'}>
        <span class="t-date">${fmtDate(t.at)}</span>
        <span class="t-ev">${t.event.replace(/_/g, ' ')}</span>
        ${t.actor && html`<span class="muted small">${personName(model, t.actor)}</span>`}
        ${t.detail && html`<span class="small">${maskPins(t.detail, app.user.clearance)}</span>`}
        <span class="refs">${(t.refs || []).map(r => html`<${Ref} r=${r} />`)}</span>
      </li>`;
    })}</ol>
  </${Section}>`;
}

const maskPins = (s, ok) => (ok ? s : s.replace(/PIN \d+/g, 'PIN •••••'));

function Notices() {
  const app = useApp();
  const { model, st } = app;
  const [open, setOpen] = useState(null);
  return html`<${Section} title="Notices">
    <table class="list"><tbody>${model.packet.tax_agency_records.notices.map(n => {
      const s = st.notices.get(n.id);
      const received = n.tax_year !== 2025 || s;
      return html`<tr><td><b>${n.agency} ${n.type}</b><div class="small muted">tax year ${n.tax_year} · dated ${n.dated}${n.response_due ? ' · response due ' + n.response_due : ''}</div></td>
        <td class="small">${n.summary || (n.items_under_examination || []).join(' ')}</td>
        <td>${n.status ? html`<${Badge} kind="ok">${n.status.split(':')[0]}</${Badge}>` : received ? html`<${Badge} kind=${s?.status === 'responded' ? 'ok' : 'bad'}>${s?.status || 'open'}</${Badge}>` : html`<span class="muted small">arrives 01/2028 (replay)</span>`}</td>
        <td>${n.tax_year === 2025 && html`<button class="small" onClick=${() => setOpen(n)}>Build response</button>`}</td></tr>`;
    })}</tbody></table>
    ${open && html`<${NoticeResponse} n=${open} onClose=${() => setOpen(null)} />`}
  </${Section}>`;
}

// A self-contained record for each item under examination: lines, changes, evidence, checks.
function NoticeResponse({ n, onClose }) {
  const app = useApp();
  const { model, st, checks } = app;
  const sections = [
    { title: 'Noncash charitable contributions (Schedule A line 12, Form 8283)', lines: ['F8283.A1.stock', 'F8283.A1.vehicle', 'SchA.12'], docs: ['D65', 'D66'], checks: ['vehicle-donation'], refs: ['qa-39', 'call-01'] },
    { title: 'Schedule C gross receipts vs Forms 1099-NEC (142,000) and 1099-K (12,400)', lines: ['SchC.1'], docs: ['D14', 'D15', 'D16', 'D17', 'D18', 'D19', 'D20', 'D21'], checks: ['gross-receipts'], refs: ['qa-24'] },
  ];
  const val = k => { let a = null; for (const x of st.adjustments.values()) if (x.key === k && x.status === 'approved') a = x; return a ? a.to : model.current.byKey.get(k)?.value; };
  const record = { notice: n, generated: new Date().toISOString(), filedSnapshot: st.filing.frozen?.snapshot || null, items: sections.map(s => ({
    title: s.title, lines: s.lines.map(k => ({ key: k, label: model.current.byKey.get(k)?.label, engine: model.current.byKey.get(k)?.value, asFiled: val(k), changes: [...st.adjustments.values()].filter(a => a.key === k), verifications: st.verifications.get('line:' + k) || [] })),
    documents: s.docs.map(d => ({ id: d, title: model.docs.get(d).title, pages: model.docs.get(d).pages })), checks: checks.filter(c => s.checks.includes(c.id)), clientStatements: s.refs.map(r => model.qa.get(r) || model.calls.get(r)),
  })) };
  const download = () => {
    const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${n.id}-response-record.json`; a.click();
  };
  return html`<${Modal} title=${`Response record — ${n.type}`} onClose=${onClose} wide=${true}>
    <p>Due ${n.response_due}. Everything an examiner needs for each item, assembled from the frozen return, the changes we made and why, and the source documents.</p>
    ${record.items.map((it, i) => html`<div class="card"><h3>${i + 1}. ${it.title}</h3>
      <table class="list"><thead><tr><th>Line</th><th class="r">Engine</th><th class="r">As filed</th><th>Changes</th><th>Verified</th></tr></thead><tbody>
        ${it.lines.map(l => html`<tr><td><${Ref} r=${l.key} label=${l.key} /> <span class="small muted">${l.label}</span></td><td class="r"><${Money} v=${l.engine} /></td><td class="r"><b><${Money} v=${l.asFiled} /></b></td>
          <td class="small">${l.changes.map(a => html`<div>${a.status}: ${a.reason} (${personName(model, a.by)})</div>`)}</td><td class="small">${l.verifications.map(v => v.method.replace(/_/g, ' ')).join(', ') || '—'}</td></tr>`)}
      </tbody></table>
      ${it.checks.map(c => html`<div class="small"><b>Reconciliation:</b> ${c.why}${c.rows ? html`<table class="mini recon"><tbody>${c.rows.map(r => html`<tr><td>${r[0]}</td><td class="r">${r[1]}</td></tr>`)}</tbody></table>` : ''}</div>`)}
      <div class="small"><b>Documents:</b> <${Refs} list=${it.documents.map(d => d.id)} /></div>
    </div>`)}
    <footer class="modal-f">
      <button onClick=${download}>Download record (JSON)</button>
      <button onClick=${() => window.print()}>Print</button>
      ${app.can('filing') && st.notices.get(n.id)?.status !== 'responded' && html`<button class="primary" onClick=${() => { app.act('filing', { action: 'notice.respond', noticeId: n.id }, { perm: 'filing' }); onClose(); }} disabled=${!st.notices.get(n.id)}>Mark responded</button>`}
    </footer>
  </${Modal}>`;
}

function NextYear() {
  const app = useApp();
  const { model, st } = app;
  const pos = position(model, st, ['approved']);
  const pr = model.packet.planning_reference_2026;
  const safe = Math.ceil(pos.federal.total_tax * 1.1 / 4);
  const carryNotes = [...st.notes.values()].filter(n => n.status === 'open');
  return html`<${Section} title="Carry forward & plan 2026">
    <div class="grid2">
      <div><h4>2026 federal estimates (safe harbor)</h4>
        <p class="small">110% of 2025 total tax (${fmtMoney(pos.federal.total_tax)}) = ${fmtMoney(Math.round(pos.federal.total_tax * 1.1))} → <b>${fmtMoney(safe)}</b> per quarter: ${pr.federal_estimate_due_dates.join(', ')}.</p>
        <h4>California 2026</h4><p class="small">${pr.known_2026_changes_for_this_household[0]} Installments ${pr.california_installment_percentages.map(p => p * 100 + '%').join(' / ')}.</p>
        <ul class="small">${pr.known_2026_changes_for_this_household.slice(1).map(x => html`<li>${x}</li>`)}</ul></div>
      <div><h4>Carried to next year's file</h4>
        <ul class="small">
          ${Object.entries(model.current.carryovers_out.federal).filter(([, v]) => v).map(([k, v]) => html`<li>${k.replace(/_/g, ' ')}: ${fmtMoney(v)}</li>`)}
          <li>ISO shares: AMT basis 52,000 vs regular 12,000 (Form 8801 credit ${fmtMoney(model.current.carryovers_out.federal.minimum_tax_credit_from_2025_amt)})</li>
          <li>Woodworks stock basis 0 entering 2026 (rolled from 2022 with the 2023 K-1)</li>
          <li>${st.judgments.length} judgments and ${st.adjustments.size} changes with their reasons</li>
          <li>${carryNotes.length} open notes would carry forward as open items</li>
        </ul></div>
    </div>
  </${Section}>`;
}

function Records() {
  const app = useApp();
  const { ledger, model } = app;
  const exp = () => {
    const data = { packet: model.packet.packet, packetHash: hash(JSON.stringify(model.packet.return_versions.map(v => v.summary))), exported: new Date().toISOString(), ledger: ledger.events };
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); a.download = `workpaper-${model.packet.packet.client_id}-ledger.json`; a.click();
  };
  const imp = e => {
    const f = e.target.files[0]; if (!f) return;
    f.text().then(t => { const d = JSON.parse(t); if (confirm(`Replace this browser's workpaper with ${d.ledger.length} recorded actions from ${f.name}?`)) ledger.replaceAll(d.ledger); });
  };
  return html`<${Section} title="Workpaper record">
    <p class="small muted">The packet is never modified. The workpaper is the packet plus this append-only log. Export it to archive (retention: 7 years after filing) or to move it to another machine.</p>
    <div class="row"><button onClick=${exp}>Export log</button><label class="attach"><input type="file" accept=".json" onChange=${imp} /><span class="link">Import log…</span></label>
      ${app.user.role === 'firm_administrator' && html`<button class="danger" onClick=${() => confirm('Erase every recorded action in this browser?') && ledger.reset()}>Reset demo</button>`}</div>
  </${Section}>`;
}
