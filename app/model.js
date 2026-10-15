// Read-only model over the packet. The packet is never mutated: everything the
// firm does lives in the ledger (ledger.js) and is layered on top at render time.

export const AREAS = [
  { id: 'wages', name: 'Wages & stock compensation', budget: 'wages_and_stock_compensation' },
  { id: 'investments', name: 'Investments & digital assets', budget: 'investments_and_digital_assets' },
  { id: 'business', name: 'Business (Schedule C)', budget: 'business' },
  { id: 'rentals', name: 'Rentals, sale & passive', budget: 'rentals_and_sale' },
  { id: 'passthrough', name: 'K-1s & basis', budget: 'pass_throughs_and_basis' },
  { id: 'retirement', name: 'Retirement, HSA & foreign', budget: 'deductions_and_credits' },
  { id: 'deductions', name: 'Deductions & credits', budget: 'deductions_and_credits' },
  { id: 'taxcalc', name: 'Tax computation', budget: 'partner_review' },
  { id: 'payments', name: 'Payments & penalties', budget: 'intake_and_engagement' },
  { id: 'california', name: 'California (540NR) & state split', budget: 'california' },
];

const AREA_RULES = [
  [/^F8949\.[HK]|^SchD\.3$/, 'investments'],
  [/^(SchCA540NR|F540NR|FTB|ScheduleS)/, 'california'],
  [/^(F1040\.1|F8959)/, 'wages'],
  [/^(SchB\.7|SchB\.1\.6|F8938)/, 'retirement'],
  [/^(SchB\.1\.7|SchB\.1\.8|SchD\.12)/, 'passthrough'],
  [/^(SchB|SchD|F8949|F8960|F1040\.(2|3|7)|Sch3\.1$)/, 'investments'],
  [/^(SchC|SchSE|F4562-C|F8995|Sch1\.(3|15|16|17)$)/, 'business'],
  [/^(SchE\.28|SchE\.32|F7203)/, 'passthrough'],
  [/^(SchE|F4797|F8582|F4562-E|Sch1\.5$)/, 'rentals'],
  [/^(F8606|F8889|F1040\.4|Sch1\.13)/, 'retirement'],
  [/^(SchA|F8283|F8812|F8863|F2441|F8867|F1040\.(12|13|14|19)$)/, 'deductions'],
  [/^(F1040\.(25|26|3[0-9])|Sch3\.(10|11|15)|F2210)/, 'payments'],
];
export function areaOf(key) {
  for (const [re, a] of AREA_RULES) if (re.test(key)) return a;
  return 'taxcalc';
}

// Default tax-effect category for a line (used to pre-fill manual adjustments).
// direction: +1 when raising the line raises the category base, -1 when it lowers it.
export function defaultEffect(key) {
  const k = key;
  if (/^F8949\.[ABCGH]|^SchD\.[1-7]/.test(k)) return { cat: 'stcg', dir: 1 };
  if (/^F8949|^SchD/.test(k)) return { cat: 'ltcg', dir: 1 };
  if (/^SchC\.(1|5|7|29|31)$/.test(k)) return { cat: 'schc_profit', dir: 1 };
  if (/^SchC|^F4562-C/.test(k)) return { cat: 'schc_profit', dir: -1 };
  if (/^SchE\.(3)/.test(k)) return { cat: 'ordinary_income', dir: 1 };
  if (/^SchE\.(9|1[0-9])|^F4562-E/.test(k)) return { cat: 'ordinary_income', dir: -1 };
  if (/^SchB|^F1040\.2/.test(k)) return { cat: 'interest', dir: 1 };
  if (/^F1040\.1|^SchCA540NR\.1/.test(k)) return { cat: 'wages', dir: 1 };
  if (/^Sch1\.(1[3-9]|2)/.test(k)) return { cat: 'adjustment', dir: 1 };
  if (/^SchA\.5/.test(k)) return { cat: 'salt', dir: 1 };
  if (/^SchA|^F8283/.test(k)) return { cat: 'itemized', dir: 1 };
  if (/^F1040\.(19|20)|^Sch3\.[1-8]$|^F8812|^F2441\.31/.test(k)) return { cat: 'credit', dir: 1 };
  if (/^F1040\.(25|26)|^Sch3\.(10|11)|^F540NR\.7/.test(k)) return { cat: 'payment', dir: 1 };
  return { cat: 'none', dir: 1 };
}

export const CATEGORY_LABELS = {
  wages: 'Wages', interest: 'Interest & dividends', schc_profit: 'Schedule C profit', stcg: 'Short-term gain',
  ltcg: 'Long-term gain', ordinary_income: 'Other income', adjustment: 'Adjustment to income', salt: 'State & local tax',
  itemized: 'Itemized deduction', ca_source_income: 'California-source income', credit: 'Credit (1:1 tax)',
  payment: 'Payment (1:1 balance)', none: 'No tax effect',
};

export async function loadPacket(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load packet (${res.status})`);
  return buildModel(await res.json());
}

export function buildModel(packet) {
  const m = { packet };
  m.docs = new Map(packet.documents.map(d => [d.id, d]));
  m.ev = new Map(packet.extracted_values.map(e => [e.id, e]));
  m.evByDoc = new Map();
  for (const e of packet.extracted_values) {
    if (!m.evByDoc.has(e.document_id)) m.evByDoc.set(e.document_id, []);
    m.evByDoc.get(e.document_id).push(e);
  }
  m.evByDocField = new Map(packet.extracted_values.map(e => [`${e.document_id}:${e.field}`, e]));
  m.versions = packet.return_versions.map(v => ({ ...v, byKey: new Map(v.lines.map(l => [l.key, l])) }));
  m.current = m.versions[m.versions.length - 1];
  m.people = new Map(packet.household.people.map(p => [p.id, p]));
  m.staff = new Map(packet.firm.staff.map(s => [s.id, s]));
  m.clientUsers = packet.firm.client_users;
  m.qa = new Map(packet.client.questionnaire.map(q => [q.id, q]));
  m.msg = new Map(packet.client.messages.map(q => [q.id, q]));
  m.calls = new Map(packet.client.call_notes.map(q => [q.id, q]));
  m.rates = m.current.tax_effect_rates;

  // Reverse index: which lines (in the current version) use each extracted value / document.
  m.linesByEv = new Map();
  m.linesByDoc = new Map();
  m.usedBy = new Map(); // any ref string -> lines
  for (const l of m.current.lines) {
    for (const s of l.sources || []) {
      push(m.usedBy, s, l.key);
      const e = m.ev.get(s);
      if (e) { push(m.linesByEv, s, l.key); push(m.linesByDoc, e.document_id, l.key); }
      const dm = /^doc:(D\d+)/.exec(s); if (dm) push(m.linesByDoc, dm[1], l.key);
    }
    for (const i of l.inputs || []) push(m.usedBy, i, l.key);
  }
  for (const [k, v] of m.linesByDoc) m.linesByDoc.set(k, [...new Set(v)]);

  // Prior year lines with matching keys, for variance.
  m.py = packet.prior_years;
  m.pyLines = packet.prior_years.return_2024.lines;
  m.pyLabels = packet.prior_years.return_2024.line_labels || {};
  return m;
}

function push(map, k, v) { if (!map.has(k)) map.set(k, []); map.get(k).push(v); }

// Resolve a "py:/a/b/0" JSON pointer inside prior_years (or agency:/ inside tax_agency_records).
export function resolvePointer(m, ref) {
  const [root, ptr] = ref.startsWith('py:') ? [m.packet.prior_years, ref.slice(3)]
    : ref.startsWith('agency:') ? [m.packet.tax_agency_records, ref.slice(7)] : [null, null];
  if (!root) return undefined;
  let cur = root;
  for (const raw of ptr.split('/').slice(1)) {
    const p = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

export function refKind(ref) {
  if (/^ev-\d+/.test(ref)) return 'ev';
  if (/^D\d\d$/.test(ref)) return 'doc';
  if (/^doc:/.test(ref)) return 'docpage';
  if (/^qa-/.test(ref)) return 'qa';
  if (/^msg-/.test(ref)) return 'msg';
  if (/^call-/.test(ref)) return 'call';
  if (/^py:/.test(ref)) return 'py';
  if (/^agency:/.test(ref)) return 'agency';
  if (/^asset:/.test(ref)) return 'asset';
  if (/^household:/.test(ref)) return 'household';
  if (/^ref:/.test(ref)) return 'param';
  if (/^timeline:/.test(ref)) return 'timeline';
  if (/^v\d$/.test(ref)) return 'version';
  return 'line';
}

export function paramValue(m, ref) {
  const path = ref.replace(/^ref:(param\.)?/, '').split('.');
  let cur = m.packet.engine_reference.parameters;
  for (const p of path) cur = cur?.[p];
  return cur;
}

export function fmtMoney(v, cents = false) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v !== 'number') return String(v);
  const neg = v < 0;
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  return neg ? `(${s})` : s;
}

export function fmtValue(line) {
  const v = line.value;
  if (typeof v !== 'number') return String(v);
  if (line.key.startsWith('F8949') || /ratio|percentage|rate \(/i.test(line.label) || (Math.abs(v) < 1 && v !== 0)) {
    return Math.abs(v) < 1 && v !== 0 ? String(v) : fmtMoney(v, line.key.startsWith('F8949'));
  }
  return fmtMoney(v);
}

export function personName(m, id) {
  if (!id) return 'System';
  return m.staff.get(id)?.name || m.clientUsers.find(c => c.id === id)?.name || id;
}

// Simple deterministic hash (FNV-1a) for sign-off fingerprints.
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const SSN = /\b(\d{3})-(\d{2})-(\d{4})\b/g;
export function maskText(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(SSN, (_, a, b, c) => `•••-••-${c}`)
    .replace(/(PIN\b[^.\d]{0,60}?)(\d{5,6})\b/g, (_, a) => `${a}••••••`)
    .replace(/\b(SE\d{2}(?: ?\d{4}){5})\b/g, s => `SE•• •••• •••• ${s.slice(-4)}`)
    .replace(/\b(\d{6,})\b/g, s => (s.length >= 9 && s.length <= 12 ? '•'.repeat(s.length - 4) + s.slice(-4) : s));
}
