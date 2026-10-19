// Shared, append-only ledger per workspace, stored in Netlify Blobs.
//
// Every event is written as its own blob under a unique, time-ordered key, so
// concurrent saves never touch the same object and cannot overwrite each other
// (no read-modify-write anywhere). Order = key order (server time + counter).
// Reads list the keys after a watermark and fetch only the new ones; a snapshot
// of older events keeps the first load fast.
import { getStore } from '@netlify/blobs';

const WS = /^[a-z0-9-]{1,40}$/;
const SNAP_LAG_MS = 30_000; // only events older than this go into the snapshot
let counter = 0;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const keyTime = k => Number(k.split('/e/')[1]?.slice(0, 14) || 0);

async function fetchAll(store, keys) {
  const out = [];
  for (let i = 0; i < keys.length; i += 40) {
    const part = await Promise.all(keys.slice(i, i + 40).map(async k => {
      for (let t = 0; t < 4; t++) { try { return await store.get(k, { type: 'json' }); } catch { await new Promise(r => setTimeout(r, 60)); } }
      return null;
    }));
    out.push(...part.filter(Boolean));
  }
  return out;
}

async function readEpoch(store, ws) {
  try { return (await store.get(`${ws}/epoch`)) || '0'; } catch { return '0'; }
}

export default async (req) => {
  const url = new URL(req.url);
  const ws = url.searchParams.get('ws') || 'demo';
  if (!WS.test(ws)) return json({ error: 'bad workspace' }, 400);
  const store = getStore({ name: 'workpaper-ledger', consistency: 'strong' });
  const prefix = `${ws}/e/`;

  if (req.method === 'GET') {
    const after = url.searchParams.get('after') || '';
    const epoch = await readEpoch(store, ws);
    const { blobs } = await store.list({ prefix });
    const keys = blobs.map(b => b.key).sort();
    if (after) {
      const fresh = await fetchAll(store, keys.filter(k => k > after));
      return json({ ws, epoch, total: keys.length, events: fresh });
    }
    let snap = null;
    try { snap = await store.get(`${ws}/snap`, { type: 'json' }); } catch { }
    if (!snap || snap.epoch !== epoch) snap = { epoch, upto: '', events: [] };
    const tail = await fetchAll(store, keys.filter(k => k > snap.upto));
    const events = [...snap.events, ...tail].sort((a, b) => (a.key < b.key ? -1 : 1));
    const cutoff = Date.now() - SNAP_LAG_MS;
    const old = events.filter(e => keyTime(e.key) < cutoff);
    if (tail.length > 30 && old.length > snap.events.length) {
      try { await store.setJSON(`${ws}/snap`, { epoch, upto: old[old.length - 1].key, events: old }); } catch { }
    }
    return json({ ws, epoch, total: keys.length, events });
  }

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
    const incoming = (Array.isArray(body?.events) ? body.events : []).filter(e => e && typeof e.id === 'string' && /^[\w-]{1,60}$/.test(e.id) && typeof e.type === 'string');
    if (!incoming.length || incoming.length > 500) return json({ error: 'no events' }, 400);
    const now = Date.now();
    const stored = incoming.map(e => {
      counter = (counter + 1) % 10000;
      const key = `${prefix}${String(now).padStart(14, '0')}-${String(counter).padStart(4, '0')}-${e.id}`;
      return { ...e, key, serverAt: new Date(now).toISOString() };
    });
    // The event id is part of the key, so a retried POST of the same event writes the same key.
    for (let i = 0; i < stored.length; i += 40) {
      await Promise.all(stored.slice(i, i + 40).map(async ev => {
        for (let t = 0; t < 4; t++) { try { await store.setJSON(ev.key, ev); return; } catch (err) { if (t === 3) throw err; await new Promise(r => setTimeout(r, 80)); } }
      }));
    }
    return json({ ws, stored });
  }

  if (req.method === 'DELETE') {
    // The shared demo workspace can only be reset by the owner (RESET_TOKEN); private sandboxes by anyone using them.
    if (ws === 'demo') {
      const token = process.env.RESET_TOKEN;
      if (!token || req.headers.get('x-reset-token') !== token) return json({ error: 'The shared demo workspace can only be reset by its owner. Open a private sandbox to start fresh.' }, 403);
    }
    const { blobs } = await store.list({ prefix: `${ws}/` });
    for (let i = 0; i < blobs.length; i += 50) await Promise.all(blobs.slice(i, i + 50).map(b => store.delete(b.key).catch(() => { })));
    await store.set(`${ws}/epoch`, String(Date.now()));
    return json({ ws, reset: true });
  }
  return json({ error: 'method' }, 405);
};

export const config = { path: '/api/ledger' };
