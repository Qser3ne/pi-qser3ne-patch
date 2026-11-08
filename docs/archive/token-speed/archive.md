# token-speed

## Purpose

定义 TUI 中生成速度、首 token 延迟及跨消息统计的可观察口径。

## Requirements

### Requirement: 仅在 TUI 显示

速度统计 SHALL 仅在 ctx.mode=tui 且 hasUI 时工作，发布 token-speed 状态项，不替换 footer。

#### Scenario: 非交互模式或关闭会话

- **WHEN** 运行于 RPC/JSON/print 或会话关闭
- **THEN** SHALL 不启动该模式的速度显示；关闭时停止渲染定时器并清除已发布状态

### Requirement: 瞬时速度与估算

流式 text/thinking/toolcall delta SHALL 参与 token 估算；中日韩等覆盖字符按约 1 token/字符，其余按约 4 字符/token。瞬时值 SHALL 使用最近 2 秒滑动窗口，每 250ms 重绘。

#### Scenario: 流式响应停顿

- **WHEN** 首 token 到达后已满足 300ms 最短统计跨度，之后流暂时停顿
- **THEN** SHALL 随时间更新估算速度，而不是冻结为最后一个 delta 时的速度
- **AND** 瞬时速度 SHALL 带 ~ 标记，不把估算当作服务端实测 token 数

### Requirement: TTFT 平均值

TTFT SHALL 从请求发出事件到首个 delta 计算，保留最近 5 次请求的平均值；无请求事件时 SHALL 使用消息开始时间作为回退。

#### Scenario: 首个 delta 与下一请求等待

- **WHEN** 首个 delta 到达
- **THEN** SHALL 立即显示 TTFT，不等待速度窗口成熟；0ms 也是有效样本
- **AND** 后续消息开始或尚无 delta 的等待阶段 SHALL 保留已有平均 TTFT

### Requirement: 单条消息平均速度

消息结束时 SHALL 优先使用正数 usage.output，否则使用估算 token；时间 SHALL 从首个 token 起到消息结束，不计首包等待。

#### Scenario: 代理整段缓冲或有效跨度不足

- **WHEN** 首末 delta 间隔小于 300ms，或 token 数不为正
- **THEN** SHALL 显示 --，不声称该响应具有有效生成速度

#### Scenario: 完整流结束

- **WHEN** 响应具备有效时间跨度
- **THEN** SHALL 显示本条消息平均 tok/s；真实 usage.output 可用时不标估算，否则保留 ~ 标记

### Requirement: 最近十分钟聚合

最近 10 分钟统计 SHALL 为已完成有效消息的总 token 除以总生成时长，不是消息速度的简单平均；MUST 不计消息间空闲或工具执行时长。

#### Scenario: 多条消息与新会话

- **WHEN** 有多条有效消息完成
- **THEN** SHALL 聚合时间窗口内的记录
- **AND** 新会话 SHALL 清空记录与 TTFT 样本，不继承上一会话统计

### Requirement: 数值显示

速度小于 100 时 SHALL 保留一位小数，达到 100 时 SHALL 显示整数；TTFT 小于 1000ms 时 SHALL 显示毫秒，否则 SHALL 以一位小数秒显示。

#### Scenario: 状态行同时包含各项统计

- **WHEN** 瞬时/消息速度、TTFT 和长期统计均可用
- **THEN** SHALL 显示类似 ⚡ ~42.3 tok/s · TTFT 820ms · 38.1 tok/s 的组合
- **AND** 未积累的统计项 SHALL 不编造默认数值
