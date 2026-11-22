const assets = self.__WB_MANIFEST
let versionHash = 2166136261
for (const asset of assets) {
  for (const character of `${asset.url}:${asset.revision ?? ''}`) versionHash = Math.imul(versionHash ^ character.charCodeAt(0), 16777619)
}
const cacheName = `moneyflow-shell-${(versionHash >>> 0).toString(36)}`
const shellUrl = new URL('index.html', self.registration.scope).href

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(assets.map((asset) => asset.url))).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((names) => Promise.all(names.filter((name) => name.startsWith('moneyflow-shell-') && name !== cacheName).map((name) => caches.delete(name)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return
  event.respondWith((async () => {
    const cache = await caches.open(cacheName)
    const cacheUrl = new URL(request.url)
    cacheUrl.search = ''
    const cached = await cache.match(cacheUrl, { ignoreSearch: true })
    if (cached) return cached
    try { return await fetch(request) }
    catch { return request.mode === 'navigate' ? (await cache.match(shellUrl)) ?? Response.error() : Response.error() }
  })())
})