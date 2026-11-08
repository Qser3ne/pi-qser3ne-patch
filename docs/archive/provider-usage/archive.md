# provider-usage

## Purpose

定义内置 pi-usage 的提供商查询界面、设置、额度重置和进程内事件 API；本能力与本包自有额度路径分开。

## Requirements

### Requirement: 用量菜单

/usage SHALL 无参数打开当前运行时账号的用量菜单，要求 TUI 或 RPC UI；带参数 SHALL 提示从菜单选择操作。

#### Scenario: 查看用量

- **WHEN** 用户打开 /usage
- **THEN** SHALL 展示当前提供商的可用报告或不可用原因，并提供刷新、设置、查看另一个已配置提供商、查看全部与关闭操作
- **AND** 有账户/组织目标选择需求时 SHALL 提供选择或修改目标，不猜测用户目标

### Requirement: 提供商范围与第二账号边界

本能力 SHALL 使用内置适配器的查询契约和真实运行时认证；MUST 不把 Fast 对第二账号的支持当作第二账号已加入用量适配器。

#### Scenario: 第二账号查询

- **WHEN** 当前提供商为 openai-codex-1
- **THEN** 本能力 SHALL 不伪造第二账号用量适配器；第二账号数值额度由 [原生额度](../native-subscription-usage/archive.md) 提供

#### Scenario: 支持的适配器

- **WHEN** 提供商为已配置且有适用认证的适配器
- **THEN** SHALL 按其接口查询 quota、balance、spend 或 reset-time 中实际支持的指标
- **AND** 内置 ID 包括 anthropic、baseten、openai、openai-codex、deepseek、github-copilot、openrouter、vercel-ai-gateway、command-code、fireworks、opencode-go、kimi-coding、minimax、minimax-cn、moonshotai、moonshotai-cn、zai、zai-coding-cn 和 xai
- **AND** 适配器存在不保证远端账号拥有数值权限；无法查询 SHALL 显示认证、选择或查询失败原因

### Requirement: 设置持久化与保护

pi-usage.json SHALL 保存 codexFastMode、codexStatusResetCountdown、codexStatusPercentage、openaiUseCodexUsage、anthropicExtraUsage、selectedTargets 与 statuslineDisplay；更新 MUST 保留其他未知字段。

#### Scenario: 缺省或无效配置

- **WHEN** 配置不存在
- **THEN** SHALL 使用 Fast/两个额外用量选项关闭、Codex 倒计时开启、Codex 百分比 remaining 的默认值

#### Scenario: 不安全或损坏设置

- **WHEN** 设置为符号链接、非普通文件、超过 64KiB 或内容无效
- **THEN** SHALL 标记设置无效并提示，不通过菜单或 Fast 更新静默覆盖原文件

#### Scenario: 选择提供商目标

- **WHEN** 用户选择账户/组织目标
- **THEN** MUST 重新验证认证与候选目标，确认选择仍然有效后保存 selectedTargets[providerId]
- **AND** 配置变化或身份改变时不得发布旧目标结果

### Requirement: 状态行显示模板

statuslineDisplay SHALL 接受 template、window、countdown、separator；MUST 拒绝终端控制字符、换行、非法花括号和不受支持的占位符。

#### Scenario: 自定义额度格式

- **WHEN** 用户提供有效显示模板
- **THEN** template SHALL 仅支持 {provider}/{windows}，window 仅支持 {window}/{value}，countdown 仅支持 {window}/{value}/{reset}
- **AND** 默认值 SHALL 分别为 {provider} {windows}、{window}:{value}、{value} ↻ {reset} 与分隔符「 · 」
- **AND** 提供商及服务端文本 SHALL 清理终端控制字符后再显示

### Requirement: 认证来源保护

查询官方用量接口 MUST 使用匹配的官方提供商运行时认证，不向官方端点发送自定义 origin 提供商的凭据。

#### Scenario: 当前模型配置了代理 origin

- **WHEN** 当前模型提供商名对应内置适配器，但模型端点不属于其认可的官方 origin
- **THEN** SHALL 拒绝该官方用量查询，而不是仅凭提供商名发送凭据

### Requirement: 独立的可选策略

原生 OpenAI companion 与 Anthropic 额外用量 SHALL 由本能力的独立设置显式开启。

#### Scenario: 配置 OpenAI companion

- **WHEN** 用户修改 pi-usage.json 的 openaiUseCodexUsage
- **THEN** SHALL 仅改变本能力策略，不自动修改 [原生额度](../native-subscription-usage/archive.md) 的 pi-sub2api-usage.json/openai.useCodex

### Requirement: 缓存、状态与会话隔离

本能力 SHALL 以 usage 状态项显示适配器允许发布的指标，使用 5 分钟用量缓存、30 秒失败退避与 60 秒倒计时重绘；全部提供商查询 SHALL 最多并发 2 项。

#### Scenario: 账号、模型或会话变化

- **WHEN** 查询仍在进行但身份、目标、策略或会话发生变化
- **THEN** MUST 取消或丢弃不再归属于当前状态的结果
- **AND** 会话关闭 SHALL 清除状态、定时器和待完成菜单请求

### Requirement: Codex 额度重置需显式确认

额度重置消费入口 SHALL 仅在当前报告为 ready 且 providerId=openai-codex 时展示；MUST 经选项选择和单独确认，不因打开 /usage 自动消费。

#### Scenario: 确认使用 earned reset

- **WHEN** 用户选择 reset 并确认消费
- **THEN** SHALL 重新验证原模型及账号身份，使用 redemption 请求 ID 提交消费
- **AND** 重试 SHALL 复用该次消费的请求 ID，结果按服务端 reset/already_redeemed/nothing_to_reset 等状态显示

### Requirement: 进程内用量 API

本能力 SHALL 监听 usage:capabilities:v1 与 usage:query:v1；请求 MUST 提供匹配的 session 对象、sessionId、AbortSignal 与 respond 回调。

#### Scenario: 能力请求

- **WHEN** 有效调用方接受响应且会话 ready
- **THEN** SHALL 返回当前或指定 providerId 的 supported、measurements、supportsRefresh
- **AND** 不是当前会话对象/ID 的请求 MUST 不被当作本会话查询

#### Scenario: 查询请求

- **WHEN** 请求通过 respond 接受且 refresh=true
- **THEN** SHALL 在 15 秒总截止、取消信号及归属检查下执行刷新，成功返回 source=refresh、expiresAt 与脱敏报告
- **AND** refresh 不为 true SHALL 返回 cache-miss，不凭该接口暴露旧缓存报告

#### Scenario: API 失效或取消

- **WHEN** 请求超时、取消、会话尚未准备、提供商不支持或上下文变化
- **THEN** SHALL 返回 unavailable 及对应原因；失效时通过 usage:changed:v1 通知已暴露的提供商
