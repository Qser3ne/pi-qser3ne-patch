# Changelog

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
