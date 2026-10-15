// The trace drawer: open anything (a return line, an extracted value, a document,
// a client answer, a prior-year record...) and walk up or down the chain.
import { html, useState, useApp, Money, Delta, Badge, Ref, Refs, Sensitive, fmtDateTime, fmtDate } from '../ui.js';
import { refKind, resolvePointer, paramValue, fmtValue, fmtMoney, areaOf, AREAS, personName } from '../model.js';
import { adjustmentFor } from '../ledger.js';
import { DocPage } from './docpage.js';
import { AdjustForm, VerifyForm, NoteForm, JudgmentForm, AttachForm, LinkForm, effectText } from './forms.js';

export function TraceDrawer({ r, onClose, back }) {
  const k = refKind(r);
  const body = {
    line: LineTrace, ev: EvTrace, doc: DocTrace, docpage: DocTrace, qa: ClientTrace, msg: ClientTrace, call: ClientTrace,
    py: PointerTrace, agency: PointerTrace, asset: AssetTrace, household: PersonTrace, param: ParamTrace, timeline: TimelineTrace, version: VersionTrace,
  }[k] || LineTrace;
  return html`<aside class="drawer" aria-label="Trace">
    <div class="drawer-h">
      ${back && html`<button class="icon" onClick=${back} title="Back">←</button>`}
      <span class="muted small">Trace</span><code>${r}</code>
      <button class="icon right" onClick=${onClose} aria-label="Close">✕</button>
    </div>
    <div class="drawer-b"><${body} r=${r} key=${r} /></div>
  </aside>`;
}

function Activity({ target }) {
  const { st, model } = useApp();
  const ver = st.verifications.get(target) || [];
  const notes = [...st.notes.values()].filter(n => n.target === target);
  const judg = st.judgments.filter(j => j.target === target);
  const att = [...st.attachments.values()].filter(a => a.target === target);
  const links = st.links.filter(l => l.from === target || l.to === target);
  const { ledger } = useApp();
  const [tab, setTab] = useState(null);
  return html`<div class="activity">
    <h4>Verification ${ver.length ? html`<${Badge} kind="ok">${ver.length}</${Badge}>` : html`<${Badge} kind="warn">not verified</${Badge}>`}</h4>
    ${ver.map(v => html`<div class="act-row">✓ <b>${v.method.replace(/_/g, ' ')}</b> by ${personName(model, v.by)} · ${fmtDate(v.at)}${v.note ? html` — ${v.note}` : ''}</div>`)}
    <${VerifyForm} target=${target} compact=${true} />
    ${judg.length > 0 && html`<h4>Judgments & dispositions</h4>${judg.map(j => html`<div class="act-row"><${Badge}>${j.kind.replace(/_/g, ' ')}</${Badge}> ${j.decision} <span class="muted">— ${personName(model, j.by)}, ${fmtDate(j.at)}${j.authority ? ' · ' + j.authority : ''}</span></div>`)}`}
    ${notes.length > 0 && html`<h4>Notes & questions</h4>${notes.map(n => html`<${NoteCard} n=${n} />`)}`}
    ${att.length > 0 && html`<h4>Attached evidence</h4>${att.map(a => html`<div class="act-row">📎 ${a.fileId ? html`<a href=${ledger.fileUrl(a.fileId)} target="_blank" rel="noopener">${a.name}</a>` : a.dataUrl ? html`<a href=${a.dataUrl} download=${a.name}>${a.name}</a>` : a.name} <span class="muted">${Math.round(a.size / 1024)} KB · ${personName(model, a.by)}</span></div>`)}`}
    ${links.length > 0 && html`<h4>Linked items</h4>${links.map(l => html`<div class="act-row">↔ <${Ref} r=${l.from === target ? l.to : l.from} /> <span class="muted small">${l.note || ''} — ${personName(model, l.by)}</span></div>`)}`}
    <div class="act-buttons">
      <button class="small" onClick=${() => setTab(tab === 'note' ? null : 'note')}>Note / question</button>
      <button class="small" onClick=${() => setTab(tab === 'j' ? null : 'j')}>Record judgment</button>
      <button class="small" onClick=${() => setTab(tab === 'link' ? null : 'link')}>Link to…</button>
      <${AttachForm} target=${target} />
    </div>
    ${tab === 'note' && html`<${NoteForm} target=${target} onDone=${() => setTab(null)} />`}
    ${tab === 'j' && html`<${JudgmentForm} target=${target} onDone=${() => setTab(null)} />`}
    ${tab === 'link' && html`<${LinkForm} target=${target} onDone=${() => setTab(null)} />`}
  </div>`;
}

export function NoteCard({ n, full }) {
  const app = useApp();
  const { model } = app;
  const [reply, setReply] = useState('');
  const send = () => {
    if (!reply.trim()) return;
    const perm = app.user.role === 'client' ? 'client_answer' : 'note';
    app.act('note.reply', { noteId: n.id, text: reply }, { perm }); setReply('');
  };
  const canClose = app.user.role !== 'client' && (n.kind !== 'review' || app.can('review_note') || n.by === app.user.id);
  return html`<div class=${'note-card ' + n.kind + (n.status === 'open' ? '' : ' closed')}>
    <div class="note-h">
      <${Badge} kind=${n.kind === 'review' ? (n.blocking ? 'bad' : 'warn') : n.kind === 'question' ? 'info' : 'neutral'}>${n.kind === 'review' ? (n.blocking ? 'review note · blocks filing' : 'review note') : n.kind === 'question' ? `question → ${n.to === 'client' ? 'client' : personName(model, n.to)}` : 'comment'}</${Badge}>
      <span class="muted small">${personName(model, n.by)} · ${fmtDate(n.at)}</span>
      ${n.status !== 'open' && html`<${Badge} kind="ok">${n.status}</${Badge}>`}
      ${full && n.target && html`<${Ref} r=${n.target.replace(/^line:/, '')} />`}
    </div>
    <div class="note-t">${n.text}</div>
    ${n.replies.map(r => html`<div class="reply"><b>${personName(model, r.by)}</b> <span class="muted small">${fmtDate(r.at)}</span><div>${r.text}</div></div>`)}
    ${n.status === 'open' && html`<div class="row">
      <input placeholder="Reply…" value=${reply} onInput=${e => setReply(e.target.value)} onKeyDown=${e => e.key === 'Enter' && send()} />
      <button class="small" onClick=${send}>Reply</button>
      ${canClose && html`<button class="small" onClick=${() => app.act('note.status', { noteId: n.id, status: 'resolved' })}>Resolve</button>`}
    </div>`}
    ${n.status !== 'open' && canClose && html`<button class="link small" onClick=${() => app.act('note.status', { noteId: n.id, status: 'open' })}>Reopen</button>`}
  </div>`;
}

function LineTrace({ r }) {
  const app = useApp();
  const { model, st } = app;
  const key = r.replace(/^line:/, '');
  const line = model.current.byKey.get(key);
  const [adjusting, setAdjusting] = useState(false);
  if (!line) {
    const adj = [...st.adjustments.values()].find(a => a.key === key);
    if (adj) return html`<div><h2>${key}</h2><p>Line added by adjustment: ${adj.label}</p><p><${Money} v=${adj.to} cents=${true} /></p><p class="muted">${adj.reason}</p></div>`;
    return html`<p>Unknown reference <code>${r}</code>.</p>`;
  }
  const adj = adjustmentFor(st, key);
  const versions = model.versions.map(v => ({ v: v.version, val: v.byKey.get(key)?.value, at: v.computed_at }));
  const py = model.pyLines[key];
  const usedBy = (model.usedBy.get(key) || []).filter(x => x !== key);
  const rule = model.packet.engine_reference.rules[line.rule];
  const checks = app.checks.filter(c => (c.lines || []).includes(key));
  return html`<div>
    <div class="trace-title">
      <div><div class="muted small">${line.jurisdiction} · ${line.form} line ${line.line} · ${AREAS.find(a => a.id === areaOf(key))?.name}</div><h2>${line.label}</h2></div>
      <div class="big-num">${adj ? html`<s class="muted"><${Money} v=${line.value} cents=${key.startsWith('F8949')} /></s> <${Money} v=${adj.to} cents=${key.startsWith('F8949')} />` : html`<span>${fmtValue(line)}</span>`}</div>
    </div>
    ${adj && html`<div class=${'adj-banner ' + adj.status}>Adjusted by ${personName(model, adj.by)}: ${adj.reason} <span class="muted">(${adj.status.replace('_', ' ')} · ${effectText(adj.effect)})</span></div>`}
    ${line.note && html`<div class="engine-note">Engine note: ${line.note}</div>`}
    <div class="act-buttons">
      ${typeof line.value === 'number' && app.can('adjust') && html`<button class="small primary" onClick=${() => setAdjusting(true)}>Adjust</button>`}
    </div>
    <h4>How it was built</h4>
    <div class="rule"><code>${line.rule}</code> ${rule}</div>
    ${line.inputs?.length > 0 && html`<table class="mini"><tbody>${line.inputs.map(i => { const il = model.current.byKey.get(i); const ia = adjustmentFor(st, i); return html`<tr><td><${Ref} r=${i} label=${i} /></td><td class="muted">${il?.label}</td><td class="r">${ia ? html`<s class="muted"><${Money} v=${il?.value} /></s> ` : ''}<${Money} v=${ia ? ia.to : il?.value} /></td></tr>`; })}</tbody></table>`}
    ${line.sources?.length > 0 && html`<h4>Sources</h4><div class="sources">${line.sources.map(s => html`<${SourceRow} s=${s} />`)}</div>`}
    ${checks.length > 0 && html`<h4>Independent checks touching this line</h4>${checks.map(c => html`<div class="act-row"><${Badge} kind=${c.status === 'fail' ? 'bad' : c.status === 'pass' ? 'ok' : 'warn'}>${c.status}</${Badge}> <a href="#/checks" onClick=${() => sessionStorage.setItem('mwp.focusCheck', c.id)}>${c.title}</a></div>`)}`}
    <h4>Across versions and years</h4>
    <table class="mini"><tbody>
      ${py !== undefined && html`<tr><td>2024 return</td><td class="r"><${Money} v=${py} /></td><td><${Ref} r=${'py:/return_2024/lines/' + key} label="2024" /></td></tr>`}
      ${versions.map(v => html`<tr><td>Engine ${v.v}</td><td class="r">${typeof v.val === 'number' ? html`<${Money} v=${v.val} />` : (v.val ?? html`<span class="muted">—</span>`)}</td><td class="muted small">${fmtDate(v.at)}</td></tr>`)}
      ${adj && html`<tr><td><b>Workpaper</b></td><td class="r"><b><${Money} v=${adj.to} /></b></td><td class="muted small">${adj.status}</td></tr>`}
    </tbody></table>
    ${usedBy.length > 0 && html`<h4>Flows into</h4><${Refs} list=${usedBy} />`}
    <${Activity} target=${'line:' + key} />
    ${adjusting && html`<${AdjustForm} lineKey=${key} from=${line.value} onClose=${() => setAdjusting(false)} />`}
  </div>`;
}

function SourceRow({ s }) {
  const { model } = useApp();
  const k = refKind(s);
  if (k === 'ev') {
    const e = model.ev.get(s);
    if (!e) return html`<div><code>${s}</code></div>`;
    return html`<div class="source-row">
      <${Ref} r=${s} label=${`${e.document_id} p${e.page} · ${e.label}`} />
      <span class="num">${typeof e.value === 'number' ? fmtMoney(e.value, !Number.isInteger(e.value)) : String(e.value ?? '(blank)')}</span>
      <${Conf} c=${e.confidence} />
    </div>`;
  }
  if (k === 'param') return html`<div class="source-row"><${Ref} r=${s} /> <span class="num">${JSON.stringify(paramValue(model, s))}</span></div>`;
  return html`<div class="source-row"><${Ref} r=${s} /></div>`;
}

export function Conf({ c }) {
  const cls = c >= 0.95 ? 'hi' : c >= 0.7 ? 'mid' : 'lo';
  return html`<span class=${'conf ' + cls} title=${'Pipeline confidence ' + c}>${Math.round(c * 100)}%</span>`;
}

function EvTrace({ r }) {
  const app = useApp();
  const { model } = app;
  const e = model.ev.get(r);
  if (!e) return html`<p>Unknown value.</p>`;
  const doc = model.docs.get(e.document_id);
  const lines = model.linesByEv.get(r) || [];
  const isBlankRead = e.text_as_read === '' && e.value !== null;
  return html`<div>
    <div class="muted small">Extracted value · ${e.value_type}</div>
    <h2>${e.label}</h2>
    <table class="mini"><tbody>
      <tr><td>Document</td><td><${Ref} r=${e.document_id} /></td></tr>
      <tr><td>Page · field</td><td>page ${e.page} · <code>${e.field}</code></td></tr>
      <tr><td>Value</td><td><b>${e.value_type === 'ssn' || e.value_type === 'account_number' ? html`<${Sensitive} text=${String(e.value)} what=${r} />` : (typeof e.value === 'number' ? fmtMoney(e.value, !Number.isInteger(e.value)) : String(e.value ?? 'null'))}</b></td></tr>
      <tr><td>Text as read</td><td>${e.text_as_read ? html`"<${Sensitive} text=${e.text_as_read} what=${r} />"` : html`<span class="warn-t">(nothing printed)</span>`}</td></tr>
      <tr><td>Confidence</td><td><${Conf} c=${e.confidence} /></td></tr>
    </tbody></table>
    ${isBlankRead && html`<div class="banner warn">Nothing was printed here, but the pipeline stored ${String(e.value)}. A blank is not a zero.</div>`}
    <h4>On the page</h4>
    <${DocPage} doc=${doc} page=${e.page} selected=${r} compact=${false} />
    <a class="small" href=${`#/documents/${doc.id}?ev=${r}`}>Open in document viewer →</a>
    <h4>Landed on</h4>
    ${lines.length ? html`<${Refs} list=${lines} />` : html`<span class="muted">Not used by any engine line.</span>`}
    <${Activity} target=${r} />
  </div>`;
}

function DocTrace({ r }) {
  const app = useApp();
  const { model } = app;
  const m = /^(?:doc:)?(D\d\d)(?:#page(\d+))?/.exec(r);
  const doc = model.docs.get(m[1]);
  const page = m[2] ? Number(m[2]) : 1;
  const lines = model.linesByDoc.get(doc.id) || [];
  const checks = app.checks.filter(c => (c.refs || []).some(x => x === doc.id || x.startsWith(`doc:${doc.id}`) || model.ev.get(x)?.document_id === doc.id));
  return html`<div>
    <div class="muted small">${doc.document_type} · ${doc.belongs_to} · tax year ${doc.tax_year}</div>
    <h2>${doc.title}</h2>
    <div class="muted small">Received ${fmtDateTime(doc.received_at)} · uploaded by ${doc.uploaded_by} · ${doc.page_count} page(s) · extraction ${doc.extraction.status} (${doc.extraction.values} values)</div>
    <${DocPage} doc=${doc} page=${page} />
    ${doc.page_count > 1 && html`<a class="small" href=${`#/documents/${doc.id}`}>All ${doc.page_count} pages in document viewer →</a>`}
    <h4>Where it landed (${lines.length} lines)</h4>
    ${lines.length ? html`<${Refs} list=${lines} />` : html`<span class="muted">No engine line cites this document.</span>`}
    ${checks.length > 0 && html`<h4>Used as evidence by checks</h4>${checks.map(c => html`<div class="act-row"><${Badge} kind=${c.status === 'fail' ? 'bad' : c.status === 'pass' ? 'ok' : 'warn'}>${c.status}</${Badge}> ${c.title}</div>`)}`}
    <${Activity} target=${doc.id} />
  </div>`;
}

function ClientTrace({ r }) {
  const { model } = useApp();
  const k = refKind(r);
  const item = k === 'qa' ? model.qa.get(r) : k === 'msg' ? model.msg.get(r) : model.calls.get(r);
  const used = model.usedBy.get(r) || [];
  return html`<div>
    <div class="muted small">${k === 'qa' ? 'Questionnaire answer' : k === 'msg' ? 'Client message' : 'Call notes'}</div>
    ${k === 'qa' && html`<h2>${item.question}</h2><blockquote>${item.answer}</blockquote><div class="muted small">${item.answered_by} · ${fmtDateTime(item.answered_at)}</div>`}
    ${k === 'msg' && html`<blockquote>${item.text}</blockquote><div class="muted small">${item.from} → ${item.to} · ${fmtDateTime(item.sent_at)}</div>`}
    ${k === 'call' && html`<div class="muted small">${fmtDateTime(item.date)} · ${item.participants.join(', ')}</div><ul>${item.notes.map(n => html`<li>${n}</li>`)}</ul>`}
    ${used.length > 0 && html`<h4>Used by</h4><${Refs} list=${used} />`}
    <${Activity} target=${r} />
  </div>`;
}

function PointerTrace({ r }) {
  const { model } = useApp();
  const v = resolvePointer(model, r);
  const used = model.usedBy.get(r) || [];
  return html`<div>
    <div class="muted small">${r.startsWith('py:') ? 'Prior-year record' : 'Tax agency record'}</div>
    <h2>${r.split('/').slice(-1)[0].replace(/_/g, ' ')}</h2>
    <pre class="json">${JSON.stringify(v, null, 2)}</pre>
    ${r.startsWith('py:/return_2024/lines/') && html`<p class="muted small">Source on the 2024 return: <${Ref} r="D06" /></p>`}
    ${used.length > 0 && html`<h4>Used by</h4><${Refs} list=${used} />`}
    <${Activity} target=${r} />
  </div>`;
}

function AssetTrace({ r }) {
  const { model } = useApp();
  const id = r.slice(6);
  const a = model.current.assets.find(x => x.asset_id === id);
  const prior = model.py.asset_records.find(x => x.asset_id === id);
  return html`<div>
    <div class="muted small">Asset</div><h2>${a?.description || id}</h2>
    <pre class="json">${JSON.stringify(a, null, 2)}</pre>
    ${prior && html`<h4>Prior-year record</h4><pre class="json">${JSON.stringify(prior, null, 2)}</pre>`}
    <${Activity} target=${r} />
  </div>`;
}

function PersonTrace({ r }) {
  const { model, st } = useApp();
  const id = r.split(':')[1].split('.')[0];
  const p = model.people.get(id);
  const ov = st.overrides.get(`household:${id}.ssn`);
  return html`<div>
    <div class="muted small">Household · ${p.role}</div><h2>${p.name}</h2>
    <table class="mini"><tbody>
      ${Object.entries(p).filter(([k]) => !['id', 'name'].includes(k)).map(([k, v]) => html`<tr><td>${k.replace(/_/g, ' ')}</td><td>${k === 'ssn' || k === 'ip_pin'
        ? html`${ov && k === 'ssn' ? html`<s class="muted"><${Sensitive} text=${String(v)} what=${r + '.' + k} /></s> <${Sensitive} text=${ov.value} what=${r + '.' + k} /> <${Badge} kind="info">corrected</${Badge}>` : html`<${Sensitive} text=${String(v ?? '—')} what=${r + '.' + k} />`}`
        : String(v)}</td></tr>`)}
    </tbody></table>
    <p class="muted small">As entered by the client in the organizer (${model.packet.household.entered_by}).</p>
    <${Activity} target=${'household:' + id} />
  </div>`;
}

function ParamTrace({ r }) {
  const { model } = useApp();
  return html`<div><div class="muted small">Engine parameter</div><h2>${r.replace(/^ref:/, '')}</h2><pre class="json">${JSON.stringify(paramValue(model, r), null, 2)}</pre></div>`;
}

function TimelineTrace({ r }) {
  const { model } = useApp();
  const id = r.replace(/^timeline:/, '');
  const t = model.packet.timeline.find(x => x.id === id);
  return html`<div><div class="muted small">Timeline event</div><h2>${t?.event.replace(/_/g, ' ')}</h2><p>${fmtDateTime(t?.at)} · ${personName(model, t?.actor)}</p><p>${t?.detail || ''}</p><${Refs} list=${t?.refs} /></div>`;
}

function VersionTrace({ r }) {
  const { model } = useApp();
  const v = model.versions.find(x => x.version === r);
  return html`<div><div class="muted small">Engine output</div><h2>${r} · ${fmtDateTime(v.computed_at)}</h2><p>${v.trigger}</p><pre class="json">${JSON.stringify(v.summary, null, 2)}</pre>
    <h4>Changes from previous (${v.changes_from_previous?.length || 0})</h4>
    <table class="mini"><tbody>${(v.changes_from_previous || []).slice(0, 60).map(c => html`<tr><td><${Ref} r=${c.key} label=${c.key} /></td><td>${c.change}</td><td class="r">${c.old ?? ''}</td><td class="r">${c.new ?? ''}</td></tr>`)}</tbody></table></div>`;
}
