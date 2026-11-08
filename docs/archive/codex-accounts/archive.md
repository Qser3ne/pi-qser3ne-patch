# codex-accounts

## Purpose

定义第二个 Codex 提供商及双账号之间的认证、模型、上下文和流归属边界。

## Requirements

### Requirement: 提供商身份

本包 SHALL 保留原生 openai-codex，并新增 openai-codex-1；第二账号的登录显示名 MUST 为 OpenAI Codex 1(legacy)。

#### Scenario: 选择第二账号

- **WHEN** 使用 /login openai-codex-1 或在模型列表中选择该提供商
- **THEN** SHALL 使用第二提供商身份，并提示使用第二个 ChatGPT 账号登录
- **AND** 不替换原提供商或重命名原账号

### Requirement: 认证隔离

两提供商 SHALL 分别交由 Pi 管理 OAuth 登录、刷新、退出与凭据存储。缺少第二账号凭据时 MUST 不回退到第一个账号，不自动轮换或复制凭据。

#### Scenario: 登录、刷新或退出某一账号

- **WHEN** 对其中一个提供商进行认证操作
- **THEN** SHALL 仅改变其对应身份的凭据
- **AND** auth.json 中两提供商 SHALL 使用各自的键

### Requirement: 模型目录与覆盖

第二提供商 SHALL 复用原生 Codex 模型目录和流式能力，但目录中的提供商身份 MUST 为 openai-codex-1。两个提供商的用户模型覆盖 SHALL 独立生效。

#### Scenario: 配置 contextWindow 等模型覆盖

- **WHEN** 用户仅在一个提供商下配置 modelOverrides
- **THEN** SHALL 不自动复制到另一个提供商
- **AND** 本包不默认把模型上下文窗口改为某个自定义数值

### Requirement: 跨账号上下文安全

切换账号时 MUST 保留合法的工具调用关联，同时不把另一账号的加密推理或签名当作当前账号自己的内容。

#### Scenario: 第一账号回复后由第二账号继续

- **WHEN** 对话包含第一账号的 assistant 消息与工具结果
- **THEN** SHALL 由原生兼容处理保留有效工具调用 ID
- **AND** 另一账号的受保护推理内容 MUST 不被当作本账号续接状态

### Requirement: 流归属与失败

第二账号的正常、错误和中断消息 SHALL 归属于 openai-codex-1；代理层失败 MUST 不冒充另一个账号成功完成。

#### Scenario: 流结束或中断

- **WHEN** 第二账号的推理流返回结果、报错或被取消
- **THEN** 输出消息及流事件中的账号归属 SHALL 保持第二提供商身份

### Requirement: 相邻能力不自动扩展

新增账号 MUST 不隐式扩展所有其他功能的提供商范围。

#### Scenario: 使用账号的附加功能

- **WHEN** 需要 Fast、额度或 Daybreak
- **THEN** SHALL 分别遵守 [Fast](../codex-fast/archive.md)、[原生额度](../native-subscription-usage/archive.md) 与 [Daybreak](../daybreak-blue/archive.md) 档案
