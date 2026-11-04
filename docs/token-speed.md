# Token speed / TTFT

An internal module of `pi-qser3ne-patch` (formerly the standalone `pi-token-speed` extension) that shows the live
token generation speed (tok/s) and time-to-first-token (TTFT) in the TUI statusline.
It publishes under the status key `token-speed`, so `@narumitw/pi-statusline` picks it up
automatically.

Statusline preview:

```
⚡ ~42.3 tok/s · TTFT 820ms · 38.1 tok/s
```

- `~42.3 tok/s` — instantaneous speed while streaming (sliding window, estimated from deltas);
  after the message ends it becomes the message average, using the provider's real
  `usage.output` when available (`~` is dropped when the count is exact)
- `TTFT 820ms` — average time-to-first-token over the last 5 requests; shown as soon as
  the first delta arrives and retained between messages, including while waiting for the next response
- `38.1 tok/s` — aggregate speed of all messages completed in the last 10 minutes
  (generation time only; idle and tool-execution time are excluded)

## How it works

- Estimates tokens from `text` / `thinking` / `toolcall` deltas (CJK ≈ 1 token/char,
  other text ≈ 4 chars/token) and computes speed over a sliding window starting at the
  first token, so first-packet latency is not counted.
- A fixed-rate timer re-renders while streaming, so the number decays naturally when the
  stream stalls instead of freezing on a stale value.
- If a proxy buffers the whole response and emits it at once (first-to-last delta gap
  shorter than 300 ms), the speed is meaningless and `--` is shown.
- Statistics are per assistant message, so tool-execution time is naturally excluded.
- Does nothing outside the TUI (print / json / rpc modes).

## Install

```bash
pi install git:github.com/Qser3ne/pi-qser3ne-patch
```

Remove the old standalone source shown by `pi list` with `pi remove <exact-source>` and run `/reload` to avoid duplicate handlers. The unified `src/index.ts` initializes `src/token-speed.ts`; original Git history is preserved.

## Development

```bash
npm ci
npm test
npm run typecheck
```

## Uninstall

```bash
pi remove <exact-pi-qser3ne-patch-source-from-pi-list>
```
