# herdr 子代理工作状态

working 状态、运行数口径、启用条件、等待优先级与失败降级的唯一现状定义见 [herdr-subagents 档案](archive/herdr-subagents/archive.md)。本页保留生效与离线验收操作。

## 生效方式

本功能从本包唯一入口 `src/index.ts` 初始化。若 Pi 已加载**包含本次变更的本地源码**，执行 `/reload` 即可；若加载的是 Git/npm 安装副本，必须先更新那个副本，单改开发仓库或只执行 `/reload` 不会更新安装提交。本次开发没有修改全局安装、settings 或其他仓库。

## 验证

```bash
npm run typecheck
npm test
```

回归覆盖运行数投影（并行/链式/工作流/嵌套/截断）、前台执行与取消、slash、问卷包装顺序、超时与迟到回复、会话重载、非启用环境、统一入口组合，以及真实 Pi ProgramStatusReporter 的去重行为。

### 无模型的真实 herdr-core 验收

从仓库工作目录启动，仅加载本扩展和有限测试驱动；驱动模拟 status RPC，不调用模型，也不启动真实子代理：

```bash
herdr-core run --bg --no-notify --no-parent --name herdr-subagent-qa \
  --cwd "$PWD" -- pi --offline --no-session -ne -ns -np -nc --no-mcp \
  -e ./src/herdr-subagents.ts \
  -e ./tests/helpers/herdr-subagents-driver.mjs

env -u HC_TERMINAL_ID herdr-core send herdr-subagent-qa '/herdr-subagents-count 2'
herdr-core get herdr-subagent-qa --json
# status: {"app":"pi","msg":"正在工作的 subagent：2","state":"working"}

env -u HC_TERMINAL_ID herdr-core send herdr-subagent-qa '/herdr-subagents-count 1'
# get: working + 正在工作的 subagent：1

env -u HC_TERMINAL_ID herdr-core send herdr-subagent-qa '/herdr-subagents-count 0'
# get: done + offline QA

herdr-core keys herdr-subagent-qa ctrl+d
# 等待 get 显示 state=finished 后再删除，不能删除仍运行的终端。
herdr-core rm herdr-subagent-qa
```

2026-11-08 已在 Ubuntu、Node.js 22.23.4、Pi 1.5.0、herdr-core 0.1.14 上执行上述验收；额外同时加载 `pi-herdr-ask/src/index.ts` 与该仓库的真实问卷驱动，观察到：

```text
working / 正在工作的 subagent：2
working / 正在工作的 subagent：1
blocked / question
working / 正在工作的 subagent：1  （Esc 取消问卷）
done / offline QA                （运行数归零）
```

该测试快照始终含一个 queued 子代理和一个 running host command，归零时仍恢复 done，验证它们未被计入。测试终端已正常退出并删除。此记录证明真实 PTY/OSC/herdr-core 消息链路及真实问卷兼容，不冒充真实模型子代理负载或 Windows GUI 验收。
