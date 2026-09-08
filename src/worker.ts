import worker, { WeddingRoom } from './index';
import type { Env } from './index';

export { WeddingRoom };

const WEDDING_PHOTO_SOURCES = [
  'https://raw.githubusercontent.com/matthagersenior/WeddingDJ/main/download.jpeg',
  'https://raw.githubusercontent.com/matthagersenior/WeddingDJ/main/download%20%281%29.jpeg',
  'https://raw.githubusercontent.com/matthagersenior/WeddingDJ/main/download%20%282%29.jpeg',
  'https://raw.githubusercontent.com/matthagersenior/WeddingDJ/main/download%20%283%29.jpeg',
  'https://raw.githubusercontent.com/matthagersenior/WeddingDJ/main/download%20%284%29.jpeg',
  'https://raw.githubusercontent.com/matthagersenior/WeddingDJ/main/download%20%285%29.jpeg',
] as const;

const photoPath = (index: number) => `/media/wedding/${index}.jpeg`;

function weddingSlides() {
  return WEDDING_PHOTO_SOURCES.map(
    (_, index) =>
      `<figure class="wedding-slide ${index === 0 ? 'active' : ''}" data-slide="${index}"><img src="${photoPath(index)}" alt="Michael and Marisa wedding photo ${index + 1}" ${index === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"></figure>`,
  ).join('');
}

function weddingDots() {
  return WEDDING_PHOTO_SOURCES.map(
    (_, index) =>
      `<button type="button" class="carousel-dot ${index === 0 ? 'active' : ''}" data-dot="${index}" aria-label="Show wedding photo ${index + 1}"></button>`,
  ).join('');
}

function weddingHero(titleHtml: string, ledeHtml: string) {
  return `<section class="wedding-hero" data-carousel="hero" data-interval="5500" aria-label="Michael and Marisa wedding photo carousel">
    <div class="hero-track">${weddingSlides()}</div>
    <div class="hero-shade"></div>
    <div class="hero-content">
      <div class="monogram">M&amp;M</div>
      <p class="eyebrow">THE WEDDING DJ</p>
      <h1>${titleHtml}</h1>
      <p class="lede">${ledeHtml}</p>
      <a class="button hero-cta" href="#song-request">Request a song</a>
    </div>
    <button class="carousel-arrow prev" type="button" data-prev aria-label="Previous wedding photo">‹</button>
    <button class="carousel-arrow next" type="button" data-next aria-label="Next wedding photo">›</button>
    <div class="carousel-dots hero-dots">${weddingDots()}</div>
  </section>`;
}

function weddingGallery() {
  return `<section class="gallery-card card">
    <div class="gallery-copy"><p class="eyebrow">MICHAEL &amp; MARISA</p><h2>A few favorite moments</h2><p class="muted">Swipe, tap the arrows, or let the gallery rotate.</p></div>
    <div class="gallery-carousel" data-carousel="gallery" data-interval="7500" aria-label="Wedding photo gallery">
      <div class="gallery-track">${weddingSlides()}</div>
      <button class="carousel-arrow prev" type="button" data-prev aria-label="Previous gallery photo">‹</button>
      <button class="carousel-arrow next" type="button" data-next aria-label="Next gallery photo">›</button>
      <div class="carousel-dots gallery-dots">${weddingDots()}</div>
    </div>
  </section>`;
}

const PHOTO_CSS = `
<style id="wedding-photo-styles">
.guest-rich{max-width:980px;padding-top:1.25rem}.guest-rich>.monogram,.guest-rich>.eyebrow,.guest-rich>h1,.guest-rich>.lede{display:none}.guest-rich>#notice,.guest-rich>#song-request{max-width:670px;margin-left:auto;margin-right:auto}.wedding-hero{position:relative;min-height:min(72vh,680px);overflow:hidden;border-radius:26px;background:#171719;box-shadow:0 22px 55px rgba(46,31,13,.18);isolation:isolate;margin-bottom:1.5rem}.hero-track,.gallery-track{position:absolute;inset:0}.wedding-slide{position:absolute;inset:0;margin:0;opacity:0;transform:scale(1.025);transition:opacity .8s ease,transform 1.2s ease;pointer-events:none}.wedding-slide.active{opacity:1;transform:scale(1);pointer-events:auto}.wedding-slide img{width:100%;height:100%;display:block}.hero-track .wedding-slide img{object-fit:cover}.hero-shade{position:absolute;inset:0;z-index:1;background:linear-gradient(180deg,rgba(0,0,0,.08) 15%,rgba(0,0,0,.2) 48%,rgba(0,0,0,.72) 100%)}.hero-content{position:absolute;z-index:2;left:clamp(1.2rem,5vw,3.5rem);right:clamp(1.2rem,5vw,3.5rem);bottom:3.6rem;color:#fff;max-width:720px}.hero-content h1{font-size:clamp(2.5rem,8vw,5.6rem);text-shadow:0 2px 18px rgba(0,0,0,.38)}.hero-content .eyebrow{color:#f4d7a7}.hero-content .lede{color:rgba(255,255,255,.9);font-size:clamp(1rem,2.6vw,1.3rem)}.hero-content .monogram{border-color:#f4d7a7;color:#f4d7a7;background:rgba(0,0,0,.12);backdrop-filter:blur(6px);margin-bottom:1rem}.hero-cta{margin-top:.4rem;background:#fff;color:#171719;border-color:#fff;font-weight:800}.carousel-arrow{position:absolute;z-index:4;top:50%;transform:translateY(-50%);width:44px;height:44px;padding:0;border-radius:999px;border-color:rgba(255,255,255,.45);background:rgba(17,17,17,.34);color:#fff;font-size:1.8rem;backdrop-filter:blur(5px)}.carousel-arrow.prev{left:.8rem}.carousel-arrow.next{right:.8rem}.carousel-dots{position:absolute;z-index:4;left:50%;transform:translateX(-50%);display:flex;gap:.42rem;align-items:center;justify-content:center}.hero-dots{bottom:1.15rem}.carousel-dot{width:9px;height:9px;min-width:9px;padding:0;border-radius:999px;border:1px solid rgba(255,255,255,.82);background:rgba(255,255,255,.34);transition:transform .2s ease,background .2s ease}.carousel-dot.active{background:#fff;transform:scale(1.25)}.gallery-card{max-width:900px;margin:2rem auto 0;padding:1.1rem}.gallery-copy{padding:.35rem .25rem .7rem}.gallery-carousel{position:relative;overflow:hidden;border-radius:16px;height:clamp(300px,55vw,560px);background:#171719}.gallery-track .wedding-slide img{object-fit:contain;background:#171719}.gallery-dots{bottom:.8rem;background:rgba(0,0,0,.28);padding:.35rem .55rem;border-radius:999px;backdrop-filter:blur(5px)}.auth-photo{position:relative;isolation:isolate;background-image:var(--auth-photo);background-size:cover;background-position:center}.auth-photo:before{content:"";position:absolute;inset:0;z-index:-1;background:linear-gradient(180deg,rgba(12,12,12,.35),rgba(12,12,12,.58))}.auth-photo .auth-card{backdrop-filter:blur(10px);background:rgba(255,253,250,.93);box-shadow:0 22px 60px rgba(0,0,0,.24)}.dash-photo-header{position:relative;isolation:isolate;overflow:hidden;padding:1.2rem;border-radius:18px;background:linear-gradient(90deg,rgba(15,15,15,.78),rgba(15,15,15,.42)),url('${photoPath(2)}') center 42%/cover;color:#fff;box-shadow:0 16px 38px rgba(0,0,0,.16)}.dash-photo-header .eyebrow{color:#f4d7a7}.dash-photo-header .ghost{background:rgba(255,255,255,.12);color:#fff;border-color:rgba(255,255,255,.45)}
.host-login-footer{max-width:670px;margin:1.5rem auto .25rem;padding:1rem 1.1rem;display:flex;align-items:center;justify-content:center;gap:.7rem;flex-wrap:wrap;color:var(--muted);font-size:.82rem}.host-login-link{color:var(--ink);font-weight:800;text-underline-offset:3px}.host-login-link:hover{color:var(--gold)}
@media(max-width:740px){.guest-rich{padding:.75rem .75rem 2.5rem}.wedding-hero{min-height:62vh;border-radius:20px}.hero-content{left:1.15rem;right:1.15rem;bottom:3.2rem}.hero-content h1{font-size:clamp(2.45rem,12vw,4.4rem)}.carousel-arrow{width:38px;height:38px;font-size:1.5rem}.carousel-arrow.prev{left:.45rem}.carousel-arrow.next{right:.45rem}.gallery-card{padding:.75rem}.gallery-carousel{height:min(68vh,520px)}.dash-photo-header{padding:1rem}}
@media(prefers-reduced-motion:reduce){.wedding-slide{transition:none;transform:none}.wedding-slide.active{transform:none}}
</style>`;

const PHOTO_JS = `
<script id="wedding-photo-script">
(()=>{
  const roots=Array.from(document.querySelectorAll('[data-carousel]'));
  function initCarousel(root){
    const slides=Array.from(root.querySelectorAll('[data-slide]'));
    const dots=Array.from(root.querySelectorAll('[data-dot]'));
    if(!slides.length)return;
    const interval=Math.max(3500,Number(root.dataset.interval)||6000);
    let index=0,timer=null,touchX=null;
    const reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const show=next=>{
      index=(next+slides.length)%slides.length;
      slides.forEach((slide,i)=>slide.classList.toggle('active',i===index));
      dots.forEach((dot,i)=>dot.classList.toggle('active',i===index));
    };
    const stop=()=>{if(timer){clearInterval(timer);timer=null;}};
    const start=()=>{stop();if(!reduced&&slides.length>1)timer=setInterval(()=>show(index+1),interval);};
    root.querySelector('[data-prev]')?.addEventListener('click',()=>{show(index-1);start();});
    root.querySelector('[data-next]')?.addEventListener('click',()=>{show(index+1);start();});
    dots.forEach((dot,i)=>dot.addEventListener('click',()=>{show(i);start();}));
    root.addEventListener('touchstart',event=>{touchX=event.touches[0]?.clientX??null;},{passive:true});
    root.addEventListener('touchend',event=>{if(touchX===null)return;const end=event.changedTouches[0]?.clientX??touchX;const delta=end-touchX;touchX=null;if(Math.abs(delta)>40){show(index+(delta<0?1:-1));start();}},{passive:true});
    root.addEventListener('mouseenter',stop);
    root.addEventListener('mouseleave',start);
    root.addEventListener('focusin',stop);
    root.addEventListener('focusout',start);
    show(0);start();
  }
  roots.forEach(initCarousel);
})();
</script>`;

async function serveWeddingPhoto(req: Request, index: number, ctx: ExecutionContext): Promise<Response> {
  const source = WEDDING_PHOTO_SOURCES[index];
  if (!source) return new Response('Not found', { status: 404 });
  const cache = caches.default;
  const cacheKey = new Request(req.url, { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const upstream = await fetch(source, { headers: { 'User-Agent': 'WeddingDJ/1.0' } });
  if (!upstream.ok) return new Response('Photo unavailable', { status: 502 });
  const headers = new Headers(upstream.headers);
  headers.set('content-type', 'image/jpeg');
  headers.set('cache-control', 'public, max-age=3600, s-maxage=86400');
  headers.delete('set-cookie');
  const response = new Response(upstream.body, { status: 200, headers });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

async function enhanceHtml(response: Response, pathname: string): Promise<Response> {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html') || response.status !== 200) return response;
  let body = await response.text();

  if (pathname === '/e/michael-marisa') {
    const title = body.match(/<main class="guest">[\s\S]*?<h1>([\s\S]*?)<\/h1>/)?.[1] || 'Michael Higdon &amp; Marisa Hager';
    const lede = body.match(/<main class="guest">[\s\S]*?<p class="lede">([\s\S]*?)<\/p>/)?.[1] || 'Request a song. Help set the vibe.';
    body = body.replace('<main class="guest">', `<main class="guest guest-rich">${weddingHero(title, lede)}`);
    body = body.replace('<section class="card">', '<section class="card" id="song-request">');
    body = body.replace(/<\/main>\s*<script>/, `${weddingGallery()}<footer class="host-login-footer"><span>Hosting the reception?</span><a class="host-login-link" href="/auth/login">Host Login</a></footer></main><script>`);
    body = body.replace('</head>', `<link rel="preload" as="image" href="${photoPath(0)}" fetchpriority="high">${PHOTO_CSS}</head>`);
    body = body.replace('</body>', `${PHOTO_JS}</body>`);
  } else if (pathname === '/auth/login' || pathname === '/setup') {
    const photo = pathname === '/setup' ? photoPath(1) : photoPath(0);
    body = body.replace('<main class="auth">', `<main class="auth auth-photo" style="--auth-photo:url('${photo}')">`);
    body = body.replace('<div class="card">', '<div class="card auth-card">');
    body = body.replace('</head>', `${PHOTO_CSS}</head>`);
  } else if (pathname.startsWith('/dashboard/')) {
    body = body.replace('<header>', '<header class="dash-photo-header">');
    body = body.replace('</head>', `${PHOTO_CSS}</head>`);
  }

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/setup' && req.method === 'GET') {
      const existing = await env.DB.prepare('SELECT COUNT(*) AS c FROM users').first<{ c: number }>();
      if ((existing?.c || 0) > 0) return new Response(null, { status: 302, headers: { Location: '/auth/login' } });
    }

    const photoMatch = url.pathname.match(/^\/media\/wedding\/([0-5])\.jpeg$/);
    if (photoMatch && req.method === 'GET') return serveWeddingPhoto(req, Number(photoMatch[1]), ctx);

    const roomMatch = url.pathname.match(/^\/room\/([^/]+)\/ws$/);
    if (roomMatch) {
      const stub = env.WEDDING_ROOM.get(env.WEDDING_ROOM.idFromName(roomMatch[1]));
      const headers = new Headers(req.headers);
      return stub.fetch(new Request('https://room/ws', { method: 'GET', headers }));
    }

    const response = await worker.fetch(req, env);
    if (req.method !== 'GET') return response;
    if (url.pathname === '/e/michael-marisa' || url.pathname === '/auth/login' || url.pathname === '/setup' || url.pathname.startsWith('/dashboard/')) {
      return enhanceHtml(response, url.pathname);
    }
    return response;
  },
};
