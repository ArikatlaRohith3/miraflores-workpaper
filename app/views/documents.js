import { html, useState, useApp, Badge, Ref, Refs, Section, fmtDate } from '../ui.js';
import { docDispositions } from './readiness.js';
import { DocPage } from './docpage.js';
import { Conf } from './trace.js';
import { JudgmentForm } from './forms.js';
import { personName } from '../model.js';

const STATUS_KIND = { used: 'ok', evidence: 'info', reference: 'neutral', administrative: 'neutral', superseded: 'warn', duplicate: 'warn', unplaced: 'bad', disposed: 'ok' };

export function DocumentsView({ docId, evId }) {
  if (docId) return html`<${DocViewer} docId=${docId} evId=${evId} />`;
  return html`<${DocIndex} />`;
}

function DocIndex() {
  const app = useApp();
  const disp = docDispositions(app);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const counts = disp.reduce((m, d) => ({ ...m, [d.status]: (m[d.status] || 0) + 1 }), {});
  const shown = disp.filter(d => (status === 'all' || d.status === status) && (!q || (d.doc.id + ' ' + d.doc.title + ' ' + d.doc.issuer).toLowerCase().includes(q.toLowerCase())));
  return html`<div class="page">
    <div class="page-h"><div><h1>Document index</h1><div class="muted">${disp.length} documents. Each one landed on the return or carries the reason it did not.</div></div></div>
    <div class="row filters">
      <input placeholder="Search documents…" value=${q} onInput=${e => setQ(e.target.value)} />
      <button class=${'chip' + (status === 'all' ? ' on' : '')} onClick=${() => setStatus('all')}>All ${disp.length}</button>
      ${Object.entries(counts).map(([s, n]) => html`<button class=${'chip ' + STATUS_KIND[s] + (status === s ? ' on' : '')} onClick=${() => setStatus(s)}>${s} ${n}</button>`)}
    </div>
    <table class="list docs"><thead><tr><th>ID</th><th>Document</th><th>Belongs to</th><th>Received</th><th>Extraction</th><th>Disposition</th><th>Landed on</th></tr></thead><tbody>
      ${shown.map(d => html`<tr>
        <td><a href=${'#/documents/' + d.doc.id}>${d.doc.id}</a></td>
        <td>${d.doc.title}${d.doc.marked_corrected ? html` <${Badge} kind="info">CORRECTED</${Badge}>` : ''}<div class="small muted">${d.doc.issuer} · ${d.doc.file_name} · ${d.doc.page_count}p</div></td>
        <td class="small">${d.doc.belongs_to}</td>
        <td class="small">${fmtDate(d.doc.received_at)}${d.doc.received_at > app.model.versions[0].computed_at ? html` <${Badge} kind="warn">late</${Badge}>` : ''}</td>
        <td class="small">${d.doc.extraction.status} (${d.doc.extraction.values})</td>
        <td><${Badge} kind=${STATUS_KIND[d.status]}>${d.status}</${Badge}><div class="small muted">${d.disposition ? d.disposition.decision : d.reason}</div></td>
        <td class="small">${d.lines.length ? html`${d.lines.slice(0, 4).map(k => html`<${Ref} r=${k} label=${k} />`)}${d.lines.length > 4 ? ` +${d.lines.length - 4}` : ''}` : ''}</td>
      </tr>`)}
    </tbody></table>
  </div>`;
}

function DocViewer({ docId, evId }) {
  const app = useApp();
  const { model } = app;
  const doc = model.docs.get(docId);
  const ev = evId && model.ev.get(evId);
  const [page, setPage] = useState(ev ? ev.page : 1);
  const [sel, setSel] = useState(evId);
  const [q, setQ] = useState('');
  const disp = docDispositions(app).find(d => d.doc.id === docId);
  if (!doc) return html`<div class="page">Unknown document.</div>`;
  const evs = (model.evByDoc.get(docId) || []).filter(e => e.page === page && (!q || (e.label + e.field + String(e.value)).toLowerCase().includes(q.toLowerCase())));
  const pagesWithValues = new Set((model.evByDoc.get(docId) || []).map(e => e.page));
  return html`<div class="page">
    <div class="page-h"><div><a href="#/documents" class="small">← Document index</a><h1>${doc.id} · ${doc.title}</h1>
      <div class="muted">${doc.issuer} · ${doc.document_type} · belongs to ${doc.belongs_to} · received ${fmtDate(doc.received_at)} by ${doc.uploaded_by}</div></div>
      <div><${Badge} kind=${STATUS_KIND[disp.status]}>${disp.status}</${Badge}></div></div>
    <div class="viewer">
      <div class="viewer-pages">
        ${doc.pages.map(p => html`<button class=${'thumb' + (p.page === page ? ' on' : '') + (pagesWithValues.has(p.page) ? '' : ' empty-p')} onClick=${() => setPage(p.page)} title=${p.printed_content.slice(0, 80)}>${p.page}</button>`)}
      </div>
      <div class="viewer-main"><${DocPage} doc=${doc} page=${page} selected=${sel} /></div>
      <div class="viewer-side">
        <h4>Values read on page ${page} (${evs.length})</h4>
        <input class="filter" placeholder="Filter values…" value=${q} onInput=${e => setQ(e.target.value)} />
        <div class="ev-list">${evs.slice(0, 200).map(e => html`<button class=${'ev-item' + (e.id === sel ? ' on' : '') + (e.confidence < 0.7 ? ' low' : '')} onClick=${() => setSel(e.id)}>
          <span>${e.label}</span><span class="num">${typeof e.value === 'number' ? e.value.toLocaleString() : String(e.value ?? '(blank)')}</span><${Conf} c=${e.confidence} />
        </button>`)}</div>
        ${sel && html`<div class="small"><button class="link" onClick=${() => app.openTrace(sel)}>Trace ${sel} →</button></div>`}
        <h4>Landed on (${disp.lines.length})</h4>
        <${Refs} list=${disp.lines} />
        ${!disp.lines.length && html`<p class="small muted">${disp.reason}</p>`}
        <h4>Disposition</h4>
        ${disp.disposition ? html`<p class="small">${disp.disposition.decision} — ${personName(model, disp.disposition.by)}</p>` : html`<${JudgmentForm} target=${doc.id} kinds=${['disposition']} />`}
      </div>
    </div>
  </div>`;
}
