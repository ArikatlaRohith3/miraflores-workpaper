// Runs the in-app independent checks headlessly: node tools/run_checks.mjs
import { readFileSync } from 'node:fs';
import { buildModel } from '../app/model.js';
import { runChecks } from '../app/checks.js';
import { taxEffect } from '../app/ledger.js';
const m = buildModel(JSON.parse(readFileSync(new URL('../data/packet.json', import.meta.url), 'utf8')));
const res = runChecks(m);
let fed = 0, ca = 0, fp = 0, cp = 0;
for (const r of res) {
  console.log(`[${r.status.toUpperCase()}] ${r.id}: ${r.title}`);
  for (const p of r.proposals || []) {
    const e = taxEffect(m, p);
    fed += e.fedTax; ca += e.caTax; fp += e.fedPay; cp += e.caPay;
    console.log(`     -> ${p.key}: ${p.from} -> ${p.to}  fed ${e.fedTax} ca ${e.caTax} pay ${e.fedPay}/${e.caPay}`);
  }
}
console.log({ fedTax: fed, caTax: ca, fedPay: fp, caPay: cp, count: res.length });
