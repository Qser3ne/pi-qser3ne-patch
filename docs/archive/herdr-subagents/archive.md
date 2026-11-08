# herdr-subagents

## Purpose

定义当前 Pi 会话的子代理工作数对 herdr-core 根状态的影响，不改变子代理本身的调度或权限。

## Requirements

### Requirement: 启用边界

本能力 SHALL 仅在 TUI、stdout TTY、非空 HC_TERMINAL_ID、PI_PROGRAM_STATUS 不为 0 且 PI_SUBAGENT_CHILD 不为 1 时启用。MUST 不向 RPC/JSON/print 或普通终端写入额外状态序列。

#### Scenario: herdr-core 交互会话

- **WHEN** 启用条件满足且宿主提供 Terminal.setProgramStatus
- **THEN** SHALL 通过宿主 OSC 7501 根状态协议工作，不修改 herdr 托管集成
- **AND** 此能力不承担旧 HERDR_SOCKET_PATH 协议的状态修复

### Requirement: 运行中子代理计数

当前会话实际 running 的子代理实例 SHALL 分别计数；MUST 不把 queued/pending、已完成/失败/暂停、工作流协调器或 host command 当作运行中的子代理。

#### Scenario: 并行、链式、工作流和嵌套子代理

- **WHEN** 状态包含多个同名 agent 实例、已结束步骤或嵌套运行
- **THEN** SHALL 按实例及稳定步骤身份计算，不按名称合并，不重复计算容器与其步骤
- **AND** 已结束协调器下仍独立工作的子代理 SHALL 按运行状态计入

### Requirement: 工作状态覆盖及恢复

运行数为正时，根状态 SHALL 为 working，消息 MUST 为 正在工作的 subagent：N；herdr JSON 中消息字段 SHALL 为 status.msg。

#### Scenario: 主代理已结束但子代理继续

- **WHEN** 主代理报告 done/idle 而仍有运行中的子代理
- **THEN** SHALL 保持 working 并显示当前数值
- **AND** 运行数归零 SHALL 恢复最近的 Pi 原生状态，而不是固定改为 idle

### Requirement: 等待用户和清除状态优先

原生 blocked/question、blocked/permission、blocked/auth 与 clear MUST 不被工作数覆盖。

#### Scenario: pi-herdr-ask 问卷

- **WHEN** 问卷等待用户回答或取消
- **THEN** SHALL 保持 blocked/question，不因子代理数变化而改回 working
- **AND** 问卷关闭后仍有子代理时 SHALL 恢复 working/count；两种包装加载顺序均不得破坏恢复
- **AND** 卸载自身包装时 MUST 不移除其他扩展后来安装的包装

### Requirement: 前台和后台归属

本能力 SHALL 观察当前会话的后台 status 快照及前台 subagent 工具/slash 进度；后台或工作流进度 MUST 不再作为前台重复计数。

#### Scenario: codemode 或 slash 启动前台调用

- **WHEN** 当前父会话通过 subagent 工具的嵌套调用或 slash 桥接执行前台子代理
- **THEN** SHALL 按进度中 running 步骤更新，结束/取消结果后撤销对应计数
- **AND** 本能力 MUST 不启动、停止或修改任何子代理，不向状态消息传播任务正文或用户答案

### Requirement: 会话替换与事件驱动刷新

本能力 SHALL 在开始/重载/恢复时读取后台状态，并在子代理变化事件后合并刷新；MUST 不增加常驻周期轮询。

#### Scenario: 旧请求迟到或会话关闭

- **WHEN** 关闭、重载或替换会话
- **THEN** SHALL 撤销自身覆盖、退订并清理临时定时器
- **AND** 旧会话的迟到回复 MUST 不改变新会话状态

### Requirement: 有界快照和失败降级

快照截断或部分无效时 MUST 不将已知计数当作精确总数；正数下界 SHALL 显示为 正在工作的 subagent：≥N。

#### Scenario: RPC 失败或两秒内无响应

- **WHEN** status RPC 出错、快照不支持或 2000ms 超时
- **THEN** SHALL 撤销后台覆盖，保留最新原生/前台状态
- **AND** 不凭过去数值永久维持 working，后续变化事件可重新恢复

### Requirement: 兼容性和验收范围

本能力 SHALL 基于 Pi 1.5.0、pi-subagents 0.84.0 与 herdr-core 0.1.14 已验证的消息形状；MUST 不把协议验收描述为未经执行的 Windows GUI 验收。

#### Scenario: 上游版本或界面差异

- **WHEN** 升级 subagents 或确认 Windows 图形界面显示
- **THEN** SHALL 分别检查公开 status 快照、额外 slash 桥接事件形状和 GUI 消息可见性
- **AND** 后台投影与 25ms 合并延迟不保证逐进程零延迟观测
