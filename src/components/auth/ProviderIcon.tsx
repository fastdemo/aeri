// Brand marks (Simple Icons paths, CC0), inlined so they inherit `color`
// (external <img> SVGs can't — currentColor would resolve to black).
// Always rendered white for the dark UI.
const PATHS = {
  anilist:
    'M24 17.53v2.421c0 .71-.391 1.101-1.1 1.101h-5l-.057-.165L11.84 3.736c.106-.502.46-.788 1.053-.788h2.422c.71 0 1.1.391 1.1 1.1v12.38H22.9c.71 0 1.1.392 1.1 1.101zM11.034 2.947l6.337 18.104h-4.918l-1.052-3.131H6.019l-1.077 3.131H0L6.361 2.948h4.673zm-.66 10.96-1.69-5.014-1.541 5.015h3.23z',
  mal: 'M14.921 6.479c-.82 0-3.683 0-4.947 3.156-.662 1.652-.986 4.812.876 7.886l1.934-1.41s-.767-1.095-1.083-3.191h2.897l.022 3.19h2.604V8.835h-2.581v2.043l-2.46-.023s.413-2.408 2.877-2.336h2.454l-.572-2.04ZM0 6.528v9.624h2.348v-5.84l2.031 2.664 2.047-2.652v5.828h2.336V6.528H6.437L4.368 9.474 2.31 6.528Zm18.447.022v9.583h5.022L24 14.09h-3.232V6.55Z',
} as const

export function ProviderIcon({ provider, size = 28 }: { provider: 'anilist' | 'mal'; size?: number }) {
  const title = provider === 'anilist' ? 'AniList' : 'MyAnimeList'
  return (
    <span
      role="img"
      aria-label={title}
      className={`grid shrink-0 place-items-center rounded-full text-white ${
        provider === 'anilist' ? 'bg-white/10' : 'bg-[#2e51a2]'
      }`}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden style={{ width: size * 0.62, height: size * 0.62 }}>
        <path d={PATHS[provider]} />
      </svg>
    </span>
  )
}
