// Evidence files attached to the workpaper (stored as data URLs in Netlify Blobs).
import { getStore } from '@netlify/blobs';

const WS = /^[a-z0-9-]{1,40}$/;
const ID = /^[a-z0-9-]{6,60}$/;
const MAX = 4.2 * 1024 * 1024 * 4 / 3 + 200; // ~4 MB file as base64

export default async (req) => {
  const url = new URL(req.url);
  const ws = url.searchParams.get('ws') || 'demo';
  if (!WS.test(ws)) return new Response('bad workspace', { status: 400 });
  const store = getStore({ name: 'workpaper-files', consistency: 'strong' });

  if (req.method === 'POST') {
    const body = await req.json().catch(() => null);
    if (!body?.dataUrl || typeof body.dataUrl !== 'string' || body.dataUrl.length > MAX) return new Response('missing or too large', { status: 413 });
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    await store.set(`${ws}/${id}`, body.dataUrl, { metadata: { name: String(body.name || 'file').slice(0, 200), type: String(body.type || ''), size: Number(body.size) || 0 } });
    return Response.json({ id });
  }
  if (req.method === 'GET') {
    const id = url.searchParams.get('id') || '';
    if (!ID.test(id)) return new Response('bad id', { status: 400 });
    const r = await store.getWithMetadata(`${ws}/${id}`);
    if (!r) return new Response('not found', { status: 404 });
    const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(r.data);
    if (!m) return new Response('corrupt', { status: 500 });
    const bytes = m[2] ? Uint8Array.from(atob(m[3]), c => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(m[3]));
    return new Response(bytes, { headers: { 'content-type': m[1] || 'application/octet-stream', 'content-disposition': `attachment; filename="${(r.metadata?.name || 'file').replace(/"/g, '')}"`, 'cache-control': 'private, max-age=3600' } });
  }
  return new Response('method', { status: 405 });
};

export const config = { path: '/api/files' };
