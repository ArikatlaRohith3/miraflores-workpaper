// AI assistance with guardrails a reviewer can trust:
//  - the model only sees an evidence bundle built here for one item;
//  - identifiers (SSNs, account numbers, PINs) are masked before anything leaves the browser;
//  - every citation is checked against the packet, and unknown ones are flagged;
//  - output is a suggestion: a person accepts or discards it, and both are logged.
import { html, useState, useEffect, useApp, Badge, Ref } from '../ui.js';
import { maskText, refKind, fmtMoney, personName } from '../model.js';
import { adjustmentFor, position } from '../ledger.js';
import { checkResolution } from './readiness.js';

let statusPromise = null;
export function aiStatus() {
  if (!statusPromise) statusPromise = fetch('api/ai', { cache: 'no-store' }).then(r => (r.ok ? r.json() : { configured: false })).catch(() => ({ configured: false }));
  return statusPromise;
}

const pageText = (m, doc, page, max = 1400) => (m.docs.get(doc)?.pages.find(p => p.page === page)?.printed_content || '').slice(0, max);
const evLine = (m, id) => { const e = m.ev.get(id); return e ? `[${id}] ${e.document_id} p${e.page} field "${e.field}" (${e.label}) = ${JSON.stringify(e.value)}; printed text read: "${e.text_as_read}"; confidence ${e.confidence}` : `[${id}] (unknown)`; };

function describeRef(app, r) {
  const m = app.model;
  const k = refKind(r);
  if (k === 'ev') { const e = m.ev.get(r); return e ? `${evLine(m, r)}\n  page text: ${pageText(m, e.document_id, e.page, 700)}` : ''; }
  if (k === 'doc' || k === 'docpage') { const d = m.docs.get(/(D\d\d)/.exec(r)[1]); const pg = Number(/#page(\d+)/.exec(r)?.[1] || 1); return d ? `[${d.id}] ${d.title} (${d.issuer}, received ${d.received_at.slice(0, 10)}, extraction ${d.extraction.status}${d.extraction.reason ? ': ' + d.extraction.reason : ''})\n  page ${pg}: ${pageText(m, d.id, pg)}` : ''; }
  if (k === 'qa') { const q = m.qa.get(r); return q ? `[${r}] Client questionnaire: "${q.question}" → "${q.answer}" (${q.answered_by})` : ''; }
  if (k === 'msg') { const q = m.msg.get(r); return q ? `[${r}] Client message ${q.sent_at.slice(0, 10)} from ${q.from}: "${q.text}"` : ''; }
  if (k === 'call') { const q = m.calls.get(r); return q ? `[${r}] Call notes ${q.date.slice(0, 10)}: ${q.notes.join(' | ')}` : ''; }
  if (k === 'line') { const l = m.current.byKey.get(r); return l ? `[${r}] ${l.label} = ${JSON.stringify(l.value)} (rule ${l.rule})` : ''; }
  return `[${r}]`;
}

export function buildContext(app, task, target) {
  const { model: m, st, checks } = app;
  const parts = [];
  const refs = new Set();
  const add = (r) => { if (r && !refs.has(r)) { refs.add(r); const d = describeRef(app, r); if (d) parts.push(d); } };
  parts.push(`Household: married filing jointly, tax year 2025; moved California → Texas on 2025-07-15 (California resident ${m.packet.engine_reference.parameters.ca_resident_days} days).`);

  if (task === 'explain_line') {
    const key = target;
    const l = m.current.byKey.get(key);
    const adj = adjustmentFor(st, key);
    refs.add(key);
    parts.push(`LINE [${key}] ${l.jurisdiction} ${l.form} line ${l.line} "${l.label}" = ${JSON.stringify(l.value)}`);
    parts.push(`Rule ${l.rule}: ${m.packet.engine_reference.rules[l.rule] || ''}`);
    if (l.note) parts.push(`Engine note: ${l.note}`);
    for (const i of l.inputs || []) { const il = m.current.byKey.get(i); refs.add(i); parts.push(`Input [${i}] ${il?.label} = ${JSON.stringify(il?.value)}`); }
    for (const s of l.sources || []) add(s);
    parts.push(`Values by engine version: ${m.versions.map(v => `${v.version}=${JSON.stringify(v.byKey.get(key)?.value)}`).join(', ')}; 2024 return: ${JSON.stringify(m.pyLines[key] ?? 'n/a')}`);
    if (adj) parts.push(`Workpaper change (${adj.status}): ${adj.from} → ${adj.to}. Reason: ${adj.reason}. Authority: ${adj.authority || ''}.`);
    for (const c of checks.filter(c => (c.lines || []).includes(key))) { refs.add('check:' + c.id); parts.push(`Independent check [check:${c.id}] ${c.status}: ${c.title}. ${c.why}`); }
    for (const n of st.notes.values()) if (n.target === 'line:' + key) parts.push(`Note (${n.kind}, ${n.status}): ${n.text}${n.replies.map(r => ' | reply: ' + r.text).join('')}`);
  } else if (task === 'second_opinion' || task === 'client_question') {
    const c = checks.find(x => x.id === target);
    refs.add('check:' + c.id);
    parts.push(`FINDING [check:${c.id}] status ${c.status}: ${c.title}\n${c.why}`);
    for (const r of c.rows || []) parts.push(`  ${r[0]}: ${r[1]}`);
    for (const p of c.proposals || []) parts.push(`Proposed change: ${p.key} ${p.from} → ${p.to}. ${p.reason} (${p.authority})`);
    for (const k of c.lines || []) { const l = m.current.byKey.get(k); if (l) { refs.add(k); parts.push(`Line [${k}] ${l.label} = ${JSON.stringify(l.value)}`); } }
    for (const r of c.refs || []) add(r);
  } else if (task === 'review_memo') {
    const pos = position(m, st, ['approved']); const all = position(m, st);
    parts.push(`Engine v3: federal tax ${m.current.summary.federal.total_tax}, balance ${m.current.summary.federal.balance_due}; California tax ${m.current.summary.california.total_tax}, balance ${m.current.summary.california.balance_due}.`);
    parts.push(`With approved changes: federal balance ${pos.federal.balance_due}, California ${pos.california.balance_due}. Including proposed: federal ${all.federal.balance_due}, California ${all.california.balance_due}. Filing status: ${st.filing.status}.`);
    for (const a of st.adjustments.values()) { refs.add(a.key); parts.push(`Change [${a.key}] ${a.status}: ${a.from} → ${a.to}. ${a.reason}. Effect fed ${a.effect.fedTax}, CA ${a.effect.caTax}, payments ${a.effect.fedPay || a.effect.caPay || 0}.`); }
    for (const c of checks.filter(c => c.status !== 'pass')) { refs.add('check:' + c.id); parts.push(`Check [check:${c.id}] ${c.status}/${checkResolution(c, st)}: ${c.title}`); }
    for (const j of st.judgments) parts.push(`Judgment (${j.kind}) on ${j.target}: ${j.decision} — authority: ${j.authority}`);
    for (const n of st.notes.values()) if (n.status === 'open') parts.push(`Open ${n.kind}${n.blocking ? ' (blocking)' : ''}: ${n.text}`);
    const of = checks.find(c => c.id === 'outside-filings'); if (of) { refs.add('check:outside-filings'); for (const r of of.rows) parts.push(`Outside filing: ${r[0]} — ${r[1]}`); }
  } else if (task === 'notice_letter') {
    const n = m.packet.tax_agency_records.notices.find(x => x.id === target);
    parts.push(`NOTICE ${n.type} dated ${n.dated}, tax year ${n.tax_year}, response due ${n.response_due}. Items: ${n.items_under_examination.join(' | ')}`);
    for (const k of ['F8283.A1.stock', 'F8283.A1.vehicle', 'SchA.12', 'SchC.1']) { const l = m.current.byKey.get(k); const a = adjustmentFor(st, k); refs.add(k); parts.push(`Line [${k}] ${l.label}: engine ${l.value}; as filed ${a && a.status === 'approved' ? a.to : l.value}${a ? `; change: ${a.reason}` : ''}`); }
    for (const id of ['gross-receipts', 'vehicle-donation']) { const c = checks.find(x => x.id === id); refs.add('check:' + id); parts.push(`Reconciliation [check:${id}]: ${c.why} ${(c.rows || []).map(r => r.join(' = ')).join('; ')}`); }
    for (const r of ['D65', 'D66', 'D14', 'D15', 'D17', 'D21']) add(r);
  }
  // Never send identifiers to an outside model.
  return { text: maskText(parts.join('\n')), refs };
}

function validRef(app, r) {
  const m = app.model;
  if (r.startsWith('check:')) return app.checks.some(c => c.id === r.slice(6));
  const k = refKind(r);
  if (k === 'ev') return m.ev.has(r);
  if (k === 'doc' || k === 'docpage') return m.docs.has(/(D\d\d)/.exec(r)?.[1]);
  if (k === 'qa') return m.qa.has(r);
  if (k === 'msg') return m.msg.has(r);
  if (k === 'call') return m.calls.has(r);
  if (k === 'line') return m.current.byKey.has(r);
  return ['py', 'agency', 'asset', 'household', 'param', 'timeline', 'version'].includes(k);
}

function RefOrCheck({ r }) {
  const app = useApp();
  if (r.startsWith('check:')) return html`<a class="ref" href="#/checks" onClick=${() => sessionStorage.setItem('mwp.focusCheck', r.slice(6))}><span class="ref-k">check</span>${r.slice(6)}</a>`;
  return html`<${Ref} r=${r} />`;
}

// Render answer text, turning [ref] into clickable chips (and flagging unknown ones).
function AnswerText({ text }) {
  const app = useApp();
  const parts = String(text || '').split(/(\[[^\]\s]{2,80}\])/g);
  return html`<div class="ai-text">${parts.map(p => {
    const m = /^\[([^\]]+)\]$/.exec(p);
    if (!m) return p;
    return validRef(app, m[1]) ? html`<${RefOrCheck} r=${m[1]} />` : html`<span class="badge bad" title="Not found in the packet — possible hallucination">${m[1]}?</span>`;
  })}</div>`;
}

export function AiPanel({ task, target, label, compact }) {
  const app = useApp();
  const [st, setSt] = useState({ phase: 'idle' });
  const [cfg, setCfg] = useState(null);
  useEffect(() => { aiStatus().then(setCfg); }, []);
  if (app.user.role === 'client') return null;
  const run = async () => {
    setSt({ phase: 'loading' });
    const { text, refs } = buildContext(app, task, target);
    try {
      const r = await fetch('api/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task, context: text }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `AI error ${r.status}`);
      const cites = [...new Set(d.citations || [])];
      const unverified = cites.filter(c => !validRef(app, c));
      const notInContext = cites.filter(c => validRef(app, c) && !refs.has(c) && !text.includes(c));
      const ev = app.act('ai', { task, target, model: d.model, ms: d.ms, citations: cites, unverified, notInContext, verdict: d.verdict || null, answer: d.answer, missing: d.missing || '' });
      setSt({ phase: 'done', d: { ...d, citations: cites, unverified, notInContext }, eventId: ev?.id });
    } catch (err) { setSt({ phase: 'error', error: err.message }); }
  };
  const decide = (decision) => {
    app.act('ai.decision', { aiEventId: st.eventId, decision, task, target });
    const d = st.d;
    if (decision === 'accept') {
      const noteTarget = task === 'explain_line' ? 'line:' + target : task === 'review_memo' ? 'return' : task === 'notice_letter' ? 'notice:' + target : 'check:' + target;
      if (task === 'client_question') app.act('note', { kind: 'question', to: 'client', text: d.answer, target: noteTarget, source: 'ai', model: d.model }, { perm: 'question' });
      else app.act('note', { kind: 'comment', text: `${aiLabel(task)} (AI draft, ${d.model}, accepted by ${app.user.name}):\n${d.answer}`, target: noteTarget, source: 'ai', model: d.model }, { perm: 'note' });
      app.notify(task === 'client_question' ? 'Question sent to the client' : 'Saved to the workpaper as a note');
    }
    setSt({ phase: decision === 'accept' ? 'accepted' : 'idle' });
  };
  const disabled = cfg && !cfg.configured;
  return html`<div class=${'ai-panel' + (compact ? ' compact' : '')}>
    ${st.phase !== 'done' && html`<button class="small ai-btn" onClick=${run} disabled=${st.phase === 'loading' || disabled} title=${disabled ? 'AI is not configured on this deployment' : 'Uses Google Gemini on the evidence shown here; identifiers are masked'}>
      ✦ ${st.phase === 'loading' ? 'Thinking…' : label}</button>`}
    ${disabled && html`<span class="muted small"> AI not configured</span>`}
    ${st.phase === 'error' && html`<div class="banner warn">AI unavailable: ${st.error}</div>`}
    ${st.phase === 'accepted' && html`<span class="small ok-t"> ✓ saved</span>`}
    ${st.phase === 'done' && html`<div class="ai-out">
      <div class="ai-h"><${Badge} kind="info">AI suggestion</${Badge}>${st.d.verdict ? html` <${Badge} kind=${st.d.verdict === 'agree' ? 'ok' : st.d.verdict === 'disagree' ? 'bad' : 'warn'}>${st.d.verdict.replace(/_/g, ' ')}</${Badge}>` : ''}
        <span class="muted small">${st.d.model} · ${(st.d.ms / 1000).toFixed(1)} s · not part of the return until a person accepts it</span></div>
      <${AnswerText} text=${st.d.answer} />
      ${st.d.missing && html`<div class="small muted"><b>Missing evidence:</b> ${st.d.missing}</div>`}
      <div class="small"><b>Cited:</b> ${st.d.citations.length ? st.d.citations.map(c => validRef(app, c) ? html`<${RefOrCheck} r=${c} />` : html`<span class="badge bad" title="Not in the packet">${c}?</span>`) : html`<span class="warn-t">no citations</span>`}
        ${st.d.unverified.length ? html` <span class="warn-t">· ${st.d.unverified.length} citation(s) not found in the packet</span>` : html` <span class="ok-t">· all citations verified</span>`}</div>
      <div class="row"><button class="small primary" onClick=${() => decide('accept')}>${task === 'client_question' ? 'Send to client' : 'Accept → save as note'}</button>
        <button class="small" onClick=${() => { navigator.clipboard?.writeText(st.d.answer); app.notify('Copied'); }}>Copy</button>
        <button class="small" onClick=${() => decide('discard')}>Discard</button></div>
    </div>`}
  </div>`;
}

const aiLabel = t => ({ explain_line: 'Explanation', second_opinion: 'Second opinion', client_question: 'Client question', review_memo: 'Review memo', notice_letter: 'Notice response letter' }[t]);

// Register of every AI call, for the firm (who used it, on what, accepted or not).
export function AiLog() {
  const app = useApp();
  const calls = app.st.events.filter(e => e.type === 'ai');
  const decisions = new Map(app.st.events.filter(e => e.type === 'ai.decision').map(e => [e.data.aiEventId, e]));
  if (!calls.length) return html`<p class="muted small">No AI calls yet.</p>`;
  return html`<table class="list"><thead><tr><th>When</th><th>Who</th><th>Task</th><th>On</th><th>Model</th><th>Citations</th><th>Decision</th></tr></thead><tbody>
    ${calls.slice().reverse().map(e => { const dec = decisions.get(e.id); return html`<tr><td class="small">${new Date(e.at).toLocaleString()}</td><td>${personName(app.model, e.actor)}</td><td>${aiLabel(e.data.task)}</td><td><code>${e.data.target}</code></td><td class="small">${e.data.model}</td>
      <td class="small">${e.data.citations.length}${e.data.unverified.length ? html` <span class="warn-t">(${e.data.unverified.length} unverified)</span>` : ' ✓'}</td><td>${dec ? html`<${Badge} kind=${dec.data.decision === 'accept' ? 'ok' : 'neutral'}>${dec.data.decision}ed</${Badge}>` : html`<span class="muted small">—</span>`}</td></tr>`; })}
  </tbody></table>`;
}
