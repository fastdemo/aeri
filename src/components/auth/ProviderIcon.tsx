import { useState } from 'react'

// Real brand marks (vendored Simple Icons, CC0) with letter fallback if the
// asset is missing. `variant` matches the surrounding row style.
export function ProviderIcon({ provider, size = 28 }: { provider: 'anilist' | 'mal'; size?: number }) {
  const [failed, setFailed] = useState(false)
  const dim = { width: size, height: size }
  // BASE_URL-aware so the asset resolves on both the Worker (/) and GH Pages (/aeri/)
  const base = (import.meta as any).env?.BASE_URL as string || '/'
  const src = `${base}icons/${provider === 'anilist' ? 'anilist' : 'myanimelist'}.svg`
  if (!failed) {
    return (
      <img
        src={src}
        alt=""
        {...dim}
        loading="lazy"
        onError={() => setFailed(true)}
        className={`shrink-0 rounded-full p-1.5 text-white ${
          provider === 'anilist' ? 'bg-white/10' : 'bg-[#2e51a2]'
        }`}
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <div
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-full text-[10px] font-bold text-white ${
        provider === 'anilist' ? 'bg-white/10' : 'bg-[#2e51a2]'
      }`}
      style={{ width: size, height: size }}
    >
      {provider === 'anilist' ? 'A' : 'M'}
    </div>
  )
}
