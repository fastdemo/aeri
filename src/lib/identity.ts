import type { AnimeIdentity } from '../types/anime'

// Normalized mapping — never assume anilistId === malId
export function toInternalId(identity: AnimeIdentity): string {
  return identity.internalId
}

export function matchIdentity(a: AnimeIdentity, b: AnimeIdentity): boolean {
  if (a.internalId && b.internalId && a.internalId === b.internalId) return true
  if (a.anilistId && b.anilistId && a.anilistId === b.anilistId) return true
  if (a.malId && b.malId && a.malId === b.malId) return true
  return false
}
