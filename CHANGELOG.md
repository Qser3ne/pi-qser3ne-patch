# Changelog

## [0.5.0] - 2026-11-04

- Merge pi-daybreak and pi-token-speed with their complete Git histories into this repository; expose all features, including vendored pi-usage, through one `src/index.ts` extension entry.
- Preserve Daybreak commands, branch state and official endpoint restrictions; retain token speed/TTFT, quota, account isolation and Fast preferences.
- Fix stale token-speed status on session reset/shutdown by retaining the last published value until the UI has been cleared.
- Consolidate dependencies and all tests on the Pi 1.5.0 development baseline; require Node.js >=22.19.0. Add single-entry production loader and combined lifecycle/request regressions.
- Document migration away from the two standalone packages; keep the upstream pi-usage entry disabled to prevent duplicate commands.

## [0.4.0] - 2026-11-03

- Include a reproducible, MIT-attributed pi-usage 0.69.0 compatibility entry: the original `/fast` and `/usage` Fast controls now recognize `openai-codex-1`.
- Scope OAuth readiness, candidate selection and capability discovery to the actual selected provider. Preserve standard routing when unsupported/unknown, Fast cost correction, cancellation and existing shared `pi-usage.json` preferences.
- Add a separate second-account Fast status indicator and request-local environment-proxy support.
- Document disabling the standalone pi-usage extension entry to avoid duplicate commands, and how to restore it. No installed upstream files or credentials are rewritten.
- Test the real upstream Fast runtime, native alias payloads and production-only bundled loading/resource filtering.

## [0.3.0] - 2026-11-03

- Rename the project, package and GitHub repository from `pi-sub2api-usage` to `pi-qser3ne-patch`; update installation instructions and HTTP User-Agent branding.
- Keep existing configuration/cache filenames, commands, status key, provider IDs, login credentials and model overrides unchanged for compatibility.

## [0.2.3] - 2026-11-03

- Rename the second Codex account in `/login` to `OpenAI Codex 1(legacy)`; keep its `openai-codex-1` provider ID, credentials, and model settings unchanged.

## [0.2.2] - 2026-11-03

- Fix quota refresh starvation during fast tool loops: repeated turn events now share the same pending account/model/session request rather than continually aborting it.
- Keep cancellation on manual refresh and model/session changes; revalidate login changes before publishing a shared result.
- Add regressions for slow quota requests and login changes, and explicitly exercise `gpt-6.1-sol` tool/reasoning handoff.
- Clarify that per-provider context-window overrides are independent and are not copied between accounts.

## [0.2.1] - 2026-11-03

- Fix the second Codex account failing to appear in `/login` in Pi's bundled production runtime. Import the native provider through the supported `@earendil-works/pi-ai/providers/all` entrypoint instead of a development-only provider subpath.
- Add a production-only sandbox regression test using Pi's actual bundled extension loader, login provider enumeration, exact-ID lookup, and login selector rendering/selection.

## [0.2.0] - 2026-11-03

- Add `openai-codex-1` as a second, independently authenticated Codex account.
- Reuse Pi's native Codex browser/device login, token refresh, model catalog and streaming implementation without changing the existing `openai-codex` account.
- Keep credentials, quota caches and authentication errors scoped to the selected account. The second account never falls back to the first account's token.
- Preserve stream attribution and valid tool-call IDs; isolate encrypted reasoning when switching accounts.
- Display the selected account's quota through pi-statusline and `/openai-usage`.

## [0.1.0]

- Sub2API admin account quota and native OpenAI/Codex quota display.
