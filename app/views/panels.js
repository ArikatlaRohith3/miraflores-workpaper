// Area-specific records a CPA expects: books-to-tax, sales detail, depreciation,
// rentals and passive losses, K-1 lines and basis, state split, payments...
import { html, useState, useApp, Money, Badge, Ref, Refs, Section, Delta } from '../ui.js';
import { fmtMoney } from '../model.js';
import { adjustmentFor } from '../ledger.js';

// A line value with its workpaper override, clickable to trace.
function L({ k, cents, plain }) {
  const { model, st, openTrace } = useApp();
  const l = model.current.byKey.get(k);
  const adj = adjustmentFor(st, k);
  if (!l && !adj) return html`<span class="muted">—</span>`;
  const v = adj ? adj.to : l.value;
  const body = typeof v === 'number' ? html`<${Money} v=${v} cents=${cents} />` : html`<span>${v}</span>`;
  return html`<button class=${'cell-link' + (adj ? ' adjusted' : '')} onClick=${() => openTrace(k)} title=${adj ? `Engine ${l?.value}; ${adj.reason}` : k}>${body}</button>`;
}
const val = (app, k) => { const a = adjustmentFor(app.st, k); return a ? a.to : app.model.current.byKey.get(k)?.value; };
const EV = (app, d, f) => app.model.evByDocField.get(`${d}:${f}`);

function WagesPanel() {
  const app = useApp();
  const boxes = [['box1', 'Wages (box 1)'], ['box2', 'Federal withholding'], ['box3', 'SS wages'], ['box4', 'SS tax'], ['box5', 'Medicare wages'], ['box6', 'Medicare tax'], ['box10', 'Dependent care benefits'], ['box12_D', '401(k) (12 D)'], ['box12_W', 'HSA employer (12 W)'], ['box16', 'CA wages (box 16)'], ['box17', 'CA withholding']];
  const w2 = ['D08', 'D09', 'D10'];
  return html`<${Section} title="W-2s">
    <table class="list"><thead><tr><th>Box</th>${w2.map(d => html`<th class="r"><${Ref} r=${d} label=${d} />${d === 'D10' ? html` <${Badge}>duplicate photo</${Badge}>` : ''}</th>`)}<th class="r">Counted</th></tr></thead><tbody>
      ${boxes.map(([b, lab]) => html`<tr><td>${lab}</td>${w2.map(d => { const e = EV(app, d, b); return html`<td class=${'r' + (d === 'D10' ? ' muted' : '')}>${e ? html`<button class="cell-link" onClick=${() => app.openTrace(e.id)}><${Money} v=${e.value} /></button>` : '—'}</td>`; })}
        <td class="r"><${Money} v=${['D08', 'D09'].reduce((s, d) => s + (EV(app, d, b)?.value || 0), 0)} /></td></tr>`)}
    </tbody></table>
  </${Section}>
  <${Section} title="Stock compensation">
    <table class="list"><thead><tr><th>Grant</th><th>Event</th><th class="r">Shares</th><th class="r">Income in W-2</th><th class="r">Basis</th><th>Treatment</th></tr></thead><tbody>
      <tr><td>RSU-2502</td><td>vest 02/15/2025, sold 02/18</td><td class="r">400</td><td class="r">19,100</td><td class="r"><${Ref} r="ev-0066" label="19,100" /></td><td>1099-B N1 noncovered, basis blank → add basis (code B)</td></tr>
      <tr><td>RSU-2505</td><td>vest 05/15/2025, sold 05/20</td><td class="r">400</td><td class="r">19,100</td><td class="r"><${Ref} r="ev-0068" label="19,100" /></td><td>1099-B N3 noncovered → add basis</td></tr>
      <tr><td>RSU-2308</td><td>vest 08/15/2023, sold 08/12/2025</td><td class="r">300</td><td class="r">(2023)</td><td class="r"><${Ref} r="ev-0070" label="9,420" /></td><td>1099-B N4 long-term noncovered → add basis</td></tr>
      <tr><td>ESPP-2406</td><td>purchased 06/28/2024, disqualifying sale 03/10/2025</td><td class="r">150</td><td class="r"><${Ref} r="ev-0074" label="675" /></td><td class="r"><${Ref} r="ev-0072" label="4,500" /></td><td>Engine adjusted basis −675 (code B) ✓</td></tr>
      <tr><td>ISO (Form 3921)</td><td>exercised 07/30/2025 at 12.00, FMV 52.00</td><td class="r">1,000</td><td class="r">0 (AMT)</td><td class="r">12,000 reg / 52,000 AMT</td><td>AMT adjustment <${L} k="F6251.2i" />; shares still held (qa-06)</td></tr>
    </tbody></table>
    <p class="muted small">Corvane W-2 box 14 RSU <${Ref} r="ev-0027" label="38,200" /> = the two 2025 vests (19,100 + 19,100). That is why the 1099-B basis must be added: otherwise the vest income is taxed twice.</p>
  </${Section}>`;
}

function parseLot(l) {
  const m = /^(.*?) \(acquired (\S+), sold (\S+); proceeds ([\d,.]+), basis ([\d,.]+)(?:, adjustment (\w) (-?[\d,.]+))?\)/.exec(l.label);
  const n = s => Number(String(s).replace(/,/g, ''));
  const [, box, id] = l.key.split('.');
  return m ? { key: l.key, box, id, desc: m[1], acq: m[2], sold: m[3], proceeds: n(m[4]), basis: n(m[5]), code: m[6] || '', adj: m[7] ? n(m[7]) : 0, gain: l.value, src: l.sources[0] }
    : { key: l.key, box, id, desc: l.label, proceeds: 0, basis: 0, adj: 0, gain: l.value, src: l.sources?.[0] };
}
const BROKER = id => id.startsWith('X') ? 'Brightpath (D74)' : id.startsWith('M') ? 'Meridian (D31 corrected)' : id.startsWith('N') ? 'Northlake (D28)' : id.startsWith('C') ? 'Coinhaven (D34/D35)' : 'Woodworks S corp (F7203)';

function InvestmentsPanel() {
  const app = useApp();
  const lots = app.model.current.lines.filter(l => /^F8949\.[A-Z]\.(?!total)/.test(l.key)).map(parseLot);
  const extra = [...app.st.adjustments.values()].filter(a => a.newLine && a.status !== 'rejected' && a.key.startsWith('F8949'));
  const [q, setQ] = useState('');
  const [box, setBox] = useState('all');
  const [only, setOnly] = useState('exceptions');
  const [page, setPage] = useState(0);
  const isException = x => x.basis === 0 || x.code || adjustmentFor(app.st, x.key);
  const groups = new Map();
  for (const x of lots) {
    const g = `${BROKER(x.id)}|${x.box}`;
    if (!groups.has(g)) groups.set(g, { broker: BROKER(x.id), box: x.box, n: 0, proceeds: 0, basis: 0, adj: 0, gain: 0, wp: 0, exceptions: 0 });
    const s = groups.get(g); s.n++; s.proceeds += x.proceeds; s.basis += x.basis; s.adj += x.adj; s.gain += x.gain;
    const a = adjustmentFor(app.st, x.key); s.wp += a ? a.to : x.gain; if (isException(x)) s.exceptions++;
  }
  for (const a of extra) { const g = `${BROKER(a.key.split('.')[2])}|${a.key.split('.')[1]}`; const s = groups.get(g); if (s) { s.n++; s.wp += a.to; s.exceptions++; } }
  let list = lots.filter(x => (box === 'all' || x.box === box) && (!q || (x.desc + x.id).toLowerCase().includes(q.toLowerCase())) && (only === 'all' || isException(x)));
  const per = 25;
  const pages = Math.ceil(list.length / per);
  const shown = list.slice(page * per, page * per + per);
  return html`<${Section} title=${`Sales detail — ${lots.length} dispositions`} right=${html`<span class="muted small">Totals first; only exceptions expanded by default</span>`}>
    <table class="list"><thead><tr><th>Source</th><th>Box</th><th class="r">Lots</th><th class="r">Proceeds</th><th class="r">Basis</th><th class="r">Adj.</th><th class="r">Engine gain</th><th class="r">Workpaper</th><th class="r">Exceptions</th></tr></thead><tbody>
      ${[...groups.values()].map(s => html`<tr><td>${s.broker}</td><td><code>${s.box}</code></td><td class="r">${s.n}</td><td class="r"><${Money} v=${s.proceeds} cents /></td><td class="r"><${Money} v=${s.basis} cents /></td><td class="r"><${Money} v=${s.adj} cents /></td><td class="r"><${Money} v=${s.gain} /></td><td class="r"><b><${Money} v=${s.wp} /></b></td><td class="r">${s.exceptions ? html`<${Badge} kind="warn">${s.exceptions}</${Badge}>` : ''}</td></tr>`)}
    </tbody></table>
    <p class="muted small">Brightpath summary vs detail: 110 short-term lots sum to <${Ref} r="ev-1083" label="the 1099-B summary" /> exactly; 150 long-term likewise. Meridian: summary 71,965 vs detail 71,715 — the 250 is lot M18 on unread page 32.</p>
    <div class="row filters">
      <input placeholder="Search security or lot…" value=${q} onInput=${e => { setQ(e.target.value); setPage(0); }} />
      <select value=${box} onChange=${e => { setBox(e.target.value); setPage(0); }}><option value="all">All boxes</option>${[...new Set(lots.map(x => x.box))].map(b => html`<option value=${b}>Box ${b}</option>`)}</select>
      <select value=${only} onChange=${e => { setOnly(e.target.value); setPage(0); }}><option value="exceptions">Exceptions only</option><option value="all">All lots</option></select>
      <span class="muted small">${list.length} lots</span>
    </div>
    <table class="list lots"><thead><tr><th>Lot</th><th>Security</th><th>Acquired</th><th>Sold</th><th class="r">Proceeds</th><th class="r">Basis</th><th>Code</th><th class="r">Adj.</th><th class="r">Gain</th><th></th></tr></thead><tbody>
      ${shown.map(x => { const a = adjustmentFor(app.st, x.key); return html`<tr class=${a ? 'adjusted' : ''}>
        <td><button class="link" onClick=${() => app.openTrace(x.key)}>${x.id}</button> <code class="muted">${x.box}</code></td><td>${x.desc}</td><td>${x.acq}</td><td>${x.sold}</td>
        <td class="r"><${Money} v=${x.proceeds} cents /></td><td class=${'r' + (x.basis === 0 ? ' warn-t' : '')}><${Money} v=${x.basis} cents /></td><td>${x.code}</td><td class="r">${x.adj ? html`<${Money} v=${x.adj} cents />` : ''}</td>
        <td class="r">${a ? html`<s class="muted"><${Money} v=${x.gain} cents /></s> <b><${Money} v=${a.to} cents /></b>` : html`<${Money} v=${x.gain} cents />`}</td>
        <td>${x.src && html`<${Ref} r=${x.src} label="src" />`}</td></tr>`; })}
      ${extra.map(a => html`<tr class="adjusted"><td><button class="link" onClick=${() => app.openTrace(a.key)}>${a.key.split('.')[2]}</button> <code class="muted">${a.key.split('.')[1]}</code></td><td colspan="7">${a.label} <${Badge} kind="info">added by workpaper</${Badge}></td><td class="r"><b><${Money} v=${a.to} cents /></b></td><td><${Ref} r="doc:D31#page32" label="src" /></td></tr>`)}
    </tbody></table>
    ${pages > 1 && html`<div class="pager"><button class="small" disabled=${page === 0} onClick=${() => setPage(page - 1)}>‹</button> page ${page + 1} of ${pages} <button class="small" disabled=${page >= pages - 1} onClick=${() => setPage(page + 1)}>›</button></div>`}
  </${Section}>
  <${Section} title="Schedule D">
    <table class="list"><tbody>${['SchD.1b', 'SchD.2', 'SchD.3', 'SchD.6', 'SchD.7', 'SchD.8b', 'SchD.9', 'SchD.10', 'SchD.11', 'SchD.12', 'SchD.13', 'SchD.14', 'SchD.15', 'SchD.16', 'SchD.19'].map(k => html`<tr><td><code>${k}</code></td><td>${app.model.current.byKey.get(k)?.label}</td><td class="r"><${L} k=${k} /></td></tr>`)}</tbody></table>
  </${Section}>`;
}

const BOOKS_MAP = [
  ['Sales - client projects', 'SchC.1', 'Receipts', 'Sales - print and licensing'],
  ['Advertising', 'SchC.8'], ['Car and truck - fuel', 'SchC.9', 'Replaced by standard mileage'], ['Contract labor', 'SchC.11'],
  ['Depreciation', 'SchC.13', 'Client SL 5 yr → tax 100% special depreciation'], ['Insurance - business liability', 'SchC.15'],
  ['Insurance - health (Erik)', 'Sch1.17', 'Not a Schedule C expense; Schedule 1 line 17 (if allowed)'], ['Legal and professional', 'SchC.17'],
  ['Meals', 'SchC.24b', '50% limit'], ['Office expenses', 'SchC.18'], ['Software and subscriptions', 'SchC.27a.1'], ['Supplies', 'SchC.22'],
  ['Telephone', 'SchC.25', 'Telephone + internet → utilities', 'Internet'], ['Travel', 'SchC.24a'], ['Bank and merchant fees', 'SchC.27a.2'], [null, 'SchC.30', 'Home office (not in books)'],
];

function BusinessPanel() {
  const app = useApp();
  const b = f => EV(app, 'D14', f)?.value || 0;
  const rows = BOOKS_MAP.map(([f, k, note, f2]) => {
    const books = f ? b(f) + (f2 ? b(f2) : 0) : 0;
    const eng = app.model.current.byKey.get(k)?.value ?? 0;
    const wp = val(app, k) ?? 0;
    return { f, f2, k, note, books, eng, wp, income: k === 'SchC.1', ev: f && EV(app, 'D14', f) };
  });
  const sign = r => (r.income ? 1 : r.k === 'Sch1.17' ? 0 : -1);
  const tot = key => rows.reduce((s, r) => s + sign(r) * r[key], 0);
  const booksNet = b('Sales - client projects') + b('Sales - print and licensing') - (b('Advertising') + b('Bank and merchant fees') + b('Car and truck - fuel') + b('Contract labor') + b('Depreciation') + b('Insurance - business liability') + b('Insurance - health (Erik)') + b('Internet') + b('Legal and professional') + b('Meals') + b('Office expenses') + b('Software and subscriptions') + b('Supplies') + b('Telephone') + b('Travel'));
  return html`<${Section} title="Books to taxable income — Lindqvist Studio">
    <table class="list btt"><thead><tr><th>Books account (D14, cash basis)</th><th class="r">Books</th><th>Schedule C line</th><th class="r">Engine</th><th class="r">Workpaper</th><th class="r">Books → tax</th><th>Why</th></tr></thead><tbody>
      ${rows.map(r => html`<tr>
        <td>${r.ev ? html`<button class="link" onClick=${() => app.openTrace(r.ev.id)}>${r.f}</button>` : html`<span class="muted">—</span>`}${r.f2 ? html` + ${r.f2}` : ''}</td>
        <td class="r"><${Money} v=${r.books} /></td><td><code>${r.k}</code></td><td class="r"><${Money} v=${r.eng} /></td><td class="r"><${L} k=${r.k} /></td>
        <td class="r"><${Delta} v=${r.wp - r.books} /></td><td class="small muted">${r.note || ''}</td></tr>`)}
      <tr class="strong"><td>Net income per books</td><td class="r"><${Money} v=${booksNet} /></td><td><code>SchC.31</code></td><td class="r"><${Money} v=${app.model.current.byKey.get('SchC.31').value} /></td><td class="r"><${Money} v=${tot('wp')} /></td><td class="r"><${Delta} v=${tot('wp') - booksNet} /></td><td class="small muted">Net profit (health insurance moved to Schedule 1)</td></tr>
    </tbody></table>
    <h4 class="sub">From Schedule C to the return</h4>
    <table class="list"><tbody>${['SchSE.2', 'SchSE.12', 'Sch1.15', 'Sch1.16', 'Sch1.17', 'F8995.2.1', 'F8995.15.1'].map(k => html`<tr><td><code>${k}</code></td><td>${app.model.current.byKey.get(k)?.label}</td><td class="r"><${L} k=${k} /></td></tr>`)}</tbody></table>
    <p class="muted small">Engine values downstream of Schedule C (SE tax, SEP limit, QBI) are not recomputed here; the tax-effect rate for Schedule C profit includes SE tax and QBI.</p>
  </${Section}>
  <${DepreciationTable} filter=${a => a.activity.startsWith('Business')} title="Business assets (Form 4562)" />`;
}

function DepreciationTable({ filter, title }) {
  const app = useApp();
  const assets = app.model.current.assets.filter(filter);
  return html`<${Section} title=${title}>
    <table class="list dep"><thead><tr><th>Asset</th><th>In service</th><th class="r">Cost</th><th>Method / life</th><th class="r">Fed prior</th><th class="r">Fed 2025</th><th class="r">Fed accum.</th><th class="r">CA 2025</th><th class="r">CA accum.</th><th class="r">AMT diff</th><th>Disposal</th></tr></thead><tbody>
      ${assets.map(a => html`<tr>
        <td><${Ref} r=${'asset:' + a.asset_id} label=${a.asset_id} /><div class="small muted">${a.description}</div></td>
        <td>${a.placed_in_service}</td><td class="r"><${Money} v=${a.cost} />${a.land_value_not_depreciated ? html`<div class="small muted">land ${fmtMoney(a.land_value_not_depreciated)}</div>` : ''}</td>
        <td class="small">${a.method}${a.life_years ? ` · ${a.life_years} yr` : ''}</td>
        <td class="r"><${Money} v=${a.federal.prior_accumulated} cents /></td><td class="r"><${Money} v=${a.federal.depreciation_2025} cents /></td><td class="r"><${Money} v=${a.federal.accumulated_end} cents /></td>
        <td class="r"><${Money} v=${a.california?.depreciation_2025} cents /></td><td class="r"><${Money} v=${a.california?.accumulated_end} cents /></td>
        <td class="r">${a.amt ? fmtMoney(a.amt.difference_from_regular, true) : '—'}</td>
        <td class="small">${a.disposition ? html`sold ${a.disposition.date} · unrecaptured §1250 ${fmtMoney(a.disposition.unrecaptured_1250_depreciation, true)} · ordinary recapture ${fmtMoney(a.disposition.section_1250_ordinary_recapture)}` : ''}</td>
      </tr>`)}
    </tbody></table>
  </${Section}>`;
}

function RentalsPanel() {
  const app = useApp();
  const rows = [['3', 'Rents'], ['9', 'Insurance'], ['11', 'Management fees'], ['12', 'Mortgage interest'], ['14', 'Repairs'], ['16', 'Taxes'], ['18', 'Depreciation'], ['19', 'Other (HOA)'], ['20', 'Total expenses'], ['21', 'Income or (loss)'], ['22', 'Allowed after passive limits']];
  return html`<${Section} title="Rental properties (Schedule E)">
    <table class="list"><thead><tr><th>Line</th><th class="r">A · 1450 Fremont Way</th><th class="r">B · 1200 Barton Hills 4C (sold 10/15)</th></tr></thead><tbody>
      ${rows.map(([n, lab]) => html`<tr class=${n === '21' || n === '22' ? 'strong' : ''}><td>${n} ${lab}</td><td class="r"><${L} k=${'SchE.' + n + 'A'} /></td><td class="r"><${L} k=${'SchE.' + n + 'B'} /></td></tr>`)}
      <tr><td>Days rented / personal</td><td class="r"><${L} k="SchE.2A" /></td><td class="r"><${L} k="SchE.2B" /></td></tr>
    </tbody></table>
  </${Section}>
  <${Section} title="Passive activity losses (Form 8582)">
    <table class="list"><tbody>${['F8582.1a', 'F8582.1b', 'F8582.1c', 'F8582.3a', 'F8582.4'].map(k => html`<tr><td><code>${k}</code></td><td>${app.model.current.byKey.get(k)?.label}</td><td class="r"><${L} k=${k} /></td></tr>`)}</tbody></table>
    <p class="muted small">Prior-year unallowed losses <${Ref} r="py:/carryovers_into_2025/passive_1450_fremont" label="6,300" /> and <${Ref} r="py:/carryovers_into_2025/passive_1200_barton_hills" label="9,850" /> are freed: net passive income is positive and the condo was fully disposed of.</p>
  </${Section}>
  <${Section} title="Sale of 1200 Barton Hills Dr 4C (Form 4797)">
    <table class="list"><tbody>${['F4797.20', 'F4797.21', 'F4797.22', 'F4797.23', 'F4797.24', 'F4797.25', 'F4797.26g', 'F4797.9', 'SchD.19'].map(k => html`<tr><td><code>${k}</code></td><td>${app.model.current.byKey.get(k)?.label}</td><td class="r"><${L} k=${k} /></td></tr>`)}</tbody></table>
  </${Section}>
  <${DepreciationTable} filter=${a => a.activity.startsWith('Rental')} title="Rental depreciation by asset — federal vs California vs AMT" />`;
}

function PassthroughPanel() {
  const app = useApp();
  const k1 = [
    ['Woodworks (1120-S) box 1 ordinary income', 'D39', 'box1', 'SchE.28A'], ['Woodworks box 4 interest', 'D39', 'box4', 'SchB.1.7'], ['Woodworks box 16D distributions', 'D39', 'box16d', 'F7203.6'],
    ['Woodworks 199A QBI / W-2 wages / UBIA', 'D39', 'qbi', 'F8995.2.2'], ['Woodworks Oregon composite tax', 'D39', 'or_tax', 'ScheduleS.credit'],
    ['Ridgeline (1065) box 2 rental income', 'D37', 'box2', 'SchE.28B'], ['Ridgeline box 5 interest', 'D37', 'box5', 'SchB.1.8'], ['Ridgeline box 9a LT gain', 'D37', 'box9a', 'SchD.12'],
    ['Ridgeline box 21 foreign tax', 'D37', 'box21', 'Sch3.1'], ['Ridgeline box 19A distributions', 'D37', 'box19a', null],
  ];
  const b = app.model.py.basis_records;
  return html`<${Section} title="K-1 lines → return">
    <table class="list"><thead><tr><th>K-1 item</th><th class="r">K-1</th><th>Return line</th><th class="r">Return</th></tr></thead><tbody>
      ${k1.map(([lab, d, f, k]) => { const e = EV(app, d, f); return html`<tr><td>${lab}</td><td class="r">${e ? html`<button class="cell-link" onClick=${() => app.openTrace(e.id)}><${Money} v=${e.value} /></button>` : '—'}</td><td>${k ? html`<code>${k}</code>` : html`<span class="muted">capital account</span>`}</td><td class="r">${k ? html`<${L} k=${k} />` : ''}</td></tr>`; })}
    </tbody></table>
  </${Section}>
  <${Section} title="Basis by year">
    <table class="list"><thead><tr><th>Year</th><th>Woodworks stock basis</th><th>Source</th></tr></thead><tbody>
      <tr><td>2022</td><td class="r">21,300</td><td><${Ref} r="py:/basis_records/scorp_lindqvist_family_woodworks/0" label="client worksheet" /></td></tr>
      <tr><td>2023</td><td class="r">21,300 + 14,100 − 20,000 = <b>15,400</b></td><td><${Ref} r="D40" /> (late; found in June 2026)</td></tr>
      <tr><td>2024</td><td class="r">15,400 + 16,900 − 30,000 = <b>2,300</b></td><td><${Ref} r="py:/return_2024/K1_1120S" label="2024 K-1" /> · prior preparer "assumed sufficient"</td></tr>
      <tr><td>2025</td><td class="r">2,300 + 18,485 − 42,000 → <b>0</b>, excess <${L} k="F7203.excess" /> taxed as LT gain</td><td><${Ref} r="D39" /></td></tr>
    </tbody></table>
    <p class="muted small">Ridgeline capital account: ${b.partnership_ridgeline[0].ending_capital_account.toLocaleString()} (2024) → 63,660 (2025 per K-1). Outside basis was never computed — gap recorded for next year.</p>
  </${Section}>`;
}

function RetirementPanel() {
  const app = useApp();
  const t = keys => html`<table class="list"><tbody>${keys.map(k => html`<tr><td><code>${k}</code></td><td>${app.model.current.byKey.get(k)?.label}</td><td class="r"><${L} k=${k} /></td></tr>`)}</tbody></table>`;
  return html`<${Section} title="Backdoor Roth (Form 8606)">${t(['F8606.1', 'F8606.2', 'F8606.3', 'F8606.6', 'F8606.8', 'F8606.10', 'F8606.11', 'F8606.18', 'F8606.14'])}
    <p class="muted small">The client said there was no prior basis (<${Ref} r="qa-31" />). The 2024 Form 8606 and 2024 Form 5498 (<${Ref} r="D42" />) show 7,000. The record wins; the conflict is documented.</p></${Section}>
  <${Section} title="HSA (Form 8889)">${t(['F8889.3', 'F8889.9', 'F8889.13', 'F8889.14a', 'F8889.16', 'SchCA540NR.1.C'])}</${Section}>
  <${Section} title="Foreign account — Sparbanken Norrland">${t(['SchB.1.6', 'SchB.7a', 'SchB.7b', 'F8938.1.max', 'F8938.1.ye', 'F8938.req'])}
    <p class="muted small">FBAR (FinCEN 114) is outside the engagement but required (max balance above 10,000 USD). The 2023 Form 3520 question from the prior preparer is still open.</p></${Section}>`;
}

function DeductionsPanel() {
  const app = useApp();
  const t = keys => html`<table class="list"><tbody>${keys.map(k => html`<tr><td><code>${k}</code></td><td>${app.model.current.byKey.get(k)?.label}</td><td class="r"><${L} k=${k} /></td></tr>`)}</tbody></table>`;
  return html`<${Section} title="Itemized deductions with limits">${t(['SchA.5a', 'SchA.5b', 'SchA.5d', 'SchA.5e', 'SchA.8a', 'SchA.8c', 'SchA.11', 'F8283.A1.stock', 'F8283.A1.vehicle', 'SchA.14', 'SchA.17', 'F1040.12'])}
    <p class="muted small">SALT cap ${fmtMoney(app.model.packet.engine_reference.parameters.salt_cap)} (phase-down above 500,000 MAGI). Standard deduction what-if: +12,306 federal tax.</p></${Section}>
  <${Section} title="Credits">${t(['F8812.4', 'F8812.6', 'F8812.8', 'F8812.11', 'F8812.12', 'F8863.27', 'F8863.30', 'F8863.7', 'F2441.1a', 'F2441.1b', 'F2441.2', 'F2441.12', 'F2441.31', 'Sch3.1', 'F8867.status'])}</${Section}>`;
}

function PaymentsPanel() {
  const app = useApp();
  const tr = app.model.packet.tax_agency_records;
  const t = keys => html`<table class="list"><tbody>${keys.map(k => html`<tr><td><code>${k}</code></td><td>${app.model.current.byKey.get(k)?.label}</td><td class="r"><${L} k=${k} /></td></tr>`)}</tbody></table>`;
  return html`<${Section} title="Federal payments vs IRS records">
    ${t(['F1040.25a', 'F1040.26', 'Sch3.10', 'Sch3.11', 'F1040.33', 'F1040.37', 'F2210.8', 'F2210.19', 'F2210.AI', 'F1040.38'])}
    <h4 class="sub">IRS account transcript (${tr.irs_account_transcript_2025[tr.irs_account_transcript_2025.length - 1].as_of})</h4>
    <table class="list"><tbody>${tr.irs_account_transcript_2025[tr.irs_account_transcript_2025.length - 1].transactions.map(x => html`<tr><td>${x.date}</td><td><code>${x.code}</code></td><td>${x.description}</td><td class="r">${typeof x.amount === 'number' ? fmtMoney(x.amount) : html`<span class="muted small">${x.amount}</span>`}</td></tr>`)}</tbody></table>
  </${Section}>
  <${Section} title="California payments vs FTB">
    ${t(['F540NR.71', 'F540NR.72', 'F540NR.73', 'F540NR.78', 'F540NR.97', 'FTB5805.penalty'])}
    <table class="list"><tbody>${tr.ftb_account.tax_year_2025_payments.map(x => html`<tr><td>${x.date}</td><td>TY2025</td><td class="r">${fmtMoney(x.amount)}</td></tr>`)}
    ${tr.ftb_account.tax_year_2024_payments_after_filing.map(x => html`<tr class="flag"><td>${x.date}</td><td>TY2024 — ${x.note}</td><td class="r">${fmtMoney(x.amount)}</td></tr>`)}</tbody></table>
  </${Section}>
  <${PostFiling} />`;
}

function PostFiling() {
  const app = useApp();
  const r = app.model.packet.post_filing_rates;
  const [paid, setPaid] = useState('2026-07-20');
  const ext = app.model.packet.what_if.extension;
  const bal = val(app, 'F1040.37');
  const days = Math.max(0, (new Date(paid) - new Date('2026-04-15')) / 864e5);
  const months = Math.ceil(days / 30.4);
  const interest = bal * r.irs_underpayment_interest_rate_annual * days / 365;
  const ftp = bal * r.irs_failure_to_pay_penalty_per_month * months;
  return html`<${Section} title="Extension and late-payment cost">
    <p>Extension 04/14/2026 (from engine v2): estimated balance ${fmtMoney(ext.federal.estimated_balance)}, paid ${fmtMoney(ext.federal.paid_with_form_4868)} with Form 4868; California ${fmtMoney(ext.california.paid_with_ftb_3519)} (refund expected).</p>
    <div class="row">Balance paid on <input type="date" value=${paid} onInput=${e => setPaid(e.target.value)} /> → ${Math.round(days)} days late:
      interest ≈ <b>${fmtMoney(Math.round(interest))}</b>, failure-to-pay ≈ <b>${fmtMoney(Math.round(ftp))}</b> on a balance of ${fmtMoney(bal)} (engine line; adjust with approved changes).</div>
    <p class="muted small">${r.note}</p>
  </${Section}>`;
}

function CaliforniaPanel() {
  const app = useApp();
  const p = app.model.packet.engine_reference.parameters;
  const rows = [['1', 'Wages'], ['2', 'Taxable interest'], ['3', 'Ordinary dividends'], ['4', 'IRA distributions'], ['7', 'Capital gain'], ['12', 'Business income'], ['17', 'Rental, partnerships, S corps'], ['22', 'Total income'], ['26', 'Adjustments']];
  return html`<${Section} title="State split — Schedule CA (540NR)" right=${html`<span class="muted small">California resident 01/01–07/14 (${p.ca_resident_days}/${p.year_days} days); Texas after</span>`}>
    <table class="list"><thead><tr><th>Line</th><th class="r">A Federal</th><th class="r">B Subtract</th><th class="r">C Add</th><th class="r">D CA law</th><th class="r">E CA source</th><th class="r">E / D</th></tr></thead><tbody>
      ${rows.map(([n, lab]) => { const d = val(app, `SchCA540NR.${n}.D`), e = val(app, `SchCA540NR.${n}.E`); return html`<tr class=${n === '22' ? 'strong' : ''}><td>${n} ${lab}</td>${['A', 'B', 'C', 'D', 'E'].map(c => html`<td class="r"><${L} k=${`SchCA540NR.${n}.${c}`} /></td>`)}<td class="r small muted">${d && e != null ? Math.round(e / d * 100) + '%' : ''}</td></tr>`; })}
    </tbody></table>
    <h4 class="sub">540NR tax</h4>
    <table class="list"><tbody>${['F540NR.17', 'SchCA540NR.A.itemized', 'F540NR.18', 'F540NR.19', 'F540NR.31', 'F540NR.32', 'F540NR.34', 'F540NR.35', 'F540NR.36', 'F540NR.37', 'F540NR.39', 'ScheduleS.credit', 'F540NR.61', 'F540NR.64'].map(k => html`<tr><td><code>${k}</code></td><td>${app.model.current.byKey.get(k)?.label}</td><td class="r"><${L} k=${k} /></td></tr>`)}</tbody></table>
    <p class="muted small">Sourcing decisions to document: Halvorsen wages after the move, the ISO spread (granted while working in California, exercised as a Texas resident), the Ridgeline 22% California share, and the Sacramento rental (fully California-source).</p>
  </${Section}>`;
}

function TaxCalcPanel() {
  const app = useApp();
  const co = app.model.current.carryovers_out;
  return html`<${Section} title="Tax computation">
    <table class="list"><tbody>${['F1040.9', 'F1040.10', 'F1040.11', 'F1040.12', 'F1040.13', 'F1040.15', 'F1040.16', 'F6251.4', 'F6251.9', 'F6251.11', 'F1040.18', 'F1040.19', 'F1040.20', 'F1040.22', 'Sch2.4', 'Sch2.11', 'Sch2.12', 'F1040.24'].map(k => html`<tr><td><code>${k}</code></td><td>${app.model.current.byKey.get(k)?.label}</td><td class="r"><${L} k=${k} /></td></tr>`)}</tbody></table>
  </${Section}>
  <${Section} title="Carryovers to 2026">
    <table class="list"><thead><tr><th>Item</th><th class="r">Federal</th></tr></thead><tbody>
      ${Object.entries(co.federal).map(([k, v]) => html`<tr><td>${k.replace(/_/g, ' ')}</td><td class="r"><${Money} v=${v} /></td></tr>`)}
      ${Object.entries(co.california.depreciation_basis_differences || {}).map(([k, v]) => html`<tr><td>California depreciation basis difference — ${k}</td><td class="r"><${Money} v=${v} cents /></td></tr>`)}
    </tbody></table>
    <p class="muted small">Not in the engine but carried by this workpaper: ISO AMT basis (52,000 vs 12,000 regular), Ridgeline outside basis (never computed), SEP excess decision, HVAC as a new 27.5-year asset if adopted.</p>
  </${Section}>`;
}

export const PANELS = { wages: WagesPanel, investments: InvestmentsPanel, business: BusinessPanel, rentals: RentalsPanel, passthrough: PassthroughPanel, retirement: RetirementPanel, deductions: DeductionsPanel, payments: PaymentsPanel, california: CaliforniaPanel, taxcalc: TaxCalcPanel };
