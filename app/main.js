import { html, render, useState, useEffect, useMemo, useRef } from './vendor/standalone.module.js';
import { loadPacket, AREAS, personName } from './model.js';
import { createLedger, fold } from './ledger.js';
import { runChecks } from './checks.js';
import { Ctx, Badge, fmtDateTime } from './ui.js';
import { TraceDrawer } from './views/trace.js';
import { Overview } from './views/overview.js';
import { ChecksView } from './views/checks.js';
import { AreaView } from './views/area.js';
import { DocumentsView } from './views/documents.js';
import { AdjustmentsView } from './views/adjustments.js';
import { ReviewView } from './views/review.js';
import { FilingView } from './views/filing.js';
import { FirmView } from './views/firm.js';
import { ClientView } from './views/client.js';
import { SearchPalette } from './views/search.js';
import { RelatedView } from './views/related.js';
import { NotificationBell } from './views/notifications.js';

const START_CLOCK = '2026-06-23T09:00:00Z'; // just after engine v3 — "now" for the workpaper

// Who can do what. Enforced in every action, not just hidden in the UI.
export const PERMS = {
  preparer: ['adjust', 'verify', 'note', 'question', 'attach', 'judgment', 'time', 'step', 'signoff:preparer', 'disposition', 'replay'],
  reviewer: ['adjust', 'verify', 'note', 'review_note', 'question', 'attach', 'judgment', 'time', 'step', 'approve', 'signoff:reviewer', 'disposition', 'replay', 'filing'],
  partner: ['adjust', 'verify', 'note', 'review_note', 'question', 'attach', 'judgment', 'time', 'step', 'approve', 'approve_partner', 'signoff:partner', 'filing', 'freeze', 'replay', 'disposition'],
  firm_administrator: ['standards', 'assign', 'time', 'view_logs', 'note', 'replay'],
  quality_reviewer: ['note', 'review_note', 'view_logs', 'time'],
  client: ['client_answer', 'attach', 'client_approve'],
};

function users(model) {
  return [
    ...model.packet.firm.staff.map(s => ({ id: s.id, name: s.name, role: s.role, clearance: s.sensitive_data_clearance, credential: s.credential, note: s.note, activeFrom: s.active_from })),
    ...model.clientUsers.map(c => ({ id: c.id, name: c.name, role: 'client', clearance: true })),
  ];
}

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, q] = h.split('?');
  const params = new URLSearchParams(q || '');
  return { parts: (path || 'overview').split('/'), params };
}

function App({ model, ledger }) {
  const [events, setEvents] = useState(ledger.events);
  const [syncStatus, setSyncStatus] = useState(ledger.status);
  useEffect(() => ledger.subscribe(ev => { setEvents(ev); setSyncStatus(ledger.status); }), []);
  const [route, setRoute] = useState(parseHash());
  useEffect(() => { const h = () => setRoute(parseHash()); window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h); }, []);

  const allUsers = useMemo(() => users(model), [model]);
  const [userId, setUserId] = useState(() => sessionStorage.getItem('mwp.user') || 'st-01');
  const user = allUsers.find(u => u.id === userId) || allUsers[0];
  useEffect(() => { sessionStorage.setItem('mwp.user', user.id); }, [user.id]);

  const st = useMemo(() => fold(model, events), [model, events]);
  const checks = useMemo(() => runChecks(model), [model]);
  const clock = useMemo(() => {
    let c = START_CLOCK;
    for (const e of st.events) if (e.type === 'replay' && e.data.at > c) c = e.data.at;
    return c;
  }, [st]);

  const [trace, setTrace] = useState(null);
  const [traceStack, setTraceStack] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [toast, setToast] = useState(null);
  useEffect(() => {
    const h = e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true); } };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, []);

  const can = perm => (PERMS[user.role] || []).includes(perm);
  const staffInactive = !!(user.activeFrom && user.activeFrom > clock.slice(0, 10));
  const frozen = !!st.filing.frozen;
  const app = {
    model, st, events, checks, user, users: allUsers, clock, can, frozen, ledger,
    act(type, data, opts = {}) {
      const need = opts.perm;
      if (need && !can(need)) { notify(`${user.name} (${user.role}) is not allowed to ${need.replace('_', ' ')}.`, 'error'); return null; }
      return ledger.append({ type, data, batch: opts.batch }, { actor: user.id, role: user.role, clock: opts.clock || clock, flag: staffInactive ? 'inactive_staff' : undefined })[0];
    },
    actMany(list, opts = {}) {
      if (opts.perm && !can(opts.perm)) { notify(`Not allowed for ${user.role}.`, 'error'); return []; }
      return ledger.append(list.map(x => ({ type: x.type, data: x.data, clock: x.clock })), { actor: user.id, role: user.role, clock, flag: staffInactive ? 'inactive_staff' : undefined });
    },
    undo(ids, label) {
      ledger.append({ type: 'revert', data: { ids, label } }, { actor: user.id, role: user.role, clock });
      notify(`Undone: ${label || ids.length + ' change(s)'}`);
    },
    openTrace(ref) { setTraceStack(s => (trace ? [...s, trace] : s)); setTrace(ref); },
    go(path) { location.hash = '#/' + path; },
    notify,
  };
  window.__app = app; // read-only hook for the automated end-to-end tests
  function notify(text, kind = 'ok', undo) { setToast({ text, kind, undo, t: Date.now() }); }
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), toast.undo ? 9000 : 4000); return () => clearTimeout(t); }, [toast]);

  const isClient = user.role === 'client';
  const openNotes = [...st.notes.values()].filter(n => n.status === 'open');
  const failing = checks.filter(c => c.status === 'fail' && !st.dismissed.has(c.id) && !(c.proposals || []).every(p => [...st.adjustments.values()].some(a => a.checkId === c.id && a.key === p.key && a.status !== 'rejected') || (p.override && st.overrides.has(p.key))));
  const pendingAdj = [...st.adjustments.values()].filter(a => a.status === 'proposed' || a.status === 'awaiting_partner');
  const sinceSeen = events.filter(e => e.seq > (st.lastSeen[user.id] || 0) && e.actor !== user.id && e.type !== 'seen' && e.type !== 'view.sensitive').length;

  const nav = isClient ? [{ id: 'client', label: 'Your return' }] : [
    { id: 'overview', label: 'Overview', badge: sinceSeen ? html`<${Badge} kind="info" title="Changes by others since you last looked">${sinceSeen}</${Badge}>` : null },
    { id: 'checks', label: 'Independent checks', badge: failing.length ? html`<${Badge} kind="bad">${failing.length}</${Badge}>` : null },
    { id: 'adjustments', label: 'Changes & versions', badge: pendingAdj.length ? html`<${Badge} kind="warn">${pendingAdj.length}</${Badge}>` : null },
    { id: 'review', label: 'Review & questions', badge: openNotes.length ? html`<${Badge} kind=${openNotes.some(n => n.blocking) ? 'bad' : 'warn'}>${openNotes.length}</${Badge}>` : null },
    { id: 'documents', label: 'Documents' },
    { id: 'related', label: 'Years & related returns' },
    { sep: 'Areas' },
    ...AREAS.map(a => ({ id: 'area/' + a.id, label: a.name, area: a.id })),
    { sep: 'Season' },
    { id: 'filing', label: 'Filing & after' },
    { id: 'firm', label: 'Firm' },
    { id: 'client', label: 'Client portal (preview)' },
  ];

  const [p0, p1] = route.parts;
  let view;
  if (isClient) view = html`<${ClientView} />`;
  else if (p0 === 'checks') view = html`<${ChecksView} />`;
  else if (p0 === 'area') view = html`<${AreaView} areaId=${p1} key=${p1} />`;
  else if (p0 === 'documents') view = html`<${DocumentsView} docId=${p1} evId=${route.params.get('ev')} />`;
  else if (p0 === 'adjustments') view = html`<${AdjustmentsView} />`;
  else if (p0 === 'review') view = html`<${ReviewView} />`;
  else if (p0 === 'filing') view = html`<${FilingView} />`;
  else if (p0 === 'firm') view = html`<${FirmView} />`;
  else if (p0 === 'client') view = html`<${ClientView} preview=${true} />`;
  else if (p0 === 'related') view = html`<${RelatedView} />`;
  else view = html`<${Overview} sinceSeen=${sinceSeen} />`;
  const current = route.parts.join('/');

  return html`<${Ctx.Provider} value=${app}>
    <div class="shell">
      <header class="top">
        <div class="brand"><span class="logo">◆</span> Miraflores <span class="muted">workpaper</span></div>
        <div class="client-id">${model.packet.household.people[0].name} & ${model.packet.household.people[1].name} · 2025 · MFJ · <span class="muted">${model.packet.packet.client_id}</span></div>
        <button class="search-btn" onClick=${() => setSearchOpen(true)}>Search anything <kbd>Ctrl K</kbd></button>
        <div class="clock" title="Season clock — advance it from Filing & after">◷ ${fmtDateTime(clock)}</div>
        ${frozen && html`<${Badge} kind="info" title="Return filed; changes now go to an amendment layer">Filed · frozen</${Badge}>`}
        <${WorkspaceChip} ledger=${ledger} status=${syncStatus} />
        <${NotificationBell} />
        <label class="role">
          <span class="muted">Acting as</span>
          <select value=${user.id} onChange=${e => { setUserId(e.target.value); if (allUsers.find(u => u.id === e.target.value)?.role === 'client') location.hash = '#/client'; }}>
            ${allUsers.map(u => html`<option value=${u.id}>${u.name} — ${u.role.replace('_', ' ')}${u.clearance ? '' : ' (no PII)'}</option>`)}
          </select>
        </label>
      </header>
      ${staffInactive && html`<div class="banner warn">${user.name} is not active until ${user.activeFrom}. Actions are recorded but flagged.</div>`}
      <div class="body">
        <nav class="side" aria-label="Workpaper">
          ${nav.map(n => n.sep ? html`<div class="nav-sep">${n.sep}</div>`
            : html`<a href=${'#/' + n.id} class=${current === n.id || (current === '' && n.id === 'overview') ? 'on' : ''}>
              <span>${n.label}</span>${n.badge || ''}</a>`)}
          <div class="nav-foot muted">${events.length} recorded actions · ${ledger.mode === 'shared' ? html`saved on the server (workspace <b>${ledger.ws}</b>)` : 'saved in this browser'}</div>
        </nav>
        <main class="main">${view}</main>
        ${trace && html`<${TraceDrawer} r=${trace} back=${traceStack.length ? () => { setTrace(traceStack[traceStack.length - 1]); setTraceStack(s => s.slice(0, -1)); } : null} onClose=${() => { setTrace(null); setTraceStack([]); }} />`}
      </div>
      ${searchOpen && html`<${SearchPalette} onClose=${() => setSearchOpen(false)} />`}
      ${toast && html`<div class=${'toast ' + toast.kind} role="status">${toast.text}${toast.undo && html` <button class="link" onClick=${() => { toast.undo(); setToast(null); }}>Undo</button>`}</div>`}
    </div>
  </${Ctx.Provider}>`;
}

function WorkspaceChip({ ledger, status }) {
  const [open, setOpen] = useState(false);
  const label = ledger.mode === 'shared' ? { live: 'live', saving: 'saving…', offline: 'offline — retrying' }[status] || status : 'this browser only';
  const kind = ledger.mode === 'shared' ? (status === 'offline' ? 'bad' : status === 'saving' ? 'warn' : 'ok') : 'neutral';
  const sandbox = () => { const id = 'sandbox-' + Math.random().toString(36).slice(2, 8); location.href = location.pathname + '?ws=' + id + location.hash; };
  return html`<span class="ws-chip">
    <button class="link small" onClick=${() => setOpen(!open)} title="Where this workpaper is saved"><${Badge} kind=${kind}>● ${label}</${Badge}> <span class="muted">${ledger.ws}</span></button>
    ${open && html`<div class="ws-pop card">
      ${ledger.mode === 'shared'
        ? html`<p class="small">Everything you do is saved on the server in workspace <b>${ledger.ws}</b>. Anyone who opens this link sees the same workpaper, and changes from other people appear within about two seconds.</p>`
        : html`<p class="small">No server found, so the workpaper is saved in this browser and shared between its tabs only.</p>`}
      <div class="row"><button class="small" onClick=${sandbox}>Open a new private sandbox</button>
      <button class="small" onClick=${() => { navigator.clipboard?.writeText(location.href); setOpen(false); }}>Copy link to this workspace</button></div>
    </div>`}
  </span>`;
}

async function boot() {
  const root = document.getElementById('app');
  try {
    const model = await loadPacket('data/packet.json');
    const ws = (new URLSearchParams(location.search).get('ws') || 'demo').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'demo';
    const ledger = await createLedger(ws);
    window.__ledger = ledger;
    window.__model = model;
    render(html`<${App} model=${model} ledger=${ledger} />`, root);
  } catch (err) {
    root.innerHTML = `<div class="boot-error"><h2>Could not start the workpaper</h2><p>${err.message}</p><p>Serve this folder over HTTP (for example <code>python -m http.server</code>) so the packet can be fetched.</p></div>`;
    console.error(err);
  }
}
boot();
