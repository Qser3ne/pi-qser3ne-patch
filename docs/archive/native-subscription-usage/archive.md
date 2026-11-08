# native-subscription-usage

## Purpose

定义本包 /openai-usage、原生额度状态和实验性 OpenAI companion 查询的认证及数据显示边界。

## Requirements

### Requirement: 原生提供商及额度含义

本能力 SHALL 识别 openai、openai-codex、openai-codex-1；数值 MUST 表示服务端订阅额度而不是会话 token、API 账单或本地费用。

#### Scenario: Codex 返回配额窗口

- **WHEN** 当前账号返回有效 primary/secondary 额度窗口
- **THEN** SHALL 显示服务端实际窗口时长、剩余百分比及可用的重置倒计时
- **AND** 不假定所有账号都具有固定 5 小时窗口；无有效窗口或矛盾数据 MUST 报错而不编造限制

### Requirement: 当前 OAuth 校验

查询 MUST 使用 Pi 新解析的当前提供商 OAuth，并校验其与存储凭据、当前模型授权和原生端点一致。API key、自定义 origin、模型授权覆盖及账号身份不匹配 MUST 失败关闭。

#### Scenario: 第二账号未登录或失效

- **WHEN** openai-codex-1 缺少有效凭据或收到 401
- **THEN** SHALL 指向该账号的登录/重连，不借用 openai-codex 的认证或数值

### Requirement: OpenAI 默认非数值状态

原生 openai 默认 SHALL 仅显示 ChatGPT 连接状态，不把其 direct-use token 作为 Codex 后端凭据。

#### Scenario: 未开启实验性 companion

- **WHEN** openai OAuth 有效且 pi-sub2api-usage.json 中 openai.useCodex 不是 true
- **THEN** SHALL 显示额度需 Codex companion 的说明，不请求 Codex 数值额度接口

### Requirement: 实验性 companion 的双重窗口

显式 openai.useCodex=true 时 SHALL 额外使用用户指定为同账号/工作区的 openai-codex 登录；MUST 先唯一匹配原生 OAuth clientId 的应用，再查询套餐额度。

#### Scenario: 应用匹配失败

- **WHEN** 应用缺失、重复、响应无效或存在未支持的分页
- **THEN** MUST 不把 Codex 套餐额度伪装成原生 OpenAI 应用额度
- **AND** SHALL 明确失败；应用注册匹配不构成独立的同用户/工作区证明

#### Scenario: 应用与套餐均有效

- **WHEN** companion 与应用查询通过
- **THEN** SHALL 分别显示 plan 与 app 窗口
- **AND** 本设置与 [内置 usage](../provider-usage/archive.md) 的 openaiUseCodexUsage MUST 分开读取，互不自动同步

### Requirement: 刷新、并发与账户切换

额度默认 SHALL 每 180000ms 刷新，可通过 refreshMs 配置；网络失败退避 30000ms，重置倒计时按 60000ms 更新。命令 SHALL 可强制查询并显示结果。

#### Scenario: 短时间连续 turn 事件

- **WHEN** 相同提供商、模型、会话和 registry 的请求尚未结束
- **THEN** SHALL 合并重复刷新，不反复取消导致饥饿
- **AND** 手动刷新、模型变化或会话关闭 MUST 取消旧操作

#### Scenario: 缓存期间重新登录

- **WHEN** OAuth 身份变化、退出或请求期间认证改变
- **THEN** MUST 重新验证并丢弃旧账号缓存或迟到结果

### Requirement: 网络和错误信息安全

请求 SHALL 使用请求级环境代理、尊重 NO_PROXY、禁止 HTTP 重定向，并采用覆盖响应体读取的 15 秒默认截止；MUST 不替换宿主全局 fetch 或 dispatcher。

#### Scenario: 网络或认证请求失败

- **WHEN** 请求、响应体或认证验证失败
- **THEN** SHALL 只展示本地受控的错误信息，不输出服务端正文或凭据
- **AND** 非预期错误 SHALL 使用通用 network/auth/timeout 说明
