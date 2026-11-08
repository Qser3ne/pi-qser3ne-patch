# Herdr subagent working 状态与计数

## 意图与已批准范围

用户要求在 `pi-qser3ne-patch` 中修复：主代理结束当前回复后，后台子代理仍工作时，herdr 不应显示 done/idle。用户已批准以下短设计，并明确选择只统计实际运行中的子代理。

- 当前会话存在运行中的 subagent 时，将 herdr 根状态保持为 `working`，消息为 `正在工作的 subagent：N`。
- 数量随启动、完成、失败、取消变化；不计 queued/pending、已完成任务、工作流协调器和 host command。
- 前台、后台、并发及工作流子代理不能重复计数；重新加载后恢复当前会话的后台工作。
- 没有运行中的子代理时恢复最新 Pi 原生状态；blocked（包括 question/permission/auth）与 clear 优先，不覆盖等待用户或退出状态。
- 与独立 `pi-herdr-ask` 的状态包装兼容，关闭/重载时退订并撤销自己的包装。

## 现状与约束

Pi 1.5.0 的 ProgramStatusReporter 只根据主代理生命周期计算根状态。已安装 pi-subagents 0.84.0 的旧 herdr 元数据桥接只在 HERDR_ENV/HERDR_PANE_ID 下启用，发出的 herdr:busy 未被旧 herdr Pi 集成消费。当前环境是 herdr-core，使用 HC_TERMINAL_ID 与 OSC 7501；仅修补旧 socket 桥接不能解决当前环境。

pi-subagents 的公开事件总线 RPC 提供 status、asyncSnapshot 与变化通知。fleet.totalActive 包含 pending/queued 及工作流协调器，不能直接当作用户要求的运行中子代理数。asyncSnapshot 有有界树和 omitted 标记，不能把截断后的数量冒充精确总数。

- 使用现有 TypeScript/Node.js >=22.19.0、Pi 1.5.0 公共扩展与 Terminal.setProgramStatus API。
- 仅 TUI + stdout TTY + HC_TERMINAL_ID 的 herdr-core 环境启用，不改变 RPC/JSON/print 输出。
- 不修改 herdr 托管文件、pi-subagents 源码、Pi 核心，不安装运行时 pi-subagents 依赖，不调用模型。
- 事件驱动刷新，只允许合并突发事件的短定时器和有界 RPC 超时，不增加常驻轮询。
- 计数只上报数值，不泄露 prompt、答案、任务正文。快照截断时显示保守下界（如 `≥N`），不伪造精确数量；错误/不可用时不编造活跃数。

## Approaches

1. 修改 `herdr-agent-state.ts` 消费 herdr:busy：改动少，但托管文件会被覆盖，且当前 herdr-core 环境没有旧 HERDR_* 门控条件；不采用。
2. 直接采用 fleet.totalActive：公开接口且简单，但把排队、工作流整体算成子代理；用户明确未选择。
3. 在统一扩展中增加可撤销 OSC 7501 状态桥接：通过公开状态快照及前台执行进度计算实际运行子代理，保留 Pi 原生状态和 blocked 优先级。采用此方案。

## 边界与验证

计数投影、状态包装、事件/RPC生命周期分开测试；模拟实际 pi-subagents 数据形状，覆盖并发、链式、工作流、无子代理的 host 工作、截断、异步旧响应、会话切换与包装安装顺序。沿用现有测试体系；补充不调用模型的真实 herdr-core/PTY 协议验收。Windows 图形界面的显示若未实际验证，最终说明中明确区分协议验收和 GUI 验收。
