// Independent checks. Each one recomputes something from the documents (and
// the packet's own records) instead of trusting the engine's lines. A check
// returns a finding with evidence refs and, where the fix is mechanical, a
// proposed adjustment that a preparer can adopt with one click.

import { fmtMoney } from './model.js';

export function runChecks(m) {
  const C = ctx(m);
  const out = [];
  C.results = out;
  for (const e of m.packet.extracted_values) C_EV_DOC.set(e.id, e.document_id);
  for (const fn of CHECKS) {
    try { const r = fn(C); if (r) (Array.isArray(r) ? out.push(...r) : out.push(r)); }
    catch (err) { out.push({ id: `error-${fn.name}`, area: 'taxcalc', title: `Check ${fn.name} could not run`, status: 'warn', why: String(err), refs: [], lines: [], proposals: [] }); }
  }
  const rank = { fail: 0, warn: 1, info: 2, pass: 3 };
  return out.sort((a, b) => rank[a.status] - rank[b.status]);
}

function ctx(m) {
  const L = k => m.current.byKey.get(k);
  const V = k => L(k)?.value;
  const E = (doc, field) => m.evByDocField.get(`${doc}:${field}`);
  const EV = (doc, field) => E(doc, field)?.value;
  const text = (doc, page) => m.docs.get(doc)?.pages.find(p => p.page === (page || 1))?.printed_content || '';
  const allText = doc => (m.docs.get(doc)?.pages || []).map(p => p.printed_content).join(' ');
  const evs = doc => m.evByDoc.get(doc) || [];
  const residentTo = m.packet.household.residency.find(r => r.state === 'CA')?.to;
  return { m, L, V, E, EV, text, allText, evs, residentTo };
}

const money = v => fmtMoney(v);
const prop = (key, from, to, effects, reason, authority, extra = {}) => ({ key, from, to, effects, reason, authority, ...extra });

// 1. Duplicate documents counted once?
function duplicateDocuments(C) {
  const { m } = C;
  const sig = new Map();
  const findings = [];
  for (const d of m.packet.documents) {
    const vals = C.evs(d.id).filter(e => e.value_type === 'money').map(e => `${e.field}=${e.value}`).sort().join(';');
    if (!vals) continue;
    const k = `${d.document_type}|${d.issuer}|${vals}`;
    if (sig.has(k)) {
      const first = sig.get(k);
      const box1 = C.EV(first, 'box1');
      const used = m.current.lines.filter(l => (l.sources || []).some(s => m.ev.get(s)?.document_id === d.id));
      findings.push({
        id: `dup-${first}-${d.id}`, area: 'wages', status: used.length ? 'fail' : 'pass',
        title: `${d.id} duplicates ${first} (${d.title})`,
        why: used.length ? `${d.id} is a second copy of ${first} and is used by ${used.length} line(s).`
          : `Every amount on ${d.id} matches ${first}. The return uses ${first} only (box 1 ${money(box1)} counted once).`,
        refs: [first, d.id, 'msg-02'], lines: used.map(l => l.key), proposals: [],
      });
    } else sig.set(k, d.id);
  }
  return findings;
}

// 2. Same interest reported twice (composite 1099 and stand-alone 1099-INT for one account)?
function interestDoubleCount(C) {
  const { m } = C;
  const lines = m.current.lines.filter(l => /^SchB\.1\.\d+$/.test(l.key));
  const out = [];
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
    const a = lines[i], b = lines[j];
    if (a.value !== b.value) continue;
    const da = m.ev.get(a.sources[0])?.document_id, db = m.ev.get(b.sources[0])?.document_id;
    const ta = C.allText(da), tb = C.allText(db);
    const acct = /ending (\d{4})/.exec(ta)?.[1];
    if (acct && tb.includes(acct)) {
      out.push({
        id: 'interest-double', area: 'investments', status: 'fail',
        title: `Interest ${money(a.value)} counted twice (${a.key} and ${b.key})`,
        why: `${da} (composite 1099) and ${db} (1099-INT) both report the bank-sweep interest on account ending ${acct}. The ${db} statement says it is the sweep program for that account. It is one payment reported on two forms.`,
        refs: [a.sources[0], b.sources[0], da, db], lines: [a.key, b.key, 'SchB.2', 'F1040.2b'],
        proposals: [prop(b.key, b.value, 0, [{ cat: 'interest', base: -b.value }], `Same sweep interest already on ${a.key} (${da}); remove duplicate.`, 'Agreed to source documents')],
      });
    }
  }
  return out.length ? out : { id: 'interest-double', area: 'investments', status: 'pass', title: 'No interest reported twice', why: 'Each Schedule B payer is distinct.', refs: [], lines: [], proposals: [] };
}

// 3. Foreign interest converted with the right year's rate?
function foreignCurrencyRate(C) {
  const line = C.L('SchB.1.6'); if (!line) return null;
  const fxRef = line.sources.find(s => s.startsWith('ref:fx'));
  const fx = C.m.packet.engine_reference.parameters.fx.SEK;
  const sek = C.EV('D36', 'interest_sek');
  const right = Math.round(sek / fx['2025_average']);
  const ok = fxRef?.endsWith('2025_average');
  return {
    id: 'fx-rate-year', area: 'retirement', status: ok ? 'pass' : 'fail',
    title: ok ? 'Swedish interest uses the 2025 average rate' : `Swedish interest converted at the 2024 rate (${money(line.value)} → ${money(right)})`,
    why: `SEK ${money(sek)} of 2025 interest. The engine used ${fxRef} (${fx['2024_average']} SEK/USD). The 2025 average is ${fx['2025_average']}, which gives ${money(right)}.`,
    refs: ['ev-0960', 'ref:fx.SEK.2025_average', 'D36'], lines: ['SchB.1.6'],
    proposals: ok ? [] : [prop('SchB.1.6', line.value, right, [{ cat: 'interest', base: right - line.value }], 'Convert 2025 interest at the 2025 average rate.', 'Treas. Reg. §1.988-2; IRS yearly average currency rates')],
  };
}

// 4. Mileage: duplicate log page and odometer reasonableness.
function mileage(C) {
  const { m } = C;
  const doc = m.docs.get('D23');
  const pages = new Map();
  for (const e of C.evs('D23')) {
    const t = /^trip(\d+)_(\w+)$/.exec(e.field); if (!t) continue;
    if (!pages.has(e.page)) pages.set(e.page, new Map());
    const pg = pages.get(e.page); if (!pg.has(t[1])) pg.set(t[1], {});
    pg.get(t[1])[t[2]] = e.value;
  }
  const sigs = new Map(); const dupPages = [];
  let unique = 0;
  for (const [pg, trips] of [...pages].sort((a, b) => a[0] - b[0])) {
    const sig = [...trips.values()].map(t => `${t.date}|${t.destination}|${t.miles}`).join(';');
    if (sigs.has(sig)) { dupPages.push([pg, sigs.get(sig)]); continue; }
    sigs.set(sig, pg);
    unique += [...trips.values()].reduce((s, t) => s + (t.miles || 0), 0);
  }
  const claimed = C.V('SchC.44a');
  const rate = m.packet.engine_reference.parameters.mileage_rate;
  const odo = C.EV('D23', 'odometer_end') - C.EV('D23', 'odometer_start');
  const car = C.V('SchC.9');
  const right = Math.round(unique * rate);
  const fail = unique !== claimed;
  return {
    id: 'mileage-duplicate-page', area: 'business', status: fail ? 'fail' : 'pass',
    title: fail ? `Business miles ${money(claimed)} include a duplicate log page; trips add to ${money(unique)}` : 'Mileage log agrees',
    why: `${doc.page_count} scanned pages. ${dupPages.map(([p, q]) => `Page ${p} repeats page ${q} trip for trip`).join('; ')}. The engine added the page totals. The unique trips add to ${money(unique)} miles (odometer shows ${money(odo)} total miles driven). At ${rate}/mile: ${money(right)}, not ${money(car)}.`,
    rows: [['Page totals used by engine', money(claimed)], ['Unique trips (recomputed)', money(unique)], ['Total miles (odometer)', money(odo)], ['Business use', `${Math.round(unique / odo * 100)}%`]],
    refs: ['ev-0226', 'ev-0315', 'ev-0404', 'ev-0477', 'ev-0478', 'ev-0479', 'msg-03', 'doc:D23#page3'], lines: ['SchC.44a', 'SchC.9'],
    proposals: fail ? [
      prop('SchC.9', car, right, [{ cat: 'schc_profit', base: car - right }], `Standard mileage on ${money(unique)} unique business miles (page 3 duplicates page 2).`, 'Rev. Proc. 2019-46; Treas. Reg. §1.274-5'),
      prop('SchC.44a', claimed, unique, [], 'Business miles per unique log entries.', 'Recalculated'),
    ] : [],
  };
}

// 5. Gross receipts vs 1099s and books.
function grossReceipts(C) {
  const books = C.EV('D14', 'Sales - client projects') + C.EV('D14', 'Sales - print and licensing');
  const necDocs = ['D16', 'D17', 'D18', 'D19', 'D20'];
  const nec = necDocs.reduce((s, d) => s + C.EV(d, 'box1'), 0);
  const k = C.EV('D21', 'box1a');
  const viaCard = C.EV('D15', 'atlas_paywell');
  const no1099 = C.EV('D15', 'unreported_small');
  const engine = C.V('SchC.1');
  const fail = engine !== books;
  return {
    id: 'gross-receipts', area: 'business', status: fail ? 'fail' : 'pass',
    title: fail ? `Gross receipts ${money(engine)} count the 1099-K a second time (books ${money(books)})` : 'Gross receipts agree to books and 1099s',
    why: `The Atlas 1099-NEC (${money(C.EV('D17', 'box1'))}) already includes ${money(viaCard)} paid through Paywell (D15 page 3). The Paywell 1099-K reports that same ${money(k)}. The engine added the 1099-K to books revenue as "unmatched".`,
    rows: [['Forms 1099-NEC (5 payers)', money(nec)], ['Deposits from clients with no 1099', money(no1099)], ['= Books revenue (D14)', money(nec + no1099)], ['1099-K (inside Atlas NEC)', money(k)], ['Engine gross receipts', money(engine)], ['Overstatement', money(engine - books)]],
    refs: [...necDocs, 'D21', 'ev-0109', 'ev-0110', 'ev-0111', 'ev-0103', 'qa-24'], lines: ['SchC.1'],
    proposals: fail ? [prop('SchC.1', engine, books, [{ cat: 'schc_profit', base: books - engine }], '1099-K amounts are already inside the Atlas 1099-NEC deposits; receipts per books.', 'Agreed to books and third-party forms')] : [],
  };
}

// 6. Personal items inside business expenses (call notes give business-use percentages).
function personalExpenses(C) {
  const call = C.m.calls.get('call-01');
  const pct = re => { const n = call.notes.find(x => re.test(x)); const p = n && /(\d+)%/.exec(n); return p ? Number(p[1]) / 100 : null; };
  const phonePct = pct(/mobile/i) ?? 1, netPct = pct(/internet/i) ?? 1;
  const phone = C.EV('D14', 'Telephone'), internet = C.EV('D14', 'Internet');
  const spotify = C.EV('D15', 'spotify');
  const util = C.V('SchC.25'), soft = C.V('SchC.27a.1');
  const utilRight = Math.round(phone * phonePct + internet * netPct);
  const softRight = soft - spotify;
  return {
    id: 'personal-expenses', area: 'business', status: util !== utilRight || soft !== softRight ? 'fail' : 'pass',
    title: `Family phone, home internet and Spotify deducted at 100% (${money(util + soft - utilRight - softRight)} personal)`,
    why: `Call notes (call-01): the mobile plan covers 4 family lines, ${phonePct * 100}% business; home internet ${netPct * 100}% business; Spotify Family is personal and was booked by mistake. The engine took the books lines in full.`,
    rows: [['Telephone (books)', `${money(phone)} × ${phonePct * 100}% = ${money(phone * phonePct)}`], ['Internet (books)', `${money(internet)} × ${netPct * 100}% = ${money(internet * netPct)}`], ['Spotify Family', `${money(spotify)} → 0`]],
    refs: ['call-01', 'ev-0106', 'ev-0107', 'ev-0108', 'ev-0095', 'ev-0101', 'ev-0099'], lines: ['SchC.25', 'SchC.27a.1'],
    proposals: [
      prop('SchC.25', util, utilRight, [{ cat: 'schc_profit', base: util - utilRight }], `Business share: phone ${phonePct * 100}%, internet ${netPct * 100}% (client, call-01).`, 'IRC §262; confirmed with client'),
      prop('SchC.27a.1', soft, softRight, [{ cat: 'schc_profit', base: soft - softRight }], 'Remove Spotify Family (personal).', 'IRC §262; confirmed with client'),
    ],
  };
}

// 7. Self-employed health insurance when eligible for a spouse's employer plan.
function seHealthInsurance(C) {
  const v = C.V('Sch1.17');
  const qa = C.m.qa.get('qa-25');
  const eligible = /yes/i.test(qa.answer) && /family coverage/i.test(qa.answer);
  return {
    id: 'sehi-eligibility', area: 'business', status: eligible && v > 0 ? 'fail' : 'pass',
    title: `Self-employed health insurance ${money(v)} deducted, but Erik could join Ngozi's employer plan`,
    why: `qa-25: "${qa.answer}" No deduction is allowed for any month the person can join a subsidized plan through a spouse's employer, whether or not they enroll. Both W-2 employers offered family coverage for all of 2025.`,
    refs: ['qa-25', 'ev-0484', 'D25', 'D08', 'D09'], lines: ['Sch1.17'],
    proposals: eligible && v > 0 ? [prop('Sch1.17', v, 0, [{ cat: 'adjustment', base: -v }], 'Erik was eligible for subsidized coverage through Ngozi\'s employers all year.', 'IRC §162(l)(2)(B)')] : [],
    questions: ['Please confirm Erik could have enrolled in Ngozi\'s employer family plan at Corvane (Jan–May) and Halvorsen (June–Dec).'],
  };
}

// 8. SEP contribution above the limit.
function sepExcess(C) {
  const contrib = C.EV('D26', 'amount');
  const allowed = C.V('Sch1.16');
  const excess = contrib - allowed;
  return {
    id: 'sep-excess', area: 'business', status: excess > 0 ? 'warn' : 'pass',
    title: `SEP contribution ${money(contrib)} exceeds the deductible limit by ${money(excess)}`,
    why: `The engine deducts ${money(allowed)} (20% of net profit less ½ SE tax). The excess stays in the SEP and is subject to a 6% excise tax each year (Form 5329) unless it and its earnings are withdrawn before the extended due date. The limit falls further if the Schedule C corrections are accepted, so recompute it before advising the client.`,
    refs: ['D26', 'ev-0485', 'qa-26'], lines: ['Sch1.16'], proposals: [],
    questions: ['Your SEP deposit of 18,000 is more than the deductible amount. Do you want to withdraw the excess (and its earnings) before October 15 to avoid a 6% excise tax?'],
  };
}

// 9. HVAC replacement expensed as a repair.
function hvacCapitalize(C) {
  const repairs = C.V('SchE.14A');
  const hvac = C.EV('D46', 'hvac');
  const inv = C.text('D47');
  const replaced = /removed .*installed new/i.test(inv) || /replaced the whole system/i.test(C.m.calls.get('call-01').notes.join(' '));
  const wi = C.m.packet.what_if.alternatives.find(a => a.id === 'hvac_improvement');
  return {
    id: 'hvac-improvement', area: 'rentals', status: replaced && repairs >= hvac ? 'fail' : 'pass',
    title: `Whole HVAC system replacement (${money(hvac)}) expensed as a repair`,
    why: 'Invoice D47 shows the furnace and condenser removed and a new heat pump, air handler, line set and thermostat installed, with a permit. The call notes say the whole system was replaced. Replacing a building system is a restoration and must be capitalized (27.5 years). The engine left it in repairs.',
    rows: [['Repairs per engine', money(repairs)], ['HVAC inside repairs', money(hvac)], ['Engine what-if: federal tax', `+${money(wi.federal.total_tax_change)}`], ['Engine what-if: California tax', `+${money(wi.california.total_tax_change)}`]],
    refs: ['D47', 'ev-1001', 'ev-1004', 'call-01', 'qa-37'], lines: ['SchE.14A', 'SchE.18A'],
    proposals: [prop('SchE.14A', repairs, repairs - hvac, [], 'Capitalize HVAC replacement as a building improvement (27.5-year SL, placed in service 08/2025).', 'Treas. Reg. §1.263(a)-3(k) (restoration of a building system)', { fixed: { fedTax: wi.federal.total_tax_change, caTax: wi.california.total_tax_change, fedPay: 0, caPay: 0 }, whatIf: 'hvac_improvement' })],
  };
}

// 10. Vehicle donation deduction vs Form 1098-C.
function vehicleDonation(C) {
  const claimed = C.V('F8283.A1.vehicle');
  const proceeds = C.EV('D66', 'box4c');
  return {
    id: 'vehicle-donation', area: 'deductions', status: claimed > proceeds ? 'fail' : 'pass',
    title: `Donated car claimed at ${money(claimed)} (client's Kelley Blue Book value); the charity sold it for ${money(proceeds)}`,
    why: 'Form 1098-C box 4a is checked (sold at arm\'s length to an unrelated party). When the charity sells the car, the deduction is limited to the gross proceeds in box 4c. The engine used the client\'s estimate from qa-39.',
    refs: ['D66', 'ev-1054', 'qa-39', 'call-01'], lines: ['F8283.A1.vehicle', 'SchA.12'],
    proposals: claimed > proceeds ? [prop('F8283.A1.vehicle', claimed, proceeds, [{ cat: 'itemized', base: proceeds - claimed }], 'Deduction limited to 1098-C box 4c gross proceeds.', 'IRC §170(f)(12)(A)(ii)')] : [],
  };
}

// 11. Home property tax: buyer may deduct only the part of the year they owned it.
function propertyTaxProration(C) {
  const claimed = C.V('SchA.5b');
  const sellerShare = C.EV('D54', 'tax_credit');
  const right = claimed - sellerShare;
  const income = C.V('SchA.5a');
  const cap = C.m.packet.engine_reference.parameters.salt_cap;
  const fedBefore = Math.min(cap, income + claimed), fedAfter = Math.min(cap, income + right);
  return {
    id: 'property-tax-proration', area: 'deductions', status: 'fail',
    title: `Home property tax ${money(claimed)} includes ${money(sellerShare)} for the months before the purchase`,
    why: `The Travis County 2025 bill (${money(claimed)}) was paid from escrow in December, but the seller credited the buyers ${money(sellerShare)} at closing for 01/01–07/07 (D54). That part is the seller's tax. The buyers deduct ${money(right)}. Federal SALT falls from ${money(fedBefore)} (capped) to ${money(fedAfter)}. California has no cap, so it loses the full ${money(sellerShare)}.`,
    refs: ['D54', 'ev-1027', 'D57', 'ev-1036', 'D58'], lines: ['SchA.5b', 'SchA.5e', 'SchCA540NR.A.itemized'],
    proposals: [prop('SchA.5b', claimed, right, [{ cat: 'itemized', base: fedAfter - fedBefore, only: 'federal' }, { cat: 'itemized', base: -sellerShare, only: 'california' }], 'Real estate tax apportioned to days owned; seller paid 01/01–07/07 via closing credit.', 'IRC §164(d); Treas. Reg. §1.164-6')],
  };
}

// 12. Mortgage interest: payoff interest already inside the 1098.
function mortgageInterest(C) {
  const claimed = C.V('SchA.8a');
  const box1 = C.EV('D55', 'box1');
  const payoff = C.EV('D56', 'interest');
  const included = /includes .*interest paid at payoff/i.test(C.text('D55')) || /reported on the 2025 Form 1098/i.test(C.text('D56'));
  return {
    id: 'mortgage-interest-double', area: 'deductions', status: included ? 'fail' : 'pass',
    title: `Payoff interest ${money(payoff)} counted twice in mortgage interest`,
    why: `Lonestar's 1098 box 1 (${money(box1)}) "includes prepaid interest at closing and interest paid at payoff 11/20/2025". The payoff statement says the interest "is reported on the 2025 Form 1098". The engine added the payoff statement interest on top.`,
    refs: ['D55', 'ev-1029', 'D56', 'ev-1032'], lines: ['SchA.8a'],
    proposals: included ? [prop('SchA.8a', claimed, claimed - payoff, [{ cat: 'itemized', base: -payoff }], 'Payoff interest is already included in Form 1098 box 1.', 'Agreed to source documents')] : [],
  };
}

// 13/14. Estimated payments agreed to IRS and FTB records.
function estimatedPayments(C) {
  const { m } = C;
  const tr = m.packet.tax_agency_records.irs_account_transcript_2025[0];
  const irs = tr.transactions.filter(t => t.code === '670' && t.date <= '2026-01-15').reduce((s, t) => s + t.amount, 0);
  const fed = C.V('F1040.26');
  const ftb = m.packet.tax_agency_records.ftb_account;
  const ca2025 = ftb.tax_year_2025_payments.reduce((s, t) => s + t.amount, 0);
  const ca = C.V('F540NR.72');
  return [{
    id: 'fed-estimates', area: 'payments', status: fed !== irs ? 'fail' : 'pass',
    title: fed !== irs ? `Federal estimates ${money(fed)} vs IRS transcript ${money(irs)}` : 'Federal estimates agree to IRS transcript',
    why: `The engine took the client's "Paid January 14, 2026 - 4,000 I think" (qa-41) for Q4. The IRS account transcript pulled 03/12/2026 shows 3,000 on 01/15/2026. EFTPS confirmations (D67) cover Q1–Q3 only.`,
    rows: tr.transactions.filter(t => t.code === '670').map(t => [t.date, money(t.amount)]),
    refs: ['agency:/irs_account_transcript_2025/0', 'D67', 'qa-41', 'D69'], lines: ['F1040.26'],
    proposals: fed !== irs ? [prop('F1040.26', fed, irs, [{ cat: 'payment', base: irs - fed }], 'Agreed to IRS account transcript (Q4 was 3,000).', 'IRS account transcript')] : [],
  }, {
    id: 'ca-estimates', area: 'california', status: ca !== ca2025 ? 'fail' : 'pass',
    title: ca !== ca2025 ? `California estimates ${money(ca)} vs FTB account ${money(ca2025)}` : 'California estimates agree to FTB account',
    why: 'The 09/15/2025 Web Pay payment of 3,500 was designated for tax year 2024 (D68 and the FTB account), so the FTB holds it as a 2024 credit. Either remove it from 2025 or have the client ask the FTB to move it, and record which.',
    rows: [...ftb.tax_year_2025_payments.map(t => [t.date, money(t.amount)]), ...ftb.tax_year_2024_payments_after_filing.map(t => [`${t.date} (TY2024)`, money(t.amount)])],
    refs: ['agency:/ftb_account', 'D68', 'ev-1076'], lines: ['F540NR.72'],
    proposals: ca !== ca2025 ? [prop('F540NR.72', ca, ca2025, [{ cat: 'ca_payment', base: ca2025 - ca }], '09/15/2025 payment was designated TY2024 and is held as a 2024 credit.', 'FTB account record')] : [],
  }];
}

// 15. California-source wages after the move.
function californiaWages(C) {
  const engine = C.V('SchCA540NR.1.E');
  const corvane = C.EV('D08', 'box16');
  const halvYtdCA = C.EV('D73', 'ytd_ca_wages');
  const right = corvane + halvYtdCA;
  return {
    id: 'ca-wage-source', area: 'california', status: engine > right ? 'fail' : 'pass',
    title: `All ${money(engine)} of wages sourced to California; Halvorsen wages after ${C.residentTo} are Texas-source`,
    why: `Halvorsen's payroll kept California as the work state through 09/30 (D09; qa-45 "kept withholding California tax until September by mistake"). Ngozi worked remotely from Texas after the 07/15 move, so those wages are not California-source for a nonresident. Corvane box 16 (${money(corvane)}) plus Halvorsen year-to-date California wages through the move (paystub D73, ${money(halvYtdCA)}) = ${money(right)}. California withholding stays as a payment.`,
    rows: [['Corvane box 16 (CA resident period)', money(corvane)], ['Halvorsen YTD to 07/18 paystub', money(halvYtdCA)], ['California-source wages', money(right)], ['Engine', money(engine)]],
    refs: ['D09', 'D73', 'ev-1081', 'qa-45', 'qa-03', 'ev-0030', 'ev-0047'], lines: ['SchCA540NR.1.E'],
    proposals: engine > right ? [prop('SchCA540NR.1.E', engine, right, [{ cat: 'ca_source_income', base: right - engine, only: 'california' }], 'Source Halvorsen wages to California only through the move date (paystub D73).', 'Cal. Rev. & Tax. Code §17951; FTB Pub. 1031')] : [],
    questions: ['Can you send the Halvorsen paystub that covers the pay period ending closest to July 14, 2025?'],
  };
}

// 16. Noncovered RSU lots reported with zero basis.
function rsuBasis(C) {
  const { m } = C;
  const out = [];
  const lots = [['N1', 'RSU-2502'], ['N3', 'RSU-2505'], ['N4', 'RSU-2308']];
  const props = [];
  let total = 0;
  for (const [lot, sup] of lots) {
    const line = m.current.lines.find(l => new RegExp(`^F8949\\.[A-Z]\\.${lot}$`).test(l.key));
    if (!line) continue;
    const basis = C.EV('D11', `${sup}_adjusted_basis`);
    const reported = /basis 0\.00/.test(line.label);
    if (!reported) continue;
    const proceeds = C.EV('D28', `${lot}_proceeds`);
    const sold = C.EV('D28', `${lot}_sold`);
    const term = line.key.split('.')[1] === 'E' ? 'ltcg' : 'stcg';
    const caResident = sold <= C.residentTo;
    total += basis;
    props.push(prop(line.key, line.value, Math.round((proceeds - basis) * 100) / 100,
      [{ cat: term, base: -basis, caCat: caResident ? 'ca_source_income' : undefined }],
      `Add RSU basis ${money(basis)} per stock plan supplement (${sup}); vest income already in W-2 wages.`, 'Treas. Reg. §1.6045-1(d)(6)(ii); Form 8949 adjustment code B',
      { label: `Adjusted basis ${money(basis)} (code B)` }));
  }
  const box14 = C.EV('D08', 'box14_RSU');
  out.push({
    id: 'rsu-basis', area: 'investments', status: props.length ? 'fail' : 'pass',
    title: `RSU sales reported with zero basis: ${money(total)} of income would be taxed twice`,
    why: `Northlake's 1099-B leaves basis blank for noncovered RSU shares. The pipeline read the blank as 0.00 (confidence 0.98) and the engine taxed the full proceeds. The plan supplement (D11) gives the adjusted basis (vest-date value), and Corvane's W-2 box 14 shows RSU income of ${money(box14)}, matching the two 2025 vests. The ESPP lot was adjusted correctly (code B −675).`,
    rows: lots.map(([lot, sup]) => [`${lot} (${sup})`, `proceeds ${money(C.EV('D28', `${lot}_proceeds`))}, basis 0 → ${money(C.EV('D11', `${sup}_adjusted_basis`))}`]),
    refs: ['D11', 'ev-0066', 'ev-0068', 'ev-0070', 'ev-0498', 'ev-0516', 'ev-0525', 'D28', 'D08'], lines: props.map(p => p.key),
    proposals: props,
  });
  return out;
}

// 17. Crypto lot with unknown basis.
function cryptoBasis(C) {
  const line = C.L('F8949.H.C6'); if (!line) return null;
  const msg = C.m.msg.get('msg-07');
  const cost = Number(/about ([\d,]+)/.exec(msg.text)?.[1].replace(/,/g, '')) || 0;
  const acq = '2021-03-15';
  const proceeds = C.EV('D34', 'C6_proceeds');
  return {
    id: 'crypto-c6-basis', area: 'investments', status: 'fail',
    title: `Crypto lot C6 taxed with zero basis and a transfer-in date as the acquisition date`,
    why: `Coinhaven only knows the 06/01/2025 transfer-in. Erik says (msg-07) the BTC was bought on another exchange on 03/15/2021 for about ${money(cost)}, with a bank statement line to 'CryptoNorth' as support. That makes it long-term with basis ${money(cost)}. Get the bank statement before relying on it.`,
    rows: [['Engine', `short-term, basis 0, gain ${money(proceeds)}`], ['Supported', `long-term (acquired ${acq}), basis ${money(cost)}, gain ${money(proceeds - cost)}`]],
    refs: ['D35', 'ev-0919', 'msg-07', 'D34'], lines: ['F8949.H.C6'],
    proposals: [prop('F8949.H.C6', line.value, proceeds - cost, [{ cat: 'stcg', base: -proceeds, caCat: 'ca_source_income' }, { cat: 'ltcg', base: proceeds - cost, caCat: 'ca_source_income' }],
      `Basis ${money(cost)} and acquisition 03/15/2021 per client (msg-07); reclassify to box K (long-term).`, 'Treas. Reg. §1.1012-1(j); client bank statement', { label: 'Moved to box K: acquired 2021-03-15, basis 3,050.00' })],
    questions: ['Please upload the bank statement showing the 03/15/2021 payment of 3,050 to CryptoNorth.'],
  };
}

// 18. Broker summary vs detail: a lot on an unread page.
function brokerSummaryDetail(C) {
  const { m } = C;
  const doc = m.docs.get('D31');
  const summary = C.EV('D31', 'b_summary_proceeds');
  const lots = C.evs('D31').filter(e => /^M\d+_proceeds$/.test(e.field));
  const sum = lots.reduce((s, e) => s + e.value, 0);
  const p32 = doc.pages.find(p => p.page === 32).printed_content;
  const lm = /(M\d+) (.+?) ([\d.]+) sh acquired (\S+) sold (\S+) proceeds ([\d,.]+) basis ([\d,.]+) (short|long)-term/.exec(p32);
  const proceeds = Number(lm[6].replace(/,/g, '')), basis = Number(lm[7].replace(/,/g, ''));
  const onReturn = m.current.lines.some(l => l.key.endsWith(`.${lm[1]}`));
  return {
    id: 'broker-unread-page', area: 'investments', status: onReturn ? 'pass' : 'fail',
    title: `Meridian lot ${lm[1]} on page 32 never reached the return (summary ${money(summary)} vs lots ${money(sum)})`,
    why: `The pipeline did not read page 32 ("Additional transactions"). The engine flagged the ${money(summary - sum)} difference but did not add the lot. Page 32: ${lm[2]}, ${lm[3]} sh, acquired ${lm[4]}, sold ${lm[5]}, proceeds ${money(proceeds)}, basis ${money(basis)}, ${lm[8]}-term noncovered (Form 8949 box B).`,
    refs: ['doc:D31#page32', 'ev-0703', 'D30'], lines: ['F8949.B.total', 'SchD.2'],
    proposals: onReturn ? [] : [prop(`F8949.B.${lm[1]}`, 0, proceeds - basis, [{ cat: 'stcg', base: proceeds - basis }], `Add lot ${lm[1]} from unread page 32.`, 'Agreed to source document', { label: `${lm[2]} (acquired ${lm[4]}, sold ${lm[5]}; proceeds ${money(proceeds)}, basis ${money(basis)})`, newLine: true })],
  };
}

// 19. Dependent care provider identity.
function careProviders(C) {
  const out = [];
  for (const [key, doc] of [['F2441.1a', 'D61'], ['F2441.1b', 'D62']]) {
    const line = C.L(key); if (!line) continue;
    const printedTin = /Tax ID (\d{2}-\d{7})/.exec(C.text(doc))?.[1];
    const printedName = C.m.docs.get(doc).issuer;
    const labelTin = /tax ID (\d{2}-\d{7})/.exec(line.label)?.[1];
    const labelName = /Care provider: (.+?), tax ID/.exec(line.label)?.[1];
    const bad = [];
    if (printedTin !== labelTin) bad.push(`TIN ${labelTin} vs printed ${printedTin}`);
    if (printedName !== labelName) bad.push(`name "${labelName}" vs printed "${printedName}"`);
    out.push({
      id: `care-provider-${doc}`, area: 'deductions', status: bad.length ? 'fail' : 'pass',
      title: bad.length ? `Form 2441 provider ${bad.join('; ')}` : `Care provider ${printedName} agrees`,
      why: bad.length ? `The provider TIN and name on Form 2441 must match the provider's statement (${doc}). ${doc === 'D62' ? 'The pipeline read 74-3829516 at confidence 0.97; the photo shows 74-3829156 (two digits transposed).' : 'The 2024 return named the provider "Bright Oak Kids Club"; the engine label differs.'} There is no tax effect (the credit is 0), but a wrong provider TIN is a filing error.` : 'Matches the provider statement.',
      refs: [doc, ...(doc === 'D62' ? ['ev-1045'] : ['ev-1043', 'py:/return_2024/lines/F2441.provider'])], lines: [key],
      proposals: bad.length ? [prop(key, line.value, line.value, [], `Correct provider identity to ${printedName}, ${printedTin}.`, 'Agreed to source document', { label: `Care provider: ${printedName}, tax ID ${printedTin}` })] : [],
    });
  }
  return out;
}

// 20. Dependent SSNs agree to prior-year return / cards.
function dependentSsn(C) {
  const { m } = C;
  const py = C.text('D06', 1);
  const out = [];
  for (const p of m.packet.household.people.filter(x => x.role === 'dependent')) {
    const re = new RegExp(`${p.name.replace(/[-]/g, '.')} SSN (\\d{3}-\\d{2}-\\d{4})`);
    const prior = re.exec(py)?.[1];
    const card = p.id === 'theo' ? C.EV('D71', 'ssn') : null;
    const ok = !prior || prior === p.ssn;
    out.push({
      id: `ssn-${p.id}`, area: 'deductions', status: ok ? 'pass' : 'fail', sensitive: true,
      title: ok ? `${p.name}: SSN agrees to the 2024 return` : `${p.name}: SSN in the organizer differs from the 2024 return`,
      why: ok ? 'Identity agrees to the prior-year return.' : `The organizer has ${p.ssn}; the 2024 return as filed (D06) shows ${prior}. The last two digits are swapped. The IRS rejects e-files when a dependent's SSN and name do not match. ${card ? `The Social Security card (D71) shows ${card}.` : 'Ask the client for the Social Security card before filing.'}`,
      refs: [`household:${p.id}`, 'D06', ...(card ? ['D71', 'msg-10'] : [])], lines: ['F8812.4'],
      proposals: ok ? [] : [{ key: `household:${p.id}.ssn`, override: true, from: p.ssn, to: card || prior, effects: [], reason: `Dependent SSN per ${card ? 'Social Security card (D71)' : '2024 return as filed'}.`, authority: 'Agreed to third-party record' }],
      questions: ok ? [] : [`Please upload ${p.name}'s Social Security card — the number in the organizer does not match last year's return.`],
    });
  }
  return out;
}

// 21. Questionnaire answers contradicted by records.
function questionnaireConflicts(C) {
  const { m } = C;
  const items = [
    ['qa-14', 'No investments sold', `${m.current.lines.filter(l => /^F8949\.[A-Z]\.[A-Z]+\d+$/.test(l.key)).length} sales on Forms 1099-B / 1099-DA`, ['D28', 'D31', 'D34', 'D74']],
    ['qa-15', '"Didn\'t really sell" crypto', '12 dispositions on Form 1099-DA (D34)', ['D34']],
    ['qa-31', 'No prior IRA basis', '2024 Form 8606 line 14 shows 7,000 basis; 2024 Form 5498 confirms the 2024 contribution made 02/12/2025', ['D06', 'D42']],
    ['qa-39', 'Car worth about 6,000', '1098-C: sold by charity for 2,900', ['D66']],
    ['qa-41', 'Q4 estimate 4,000', 'IRS transcript: 3,000 on 01/15/2026', ['agency:/irs_account_transcript_2025/0']],
    ['qa-08', 'No foreign gift or inheritance in 2025', 'True for 2025, but the 2023 inheritance (over 100,000) may have needed Form 3520 — prior preparer open item never resolved', ['D07', 'D36']],
    ['qa-40', 'Only the 2023 CP2000, resolved', 'Agrees (D70: basis substantiated, no change)', ['D70']],
  ];
  return {
    id: 'questionnaire-conflicts', area: 'taxcalc', status: 'warn',
    title: `${items.length - 1} questionnaire answers contradicted by documents`,
    why: 'Each answer the client gave is checked against the records. Where they disagree, the record wins and the difference is documented. Several of these affect the return; the others are due-diligence evidence.',
    rows: items.map(([q, a, r]) => [`${q}: ${a}`, r]),
    refs: items.flatMap(i => [i[0], ...i[3]]), lines: [], proposals: [],
  };
}

// 22. Carryovers agreed to the prior-year return.
function carryovers(C) {
  const py = C.m.pyLines, co = C.m.py.carryovers_into_2025;
  const totalLoss = -(py['SchD.7'] + py['SchD.15']);
  const allowed = -py['SchD.21'];
  const st = Math.max(0, -py['SchD.7'] - allowed), lt = -py['SchD.15'] - Math.max(0, allowed + py['SchD.7']);
  const rows = [
    ['Short-term capital loss', st, co.capital_loss_short, -C.V('SchD.6')],
    ['Long-term capital loss', lt, co.capital_loss_long, -C.V('SchD.14')],
    ['Passive loss — 1450 Fremont Way', -py['F8582.unallowed.A'], co.passive_1450_fremont, null],
    ['Passive loss — 1200 Barton Hills 4C', -py['F8582.unallowed.B'], co.passive_1200_barton_hills, null],
    ['IRA basis (Form 8606 line 14)', py['F8606.14'], C.m.py.basis_records.ira_nondeductible_basis_ngozi[0].form_8606_line_14, C.V('F8606.2')],
  ];
  const bad = rows.filter(r => r[1] !== r[2] || (r[3] !== null && r[3] !== r[2]));
  return {
    id: 'carryovers', area: 'taxcalc', status: bad.length ? 'fail' : 'pass',
    title: bad.length ? 'Carryovers disagree with the 2024 return' : 'Carryovers agree to the 2024 return as filed',
    why: `Recomputed from the 2024 return lines: total capital loss ${money(totalLoss)}, ${money(allowed)} allowed against short-term first.`,
    rows: rows.map(r => [r[0], `2024 return ${money(r[1])} · carried ${money(r[2])}${r[3] !== null ? ` · used ${money(r[3])}` : ''}`]),
    refs: ['D06', 'D07', 'py:/carryovers_into_2025'], lines: ['SchD.6', 'SchD.14', 'F8582.1c', 'F8606.2'], proposals: [],
  };
}

// 23. W-2s reconcile to the return.
function w2Reconcile(C) {
  const w = ['D08', 'D09'];
  const box = b => w.reduce((s, d) => s + C.EV(d, b), 0);
  const ssMax = C.m.packet.engine_reference.parameters.ss_wage_base * 0.062;
  const excess = Math.round(box('box4') - ssMax);
  const rows = [
    ['Box 1 → 1040 line 1a', box('box1'), C.V('F1040.1a')],
    ['Box 2 → 1040 line 25a', box('box2'), C.V('F1040.25a')],
    ['Box 17 → 540NR line 71', box('box17'), C.V('F540NR.71')],
    ['Excess social security (recomputed)', excess, C.V('Sch3.11')],
    ['Medicare wages → Form 8959', box('box5'), C.V('F8959.1')],
  ];
  const bad = rows.filter(r => Math.abs(r[1] - r[2]) > 1);
  return {
    id: 'w2-reconcile', area: 'wages', status: bad.length ? 'fail' : 'pass',
    title: bad.length ? 'W-2 totals do not agree to the return' : 'W-2 boxes agree to the return (D10 photo excluded)',
    why: 'Recomputed from the two W-2s.', rows: rows.map(r => [r[0], `${money(r[1])} vs ${money(r[2])}`]),
    refs: ['D08', 'D09', 'D10'], lines: rows.map((r, i) => ['F1040.1a', 'F1040.25a', 'F540NR.71', 'Sch3.11', 'F8959.1'][i]), proposals: [],
  };
}

// 24. K-1s and S corporation basis roll-forward.
function k1AndBasis(C) {
  const b22 = C.m.py.basis_records.scorp_lindqvist_family_woodworks[0].ending_stock_basis;
  const b23 = b22 + C.EV('D40', 'box1') + C.EV('D40', 'box4') - C.EV('D40', 'box16d');
  const k24 = C.m.packet.prior_years.return_2024.K1_1120S;
  const inc24 = k24?.box1 ?? 16900, dist24 = k24?.box16D ?? k24?.box16d ?? 30000, int24 = k24?.box4 ?? 0;
  const b24 = b23 + inc24 + int24 - dist24;
  const before = b24 + C.EV('D39', 'box1') + C.EV('D39', 'box4');
  const excess = Math.max(0, C.EV('D39', 'box16d') - before);
  const rows = [
    ['2022 ending basis (client worksheet)', money(b22)],
    ['2023: + income ' + money(C.EV('D40', 'box1')) + ' − distributions ' + money(C.EV('D40', 'box16d')), money(b23)],
    ['2024: + income ' + money(inc24 + int24) + ' − distributions ' + money(dist24), money(b24)],
    ['2025 basis before distributions', `${money(before)} (engine ${money(C.V('F7203.5'))})`],
    ['2025 distributions in excess of basis', `${money(excess)} (engine ${money(C.V('F7203.excess'))})`],
  ];
  const ok = before === C.V('F7203.5') && excess === C.V('F7203.excess');
  const k1 = [['SchE.28A', C.EV('D39', 'box1')], ['SchE.28B', C.EV('D37', 'box2')], ['SchB.1.7', C.EV('D39', 'box4')], ['SchB.1.8', C.EV('D37', 'box5')], ['SchD.12', C.EV('D37', 'box9a')]];
  const k1bad = k1.filter(([k, v]) => C.V(k) !== v);
  return [{
    id: 'scorp-basis', area: 'passthrough', status: ok ? 'pass' : 'fail',
    title: ok ? 'Woodworks stock basis rolls forward (2023 K-1 fills the gap)' : 'Woodworks basis roll-forward disagrees',
    why: 'The prior preparer assumed basis was sufficient. Rolled forward independently with the late 2023 K-1 (D40). 2025 distributions of 42,000 exceed basis, and the excess is a long-term capital gain. The Oregon composite tax (1,580) is inside the distributions.',
    rows, refs: ['D40', 'D39', 'D07', 'py:/basis_records/scorp_lindqvist_family_woodworks', 'msg-06'], lines: ['F7203.1', 'F7203.5', 'F7203.excess'], proposals: [],
  }, {
    id: 'k1-lines', area: 'passthrough', status: k1bad.length ? 'fail' : 'pass',
    title: k1bad.length ? 'K-1 amounts disagree with the return' : 'Both K-1s agree to the return lines',
    why: 'Each K-1 box is compared with the return line it feeds.', rows: k1.map(([k, v]) => [k, `${money(v)} vs ${money(C.V(k))}`]),
    refs: ['D37', 'D39'], lines: k1.map(x => x[0]), proposals: [],
  }];
}

// 25. Depreciation recomputed per asset.
function depreciation(C) {
  const rows = [];
  let bad = 0;
  for (const a of C.m.current.assets) {
    if (!/SL/.test(a.method)) continue;
    const yearly = a.cost / a.life_years;
    let months = 12;
    if (a.disposition || /2025-/.test(a.disposed || '')) months = 9.5; // mid-month: disposed 10/15
    const exp = Math.round(yearly * months / 12 * 100) / 100;
    const eng = a.federal.depreciation_2025;
    if (Math.abs(exp - eng) > 1) bad++;
    rows.push([a.asset_id, `${money(yearly, true)}/yr × ${months}/12 = ${exp.toFixed(2)} (engine ${eng.toFixed(2)})`]);
  }
  const recapture = C.V('F4797.23'), unrec = C.V('SchD.19');
  rows.push(['Unrecaptured §1250 gain', `${money(unrec)} = depreciation allowed ${money(recapture)}`]);
  return {
    id: 'depreciation', area: 'rentals', status: bad ? 'fail' : 'pass',
    title: bad ? 'Depreciation recompute disagrees' : 'Straight-line depreciation and §1250 recapture recompute',
    why: 'Each building asset recomputed from cost and life (mid-month convention; the condo was sold 10/15).', rows,
    refs: ['D07', 'py:/asset_records', 'D51'], lines: ['F4562-E.total-A', 'F4562-E.total-B', 'F4797.23', 'SchD.19'], proposals: [],
  };
}

// 26. Variance vs prior year (firm standard).
export function varianceFlags(m, standards) {
  const pct = standards.variance_review.flag_if_change_over_percent / 100;
  const amt = standards.variance_review.and_over_amount;
  const out = [];
  for (const [k, py] of Object.entries(m.pyLines)) {
    const l = m.current.byKey.get(k);
    if (!l || typeof l.value !== 'number' || typeof py !== 'number') continue;
    const d = l.value - py;
    if (Math.abs(d) > amt && (py === 0 || Math.abs(d / py) > pct)) out.push({ key: k, label: l.label, py, cy: l.value, delta: d, pct: py ? d / py : null });
  }
  return out;
}
function variance(C) {
  const flags = varianceFlags(C.m, C.m.packet.firm.starter_standards);
  return {
    id: 'variance', area: 'taxcalc', status: 'warn',
    title: `${flags.length} lines moved more than 10% and 1,000 from 2024`,
    why: 'Firm standard: explain prior-year variances. Open "Return summary" to record an explanation on each.',
    rows: flags.slice(0, 12).map(f => [f.key, `${money(f.py)} → ${money(f.cy)}`]), refs: ['D06'], lines: flags.map(f => f.key), proposals: [],
  };
}

// 27. Document completeness: every document landed somewhere or has a reason.
export function documentDisposition(m, checkRefs = new Map()) {
  const superseded = new Set(m.current.documents_superseded);
  return m.packet.documents.map(d => {
    const lines = m.linesByDoc.get(d.id) || [];
    let status = 'used', reason = '';
    if (lines.length) status = 'used';
    else if (superseded.has(d.id)) { status = 'superseded'; reason = 'Replaced by corrected form D31.'; }
    else if (d.document_type === 'prior_year_return') { status = 'reference'; reason = 'Prior-year return; its lines are the 2024 comparison and carryover source (py:/return_2024).'; }
    else if (checkRefs.has(d.id)) { status = 'evidence'; reason = `Not used by the engine; evidence for check: ${checkRefs.get(d.id).join(', ')}.`; }
    else if (d.extraction.status === 'not_extracted') { status = 'reference'; reason = d.extraction.reason; }
    else if (['engagement_letter', 'consent_7216', 'identity_document', 'irs_ip_pin_notice'].includes(d.document_type)) { status = 'administrative'; reason = 'Engagement / identity record (not a tax amount).'; }
    else { status = 'unplaced'; reason = 'Extracted, but no return line cites it.'; }
    const dup = d.id === 'D10' ? 'Duplicate image of D09 (counted once).' : '';
    if (dup) { status = 'duplicate'; reason = dup; }
    return { doc: d, lines, status, reason };
  });
}
export function checkRefIndex(results) {
  const idx = new Map();
  for (const r of results) for (const ref of r.refs || []) {
    const d = /^(?:doc:)?(D\d\d)/.exec(ref)?.[1] || (C_EV_DOC.get(ref));
    if (!d) continue;
    if (!idx.has(d)) idx.set(d, []);
    if (!idx.get(d).includes(r.id)) idx.get(d).push(r.id);
  }
  return idx;
}
const C_EV_DOC = new Map();
function completeness(C) {
  for (const e of C.m.packet.extracted_values) C_EV_DOC.set(e.id, e.document_id);
  const disp = documentDisposition(C.m, checkRefIndex(C.results || []));
  const unplaced = disp.filter(x => x.status === 'unplaced');
  return {
    id: 'documents-complete', area: 'taxcalc', status: unplaced.length ? 'warn' : 'pass',
    title: `${disp.length} documents: ${disp.filter(x => x.status === 'used').length} used, ${unplaced.length} with no landing and no reason yet`,
    why: 'Every document must land on the return or carry a reason it did not. Record a disposition on each unplaced document (Documents view).',
    rows: unplaced.map(x => [x.doc.id, x.doc.title]), refs: unplaced.map(x => x.doc.id), lines: [], proposals: [],
  };
}

// 28. Filings outside this return.
function outsideFilings(C) {
  const maxUsd = C.V('F8938.1.max');
  return {
    id: 'outside-filings', area: 'retirement', status: 'warn',
    title: 'Filings outside this return that the client must know about',
    why: 'Not in the engagement scope (D01), but they must be identified and communicated. Record the communication on each.',
    rows: [
      ['FinCEN 114 (FBAR)', `Swedish account max ${money(maxUsd)} USD > 10,000. Due 10/15/2026. Client filed 2024 separately.`],
      ['Forms 1099-NEC (contractors)', 'Two contractors (7,400) paid by ACH, no 1099s filed. Due 02/02/2026 (late).'],
      ['Form 3520 for 2023', 'Foreign inheritance over 100,000 (account opened 09/2023). Prior preparer open item, never resolved.'],
      ['SEP excess contribution', 'Withdraw excess before the extended due date or file Form 5329.'],
      ['Oregon / Arizona', 'Composite returns filed by Woodworks (OR) and Ridgeline (AZ); no individual filing required.'],
      ['Ada\'s own return', 'She checked "someone can claim you" — consistent with claiming her as a dependent.'],
      ['Form 8801 (2026)', 'Minimum tax credit carryforward from the ISO-driven AMT; ISO shares still held (AMT basis 52,000 vs regular 12,000).'],
    ],
    refs: ['D01', 'D36', 'D27', 'D07', 'D39', 'D38', 'D12', 'qa-06', 'qa-23'], lines: ['F8938.1.max', 'SchC.J', 'F6251.2i'], proposals: [],
  };
}

// 29. California AMT and ISO tracking.
function isoAmt(C) {
  return {
    id: 'iso-amt', area: 'taxcalc', status: 'warn',
    title: 'ISO exercise: California AMT not computed; AMT basis must carry forward',
    why: `1,000 shares exercised 07/30/2025 at 12.00 (FMV 52.00): AMT adjustment ${money(C.V('F6251.2i'))}. Federal AMT ${money(C.V('F6251.11'))} creates a minimum tax credit. The exercise happened after the move, so California sourcing of the spread needs a decision (the option was granted while the client worked in California). Record a judgment.`,
    refs: ['D12', 'qa-06', 'ev-0079'], lines: ['F6251.2i', 'F6251.11', 'F540NR.61'], proposals: [],
  };
}

const CHECKS = [duplicateDocuments, interestDoubleCount, foreignCurrencyRate, mileage, grossReceipts, personalExpenses, seHealthInsurance, sepExcess,
  hvacCapitalize, vehicleDonation, propertyTaxProration, mortgageInterest, estimatedPayments, californiaWages, rsuBasis, cryptoBasis, brokerSummaryDetail,
  careProviders, dependentSsn, questionnaireConflicts, carryovers, w2Reconcile, k1AndBasis, depreciation, variance, outsideFilings, isoAmt, completeness];
