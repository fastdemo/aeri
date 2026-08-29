// Simple IndexedDB wrapper — versioned, no external dep for Phase 2
// In production, use `idb` library; this is a minimal abstraction satisfying spec.

const DB_NAME = 'aeri'
const DB_VERSION = 2

let dbPromise: Promise<IDBDatabase> | null = null
function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('progress')) db.createObjectStore('progress', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'key' })
      if (!db.objectStoreNames.contains('history')) db.createObjectStore('history', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('watchPos')) db.createObjectStore('watchPos', { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => {
      dbPromise = null
      reject(req.error)
    }
    req.onblocked = () => {
      // still resolve when available
    }
  })
  return dbPromise
}

export async function putProgress(id: string, episode: number, percent: number) {
  const db = await openDB()
  return new Promise<void>((res, rej) => {
    const tx = db.transaction('progress', 'readwrite')
    tx.objectStore('progress').put({ id, episode, percent, updatedAt: Date.now() })
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
  })
}

export async function getProgress(id: string) {
  const db = await openDB()
  return new Promise<any>((res, rej) => {
    const req = db.transaction('progress', 'readonly').objectStore('progress').get(id)
    req.onsuccess = () => res(req.result)
    req.onerror = () => rej(req.error)
  })
}

export async function putCache(key: string, value: any, ttlMs = 1000 * 60 * 60 * 24) {
  const db = await openDB()
  return new Promise<void>((res, rej) => {
    const tx = db.transaction('cache', 'readwrite')
    tx.objectStore('cache').put({ key, value, expiry: Date.now() + ttlMs })
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
  })
}

export async function getCache<T>(key: string): Promise<T | null> {
  const db = await openDB()
  return new Promise((res, rej) => {
    const req = db.transaction('cache', 'readonly').objectStore('cache').get(key)
    req.onsuccess = () => {
      const row = req.result as any
      if (!row || row.expiry < Date.now()) return res(null)
      res(row.value as T)
    }
    req.onerror = () => rej(req.error)
  })
}

export interface WatchPos {
  id: string // anime internalId
  episode: number
  currentTime: number
  duration: number
  updatedAt: number
}

export async function putWatchPos(pos: WatchPos): Promise<void> {
  const db = await openDB()
  return new Promise((res, rej) => {
    const tx = db.transaction('watchPos', 'readwrite')
    tx.objectStore('watchPos').put(pos)
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
  })
}

export async function getWatchPos(id: string): Promise<WatchPos | null> {
  const db = await openDB()
  return new Promise((res, rej) => {
    const req = db.transaction('watchPos', 'readonly').objectStore('watchPos').get(id)
    req.onsuccess = () => res((req.result as WatchPos) ?? null)
    req.onerror = () => rej(req.error)
  })
}

export async function clearWatchPos(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((res, rej) => {
    const tx = db.transaction('watchPos', 'readwrite')
    tx.objectStore('watchPos').delete(id)
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
  })
}
