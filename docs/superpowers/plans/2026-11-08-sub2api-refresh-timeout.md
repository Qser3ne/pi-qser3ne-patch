# Sub2API Refresh / Timeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复手动检查停止自动刷新、响应体读取未受超时保护的缺陷。
**Architecture:** 复用现有发布/调度和 generation 归属检查；延长现有请求定时器的生命周期至 JSON 读取结束。
**Tech Stack:** TypeScript、Node.js >=22.19.0、node:test、现有 Pi 1.5.0 宿主接口。
**Spec:** docs/superpowers/specs/2026-11-08-sub2api-refresh-timeout-design.md

## Global Constraints

- 默认 refreshMs=180000ms、倒计时=60000ms、失败退避=30000ms、每次 HTTP 请求超时=15000ms。
- 不增加依赖、不改变配置文件/认证/原生 OpenAI/herdr。
- 保留手动命令结果通知与现有 401 即时重试次数。
- 不修改全局安装、不推送；提交/合并按操作者本轮决定执行。

## Review Focus

- 手动检查前已有自动定时器：不得留下重复检查；Task 1。
- 手动失败后长时间无新事件：仍须自动检查；Task 1。
- 检查返回前关闭、切换、再执行检查：不得恢复旧定时器；Task 1。
- 响应头到达但 JSON 永不结束：超时和取消都须终止读取；Task 2。
- 请求完成或解析失败：不得留下迟到的超时中止；Task 2。

### Task 1: 恢复手动查询后的调度

**Files:** src/statusline.ts、test/runtime.test.ts。
**Interfaces:** 保持 Runtime.runManualCheck(ctx): Promise<void> 及 RuntimeDeps 不变。

- [ ] 为成功后的 60000ms 倒计时、180000ms 自动刷新、失败后的 30000ms 自动检查及关闭/切换/新检查隔离写回归测试。
- [ ] 运行 node --experimental-strip-types --test test/runtime.test.ts，确认新增用例因缺少调度失败。
- [ ] 成功复用 publishResult；失败安排现有退避检查；保留 generation 防护。
- [ ] 重跑 runtime 测试，确认全部通过。

### Task 2: 保护完整响应体读取

**Files:** src/auth.ts、src/sub2api.ts；新增 test/sub2api-timeout.test.ts（两条公开函数的本机 HTTP 回归）。
**Interfaces:** 保持 login(options): Promise<TokenState> 与 fetchAccountUsage(options): Promise<AccountUsage>、timeoutMs/signal 接口不变。

- [ ] 用本机 HTTP 服务器发送响应头和不完整 JSON，分别验证登录与额度请求的超时、外部取消；补充成功/解析错误后定时器清理检查。
- [ ] 运行 node --experimental-strip-types --test test/sub2api-timeout.test.ts，确认响应体超时回归在现有实现失败。
- [ ] 将现有超时清理 finally 扩大至响应体读取；不把中止包装成普通 JSON 错误，解析后检查取消状态。
- [ ] 运行 auth/sub2api/timeout 测试并确认全部通过。

### Task 3: 档案、完整验证与交付

**Files:** docs/archive/sub2api-usage/archive.md、CHANGELOG.md。
**Interfaces:** 不新增运行时接口。

- [ ] 按实现更新手动成功/失败恢复调度与完整请求超时契约。
- [ ] 运行 npm run typecheck、npm test、git diff --check，检查无失败。
- [ ] 自查范围及竞态；按操作者决定保留分支或提交并本地合并；不声称进行了真实账号验收。
