// The ledger: an append-only log of everything people do to the workpaper.
// State is never edited in place; it is always a fold over the log, so we get
// history, "who/why/when", undo (a revert event), live sync between tabs and
// "what changed since I last looked" for free.

import { areaOf, hash } from './model.js';
import { API } from './api.js';

const CHANNEL = 'miraflores-workpaper';
const POLL_MS = 2500;

// Two storage modes behind one interface:
//  - shared: the server (/api/ledger) holds the canonical log per workspace and
//    assigns the order; every browser polls it, so people on different machines
//    see each other's work within seconds;
//  - local: no server reachable (e.g. opened with a plain static server) — the log
//    lives in this browser and syncs between its tabs.
export async function createLedger(ws) {
  const storageKey = `miraflores.workpaper.CL-20417.${ws}.v2`;
  const api = `${API}api/ledger?ws=${encodeURIComponent(ws)}`;
  let mode = 'local';
  let events = [];
  let status = 'local';
  const listeners = new Set();
  const pending = new Map(); // id -> event waiting for the server
  let epoch = null;
  try {
    const r = await fetch(api, { cache: 'no-store' });
    if (r.ok && (r.headers.get('content-type') || '').includes('json')) { const d = await r.json(); epoch = d.epoch; events = renumber(dedupe(d.events)); mode = 'shared'; status = 'live'; }
  } catch { /* no server */ }
  if (mode === 'local') events = loadLocal();

  let bc = null;
  try { bc = new BroadcastChannel(`${CHANNEL}-${ws}`); bc.onmessage = () => (mode === 'local' ? (events = loadLocal(), emit()) : pull()); } catch { }
  window.addEventListener('storage', e => { if (mode === 'local' && e.key === storageKey) { events = loadLocal(); emit(); } });

  function loadLocal() { try { return JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch { return []; } }
  function saveLocal() { try { localStorage.setItem(storageKey, JSON.stringify(events)); } catch (err) { alert('Could not save to browser storage: ' + err.message); } }
  function emit() { for (const l of listeners) l(events, status); }
  // Server order is the database sequence (event.key, zero-padded). Events still in flight sort last.
  function dedupe(list) { const m = new Map(); for (const e of list) if (!m.has(e.id)) m.set(e.id, e); return [...m.values()]; }
  function renumber(list) {
    const confirmed = list.filter(e => !pending.has(e.id)).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return [...confirmed, ...[...pending.values()]].map((e, i) => (e.seq === i + 1 ? e : { ...e, seq: i + 1 }));
  }
  // The database assigns the order inside a transaction, so "everything after the
  // last sequence number I have" is exact: no window, no missed writes.
  // Advanced only by what the server *lists*, never by our own save confirmations:
  // another browser's save can get a lower sequence number than ours yet reach the
  // database a moment before it, and we must still fetch it.
  let polledUpTo = events.reduce((m, e) => (e.key ? Math.max(m, Number(e.key)) : m), 0);

  function merge(incoming) {
    const before = events.length;
    const byId = new Map(events.map(e => [e.id, e]));
    let changed = false;
    for (const e of incoming) { if (!byId.has(e.id) || byId.get(e.id).pending || !byId.get(e.id).key) { byId.set(e.id, e); changed = true; } pending.delete(e.id); }
    if (!changed && before === byId.size) return false;
    events = renumber([...byId.values()]);
    return true;
  }

  let pulling = false;
  async function pull() {
    if (mode !== 'shared' || pulling) return;
    pulling = true;
    try {
      const r = await fetch(`${api}&since=${polledUpTo}`, { cache: 'no-store' });
      if (r.ok) {
        const d = await r.json();
        if (d.epoch !== epoch) { // workspace was reset elsewhere: reload in full
          await reloadFull();
        } else {
          for (const e of d.events) if (e.key) polledUpTo = Math.max(polledUpTo, Number(e.key));
          if (merge(d.events)) emit();
        }
        if (status !== 'live') { status = 'live'; emit(); }
      } else if (status !== 'offline') { status = 'offline'; emit(); }
    } catch { if (status !== 'offline') { status = 'offline'; emit(); } }
    pulling = false;
  }
  async function push(list, tries = 0) {
    try {
      const r = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events: list.map(({ pending: _p, seq: _s, ...rest }) => rest) }) });
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      merge(d.stored); status = 'live'; emit(); bc?.postMessage('changed');
    } catch {
      status = 'offline'; emit();
      if (tries < 20) setTimeout(() => push(list.filter(e => pending.has(e.id)), tries + 1), Math.min(30000, 1000 * 2 ** tries));
    }
  }
  async function reloadFull() {
    const d = await (await fetch(api, { cache: 'no-store' })).json();
    epoch = d.epoch; pending.clear(); events = renumber(dedupe(d.events));
    polledUpTo = events.reduce((m, e) => (e.key ? Math.max(m, Number(e.key)) : m), 0); emit();
  }
  if (mode === 'shared') {
    setInterval(() => { if (!document.hidden) pull(); }, POLL_MS); // background tabs don't poll
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pull(); });
  }

  return {
    get events() { return events; },
    get mode() { return mode; },
    get status() { return pending.size ? 'saving' : status; },
    ws,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    // Append one or many events. Returns them immediately (optimistic); in shared
    // mode the server confirms and may renumber seq.
    append(input, ctx) {
      const list = Array.isArray(input) ? input : [input];
      const batch = list.length > 1 ? `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}` : undefined;
      let seq = events.length ? events[events.length - 1].seq : 0;
      const stored = list.map(({ clock, batch: b, ...e }) => ({
        ...e,
        seq: ++seq,
        id: `e${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        at: new Date().toISOString(),
        clock: clock || ctx.clock,
        actor: ctx.actor,
        role: ctx.role,
        batch: b || batch,
        ...(ctx.flag ? { flag: ctx.flag } : {}),
      }));
      if (mode === 'shared') {
        for (const e of stored) { e.pending = true; pending.set(e.id, e); }
        events = [...events, ...stored];
        emit();
        push(stored);
      } else {
        events = [...events, ...stored];
        saveLocal(); bc?.postMessage('changed'); emit();
      }
      return stored;
    },
    async replaceAll(list) {
      if (mode === 'shared') {
        const del = await fetch(api, { method: 'DELETE' });
        if (!del.ok) throw new Error((await del.json().catch(() => ({}))).error || `import failed (${del.status})`);
        const clean = list.map(({ seq: _s, pending: _p, serverAt: _a, key: _k, ...e }) => e);
        for (let i = 0; i < clean.length; i += 400) {
          const r = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events: clean.slice(i, i + 400) }) });
          if (!r.ok) throw new Error(`import failed (${r.status})`);
          await new Promise(res => setTimeout(res, 5)); // keep batches in time order
        }
        await reloadFull(); bc?.postMessage('changed');
      } else { events = list; saveLocal(); bc?.postMessage('changed'); emit(); }
    },
    async reset() {
      if (mode === 'shared') {
        const r = await fetch(api, { method: 'DELETE' });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `reset failed (${r.status})`);
        await reloadFull(); bc?.postMessage('changed');
      }
      else { events = []; saveLocal(); bc?.postMessage('changed'); emit(); }
    },
    reload: () => (mode === 'shared' ? reloadFull() : null),
    async uploadFile(file, dataUrl) {
      if (mode !== 'shared') return null;
      const r = await fetch(`${API}api/files?ws=${encodeURIComponent(ws)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: file.name, type: file.type, size: file.size, dataUrl }) });
      if (!r.ok) throw new Error(`upload failed (${r.status})`);
      return (await r.json()).id;
    },
    fileUrl(id) { return `${API}api/files?ws=${encodeURIComponent(ws)}&id=${encodeURIComponent(id)}`; },
  };
}

// --- tax effects -----------------------------------------------------------

// effects: [{cat, base}] where base is the signed change in that category.
export function taxEffect(model, adj) {
  if (adj.fixed) return { ...adj.fixed };
  const r = model.rates;
  const out = { fedTax: 0, caTax: 0, fedPay: 0, caPay: 0 };
  for (const e of adj.effects || []) {
    const b = Number(e.base) || 0;
    if (e.cat === 'none') continue;
    if (e.cat === 'payment') { out.fedPay += b; continue; }
    if (e.cat === 'ca_payment') { out.caPay += b; continue; }
    if (e.cat === 'credit') { out.fedTax -= b; continue; }
    if (e.cat === 'ca_credit') { out.caTax -= b; continue; }
    const rate = r[e.cat];
    if (!rate) continue;
    if (e.only !== 'california') out.fedTax += b * rate.federal_per_dollar;
    if (e.only !== 'federal') out.caTax += b * (e.caCat ? r[e.caCat].california_per_dollar : rate.california_per_dollar);
  }
  out.fedTax = Math.round(out.fedTax); out.caTax = Math.round(out.caTax);
  return out;
}

// --- fold --------------------------------------------------------------------

export function fold(model, events, opts = {}) {
  const upto = opts.uptoSeq ?? Infinity;
  const active = new Map();
  for (const e of events) {
    if (e.seq > upto) break;
    if (e.type === 'revert') for (const id of e.data.ids) active.set(id, !(active.get(id) ?? true));
  }
  const isActive = e => active.get(e.id) ?? true;

  const st = {
    adjustments: new Map(),
    verifications: new Map(),
    notes: new Map(),
    signoffs: [],
    judgments: [],
    attachments: new Map(),
    dismissed: new Map(),
    steps: new Map(),
    time: [],
    viewLog: [],
    standards: structuredClone(model.packet.firm.starter_standards),
    assignments: { ...model.packet.firm.assignment_at_start },
    filing: { status: 'in_preparation', submissions: [], frozen: null, amendments: [], extension: null, clientApproval: null },
    replayed: new Set(),
    notices: new Map(),
    lastSeen: {},
    overrides: new Map(), // non-line corrections, e.g. household:theo.ssn
    links: [],
    events: [],
  };

  for (const e of events) {
    if (e.seq > upto) break;
    if (e.type === 'revert' || !isActive(e)) continue;
    st.events.push(e);
    const d = e.data || {};
    switch (e.type) {
      case 'adjust': {
        const adj = { id: e.id, seq: e.seq, ...d, by: e.actor, at: e.clock, status: 'proposed', approvals: [], history: [] };
        adj.effect = taxEffect(model, adj);
        adj.layer = st.filing.frozen ? 'amendment' : 'original';
        st.adjustments.set(e.id, adj);
        break;
      }
      case 'adjust.decide': {
        const a = st.adjustments.get(d.adjId); if (!a) break;
        a.history.push({ by: e.actor, at: e.clock, decision: d.decision, note: d.note, role: e.role });
        if (d.decision === 'approve') { a.approvals.push({ by: e.actor, role: e.role, at: e.clock }); }
        a.status = d.decision === 'reject' ? 'rejected' : statusAfterApproval(a, st.standards);
        break;
      }
      case 'verify': {
        const list = st.verifications.get(d.target) || [];
        list.push({ id: e.id, method: d.method, note: d.note, evidence: d.evidence || [], by: e.actor, at: e.clock });
        st.verifications.set(d.target, list);
        break;
      }
      case 'note': st.notes.set(e.id, { id: e.id, ...d, by: e.actor, role: e.role, at: e.clock, replies: [], status: 'open', evidence: d.evidence || [] }); break;
      case 'note.reply': { const n = st.notes.get(d.noteId); if (n) n.replies.push({ id: e.id, text: d.text, by: e.actor, role: e.role, at: e.clock, evidence: d.evidence || [] }); break; }
      case 'note.status': { const n = st.notes.get(d.noteId); if (n) { n.status = d.status; n.closedBy = e.actor; n.closedAt = e.clock; } break; }
      case 'signoff': st.signoffs.push({ id: e.id, ...d, by: e.actor, role: e.role, at: e.clock }); break;
      case 'judgment': st.judgments.push({ id: e.id, ...d, by: e.actor, at: e.clock }); break;
      case 'attach': st.attachments.set(e.id, { id: e.id, ...d, by: e.actor, at: e.clock }); break;
      case 'check.dismiss': st.dismissed.set(d.checkId, { by: e.actor, at: e.clock, reason: d.reason }); break;
      case 'step': st.steps.set(d.step, { by: e.actor, at: e.clock, note: d.note }); break;
      case 'time': st.time.push({ id: e.id, ...d, by: e.actor, at: e.clock }); break;
      case 'view.sensitive': st.viewLog.push({ id: e.id, ...d, by: e.actor, role: e.role, at: e.at, clock: e.clock }); break;
      case 'standards.update': Object.assign(st.standards, d.patch); break;
      case 'assign': Object.assign(st.assignments, d); break;
      case 'override': st.overrides.set(d.target, { value: d.value, from: d.from, reason: d.reason, by: e.actor, at: e.clock, evidence: d.evidence || [] }); break;
      case 'replay': st.replayed.add(d.timelineId); applyReplay(st, d, e); break;
      case 'filing': applyFiling(st, d, e); break;
      case 'seen': st.lastSeen[e.actor] = d.seq; break;
      case 'link': st.links.push({ id: e.id, ...d, by: e.actor, at: e.clock }); break;
      default: break;
    }
  }
  return st;
}

function statusAfterApproval(a, standards) {
  const needsPartner = Math.max(Math.abs(a.effect.fedTax), Math.abs(a.effect.caTax)) > partnerThreshold(standards);
  const roles = new Set(a.approvals.map(x => x.role));
  if (needsPartner) return roles.has('partner') ? 'approved' : (roles.has('reviewer') ? 'awaiting_partner' : 'proposed');
  return roles.has('reviewer') || roles.has('partner') ? 'approved' : 'proposed';
}

export function partnerThreshold(standards) {
  const rule = (standards.rules || []).find(r => /partner sign-off/i.test(r));
  const m = rule && /over ([\d,]+)/.exec(rule);
  return m ? Number(m[1].replace(/,/g, '')) : 1000;
}

function applyReplay(st, d, e) {
  if (d.event === 'client_approved_and_signed_8879') st.filing.clientApproval = { at: e.clock, detail: d.detail };
  if (d.event === 'extension_filed_with_payment') st.filing.extension = { at: e.clock, detail: d.detail };
  if (d.event === 'notice_received') st.notices.set(d.noticeId || 'N-2025-L566', { received: e.clock, status: 'open' });
}

function applyFiling(st, d, e) {
  const f = st.filing;
  switch (d.action) {
    case 'ready': f.status = 'ready_for_client'; break;
    case 'client_approve': f.clientApproval = { at: e.clock, by: e.actor, snapshot: d.snapshot }; f.status = 'client_approved'; break;
    case 'transmit': f.submissions.push({ at: e.clock, ...d.submission }); f.status = d.submission.status === 'accepted' ? 'accepted' : (d.submission.status === 'rejected' ? 'rejected' : f.status); break;
    case 'freeze': f.frozen = { at: e.clock, by: e.actor, snapshot: d.snapshot, seq: e.seq }; f.status = 'filed'; break;
    case 'amend.start': f.amendments.push({ at: e.clock, by: e.actor, reason: d.reason }); f.status = 'amending'; break;
    case 'notice.respond': { const n = st.notices.get(d.noticeId); if (n) { n.status = 'responded'; n.respondedAt = e.clock; } break; }
    default: break;
  }
}

// --- derived helpers ---------------------------------------------------------

export function activeAdjustments(st, statuses = ['proposed', 'awaiting_partner', 'approved']) {
  return [...st.adjustments.values()].filter(a => statuses.includes(a.status));
}

// The latest live adjustment for a line key (rejected ones are ignored).
export function adjustmentFor(st, key) {
  let found = null;
  for (const a of st.adjustments.values()) if (a.key === key && a.status !== 'rejected') found = a;
  return found;
}

export function position(model, st, statuses) {
  const s = model.current.summary;
  const adj = activeAdjustments(st, statuses);
  const sum = (f) => adj.reduce((t, a) => t + (a.effect[f] || 0), 0);
  const fedTax = s.federal.total_tax + sum('fedTax');
  const caTax = s.california.total_tax + sum('caTax');
  const fedPay = s.federal.payments + sum('fedPay');
  const caPay = s.california.payments + sum('caPay');
  return {
    federal: { ...s.federal, total_tax: fedTax, payments: fedPay, balance_due: fedTax - fedPay },
    california: { ...s.california, total_tax: caTax, payments: caPay, balance_due: caTax - caPay },
    count: adj.length,
  };
}

// Fingerprint of everything inside a sign-off scope. If it changes after the
// sign-off, the sign-off reopens automatically.
export function scopeFingerprint(model, st, scope) {
  const inScope = key => scope === 'return' || areaOf(key) === scope;
  const parts = [];
  for (const a of st.adjustments.values()) if (inScope(a.key)) parts.push(`a:${a.id}:${a.status}:${a.to}`);
  for (const [t, v] of st.verifications) if (t.startsWith('line:') && inScope(t.slice(5))) parts.push(`v:${t}:${v.length}`);
  for (const n of st.notes.values()) if (n.blocking && (scope === 'return' || n.area === scope)) parts.push(`n:${n.id}:${n.status}`);
  for (const [k, o] of st.overrides) parts.push(`o:${k}:${o.value}`);
  return hash(parts.sort().join('|'));
}

export function signoffState(model, st, scope, level) {
  const list = st.signoffs.filter(s => s.scope === scope && s.level === level);
  if (!list.length) return { state: 'none' };
  const last = list[list.length - 1];
  if (last.withdrawn) return { state: 'none' };
  const now = scopeFingerprint(model, st, scope);
  return { state: now === last.fingerprint ? 'signed' : 'reopened', signoff: last };
}

// Who has prepared work in a scope (adjustments or verifications) — they may not review it.
export function preparersOf(st, scope) {
  const inScope = key => scope === 'return' || areaOf(key) === scope;
  const who = new Set();
  for (const a of st.adjustments.values()) if (inScope(a.key)) who.add(a.by);
  for (const [t, v] of st.verifications) if (t.startsWith('line:') && inScope(t.slice(5))) v.forEach(x => who.add(x.by));
  return who;
}
