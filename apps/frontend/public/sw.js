// Service Worker — scaffolded for PWA, push logic not yet implemented.
// To activate, register this file from main.tsx when push notifications are added.

const CACHE_NAME = 'expert-algo-v1'

self.addEventListener('install', (event) => {
  // Pre-cache shell assets in a future iteration
  void event
})

self.addEventListener('fetch', (event) => {
  // Network-first strategy — keeps voting data fresh
  void event
})

// Push handler placeholder — implement with VAPID keys in a future iteration
self.addEventListener('push', (event) => {
  void event
  console.log('[SW] Push received — not yet implemented')
})
