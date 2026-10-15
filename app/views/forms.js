import { html, useState, useApp, Field, Money, Delta, Modal } from '../ui.js';
import { defaultEffect, CATEGORY_LABELS, areaOf, fmtMoney } from '../model.js';
import { taxEffect } from '../ledger.js';

export function AdjustForm({ lineKey, from, onClose, preset }) {
  const app = useApp();
  const line = app.model.current.byKey.get(lineKey);
  const d = defaultEffect(lineKey);
  const [to, setTo] = useState(preset?.to ?? (typeof from === 'number' ? from : ''));
  const [reason, setReason] = useState(preset?.reason || '');
  const [authority, setAuthority] = useState(preset?.authority || '');
  const [cat, setCat] = useState(d.cat);
  const [dir, setDir] = useState(d.dir);
  const [caMode, setCaMode] = useState(lineKey.startsWith('SchCA540NR') ? 'ca_only' : 'same');
  const delta = (Number(to) || 0) - (Number(from) || 0);
  const effects = cat === 'none' ? [] : [{
    cat: caMode === 'ca_only' ? 'ca_source_income' : cat, base: delta * dir,
    only: caMode === 'fed_only' ? 'federal' : caMode === 'ca_only' ? 'california' : undefined,
    caCat: caMode === 'ca_source' ? 'ca_source_income' : undefined,
  }];
  const eff = taxEffect(app.model, { effects });
  const submit = () => {
    if (!reason.trim()) { app.notify('A reason is required for every change.', 'error'); return; }
    const e = app.act('adjust', { key: lineKey, label: line?.label, from, to: Number(to), effects, reason, authority, area: areaOf(lineKey) }, { perm: 'adjust' });
    if (e) { app.notify(`Adjustment proposed on ${lineKey}`, 'ok', () => app.undo([e.id], `adjustment on ${lineKey}`)); onClose(); }
  };
  return html`<${Modal} title=${`Adjust ${lineKey}`} onClose=${onClose}>
    <p class="muted">${line?.label}. The engine value stays on record; this change sits on top with who, why and the tax effect.</p>
    <div class="grid2">
      <${Field} label="Engine value"><div class="readonly"><${Money} v=${from} /></div></${Field}>
      <${Field} label="New value"><input type="number" step="any" value=${to} onInput=${e => setTo(e.target.value)} autofocus /></${Field}>
    </div>
    <${Field} label="Why (required)"><textarea rows="2" value=${reason} onInput=${e => setReason(e.target.value)} placeholder="What is wrong and what the right number rests on" /></${Field}>
    <${Field} label="Authority relied on"><input value=${authority} onInput=${e => setAuthority(e.target.value)} placeholder="e.g. IRC §162(l), agreed to source document" /></${Field}>
    <div class="grid3">
      <${Field} label="Tax effect basis"><select value=${cat} onChange=${e => setCat(e.target.value)}>${Object.entries(CATEGORY_LABELS).map(([k, v]) => html`<option value=${k}>${v}</option>`)}</select></${Field}>
      <${Field} label="Direction"><select value=${dir} onChange=${e => setDir(Number(e.target.value))}><option value="1">Raising this line raises it</option><option value="-1">Raising this line lowers it</option></select></${Field}>
      <${Field} label="California"><select value=${caMode} onChange=${e => setCaMode(e.target.value)}>
        <option value="same">Prorated (same category)</option><option value="ca_source">Fully California-source</option>
        <option value="fed_only">Federal only</option><option value="ca_only">California-source amount only</option></select></${Field}>
    </div>
    <div class="effect-preview">
      <div>Change <${Delta} v=${delta} /></div>
      <div>Federal tax <${Delta} v=${eff.fedTax} /></div><div>California tax <${Delta} v=${eff.caTax} /></div>
      ${(eff.fedPay || eff.caPay) ? html`<div>Payments <${Delta} v=${eff.fedPay || eff.caPay} /></div>` : ''}
      <div class="muted small">Rates from engine v3 tax_effect_rates; the real system would recompute.</div>
    </div>
    <footer class="modal-f"><button onClick=${onClose}>Cancel</button><button class="primary" onClick=${submit} disabled=${!app.can('adjust') || app.frozen && !app.st.filing.amendments.length}>Propose adjustment</button></footer>
    ${app.frozen && !app.st.filing.amendments.length && html`<p class="banner warn">The return is filed and frozen. Start an amendment (Filing & after) to change it.</p>`}
  </${Modal}>`;
}

export function VerifyForm({ target, onDone, compact }) {
  const app = useApp();
  const types = app.st.standards.verification_types;
  const [method, setMethod] = useState(types[0]);
  const [note, setNote] = useState('');
  const submit = () => {
    const e = app.act('verify', { target, method, note }, { perm: 'verify' });
    if (e) { app.notify(`Verified ${target.replace(/^line:/, '')} (${method.replace(/_/g, ' ')})`, 'ok', () => app.undo([e.id], 'verification')); setNote(''); onDone?.(); }
  };
  if (!app.can('verify')) return null;
  return html`<div class=${'verify-form' + (compact ? ' compact' : '')}>
    <select value=${method} onChange=${e => setMethod(e.target.value)}>${types.map(t => html`<option value=${t}>${t.replace(/_/g, ' ')}</option>`)}</select>
    <input placeholder="Note (optional)" value=${note} onInput=${e => setNote(e.target.value)} />
    <button class="primary small" onClick=${submit}>Verify</button>
  </div>`;
}

export function NoteForm({ target, area, onDone, defaultKind }) {
  const app = useApp();
  const staff = app.users.filter(u => u.role !== 'client' && u.id !== app.user.id);
  const reviewerish = app.can('review_note');
  const [kind, setKind] = useState(defaultKind || (reviewerish ? 'review' : 'comment'));
  const [to, setTo] = useState('client');
  const [text, setText] = useState('');
  const [blocking, setBlocking] = useState(reviewerish);
  const submit = () => {
    if (!text.trim()) return;
    const data = { kind, text, target, area: area || (target?.startsWith('line:') ? areaOf(target.slice(5)) : null), blocking: kind === 'review' ? blocking : kind === 'question' && to === 'client' ? false : false };
    if (kind === 'question') data.to = to;
    const e = app.act('note', data, { perm: kind === 'review' ? 'review_note' : kind === 'question' ? 'question' : 'note' });
    if (e) { app.notify(kind === 'question' ? `Question sent to ${to === 'client' ? 'the client' : app.users.find(u => u.id === to)?.name}` : 'Note added'); setText(''); onDone?.(); }
  };
  return html`<div class="note-form">
    <div class="row">
      <select value=${kind} onChange=${e => setKind(e.target.value)}>
        <option value="comment">Comment</option>
        ${reviewerish && html`<option value="review">Review note</option>`}
        ${app.can('question') && html`<option value="question">Question</option>`}
      </select>
      ${kind === 'question' && html`<select value=${to} onChange=${e => setTo(e.target.value)}><option value="client">to client</option>${staff.map(s => html`<option value=${s.id}>to ${s.name}</option>`)}</select>`}
      ${kind === 'review' && html`<label class="check"><input type="checkbox" checked=${blocking} onChange=${e => setBlocking(e.target.checked)} /> blocks filing</label>`}
    </div>
    <textarea rows="2" value=${text} onInput=${e => setText(e.target.value)} placeholder=${kind === 'question' ? 'Ask a question. The answer becomes evidence on this item.' : 'Write a note…'} />
    <button class="small primary" onClick=${submit}>${kind === 'question' ? 'Send question' : 'Add'}</button>
  </div>`;
}

export function JudgmentForm({ target, onDone, kinds = ['judgment', 'election', 'due_diligence', 'penalty', 'disposition', 'variance_explanation', 'communication'] }) {
  const app = useApp();
  const [kind, setKind] = useState(kinds[0]);
  const [decision, setDecision] = useState('');
  const [authority, setAuthority] = useState('');
  const submit = () => {
    if (!decision.trim()) return;
    if (!authority.trim() && /authority/i.test((app.st.standards.rules || []).join(' ')) && kind !== 'disposition' && kind !== 'communication') { app.notify('Firm standard: every judgment call records the authority relied on.', 'error'); return; }
    const e = app.act('judgment', { kind, target, decision, authority }, { perm: kind === 'disposition' ? 'disposition' : 'judgment' });
    if (e) { app.notify('Recorded'); setDecision(''); setAuthority(''); onDone?.(); }
  };
  return html`<div class="note-form">
    <div class="row"><select value=${kind} onChange=${e => setKind(e.target.value)}>${kinds.map(k => html`<option value=${k}>${k.replace(/_/g, ' ')}</option>`)}</select>
    <input placeholder="Authority relied on" value=${authority} onInput=${e => setAuthority(e.target.value)} /></div>
    <textarea rows="2" value=${decision} onInput=${e => setDecision(e.target.value)} placeholder="Decision and reasoning" />
    <button class="small primary" onClick=${submit}>Record</button>
  </div>`;
}

export function AttachForm({ target, onDone }) {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const onFile = async e => {
    const f = e.target.files[0]; if (!f) return;
    if (!app.can('attach')) { app.notify(`${app.user.role} cannot attach evidence.`, 'error'); return; }
    const shared = app.ledger.mode === 'shared';
    const limit = shared ? 4_000_000 : 1_500_000;
    if (f.size > limit) { app.notify(`${f.name} is ${(f.size / 1e6).toFixed(1)} MB; the limit is ${limit / 1e6} MB.`, 'error'); e.target.value = ''; return; }
    setBusy(true);
    try {
      const dataUrl = await new Promise((r, j) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.onerror = j; fr.readAsDataURL(f); });
      const fileId = shared ? await app.ledger.uploadFile(f, dataUrl) : null;
      const ev = app.act('attach', { target, name: f.name, type: f.type, size: f.size, fileId, dataUrl: shared ? null : dataUrl }, { perm: 'attach' });
      if (ev) { app.notify(`Attached ${f.name}`); onDone?.(); }
    } catch (err) { app.notify(`Could not attach ${f.name}: ${err.message}`, 'error'); }
    setBusy(false); e.target.value = '';
  };
  return html`<label class="attach"><input type="file" onChange=${onFile} disabled=${busy} /> <span class="link">${busy ? 'Saving…' : '+ Attach file as evidence'}</span></label>`;
}

export function LinkForm({ target, onDone }) {
  const app = useApp();
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const submit = () => {
    const ref = to.trim();
    if (!ref) return;
    const { model } = app;
    const known = model.current.byKey.has(ref) || model.ev.has(ref) || model.docs.has(ref) || model.qa.has(ref) || model.msg.has(ref) || /^(py:|agency:|asset:|household:|doc:|v\d|call-|timeline:)/.test(ref);
    if (!known) { app.notify(`Unknown reference "${ref}". Use a line key (F1040.11), document (D23), value (ev-0226), py:/..., household:ada…`, 'error'); return; }
    const e = app.act('link', { from: target, to: ref, note }, { perm: 'note' });
    if (e) { app.notify('Linked'); setTo(''); setNote(''); onDone?.(); }
  };
  return html`<div class="note-form"><div class="row"><input placeholder="Link to: line key, D-number, ev-id, py:/…, household:…" value=${to} onInput=${e => setTo(e.target.value)} /><input placeholder="Why (optional)" value=${note} onInput=${e => setNote(e.target.value)} /><button class="small primary" onClick=${submit}>Link</button></div></div>`;
}

export function effectText(e) {
  const parts = [];
  if (e.fedTax) parts.push(`fed ${e.fedTax > 0 ? '+' : '−'}${fmtMoney(Math.abs(e.fedTax))}`);
  if (e.caTax) parts.push(`CA ${e.caTax > 0 ? '+' : '−'}${fmtMoney(Math.abs(e.caTax))}`);
  if (e.fedPay) parts.push(`fed payments ${e.fedPay > 0 ? '+' : '−'}${fmtMoney(Math.abs(e.fedPay))}`);
  if (e.caPay) parts.push(`CA payments ${e.caPay > 0 ? '+' : '−'}${fmtMoney(Math.abs(e.caPay))}`);
  return parts.join(' · ') || 'no tax effect';
}
