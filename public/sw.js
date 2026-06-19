const CACHE_NAME = 'lesson-reminder-cache-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return

  const requestUrl = new URL(event.request.url)
  if (requestUrl.origin !== self.location.origin) return

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      try {
        const response = await fetch(event.request)
        cache.put(event.request, response.clone())
        return response
      } catch (error) {
        const cached = await cache.match(event.request)
        if (cached) return cached
        throw error
      }
    }),
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'SHOW_NOTIFICATION') return

  const payload = event.data.payload
  event.waitUntil(self.registration.showNotification(payload.title, payload.options))
})

self.addEventListener('push', (event) => {
  let payload = {
    title: 'Lesson reminder',
    options: {
      body: 'Open the app to review your lesson reminder.',
      icon: '/app-icon.svg',
      badge: '/app-icon.svg',
    },
  }

  if (event.data) {
    payload = event.data.json()
  }

  event.waitUntil(self.registration.showNotification(payload.title, payload.options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const data = event.notification.data || {}
  const intentMap = data.intentMap || {}
  let targetUrl = data.baseUrl || '/'

  if (event.action && intentMap[event.action]) {
    const separator = targetUrl.includes('?') ? '&' : '?'
    targetUrl += `${separator}intent=${encodeURIComponent(intentMap[event.action])}`
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      const existingClient = clients[0]

      if (existingClient) {
        await existingClient.focus()
        if ('navigate' in existingClient) {
          await existingClient.navigate(targetUrl)
        }
        return
      }

      await self.clients.openWindow(targetUrl)
    }),
  )
})
