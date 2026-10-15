// Shared, append-only ledger per workspace, stored in Netlify Blobs.
// Appends use a conditional write (compare-and-swap on the blob's ETag), so two
// people saving at the same moment never overwrite each other: the loser retries
// on top of the winner. The server assigns the canonical order (seq).
import { getStore } from '@netlify/blobs';

const WS = /^[a-z0-9-]{1,40}$/;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export default async (req) => {
  const url = new URL(req.url);
  const ws = url.searchParams.get('ws') || 'demo';
  if (!WS.test(ws)) return json({ error: 'bad workspace' }, 400);
  const store = getStore({ name: 'workpaper', consistency: 'strong' });
  const key = `log/${ws}`;

  if (req.method === 'GET') {
    const since = Number(url.searchParams.get('since') || 0);
    let cur = null;
    for (let i = 0; i < 5; i++) {
      try { cur = await store.get(key, { type: 'json' }); break; }
      catch { await new Promise(r => setTimeout(r, 50)); }
    }
    const events = cur?.events || [];
    return json({ ws, total: events.length, events: events.filter(e => e.seq > since) });
  }

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
    const incoming = Array.isArray(body?.events) ? body.events : [];
    if (!incoming.length || incoming.length > 500) return json({ error: 'no events' }, 400);
    for (let attempt = 0; attempt < 25; attempt++) {
      let cur;
      try { cur = await store.getWithMetadata(key, { type: 'json' }); }
      catch { await new Promise(r => setTimeout(r, 40 + Math.random() * 120)); continue; } // transient read
      try {
      const events = cur?.data?.events || [];
      const known = new Set(events.map(e => e.id));
      const stored = [];
      for (const e of incoming) {
        if (!e || typeof e.id !== 'string' || typeof e.type !== 'string') continue;
        if (known.has(e.id)) { stored.push(events.find(x => x.id === e.id)); continue; } // idempotent retry
        const ev = { ...e, seq: events.length + 1, serverAt: new Date().toISOString() };
        events.push(ev); stored.push(ev); known.add(e.id);
      }
      const res = cur
        ? await store.setJSON(key, { events }, { onlyIfMatch: cur.etag })
        : await store.setJSON(key, { events }, { onlyIfNew: true });
      if (res.modified) return json({ ws, total: events.length, stored });
      } catch { /* conflict surfaced as an error: retry */ }
      await new Promise(r => setTimeout(r, 30 + Math.random() * 150 * Math.min(attempt + 1, 6)));
    }
    return json({ error: 'busy, retry' }, 409);
  }

  if (req.method === 'DELETE') {
    await store.delete(key);
    return json({ ws, reset: true });
  }
  return json({ error: 'method' }, 405);
};

export const config = { path: '/api/ledger' };
