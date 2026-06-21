/* Service Worker — Sistem Kehadiran Pelajar (PWA sahaja).
   - Aset statik: cache-first.
   - Halaman (navigasi): network-first + sandaran cache (elak konten/auth lapuk).
   - /api/*: SENTIASA network, TIDAK dicache (tidak menyentuh logik API).
   Naikkan nombor versi CACHE untuk paksa kemas kini cache selepas deploy. */
const CACHE = 'skp-pwa-v1';

const PRECACHE = [
  '/',
  '/index.html',
  '/guru',
  '/guru.html',
  '/style.css',
  '/guru.css',
  '/admin.css',
  '/app.js',
  '/guru.js',
  '/admin.js',
  '/manifest.webmanifest',
  '/assets/logo-sekolah.png',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/icon-maskable-512.png',
  '/assets/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Tahan-ralat: cache satu per satu; satu gagal tidak menggagalkan pemasangan.
    await Promise.allSettled(
      PRECACHE.map((u) => cache.add(new Request(u, { cache: 'reload' })))
    );
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                    // tulisan → biar network
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;     // silang-asal → biar browser
  if (url.pathname.startsWith('/api/')) return;        // API → JANGAN cache

  const isNavigate =
    req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  if (isNavigate) {
    // Network-first untuk halaman.
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        // Hormati redirect auth (cth /admin → /login) dengan betul.
        if (fresh.redirected) return Response.redirect(fresh.url, 302);
        if (fresh.ok && fresh.type === 'basic') {
          const cache = await caches.open(CACHE);
          cache.put(req, fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch (e) {
        const cache = await caches.open(CACHE);
        return (
          (await cache.match(req)) ||
          (await cache.match('/index.html')) ||
          new Response(
            '<!doctype html><meta charset="utf-8"><title>Luar talian</title><h1>Luar talian</h1><p>Sila sambung semula internet untuk meneruskan.</p>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 }
          )
        );
      }
    })());
    return;
  }

  // Cache-first untuk aset statik (CSS/JS/imej/fon/manifest).
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res && res.status === 200 && res.type === 'basic') {
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    } catch (e) {
      return hit || Response.error();
    }
  })());
});
