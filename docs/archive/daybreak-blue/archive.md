# daybreak-blue

## Purpose

定义官方 OpenAI Responses 请求的 Daybreak Blue 开关、参数范围与服务端确认状态。

## Requirements

### Requirement: 命令与开关

/daybreak SHALL 无参数切换；on/off MUST 幂等；status/help 和无效参数 MUST 不改变开关。

#### Scenario: 忙碌期间尝试切换

- **WHEN** ctx.isIdle() 不为 true 而用户尝试切换
- **THEN** SHALL 拒绝此次切换并提示等待或先停止回复
- **AND** status/help 仍可查询

### Requirement: 严格提供商和端点范围

Daybreak SHALL 只支持 openai 或 openai-codex 的 Responses 协议，HTTPS 且无 URL 用户信息；官方 openai-responses 要求 api.openai.com origin 及 /v1 路径前缀，Codex Responses 要求 chatgpt.com origin 及 /backend-api 路径前缀。

#### Scenario: 不适用的模型

- **WHEN** 当前提供商为 openai-codex-1、其他提供商、代理、自定义 origin 或非 Responses 协议
- **THEN** MUST 不注入 Daybreak 参数，不自动切换模型
- **AND** 已开启时 SHALL 显示 unavailable；切回支持模型后重新等待确认

### Requirement: 合并请求字段

开启且模型适用时 SHALL 将 access_programs.cyber=daybreak_blue 合并到模型 ID 匹配且 input 为数组的主请求体；MUST 保留其他参数及其他 access programs。

#### Scenario: 关闭或辅助请求

- **WHEN** 开关关闭，或请求模型不同，或不是匹配的 Responses 请求
- **THEN** SHALL 不注入、不主动删除其他扩展设置的字段
- **AND** SSE/WebSocket SHALL 使用相同的参数规则
- **AND** 官方 openai 的 API-key 请求也可适用，不以 OAuth 作为本能力的必要条件

### Requirement: 会话分支持久化

开关 SHALL 默认关闭，并在当前会话分支保存 version=1 的 daybreak-blue-state/enabled；MUST 复用当前登录和模型，不读取/改写认证文件、不启动 Codex CLI，不修改全局默认、模型目录或系统提示词。

#### Scenario: 恢复、重载或树导航

- **WHEN** 恢复会话、/reload 或 /tree
- **THEN** SHALL 从当前分支恢复有效开关记录，忽略畸形记录
- **AND** 新会话无记录时默认关闭；确认结果本身不随分支持久化

### Requirement: 真实确认而非推断成功

开启但未确认 SHALL 显示 🛡️ Daybreak Blue requested；只有匹配当前请求模型的成功 completed/done 响应明确回传 access_programs.cyber=daybreak_blue，才 SHALL 显示 active。

#### Scenario: 未显式回传或出现错误

- **WHEN** 响应未明确确认，或请求报错
- **THEN** MUST 不将请求参数本身当作资格确认
- **AND** 错误 SHALL 显示 error，并在 status 中给出详情；不静默降级为普通请求

### Requirement: pi-statusline 显示兼容

本能力 SHALL 发布普通扩展状态文本，由宿主状态栏选择图标、颜色和换行；MUST 不要求修改状态栏包代码。

#### Scenario: 使用已验证的 pi-statusline 集成

- **WHEN** 状态为 requested、active 或 unavailable/error
- **THEN** requested SHALL 不被渲染为成功色，active 使用成功色，不可用/错误使用警告色
- **AND** 自定义 extensionStatusIcons.daybreak SHALL 可覆盖默认图标；状态显示数量仍受状态栏自身限制

### Requirement: 状态与传播边界

切换模型、重新加载和新请求 SHALL 重置确认状态；独立子代理进程和扩展自行发起的嵌套请求 MUST 不被描述为自动继承本开关。

#### Scenario: 关闭功能或会话

- **WHEN** 执行 off 或关闭会话
- **THEN** SHALL 清除 daybreak 状态项，不替换 footer
- **AND** 显示状态只证明本会话观测，不保证其他账号或未来服务端资格
