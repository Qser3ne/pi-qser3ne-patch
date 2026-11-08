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

## Behavior archive

The current behavior is defined once in the repository archives:

- [Codex Fast](../../docs/archive/codex-fast/archive.md)
- [Provider usage, settings, reset confirmation and event API](../../docs/archive/provider-usage/archive.md)
- [Native and second-account quota](../../docs/archive/native-subscription-usage/archive.md)
- [Unified package loading and coexistence](../../docs/archive/extension-package/archive.md)

This file retains provenance, licensing and regeneration instructions. It does not
add a separate installable extension entry. For package installation and avoiding
duplicate standalone entries, see the [root README](../../README.md).
