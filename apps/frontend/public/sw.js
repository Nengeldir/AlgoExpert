// Service Worker — registered from main.tsx.

const CACHE_NAME = 'expert-algo-v1'

self.addEventListener('install', (event) => {
  // Pre-cache shell assets in a future iteration
  void event
})

self.addEventListener('fetch', (event) => {
  // Network-first strategy — keeps voting data fresh
  void event
})

self.addEventListener('push', (event) => {
  let payload = { title: 'Expert Vote', body: 'A new question is open for voting.', url: '/today' }
  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() }
    } catch {
      payload.body = event.data.text()
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: payload.url },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : '/today'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(url) && 'focus' in client) return client.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    }),
  )
})
