// The hand-in documents rendered inside the app, with live links: a check id
// jumps to that check, a line key / document / value opens the trace drawer.
import { html, useState, useEffect, useRef, useApp } from '../ui.js';
import { marked } from '../vendor/marked.esm.js';
import { refKind } from '../model.js';

const FILES = { idea: 'docs/ONE_PAGER.md', errors: 'docs/ERRORS.md', readme: 'README.md' };

export function DocsView({ doc }) {
  const app = useApp();
  const [md, setMd] = useState(null);
  const ref = useRef();
  const file = FILES[doc] || FILES.idea;
  useEffect(() => { fetch(file, { cache: 'no-store' }).then(r => r.text()).then(setMd).catch(e => setMd(`Could not load ${file}: ${e.message}`)); }, [file]);
  const isRef = t => {
    if (app.checks.some(c => c.id === t)) return 'check';
    const k = refKind(t);
    if (k === 'ev') return app.model.ev.has(t) ? 'trace' : null;
    if (k === 'doc') return app.model.docs.has(t) ? 'trace' : null;
    if (k === 'line') return app.model.current.byKey.has(t) ? 'trace' : null;
    if (['qa', 'msg', 'call', 'household'].includes(k)) return 'trace';
    return null;
  };
  useEffect(() => {
    const el = ref.current; if (!el) return;
    for (const c of el.querySelectorAll('code')) if (isRef(c.textContent.trim())) c.classList.add('linkable');
  }, [md]);
  const onClick = e => {
    const c = e.target.closest('code.linkable'); if (!c) return;
    const t = c.textContent.trim();
    if (isRef(t) === 'check') { sessionStorage.setItem('mwp.focusCheck', t); app.go('checks'); }
    else app.openTrace(t);
  };
  return html`<div class="page"><article class="doc-md card" ref=${ref} onClick=${onClick}
    dangerouslySetInnerHTML=${{ __html: md == null ? '<p class="muted">Loading…</p>' : marked.parse(md) }}></article>
    <p class="muted small">Source: <a href=${file} target="_blank" rel="noopener">${file}</a>. Underlined ids are live: click to open the check, line or document.</p></div>`;
}
