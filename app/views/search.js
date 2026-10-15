import { html, useState, useEffect, useRef, useApp, Modal } from '../ui.js';
import { maskText } from '../model.js';

// Search across lines, documents, extracted values, lots, client answers, messages and people.
export function SearchPalette({ onClose }) {
  const app = useApp();
  const { model } = app;
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const input = useRef();
  useEffect(() => input.current?.focus(), []);
  const results = search(model, app, q);
  const pick = r => { if (r.checkId) sessionStorage.setItem('mwp.focusCheck', r.checkId); onClose(); r.go ? app.go(r.go) : app.openTrace(r.ref); };
  return html`<${Modal} title="Search" onClose=${onClose}>
    <input ref=${input} class="search-input" placeholder="Line key, amount, document, security, person, question…" value=${q}
      onInput=${e => { setQ(e.target.value); setI(0); }}
      onKeyDown=${e => { if (e.key === 'ArrowDown') { setI(Math.min(i + 1, results.length - 1)); e.preventDefault(); } if (e.key === 'ArrowUp') { setI(Math.max(i - 1, 0)); e.preventDefault(); } if (e.key === 'Enter' && results[i]) pick(results[i]); }} />
    <div class="results">${results.map((r, j) => html`<button class=${'result' + (j === i ? ' on' : '')} onMouseEnter=${() => setI(j)} onClick=${() => pick(r)}>
      <span class="r-kind">${r.kind}</span><span class="r-title">${r.title}</span><span class="muted small">${r.sub || ''}</span></button>`)}
      ${q && !results.length && html`<div class="empty">No matches.</div>`}
      ${!q && html`<div class="muted small">Try "F1040.11", "1,840", "Coinhaven", "HVAC", "Theo", "basis", "D23".</div>`}
    </div>
  </${Modal}>`;
}

function search(model, app, q) {
  q = q.trim().toLowerCase();
  if (q.length < 2) return [];
  const num = Number(q.replace(/[,$]/g, ''));
  const isNum = !isNaN(num) && /\d/.test(q);
  const out = [];
  const add = (r) => { if (out.length < 40) out.push(r); };
  for (const l of model.current.lines) {
    if (l.key.toLowerCase().includes(q) || l.label.toLowerCase().includes(q) || (isNum && l.value === num)) add({ kind: 'line', ref: l.key, title: `${l.key} · ${l.label}`, sub: typeof l.value === 'number' ? l.value.toLocaleString() : l.value });
  }
  for (const d of model.packet.documents) if ((d.id + ' ' + d.title + ' ' + d.issuer).toLowerCase().includes(q)) add({ kind: 'doc', go: 'documents/' + d.id, title: `${d.id} · ${d.title}`, sub: d.issuer });
  for (const c of app.checks) if (c.title.toLowerCase().includes(q)) add({ kind: 'check', go: 'checks', checkId: c.id, title: c.title, sub: c.status });
  for (const q2 of model.packet.client.questionnaire) if ((q2.question + q2.answer).toLowerCase().includes(q)) add({ kind: 'answer', ref: q2.id, title: q2.question, sub: q2.answer.slice(0, 60) });
  for (const m of model.packet.client.messages) if (m.text.toLowerCase().includes(q)) add({ kind: 'message', ref: m.id, title: m.text.slice(0, 80), sub: m.from });
  for (const p of model.packet.household.people) if (p.name.toLowerCase().includes(q)) add({ kind: 'person', ref: 'household:' + p.id, title: p.name, sub: p.role });
  for (const e of model.packet.extracted_values) {
    if (out.length >= 40) break;
    const secret = ['ssn', 'account_number'].includes(e.value_type) || /pin/i.test(e.field);
    if (secret && !e.label.toLowerCase().includes(q)) continue; // never searchable by the identifier itself
    if ((isNum && e.value === num) || (!isNum && typeof e.value === 'string' && e.value.toLowerCase().includes(q)) || e.label.toLowerCase().includes(q)) add({ kind: 'value', ref: e.id, title: `${e.document_id} · ${e.label}`, sub: secret ? '•••• (masked)' : String(e.value) });
  }
  return out;
}
