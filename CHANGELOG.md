# Changelog

## 1.1.0 — 2026-10-03

- Publish JJ status through Pi's native extension-status area rather than replacing the footer.
- Preserve `--ignore-working-copy` polling, bounded command timeouts and error backoff.
- Support immediate toggle/re-enable, tree refresh, and cleanup; stale poll results cannot update a replacement session.
- Avoid polling in non-TUI modes.

Verification: `npm run check`, `npm test` (real local read-only JJ status and toggling); real Pi 1.0 extension-loader smoke check.
