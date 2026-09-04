/* 无量空处 · Service Worker（离线缓存） */
const CACHE = 'cet4essay-v9';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './assets/icon-blindfold.png',
  './assets/icon-q-wink.png',
  './assets/icon-q-thumbs.png',
  './assets/icon-muryo.png',
  './assets/icon-word.png',
  './assets/gojo_blind.png',
  './assets/sukuna_sword.png',
  './assets/bg-gojo.jpg',
  './assets/audio/bgm-battle-v1.mp3',
  './assets/audio/vacuum_whoosh.mp3',
  './assets/audio/laser_shot.mp3',
  './assets/audio/energy_shockwave.mp3',
  './assets/audio/sword_whoosh.mp3',
  './assets/audio/magic_sword_slice.mp3',
  './assets/audio/sword_impact.mp3',
  './assets/audio/fire_spell_explosion.mp3',
  './assets/audio/fireball_spell.mp3',
  './assets/audio/magic_mystery_whoosh.mp3',
  './assets/audio/cinematic_thunder_hit.mp3',
  './assets/audio/movie_impact.mp3',
  './assets/audio/voice/gojo-blue.mp3',
  './assets/audio/voice/gojo-red.mp3',
  './assets/audio/voice/gojo-purple.mp3',
  './assets/audio/voice/gojo-domain.mp3',
  './assets/audio/voice/gojo-win.mp3',
  './assets/audio/voice/sukuna-kai.mp3',
  './assets/audio/voice/sukuna-laugh.mp3'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  var isHTML = url.pathname.endsWith('/') || url.pathname.endsWith('.html') || url.pathname.endsWith('.css') || url.pathname.endsWith('.js');
  if (isHTML) {
    e.respondWith(
      fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html')))
    );
  } else {
    e.respondWith(
      caches.match(e.request).then((hit) => {
        if (hit) return hit;
        return fetch(e.request).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        }).catch(() => caches.match('./index.html'));
      })
    );
  }
});
