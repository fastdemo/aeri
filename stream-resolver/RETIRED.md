# RETIRED — `aeri-stream` Fly service (2026-09-10)

This directory (`server.js` + `fly.toml` + `Dockerfile`) is the retired Fly.io
implementation of the Aeri stream resolver. It is kept as reference only.

Live probes proved Cloudflare edge reaches every upstream in the current
pipeline, so the resolver was ported 1:1 into the `aeri` Cloudflare Worker
(`worker/src/resolver.ts`) — same HMAC/allowlist/SSRF model, same-origin
signed delivery, no separate host. See D065.

Do NOT `fly deploy` this. The Fly org trial ended and both Fly apps are
suspended by design now; playback and (after D066) login run without Fly.
