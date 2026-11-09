# Rolling Token Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show `📊 12.3M CH 85.2%` for rolling 24-hour local usage between context and time.

**Architecture:** Vendor the pinned pi-token-usage collector (without its extension entry) and pi-statusline 0.50.2 source with reproducible, assertion-guarded patches. A separate asynchronous usage controller supplies cached text and render notifications to the integrated statusline. Preserve existing configuration/commands; independent statusline entry must be disabled when deploying.

**Tech Stack:** TypeScript, Node >=22.19.0, Pi extension API, node:test; existing runtime dependencies only.

**Spec:** `docs/superpowers/specs/2026-11-09-rolling-token-status-design.md` (approved with icon-only format).

## Global Constraints

- TUI only; no global config changes, remote pushes, or installed-copy updates in this development round.
- Scope exactly matches `/token 24h`: scopedModels or modelRegistry.getAvailable(), cross-project saved history.
- Cache rate = cacheRead / (input + cacheRead + cacheWrite), summed over the window.
- Reuse `pi-token-usage/cache-v1`; no runtime imports from sibling repositories, no duplicate /token registrations.
- Loading `📊 …`, empty `📊 0 CH —`, errors unavailable, partial totals explicitly marked.
- Async single-flight refresh, event coalescing, 60000ms periodic refresh, session generation guards and shutdown cleanup.
- Preserve existing statusline configuration, commands, responsive layout, other status chips and unified features.

## Review Focus

- Existing explicit segment arrays need insertion without repeated additions or disabling the ability to hide/reorder the new segment (Task 2).
- Model/session replacement during a slow scan must not publish stale data (Task 1).
- Subagent summaries and inherited forks must not inflate totals (Task 1, collector parity).
- Narrow terminals, multiline settings and ANSI-256 rendering must remain bounded (Task 2).
- Production installation must not depend on devDependencies or sibling directories; standalone statusline conflicts require clear migration instructions (Task 3).

---

### Task 1: Rolling usage controller and collector parity

**Files:** Create `scripts/vendor-token-usage.mjs`, `vendor/pi-token-usage/{cache,collector,memory-cache,query,reader,subagents,types}.ts`, provenance README/upstream.json; create `src/rolling-token-usage.ts`, `test/rolling-token-usage.test.ts`.

**Interfaces:** `formatRollingUsage(report?: UsageReport, failed?: boolean): string` returns value without icon; `createRollingUsageController({agentDir, collect?, now?, setInterval?, clearInterval?, setTimeout?, clearTimeout?})` returns `{getText(): string, refresh(ctx): void, start(ctx, onChange): void, dispose(): void}`. The collector signature matches vendored `collectUsage`; controller freezes allowedModels and uses session roots and fixed `now - 86400000 .. now` range on each run. Default refresh debounce 250ms, periodic 60000ms; failed/partial visible values are `unavailable`/`~<total> CH <rate>`.

- [ ] Write tests for `12.3M CH 85.2%`, aggregate rather than mean cache rate, empty/loading/error/partial states; test collector parity using temp session histories with forks/subagent summaries.
- [ ] Run `node --experimental-strip-types --test test/rolling-token-usage.test.ts`; confirm missing-module/assertion failure.
- [ ] Add reproducible collector vendoring pinned to commit `295bfb579ff4d159683f6400cffdeb683c461b54`, implement format/controller with injected collector and timers; memory SnapshotCache reused across refreshes.
- [ ] Add lifecycle tests: fixed cutoff, allowed model list, cache/root arguments, event burst single flight, idle periodic refresh, shutdown/stale results/session switch/model change, failure recovery; run focused tests until green.
- [ ] Commit task files after review.

### Task 2: Integrated statusline and native segment

**Files:** Create `scripts/vendor-pi-statusline.mjs`, `vendor/pi-statusline/src/**` with LICENSE, README and upstream.json; create `test/rolling-statusline.test.ts`; modify `src/index.ts`, `package.json`, `package-lock.json` (manifest metadata if needed), existing unified tests.

**Interfaces:** Vendored statusline default `(pi: ExtensionAPI): void`; generated source imports controller from `../../../src/rolling-token-usage.ts` in statusline.ts. RuntimeState gains `rollingUsageText?: string`. New SegmentName `usage24h`; default prefix `📊 `; runtime block; retention priority 85 (below tools, above cwd). Controller starts only in tui footer setup, disposes on replaced contexts/shutdown, requests render on updates; turn_end/agent_end/model_select request refresh.

- [ ] Write tests expecting new supported segment, default insertion directly after context, correct rendered context → icon+value → time order, one /statusline and no /token registration. Confirm failure before implementation.
- [ ] Vendor pinned upstream source with relative `.js` imports converted to `.ts` for Node/Pi; assertion-guard patches add `usage24h` to types, settings, profile layouts, command labels/help, palette block lookup, render switch, fitting priorities and lifecycle. Preserve upstream LICENSE and source hashes.
- [ ] Old documents that omit `usage24h` receive an in-memory inserted default unless they explicitly contain `segmentText.usage24h` (the opt-out/custom-layout marker); never rewrite configuration during load. Existing empty/without-context layouts stay untouched. Saves from the integrated menu persist the new segment presentation so hiding it remains effective. Add migration tests covering old/current/custom/empty/invalid/multiline configurations.
- [ ] Initialize integrated statusline once from unified entry; adjust old no-footer tests to allow exactly the integrated owner; verify other status handlers still coexist.
- [ ] Run focused render/config/lifecycle tests; for widths 1..240 verify visibleWidth <= width and context survives before usage; verify trueColor=false, partial/error values, custom icon, settings menus and footer cleanup.
- [ ] Commit task files after review.

### Task 3: Production verification, docs and integration review

**Files:** Modify `test/bundled-loader.test.ts`, README.md, CHANGELOG.md, `docs/archive/extension-package/archive.md`; create `docs/archive/rolling-token-status/archive.md`, `docs/rolling-token-status.md` and verification evidence.

- [ ] Add production-loader assertions: only one /statusline, rolling segment supported, all prior commands preserved, sandbox has runtime deps only. Add deterministic regeneration test using source hashes (vendor scripts to a temp directory) to detect hand-edited vendor output.
- [ ] Run the new production/regeneration tests, confirm the additional assertions exercise the delivered entry.
- [ ] Document local-source activation and fixed Git-copy update as separate choices; independent `npm:@narumitw/pi-statusline@0.50.2` must use `{source: ..., extensions: []}`, keep pi-token-usage active; explain saved-history scope, refresh, partial/error states, `usage24h` formatting/layout and opt-out.
- [ ] Run `npm run typecheck && npm test`; inspect `git diff --check`, dependency boundaries and all new/changed files. Any failure remains open until resolved.
- [ ] Review implementation against spec and Review Focus, address findings and rerun impacted/full verification.
- [ ] Commit verified work; offer integration options without pushing, changing global settings or deleting the workspace automatically.
