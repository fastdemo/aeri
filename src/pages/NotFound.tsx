import { Link } from 'react-router-dom'

export function NotFound() {
  return (
    <div className="mx-auto grid max-w-[1200px] place-items-center px-4 py-24 text-center sm:px-6">
      <div>
        <p className="text-5xl font-semibold tracking-tight text-white">404</p>
        <p className="mt-3 text-sm font-medium text-white">Page not found</p>
        <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-white/50">
          The page you&apos;re looking for doesn&apos;t exist or may have been moved.
        </p>
        <Link
          to="/"
          className="mt-6 inline-block rounded-full bg-white px-5 py-2 text-sm font-semibold text-black hover:bg-white/90"
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
        <p className="text-sm font-medium text-white">Manga</p>
        <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-white/50">
          Manga support is coming soon. Anime discovery, tracking and watching are unaffected.
        </p>
        <Link
          to="/"
          className="mt-6 inline-block rounded-full bg-white px-5 py-2 text-sm font-semibold text-black hover:bg-white/90"
        >
          Go home
        </Link>
      </div>
    </div>
  )
}

export function ProfilePlaceholder() {
  return (
    <div className="mx-auto grid max-w-[1200px] place-items-center px-4 py-24 text-center sm:px-6">
      <div>
        <p className="text-sm font-medium text-white">Profile</p>
        <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-white/50">
          Your profile is coming soon. Your list and settings are unaffected.
        </p>
        <Link
          to="/"
          className="mt-6 inline-block rounded-full bg-white px-5 py-2 text-sm font-semibold text-black hover:bg-white/90"
        >
          Go home
        </Link>
      </div>
    </div>
  )
}
