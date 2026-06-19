export const registerAppServiceWorker = async () => {
  if (!('serviceWorker' in navigator)) return

  try {
    await navigator.serviceWorker.register('/sw.js')
  } catch (error) {
    console.error('Service worker registration failed', error)
  }
}
