import { Link } from 'react-router-dom'
import { useAeriTitle } from '../hooks/useAeriTitle'
import { pillSolid } from '../components/ui/buttonStyles'

export function NotFound() {
  // TAB TITLE: unknown routes read "Not Found - Aeri".
  useAeriTitle('Not Found', 'override')
  return (
    <div className="mx-auto grid max-w-[1200px] place-items-center px-4 py-24 text-center sm:px-6">
      <div>
        <p className="text-5xl font-semibold tracking-tight text-[var(--text)]">404</p>
        <p className="mt-3 text-sm font-medium text-[var(--text)]">Page not found</p>
        <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-[var(--text-faint)]">
          The page you&apos;re looking for doesn&apos;t exist or may have been moved.
        </p>
        <Link
          to="/"
          className={`${pillSolid} mt-6`}
        >
          Go home
        </Link>
      </div>
    </div>
  )
}

export function MangaPlaceholder() {
  return (
    <div className="mx-auto grid max-w-[1200px] place-items-center px-4 py-24 text-center sm:px-6">
      <div>
        <p className="text-sm font-medium text-[var(--text)]">Manga</p>
        <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-[var(--text-faint)]">
          Manga support is coming soon. Anime discovery, tracking and watching are unaffected.
        </p>
        <Link
          to="/"
          className={`${pillSolid} mt-6`}
        >
          Go home
        </Link>
      </div>
    </div>
  )
}
