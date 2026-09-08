export interface Env {
  DB: D1Database;
  WEDDING_ROOM: DurableObjectNamespace;
  APP_URL: string;
  SESSION_SECRET: string;
  CASHAPP_URL?: string;
  CASHAPP_QR_IMAGE_URL?: string;
  SQUARE_ACCESS_TOKEN?: string;
  SQUARE_LOCATION_ID?: string;
  SQUARE_ENVIRONMENT?: 'sandbox' | 'production';
  SQUARE_WEBHOOK_SIGNATURE_KEY?: string;
  SPOTIFY_CLIENT_ID?: string;
  SPOTIFY_CLIENT_SECRET?: string;
}

type RequestTier = 'free' | 'priority_5' | 'front_10';
type PaymentStatus = 'not_required' | 'pending' | 'paid' | 'failed' | 'refunded';
type EventStatus = 'active' | 'paused' | 'closed';

type SongRequest = {
  id: string;
  event_id: string;
  guest_token: string;
  guest_name: string | null;
  guest_message: string | null;
  track_title: string;
  track_artist: string;
  track_album: string | null;
  track_artwork_url: string | null;
  provider: string;
  provider_track_id: string | null;
  provider_uri: string | null;
  duration_ms: number | null;
  explicit: number;
  tier: RequestTier;
  payment_status: PaymentStatus;
  boost_code: string | null;
  review_status: 'approved' | 'deferred' | 'declined';
  playback_status: 'unplayed' | 'queued' | 'playing' | 'played' | 'skipped';
  queue_rank: number;
  created_at: string;
  updated_at: string;
};

type EventRow = {
  id: string;
  slug: string;
  couple_names: string;
  welcome_message: string;
  status: EventStatus;
  explicit_allowed: number;
  max_track_ms: number;
  guest_request_limit: number;
  cashapp_url: string | null;
  cashapp_qr_image_url: string | null;
  spotify_access_token: string | null;
  spotify_refresh_token: string | null;
  spotify_token_expires_at: number | null;
};

type Host = { user_id: string; email: string; display_name: string };

const enc = new TextEncoder();
const SQUARE_VERSION = '2026-08-19';
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const normalize = (x: string) => x.trim().toLocaleLowerCase();
const boostAmount = (tier: RequestTier) => (tier === 'front_10' ? 1000 : tier === 'priority_5' ? 500 : 0);
const tierLabel = (tier: RequestTier) =>
  tier === 'front_10' ? 'Jump to Front · $10' : tier === 'priority_5' ? 'Priority Request · $5' : 'Free Request';

function html(body: string, title = 'The Wedding DJ') {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#171719"><title>${esc(title)}</title><style>${styles}</style></head><body>${body}</body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  );
}

function json(data: unknown, init: number | ResponseInit = 200) {
  const base: ResponseInit = typeof init === 'number' ? { status: init } : init;
  const headers = new Headers(base.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { ...base, headers });
}

function esc(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]!);
}

function redirect(url: string, headers: HeadersInit = {}) {
  return new Response(null, { status: 302, headers: { Location: url, ...headers } });
}

function cookie(name: string, value: string, maxAge: number, secure: boolean) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}; Max-Age=${maxAge}`;
}

function clearCookie(name: string, secure: boolean) {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}; Max-Age=0`;
}

function isSecure(req: Request) {
  return new URL(req.url).protocol === 'https:';
}

function parseCookies(req: Request) {
  const raw = req.headers.get('Cookie') || '';
  const pairs = raw
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const i = x.indexOf('=');
      return i < 0 ? [x, ''] : [x.slice(0, i), decodeURIComponent(x.slice(i + 1))];
    });
  return Object.fromEntries(pairs);
}

function hex(bytes: Uint8Array) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(bytes = 16) {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}

function shortCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

async function hashPassword(password: string, salt: string, secret: string) {
  const raw = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(`${salt}:${secret}`), iterations: 100_000 },
    raw,
    256,
  );
  return hex(new Uint8Array(bits));
}

async function requireHost(req: Request, env: Env, eventId?: string): Promise<Host | null> {
  const sid = parseCookies(req).session;
  if (!sid) return null;
  const row = await env.DB.prepare(
    'SELECT s.user_id,u.email,u.display_name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>?',
  )
    .bind(sid, Date.now())
    .first<Host>();
  if (!row) return null;
  if (eventId) {
    const host = await env.DB.prepare('SELECT 1 FROM event_hosts WHERE event_id=? AND user_id=?').bind(eventId, row.user_id).first();
    if (!host) return null;
  }
  return row;
}

async function eventForSlug(env: Env, slug: string) {
  return env.DB.prepare('SELECT * FROM events WHERE slug=?').bind(slug).first<EventRow>();
}

function room(env: Env, eventId: string) {
  return env.WEDDING_ROOM.get(env.WEDDING_ROOM.idFromName(eventId));
}

async function broadcast(env: Env, eventId: string, payload: unknown) {
  await room(env, eventId).fetch(
    new Request('https://room/internal/broadcast', { method: 'POST', body: JSON.stringify(payload) }),
  );
}

function appUrl(env: Env, req?: Request) {
  const configured = (env.APP_URL || '').trim().replace(/\/$/, '');
  if (configured && configured !== 'http://localhost:8787') return configured;
  if (req) return new URL(req.url).origin;
  return configured || 'http://localhost:8787';
}

function cashAppUrl(env: Env, ev: EventRow) {
  return (ev.cashapp_url || env.CASHAPP_URL || '').trim();
}

function cashAppQrUrl(env: Env, ev: EventRow) {
  return (ev.cashapp_qr_image_url || env.CASHAPP_QR_IMAGE_URL || '').trim();
}

function squareConfigured(env: Env) {
  return Boolean(env.SQUARE_ACCESS_TOKEN && env.SQUARE_LOCATION_ID);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    if (path === '/') return redirect('/e/michael-marisa');
    if (path === '/health') return json({ ok: true, service: 'The Wedding DJ' });
    if (path.startsWith('/room/')) return room(env, path.slice(6).split('/')[0]).fetch(req);

    if (path === '/api/square/webhook' && method === 'POST') return squareWebhook(req, env);
    if (path === '/api/spotify/search' && method === 'GET') return spotifySearch(req, env);
    if (path === '/auth/spotify/start' && method === 'GET') return spotifyStart(req, env);
    if (path === '/auth/spotify/callback' && method === 'GET') return spotifyCallback(req, env);

    if (path === '/auth/login' && method === 'GET') return html(loginPage(url.searchParams.get('next') || '/dashboard/michael-marisa'));
    if (path === '/auth/login' && method === 'POST') return login(req, env);
    if (path === '/auth/logout' && method === 'POST') return redirect('/', { 'Set-Cookie': clearCookie('session', isSecure(req)) });
    if (path === '/setup' && method === 'GET') return html(setupPage());
    if (path === '/setup' && method === 'POST') return setup(req, env);

    const eventMatch = path.match(/^\/e\/([a-z0-9-]+)$/);
    if (eventMatch && method === 'GET') {
      const ev = await eventForSlug(env, eventMatch[1]);
      return ev ? html(guestPage(ev), `${ev.couple_names} · The Wedding DJ`) : html(notFound(), 'Not found');
    }

    const dashboardMatch = path.match(/^\/dashboard\/([a-z0-9-]+)$/);
    if (dashboardMatch && method === 'GET') {
      const ev = await eventForSlug(env, dashboardMatch[1]);
      if (!ev) return html(notFound());
      const host = await requireHost(req, env, ev.id);
      return host ? html(dashboardPage(ev, host.display_name)) : redirect(`/auth/login?next=${encodeURIComponent(path)}`);
    }

    const boostMatch = path.match(/^\/boost\/([0-9a-f-]+)$/);
    if (boostMatch && method === 'GET') return boostPage(req, env, boostMatch[1]);

    const requestsMatch = path.match(/^\/api\/events\/([a-z0-9-]+)\/requests$/);
    if (requestsMatch && method === 'GET') return listRequests(req, env, requestsMatch[1]);
    if (requestsMatch && method === 'POST') return createRequest(req, env, requestsMatch[1]);

    const eventStatusMatch = path.match(/^\/api\/events\/([a-z0-9-]+)\/status$/);
    if (eventStatusMatch && method === 'POST') return setEventStatus(req, env, eventStatusMatch[1]);

    const hostsMatch = path.match(/^\/api\/events\/([a-z0-9-]+)\/hosts$/);
    if (hostsMatch && method === 'POST') return createHost(req, env, hostsMatch[1]);

    const actionMatch = path.match(/^\/api\/requests\/([0-9a-f-]+)\/action$/);
    if (actionMatch && method === 'POST') return requestAction(req, env, actionMatch[1]);

    const squareCheckoutMatch = path.match(/^\/api\/requests\/([0-9a-f-]+)\/square-checkout$/);
    if (squareCheckoutMatch && method === 'POST') return squareCheckout(req, env, squareCheckoutMatch[1]);

    const cashAppPaidMatch = path.match(/^\/api\/requests\/([0-9a-f-]+)\/cashapp-paid$/);
    if (cashAppPaidMatch && method === 'POST') return cashAppPaid(req, env, cashAppPaidMatch[1]);

    const boostStatusMatch = path.match(/^\/api\/requests\/([0-9a-f-]+)\/boost-status$/);
    if (boostStatusMatch && method === 'GET') return boostStatus(req, env, boostStatusMatch[1]);

    const playbackMatch = path.match(/^\/api\/events\/([a-z0-9-]+)\/playback$/);
    if (playbackMatch && method === 'POST') return playback(req, env, playbackMatch[1]);

    return new Response('Not found', { status: 404 });
  },
};

async function listRequests(req: Request, env: Env, slug: string) {
  const ev = await eventForSlug(env, slug);
  if (!ev) return json({ error: 'Event not found' }, 404);
  if (!(await requireHost(req, env, ev.id))) return json({ error: 'Unauthorized' }, 401);

  const { results } = await env.DB.prepare(`
    SELECT r.*, p.provider AS payment_provider, p.status AS boost_payment_status
    FROM song_requests r
    LEFT JOIN boost_payments p ON p.request_id=r.id
    WHERE r.event_id=? AND r.playback_status NOT IN ('played','skipped') AND r.review_status!='declined'
    ORDER BY
      CASE r.playback_status WHEN 'playing' THEN -2 WHEN 'queued' THEN -1 ELSE 0 END,
      CASE
        WHEN r.payment_status='paid' AND r.tier='front_10' THEN 0
        WHEN r.payment_status='paid' AND r.tier='priority_5' THEN 1
        ELSE 2
      END,
      r.queue_rank ASC
  `)
    .bind(ev.id)
    .all<any>();

  const pendingCashApp = (results || []).filter((r: any) => r.payment_provider === 'cashapp_direct' && r.payment_status === 'pending').length;
  return json({
    event: {
      id: ev.id,
      slug: ev.slug,
      couple_names: ev.couple_names,
      status: ev.status,
      spotify_connected: Boolean(ev.spotify_access_token || ev.spotify_refresh_token),
    },
    requests: results || [],
    pending_cashapp: pendingCashApp,
  });
}

async function createRequest(req: Request, env: Env, slug: string) {
  const ev = await eventForSlug(env, slug);
  if (!ev) return json({ error: 'Event not found' }, 404);
  if (ev.status === 'closed') return json({ error: 'Song requests are closed.' }, 403);
  if (ev.status === 'paused') return json({ error: 'Song requests are paused for a special moment.' }, 403);

  const token = parseCookies(req).guest || uuid();
  const body = (await req.json()) as any;
  const title = String(body.title || '').trim();
  const artist = String(body.artist || '').trim();
  const requestedTier = String(body.tier || 'free');
  const tier: RequestTier = ['free', 'priority_5', 'front_10'].includes(requestedTier) ? (requestedTier as RequestTier) : 'free';
  const explicit = body.explicit ? 1 : 0;
  const duration = Number(body.duration_ms) || null;

  if (!title || !artist) return json({ error: 'Please enter a song title and artist.' }, 400);
  if (ev.explicit_allowed === 0 && explicit) return json({ error: 'This wedding is accepting clean music only.' }, 400);
  if (duration && duration > ev.max_track_ms) return json({ error: 'That song is longer than this event allows.' }, 400);

  const count = await env.DB.prepare(`
    SELECT COUNT(*) AS c FROM song_requests
    WHERE event_id=? AND guest_token=? AND playback_status IN ('unplayed','queued','playing') AND review_status!='declined'
  `)
    .bind(ev.id, token)
    .first<{ c: number }>();
  if ((count?.c || 0) >= ev.guest_request_limit) {
    return json({ error: `You already have ${ev.guest_request_limit} active request(s). Please wait until one plays.` }, 429);
  }

  const block = await env.DB.prepare(`
    SELECT 1 FROM blocked_music
    WHERE event_id=? AND ((kind='track' AND value_normalized=?) OR (kind='artist' AND value_normalized=?))
  `)
    .bind(ev.id, normalize(title), normalize(artist))
    .first();
  if (block) return json({ error: 'That selection is not available for this event.' }, 400);

  const duplicate = await env.DB.prepare(`
    SELECT id FROM song_requests
    WHERE event_id=? AND lower(track_title)=lower(?) AND lower(track_artist)=lower(?)
      AND review_status!='declined' AND playback_status NOT IN ('played','skipped')
  `)
    .bind(ev.id, title, artist)
    .first<{ id: string }>();
  if (duplicate) return json({ error: 'Good news — that song is already in the live request queue.' }, 409);

  const max = await env.DB.prepare('SELECT COALESCE(MAX(queue_rank),0) AS n FROM song_requests WHERE event_id=?')
    .bind(ev.id)
    .first<{ n: number }>();
  const id = uuid();
  const boostCode = tier === 'free' ? null : shortCode();
  const paymentStatus: PaymentStatus = tier === 'free' ? 'not_required' : 'pending';

  await env.DB.prepare(`
    INSERT INTO song_requests (
      id,event_id,guest_token,guest_name,guest_message,track_title,track_artist,track_album,track_artwork_url,
      provider,provider_track_id,provider_uri,duration_ms,explicit,tier,payment_status,boost_code,queue_rank
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `)
    .bind(
      id,
      ev.id,
      token,
      String(body.guest_name || '').slice(0, 60) || null,
      String(body.message || '').slice(0, 240) || null,
      title.slice(0, 180),
      artist.slice(0, 180),
      String(body.album || '').slice(0, 180) || null,
      String(body.artwork_url || '').slice(0, 500) || null,
      String(body.provider || 'manual').slice(0, 30),
      String(body.provider_track_id || '').slice(0, 150) || null,
      String(body.provider_uri || '').slice(0, 250) || null,
      duration,
      explicit,
      tier,
      paymentStatus,
      boostCode,
      (max?.n || 0) + 1,
    )
    .run();

  const created = await env.DB.prepare('SELECT * FROM song_requests WHERE id=?').bind(id).first<SongRequest>();
  await broadcast(env, ev.id, { type: 'request_created', id });

  return json(
    {
      request: created,
      boost_required: tier !== 'free',
      boost_url: tier === 'free' ? null : `/boost/${id}`,
    },
    { status: 201, headers: { 'Set-Cookie': cookie('guest', token, 60 * 60 * 24 * 2, isSecure(req)) } },
  );
}

async function guestOwnedRequest(req: Request, env: Env, id: string) {
  const token = parseCookies(req).guest;
  if (!token) return null;
  return env.DB.prepare(`
    SELECT r.*, e.slug, e.couple_names, e.cashapp_url, e.cashapp_qr_image_url
    FROM song_requests r JOIN events e ON e.id=r.event_id
    WHERE r.id=? AND r.guest_token=?
  `)
    .bind(id, token)
    .first<any>();
}

async function boostPage(req: Request, env: Env, id: string) {
  const r = await guestOwnedRequest(req, env, id);
  if (!r) return html(boostUnavailable(), 'Boost unavailable');
  if (r.tier === 'free') return redirect(`/e/${r.slug}`);

  const ev = await eventForSlug(env, r.slug);
  if (!ev) return html(notFound());
  return html(
    boostPaymentPage(r, {
      cashappUrl: cashAppUrl(env, ev),
      cashappQrUrl: cashAppQrUrl(env, ev),
      squareEnabled: squareConfigured(env),
    }),
    `${tierLabel(r.tier)} · The Wedding DJ`,
  );
}

async function boostStatus(req: Request, env: Env, id: string) {
  const r = await guestOwnedRequest(req, env, id);
  if (!r) return json({ error: 'Not found' }, 404);
  const payment = await env.DB.prepare('SELECT provider,status FROM boost_payments WHERE request_id=?').bind(id).first<any>();
  return json({ payment_status: r.payment_status, provider: payment?.provider || null, provider_status: payment?.status || null });
}

async function cashAppPaid(req: Request, env: Env, id: string) {
  const r = await guestOwnedRequest(req, env, id);
  if (!r) return json({ error: 'Not found' }, 404);
  if (r.tier === 'free') return json({ error: 'This request does not need a boost payment.' }, 400);
  if (r.payment_status === 'paid') return json({ ok: true, already_paid: true });
  const ev = await eventForSlug(env, r.slug);
  if (!ev || !cashAppUrl(env, ev)) return json({ error: 'Cash App has not been configured for this wedding yet.' }, 503);

  const amount = boostAmount(r.tier);
  await env.DB.prepare(`
    INSERT INTO boost_payments (id,event_id,request_id,provider,amount_cents,status,confirmation_code,created_at,updated_at)
    VALUES (?,?,?,?,?,'pending',?,?,?)
    ON CONFLICT(request_id) DO UPDATE SET
      provider='cashapp_direct', amount_cents=excluded.amount_cents,
      status=CASE WHEN boost_payments.status='paid' THEN 'paid' ELSE 'pending' END,
      provider_reference=NULL, provider_order_id=NULL, updated_at=excluded.updated_at
  `)
    .bind(uuid(), r.event_id, r.id, 'cashapp_direct', amount, r.boost_code, now(), now())
    .run();

  await env.DB.prepare(`UPDATE song_requests SET payment_status='pending',updated_at=? WHERE id=? AND payment_status!='paid'`)
    .bind(now(), r.id)
    .run();
  await broadcast(env, r.event_id, { type: 'cashapp_pending', id: r.id });
  return json({ ok: true, confirmation_code: r.boost_code });
}

async function squareCheckout(req: Request, env: Env, id: string) {
  const r = await guestOwnedRequest(req, env, id);
  if (!r) return json({ error: 'Not found' }, 404);
  if (r.tier === 'free') return json({ error: 'This request does not need a boost payment.' }, 400);
  if (r.payment_status === 'paid') return json({ error: 'This boost is already paid.' }, 409);
  if (!squareConfigured(env)) return json({ error: 'Apple Pay, Google Pay, and card checkout are not configured yet.' }, 503);

  const amount = boostAmount(r.tier);
  const endpoint = env.SQUARE_ENVIRONMENT === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';
  const payload = {
    idempotency_key: `weddingdj-${r.id}`,
    description: `${tierLabel(r.tier)} for ${r.track_title} — ${r.track_artist}`,
    quick_pay: {
      name: `${tierLabel(r.tier)} · ${r.track_title}`.slice(0, 120),
      price_money: { amount, currency: 'USD' },
      location_id: env.SQUARE_LOCATION_ID,
    },
    checkout_options: {
      allow_tipping: false,
      redirect_url: `${appUrl(env, req)}/boost/${r.id}?square=return`,
      accepted_payment_methods: {
        apple_pay: true,
        google_pay: true,
        cash_app_pay: false,
        afterpay_clearpay: false,
      },
    },
    payment_note: `Wedding DJ ${r.boost_code} | request ${r.id}`,
  };

  const res = await fetch(`${endpoint}/v2/online-checkout/payment-links`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
      'Square-Version': SQUARE_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data: any = await res.json();
  if (!res.ok || !data.payment_link?.url) {
    return json({ error: data.errors?.[0]?.detail || 'Could not start wallet/card checkout.' }, 502);
  }

  await env.DB.prepare(`
    INSERT INTO boost_payments (
      id,event_id,request_id,provider,provider_reference,provider_order_id,amount_cents,status,confirmation_code,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,'pending',?,?,?)
    ON CONFLICT(request_id) DO UPDATE SET
      provider='square', provider_reference=excluded.provider_reference, provider_order_id=excluded.provider_order_id,
      amount_cents=excluded.amount_cents, status=CASE WHEN boost_payments.status='paid' THEN 'paid' ELSE 'pending' END,
      updated_at=excluded.updated_at
  `)
    .bind(
      uuid(),
      r.event_id,
      r.id,
      'square',
      data.payment_link.id,
      data.payment_link.order_id,
      amount,
      r.boost_code,
      now(),
      now(),
    )
    .run();

  return json({ url: data.payment_link.url });
}

async function squareWebhook(req: Request, env: Env) {
  if (!env.SQUARE_WEBHOOK_SIGNATURE_KEY) return new Response('Webhook unavailable', { status: 503 });
  const raw = await req.text();
  const signature = req.headers.get('x-square-hmacsha256-signature') || '';
  const notificationUrl = `${appUrl(env, req)}/api/square/webhook`;
  if (!(await verifySquareSignature(raw, signature, env.SQUARE_WEBHOOK_SIGNATURE_KEY, notificationUrl))) {
    return new Response('Invalid signature', { status: 403 });
  }

  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  if (event.event_id) {
    const seen = await env.DB.prepare('SELECT 1 FROM webhook_events WHERE id=?').bind(event.event_id).first();
    if (seen) return new Response('ok');
  }

  if (event.type === 'payment.created' || event.type === 'payment.updated') {
    const payment = event.data?.object?.payment;
    const orderId = payment?.order_id;
    if (orderId) {
      const boost = await env.DB.prepare('SELECT * FROM boost_payments WHERE provider=? AND provider_order_id=?')
        .bind('square', orderId)
        .first<any>();
      if (boost) {
        if (payment.status === 'COMPLETED') {
          await markBoostPaid(env, boost.request_id, boost.event_id, 'square', payment.id || null, null);
        } else if (['FAILED', 'CANCELED'].includes(payment.status)) {
          await env.DB.prepare(`UPDATE boost_payments SET status='failed',provider_payment_id=?,updated_at=? WHERE id=?`)
            .bind(payment.id || null, now(), boost.id)
            .run();
          await env.DB.prepare(`UPDATE song_requests SET payment_status='failed',updated_at=? WHERE id=? AND payment_status!='paid'`)
            .bind(now(), boost.request_id)
            .run();
          await broadcast(env, boost.event_id, { type: 'payment_failed', id: boost.request_id });
        }
      }
    }
  }

  if (event.event_id) {
    await env.DB.prepare('INSERT OR IGNORE INTO webhook_events (id,provider,created_at) VALUES (?,?,?)')
      .bind(event.event_id, 'square', now())
      .run();
  }
  return new Response('ok');
}

async function verifySquareSignature(raw: string, signature: string, secret: string, notificationUrl: string) {
  if (!signature) return false;
  let sigBytes: Uint8Array;
  try {
    const binary = atob(signature);
    sigBytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(notificationUrl + raw));
}

async function markBoostPaid(
  env: Env,
  requestId: string,
  eventId: string,
  provider: 'square' | 'cashapp_direct',
  providerPaymentId: string | null,
  confirmedBy: string | null,
) {
  await env.DB.prepare(`
    UPDATE boost_payments SET status='paid',provider_payment_id=COALESCE(?,provider_payment_id),confirmed_by_user_id=?,updated_at=?
    WHERE request_id=?
  `)
    .bind(providerPaymentId, confirmedBy, now(), requestId)
    .run();
  await env.DB.prepare(`UPDATE song_requests SET payment_status='paid',review_status='approved',updated_at=? WHERE id=?`)
    .bind(now(), requestId)
    .run();
  await broadcast(env, eventId, { type: 'payment_confirmed', id: requestId, provider });
}

async function requestAction(req: Request, env: Env, id: string) {
  const r = await env.DB.prepare('SELECT * FROM song_requests WHERE id=?').bind(id).first<SongRequest>();
  if (!r) return json({ error: 'Request not found' }, 404);
  const host = await requireHost(req, env, r.event_id);
  if (!host) return json({ error: 'Unauthorized' }, 401);

  const body = (await req.json()) as any;
  const action = String(body.action || '');
  const allowed = [
    'play_next',
    'defer',
    'decline',
    'played',
    'skip',
    'block_artist',
    'block_track',
    'confirm_cashapp',
    'reject_cashapp',
  ];
  if (!allowed.includes(action)) return json({ error: 'Invalid action' }, 400);

  if (action === 'confirm_cashapp') {
    const payment = await env.DB.prepare(`SELECT * FROM boost_payments WHERE request_id=? AND provider='cashapp_direct'`)
      .bind(id)
      .first<any>();
    if (!payment) return json({ error: 'No Cash App payment is awaiting confirmation for this request.' }, 409);
    await markBoostPaid(env, id, r.event_id, 'cashapp_direct', null, host.user_id);
    await audit(env, r.event_id, host.user_id, action, 'song_request', id, `Confirmed ${r.boost_code || ''}`);
    return json({ ok: true });
  }

  if (action === 'reject_cashapp') {
    await env.DB.prepare(`UPDATE boost_payments SET status='failed',confirmed_by_user_id=?,updated_at=? WHERE request_id=? AND provider='cashapp_direct'`)
      .bind(host.user_id, now(), id)
      .run();
    await env.DB.prepare(`UPDATE song_requests SET payment_status='failed',updated_at=? WHERE id=? AND payment_status!='paid'`)
      .bind(now(), id)
      .run();
    await audit(env, r.event_id, host.user_id, action, 'song_request', id, `Rejected ${r.boost_code || ''}`);
    await broadcast(env, r.event_id, { type: 'cashapp_rejected', id });
    return json({ ok: true });
  }

  if (action === 'block_artist' || action === 'block_track') {
    const kind = action === 'block_artist' ? 'artist' : 'track';
    const label = kind === 'artist' ? r.track_artist : r.track_title;
    await env.DB.prepare('INSERT OR IGNORE INTO blocked_music (id,event_id,kind,value_normalized,label) VALUES (?,?,?,?,?)')
      .bind(uuid(), r.event_id, kind, normalize(label), label)
      .run();
    await env.DB.prepare(`UPDATE song_requests SET review_status='declined',updated_at=? WHERE id=?`).bind(now(), id).run();
  } else if (action === 'defer') {
    const max = await env.DB.prepare('SELECT COALESCE(MAX(queue_rank),0) AS n FROM song_requests WHERE event_id=?')
      .bind(r.event_id)
      .first<{ n: number }>();
    await env.DB.prepare(`UPDATE song_requests SET review_status='deferred',queue_rank=?,updated_at=? WHERE id=?`)
      .bind((max?.n || 0) + 1, now(), id)
      .run();
  } else {
    let playback = r.playback_status;
    let review = r.review_status;
    if (action === 'play_next') playback = 'queued';
    if (action === 'decline') review = 'declined';
    if (action === 'played') playback = 'played';
    if (action === 'skip') playback = 'skipped';
    await env.DB.prepare('UPDATE song_requests SET playback_status=?,review_status=?,updated_at=? WHERE id=?')
      .bind(playback, review, now(), id)
      .run();
    if (action === 'play_next') await sendSpotifyNext(env, r);
  }

  await audit(env, r.event_id, host.user_id, action, 'song_request', id);
  await broadcast(env, r.event_id, { type: 'request_changed', id, action });
  return json({ ok: true });
}

async function audit(
  env: Env,
  eventId: string,
  actorUserId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  detail: string | null = null,
) {
  await env.DB.prepare('INSERT INTO audit_log (id,event_id,actor_user_id,action,entity_type,entity_id,detail) VALUES (?,?,?,?,?,?,?)')
    .bind(uuid(), eventId, actorUserId, action, entityType, entityId, detail)
    .run();
}

async function setEventStatus(req: Request, env: Env, slug: string) {
  const ev = await eventForSlug(env, slug);
  if (!ev) return json({ error: 'Event not found' }, 404);
  const host = await requireHost(req, env, ev.id);
  if (!host) return json({ error: 'Unauthorized' }, 401);
  const body = (await req.json()) as any;
  const status = String(body.status || '') as EventStatus;
  if (!['active', 'paused', 'closed'].includes(status)) return json({ error: 'Invalid status' }, 400);
  await env.DB.prepare('UPDATE events SET status=?,updated_at=? WHERE id=?').bind(status, now(), ev.id).run();
  await audit(env, ev.id, host.user_id, `event_${status}`, 'event', ev.id);
  await broadcast(env, ev.id, { type: 'event_status', status });
  return json({ ok: true, status });
}

async function createHost(req: Request, env: Env, slug: string) {
  const ev = await eventForSlug(env, slug);
  if (!ev) return json({ error: 'Event not found' }, 404);
  const host = await requireHost(req, env, ev.id);
  if (!host) return json({ error: 'Unauthorized' }, 401);
  const body = (await req.json()) as any;
  const email = String(body.email || '').trim().toLowerCase();
  const name = String(body.name || '').trim();
  const password = String(body.password || '');
  if (!email || !name || password.length < 10) {
    return json({ error: 'Use a valid email, name, and a password of at least 10 characters.' }, 400);
  }

  let user = await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first<{ id: string }>();
  if (!user) {
    const id = uuid();
    const salt = randomHex();
    await env.DB.prepare('INSERT INTO users (id,email,display_name,password_hash,password_salt) VALUES (?,?,?,?,?)')
      .bind(id, email, name.slice(0, 80), await hashPassword(password, salt, env.SESSION_SECRET), salt)
      .run();
    user = { id };
  }
  await env.DB.prepare('INSERT OR IGNORE INTO event_hosts (event_id,user_id) VALUES (?,?)').bind(ev.id, user.id).run();
  await audit(env, ev.id, host.user_id, 'host_added', 'user', user.id, email);
  return json({ ok: true });
}

async function spotifyStart(req: Request, env: Env) {
  if (!env.SPOTIFY_CLIENT_ID) return new Response('Spotify is not configured', { status: 503 });
  const slug = new URL(req.url).searchParams.get('event') || 'michael-marisa';
  const ev = await eventForSlug(env, slug);
  if (!ev || !(await requireHost(req, env, ev.id))) return redirect('/auth/login');
  const state = await makeSignedState({ slug, exp: Date.now() + 10 * 60 * 1000, nonce: uuid() }, env.SESSION_SECRET);
  const params = new URLSearchParams({
    client_id: env.SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: `${appUrl(env, req)}/auth/spotify/callback`,
    scope: 'user-read-playback-state user-modify-playback-state user-read-currently-playing user-read-private',
    state,
  });
  return redirect(`https://accounts.spotify.com/authorize?${params}`);
}

async function spotifyCallback(req: Request, env: Env) {
  const u = new URL(req.url);
  const code = u.searchParams.get('code');
  const state = u.searchParams.get('state');
  if (!code || !state || !env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) {
    return new Response('Spotify authorization failed', { status: 400 });
  }
  const parsed = await readSignedState(state, env.SESSION_SECRET);
  if (!parsed || typeof parsed.slug !== 'string' || Number(parsed.exp) < Date.now()) {
    return new Response('Invalid or expired OAuth state', { status: 400 });
  }
  const ev = await eventForSlug(env, parsed.slug);
  if (!ev || !(await requireHost(req, env, ev.id))) return new Response('Unauthorized', { status: 401 });

  const basic = btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: `${appUrl(env, req)}/auth/spotify/callback`,
  });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const tok: any = await res.json();
  if (!res.ok) return new Response(esc(tok.error_description || 'Token exchange failed'), { status: 502 });

  await env.DB.prepare(`
    UPDATE events SET spotify_access_token=?,spotify_refresh_token=COALESCE(?,spotify_refresh_token),spotify_token_expires_at=?,updated_at=? WHERE id=?
  `)
    .bind(tok.access_token, tok.refresh_token || null, Date.now() + Number(tok.expires_in || 3600) * 1000 - 60_000, now(), ev.id)
    .run();
  return redirect(`/dashboard/${ev.slug}`);
}

async function spotifyAccessToken(env: Env, ev: EventRow) {
  if (ev.spotify_access_token && (!ev.spotify_token_expires_at || ev.spotify_token_expires_at > Date.now())) {
    return ev.spotify_access_token;
  }
  if (!ev.spotify_refresh_token || !env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) return null;
  const basic = btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`);
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: ev.spotify_refresh_token });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const tok: any = await res.json();
  if (!res.ok || !tok.access_token) return null;
  await env.DB.prepare(`UPDATE events SET spotify_access_token=?,spotify_token_expires_at=?,updated_at=? WHERE id=?`)
    .bind(tok.access_token, Date.now() + Number(tok.expires_in || 3600) * 1000 - 60_000, now(), ev.id)
    .run();
  return tok.access_token as string;
}

async function spotifySearch(req: Request, env: Env) {
  const u = new URL(req.url);
  const q = u.searchParams.get('q')?.trim();
  if (!q) return json({ tracks: [] });
  const ev = await eventForSlug(env, u.searchParams.get('event') || 'michael-marisa');
  if (!ev) return json({ tracks: [] });
  const token = await spotifyAccessToken(env, ev);
  if (!token) return json({ tracks: [], spotify_connected: false });
  const res = await fetch(`https://api.spotify.com/v1/search?${new URLSearchParams({ q, type: 'track', limit: '8' })}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return json({ tracks: [] });
  const data: any = await res.json();
  return json({
    tracks: (data.tracks?.items || []).map((x: any) => ({
      title: x.name,
      artist: x.artists.map((a: any) => a.name).join(', '),
      album: x.album?.name || '',
      duration_ms: x.duration_ms,
      explicit: x.explicit,
      artwork_url: x.album?.images?.[1]?.url || x.album?.images?.[0]?.url || '',
      provider: 'spotify',
      provider_track_id: x.id,
      provider_uri: x.uri,
    })),
  });
}

async function sendSpotifyNext(env: Env, r: SongRequest) {
  if (!r.provider_uri) return false;
  const ev = await env.DB.prepare('SELECT * FROM events WHERE id=?').bind(r.event_id).first<EventRow>();
  if (!ev) return false;
  const token = await spotifyAccessToken(env, ev);
  if (!token) return false;
  const res = await fetch(`https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(r.provider_uri)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.ok;
}

async function playback(req: Request, env: Env, slug: string) {
  const ev = await eventForSlug(env, slug);
  if (!ev || !(await requireHost(req, env, ev.id))) return json({ error: 'Unauthorized' }, 401);
  const { action } = (await req.json()) as any;
  const token = await spotifyAccessToken(env, ev);
  if (!token) return json({ error: 'Spotify not connected' }, 400);
  const map: Record<string, [string, string]> = {
    pause: ['PUT', '/v1/me/player/pause'],
    resume: ['PUT', '/v1/me/player/play'],
    next: ['POST', '/v1/me/player/next'],
  };
  if (!map[action]) return json({ error: 'Invalid action' }, 400);
  const [method, path] = map[action];
  const res = await fetch(`https://api.spotify.com${path}`, { method, headers: { Authorization: `Bearer ${token}` } });
  return json({ ok: res.ok }, res.ok ? 200 : 502);
}

function base64UrlEncode(text: string) {
  const bytes = enc.encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(text: string) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

async function hmacBase64Url(text: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
  let binary = '';
  for (const b of sig) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function makeSignedState(payload: unknown, secret: string) {
  const body = base64UrlEncode(JSON.stringify(payload));
  return `${body}.${await hmacBase64Url(body, secret)}`;
}

async function readSignedState(state: string, secret: string) {
  const [body, signature] = state.split('.');
  if (!body || !signature) return null;
  const expected = await hmacBase64Url(body, secret);
  if (expected.length !== signature.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    return JSON.parse(base64UrlDecode(body));
  } catch {
    return null;
  }
}

async function login(req: Request, env: Env) {
  const form = await req.formData();
  const email = String(form.get('email') || '').trim().toLowerCase();
  const password = String(form.get('password') || '');
  const next = String(form.get('next') || '/dashboard/michael-marisa');
  const user = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first<any>();
  if (!user || user.password_hash !== (await hashPassword(password, user.password_salt, env.SESSION_SECRET))) {
    return html(loginPage(next, 'Incorrect email or password.'), 'Sign in');
  }
  const sid = uuid();
  await env.DB.prepare('INSERT INTO sessions (id,user_id,expires_at) VALUES (?,?,?)')
    .bind(sid, user.id, Date.now() + 1000 * 60 * 60 * 24 * 14)
    .run();
  return redirect(next, { 'Set-Cookie': cookie('session', sid, 60 * 60 * 24 * 14, isSecure(req)) });
}

async function setup(req: Request, env: Env) {
  const existing = await env.DB.prepare('SELECT COUNT(*) AS c FROM users').first<{ c: number }>();
  if ((existing?.c || 0) > 0) return redirect('/auth/login');
  const f = await req.formData();
  const email = String(f.get('email') || '').trim().toLowerCase();
  const name = String(f.get('name') || '').trim();
  const password = String(f.get('password') || '');
  if (!email || !name || password.length < 10) {
    return html(setupPage('Use a valid email, name, and a password of at least 10 characters.'));
  }
  const id = uuid();
  const salt = randomHex();
  await env.DB.prepare('INSERT INTO users (id,email,display_name,password_hash,password_salt) VALUES (?,?,?,?,?)')
    .bind(id, email, name.slice(0, 80), await hashPassword(password, salt, env.SESSION_SECRET), salt)
    .run();
  await env.DB.prepare('INSERT OR IGNORE INTO event_hosts (event_id,user_id) VALUES (?,?)').bind('evt_michael_marisa', id).run();
  const sid = uuid();
  await env.DB.prepare('INSERT INTO sessions (id,user_id,expires_at) VALUES (?,?,?)')
    .bind(sid, id, Date.now() + 1000 * 60 * 60 * 24 * 14)
    .run();
  return redirect('/dashboard/michael-marisa', { 'Set-Cookie': cookie('session', sid, 60 * 60 * 24 * 14, isSecure(req)) });
}

export class WeddingRoom implements DurableObject {
  private clients = new Set<WebSocket>();

  constructor(private state: DurableObjectState, private env: Env) {
    void this.state;
    void this.env;
  }

  async fetch(req: Request) {
    const u = new URL(req.url);
    if (u.pathname === '/ws') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();
      this.clients.add(server);
      server.addEventListener('close', () => this.clients.delete(server));
      server.send(JSON.stringify({ type: 'connected' }));
      return new Response(null, { status: 101, webSocket: client });
    }
    if (u.pathname === '/internal/broadcast' && req.method === 'POST') {
      const msg = await req.text();
      for (const socket of this.clients) {
        try {
          socket.send(msg);
        } catch {
          this.clients.delete(socket);
        }
      }
      return new Response('ok');
    }
    return new Response('Not found', { status: 404 });
  }
}

function guestPage(ev: EventRow) {
  return `<main class="guest">
    <div class="monogram">WD</div>
    <p class="eyebrow">THE WEDDING DJ</p>
    <h1>${esc(ev.couple_names)}</h1>
    <p class="lede">${esc(ev.welcome_message)}</p>
    <div id="notice"></div>
    <section class="card">
      <label>Find a song<input id="search" autocomplete="off" placeholder="Song title or artist"></label>
      <div id="results" class="results"></div>
      <div class="or">or enter it manually</div>
      <label>Song title<input id="title" maxlength="180" placeholder="e.g. September"></label>
      <label>Artist<input id="artist" maxlength="180" placeholder="e.g. Earth, Wind & Fire"></label>
      <label>Your name <span class="muted">optional</span><input id="guestName" maxlength="60" placeholder="Your first name"></label>
      <label>Message for the couple <span class="muted">optional</span><input id="message" maxlength="240" placeholder="Dance floor energy!"></label>
      <div class="tiers">
        <button type="button" class="tier selected" data-tier="free"><b>Free Request</b><small>Join the request queue</small></button>
        <button type="button" class="tier" data-tier="priority_5"><b>Priority Request · $5</b><small>Moves ahead of free requests after payment is confirmed</small></button>
        <button type="button" class="tier" data-tier="front_10"><b>Jump to Front · $10</b><small>Top boost tier after payment is confirmed</small></button>
      </div>
      <button id="submit" type="button" class="primary">Add song request</button>
      <p class="fine">Boosting adds queue priority; it never guarantees that a song will be played.</p>
    </section>
  </main>
  <script>
    const slug=${JSON.stringify(ev.slug)};
    let tier='free', selected={};
    const $=s=>document.querySelector(s);
    const h=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
    document.querySelectorAll('.tier').forEach(b=>b.onclick=()=>{
      document.querySelectorAll('.tier').forEach(x=>x.classList.remove('selected'));
      b.classList.add('selected');
      tier=b.dataset.tier;
      $('#submit').textContent=tier==='free'?'Add song request':'Continue to boost options';
    });
    let timer;
    $('#search').oninput=e=>{
      clearTimeout(timer);
      timer=setTimeout(async()=>{
        const q=e.target.value.trim();
        if(q.length<3){$('#results').innerHTML='';return;}
        const d=await fetch('/api/spotify/search?event='+encodeURIComponent(slug)+'&q='+encodeURIComponent(q)).then(r=>r.json());
        window.tracks=d.tracks||[];
        $('#results').innerHTML=window.tracks.map((t,i)=>'<button type="button" class="result" data-i="'+i+'"><b>'+h(t.title)+'</b> <span>— '+h(t.artist)+(t.explicit?' · Explicit':'')+'</span></button>').join('');
        document.querySelectorAll('.result').forEach(b=>b.onclick=()=>{
          selected=window.tracks[+b.dataset.i];
          $('#title').value=selected.title;
          $('#artist').value=selected.artist;
          $('#results').innerHTML='<p class="chosen">Selected: '+h(selected.title)+' — '+h(selected.artist)+'</p>';
        });
      },300);
    };
    $('#submit').onclick=async()=>{
      $('#submit').disabled=true;
      const payload={title:$('#title').value,artist:$('#artist').value,guest_name:$('#guestName').value,message:$('#message').value,tier,...selected};
      const r=await fetch('/api/events/'+slug+'/requests',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
      const d=await r.json();
      $('#submit').disabled=false;
      if(!r.ok){$('#notice').innerHTML='<div class="error">'+h(d.error)+'</div>';return;}
      if(d.boost_required){location.href=d.boost_url;return;}
      $('#notice').innerHTML='<div class="success">Your song request is in. See you on the dance floor!</div>';
      $('#title').value=$('#artist').value=$('#guestName').value=$('#message').value=''; selected={};
    };
  </script>`;
}

function boostPaymentPage(r: any, config: { cashappUrl: string; cashappQrUrl: string; squareEnabled: boolean }) {
  const amount = boostAmount(r.tier);
  const amountText = `$${(amount / 100).toFixed(0)}`;
  const paid = r.payment_status === 'paid';
  const cashAppSection = config.cashappUrl
    ? `<div class="pay-option">
        <h3>Cash App · direct to the couple</h3>
        <p>Send <b>${amountText}</b> and include <code>DJ-${esc(r.boost_code)}</code> in the payment note.</p>
        ${config.cashappQrUrl ? `<img class="cash-qr" src="${esc(config.cashappQrUrl)}" alt="Cash App QR code">` : '<p class="fine">The Cash App QR image still needs to be configured. The direct Cash App button below already uses the configured Cash App link.</p>'}
        <div class="pay-actions"><a class="button cash" href="${esc(config.cashappUrl)}" target="_blank" rel="noopener">Open Cash App</a><button id="cashPaid" type="button" class="button">I sent the Cash App payment</button></div>
      </div>`
    : `<div class="pay-option disabled"><h3>Cash App</h3><p>The couple's Cash App link has not been configured yet.</p></div>`;

  const squareSection = config.squareEnabled
    ? `<div class="pay-option"><h3>Apple Pay, Google Pay, or card</h3><p>Use Square's hosted checkout. Cash App stays separate so direct Cash App gifts go to the couple's Cash App link.</p><button id="squarePay" type="button" class="button wallet">Continue to wallet/card checkout</button></div>`
    : `<div class="pay-option disabled"><h3>Apple Pay / Google Pay / card</h3><p>Wallet/card checkout will appear after Square is connected. Cash App can still work independently.</p></div>`;

  return `<main class="guest">
    <p class="eyebrow">SONG BOOST</p>
    <h1>${esc(tierLabel(r.tier))}</h1>
    <p class="lede"><b>${esc(r.track_title)}</b> — ${esc(r.track_artist)}</p>
    <section class="card">
      <div id="payNotice">${paid ? '<div class="success">Payment confirmed. Your boost is active.</div>' : ''}</div>
      <p class="code-line">Payment note code: <code>DJ-${esc(r.boost_code)}</code></p>
      ${paid ? '' : squareSection + cashAppSection}
      <a class="button ghost full" href="/e/${esc(r.slug)}">Back to wedding requests</a>
      <p class="fine">A boost changes queue priority only after payment is confirmed. The couple/DJ keeps final control of what plays.</p>
    </section>
  </main>
  <script>
    const requestId=${JSON.stringify(r.id)};
    const h=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
    const cash=document.querySelector('#cashPaid');
    if(cash) cash.onclick=async()=>{
      cash.disabled=true;
      const res=await fetch('/api/requests/'+requestId+'/cashapp-paid',{method:'POST'}),d=await res.json();
      cash.disabled=false;
      document.querySelector('#payNotice').innerHTML=res.ok?'<div class="success">Marked as sent. The couple/DJ will confirm it from their dashboard.</div>':'<div class="error">'+h(d.error)+'</div>';
    };
    const square=document.querySelector('#squarePay');
    if(square) square.onclick=async()=>{
      square.disabled=true;
      const res=await fetch('/api/requests/'+requestId+'/square-checkout',{method:'POST'}),d=await res.json();
      square.disabled=false;
      if(res.ok&&d.url){location.href=d.url;return;}
      document.querySelector('#payNotice').innerHTML='<div class="error">'+h(d.error||'Checkout could not start.')+'</div>';
    };
    async function poll(){
      const res=await fetch('/api/requests/'+requestId+'/boost-status'); if(!res.ok)return;
      const d=await res.json();
      if(d.payment_status==='paid'){
        document.querySelector('#payNotice').innerHTML='<div class="success">Payment confirmed. Your boost is active.</div>';
        document.querySelectorAll('.pay-option').forEach(x=>x.remove());
      }
    }
    setInterval(poll,5000); poll();
  </script>`;
}

function dashboardPage(ev: EventRow, name: string) {
  return `<main class="dash">
    <header>
      <div><p class="eyebrow">THE WEDDING DJ · HOST DASHBOARD</p><h1>${esc(ev.couple_names)}</h1><p>Signed in as ${esc(name)}</p><p id="status" class="status ${esc(ev.status)}">Requests: ${esc(ev.status)}</p></div>
      <div class="head-actions"><a class="button ghost" href="/e/${esc(ev.slug)}" target="_blank">Open guest page</a><form action="/auth/logout" method="post"><button class="button ghost">Sign out</button></form></div>
    </header>
    <section class="player card">
      <div><p class="eyebrow">RECEPTION CONTROL</p><h2>Keep the dance floor moving</h2><p>Pause requests for speeches or special dances, then resume with one tap.</p></div>
      <div class="controls"><button data-play="resume" class="button">Spotify Play</button><button data-play="pause" class="button">Spotify Pause</button><button data-play="next" class="button">Spotify Skip</button><button id="pauseRequests" class="danger">Pause requests</button><button id="closeRequests" class="danger">Close requests</button></div>
    </section>
    <section class="metrics"><div class="card metric"><span>Pending Cash App</span><b id="cashPending">0</b></div><div class="card metric"><span>Queue</span><b id="queueCount">0</b></div></section>
    <section class="queue-grid">
      <div class="card queue"><div class="queue-head"><div><p class="eyebrow">LIVE QUEUE</p><h2>Up next</h2></div><a class="button" href="/auth/spotify/start?event=${esc(ev.slug)}">${ev.spotify_access_token || ev.spotify_refresh_token ? 'Reconnect Spotify' : 'Connect Spotify'}</a></div><div id="queue"><p class="muted">Loading requests…</p></div></div>
      <aside>
        <section class="card"><p class="eyebrow">QUEUE RULES</p><h2>How boosts work</h2><p><b>$10 paid</b> boosts rank first, then <b>$5 paid</b> boosts, then everything else. A pending or failed payment never jumps the queue.</p><p>Cash App payments require one-tap confirmation here. Square payments can confirm automatically by webhook.</p></section>
        <section class="card"><p class="eyebrow">CO-HOST</p><h2>Add another host</h2><label>Name<input id="hostName" placeholder="Michael or Marisa"></label><label>Email<input id="hostEmail" type="email"></label><label>Temporary password<input id="hostPassword" type="password" minlength="10"></label><button id="addHost" class="button full">Add host</button><div id="hostNotice"></div></section>
      </aside>
    </section>
  </main>
  <script>
    const slug=${JSON.stringify(ev.slug)};
    const api='/api/events/'+slug+'/requests';
    let eventStatus=${JSON.stringify(ev.status)};
    const h=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
    function rankLabel(x){if(x.payment_status==='paid'&&x.tier==='front_10')return '$10 BOOST';if(x.payment_status==='paid'&&x.tier==='priority_5')return '$5 BOOST';if(x.payment_provider==='cashapp_direct'&&x.payment_status==='pending')return 'CASH APP?';if(x.tier!=='free'&&x.payment_status==='pending')return 'BOOST PENDING';return 'FREE';}
    async function load(){
      const r=await fetch(api),d=await r.json(); if(!r.ok)return;
      eventStatus=d.event.status;
      document.querySelector('#status').textContent='Requests: '+eventStatus;
      document.querySelector('#status').className='status '+eventStatus;
      document.querySelector('#pauseRequests').textContent=eventStatus==='paused'?'Resume requests':'Pause requests';
      document.querySelector('#cashPending').textContent=d.pending_cashapp||0;
      document.querySelector('#queueCount').textContent=d.requests.length;
      document.querySelector('#queue').innerHTML=d.requests.length?d.requests.map(x=>{
        const cash=x.payment_provider==='cashapp_direct'&&x.payment_status==='pending';
        return '<article class="request"><div class="rank">'+rankLabel(x)+'</div><div class="song"><b>'+h(x.track_title)+'</b><span>'+h(x.track_artist)+'</span><small>'+h(x.guest_name||'Guest')+(x.guest_message?' · '+h(x.guest_message):'')+(x.boost_code?' · DJ-'+h(x.boost_code):'')+'</small></div><div class="request-actions">'+(cash?'<button onclick="act(\''+x.id+'\',\'confirm_cashapp\')">Confirm Cash App</button><button onclick="act(\''+x.id+'\',\'reject_cashapp\')">Not received</button>':'')+'<button onclick="act(\''+x.id+'\',\'play_next\')">Play next</button><button onclick="act(\''+x.id+'\',\'defer\')">Defer</button><button onclick="act(\''+x.id+'\',\'skip\')">Skip</button><button onclick="act(\''+x.id+'\',\'block_artist\')">Block artist</button></div></article>';
      }).join(''):'<p class="muted">No active requests yet.</p>';
    }
    async function act(id,action){await fetch('/api/requests/'+id+'/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action})});load();}
    async function setStatus(status){await fetch('/api/events/'+slug+'/status',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({status})});load();}
    document.querySelector('#pauseRequests').onclick=()=>setStatus(eventStatus==='paused'?'active':'paused');
    document.querySelector('#closeRequests').onclick=()=>setStatus(eventStatus==='closed'?'active':'closed');
    document.querySelectorAll('[data-play]').forEach(b=>b.onclick=()=>fetch('/api/events/'+slug+'/playback',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:b.dataset.play})}));
    document.querySelector('#addHost').onclick=async()=>{
      const res=await fetch('/api/events/'+slug+'/hosts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:document.querySelector('#hostName').value,email:document.querySelector('#hostEmail').value,password:document.querySelector('#hostPassword').value})});
      const d=await res.json();
      document.querySelector('#hostNotice').innerHTML=res.ok?'<div class="success">Host added.</div>':'<div class="error">'+h(d.error)+'</div>';
    };
    const ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/room/'+${JSON.stringify(ev.id)}+'/ws');
    ws.onmessage=()=>load(); load(); setInterval(load,10000);
  </script>`;
}

function loginPage(next: string, error = '') {
  return `<main class="auth"><div class="card"><p class="eyebrow">THE WEDDING DJ</p><h1>Host sign in</h1>${error ? `<div class="error">${esc(error)}</div>` : ''}<form method="post" action="/auth/login"><input type="hidden" name="next" value="${esc(next)}"><label>Email<input required type="email" name="email"></label><label>Password<input required type="password" name="password"></label><button class="primary">Sign in</button></form><p class="fine">First setup only: <a href="/setup">create the first host account</a>.</p></div></main>`;
}

function setupPage(error = '') {
  return `<main class="auth"><div class="card"><p class="eyebrow">THE WEDDING DJ</p><h1>Create the first host</h1><p>This account gets full dashboard access for Michael & Marisa's wedding. After sign-in, add the second host from the dashboard.</p>${error ? `<div class="error">${esc(error)}</div>` : ''}<form method="post" action="/setup"><label>Your name<input required name="name" placeholder="Michael or Marisa"></label><label>Email<input required type="email" name="email"></label><label>Create password<input required minlength="10" type="password" name="password"></label><button class="primary">Create host account</button></form></div></main>`;
}

function boostUnavailable() {
  return `<main class="auth"><div class="card"><h1>Boost link unavailable</h1><p>This boost link belongs to the device that created the song request.</p><a class="button" href="/">Back to wedding requests</a></div></main>`;
}

function notFound() {
  return `<main class="auth"><div class="card"><h1>That wedding page isn't available.</h1><a class="button" href="/">Go to The Wedding DJ</a></div></main>`;
}

const styles = `
:root{--ink:#171719;--cream:#fcfaf6;--paper:#fffdfa;--gold:#bd8b47;--muted:#706d69;--line:#e8e1d8;--red:#a63d32;--green:#1c7b49}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 8% 4%,#f5ecdc,transparent 34%),var(--cream);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.45}
h1,h2,h3{font-family:Georgia,"Times New Roman",serif;line-height:1.08;margin:.2rem 0 .7rem}h1{font-size:clamp(2.1rem,7vw,4.4rem)}h2{font-size:1.55rem}h3{font-size:1.2rem}
.guest{max-width:670px;margin:auto;padding:4.5rem 1.25rem}.dash{max-width:1220px;margin:auto;padding:2.5rem 1.25rem}.auth{min-height:100vh;display:grid;place-items:center;padding:1.25rem}.auth .card{width:min(100%,500px)}
.monogram{width:58px;height:58px;border:1px solid var(--gold);color:var(--gold);display:grid;place-items:center;border-radius:100%;letter-spacing:.1em;margin-bottom:2rem}.eyebrow{letter-spacing:.15em;font-size:.69rem;font-weight:800;color:var(--gold);margin:0 0 .55rem}.lede{font-size:1.15rem;color:var(--muted);max-width:42ch}
.card{background:rgba(255,253,250,.94);border:1px solid var(--line);border-radius:18px;padding:1.25rem;box-shadow:0 12px 35px rgba(55,40,19,.06);margin-top:1.5rem}label{display:block;font-size:.83rem;font-weight:700;margin:1rem 0 .35rem}input{display:block;width:100%;border:1px solid var(--line);border-radius:10px;padding:.86rem;margin-top:.38rem;background:#fff;font:inherit;color:inherit}
button,.button{font:inherit;border:1px solid var(--ink);border-radius:10px;padding:.72rem 1rem;background:var(--paper);color:var(--ink);cursor:pointer;text-decoration:none;display:inline-flex;justify-content:center;align-items:center;gap:.3rem}button:disabled{opacity:.55;cursor:wait}.primary{width:100%;border-color:var(--ink);background:var(--ink);color:#fff;font-weight:800;margin-top:1rem}.full{width:100%}.ghost{border-color:var(--line)}
.tiers{display:grid;gap:.55rem;margin-top:1.1rem}.tier{text-align:left;display:block;border-color:var(--line)}.tier b,.tier small{display:block}.tier small{margin-top:.16rem;color:var(--muted)}.tier.selected{border:2px solid var(--gold);background:#fff7e9}.fine,.muted,small{color:var(--muted);font-size:.83rem}.or{text-align:center;color:var(--muted);font-size:.78rem;margin:1rem}
.results{display:grid;gap:.35rem;margin-top:.45rem}.result{text-align:left;border-color:var(--line);padding:.55rem .7rem}.result span{color:var(--muted);font-size:.85rem}.chosen,.success,.error{padding:.8rem 1rem;border-radius:10px;margin:1rem 0}.success{background:#edf7ed;color:#225b28}.error{background:#fff0ee;color:#8d2d24}
.pay-option{border:1px solid var(--line);border-radius:14px;padding:1rem;margin:1rem 0}.pay-option.disabled{opacity:.68}.pay-actions{display:flex;gap:.6rem;flex-wrap:wrap}.cash{background:#00d64f;border-color:#00b943;color:#072912;font-weight:800}.wallet{font-weight:800}.cash-qr{width:min(260px,100%);display:block;margin:1rem auto;border-radius:14px;border:1px solid var(--line)}.code-line{background:#f8f3eb;border-radius:10px;padding:.8rem}code{word-break:break-word}
.dash header{display:flex;justify-content:space-between;gap:1rem;align-items:start}.head-actions,.controls{display:flex;gap:.55rem;flex-wrap:wrap}.status{display:inline-block;padding:.25rem .55rem;border-radius:99px;background:#eaf3ea;color:#286332;font-size:.82rem}.status.paused{background:#fff3da;color:#80621f}.status.closed{background:#f7e7e5;color:#8d2d24}.player{display:flex;justify-content:space-between;gap:1rem;align-items:center}.danger{border-color:#e7b0aa;color:#8d2d24}.metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.metric span,.metric b{display:block}.metric b{font-size:2rem}
.queue-grid{display:grid;grid-template-columns:1.7fr .8fr;gap:1.25rem}.queue{margin-top:1.5rem}.queue-head{display:flex;justify-content:space-between;gap:.75rem;align-items:center}.request{display:grid;grid-template-columns:82px 1fr auto;gap:.75rem;padding:1rem 0;border-top:1px solid var(--line);align-items:center}.rank{font-size:.7rem;font-weight:900;color:var(--gold);text-align:center}.song b,.song span,.song small{display:block}.request-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:.35rem}.request-actions button{padding:.42rem .55rem;font-size:.77rem;border-color:var(--line)}
@media(max-width:740px){.guest{padding-top:2.6rem}.dash{padding-top:1.25rem}.dash header,.player{display:block}.head-actions{margin-top:1rem}.queue-grid{grid-template-columns:1fr}.request{grid-template-columns:70px 1fr}.request-actions{grid-column:1/-1;justify-content:flex-start}.queue-head{align-items:start;flex-direction:column}.controls{margin-top:1rem}.metrics{grid-template-columns:1fr 1fr}.pay-actions>*{width:100%}}
`;
