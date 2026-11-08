# Herdr Subagent Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep herdr working while actual current-session subagents run and display their running count.

**Architecture:** A pure activity projection combines canonical background status snapshots with top-level foreground execution progress, never fleet.totalActive. A reversible Terminal.setProgramStatus wrapper overlays working/count while retaining the latest native state. An event-driven extension adapter manages status RPC, subscriptions, session generations and cleanup.

**Tech Stack:** TypeScript, Node.js >=22.19.0, Pi 1.5.0 public extension/TUI APIs, pi-subagents 0.84.0 public event-bus RPC, node:test.

**Spec:** `docs/superpowers/specs/2026-11-08-herdr-subagent-status-design.md`

## Global Constraints

- Only count running children, not queued/pending, coordinators or host commands; do not double count workflow children.
- Working message: `正在工作的 subagent：N`; truncated snapshots must indicate a lower bound rather than false precision.
- Enable only in TUI + stdout TTY + HC_TERMINAL_ID; preserve blocked and clear, including pi-herdr-ask.
- No core/managed integration edits, model calls, runtime pi-subagents dependency, prompt leakage or periodic polling.
- Restore the latest native state when activity ends; dispose listeners, temporary timers and wrappers on shutdown/reload.

## Review Focus

- Late/reordered status RPC replies after session replacement must not restore old counts (Task 3).
- A running workflow with only a host command must not count as a subagent (Task 1).
- Canonical snapshots and foreground updates describing the same workflow must not double count (Tasks 1, 3).
- Wrapper order with question/auth status and disposal must not erase another extension's wrapper (Task 2).
- Bounded/malformed snapshots and missing RPC providers must not manufacture exact counts or hang shutdown (Tasks 1, 3).

---

### Task 1: Running-child projection

**Files:** Create `src/herdr-activity.ts`, `test/herdr-activity.test.ts`.

**Interfaces:** Produce `countRunningSubagents(snapshot: unknown): { count: number; approximate: boolean }` and a foreground progress tracker with `update(toolCallId: string, details: unknown)`, `close(toolCallId: string)` and a running-count getter. Consume version-1 `pi-subagents.async-status-snapshot` trees and foreground `details.results[]`/`progress[]`. Tracker counts only top-level foreground tool executions; workflow/background children are canonical in snapshots.

- [ ] Write failing tests for single, parallel, chain, workflow children, nested children, completed parents with live descendants, duplicate run/step representation, running host-only workflow, pending/queued exclusions, malformed input, omitted runs/children and byte truncation. Assertions include 2 running + 1 queued => 2, workflow with 2 running agent steps + host step => 2, host-only => 0. Verify distinct children with the same agent name remain distinct.
- [ ] Run `node --experimental-strip-types --test test/herdr-activity.test.ts`; require failure for the missing implementation.
- [ ] Implement bounded validation/projection against installed package data shapes; count child instances, not names or workflow containers. Preserve a lower-bound indicator on omission. Track foreground progress by stable run/index rather than result position and replace snapshots rather than incrementing counters.
- [ ] Run the same test command; require all tests pass.
- [ ] Review the diff and commit this deliverable if commits are authorized.

### Task 2: Reversible terminal overlay

**Files:** Create `src/herdr-status-bridge.ts`, `test/herdr-status-bridge.test.ts`.

**Interfaces:** Produce `attachHerdrStatusBridge(terminal: Pick<Terminal, "setProgramStatus">, initial: ProgramStatus)` returning `{ setActivity(count: number, approximate?: boolean): void; dispose(): void }`.

- [ ] Write failing tests: native done + count 2 => working/message `正在工作的 subagent：2`; native updates while overlay active are captured; 2→1→0 restores the latest native report; native working remains working after count zero. Assert blocked/question, blocked/auth and clear are never replaced. Exercise wrapping before/after a questionnaire wrapper and a subsequently installed third wrapper; disposal is idempotent and does not remove somebody else's wrapper.
- [ ] Run `node --experimental-strip-types --test test/herdr-status-bridge.test.ts`; require failure before implementation.
- [ ] Implement the wrapper using the original method with its receiver, copied native status, finite nonnegative integer counts, and ownership-aware disposal. Approximate positive counts display `正在工作的 subagent：≥N`.
- [ ] Run bridge and projection tests; require all pass.
- [ ] Review the diff and commit this deliverable if commits are authorized.

### Task 3: Session-scoped extension integration and acceptance

**Files:** Create `src/herdr-subagents.ts`, `test/herdr-subagents.test.ts`, `tests/helpers/herdr-subagents-driver.mjs`; modify `src/index.ts`, `test/unified-plugin.test.ts`, `README.md`, `CHANGELOG.md`; add `docs/herdr-subagents.md`.

**Interfaces:** Export default `herdrSubagents(pi: ExtensionAPI): void`; initialize once from `src/index.ts`. Consume Tasks 1–2. Acquire Terminal through a zero-line widget factory immediately removed, following `pi-herdr-ask/src/index.ts` without importing that independent package.

- [ ] Write adapter tests with a mocked event bus/status RPC and real published payload shapes. Cover initial snapshot, ready event, jobs-changed, async start/complete, child-status/process-terminal, foreground update/end (including aborted calls), coalesced refresh during in-flight RPC, RPC timeout/error/malformed reply, generation changes, reload/resume recovery and no activity outside the enable gates. Verify workflow updates do not double count canonical snapshot steps and no work is started or stopped by the adapter. Verify cleanup removes listeners/timers and ignores late responses.
- [ ] Run `node --experimental-strip-types --test test/herdr-subagents.test.ts`; require failure before implementation.
- [ ] Implement the read-only public RPC adapter. Subscribe before the first status request, use request IDs and bounded timeouts, retain a dirty refresh during requests, and invalidate old generations at shutdown. Read counts from asyncSnapshot rather than fleet.totalActive; track only top-level foreground execution progress separately. Preserve native blocked/clear through Task 2. Add startup to the existing unified entry without changing previous feature ordering.
- [ ] Add a unified-entry composition test proving bridge registration and shutdown coexist with existing status providers and do not replace the footer. Add README/changelog documentation including enable gates, strict count semantics, limitations and `/reload` activation for the loaded local source (Git-installed copies need an explicit update).
- [ ] Run `npm run typecheck && npm test && git diff --check`; require all commands succeed.
- [ ] Use a finite offline Pi driver that simulates public status RPC and lifecycle events (not an actual delegated model run). Launch in a temporary herdr-core terminal with the new extension, verify JSON/events for 0→2→1→0 and blocked/question precedence, then close only the test terminal. Record exact commands/results and distinguish protocol evidence from untested Windows GUI behavior in `docs/herdr-subagents.md`.
- [ ] Review the full diff against the approved spec, rerun relevant tests after corrections, and report changed paths, evidence and deployment steps. Commit only if authorized; no push/install/global settings changes are part of this request.
