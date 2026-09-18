# Settings — Aeri (`src/pages/Settings.tsx`, gated: signed-out → `/`)

All persist via `setPreferences` → `localStorage aeri:prefs` (merged over
defaults); theme also applies instantly via `applyTheme`.

| Control | State | Default | Behavior / consumers |
|---|---|---|---|
| AniList Connect/Disconnect | context token | — | login/logout; label shows `Connected as …` |
| Track with AniList radio | `trackingProvider='anilist'` | auto | gates `combinedList`/auth across app |
| Sync Status/Episodes/Score → AniList | `sync.anilist.*` | all true | `isSyncEnabled` gates `TrackingContext` mutations |
| MAL Connect/Disconnect | context token | — | same for MAL |
| Track with MAL radio | `trackingProvider='mal'` | auto | same |
| Sync → MAL ×3 | `sync.mal.*` | all true | same |
| Autoplay next episode | `autoplay` | true | `Watch` → next-episode navigate + player attr (next mount) |
| Subtitles | `subtitles` | true | `Watch` passes provider subs or nothing |
| Volume slider | `volume` 0–1 | 1 | `VideoPlayer` volume effect (reactive; verified 0.3 live) |
| Preferred audio Sub/Dub | `preferredAudio` | `sub` | source order + select (refetch on change) |
| Preferred source select | `preferredProvider` | null (Auto) | tried first in registry (refetch on change) |
| Provider Enable checkbox | `enabledProviders` | null (=all) | filters registry; applies on **next resolve** (Retry/episode change) |
| Provider ↑/↓ reorder | `providerOrder` | null (=default) | orders registry; same next-resolve timing |
| Custom video server + Test | `customVideoApiUrl` | null | `getEffectiveVideoApiUrl`; Test GETs `{url}/health`; same next-resolve timing |
| Color theme grid (17) | `theme` | `aeri-dark` | instant `applyTheme`, pre-render init, survives reload |
| Reduced motion row | none (read-only) | — | **display-only**: system `matchMedia` readout; no override exists |
| Clear cached data | — | — | clears IDB cache + anilist/mal/video memory |
| Clear watch positions | — | — | clears `watchPos` (+ one legacy key) |
| Reset local data | deletes `aeri:prefs` | — | chains both clears, restores defaults, keeps logins |
| AniList diagnostics | none | — | counters readout, 2s refresh |
| About | none | — | live tracker/source/storage + GitHub/Status/Manga links |

Dead/unsupported: `preferredQuality` (stored, **zero consumers** — no UI, no
reader); `customAuthApiUrl` (consumed by auth base resolution, **no UI
input**). Reduced-motion is intentionally read-only. Everything else is real:
change → persist → reload keeps value → behavior changes (volume/audio/
source verified live; toggles/order/URL verified on next resolve).
