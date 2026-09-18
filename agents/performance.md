# Performance — Aeri

## Strategy

- **Network first**: single shared AniList path (dedup + memory/IDB +
  cooldown); page costs ~1 request cold, 0 warm; enrichment paced.
- **Render discipline**: no per-tick state (verified 0 DOM mutations / 10s
  playback); stable per-mount feed ordering (background refetches never
  reshuffle); skeletons mirror layout (no layout shift).
- **Media**: lazy hls.js (first HLS play only); native HLS on Safari; IDB
  progress writes throttled 5s; tracker at ≥80%/end only.

## Images

Card `aspect-[16/9]` boxes + `loading="lazy"` + `decoding="async"` + explicit
w/h + onLoad fade + onError hide/EP-fallback. Hero `eager` + high priority.
Home mounts ~90–100 images; rows snap-scroll (no virtualization — measured
unnecessary).

## Watch page

Effects keyed on stable episode/source identity; sources 9s budget, episodes
4s/provider; `effectiveEpisode.id` stabilized against providerId jitter;
HLS singleton destroyed per source change; episode/source switches verified
single `<video>`, no listener/HLS accumulation (stress: play/seek/pause/
episode-switch clean).

## Rules (measured, not slogans)

- Do not `setState` on playback ticks (refs + throttled IDB only).
- Do not retry 429s; shared cooldown + stale serve.
- Do not refetch on resize (browse slices locally; navbar re-measures only).
- Do not put `backdrop-blur` on large regions (~100 card blurs were removed
  after profiling; pills/panels only).
- Do not auto-cycle anything except the hero (feed rows are mount-stable).

## Known bottlenecks / constraints

- Upstream per-connection throughput lottery (tens–hundreds KB/s vs
  ~650–690kbps streams) — not fixable in app code; worker relay proven ≥
  direct; parallel segments don't scale (aggregate throttle).
- Single-rendition HLS masters everywhere (no ABR to tune).
- AniList ~30/min + burst limiter: enrichment tail converges slowly on huge
  lists by design; cold season walks cost ~1 req/step (~0.4–0.6s each).
- Previous fixes: shared inflight (D073), slim-spine walk + batch (D075),
  shared media record (D077), card-blur removal, caption revert.
