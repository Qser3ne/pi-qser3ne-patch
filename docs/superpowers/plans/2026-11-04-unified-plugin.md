# Unified Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge Daybreak and token speed into one pi-qser3ne-patch plugin/repository, preserving history, publishing it and migrating the installed package.

**Architecture:** Keep behavior in internal modules registered by src/index.ts, including the existing vendored pi-usage initializer. Merge source history without rewriting original commits, then retire the two parent gitlinks. Publish the tested target before updating the parent and the installed pinned ref.

**Tech Stack:** TypeScript, Node.js >=22.19.0, node:test, Pi 1.5.0 development baseline, Git submodules.

**Spec:** ../specs/2026-11-04-unified-plugin-design.md

## Global Constraints

- One package named pi-qser3ne-patch; pi.extensions is exactly ["./src/index.ts"].
- Preserve all commands, status keys, session entry types, config names and account isolation.
- Do not broaden Daybreak's provider/endpoint allowlist or change model defaults.
- Keep vendor regeneration and licensing intact; host Pi packages remain peers, not runtime dependencies.
- Back up repositories and settings outside the workspaces. No force pushes or deletion of old GitHub repositories.
- Do not stage unrelated parent .pi/ files or access real account credentials for tests.

## Review Focus

- Request transformations must retain both access_programs and service_tier, while speed hooks return no payload override.
- Multiple lifecycle handlers must all remain registered within the same extension.
- Production-only loading must work without development dependencies or the old source directories.
- Prior Daybreak branch state and token-speed non-TUI behavior must remain compatible.
- A failed push/install must not leave settings pointing at an unpublished commit or silently discard old history.

---

### Task 1: Back up and import source history

**Files:** target docs/superpowers/{specs,plans}/2026-11-04-*; temporary imported history under migration/{daybreak,token-speed}/.
**Interfaces:** Produces source HEAD records, verified Git bundles and a target integration branch retaining both source HEADs as ancestors.

- [x] Create timestamped external backup directory, Git bundles for parent/three children, settings backup and source HEAD inventory; verify every bundle.
- [x] Use using-git-worktrees to create an isolated target branch/worktree. Commit approved design and plan there.
- [x] Run existing tests/typecheck in all three source projects and record baseline results before modifying product code.
- [x] Fetch each local source into a named temporary ref; merge with --allow-unrelated-histories --no-commit -s ours and import its tree under migration/<name>/ with git read-tree --prefix. Commit each import, retaining original history.
- [x] Assert git merge-base --is-ancestor for both recorded source HEADs.

### Task 2: Unify plugin and preserve behavior

**Files:** src/index.ts; new src/daybreak.ts and src/token-speed.ts; package.json/package-lock.json; test/bundled-loader.test.ts; new test/unified-plugin.test.ts; migrated token-speed tests; tests/daybreak*.mjs and tests/helpers/daybreak.mjs; README.md/CHANGELOG.md; docs/daybreak.md and docs/token-speed.md.
**Interfaces:** daybreak(pi: ExtensionAPI): void, tokenSpeedExtension(pi: ExtensionAPI): void and vendored default usageExtension initializer all register on the same ExtensionAPI. Existing createRuntime export remains available.

- [x] Change bundled-loader assertions to require one path/extension and exactly one each of daybreak, fast, usage, openai-usage, sub2api-usage plus one openai-codex-1 registration. Run the focused test and confirm failure on the old two-entry manifest.
- [x] Add composition regression tests exercising the actual unified factory/loader: multiple lifecycle handlers retained, access_programs.cyber=daybreak_blue and Fast service_tier survive the chained hooks, speed TTFT updates and shutdown clears its status. Test unsupported provider behavior and no footer override. Confirm tests fail before implementation.
- [x] Move imported code to src/daybreak.ts and src/token-speed.ts; migrate all tests, changing imports only except manifest expectations. Move old README behavior details into docs and remove temporary imported package/lock/tsconfig files.
- [x] Initialize modules from src/index.ts in previous relative event order: token speed, Daybreak, quota/account registration, vendored usage. Declare only that entry in package.json; preserve vendor source and regeneration script.
- [x] Set package version to 0.5.0 and Node floor >=22.19.0; unify dev host packages at 1.5.0 and import Daybreak's statusline/jiti/ws test dependencies. Include all migrated tests in npm test, retain unit/integration scripts. Regenerate lockfile.
- [x] Run npm ci, npm run typecheck and npm test; repair migration incompatibilities without changing established functionality. Run production bundled loader against the installed host as an additional check.
- [x] Update README, detailed feature docs and CHANGELOG for unified installation, old package removal, one entry and no separate vendor-entry disabling. Preserve vendor MIT attribution.
- [x] Review diff, ensure no references to sibling source directories, and commit implementation with passing tests.

### Task 3: Publish and migrate the parent/install

**Files:** parent .gitmodules, README.md and gitlinks; ~/.pi/agent/settings.json; managed Git package installation.
**Interfaces:** Consumes verified target commit; produces published target/parent main branches and one configured pinned package source.

- [x] Run final clean-install tests and review source ancestry, single-entry loading and diff. Fast-forward target main to the verified integration branch; fetch remote and reject divergent history rather than force push.
- [x] Push target origin/main and verify remote SHA equals local SHA before changing the installation.
- [x] Remove old parent gitlinks/.gitmodules sections using submodule-aware Git commands only after backups and ancestry verification. Update parent README to document one package and historical source migration; leave unrelated .pi/ untouched.
- [x] Commit the parent with the new target pointer, push normally and verify remote SHA.
- [x] Back up settings again immediately before migration. Install git:github.com/Qser3ne/pi-qser3ne-patch@<verified SHA>, then remove the exact old Daybreak/token-speed sources. Preserve all unrelated settings and disabled standalone pi-usage configuration.
- [x] Verify pi list/configured sources, installed repository HEAD, package manifest and actual resource discovery. Check no old auto-discovered copies add duplicate commands. Restore settings backup if installation cannot be completed.
- [x] Report commits, test totals, backup path and /reload requirement; remove temporary worktree when no longer needed, retain backup bundles.
