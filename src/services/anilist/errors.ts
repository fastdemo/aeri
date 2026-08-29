export type ProviderErrorCode = 'NETWORK' | 'AUTH' | 'NOT_FOUND' | 'UNKNOWN'

export class ProviderError extends Error {
  code: ProviderErrorCode
  retryable: boolean
  constructor(code: ProviderErrorCode, message: string, retryable = false) {
    super(message)
    this.name = 'ProviderError'
    this.code = code
    this.retryable = retryable
  }
}

export function toProviderError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e
  const msg = e instanceof Error ? e.message : String(e)
  if (msg.includes('AUTH') || msg.includes('401') || msg.includes('Unauthorized')) {
    return new ProviderError('AUTH', 'Session expired. Reconnect to AniList.', false)
  }
  if (msg.includes('404') || msg.includes('Not Found')) {
    return new ProviderError('NOT_FOUND', 'We couldn’t find that anime.', false)
  }
  if (msg.includes('Network') || msg.includes('Failed to fetch')) {
    return new ProviderError('NETWORK', 'Couldn’t reach AniList. Check your connection.', true)
  }
  return new ProviderError('UNKNOWN', msg || 'Something went wrong.', false)
}
