import { html, useState, useRef, useApp, useOutsideClick, fmtDate } from '../ui.js';
import { personName, AREAS } from '../model.js';
import { partnerThreshold, signoffState } from '../ledger.js';

// Per-person notifications derived from the ledger: what needs *you* now.
export function notificationsFor(app) {
  const { st, user, model } = app;
  const out = [];
  const isClient = user.role === 'client';
  for (const n of st.notes.values()) {
    if (n.status !== 'open') continue;
    if (n.kind === 'question' && ((isClient && n.to === 'client' && !n.replies.some(r => model.clientUsers.some(c => c.id === r.by))) || n.to === user.id))
      out.push({ id: 'q' + n.id, kind: 'question', text: `${personName(model, n.by)} asked: ${n.text}`, at: n.at, go: isClient ? 'client' : 'review' });
    if (!isClient && n.by === user.id && n.replies.length && n.replies[n.replies.length - 1].by !== user.id)
      out.push({ id: 'r' + n.id, kind: 'reply', text: `${personName(model, n.replies[n.replies.length - 1].by)} replied: ${n.replies[n.replies.length - 1].text}`, at: n.replies[n.replies.length - 1].at, go: 'review' });
    if (!isClient && n.kind === 'review' && n.blocking && n.by !== user.id && st.assignments.preparer === user.id)
      out.push({ id: 'b' + n.id, kind: 'blocking', text: `Blocking review note: ${n.text}`, at: n.at, go: 'review' });
  }
  if (!isClient) {
    const thr = partnerThreshold(st.standards);
    for (const a of st.adjustments.values()) {
      if (a.by === user.id) continue;
      if (user.role === 'reviewer' && a.status === 'proposed') out.push({ id: 'a' + a.id, kind: 'approve', text: `Approve change on ${a.key}: ${a.reason}`, at: a.at, go: 'adjustments' });
      if (user.role === 'partner' && (a.status === 'awaiting_partner' || (a.status === 'proposed' && Math.max(Math.abs(a.effect.fedTax), Math.abs(a.effect.caTax)) > thr))) out.push({ id: 'p' + a.id, kind: 'approve', text: `Partner approval needed on ${a.key} (${a.reason})`, at: a.at, go: 'adjustments' });
    }
    for (const scope of ['return', ...AREAS.map(a => a.id)]) for (const level of st.standards.review_levels) {
      const s = signoffState(model, st, scope, level);
      if (s.state === 'reopened' && s.signoff.by === user.id) out.push({ id: `so-${scope}-${level}`, kind: 'reopened', text: `Your ${level} sign-off on ${scope} reopened: something changed after you signed`, at: s.signoff.at, go: scope === 'return' ? 'review' : 'area/' + scope });
    }
    if (st.filing.status === 'rejected' && ['reviewer', 'partner', 'preparer'].includes(user.role)) out.push({ id: 'rej', kind: 'blocking', text: 'E-file rejected by the IRS — see Filing & after', at: '', go: 'filing' });
    for (const [id, n] of st.notices) if (n.status === 'open') out.push({ id: 'n' + id, kind: 'notice', text: `IRS notice received (${id}) — response due`, at: n.received, go: 'filing' });
  } else if (st.filing.status === 'ready_for_client' && !st.filing.clientApproval) out.push({ id: 'sign', kind: 'approve', text: 'Your return is ready: please review and sign', at: '', go: 'client' });
  return out;
}

export function NotificationBell() {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useOutsideClick(ref, () => setOpen(false));
  const list = notificationsFor(app);
  return html`<span class="bell" ref=${ref}>
    <button class="icon" onClick=${() => setOpen(!open)} aria-label=${`Notifications (${list.length})`} title="Notifications">🔔${list.length ? html`<span class="bell-n">${list.length}</span>` : ''}</button>
    ${open && html`<div class="bell-pop card">
      <h3>For ${app.user.name}</h3>
      ${list.length ? list.slice(0, 30).map(n => html`<a class=${'bell-item ' + n.kind} href=${'#/' + n.go} onClick=${() => setOpen(false)}>${n.text}${n.at ? html` <span class="muted small">${fmtDate(n.at)}</span>` : ''}</a>`) : html`<p class="muted small">Nothing needs you right now.</p>`}
    </div>`}
  </span>`;
}
