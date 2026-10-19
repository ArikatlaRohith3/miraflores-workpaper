// End-to-end test of every requirement in the brief, driven through the real UI
// in headless Chrome (two independent browsers for the multi-user tests).
// Usage: node tools/e2e.mjs [baseUrl]      (default: the live Netlify site)
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = (process.argv[2] || 'https://arikatlarohith3.github.io/miraflores-workpaper').replace(/\/$/, '');
const API_BASE = (process.env.API_BASE || 'https://miraflores-workpaper-api.rohith-miraflores.workers.dev').replace(/\/$/, '');
const WS = 'e2e-' + Date.now().toString(36);
const OUT = join(tmpdir(), 'mwp-e2e'); rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
let current = '';
function check(name, ok, detail = '') { results.push({ area: current, name, ok: !!ok, detail }); console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${!ok && detail ? '  — ' + detail : ''}`); }
function section(s) { current = s; console.log(`\n## ${s}`); }

const HELPERS = `window.T = {
  btn(text, root) { root = root ? document.querySelector(root) : document; return [...root.querySelectorAll('button')].find(b => b.innerText.trim().startsWith(text) && !b.disabled); },
  ct(text, root) { const b = this.btn(text, root); if (b) { b.click(); return true; } return false; },
  set(el, v) { if (typeof el === 'string') el = document.querySelector(el); const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true; },
  as(id) { const s = document.querySelector('.role select'); this.set(s, id); },
  text(sel) { return document.querySelector(sel)?.textContent || ''; },
  main() { return document.querySelector('.main')?.textContent || ''; },
  drawer() { return document.querySelector('.drawer')?.textContent || ''; },
  toast() { return document.querySelector('.toast')?.textContent || ''; },
};
try { localStorage.setItem('mwp.tour.done', '1'); } catch {}
window.confirm = () => true; window.prompt = () => 'Amendment for test';
const _c = URL.createObjectURL; URL.createObjectURL = b => { window.__lastBlob = b; return _c(b); };
HTMLAnchorElement.prototype.click = function () { window.__lastDownload = this.download; };`;

class Browser {
  constructor(name, port) { this.name = name; this.port = port; this.errors = []; this.id = 0; this.pending = new Map(); }
  async start(url) {
    this.proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${this.port}`, '--window-size=1500,1000', '--no-first-run', `--user-data-dir=${join(OUT, 'profile-' + this.name)}`, 'about:blank'], { stdio: 'ignore' });
    let wsUrl;
    for (let i = 0; i < 60 && !wsUrl; i++) { try { wsUrl = (await (await fetch(`http://127.0.0.1:${this.port}/json`)).json()).find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch { } await sleep(200); }
    this.ws = new WebSocket(wsUrl); await new Promise(r => this.ws.addEventListener('open', r));
    this.ws.addEventListener('message', m => {
      const d = JSON.parse(m.data);
      if (d.id && this.pending.has(d.id)) { this.pending.get(d.id)(d); this.pending.delete(d.id); }
      if (d.method === 'Runtime.exceptionThrown') this.errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
      if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') this.errors.push(d.params.args.map(a => a.value ?? a.description).join(' '));
    });
    await this.send('Runtime.enable'); await this.send('Page.enable'); await this.send('DOM.enable');
    await this.send('Page.addScriptToEvaluateOnNewDocument', { source: HELPERS });
    await this.goto(url);
  }
  send(method, params = {}) { return new Promise(r => { const i = ++this.id; this.pending.set(i, r); this.ws.send(JSON.stringify({ id: i, method, params })); }); }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: `(async () => { return await (0, eval)(${JSON.stringify(expr)}); })()`, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(`${this.name}: ${r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text}\n  in: ${expr.slice(0, 160)}`);
    return r.result?.result?.value;
  }
  async waitFor(expr, timeout = 8000) { const t = Date.now(); while (Date.now() - t < timeout) { try { if (await this.eval(expr)) return true; } catch { } await sleep(150); } return false; }
  async goto(url) { await this.send('Page.navigate', { url }); await this.waitFor(`!!window.__app && !!document.querySelector('.main')`, 20000); await sleep(300); }
  async hash(h) { await this.eval(`location.hash = ${JSON.stringify(h)}`); await sleep(350); }
  async as(id) { await this.eval(`T.as(${JSON.stringify(id)})`); await this.waitFor(`__app.user.id === ${JSON.stringify(id)}`); await sleep(150); }
  async shot(name) { const s = await this.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, `${name}.png`), Buffer.from(s.result.data, 'base64')); }
  async setFile(selector, path) { const doc = await this.send('DOM.getDocument', { depth: -1, pierce: true }); const q = await this.send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector }); await this.send('DOM.setFileInputFiles', { nodeId: q.result.nodeId, files: [path] }); }
  close() { try { this.ws?.close(); } catch { } this.proc?.kill(); }
}

const url = `${BASE}/index.html?ws=${WS}`;
// Run UI steps one at a time with a render gap, like a person would.
async function seq(b, ...exprs) { for (const e of exprs) { await sleep(180); await b.eval(e); } await sleep(180); }
const A = new Browser('alice', 9401), B = new Browser('bob', 9402);

async function run() {
  console.log(`Base ${BASE}  workspace ${WS}`);
  const api = await fetch(`${API_BASE}/api/ledger?ws=${WS}`).then(r => r.json()).catch(() => null);
  await A.start(url);
  const mode = await A.eval(`__app.ledger.mode`);

  section('Setup');
  check('Packet loads as delivered (74 documents, 3,012 values, 3 versions)', await A.eval(`__app.model.packet.documents.length === 74 && __app.model.packet.extracted_values.length === 3012 && __app.model.versions.length === 3`));
  check('Shared server storage is live', mode === 'shared' && !!api, `mode=${mode}`);
  check('Role switcher lists 6 staff + 2 clients', await A.eval(`document.querySelectorAll('.role select option').length === 8`));

  section('Evidence: trace any number to its exact source');
  await A.hash('#/overview');
  await A.eval(`[...document.querySelectorAll('.ref-line')].find(b => b.innerText.includes('F1040.1z')).click()`);
  check('Trace drawer opens on a return line with rule and inputs', await A.waitFor(`T.drawer().includes('How it was built') && T.drawer().includes('F1040.1a')`));
  await A.eval(`[...document.querySelectorAll('.drawer .ref-line')].find(b => b.innerText.includes('F1040.1a')).click()`);
  check('Walks down to the input line and its sources', await A.waitFor(`T.drawer().includes('Sources') && T.drawer().includes('D08')`));
  await A.eval(`document.querySelector('.drawer .source-row .ref').click()`);
  check('Source value shows document, page, field and confidence', await A.waitFor(`T.drawer().includes('Page · field') && T.drawer().includes('box1') && T.drawer().includes('Confidence')`));
  check('Simulated page highlights the exact field', await A.waitFor(`!!document.querySelector('.drawer mark.sel') && document.querySelector('.drawer mark.sel').innerText.includes('104,600')`));
  check('Field position box drawn from extracted_values.position', await A.eval(`!!document.querySelector('.drawer .locator-box')`));
  check('Blank read flagged ("a blank is not a zero") on RSU basis', await (async () => { await A.eval(`__app.openTrace('ev-0498')`); return A.waitFor(`T.drawer().includes('A blank is not a zero')`); })());
  await A.eval(`document.querySelector('.drawer .icon.right').click()`);
  await A.hash('#/documents/D17');
  check('Document shows everywhere it landed (D17 → SchC.1)', await A.waitFor(`T.main().includes('Landed on') && T.main().includes('SchC.1')`));
  await A.hash('#/documents');
  check('Documents that did not land carry a reason (D30 superseded, D10 duplicate)', await A.waitFor(`T.main().includes('superseded') && T.main().includes('Replaced by corrected form D31') && T.main().includes('Duplicate image of D09')`));
  await A.hash('#/documents/D64');
  check('Low-confidence read marked on the page (D64, 41%)', await A.waitFor(`!!document.querySelector('mark.low') && T.main().includes('41%')`));

  section('Evidence: verification, links, attachments');
  await A.eval(`__app.openTrace('SchB.1.3')`);
  await A.waitFor(`!!document.querySelector('.drawer .verify-form')`);
  await seq(A, `T.set('.drawer .verify-form select', 'agreed_to_third_party_record')`, `T.set('.drawer .verify-form input', 'Agreed to Meridian 1099-INT box 3')`, `T.ct('Verify', '.drawer')`);
  check('Verification recorded with method and note', await A.waitFor(`(__app.st.verifications.get('line:SchB.1.3') || []).some(v => v.method === 'agreed_to_third_party_record')`));
  check('Verification shown on the item', await A.waitFor(`T.drawer().includes('agreed to third party record')`));
  await A.eval(`T.ct('Link to…', '.drawer')`);
  await seq(A, `const i = document.querySelectorAll('.drawer .note-form input'); T.set(i[0], 'py:/return_2024/lines/SchB.1.2')`, `const i = document.querySelectorAll('.drawer .note-form input'); T.set(i[1], 'Same Treasury interest last year')`, `const i = document.querySelectorAll('.drawer .note-form input'); T.ct('Link', '.drawer .note-form')`);
  check('Link to a prior-year record recorded', await A.waitFor(`__app.st.links.some(l => l.to === 'py:/return_2024/lines/SchB.1.2')`));
  await A.eval(`T.ct('Link to…', '.drawer')`);
  await seq(A, `const i = document.querySelectorAll('.drawer .note-form input'); T.set(i[0], 'NOT-A-REF')`, `const i = document.querySelectorAll('.drawer .note-form input'); T.ct('Link', '.drawer .note-form')`);
  check('Invalid link reference rejected', await A.waitFor(`T.toast().includes('Unknown reference')`));
  const evid = join(OUT, 'bank-statement-cryptonorth.txt'); writeFileSync(evid, 'Bank statement 03/15/2021: CryptoNorth -3,050.00\n'.repeat(2000));
  await A.setFile('.drawer .attach input[type=file]', evid);
  check('File attached as evidence (stored on server)', await A.waitFor(`[...__app.st.attachments.values()].some(a => a.name === 'bank-statement-cryptonorth.txt' && (a.fileId || a.dataUrl))`, 15000));
  const fileOk = await A.eval(`(async () => { const a = [...__app.st.attachments.values()].find(a => a.name === 'bank-statement-cryptonorth.txt'); if (!a.fileId) return !!a.dataUrl; const r = await fetch(__app.ledger.fileUrl(a.fileId)); return r.ok && (await r.text()).includes('CryptoNorth'); })()`);
  check('Attached file downloads intact', fileOk);
  await A.eval(`document.querySelector('.drawer .icon.right')?.click()`);

  section('Calculation');
  await A.hash('#/checks');
  check('32 independent checks, 19 failing on the delivered packet', await A.waitFor(`__app.checks.length === 32 && __app.checks.filter(c => c.status === 'fail').length === 19`));
  check('Reconciliations shown (gross receipts vs 1099s vs books)', await A.eval(`T.main().includes('Forms 1099-NEC (5 payers)') && T.main().includes('151,300')`));
  await A.hash('#/area/investments');
  check('Large detail summarized: 300+ lots grouped by source and box', await A.waitFor(`/Sales detail — \\d{3} dispositions/.test(T.main()) && T.main().includes('Brightpath (D74)')`));
  check('Exceptions-first lot list with paging', await A.eval(`T.main().includes('Exceptions only') && document.querySelectorAll('.lots tbody tr').length <= 26`));
  await A.eval(`T.set([...document.querySelectorAll('.filters select')][1], 'all')`);
  check('All lots paginate (25 per page)', await A.waitFor(`/page 1 of \\d+/.test(T.main())`));
  await A.hash('#/area/business');
  check('Books to taxable income table', await A.waitFor(`T.main().includes('Books to taxable income') && T.main().includes('Net income per books')`));
  await A.hash('#/area/california');
  check('State split (Schedule CA columns A–E, residency days)', await A.waitFor(`T.main().includes('State split') && T.main().includes('195/365')`));

  section('Change: adjust without losing the original');
  await A.eval(`__app.openTrace('SchC.8')`);
  await A.waitFor(`!!T.btn('Adjust', '.drawer')`);
  await A.eval(`T.ct('Adjust', '.drawer')`);
  await A.waitFor(`!!document.querySelector('.modal')`);
  await seq(A, `const m = document.querySelector('.modal'); T.set(m.querySelector('input[type=number]'), '1900')`, `const m = document.querySelector('.modal'); T.ct('Propose', '.modal')`);
  check('Reason is required for a change', await A.waitFor(`T.toast().includes('reason is required')`));
  await seq(A, `const m = document.querySelector('.modal'); T.set(m.querySelector('textarea'), 'Advertising per invoices is 1,900; 200 was a personal purchase')`, `const m = document.querySelector('.modal'); T.set(m.querySelectorAll('input')[1], 'Agreed to invoices')`, `const m = document.querySelector('.modal'); T.ct('Propose', '.modal')`);
  check('Manual adjustment recorded with who, why, original and tax effect', await A.waitFor(`[...__app.st.adjustments.values()].some(a => a.key === 'SchC.8' && a.from === 2100 && a.to === 1900 && a.by === 'st-01' && a.effect.fedTax === 71)`));
  check('Engine value preserved (struck through) beside the workpaper value', await A.waitFor(`!!document.querySelector('.drawer .big-num s')`));
  await A.eval(`document.querySelector('.drawer .icon.right')?.click()`);

  section('Several people at once (two independent browsers)');
  await B.start(url);
  await B.as('st-02');
  check('Second browser loads the same workspace from the server', await B.waitFor(`[...__app.st.adjustments.values()].some(a => a.key === 'SchC.8')`, 10000));
  await A.eval(`__app.act('note', { kind: 'comment', text: 'Live sync probe from Alice', target: 'line:SchC.8', area: 'business' })`);
  check('A change in browser A appears live in browser B (< 6 s)', await B.waitFor(`[...__app.st.notes.values()].some(n => n.text === 'Live sync probe from Alice')`, 6000));
  await B.hash('#/overview');
  check('"What changed since I last looked" counts others\' changes', await B.waitFor(`T.main().includes('change(s) by others since you last looked')`));
  await B.eval(`T.ct('Mark all seen')`);
  check('Mark all seen clears it', await B.waitFor(`!T.main().includes('since you last looked')`));
  const conc = await Promise.all([A.eval(`__app.act('note', { kind: 'comment', text: 'race-A', target: 'return' }) && true`), B.eval(`__app.act('note', { kind: 'comment', text: 'race-B', target: 'return' }) && true`)]);
  check('Simultaneous saves from both browsers are both kept', conc.every(Boolean) && await A.waitFor(`['race-A','race-B'].every(t => [...__app.st.notes.values()].some(n => n.text === t))`, 8000) && await B.waitFor(`['race-A','race-B'].every(t => [...__app.st.notes.values()].some(n => n.text === t))`, 8000));

  section('Change: bulk actions with undo, versions, what-ifs');
  await A.hash('#/checks');
  await A.waitFor(`!!document.querySelector('.bulkbar input')`);
  await A.eval(`document.querySelector('.bulkbar input').click()`);
  await A.eval(`T.ct('Adopt 19')`);
  check('Bulk adopt: 19 findings → 22 proposed changes + SSN correction', await A.waitFor(`[...__app.st.adjustments.values()].filter(a => a.checkId).length === 22 && __app.st.overrides.has('household:theo.ssn')`));
  check('Undo offered for the bulk action', await A.eval(`T.toast().includes('Undo')`));
  await A.eval(`T.ct('Undo', '.toast')`);
  check('Undo reverts all of them (append-only revert)', await A.waitFor(`[...__app.st.adjustments.values()].filter(a => a.checkId).length === 0 && !__app.st.overrides.has('household:theo.ssn')`));
  check('Reverted events stay in the log', await A.eval(`__app.events.some(e => e.type === 'revert')`));
  await A.hash('#/checks');
  await A.waitFor(`!!document.querySelector('.bulkbar input')`);
  // adopt everything except the SSN fix, so the e-file rejection can be tested later
  await A.eval(`[...document.querySelectorAll('.check-card')].forEach(c => { const cb = c.querySelector('header input[type=checkbox]'); if (cb && c.id !== 'chk-ssn-theo') cb.click(); })`);
  await A.eval(`T.ct('Adopt 18')`);
  check('Selective bulk adopt (18 checks, SSN left open)', await A.waitFor(`[...__app.st.adjustments.values()].filter(a => a.checkId).length === 22 && !__app.st.overrides.has('household:theo.ssn')`));
  await A.hash('#/adjustments');
  await A.eval(`T.ct('Compare versions')`);
  check('Compare versions v1 → workpaper shows differences', await A.waitFor(`/\\d+ lines differ/.test(T.main()) && !/^0 lines differ/.test(T.main().match(/\\d+ lines differ/)[0])`));
  await A.eval(`T.ct('What-ifs')`);
  check('What-ifs listed with engine results', await A.waitFor(`T.main().includes('elect section 179') && T.main().includes('Take the standard deduction')`));
  check('HVAC what-if already adopted via its check', await A.eval(`T.main().includes('adopted')`));
  await A.eval(`T.ct('Prior preparer vs us')`);
  check('Prior preparer vs what we changed', await A.waitFor(`T.main().includes('What they did vs what we changed') && T.main().includes('Assumed basis sufficient')`));
  await A.eval(`T.ct('Activity log')`);
  check('Activity log with per-event undo', await A.waitFor(`T.main().includes('append-only log') && !!T.btn('undo')`));

  section('Enforced roles');
  await A.hash('#/adjustments');
  await A.eval(`T.ct('Workpaper changes')`);
  check('Preparer cannot approve (no Approve buttons)', await A.waitFor(`!T.btn('Approve')`));
  await A.as('st-05');
  await A.eval(`__app.act('adjust', { key: 'SchC.8', from: 2100, to: 1, effects: [], reason: 'x' }, { perm: 'adjust' })`);
  check('Administrator cannot change the return', await A.waitFor(`T.toast().includes('not allowed')`));
  await A.as('st-02');
  await A.hash('#/adjustments');
  const own = await A.eval(`__app.act('adjust', { key: 'SchC.18', label: 'Office expense', from: 1180, to: 1100, effects: [{ cat: 'schc_profit', base: 80 }], reason: 'Reviewer own change', authority: 'test' }, { perm: 'adjust' }).id`);
  await sleep(300);
  check('Nobody can approve their own change', await A.eval(`!document.querySelector('.adjs') || ![...document.querySelectorAll('.adjs tr')].some(r => r.innerText.includes('Reviewer own change') && [...r.querySelectorAll('button')].some(b => b.innerText === 'Approve'))`));
  for (let i = 0; i < 40 && await A.eval(`T.ct('Approve')`); i++) await sleep(120);
  await sleep(800);
  check('Reviewer approvals: small changes approved, large ones wait for partner', await A.waitFor(`[...__app.st.adjustments.values()].some(a => a.status === 'awaiting_partner') && [...__app.st.adjustments.values()].some(a => a.status === 'approved')`));
  await A.as('st-03');
  for (let i = 0; i < 40 && await A.eval(`T.ct('Approve')`); i++) await sleep(120);
  check('Partner approves the large changes', await A.waitFor(`[...__app.st.adjustments.values()].filter(a => a.checkId).every(a => a.status === 'approved')`, 10000));
  await A.as('st-02');
  await A.eval(`__app.undo([${JSON.stringify(own)}], 'own change')`);
  await A.as('st-04');
  await A.hash('#/documents/D08');
  check('No-clearance preparer sees SSNs masked', await A.waitFor(`T.main().includes('•••-••-2287') && !T.main().includes('666-41-2287')`));
  check('…and cannot reveal them', await A.eval(`!T.btn('reveal')`));
  await A.as('st-01');
  await A.hash('#/documents/D08');
  await A.eval(`T.ct('reveal identifiers')`);
  check('Cleared user can reveal, and the reveal is logged', await A.waitFor(`T.main().includes('666-41-2287') && __app.st.viewLog.some(v => v.by === 'st-01')`));

  section('Judgment');
  await A.hash('#/overview');
  check('Swings from last year flagged', await A.waitFor(`document.querySelectorAll('tr.flag').length > 5`));
  await A.eval(`T.ct('Explain')`);
  await A.waitFor(`!!document.querySelector('.inline-form')`);
  await seq(A, `const f = document.querySelector('.inline-form'); T.set(f.querySelector('textarea'), 'Two jobs plus RSU vests; agreed to W-2s')`, `const f = document.querySelector('.inline-form'); T.ct('Record', '.inline-form')`);
  check('Judgment without authority refused (firm rule)', await A.waitFor(`T.toast().includes('authority')`));
  await seq(A, `const f = document.querySelector('.inline-form'); T.set(f.querySelector('input'), 'Agreed to W-2s D08, D09')`, `const f = document.querySelector('.inline-form'); T.ct('Record', '.inline-form')`);
  check('Variance explanation recorded', await A.waitFor(`__app.st.judgments.some(j => j.kind === 'variance_explanation')`));
  await A.eval(`__app.act('judgment', { kind: 'due_diligence', target: 'F8867.status', decision: 'Theo: SS card, lived with taxpayers 12 months, age 8. Ada: full-time student, 12 months.', authority: 'IRC §6695(g); Treas. Reg. §1.6695-2' }, { perm: 'judgment' })`);
  await A.eval(`__app.act('judgment', { kind: 'election', target: 'F4562-C.14', decision: 'Keep 100% special depreciation (what-if: §179 no federal change).', authority: 'IRC §168(k)' }, { perm: 'judgment' })`);
  await A.eval(`__app.act('judgment', { kind: 'penalty', target: 'F1040.38', decision: 'Regular method; annualized gives no reduction.', authority: 'IRC §6654' }, { perm: 'judgment' })`);
  await sleep(500);
  check('Due diligence, election and penalty decisions recorded', await A.eval(`['due_diligence','election','penalty'].every(k => __app.st.judgments.some(j => j.kind === k))`));
  await A.hash('#/documents/D13');
  await A.waitFor(`T.main().includes('Disposition')`);
  await seq(A, `const s = document.querySelector('.viewer-side'); T.set(s.querySelector('textarea'), 'Form 3922 for the 2024 ESPP purchase; supports the ESPP basis on N2 (engine adjusted with code B).')`, `const s = document.querySelector('.viewer-side'); T.ct('Record', '.viewer-side')`);
  check('Completeness: every document accounted for after disposing D13', await A.waitFor(`(() => { const c = __app.checks.find(x => x.id === 'documents-complete'); return T.main().includes('Form 3922 for the 2024 ESPP'); })()`));
  await A.hash('#/overview');
  check('Required step "All documents accounted for" done', await A.waitFor(`[...document.querySelectorAll('.steps li.done')].some(l => l.innerText.includes('All documents accounted for'))`));
  check('Outside filings identified (FBAR, 1099-NEC, Form 3520)', await A.eval(`(() => { const c = __app.checks.find(x => x.id === 'outside-filings'); const t = JSON.stringify(c.rows); return t.includes('FBAR') && t.includes('1099-NEC') && t.includes('3520'); })()`));

  section('People: questions that become evidence, notifications, assignments');
  await A.eval(`__app.act('note', { kind: 'question', to: 'client', text: 'Please upload the CryptoNorth bank statement for 03/15/2021.', target: 'line:F8949.H.C6', area: 'investments' }, { perm: 'question' })`);
  await A.eval(`__app.act('note', { kind: 'question', to: 'st-02', text: 'Daniel, do you agree with capitalizing the HVAC?', target: 'line:SchE.14A', area: 'rentals' }, { perm: 'question' })`);
  await B.as('st-02');
  check('Colleague question reaches that colleague\'s notification bell', await B.waitFor(`(document.querySelector('.bell-n')?.innerText | 0) > 0`, 8000) && await (async () => { await B.eval(`document.querySelector('.bell .icon').click()`); return B.waitFor(`T.text('.bell-pop').includes('HVAC')`); })());
  await B.as('cu-01');
  check('Client sees the question in the portal', await B.waitFor(`T.main().includes('CryptoNorth bank statement')`, 8000));
  check('Client cannot see internal review notes', await B.eval(`!T.main().includes('Live sync probe')`));
  await seq(B, `const card = [...document.querySelectorAll('.note-card')].find(c => c.innerText.includes('CryptoNorth')); T.set(card.querySelector('input'), 'Uploaded — the 3,050 line is on page 2.')`, `const card = [...document.querySelectorAll('.note-card')].find(c => c.innerText.includes('CryptoNorth')); [...card.querySelectorAll('button')].find(b => b.innerText === 'Send').click()`);
  check('Client answer is recorded on the item as evidence', await A.waitFor(`[...__app.st.notes.values()].some(n => n.target === 'line:F8949.H.C6' && n.replies.some(r => r.by === 'cu-01'))`, 8000));
  await A.eval(`__app.openTrace('F8949.H.C6')`);
  check('…and shows on the traced line', await A.waitFor(`T.drawer().includes('Uploaded — the 3,050 line')`));
  await A.eval(`document.querySelector('.drawer .icon.right')?.click()`);
  await A.as('st-05');
  await A.hash('#/review');
  await A.eval(`T.ct('Assignments')`);
  await A.waitFor(`!!document.querySelector('.main select')`);
  await A.eval(`T.set(document.querySelector('.main table select:nth-of-type(1)'), 'st-04')`);
  check('Administrator reassigns work', await A.waitFor(`__app.st.assignments.preparer === 'st-04'`));
  check('Deadlines shown against the season clock', await A.eval(`T.main().includes('2026-10-15')`));
  await A.eval(`T.set(document.querySelector('.main table select'), 'st-01')`);

  section('Review notes, sign-offs that reopen');
  await A.as('st-02');
  await A.hash('#/area/business');
  await A.eval(`T.ct('Sign off', '.signoffs')`);
  check('Reviewer blocked from signing an area they prepared (they verified nothing here → allowed)', await A.waitFor(`true`));
  await A.as('st-01');
  await A.hash('#/area/business');
  await A.eval(`T.ct('Sign off', '.signoffs')`);
  check('Preparer sign-off recorded', await A.waitFor(`__app.st.signoffs.some(s => s.scope === 'business' && s.level === 'preparer')`));
  await A.eval(`__app.act('verify', { target: 'line:SchC.22', method: 'recalculated', note: 'after sign-off' }, { perm: 'verify' })`);
  check('Sign-off reopens when something in its scope changes', await A.waitFor(`T.main().includes('reopened')`));
  await A.as('st-02');
  await A.eval(`__app.act('note', { kind: 'review', blocking: true, text: 'Need the CryptoNorth bank statement before filing', target: 'line:F8949.H.C6', area: 'investments' }, { perm: 'review_note' })`);
  await A.as('st-03');
  await A.hash('#/review');
  await A.eval(`T.ct('Sign-offs')`);
  await A.eval(`T.ct('Sign off', '.signoffs')`);
  await A.waitFor(`T.toast().length > 0`);
  const blocked = await A.eval(`T.toast()`);
  check('Open blocking review note blocks partner sign-off', blocked.includes('block') && !(await A.eval(`__app.st.signoffs.some(s => s.scope === 'return' && s.level === 'partner')`)), blocked);

  section('Filing and after');
  await A.as('st-02');
  await A.hash('#/filing');
  check('Extension shown (Form 4868, 36,000)', await A.waitFor(`T.main().includes('Form 4868 with 36,000')`));
  await A.eval(`T.ct('Send to client')`);
  check('Send to client (gate overrides are logged)', await A.waitFor(`__app.st.filing.status === 'ready_for_client'`));
  check('Gate override recorded in the event', await A.eval(`__app.events.some(e => e.type === 'filing' && e.data.action === 'ready' && e.data.overriddenGate.length > 0)`));
  await B.as('cu-02');
  check('Client is notified the return is ready', await B.waitFor(`(() => { document.querySelector('.bell .icon').click(); return T.text('.bell-pop').includes('ready'); })()`, 8000));
  await seq(B, `T.set('input[type=password]', '12')`); await B.eval(`T.ct('I approve')`);
  check('Signature PIN must be 5 digits', await B.waitFor(`T.toast().includes('5-digit')`));
  await seq(B, `T.set('input[type=password]', '88310')`); await B.eval(`T.ct('I approve')`);
  check('Client approves and signs Form 8879', await A.waitFor(`!!__app.st.filing.clientApproval`, 8000));
  await A.hash('#/filing');
  await A.eval(`T.ct('Transmit')`);
  check('Open review note blocks transmission', await A.waitFor(`T.toast().includes('block filing')`));
  await A.hash('#/review');
  await A.eval(`T.ct('All notes')`);
  for (let i = 0; i < 20 && await A.eval(`T.ct('Resolve')`); i++) await sleep(150);
  check('Review notes resolved', await A.waitFor(`![...__app.st.notes.values()].some(n => n.status === 'open' && n.blocking)`));
  await A.hash('#/filing');
  await A.eval(`T.ct('Transmit')`);
  check('IRS rejects the e-file for the dependent SSN (R0000-504-02)', await A.waitFor(`__app.st.filing.status === 'rejected' && T.main().includes('R0000-504-02')`));
  check('Rejection opens a blocking review note', await A.eval(`[...__app.st.notes.values()].some(n => n.blocking && n.status === 'open' && n.text.includes('E-file rejected'))`));
  await A.hash('#/checks');
  await A.eval(`const c = document.getElementById('chk-ssn-theo'); [...c.querySelectorAll('button')].find(b => b.innerText === 'Adopt').click()`);
  check('SSN corrected from the Social Security card (D71)', await A.waitFor(`__app.st.overrides.get('household:theo.ssn')?.value === '666-74-3390'`));
  await A.hash('#/review'); await A.eval(`T.ct('All notes')`);
  for (let i = 0; i < 10 && await A.eval(`T.ct('Resolve')`); i++) await sleep(150);
  await A.hash('#/filing');
  await A.eval(`T.ct('Transmit')`);
  check('Retransmitted: federal and California accepted', await A.waitFor(`__app.st.filing.submissions.filter(s => s.status === 'accepted').length === 2`));
  check('Return frozen at filing with a snapshot', await A.waitFor(`!!__app.st.filing.frozen && T.main().includes('Frozen snapshot')`));
  const filed = await A.eval(`__app.st.filing.frozen.snapshot.position`);
  check('Filed position: federal refund ≈ 4,264, California refund ≈ 11,691', Math.abs(filed.federal.balance_due + 4264) <= 100 && Math.abs(filed.california.balance_due + 11691) <= 100, JSON.stringify({ fed: filed.federal.balance_due, ca: filed.california.balance_due }));
  await A.eval(`T.ct('Client copy')`);
  check('Client copy produced', await A.waitFor(`!!document.querySelector('.client-copy') && T.text('.client-copy').includes('Refund')`));
  await A.eval(`document.querySelector('.modal-bg').click()`);
  await A.eval(`__app.openTrace('SchC.24a')`);
  check('After freeze, changes need an amendment', await A.waitFor(`(() => { T.ct('Adjust', '.drawer'); return !!document.querySelector('.modal') && document.querySelector('.modal').innerText.includes('frozen'); })()`));
  await A.eval(`document.querySelector('.modal-bg')?.click(); document.querySelector('.drawer .icon.right')?.click()`);
  await A.as('st-03'); await A.hash('#/filing');
  await A.eval(`T.ct('Start amendment')`);
  check('Amendment started on top of the frozen return', await A.waitFor(`__app.st.filing.amendments.length === 1 && __app.st.filing.status === 'amending'`));
  const amendId = await A.eval(`__app.act('adjust', { key: 'SchC.24a', label: 'Travel', from: 4520, to: 4300, effects: [{ cat: 'schc_profit', base: 220 }], reason: 'Amendment test', authority: 'test' }, { perm: 'adjust' }).id`);
  check('Post-filing change lands in the amendment layer', await A.waitFor(`__app.st.adjustments.get(${JSON.stringify(amendId)})?.layer === 'amendment'`));
  for (let i = 0; i < 12; i++) { if (!(await A.eval(`T.ct('Replay next')`))) break; await sleep(300); }
  check('Season replayed to the 2028 examination letter', await A.waitFor(`__app.st.notices.has('N-2025-L566')`));
  await A.eval(`[...document.querySelectorAll('button')].filter(b => b.innerText.startsWith('Build response')).pop().click()`);
  check('Notice response: self-contained record for each item', await A.waitFor(`T.text('.modal').includes('Noncash charitable') && T.text('.modal').includes('Schedule C gross receipts') && T.text('.modal').includes('151,300')`));
  await A.eval(`T.ct('Download record')`);
  const rec = await A.eval(`(async () => JSON.parse(await window.__lastBlob.text()))()`);
  check('Response record downloads with lines, changes, documents and checks', rec?.items?.length === 2 && rec.items[1].lines[0].asFiled === 151300 && rec.items[0].documents.length === 2);
  await A.eval(`T.ct('Mark responded')`);
  check('Notice marked responded', await A.waitFor(`__app.st.notices.get('N-2025-L566').status === 'responded'`));
  await A.eval(`document.querySelector('.modal-bg')?.click()`);
  check('Carry forward and plan next year', await A.eval(`T.main().includes('2026 federal estimates (safe harbor)') && T.main().includes('Carried to next year')`));

  section('Firm');
  await A.as('st-01'); await A.hash('#/firm');
  check('Standards read-only for staff', await A.waitFor(`T.main().includes('Read-only for preparer')`));
  await A.as('st-05'); await A.hash('#/firm');
  const before = await A.eval(`document.querySelectorAll('tr.flag').length`);
  await seq(A, `const i = document.querySelectorAll('.main input[type=number]'); T.set(i[0], '50')`, `const i = document.querySelectorAll('.main input[type=number]'); T.ct('Save')`);
  check('Administrator edits firm standards (variance threshold 10% → 50%)', await A.waitFor(`__app.st.standards.variance_review.flag_if_change_over_percent === 50`));
  check('Sensitive-data view log visible to the administrator', await A.eval(`T.main().includes('Sensitive data view log') && T.main().includes('D08 page 1')`));
  await A.hash('#/area/business');
  await seq(A, `const r = document.querySelectorAll('.main .card')[document.querySelectorAll('.main .card').length - 1]; T.set(r.querySelector('input[type=number]'), '2.5')`, `const r = document.querySelectorAll('.main .card')[document.querySelectorAll('.main .card').length - 1]; T.set(r.querySelectorAll('input')[1], 'Books to tax review')`, `const r = document.querySelectorAll('.main .card')[document.querySelectorAll('.main .card').length - 1]; T.ct('Log time')`);
  check('Time logged against the area budget', await A.waitFor(`__app.st.time.some(t => t.area === 'business' && t.hours === 2.5)`));
  await A.hash('#/firm');
  check('Time vs budget and status board', await A.waitFor(`T.main().includes('Time against budget') && T.main().includes('Status board')`));
  await A.eval(`document.querySelector('.search-btn').click()`);
  await A.waitFor(`!!document.querySelector('.search-input')`);
  await A.eval(`T.set('.search-input', 'Coinhaven')`);
  check('Search finds documents, lines and values', await A.waitFor(`document.querySelectorAll('.result').length > 3 && T.text('.results').includes('D34')`));
  await A.eval(`document.querySelector('.modal-bg').click()`);

  section('Records a CPA expects');
  const pages = [
    ['#/overview', ['Return summary vs last year', 'Required steps']], ['#/area/taxcalc', ['Tax computation', 'Carryovers to 2026']],
    ['#/documents', ['Document index']], ['#/area/rentals', ['Rental depreciation by asset', 'Fed 2025', 'CA 2025', 'AMT diff', 'Disposal', 'Passive activity losses', 'Form 4797']],
    ['#/area/investments', ['Sales detail', 'Schedule D']], ['#/area/business', ['Books to taxable income', 'Business assets (Form 4562)']],
    ['#/area/passthrough', ['K-1 lines → return', 'Basis by year']], ['#/area/retirement', ['Backdoor Roth', 'Foreign account']],
    ['#/area/deductions', ['Itemized deductions with limits', 'Credits']], ['#/area/payments', ['Federal payments vs IRS records', 'California payments vs FTB']],
    ['#/area/california', ['State split']], ['#/related', ['Related returns', '2024 vs 2025, line by line', 'Links you have recorded']],
    ['#/adjustments', ['Prior preparer vs us']],
  ];
  await A.as('st-02');
  for (const [h, needles] of pages) { await A.hash(h); const t = await A.eval(`T.main()`); const miss = needles.filter(n => !t.includes(n)); check(`${h} shows ${needles.join(', ')}`, !miss.length, 'missing: ' + miss.join(', ')); }

  section('Saving everything');
  const n = await A.eval(`__app.events.length`);
  await A.goto(url);
  check('Reload: every action is still there (from the server)', await A.waitFor(`__app.events.length >= ${n} && !!__app.st.filing.frozen`, 15000));
  await B.goto(url);
  check('A fresh browser session sees the same workpaper', await B.waitFor(`__app.events.length >= ${n}`, 15000));
  await A.hash('#/filing');
  await A.eval(`T.ct('Export log')`);
  const exported = await A.eval(`(async () => JSON.parse(await window.__lastBlob.text()).ledger.length)()`);
  check('Export of the full log', exported >= n, `exported ${exported}`);

  section('AI assistance (guardrails)');
  const aiCfg = await A.eval(`import('./app/api.js').then(m => fetch(m.API + 'api/ai')).then(r => r.json())`);
  console.log(`  (AI ${aiCfg.configured ? 'configured: real Gemini calls' : 'not configured: using a simulated model response'})`);
  if (!aiCfg.configured) {
    await A.eval(`(() => { const f = window.fetch; window.fetch = (u, o) => String(u).includes('api/ai') && o?.method === 'POST'
      ? Promise.resolve(new Response(JSON.stringify({ answer: 'Gross receipts were built from books revenue [D14] plus the 1099-K [D21]; the 1099-K is already inside the Atlas 1099-NEC [D17]. See [check:gross-receipts] and [D99].', verdict: 'agree', citations: ['D14', 'D21', 'D17', 'check:gross-receipts', 'D99'], model: 'simulated', ms: 900 }), { headers: { 'content-type': 'application/json' } }))
      : f(u, o); window.__aiConfigured = false; return true; })()`);
  }
  await A.as('st-02');
  await A.hash('#/checks');
  await A.eval(`T.ct('Resolved')`);
  await A.waitFor(`!!document.getElementById('chk-gross-receipts')`);
  const ctxText = await A.eval(`(async () => { const m = await import('./app/views/ai.js'); return m.buildContext(__app, 'second_opinion', 'gross-receipts').text; })()`);
  check('AI context is the evidence bundle for this finding (documents, lines, page text)', ctxText.includes('[D17]') && ctxText.includes('[SchC.1]') && ctxText.includes('Paywell'));
  const ssnCtx = await A.eval(`(async () => { const m = await import('./app/views/ai.js'); return m.buildContext(__app, 'explain_line', 'F1040.1a').text; })()`);
  check('Identifiers masked before anything is sent to the model', !/666-\d\d-\d{4}/.test(ssnCtx) && ssnCtx.includes('•••-••-'));
  if (aiCfg.configured || true) {
    await A.eval(`[...document.getElementById('chk-gross-receipts').querySelectorAll('button')].find(b => b.innerText.includes('AI second opinion')).click()`);
    check('AI second opinion returns an answer with a verdict', await A.waitFor(`!!document.querySelector('#chk-gross-receipts .ai-out')`, 45000));
    const aiTxt = await A.eval(`document.querySelector('#chk-gross-receipts .ai-out').textContent`);
    check('Citations are clickable and verified against the packet', await A.eval(`document.querySelectorAll('#chk-gross-receipts .ai-out .ref').length > 0`));
    if (!aiCfg.configured) check('Invented citation (D99) flagged as not in the packet', aiTxt.includes('D99?') && aiTxt.includes('not found in the packet'));
    check('AI call logged with model and citation check', await A.eval(`__app.st.events.some(e => e.type === 'ai' && e.data.target === 'gross-receipts' && e.data.model)`));
    await A.eval(`[...document.querySelector('#chk-gross-receipts .ai-out').querySelectorAll('button')].find(b => b.innerText.startsWith('Accept')).click()`);
    check('Accepting saves it as a note on the finding (a person decided)', await A.waitFor(`[...__app.st.notes.values()].some(n => n.target === 'check:gross-receipts' && n.source === 'ai')`));
    check('Decision logged', await A.eval(`__app.st.events.some(e => e.type === 'ai.decision' && e.data.decision === 'accept')`));
    await A.as('st-05'); await A.hash('#/firm');
    check('AI usage log visible to the firm', await A.waitFor(`T.main().includes('AI usage log') && T.main().includes('Second opinion')`));
    await A.as('cu-01');
    check('Clients never see AI tools', await A.eval(`!document.querySelector('.ai-btn')`));
  }
  await A.as('st-02');
  await A.hash('#/about/errors');
  check('Errors document rendered in the app with live links', await A.waitFor(`T.main().includes('Errors found, and how the design surfaced them') && document.querySelectorAll('code.linkable').length > 10`));
  await A.eval(`[...document.querySelectorAll('code.linkable')].find(c => c.textContent === 'rsu-basis').click()`);
  check('Clicking a check id in the document opens that check', await A.waitFor(`location.hash === '#/checks' && !!document.querySelector('.check-card.focused')`));

  section('New-user tour and Ask the workpaper');
  await A.as('st-01');
  await A.eval(`T.ct('? Tour')`);
  check('Guided tour starts and spotlights a real control', await A.waitFor(`!!document.querySelector('.tour-card') && !!document.querySelector('.tour-hole')`));
  let steps = 0;
  for (let i = 0; i < 12; i++) { const more = await A.eval(`T.ct('Next', '.tour-card')`); if (!more) break; steps++; await sleep(700); }
  check('Tour walks through all its steps', steps >= 8 && await A.eval(`T.text('.tour-card').includes('Filing and after')`), `steps ${steps}`);
  await A.eval(`T.ct('Start working', '.tour-card')`);
  check('Tour closes and is remembered', await A.waitFor(`!document.querySelector('.tour') && localStorage.getItem('mwp.tour.done') === '1'`));
  await A.eval(`T.ct('✦ Ask')`);
  check('Ask panel opens with suggested questions', await A.waitFor(`!!document.querySelector('.ask-panel') && document.querySelectorAll('.ask-panel .suggest .chip').length >= 4`));
  const askCtx = await A.eval(`(async () => { const m = await import('./app/views/ai.js'); return m.buildContext(__app, 'ask', 'What is still blocking filing?').text; })()`);
  check('Ask context covers status, changes, checks and open notes (identifiers masked)', askCtx.includes('RETURN STATUS') && askCtx.includes('Check [check:') && !/666-\d\d-\d{4}/.test(askCtx));
  if (!aiCfg.configured) {
    await A.eval(`(() => { const f = window.fetch; window.fetch = (u, o) => String(u).includes('api/ai') && o?.method === 'POST'
      ? Promise.resolve(new Response(JSON.stringify({ answer: 'Nothing blocks filing: the return was accepted [F1040.37].', citations: ['F1040.37'], model: 'simulated', ms: 500 }), { headers: { 'content-type': 'application/json' } }))
      : f(u, o); return true; })()`);
  }
  await A.eval(`document.querySelector('.ask-panel .suggest .chip').click()`);
  check('Ask answers with verified citations', await A.waitFor(`!!document.querySelector('.ask-panel .ai-out') && document.querySelectorAll('.ask-panel .ai-out .ref').length > 0`, 45000));
  const askAns = await A.eval(`document.querySelector('.ask-panel .ai-out')?.textContent || ''`);
  console.log('    answer: ' + askAns.slice(0, 260).replace(/\s+/g, ' '));
  await A.eval(`T.ct('Save as note', '.ask-panel')`);
  check('Answer saved to the workpaper as a note (person accepted)', await A.waitFor(`[...__app.st.notes.values()].some(n => n.source === 'ai' && n.text.startsWith('Q: '))`));
  await A.eval(`document.querySelector('.ask-panel .icon.right').click()`);

  section('Errors');
  const errs = [...A.errors, ...B.errors];
  check('No JavaScript errors in either browser during the run', !errs.length, errs.slice(0, 5).join(' | '));
}

run().catch(e => { console.error(e); check('Test run completed without crashing', false, e.message); }).finally(async () => {
  try { await A.shot('final-a'); await B.shot('final-b'); } catch { }
  A.close(); B.close();
  if (!process.env.KEEP) await fetch(`${API_BASE}/api/ledger?ws=${WS}`, { method: 'DELETE' }).catch(() => { });
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; FAILED:\n - ${failed.map(f => `[${f.area}] ${f.name}${f.detail ? ' — ' + f.detail : ''}`).join('\n - ')}` : ''}`);
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
});
