import { html, createContext, useContext, useState, useEffect, useRef } from './vendor/standalone.module.js';
import { fmtMoney, maskText, refKind } from './model.js';

export const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export function Money({ v, cents }) {
  if (typeof v !== 'number') return html`<span>${v ?? '—'}</span>`;
  return html`<span class=${'num' + (v < 0 ? ' neg' : '')}>${fmtMoney(v, cents)}</span>`;
}

export function Delta({ v }) {
  if (!v) return html`<span class="muted">0</span>`;
  return html`<span class=${'num delta ' + (v > 0 ? 'up' : 'down')}>${v > 0 ? '+' : '−'}${fmtMoney(Math.abs(v))}</span>`;
}

export function Badge({ kind = 'neutral', children, title }) {
  return html`<span class=${'badge ' + kind} title=${title}>${children}</span>`;
}

const REF_LABEL = { ev: 'value', doc: 'doc', docpage: 'page', qa: 'answer', msg: 'message', call: 'call', py: '2024', agency: 'agency', asset: 'asset', household: 'person', param: 'param', timeline: 'event', version: 'version', line: 'line' };

// A clickable reference to anything in the packet or ledger. Opens the trace drawer.
export function Ref({ r, label }) {
  const { openTrace, model } = useApp();
  const k = refKind(r);
  let text = label || r;
  if (!label && k === 'ev') { const e = model.ev.get(r); if (e) text = `${e.document_id} · ${e.label}`; }
  if (!label && k === 'doc') { const d = model.docs.get(r); if (d) text = `${r} ${shorten(d.title, 38)}`; }
  return html`<button class=${'ref ref-' + k} onClick=${e => { e.stopPropagation(); openTrace(r); }} title=${r}>
    <span class="ref-k">${REF_LABEL[k] || k}</span>${text}</button>`;
}

export function Refs({ list }) {
  if (!list?.length) return null;
  return html`<span class="refs">${[...new Set(list)].map(r => html`<${Ref} r=${r} />`)}</span>`;
}

export function shorten(s, n) { return s && s.length > n ? s.slice(0, n - 1) + '…' : s; }

// Text that may contain SSNs / account numbers. Masked unless the viewer revealed it (logged).
export function Sensitive({ text, what }) {
  const { user, act } = useApp();
  const [shown, setShown] = useState(false);
  if (typeof text !== 'string') return html`${text}`;
  const masked = maskText(text);
  if (masked === text) return html`${text}`;
  if (shown) return html`<span class="revealed">${text}</span>`;
  return html`<span>${masked}${' '}
    ${user.clearance
      ? html`<button class="link small" onClick=${() => { act('view.sensitive', { what }); setShown(true); }} title="Reveal. Every reveal is logged.">reveal</button>`
      : html`<span class="lock" title="No sensitive-data clearance">🔒</span>`}</span>`;
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const h = e => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, []);
  return html`<div class="modal-bg" onClick=${onClose}>
    <div class=${'modal' + (wide ? ' wide' : '')} onClick=${e => e.stopPropagation()} role="dialog" aria-label=${title}>
      <header><h3>${title}</h3><button class="icon" onClick=${onClose} aria-label="Close">✕</button></header>
      <div class="modal-body">${children}</div>
    </div></div>`;
}

export function Empty({ children }) { return html`<div class="empty">${children}</div>`; }

export function Section({ title, right, children, id }) {
  return html`<section class="card" id=${id}><header class="card-h"><h3>${title}</h3><div class="card-r">${right}</div></header>${children}</section>`;
}

export function Tabs({ tabs, value, onChange }) {
  return html`<div class="tabs" role="tablist">${tabs.map(t => html`<button role="tab" aria-selected=${t.id === value} class=${t.id === value ? 'on' : ''} onClick=${() => onChange(t.id)}>${t.label}${t.count != null ? html` <span class="count">${t.count}</span>` : ''}</button>`)}</div>`;
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Locate an extracted value inside a page's printed text, so the simulated
// document can highlight it. A real renderer would use ev.position instead.
export function locate(model, ev, text) {
  const cands = new Set();
  const v = ev.value;
  if (ev.text_as_read) cands.add(ev.text_as_read);
  if (typeof v === 'number') {
    cands.add(v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    cands.add(v.toLocaleString('en-US'));
    cands.add(String(v));
  } else if (v != null && typeof v !== 'boolean') cands.add(String(v));
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) { const [y, mo, d] = v.split('-'); cands.add(`${mo}/${d}/${y}`); }
  let from = 0, to = text.length;
  const lot = /^([A-Z]+\d+|RSU-\d+|ESPP-\d+)_/.exec(ev.field);
  const trip = /^trip(\d+)_/.exec(ev.field);
  const box = /^box(\w+?)(?:_|$)/i.exec(ev.field);
  let anchor = null;
  if (lot) anchor = lot[1] + ' ';
  else if (trip) {
    const d = model.evByDocField.get(`${ev.document_id}:trip${trip[1]}_date`);
    const dest = model.evByDocField.get(`${ev.document_id}:trip${trip[1]}_destination`);
    if (d && dest) anchor = `${d.value} ${dest.value}`;
  } else if (box) anchor = `Box ${box[1].replace(/_/g, ' ')}`;
  if (anchor) {
    const i = text.toLowerCase().indexOf(anchor.toLowerCase());
    if (i >= 0) { from = i; const j = text.indexOf(';', i + anchor.length); to = j > 0 ? j : text.length; }
  }
  for (const c of [...cands].filter(Boolean).sort((a, b) => b.length - a.length)) {
    const i = text.indexOf(c, from);
    if (i >= 0 && i < to) return [i, i + c.length];
  }
  for (const c of cands) { const i = c ? text.indexOf(c) : -1; if (i >= 0) return [i, i + c.length]; }
  // The printed text may not contain what the pipeline read (an ambiguous digit,
  // e.g. "$?,500.00" read as 1,500.00): match the longest printed suffix and
  // extend left to the start of that token, so the reviewer sees the real print.
  for (const c of [...cands].filter(x => x && x.length >= 5)) {
    for (let k = c.length - 1; k >= 4; k--) {
      const tail = c.slice(c.length - k);
      const i = text.indexOf(tail, from);
      if (i >= 0 && i < to) { let st = i; while (st > 0 && !/\s/.test(text[st - 1])) st--; return [st, i + tail.length]; }
    }
  }
  return anchor && from > 0 ? [from, Math.min(to, from + anchor.length)] : null;
}

export function useOutsideClick(ref, fn) {
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) fn(); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, []);
}

export function Field({ label, children }) {
  return html`<label class="field"><span>${label}</span>${children}</label>`;
}

export function useLocalPref(key, init) {
  const [v, setV] = useState(() => { try { const s = localStorage.getItem('mwp.pref.' + key); return s ? JSON.parse(s) : init; } catch { return init; } });
  const set = x => { setV(x); try { localStorage.setItem('mwp.pref.' + key, JSON.stringify(x)); } catch { } };
  return [v, set];
}

export { html, useState, useEffect, useRef };
