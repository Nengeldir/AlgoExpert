import { api } from './api/client'

export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window
}

// Web Push wants the VAPID key as a Uint8Array, but the server hands it over
// URL-safe base64 (the format browsers themselves emit).
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const bytes = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) {
    bytes[i] = rawData.charCodeAt(i)
  }
  return bytes
}

export async function getCurrentPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null
  const registration = await navigator.serviceWorker.ready
  return registration.pushManager.getSubscription()
}

function toSubscribeBody(subscription: PushSubscription) {
  const json = subscription.toJSON()
  return {
    endpoint: json.endpoint as string,
    keys: { p256dh: json.keys!.p256dh, auth: json.keys!.auth },
  }
}

export async function subscribeToPush(): Promise<void> {
  if (!isPushSupported()) throw new Error('Push notifications are not supported in this browser.')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted.')
  }

  const { publicKey } = await api.getVapidPublicKey()
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  })

  await api.subscribePush(toSubscribeBody(subscription))
}

export async function unsubscribeFromPush(): Promise<void> {
  const subscription = await getCurrentPushSubscription()
  if (!subscription) return

  const endpoint = subscription.endpoint
  await subscription.unsubscribe()
  await api.unsubscribePush(endpoint)
}
