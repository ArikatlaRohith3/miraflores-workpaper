// Ad-hoc probe: node tools/debug.mjs <url> "<js1>" "<js2>" ...  (each evaluated after 1s)
import { spawn } from 'node:child_process';
const [url, ...steps] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const p = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=9499', '--window-size=1500,1000', `--user-data-dir=${process.env.TEMP}/mwp-dbg`, 'about:blank'], { stdio: 'ignore' });
let w; for (let i = 0; i < 50 && !w; i++) { try { w = (await (await fetch('http://127.0.0.1:9499/json')).json()).find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch { } await sleep(200); }
const ws = new WebSocket(w); await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pend = new Map();
ws.addEventListener('message', m => { const d = JSON.parse(m.data); if (d.id) pend.get(d.id)?.(d); if (d.method === 'Runtime.exceptionThrown') console.log('EXC', d.params.exceptionDetails.exception?.description); });
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable'); await send('Page.enable'); await send('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('mwp.tour.done','1')}catch{}" }); await send('Page.navigate', { url }); await sleep(3500);
for (const s of steps) { const r = await send('Runtime.evaluate', { expression: `(async()=>{ return await (0,eval)(${JSON.stringify(s)}) })()`, awaitPromise: true, returnByValue: true }); console.log('>', s.slice(0, 80), '\n ', JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description)?.slice(0, 8000)); await sleep(1000); }
ws.close(); p.kill(); process.exit(0);
