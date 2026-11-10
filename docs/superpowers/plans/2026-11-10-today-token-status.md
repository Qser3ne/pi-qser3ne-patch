# Today Token Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将状态栏 token 总量及 CH 范围改为本地今日零点至当前。

**Architecture:** 保留 collector 与布局配置，只替换控制器的范围构造。同步菜单生成脚本与当前文档，不更改独立命令。

**Tech Stack:** TypeScript、Node.js node:test、现有 vendored collector/statusline。

**Spec:** `docs/superpowers/specs/2026-11-10-today-token-status-design.md`

## Global Constraints
- 使用运行 Pi 的本机时区，日历日零点至本次查询开始时刻，两端包含。
- 保留 `usage24h` 配置键、现有显示格式、模型范围、去重和刷新机制。
- 不改变独立 `/token 24h` 和 `/token-usage` 命令。

## Review Focus
- 非 UTC 时区零点不得被误算为 UTC 零点。
- 夏令时切换日必须采用当地日历零点。
- 跨日后周期刷新必须切换起点。
- 零点及当前端点计入，零点之前与未来记录不计入，CH 仅使用当日数据。
- vendored 菜单重新生成后不得恢复滚动 24h 文案。

### Task 1: Today window and compatible presentation

**Files:**
- Modify: `src/rolling-token-usage.ts`, `test/rolling-token-usage.test.ts`
- Modify: `scripts/vendor-pi-statusline.mjs`, `vendor/pi-statusline/src/commands.ts`, `test/bundled-loader.test.ts`
- Modify: `README.md`, `package.json`, `CHANGELOG.md`, `vendor/pi-statusline/README.md`, `docs/rolling-token-status.md`, `docs/archive/rolling-token-status/archive.md`, `docs/archive/extension-package/archive.md`

**Interfaces:**
- Consumes existing `collectUsage(options)` and `TimeRange { start, end, amount, unit }`.
- Preserves `createRollingUsageController(options)` and `formatRollingUsage(report?, failed?)` APIs.

- [x] Add failing controller tests: assert local midnight start and fixed end; test midnight rollover and TZ=Asia/Shanghai, America/New_York DST days; feed boundary records with different cache rates through real collector and assert only today contributes.
- [x] Run `node --experimental-strip-types --test test/rolling-token-usage.test.ts`; confirm new tests fail because start is now minus 24h.
- [x] Replace parseRange use with a local Date midnight calculation, capturing now once per scan; represent elapsed hours as amount and unit h.
- [x] Update menu text to “since local midnight” in generator and generated commands; update loader text assertion. Update current docs/archive and changelog, keeping legacy config name explicit.
- [x] Run targeted tests, `npm test`, `npm run typecheck`, timezone variants and `git diff --check`; require all pass.
- [x] Self-review diff and archive consistency; independent read-only review found no runtime issues; reproduced and corrected the UTC+14 fixture failure, then reran the suite. Leave changes uncommitted unless user requests integration.
