// A rendered document page. Today it is simulated from printed_content; the
// contract (doc id, page, extracted value id, position box) is the same one a
// real PDF/image renderer would use, so real pages can replace this component
// without touching any trace link.
import { html, useState, useApp, locate } from '../ui.js';
import { maskText } from '../model.js';

export function DocPage({ doc, page, selected, compact }) {
  const app = useApp();
  const { model } = app;
  const [revealed, setRevealed] = useState(false);
  const pg = doc.pages.find(p => p.page === page) || doc.pages[0];
  const text = pg.printed_content;
  const evs = (model.evByDoc.get(doc.id) || []).filter(e => e.page === pg.page);
  const ranges = [];
  const sel = selected && model.ev.get(selected);
  const add = (e, strong) => {
    const r = locate(model, e, text); if (!r) return;
    if (ranges.some(x => r[0] < x.end && r[1] > x.start)) return;
    ranges.push({ start: r[0], end: r[1], ev: e, strong });
  };
  if (sel && sel.page === pg.page && sel.document_id === doc.id) add(sel, true);
  for (const e of evs) if (e.id !== selected) add(e, false);
  ranges.sort((a, b) => a.start - b.start);
  const segs = []; let i = 0;
  for (const r of ranges) { if (r.start > i) segs.push({ t: text.slice(i, r.start) }); segs.push({ t: text.slice(r.start, r.end), r }); i = r.end; }
  if (i < text.length) segs.push({ t: text.slice(i) });
  const sensitive = maskText(text) !== text;
  const show = t => (revealed || !sensitive ? t : maskText(t));
  const lowConf = e => e.confidence < 0.7;
  const box = sel?.position;

  return html`<div class=${'paper' + (compact ? ' compact' : '')}>
    <div class="paper-h">
      <div><b>${doc.issuer}</b><div class="muted small">${doc.title}</div></div>
      <div class="paper-meta">
        <span>${doc.file_name}</span><span>page ${pg.page} of ${doc.page_count}</span>
        ${doc.marked_corrected && html`<span class="stamp">CORRECTED</span>`}
      </div>
    </div>
    <div class="paper-body">
      <p class="printed">${segs.map(s => s.r
        ? html`<mark class=${(s.r.strong ? 'sel ' : '') + (lowConf(s.r.ev) ? 'low' : '')} title=${`${s.r.ev.id} · ${s.r.ev.label} · read "${s.r.ev.text_as_read}" · confidence ${s.r.ev.confidence}`}
            onClick=${() => app.openTrace(s.r.ev.id)}>${show(s.t)}</mark>`
        : show(s.t))}</p>
      ${box && !compact && html`<div class="locator" title="Synthetic position from extracted_values.position (where a real page image would be highlighted)">
        <div class="locator-page"><div class="locator-box" style=${`left:${box.x0 * 100}%;top:${box.y0 * 100}%;width:${(box.x1 - box.x0) * 100}%;height:${Math.max(2, (box.y1 - box.y0) * 100)}%`}></div></div>
        <span class="muted small">field position</span></div>`}
    </div>
    <div class="paper-f muted small">
      Simulated from printed_content · ${evs.length} values extracted on this page
      ${doc.extraction.status !== 'extracted' && html` · <b class="warn-t">extraction ${doc.extraction.status}${doc.extraction.reason ? ': ' + doc.extraction.reason : ''}</b>`}
      ${sensitive && !revealed && (app.user.clearance
        ? html` · <button class="link small" onClick=${() => { app.act('view.sensitive', { what: `${doc.id} page ${pg.page}` }); setRevealed(true); }}>reveal identifiers (logged)</button>`
        : html` · identifiers masked (no clearance)`)}
    </div>
  </div>`;
}
