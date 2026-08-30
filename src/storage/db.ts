// Simple IndexedDB wrapper — versioned, no external dep for Phase 2
// In production, use `idb` library; this is a minimal abstraction satisfying spec.

const DB_NAME = 'aeri'
const DB_VERSION = 2

let dbPromise: Promise<IDBDatabase> | null = null
function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  const openPromise = new Promise<IDBDatabase>((resolve, reject) => {
    try {
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
        setTimeout(() => {
          try { req.result?.close() } catch {}
          dbPromise = null
          reject(new Error('IndexedDB blocked'))
        }, 1200)
      }
    } catch (e) {
      dbPromise = null
      reject(e)
    }
  })
  const timeoutPromise = new Promise<IDBDatabase>((_, reject) => setTimeout(() => {
    dbPromise = null
    reject(new Error('IDB open timeout'))
  }, 1300))
  dbPromise = Promise.race([openPromise, timeoutPromise]) as Promise<IDBDatabase>
  // Ensure rejection clears cached promise
  dbPromise.catch(() => { dbPromise = null })
  return dbPromise
}

// Helper: race IDB operation with timeout so Watch/navigation never waits 2 minutes
function withTimeout<T>(p: Promise<T>, ms = 1200, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>(resolve => setTimeout(() => resolve(fallback as T), ms)),
  ])
}

export async function putProgress(id: string, episode: number, percent: number) {
  try {
    const db = await withTimeout(openDB(), 1200, null as any)
    if (!db) return
    await withTimeout(new Promise<void>((res, rej) => {
      try {
        const tx = db.transaction('progress', 'readwrite')
        tx.objectStore('progress').put({ id, episode, percent, updatedAt: Date.now() })
        tx.oncomplete = () => res()
        tx.onerror = () => rej(tx.error)
      } catch (e) { rej(e) }
    }), 1200, undefined as any)
  } catch {}
}

export async function getProgress(id: string) {
  try {
    const db = await withTimeout(openDB(), 1200, null as any)
    if (!db) return null
    const res = await withTimeout(new Promise<any>((res, rej) => {
      try {
        const req = db.transaction('progress', 'readonly').objectStore('progress').get(id)
        req.onsuccess = () => res(req.result)
        req.onerror = () => rej(req.error)
      } catch (e) { rej(e) }
    }), 1200, null as any)
    return res ?? null
  } catch { return null }
}

export async function putCache(key: string, value: any, ttlMs = 1000 * 60 * 60 * 24) {
  try {
    const db = await withTimeout(openDB(), 1200, null as any)
    if (!db) return
    await withTimeout(new Promise<void>((res, rej) => {
      try {
        const tx = db.transaction('cache', 'readwrite')
        tx.objectStore('cache').put({ key, value, expiry: Date.now() + ttlMs })
        tx.oncomplete = () => res()
        tx.onerror = () => rej(tx.error)
      } catch (e) { rej(e) }
    }), 1200, undefined as any)
  } catch {}
}

export async function getCache<T>(key: string): Promise<T | null> {
  try {
    const db = await withTimeout(openDB(), 1200, null as any)
    if (!db) return null
    const result = await withTimeout(new Promise<T | null>((res, rej) => {
      try {
        const req = db.transaction('cache', 'readonly').objectStore('cache').get(key)
        req.onsuccess = () => {
          const row = req.result as any
          if (!row || row.expiry < Date.now()) return res(null)
          res(row.value as T)
        }
        req.onerror = () => rej(req.error)
      } catch (e) { rej(e) }
    }), 1200, null as any)
    return result
  } catch {
    return null
  }
}

export interface WatchPos {
  id: string // anime internalId
  episode: number
  currentTime: number
  duration: number
  updatedAt: number
}

export async function putWatchPos(pos: WatchPos): Promise<void> {
  try {
    const db = await withTimeout(openDB(), 1200, null as any)
    if (!db) return
    await withTimeout(
      new Promise<void>((res, rej) => {
        try {
          const tx = db.transaction('watchPos', 'readwrite')
          tx.objectStore('watchPos').put(pos)
          tx.oncomplete = () => res()
          tx.onerror = () => rej(tx.error)
        } catch (e) { rej(e) }
      }),
      1200,
      undefined as any,
    )
  } catch {}
}

export async function getWatchPos(id: string): Promise<WatchPos | null> {
  try {
    const db = await withTimeout(openDB(), 1200, null as any)
    if (!db) return null
    const result = await withTimeout(
      new Promise<WatchPos | null>((res, rej) => {
        try {
          const req = db.transaction('watchPos', 'readonly').objectStore('watchPos').get(id)
          req.onsuccess = () => res((req.result as WatchPos) ?? null)
          req.onerror = () => rej(req.error)
        } catch (e) { rej(e) }
      }),
      1200,
      null as any,
    )
    return result
  } catch {
    return null
  }
}

export async function clearWatchPos(id: string): Promise<void> {
  try {
    const db = await withTimeout(openDB(), 1200, null as any)
    if (!db) return
    await withTimeout(
      new Promise<void>((res, rej) => {
        try {
          const tx = db.transaction('watchPos', 'readwrite')
          tx.objectStore('watchPos').delete(id)
          tx.oncomplete = () => res()
          tx.onerror = () => rej(tx.error)
        } catch (e) { rej(e) }
      }),
      1200,
      undefined as any,
    )
  } catch {}
}

export async function deleteCache(key: string): Promise<void> {
  try {
    const db = await withTimeout(openDB(), 1200, null as any)
    if (!db) return
    await withTimeout(new Promise<void>((res, rej) => {
      try {
        const tx = db.transaction('cache', 'readwrite')
        tx.objectStore('cache').delete(key)
        tx.oncomplete = () => res()
        tx.onerror = () => rej(tx.error)
      } catch (e) { rej(e) }
    }), 1200, undefined as any)
  } catch {}
}

export async function clearAllCache(): Promise<void> {
  try {
    const db = await withTimeout(openDB(), 1200, null as any)
    if (!db) return
    await withTimeout(new Promise<void>((res, rej) => {
      try {
        const tx = db.transaction('cache', 'readwrite')
        tx.objectStore('cache').clear()
        tx.oncomplete = () => res()
        tx.onerror = () => rej(tx.error)
      } catch (e) { rej(e) }
    }), 1200, undefined as any)
  } catch {}
}

export async function clearAllWatchPos(): Promise<void> {
  try {
    const db = await withTimeout(openDB(), 1200, null as any)
    if (!db) return
    await withTimeout(new Promise<void>((res, rej) => {
      try {
        const tx = db.transaction('watchPos', 'readwrite')
        tx.objectStore('watchPos').clear()
        tx.oncomplete = () => res()
        tx.onerror = () => rej(tx.error)
      } catch (e) { rej(e) }
    }), 1200, undefined as any)
  } catch {}
}
