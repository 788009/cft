const RESOURCE_CACHE_NAME = 'cft-static-v1';
let cacheEnabled = true;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'disable-cache') cacheEnabled = false;
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (!cacheEnabled || request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.endsWith('/resource-manifest.json')) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  const scopePath = new URL(self.registration.scope).pathname;
  const relativePath = url.pathname.slice(scopePath.length);
  const isViteDevelopmentPath = relativePath.startsWith('src/') || relativePath.startsWith('@');
  if (
    relativePath.startsWith('assets/') ||
    relativePath.startsWith('data/') ||
    (
      !isViteDevelopmentPath &&
      /\.(?:avif|gif|jpe?g|png|svg|webp|woff2?|ttf)$/i.test(relativePath)
    )
  ) {
    event.respondWith(cacheFirst(request));
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(RESOURCE_CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(RESOURCE_CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}
