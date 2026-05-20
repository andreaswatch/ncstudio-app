const CACHE_NAME = 'ncstudio-shell-v2'
const CORE_ASSET_PATHS = [
  './',
  './manifest.json',
  './offline.html',
  './favicon.svg',
  './pwa-icon.svg',
  './pwa-maskable.svg'
]

function resolveScopeAssetUrl(pathname) {
  return new URL(pathname, self.registration.scope).href
}

function isSameOrigin(requestUrl) {
  return new URL(requestUrl).origin === self.location.origin
}

function isCoreAssetRequest(requestUrl) {
  return CORE_ASSET_PATHS.some((assetPath) => resolveScopeAssetUrl(assetPath) === requestUrl)
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async cache => {
        const requests = CORE_ASSET_PATHS.map((assetPath) => new Request(resolveScopeAssetUrl(assetPath), { cache: 'reload' }))
        await cache.addAll(requests)
      })
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') {
    return
  }

  if (!isSameOrigin(event.request.url)) {
    return
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cache = await caches.open(CACHE_NAME)
        return cache.match(resolveScopeAssetUrl('./offline.html'))
      })
    )
    return
  }

  if (!isCoreAssetRequest(event.request.url)) {
    return
  }

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse
      }

      return fetch(event.request).then(networkResponse => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse
        }

        const responseClone = networkResponse.clone()
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone))
        return networkResponse
      })
    })
  )
})