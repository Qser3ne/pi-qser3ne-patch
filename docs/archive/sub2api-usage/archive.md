# sub2api-usage

## Purpose

定义标记的 Sub2API 提供商的配置、管理员认证、配额查询及现有刷新边界。

## Requirements

### Requirement: 显式提供商选择

仅 models.json 中 sub2api=true 的提供商 SHALL 进入本能力；账户 ID MUST 取自 pi-sub2api-usage.json 的 accounts[providerId]。

#### Scenario: 未标记或配置不完整

- **WHEN** 当前提供商未标记，或缺少账号 ID/实例 URL
- **THEN** 未标记提供商 SHALL 清除本能力状态；已标记但配置不完整 SHALL 显示具体缺失项
- **AND** 实例 URL SHALL 优先取设置 baseUrl，否则从提供商 baseUrl 移除末尾 /v1

### Requirement: 配置默认值及兼容文件

本能力 SHALL 使用 pi-sub2api-usage.json 和 pi-sub2api-usage-cache.json，不因包名改变而重命名用户文件。

#### Scenario: 读取配置

- **WHEN** 字段未提供或无效
- **THEN** SHALL 使用 route=/api/v1/admin/accounts/{id}/usage、method=GET、usageSource=passive、refreshMs=180000
- **AND** method=POST、usageSource=active 与正有限 refreshMs SHALL 在有效配置时生效
- **AND** 密码空白 SHALL 原样保留；坏 JSON SHALL 回退默认并最多告警一次，缺少可选文件不得伪报为损坏

### Requirement: 手动 token 和自动登录

手动 token MUST 优先于自动登录；未配置手动 token 时 SHALL 要求 email 与 password，并向实例 /api/v1/auth/login 发送 POST。

#### Scenario: 复用或刷新登录 token

- **WHEN** 缓存属于相同规范化实例和邮箱，且离到期超过 60000ms
- **THEN** SHALL 复用缓存，否则重新登录
- **AND** 未知过期时间 SHALL 立即视为过期，不猜测默认有效期

#### Scenario: 额外登录挑战

- **WHEN** 服务端要求 TOTP/2FA 或返回验证码要求
- **THEN** SHALL 明确提示不支持自动处理，不尝试绕过挑战

### Requirement: 缓存身份及权限

自动登录缓存 SHALL 以 version=1、instanceBaseUrl、email、accessToken、expiresAt 保存；MUST 拒绝旧版无作用域缓存及其他实例或邮箱的 token。

#### Scenario: 写入认证缓存

- **WHEN** 自动登录成功
- **THEN** SHALL 使用 0600 创建缓存并尽力设置该权限；不支持 chmod 的平台仍可保存
- **AND** 缓存不得保存 Codex OAuth 或管理员明文密码

### Requirement: 管理员用量请求

查询 SHALL 替换 route 的 {id}，使用 Bearer token，并在路由未含 source= 时添加 source=passive 或 active；POST 请求体 SHALL 为 {}。

#### Scenario: 用量响应

- **WHEN** 实例返回 code=0 的有效 five_hour/seven_day 窗口
- **THEN** SHALL 显示剩余额度和有效重置倒计时；空窗口跳过，全部为空显示 no usage
- **AND** 非法利用率、时间或 envelope MUST 报错，而不是当作零用量

### Requirement: 自动刷新与 401 重试

自动状态路径 SHALL 缓存有效用量并按 refreshMs 刷新，失败退避 30000ms；401 SHALL 使 token 缓存失效，自动路径最多重新获取 token 并重试一次。

#### Scenario: 切换实例、配置邮箱或提供商

- **WHEN** 目标变化或关闭会话
- **THEN** MUST 不继承不相关身份的用量/退避；旧请求结果不得发布到新目标

#### Scenario: 倒计时更新

- **WHEN** 自动路径的 five_hour 窗口有未来重置时间
- **THEN** SHALL 每 60000ms 重新显示倒计时而不重新查询

### Requirement: 手动查询

/sub2api-usage 的 Sub2API 路径 SHALL 强制查询，不因有效缓存跳过本次检查。

#### Scenario: 手动查询返回有效用量

- **WHEN** 管理员额度查询成功
- **THEN** SHALL 更新缓存及状态，并通知解析后的用量 JSON

### Requirement: 请求取消和连接超时

登录和管理员用量的 fetch 阶段 SHALL 默认使用 15000ms 超时，并组合调用方取消信号。

#### Scenario: 请求尚未收到响应

- **WHEN** 达到 fetch 阶段超时，或调用方取消
- **THEN** SHALL 取消该网络请求；此契约不包含响应 JSON 读取的完整截止保证
