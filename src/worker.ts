import worker, { WeddingRoom } from './index';
import type { Env } from './index';

export { WeddingRoom };

async function runtimeDiagnostic(env: Env): Promise<Response> {
  const result: Record<string, unknown> = {};
  try {
    const users = await env.DB.prepare('SELECT COUNT(*) AS c FROM users').first<{ c: number }>();
    const sessions = await env.DB.prepare('SELECT COUNT(*) AS c FROM sessions').first<{ c: number }>();
    const hosts = await env.DB.prepare('SELECT COUNT(*) AS c FROM event_hosts').first<{ c: number }>();
    result.user_count = users?.c ?? 0;
    result.session_count = sessions?.c ?? 0;
    result.host_count = hosts?.c ?? 0;

    const event = await env.DB.prepare('SELECT id FROM events WHERE slug=?').bind('michael-marisa').first<{ id: string }>();
    result.event_exists = Boolean(event);

    const session = await env.DB.prepare('SELECT id FROM sessions ORDER BY created_at DESC LIMIT 1').first<{ id: string }>();
    result.has_session = Boolean(session);
    if (session && event) {
      const host = await env.DB.prepare(
        'SELECT s.user_id,u.email,u.display_name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>?',
      )
        .bind(session.id, Date.now())
        .first<{ user_id: string }>();
      result.session_join_valid = Boolean(host);
      if (host) {
        const membership = await env.DB.prepare('SELECT 1 FROM event_hosts WHERE event_id=? AND user_id=?')
          .bind(event.id, host.user_id)
          .first();
        result.event_host_valid = Boolean(membership);
      }
    }

    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode('diagnostic-password'), { name: 'PBKDF2' }, false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(`diagnostic-salt:${env.SESSION_SECRET}`), iterations: 100_000 },
      key,
      256,
    );
    result.pbkdf2_ok = bits.byteLength === 32;

    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  } catch (error) {
    const e = error instanceof Error ? error : new Error(String(error));
    return new Response(JSON.stringify({ ok: false, ...result, error: e.message, stack: e.stack }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/__weddingdj_runtime_diag_20260908') return runtimeDiagnostic(env);

    const roomMatch = url.pathname.match(/^\/room\/([^/]+)\/ws$/);
    if (roomMatch) {
      const stub = env.WEDDING_ROOM.get(env.WEDDING_ROOM.idFromName(roomMatch[1]));
      const headers = new Headers(req.headers);
      return stub.fetch(new Request('https://room/ws', { method: 'GET', headers }));
    }
    return worker.fetch(req, env);
  },
};
