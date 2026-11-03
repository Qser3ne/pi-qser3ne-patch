# Changelog

## [0.2.0] - 2026-11-03

- Add `openai-codex-1` as a second, independently authenticated Codex account.
- Reuse Pi's native Codex browser/device login, token refresh, model catalog and streaming implementation without changing the existing `openai-codex` account.
- Keep credentials, quota caches and authentication errors scoped to the selected account. The second account never falls back to the first account's token.
- Preserve stream attribution and valid tool-call IDs; isolate encrypted reasoning when switching accounts.
- Display the selected account's quota through pi-statusline and `/openai-usage`.

## [0.1.0]

- Sub2API admin account quota and native OpenAI/Codex quota display.
