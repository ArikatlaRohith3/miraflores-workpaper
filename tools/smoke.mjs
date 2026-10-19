// Headless smoke test: opens each view in Chrome via the DevTools protocol,
// collects console errors / exceptions and saves screenshots.
// Usage: node tools/smoke.mjs [baseUrl] [outDir]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const base = process.argv[2] || 'http://127.0.0.1:8765/index.html';
const out = process.argv[3] || 'smoke-out';
mkdirSync(out, { recursive: true });
const chrome = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9333;
const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, '--window-size=1500,1000', '--no-first-run', `--user-data-dir=${out}/profile`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, id = 0; const pending = new Map(); const errors = [];
async function connect() {
  for (let i = 0; i < 50; i++) {
    try { const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const pg = list.find(t => t.type === 'page'); if (pg) return pg.webSocketDebuggerUrl; } catch { }
    await sleep(200);
  }
  throw new Error('no chrome');
}
const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async expr => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

const steps = JSON.parse(process.env.STEPS || 'null') || [
  ['overview', '#/overview'], ['checks', '#/checks'], ['area-business', '#/area/business'], ['area-investments', '#/area/investments'],
  ['area-rentals', '#/area/rentals'], ['area-passthrough', '#/area/passthrough'], ['area-california', '#/area/california'], ['area-wages', '#/area/wages'],
  ['area-retirement', '#/area/retirement'], ['area-deductions', '#/area/deductions'], ['area-payments', '#/area/payments'], ['area-taxcalc', '#/area/taxcalc'],
  ['documents', '#/documents'], ['doc-D23', '#/documents/D23?ev=ev-0226'], ['adjustments', '#/adjustments'], ['review', '#/review'], ['filing', '#/filing'], ['firm', '#/firm'], ['client', '#/client'],
];

(async () => {
  const url = await connect();
  ws = new WebSocket(url);
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', m => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') errors.push('EXC ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
    if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) errors.push(d.params.type.toUpperCase() + ' ' + d.params.args.map(a => a.value ?? a.description).join(' '));
    if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') errors.push('LOG ' + d.params.entry.text + ' ' + (d.params.entry.url || ''));
  });
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('mwp.tour.done','1')}catch{}" });
  await send('Page.navigate', { url: base });
  await sleep(2500);
  if (process.env.PRE) await evalJs(process.env.PRE), await sleep(800);
  for (const [name, hash, js] of steps) {
    const before = errors.length;
    await evalJs(`location.hash='${hash}'`);
    await sleep(900);
    if (js) { await evalJs(js); await sleep(900); }
    const text = await evalJs(`document.querySelector('.main')?.innerText.slice(0,160).replace(/\\n/g,' | ')`);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${out}/${name}.png`, Buffer.from(shot.result.data, 'base64'));
    console.log(`${name}: ${errors.length - before} error(s) :: ${text}`);
    for (const e of errors.slice(before)) console.log('   ', e.slice(0, 400));
  }
  ws.close(); proc.kill();
  process.exit(0);
})().catch(e => { console.error(e); proc.kill(); process.exit(1); });
