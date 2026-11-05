/* Service worker de Peso Ledger: guarda la app para que abra sin conexión.
   Estrategia: responde desde la caché al instante y actualiza en segundo plano.
   Si cambiás algún archivo, subí VERSION para forzar la actualización. */
const VERSION = 'pl-v3';
const CORE = ['./', './index.html', './styles.css', './app.js', './manifest.json'];
const EXTRA = ['./icon-192.png', './icon-512.png', './maskable-512.png', './apple-touch-icon.png', './favicon-32.png'];

self.addEventListener('install', e => {
  // Los íconos son opcionales: si alguno falta, la app igual se instala y funciona sin conexión
  e.waitUntil(caches.open(VERSION)
    .then(c => c.addAll(CORE).then(() => Promise.allSettled(EXTRA.map(f => c.add(f)))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async cache => {
    // Las navegaciones (con ?query o #hash) usan siempre la página principal
    const key = req.mode === 'navigate' ? './index.html' : req;
    const cached = await cache.match(key, { ignoreSearch: true });
    const network = fetch(req).then(res => {
      if (res.ok) cache.put(key, res.clone());
      return res;
    }).catch(() => cached);
    return cached || network;
  }));
});
