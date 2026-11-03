# pi-sub2api-usage

A [pi](https://github.com/earendil-works/pi-coding-agent) extension that shows your
[sub2api](https://github.com/Wei-Shaw/sub2api) upstream account quota and native
OpenAI/Codex subscription quota in the statusline. Compatible with
`@narumitw/pi-statusline` through Pi's standard `ctx.ui.setStatus()` API;
no custom footer or dependency on pi-statusline internals is required.

Statusline preview (rendered by `@narumitw/pi-statusline`):

```
📊 sub2api-claude 86% ↻ 4h12m 74% ↻ 3d13h
```

- `86% ↻ 4h12m` — 5-hour window REMAINING, resetting in 4h12m
- `74% ↻ 3d13h` — 7-day window REMAINING, resetting in 3d13h

(Percentages show remaining quota, matching pi-usage's codex-style default.)

## How it works

- Reads `~/.pi/agent/models.json` and reacts to providers marked with `"sub2api": true`.
- The provider's quota comes from the sub2api **admin account-usage endpoint**
  (`GET /api/v1/admin/accounts/{id}/usage`), i.e. the same numbers as the
  "查询额度" card in the admin panel's account list. This requires an admin account.
- Logs into the panel with your email/password to mint access tokens (cached at
  `~/.pi/agent/pi-sub2api-usage-cache.json`, mode 0600; re-login happens automatically
  when they expire or a usage call returns 401). The cache is bound to the normalized
  instance URL and login email: changing either requires a new login. Legacy unscoped
  caches are ignored and replaced after the next successful login.
- Refreshes on session start, model switch, and turn start; while a marked provider
  stays selected it also re-queries every `refreshMs` (3 min by default),
  with a 30s failure backoff and a 60s countdown re-render.
- By default queries `source=passive` (locally recorded data, no upstream round-trip);
  set `"usageSource": "active"` to query upstream on every refresh instead.
- Publishes under its own status key `sub2api-usage`, without overwriting pi-usage's
  `usage` key. If both extensions query OpenAI/Codex, both may display a quota chip;
  disable that provider's display in pi-usage if you only want one.

## Install

```bash
pi install /path/to/pi-sub2api-usage
```

## Native OpenAI / Codex

Native providers are recognized automatically; no `"sub2api": true`, admin
credentials, or account-ID mapping is needed. Existing Sub2API configuration
continues to work unchanged.

### `openai-codex`

1. Sign in using `/login openai-codex`.
2. Select a native `openai-codex` model.
3. The statusline shows **remaining** quota and reset countdowns, for example:

```
📊 openai-codex 5h 77% ↻ 1h0m 7d 60% ↻ 3d5h
```

Actual window lengths come from the response (a weekly-only plan is not shown
as a 5-hour limit). `/openai-usage` forces a refresh and displays parsed quota.
API keys are not subscription logins and are explicitly rejected. This is not
OpenAI API billing, prepaid balance, or a per-session token counter.

### `openai` (native Sign in with ChatGPT)

The new native OAuth grant is for `api.openai.com`, **not** the legacy ChatGPT
backend. There is no supported numerical quota API for that grant. By default
this extension reports `ChatGPT connected; quota needs Codex companion` and
never sends its direct-use token to the Codex endpoint.

For **experimental numerical usage**, sign in with both `/login openai` and
`/login openai-codex`, using the **same ChatGPT account and workspace**, then
merge this option into `~/.pi/agent/pi-sub2api-usage.json`:

```json
{
  "openai": { "useCodex": true }
}
```

Select an `openai` model and run `/openai-usage` (or wait for the next refresh):

```
📊 openai plan 5h 77% ↻ 1h0m 7d 60% ↻ 3d5h app 5h 80% ↻ 1h0m
```

- Only the companion **Codex** token is sent to the undocumented
  `https://chatgpt.com/backend-api/wham/usage` and `/chatpass/apps` endpoints.
- The app registration must uniquely match the native OAuth `clientId`. App
  registration matching is **not independent proof** of the same user/workspace;
  the operator must ensure both logins match.
- Plan and app limits are shown separately. `allowed_usage_percent` is not
  remaining quota. Missing/duplicate registrations, pagination, invalid windows,
  or unavailable app data cause an explicit error: Codex-only quota is never
  silently substituted for native OpenAI usage. If the app is absent, no numerical
  app quota is available from this source; check ChatGPT usage settings.
- Manage the authoritative limits at <https://chatgpt.com/settings/usage>.
  The backend is undocumented and can change without notice.

### Refresh, authentication and statusline behavior

- Uses Pi's freshly resolved runtime OAuth (Pi owns token refresh); verifies that
  stored credentials and selected model authorization match. Custom inference
  endpoints/authorization overrides are rejected rather than shown as native.
- OAuth tokens are never copied to the Sub2API token cache or included in UI
  output. A changed login invalidates the in-memory quota cache.
- Refreshes at session start, model switch, turn start and every `refreshMs`
  (default 3 minutes). Failure backoff is 30 seconds; countdowns update every
  minute. Manual refresh bypasses cache/backoff and keeps automatic refresh alive.
- Requests support `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` (including lowercase
  forms), reject redirects and have a 15-second request/body timeout. Switching
  providers or shutting down cancels pending requests and timers.
- Uses the same `sub2api-usage` status key as existing Sub2API chips, with exactly
  one source active at a time. pi-statusline renders it as a normal extension
  status. Ensure extension statuses are visible in your statusline settings.
- Custom credential stores/profiles that cannot be matched to the active
  `auth.json` entry fail closed instead of guessing a different account.

References: [OpenAI token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference),
[ChatGPT plan UX guidance](https://developers.openai.com/siwc/ui-ux-guidelines).

## Configure Sub2API

### 1. Mark providers in `~/.pi/agent/models.json`

```json
"sub2api-claude": {
  "baseUrl": "http://your-instance:8080",
  "api": "anthropic-messages",
  "sub2api": true,
  "models": [ ... ]
}
```

> The account must be a subscription (OAuth) account — API-key relay accounts have no
> quota windows and the usage endpoint returns an error for them.

### 2. Create `~/.pi/agent/pi-sub2api-usage.json`

```json
{
  "baseUrl": "http://your-instance:8080",
  "email": "admin@example.com",
  "password": "your-panel-password",
  "accounts": { "sub2api-claude": 3589 }
}
```

The number is the account id shown in the admin panel's account list. Then:

```bash
chmod 600 ~/.pi/agent/pi-sub2api-usage.json
```

All fields:

| Field | Default | Meaning |
|---|---|---|
| `baseUrl` | derived from the provider's `baseUrl` (trailing `/v1` stripped) | sub2api instance root |
| `email` / `password` | — | admin panel credentials for auto-login; password whitespace is preserved |
| `token` | — | manual access-token override; wins over auto-login, never refreshed |
| `route` | `/api/v1/admin/accounts/{id}/usage` | route template; `{id}` is replaced |
| `method` | `GET` | `GET` or `POST` |
| `usageSource` | `passive` | `passive` (cached) or `active` (upstream query) |
| `accounts` | `{}` | `providerId → account id` mapping |
| `refreshMs` | `180000` | usage cache TTL / refresh interval for Sub2API and native OpenAI |
| `openai.useCodex` | `false` | experimental native `openai` quota via a separate same-account Codex OAuth login |

## Preconditions

- Panel account with admin role (the usage endpoint is admin-only).
- The instance must not require a login captcha (Turnstile / Tencent), and the
  account must not have TOTP 2FA enabled — auto-login cannot pass either. With
  captcha/2FA, use the manual `token` field instead (paste a fresh panel JWT).

## Command

- `/sub2api-usage` — force-refreshes and prints parsed quota for the current
  Sub2API or native OpenAI/Codex provider (backward-compatible command).
- `/openai-usage` — force-refreshes native OpenAI/Codex quota, or explains the
  required login/companion configuration. Select a native provider first.

## Uninstall

```bash
pi remove pi-sub2api-usage
```
