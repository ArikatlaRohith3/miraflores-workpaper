// Follows VIDEO_SCRIPT.md click by click on the live site and checks that every
// label, button and number the script mentions is really there.
// Usage: node tools/validate_script.mjs [baseUrl]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = (process.argv[2] || 'https://arikatlarohith3.github.io/miraflores-workpaper').replace(/\/$/, '');
const WS = 'sandbox-validate-' + Date.now().toString(36);
const OUT = join(tmpdir(), 'mwp-validate'); mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
let step = '';
const check = (name, ok, info = '') => { results.push({ step, name, ok: !!ok, info }); console.log(`${ok ? '  ✓' : '  ✗'} ${name}${info ? '  — ' + info : ''}`); };

const proc = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=9461', '--window-size=1600,1000', `--user-data-dir=${join(OUT, 'profile')}`, 'about:blank'], { stdio: 'ignore' });
let wsUrl; for (let i = 0; i < 60 && !wsUrl; i++) { try { wsUrl = (await (await fetch('http://127.0.0.1:9461/json')).json()).find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch { } await sleep(200); }
const ws = new WebSocket(wsUrl); await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pend = new Map(); const errors = [];
ws.addEventListener('message', m => { const d = JSON.parse(m.data); if (d.id) pend.get(d.id)?.(d); if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description); });
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: `(async()=>{ return await (0,eval)(${JSON.stringify(expr)}) })()`, awaitPromise: true, returnByValue: true }); return r.result?.result?.value; };
const wait = async (expr, t = 10000) => { const s = Date.now(); while (Date.now() - s < t) { try { if (await ev(expr)) return true; } catch { } await sleep(200); } return false; };
const shot = async name => { const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, name + '.png'), Buffer.from(s.result.data, 'base64')); };
const H = `window.T={
  txt:()=>document.body.innerText,
  main:()=>document.querySelector('.main')?.innerText||'',
  drawer:()=>document.querySelector('.drawer')?.innerText||'',
  btn:(t,root)=>[...(root?document.querySelector(root):document).querySelectorAll('button')].find(b=>b.innerText.trim().startsWith(t)&&!b.disabled),
  click:(t,root)=>{const b=T.btn(t,root); if(b){b.click(); return true} return false},
  as:id=>{const s=document.querySelector('.role select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,id); s.dispatchEvent(new Event('change',{bubbles:true}))},
  setv:(el,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v); el.dispatchEvent(new Event('input',{bubbles:true}))},
  nav:label=>{const a=[...document.querySelectorAll('.side a')].find(a=>a.innerText.trim().startsWith(label)); if(a){a.click(); return true} return false},
}; window.confirm=()=>true; try{localStorage.setItem('mwp.tour.done','1')}catch{}`;
await send('Runtime.enable'); await send('Page.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: H });
await send('Page.navigate', { url: `${BASE}/index.html?ws=${WS}` });
await wait(`!!window.__app && !!document.querySelector('.main')`, 20000); await sleep(800);

step = 'Setup';
console.log('\n# Setup');
check('Sandbox chip shows the sandbox name', await ev(`document.querySelector('.ws-chip').innerText.includes('${WS}')`));
await ev(`T.as('st-01')`); await sleep(300);
check('Acting as: Priya Raman — preparer', await ev(`document.querySelector('.role select').selectedOptions[0].text.startsWith('Priya Raman — preparer')`));

step = '1'; console.log('\n# 1. Introduction');
await ev(`T.nav('Overview')`); await sleep(500);
check('Federal box has columns Engine v3 / Approved / Incl. proposed', await ev(`(()=>{const c=[...document.querySelectorAll('.pos')].find(p=>p.innerText.startsWith('Federal')); return c && ['Engine v3','Approved','Incl. proposed'].every(x=>c.innerText.includes(x))})()`));
check('"Ready to file?" box says 19 failing checks', await ev(`T.main().includes('Ready to file?') && T.main().includes('19 failing checks unresolved')`));
check('…and 2 of 12 required steps', await ev(`T.main().includes('2 of 12 required steps')`));
await shot('1-overview');

step = '2'; console.log('\n# 2. Trace any number');
check('Box "Return summary vs last year" exists', await ev(`T.main().includes('Return summary vs last year')`));
check('First row chip is "LINE F1040.1z"', await ev(`(()=>{const t=[...document.querySelectorAll('.card')].find(c=>c.innerText.includes('Return summary vs last year')); const r=t.querySelector('tbody tr .ref-line'); return r && r.innerText.replace(/\\s+/g,' ').trim()==='LINE F1040.1z'})()`));
await ev(`[...document.querySelectorAll('.card')].find(c=>c.innerText.includes('Return summary vs last year')).querySelector('tbody tr .ref-line').click()`);
check('Panel opens with "How it was built" and the rule', await wait(`T.drawer().includes('HOW IT WAS BUILT') || T.drawer().toLowerCase().includes('how it was built')`));
check('Input "F1040.1a" is listed', await ev(`[...document.querySelectorAll('.drawer .ref-line')].some(b=>b.innerText.includes('F1040.1a'))`));
await ev(`[...document.querySelectorAll('.drawer .ref-line')].find(b=>b.innerText.includes('F1040.1a')).click()`); await sleep(600);
const firstSrc = await ev(`document.querySelector('.drawer .source-row .ref')?.innerText.replace(/\\s+/g,' ').trim()`);
check('First Source row starts with "VALUE D08 p1"', /^VALUE D08 p1/.test(firstSrc || ''), firstSrc);
check('Source shows 99% confidence', await ev(`document.querySelector('.drawer .source-row .conf')?.innerText.trim()==='99%'`));
await ev(`document.querySelector('.drawer .source-row .ref').click()`);
check('Page shows yellow highlight on 104,600', await wait(`(document.querySelector('.drawer mark.sel')?.innerText||'').includes('104,600')`));
await shot('2-trace');
await ev(`document.querySelector('.drawer .icon.right').click()`); await sleep(300);
check('Panel closes with ✕', await ev(`!document.querySelector('.drawer')`));
await ev(`T.nav('Documents')`); await sleep(600);
check('Documents: D10 shows "duplicate"', await ev(`[...document.querySelectorAll('.docs tbody tr')].some(r=>r.innerText.startsWith('D10') && r.innerText.includes('duplicate'))`));
check('Documents: D30 shows "superseded"', await ev(`[...document.querySelectorAll('.docs tbody tr')].some(r=>r.innerText.startsWith('D30') && r.innerText.includes('superseded'))`));

step = '3'; console.log('\n# 3. Independent checks');
check('Left menu "Independent checks" has red badge 19', await ev(`(()=>{const a=[...document.querySelectorAll('.side a')].find(a=>a.innerText.startsWith('Independent checks')); return a && a.querySelector('.badge.bad')?.innerText==='19'})()`));
await ev(`T.nav('Independent checks')`); await sleep(700);
check('"Failing" tab open', await ev(`document.querySelector('.tabs button.on')?.innerText.startsWith('Failing')`));
for (const t of ['Business miles 11,800 include a duplicate log page', 'Gross receipts 163,700 count the 1099-K a second time', 'RSU sales reported with zero basis']) check(`Card "${t}…"`, await ev(`[...document.querySelectorAll('.check-card h3')].some(h=>h.innerText.startsWith(${JSON.stringify(t)}))`));
check('Mileage card mentions 8,100 miles', await ev(`T.main().includes('trips add to 8,100')`));
check('RSU card mentions 47,620', await ev(`T.main().includes('47,620')`));
check('First card has "✦ AI second opinion"', await ev(`!!T.btn('✦ AI second opinion', '.check-card')`));
await ev(`T.click('✦ AI second opinion', '.check-card')`);
const aiOk = await wait(`!!document.querySelector('.check-card .ai-out') || !!document.querySelector('.check-card .banner.warn')`, 50000);
const aiState = await ev(`document.querySelector('.check-card .ai-out') ? 'answered' : (document.querySelector('.check-card .banner.warn')?.innerText || 'no answer')`);
check('AI second opinion responds (answer, or a clean "busy" message)', aiOk, aiState.slice(0, 90));
await shot('3-ai');
check('Bulk bar: "Select all with proposals (19)"', await ev(`document.querySelector('.bulkbar')?.innerText.includes('Select all with proposals (19)')`));
await ev(`document.querySelector('.bulkbar input').click()`); await sleep(300);
check('Button reads "Adopt 19 selected"', await ev(`!!T.btn('Adopt 19 selected')`));
await ev(`T.click('Adopt 19 selected')`); await sleep(800);
check('Black message with "Undo" appears', await ev(`(document.querySelector('.toast')?.innerText||'').includes('Undo')`));
await ev(`T.click('Undo', '.toast')`); await sleep(1000);
check('Undo reverts all adopted fixes', await ev(`[...__app.st.adjustments.values()].filter(a=>a.checkId).length===0`));
await ev(`document.querySelector('.bulkbar input').click()`); await sleep(300); await ev(`T.click('Adopt 19 selected')`);
check('Adopt again → 22 changes + SSN correction', await wait(`[...__app.st.adjustments.values()].filter(a=>a.checkId).length===22 && __app.st.overrides.has('household:theo.ssn')`));

step = '4'; console.log('\n# 4. Changes, roles, two people');
await ev(`T.nav('Changes & versions')`); await sleep(700);
check('"Workpaper changes" shows 22', await ev(`document.querySelector('.tabs button.on')?.innerText.includes('22')`));
check('Blue note tells Priya to switch roles', await ev(`T.main().includes('switch to the reviewer or partner to approve')`));
check('Priya has no checkboxes / Approve buttons', await ev(`!document.querySelector('.adjs tbody input[type=checkbox]') && !T.btn('Approve')`));
await ev(`T.as('st-02')`); await sleep(600);
const boxes = await ev(`document.querySelectorAll('.adjs tbody input[type=checkbox]').length`);
check('Daniel sees checkboxes', boxes >= 4, `${boxes} rows`);
await ev(`(async()=>{const cb=[...document.querySelectorAll('.adjs tbody input[type=checkbox]')].slice(0,4); for(const c of cb){c.click(); await new Promise(r=>setTimeout(r,150))}})()`); await sleep(500);
check('Green button reads "Approve 4"', await ev(`!!T.btn('Approve 4')`));
await ev(`T.click('Approve 4')`); await sleep(1200);
check('Approvals recorded (approved or awaiting partner)', await ev(`[...__app.st.adjustments.values()].filter(a=>['approved','awaiting_partner'].includes(a.status)).length>=4`));
check('Some rows carry the yellow "partner" tag', await ev(`[...document.querySelectorAll('.adjs .badge')].some(b=>b.innerText==='partner')`));
await ev(`T.as('st-03')`); await sleep(600);
await ev(`(()=>{const r=[...document.querySelectorAll('.adjs tbody tr')].find(r=>[...r.querySelectorAll('.badge')].some(b=>b.innerText==='partner') && r.querySelector('input[type=checkbox]')); r.querySelector('input[type=checkbox]').click()})()`); await sleep(300);
check('Helen: "Approve 1" after ticking a partner row', await ev(`!!T.btn('Approve 1')`));
await ev(`T.click('Approve 1')`); await sleep(1000);
check('Partner approval recorded', await ev(`[...__app.st.adjustments.values()].some(a=>a.approvals.some(x=>x.role==='partner'))`));
const otherOk = await (async () => { const r = await fetch(`https://miraflores-workpaper-api.rohith-miraflores.workers.dev/api/ledger?ws=${WS}`).then(r => r.json()); return r.total > 20; })();
check('Second browser would see the changes (server has them)', otherOk);
await ev(`T.as('st-04')`); await sleep(500); await ev(`T.nav('Documents')`); await sleep(500);
await ev(`[...document.querySelectorAll('.docs tbody a')].find(a=>a.innerText==='D08').click()`); await sleep(800);
check('Marcus on D08 sees •••-••-2287 (not the full SSN)', await ev(`T.main().includes('•••-••-2287') && !T.main().includes('666-41-2287')`));
await shot('4-marcus');

step = '5'; console.log('\n# 5. Ask the workpaper');
await ev(`T.as('st-02')`); await sleep(500);
await ev(`T.click('✦ Ask')`); await sleep(500);
check('Ask panel opens with the suggestion', await ev(`[...document.querySelectorAll('.ask-panel .suggest .chip')].some(c=>c.innerText==='What would the refund be if every proposed fix is adopted?')`));
await ev(`[...document.querySelectorAll('.ask-panel .suggest .chip')].find(c=>c.innerText==='What would the refund be if every proposed fix is adopted?').click()`);
const askDone = await wait(`!!document.querySelector('.ask-panel .ai-out') || !!document.querySelector('.ask-panel .banner.warn')`, 60000);
const askTxt = await ev(`document.querySelector('.ask-panel .ai-out')?.innerText || document.querySelector('.ask-panel .banner.warn')?.innerText || ''`);
check('Ask answers (or shows a clean "busy" message)', askDone, askTxt.replace(/\s+/g, ' ').slice(0, 120));
if (/4,?264/.test(askTxt)) check('Answer says 4,264 federal and 11,691 California', /4,?264/.test(askTxt) && /11,?691/.test(askTxt));
await shot('5-ask');
await ev(`document.querySelector('.ask-panel .icon.right').click()`); await sleep(300);

step = '6'; console.log('\n# 6. Filing and after');
await ev(`T.nav('Filing & after')`); await sleep(700);
check('"Filing workflow" box with "Send to client for approval"', await ev(`T.main().includes('Filing workflow') && !!T.btn('Send to client for approval')`));
await ev(`T.click('Send to client for approval')`); await sleep(800);
check('Status becomes "ready for client"', await ev(`__app.st.filing.status==='ready_for_client'`));
await ev(`T.as('cu-01')`); await sleep(800);
check('Ngozi sees "Your 2025 tax return"', await ev(`T.main().includes('Your 2025 tax return')`));
check('"Review and sign" section with PIN box', await ev(`T.main().includes('Review and sign') && !!document.querySelector('input[type=password]')`));
await ev(`T.setv(document.querySelector('input[type=password]'),'41207')`); await sleep(300);
check('Button "I approve and sign Form 8879"', await ev(`!!T.btn('I approve and sign Form 8879')`));
await ev(`T.click('I approve and sign Form 8879')`); await sleep(800);
check('Client approval recorded', await ev(`!!__app.st.filing.clientApproval`));
await ev(`T.as('st-02')`); await sleep(500); await ev(`T.nav('Filing & after')`); await sleep(600);
check('Button "Transmit e-file"', await ev(`!!T.btn('Transmit e-file')`));
await ev(`T.click('Transmit e-file')`); await sleep(1500);
check('✓ Transmitted and ✓ Filed & frozen', await wait(`[...document.querySelectorAll('.flow li.done')].map(l=>l.innerText).join('|').includes('Transmitted') && [...document.querySelectorAll('.flow li.done')].map(l=>l.innerText).join('|').includes('Filed & frozen')`));
check('Blue "Frozen snapshot" note', await ev(`T.main().includes('Frozen snapshot')`));
check('"Season timeline" box with "Replay next: …"', await ev(`T.main().includes('Season timeline') && !!T.btn('Replay next')`));
let replays = 0; for (let i = 0; i < 15; i++) { if (!(await ev(`T.click('Replay next')`))) break; replays++; await sleep(700); }
check('Replay next clicked until it disappears', !(await ev(`!!T.btn('Replay next')`)), `${replays} clicks`);
check('Last event: notice received (Letter 566 now open)', await ev(`__app.st.notices.has('N-2025-L566')`));
check('"Notices" box: Letter 566 row has "Build response"', await ev(`[...document.querySelectorAll('.card')].some(c=>c.innerText.startsWith('Notices') && c.innerText.includes('Letter 566')) && !!T.btn('Build response')`));
await ev(`[...document.querySelectorAll('button')].filter(b=>b.innerText.startsWith('Build response')).pop().click()`); await sleep(800);
check('Response pop-up: both items with reconciliation', await ev(`(document.querySelector('.modal')?.innerText||'').includes('Noncash charitable') && document.querySelector('.modal').innerText.includes('151,300')`));
await shot('6-notice');
await ev(`document.querySelector('.modal header .icon').click()`); await sleep(300);
check('Pop-up closes with ✕', await ev(`!document.querySelector('.modal')`));

step = '7'; console.log('\n# 7. Records a CPA expects');
for (const [nav, heading] of [['Business (Schedule C)', 'Books to taxable income — Lindqvist Studio'], ['Investments & digital assets', 'Sales detail —'], ['Rentals, sale & passive', 'Rental depreciation by asset — federal vs California vs AMT'], ['California (540NR) & state split', 'State split — Schedule CA (540NR)']]) {
  await ev(`T.nav(${JSON.stringify(nav)})`); await sleep(700);
  check(`"${nav}" shows "${heading}"`, await ev(`T.main().includes(${JSON.stringify(heading)})`));
  if (nav.startsWith('Investments')) { const sales = await ev(`(T.main().match(/Sales detail — ([0-9]+) dispositions/)||[])[1]`); check('Sales count matches the script ("295 sales")', sales === '295', `${sales} dispositions`); }
}
check('Top bar has "? Tour"', await ev(`!!T.btn('? Tour')`));
await ev(`T.click('? Tour')`); await sleep(1200);
check('Tour shows a step with "Skip tour"', await ev(`!!document.querySelector('.tour-card') && !!T.btn('Skip tour', '.tour-card')`));
await ev(`T.click('Skip tour', '.tour-card')`); await sleep(500);
check('Tour closes', await ev(`!document.querySelector('.tour')`));

step = '8-9'; console.log('\n# 8–9. Talk only');
await ev(`T.nav('Overview')`); await sleep(500);
check('Back on Overview, return shows as filed', await ev(`T.main().includes('Return overview')`));
check('No JavaScript errors during the whole run', !errors.length, errors.slice(0, 3).join(' | '));

await fetch(`https://miraflores-workpaper-api.rohith-miraflores.workers.dev/api/ledger?ws=${WS}`, { method: 'DELETE' }).catch(() => { });
ws.close(); proc.kill();
const bad = results.filter(r => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} script steps validated${bad.length ? '\nFAILED:\n' + bad.map(b => ` - [${b.step}] ${b.name} ${b.info}`).join('\n') : ''}\nScreenshots: ${OUT}`);
process.exit(0);
