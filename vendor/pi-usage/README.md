# pi-usage compatibility entry

Derived from **@narumitw/pi-usage 0.69.0**, copyright (c) 2026 narumiruna,
under the MIT license in [LICENSE](LICENSE). Upstream:
<https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-usage>.
This is not an official pi-usage release. Since pi-qser3ne-patch 0.5.0, the
unified `src/index.ts` calls this module internally; it is not a separate
`pi.extensions` entry and cannot be disabled independently with resource filters.

The npm distribution's generated TypeScript runtime is included so Pi's bundled
loader can resolve its host-provided imports normally. Source maps are omitted.
`upstream.json` records the original files' SHA-256 hashes and package provenance.

## Rebuild

```bash
npm ci
npm run vendor:pi-usage
npm run typecheck
npm test
```

The generator reads the exact dev dependency, not the user's installed package.
All replacements assert a unique match. It never modifies the upstream npm
installation, Pi settings, or credentials. To upgrade upstream, review changes,
update the pinned dev dependency and generator deliberately, then regenerate and
test. Installing a newer standalone pi-usage does not upgrade this entry.

## Changes maintained here

- Recognize only `openai-codex` and `openai-codex-1` for official Codex Fast mode.
- Resolve runtime OAuth, readiness and credential candidates using the **actual
  selected provider ID**. No canonical-account fallback or credential copying.
- Preserve upstream model-directory capability discovery, per-account caching,
  cancellation, global `pi-usage.json.codexFastMode`, priority/default payload
  rewriting, `/fast`, `/usage` Fast controls and Fast cost correction.
- Show `⚡ fast` for an effective second-account request, or `⚡ fast unknown`
  when enabled but unverified, under a separate `qser3ne-codex-fast` status key.
- Use a request-local undici environment-proxy dispatcher, destroyed after bounded
  response consumption. Do not replace global fetch or the global dispatcher.
- Export Fast registration/catalog helpers for tests of the actual upstream logic.

Everything else is upstream functionality. In particular, this does not add a
new alias quota adapter to pi-usage's public usage API: the project's existing
`/openai-usage` and quota chip remain responsible for second-account quota.

**Disable the standalone pi-usage extension entry** while this entry is loaded,
otherwise Pi will expose duplicate `/fast` and `/usage` commands. See the root
README for settings and rollback instructions. Existing `pi-usage.json` is reused
without resetting preferences; Fast still uses more plan allowance.
