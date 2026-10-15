import { html, useState, useApp, Money, Badge, Section, fmtDate } from '../ui.js';
import { position } from '../ledger.js';
import { personName } from '../model.js';
import { AttachForm } from './forms.js';
import { ClientCopy } from './filing.js';

// What the client sees: questions for them, uploads, approval and e-file signature.
// Internal notes, review notes and staff discussion are never shown here.
export function ClientView({ preview }) {
  const app = useApp();
  const { model, st, user } = app;
  const qs = [...st.notes.values()].filter(n => n.kind === 'question' && n.to === 'client');
  const open = qs.filter(n => n.status === 'open' && !n.replies.some(r => model.clientUsers.some(c => c.id === r.by)));
  const pos = position(model, st, ['approved']);
  const f = st.filing;
  const [copy, setCopy] = useState(false);
  const [pin, setPin] = useState('');
  const isClient = user.role === 'client';
  const approve = () => {
    if (!/^\d{5}$/.test(pin)) { app.notify('Enter a 5-digit signature PIN.', 'error'); return; }
    app.act('filing', { action: 'client_approve', snapshot: { position: { federal: pos.federal, california: pos.california } }, pinLast: '•••' + pin.slice(-2) }, { perm: 'client_approve' });
    app.notify('Thank you — your e-file authorization (Form 8879 / FTB 8879) is signed.');
  };
  return html`<div class="page client">
    ${preview && html`<div class="banner info">Preview of the client portal. Switch "Acting as" to Ngozi or Erik to use it as the client.</div>`}
    <div class="page-h"><div><h1>Your 2025 tax return</h1><div class="muted">${model.packet.firm.name} · ${f.status.replace(/_/g, ' ')}</div></div></div>
    <${Section} title=${`Questions from your preparer (${open.length} waiting)`}>
      ${qs.length ? qs.map(n => html`<${ClientQuestion} n=${n} canAnswer=${isClient} />`) : html`<p class="muted">No questions right now.</p>`}
    </${Section}>
    <${Section} title="Upload a document">
      ${isClient ? html`<${AttachForm} target="client-upload" />` : html`<p class="muted small">Clients upload here.</p>`}
      <ul class="small">${[...st.attachments.values()].filter(a => a.target === 'client-upload' || model.clientUsers.some(c => c.id === a.by)).map(a => html`<li>${a.name} · ${personName(model, a.by)} · ${fmtDate(a.at)}</li>`)}</ul>
    </${Section}>
    <${Section} title="Review and sign">
      ${f.status === 'in_preparation' && !f.clientApproval ? html`<p class="muted">Your preparer is still working on the return. You will be asked to review and sign here.</p>` : html`
        <table class="list"><tbody>
          <tr><td>Federal ${pos.federal.balance_due >= 0 ? 'balance due' : 'refund'}</td><td class="r"><b><${Money} v=${Math.abs(pos.federal.balance_due)} /></b></td></tr>
          <tr><td>California ${pos.california.balance_due >= 0 ? 'balance due' : 'refund'}</td><td class="r"><b><${Money} v=${Math.abs(pos.california.balance_due)} /></b></td></tr>
        </tbody></table>
        <button onClick=${() => setCopy(true)}>View summary</button>
        ${f.clientApproval ? html`<p><${Badge} kind="ok">Signed ${fmtDate(f.clientApproval.at)}</${Badge}></p>`
          : isClient ? html`<div class="row"><input type="password" inputmode="numeric" maxlength="5" placeholder="5-digit signature PIN" value=${pin} onInput=${e => setPin(e.target.value)} /><button class="primary" onClick=${approve}>I approve and sign Form 8879</button></div>
            <p class="small muted">By signing you declare that you examined the return and it is true, correct and complete to the best of your knowledge.</p>` : ''}`}
    </${Section}>
    ${copy && html`<${ClientCopy} onClose=${() => setCopy(false)} />`}
  </div>`;
}

function ClientQuestion({ n, canAnswer }) {
  const app = useApp();
  const [text, setText] = useState('');
  return html`<div class="note-card question">
    <div class="note-t"><b>${n.text}</b></div>
    <div class="small muted">Asked ${fmtDate(n.at)} by ${personName(app.model, n.by)}</div>
    ${n.replies.map(r => html`<div class="reply"><b>${personName(app.model, r.by)}</b>: ${r.text}</div>`)}
    ${canAnswer && n.status === 'open' && html`<div class="row"><input placeholder="Your answer" value=${text} onInput=${e => setText(e.target.value)} />
      <button class="small primary" onClick=${() => { if (text.trim()) { app.act('note.reply', { noteId: n.id, text }, { perm: 'client_answer' }); setText(''); } }}>Send</button>
      <${AttachForm} target=${'note:' + n.id} /></div>`}
  </div>`;
}
