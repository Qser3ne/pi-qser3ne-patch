# codex-fast

## Purpose

定义两个 Codex 账号的 Fast 偏好、能力验证、请求路由与费用显示。

## Requirements

### Requirement: 适用范围

Fast SHALL 仅用于 openai-codex 和 openai-codex-1、openai-codex-responses 协议且 URL origin 为 https://chatgpt.com 的模型；MUST 不扩展到原生 openai 或代理 origin。

#### Scenario: 不支持的提供商或端点

- **WHEN** 用户尝试在不符合范围的模型开启 Fast
- **THEN** SHALL 显示原因，不开启 Fast，也不因本功能修改该请求的 service_tier

### Requirement: 公开控制与共享偏好

/fast SHALL 无参数切换 Fast，TUI/RPC 中可用；带参数 MUST 拒绝。/usage 的 Fast 控件 SHALL 使用同一偏好。

#### Scenario: 两账号间切换

- **WHEN** 用户在一个账号开启 Fast 后切换另一个账号
- **THEN** codexFastMode 偏好 SHALL 通过 pi-usage.json 共享
- **AND** 每个账号的能力和认证仍 MUST 独立验证
- **AND** 默认偏好为关闭

### Requirement: 开启前验证当前账号

开启 Fast MUST 基于当前提供商的运行时 OAuth 和模型目录确认模型支持，不得借用另一个账号的凭据、缓存资格或能力结论。

#### Scenario: 缺少资格、目录失败或认证变化

- **WHEN** 能力未知、不支持，或验证期间账号/模型/会话改变
- **THEN** SHALL 不把本次开启保存为成功，不使用未确认的 priority 路由
- **AND** 会话关闭 SHALL 取消待完成验证

### Requirement: 能力查询的网络隔离

Fast 的能力目录查询 SHALL 尊重环境代理和 NO_PROXY，使用请求级 dispatcher；MUST 不替换宿主全局 fetch 或 dispatcher。

#### Scenario: 目录查询结束或取消

- **WHEN** 请求成功、失败、超时或被取消
- **THEN** SHALL 在有界响应消费后清理本次代理资源，不把该请求的网络配置泄漏到宿主其他请求

### Requirement: 请求路由

适用模型开启且支持 Fast 时 SHALL 请求 service_tier=priority；否则 SHALL 使用 default，并保留其他请求字段。

#### Scenario: 偏好开启但能力未知

- **WHEN** 适用模型请求开始时能力未确认
- **THEN** SHALL 采用标准路由，不仅凭全局开关请求 priority
- **AND** 与 [Daybreak](../daybreak-blue/archive.md) 参数同时存在时不得丢失对方字段

### Requirement: 状态与费用

第二账号开启且有效时 SHALL 显示 ⚡ fast，开启但未知时 SHALL 显示 ⚡ fast unknown；费用修正 MUST 只对应实际 Fast 请求，且同一结果不得重复计费。

#### Scenario: 显示 Fast 结果费用

- **WHEN** 适用模型的 Fast 请求返回完整 token 用量
- **THEN** SHALL 基于模型价目重新计算费用，gpt-5.5 使用 2.5 倍，其他适用模型使用 2 倍
- **AND** 本地费用估算 MUST 不被描述为服务端账单或提速保证

### Requirement: 设置损坏保护

pi-usage.json 无效时 MUST 不通过 Fast 操作覆盖该文件。

#### Scenario: 无效配置下切换 Fast

- **WHEN** 解析或验证设置失败
- **THEN** SHALL 提示修复并重载，不保存此次切换；已有未知字段保留规则见 [内置 usage](../provider-usage/archive.md)
