# pi-statusline compatibility source

Vendored `@narumitw/pi-statusline` **0.50.2**, MIT (see LICENSE). Original repository and SHA-256 values of all original source files are recorded in `upstream.json`.

Regenerate after `npm ci` with `npm run vendor:pi-statusline`. This copies the npm package's authoritative `src/` and converts internal `.js` imports to explicit `.ts` paths for Node strip-types and Pi/Jiti. Runtime has no dependency on the standalone npm package.

Assertion-guarded patches in `scripts/vendor-pi-statusline.mjs` add:

- Native configurable `usage24h` segment, icon `📊 `, runtime palette block, responsive retention below tools but above cwd.
- Async `src/rolling-token-usage.ts` controller, lifecycle refresh and cleanup; cached values only in render.
- In-memory migration of old context-bearing layouts; explicit `segmentText.usage24h` prevents reinsertion when hidden. Empty/no-context layouts stay untouched. Integrated menu saves persist effective segments and the presentation marker.
- Segment description and `/statusline help` guidance; default information profiles contain the new segment.

Keep the independent `pi-statusline` extension entry disabled. This is the single footer owner inside the patch package; existing status chips, settings and commands remain supported. See `docs/rolling-token-status.md` for migration and manual JSON opt-out.
