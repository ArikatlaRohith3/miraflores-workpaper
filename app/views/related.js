import { html, useState, useApp, Money, Delta, Badge, Ref, Refs, Section } from '../ui.js';
import { personName } from '../model.js';
import { adjustmentFor } from '../ledger.js';

// Everything outside this year's return that it depends on or affects:
// prior years, next year, and the returns of related people and entities.
export function RelatedView() {
  const app = useApp();
  const { model, st } = app;
  const hh = model.packet.household;
  const [q, setQ] = useState('');
  const pyKeys = Object.keys(model.pyLines).filter(k => model.current.byKey.has(k) && (!q || k.toLowerCase().includes(q.toLowerCase()) || (model.current.byKey.get(k).label || '').toLowerCase().includes(q.toLowerCase())));
  return html`<div class="page">
    <div class="page-h"><div><h1>Years & related returns</h1><div class="muted">The return does not stand alone: prior-year carryovers and basis, next year's roll-forward, and returns filed by related people and entities.</div></div></div>

    <${Section} title="Related returns">
      <table class="list"><thead><tr><th>Who</th><th>Return</th><th>Prepared by</th><th>In this packet</th><th>How it ties to this return</th></tr></thead><tbody>
        <tr><td>Ada Lindqvist-Okafor (daughter, 19, full-time student)</td><td class="small">${hh.related_returns[0].return}</td><td class="small">${hh.related_returns[0].prepared_by}</td><td><${Badge}>no</${Badge}></td>
          <td class="small">She checked "someone can claim you" — consistent with claiming her for the $500 credit for other dependents (<${Ref} r="F8812.6" label="F8812.6" />). Her 1098-T <${Ref} r="D59" /> supports the AOTC (phased out). <${Ref} r="household:ada" label="Ada" /></td></tr>
        <tr><td>Lindqvist Family Woodworks, Inc. (S corp, 20%)</td><td class="small">${hh.related_returns[1].return}</td><td class="small">${hh.related_returns[1].prepared_by}</td><td><${Refs} list=${['D39', 'D40']} /></td>
          <td class="small">K-1 income <${Ref} r="SchE.28A" label="SchE.28A" />, interest, 199A <${Ref} r="F8995.2.2" label="QBI" />, Oregon composite tax → California other-state credit <${Ref} r="ScheduleS.credit" label="Schedule S" />, stock basis roll-forward <${Ref} r="F7203.5" label="Form 7203" />.</td></tr>
        <tr><td>Ridgeline Real Estate Fund III LP</td><td class="small">${hh.related_returns[2].return}</td><td class="small">${hh.related_returns[2].prepared_by}</td><td><${Refs} list=${['D37', 'D38']} /></td>
          <td class="small">Rental income <${Ref} r="SchE.28B" label="SchE.28B" /> (22% California-source), interest, LT gain, foreign tax <${Ref} r="Sch3.1" label="Sch3.1" />; Arizona composite filed (no partner filing). Capital account 63,660; outside basis never computed.</td></tr>
      </tbody></table>
    </${Section}>

    <${Section} title="Across years">
      <div class="years">
        <div class="year card"><h3>2023</h3><ul class="small">
          <li>CP2000 for an unreported sale — resolved, basis 3,960 substantiated <${Ref} r="D70" /></li>
          <li>Woodworks K-1 (found June 2026): fills the basis gap <${Ref} r="D40" /></li>
          <li>Inheritance from Birgitta Lindqvist (Sparbanken account opened 09/2023): Form 3520 question open <${Ref} r="D07" /></li></ul></div>
        <div class="year card"><h3>2024 (Delta River Tax Services)</h3><ul class="small">
          <li>Return as filed <${Ref} r="D06" /> · prior workpaper <${Ref} r="D07" /></li>
          <li>Carryovers: capital loss 3,200 ST / 11,000 LT; passive 6,300 + 9,850; IRA basis 7,000 <${Ref} r="py:/carryovers_into_2025" label="carryovers" /></li>
          <li>Prior-year AGI for e-signature: ${hh.prior_year_agi_for_esignature.toLocaleString()}</li></ul></div>
        <div class="year card current"><h3>2025 (this return)</h3><ul class="small">
          <li>Engine v1 → v2 → v3 <${Refs} list=${['v1', 'v2', 'v3']} /></li>
          <li>${st.adjustments.size} workpaper changes · ${st.judgments.length} judgments</li>
          <li>Status: ${st.filing.status.replace(/_/g, ' ')}</li></ul></div>
        <div class="year card"><h3>2026 (next year)</h3><ul class="small">
          <li>Minimum tax credit ${model.current.carryovers_out.federal.minimum_tax_credit_from_2025_amt.toLocaleString()} (Form 8801); ISO AMT basis 52,000</li>
          <li>Texas resident all year: California taxes only the Sacramento rental and Ridgeline's California share</li>
          <li>SEP excess ${model.current.carryovers_out.federal.sep_contribution_not_deductible_for_2025.toLocaleString()} (withdraw or carry)</li>
          <li><a href="#/filing">Estimates and roll-forward →</a></li></ul></div>
      </div>
    </${Section}>

    <${Section} title="2024 vs 2025, line by line" right=${html`<input class="filter" placeholder="Filter…" value=${q} onInput=${e => setQ(e.target.value)} />`}>
      <table class="list"><thead><tr><th>Line</th><th class="r">2024 as filed</th><th class="r">2025 engine</th><th class="r">2025 workpaper</th><th class="r">Change</th><th>2024 source</th></tr></thead><tbody>
        ${pyKeys.map(k => { const l = model.current.byKey.get(k); const a = adjustmentFor(st, k); const cy = a ? a.to : l.value; const py = model.pyLines[k];
          return html`<tr><td><${Ref} r=${k} label=${k} /> <span class="small muted">${l.label}</span></td><td class="r"><${Money} v=${py} /></td><td class="r"><${Money} v=${l.value} /></td><td class="r">${a ? html`<b><${Money} v=${a.to} /></b>` : html`<span class="muted">same</span>`}</td>
            <td class="r">${typeof py === 'number' && typeof cy === 'number' ? html`<${Delta} v=${cy - py} />` : ''}</td><td>${[].concat(model.py.return_2024.line_sources?.[k] || []).slice(0, 1).map(r => html`<${Ref} r=${r} />`)}</td></tr>`; })}
      </tbody></table>
    </${Section}>

    <${Section} title=${`Links you have recorded (${st.links.length})`}>
      ${st.links.length ? html`<table class="list"><tbody>${st.links.map(l => html`<tr><td><${Ref} r=${l.from} /></td><td class="muted">↔</td><td><${Ref} r=${l.to} /></td><td class="small">${l.note}</td><td class="small muted">${personName(model, l.by)}</td></tr>`)}</tbody></table>`
        : html`<p class="muted small">Open any item and use "Link to…" to connect it to a line, document, prior-year record or related return.</p>`}
    </${Section}>
  </div>`;
}
