# extension-package

## Purpose

定义 pi-qser3ne-patch 的统一加载、公开命令与宿主集成边界。

## Requirements

### Requirement: 单一扩展入口

本包 SHALL 通过 package.json 的唯一 pi.extensions 入口 src/index.ts 提供内置能力；MUST 使用宿主提供的 Pi 运行时，不捆绑独立宿主。Node.js 版本要求为 >=22.19.0，开发验证基线为 Pi 1.5.0。

#### Scenario: 加载包资源

- **WHEN** Pi 加载本包
- **THEN** SHALL 注册一个统一扩展入口，并提供 /daybreak、/fast、/usage、/sub2api-usage、/openai-usage、/statusline
- **AND** 内置 pi-usage 不作为可独立过滤的另一个扩展入口

### Requirement: 状态栏共存

本包 SHALL 由内置的兼容状态栏统一管理 TUI footer；额度、Daybreak、速度及 Fast 等能力 SHALL 继续使用各自命名的扩展状态项。状态栏兼容及今日统计 MUST 遵守 [rolling-token-status](../rolling-token-status/archive.md)。

#### Scenario: 多项状态同时存在

- **WHEN** 开启适用的多个功能
- **THEN** 各项状态 SHALL 分别遵守对应能力档案
- **AND** 额度使用 sub2api-usage，兼容模块使用 usage，两者不相互覆盖
- **AND** Daybreak、速度与第二账号 Fast 分别使用 daybreak、token-speed、qser3ne-codex-fast

### Requirement: 额度路由及手动命令

/sub2api-usage SHALL 按当前提供商选择本包的原生或 Sub2API 额度查询；/openai-usage MUST 仅接受 openai、openai-codex、openai-codex-1。

#### Scenario: 不适用的提供商

- **WHEN** 当前模型不是受支持的原生 OpenAI/Codex 提供商而执行 /openai-usage
- **THEN** SHALL 提示选择受支持的 Codex 模型，不发起该命令的额度查询

#### Scenario: 提供商切换

- **WHEN** 在原生与 Sub2API 额度路径间切换或关闭会话
- **THEN** MUST 取消旧路径请求并清除其状态和定时器，迟到结果不得覆盖新状态

### Requirement: 独立的安装与用户数据

包加载 SHALL 沿用现有用户配置与认证；开发目录的文件更改 MUST 不被描述成已自动更新安装副本。

#### Scenario: 安装或卸载本包

- **WHEN** 用户通过 Pi 管理包的安装、重载或移除
- **THEN** 本包 SHALL 不复制账号凭据、不重置 Fast 偏好、不覆盖个人 models.json
- **AND** 并行加载独立的旧 Daybreak、速度、pi-usage 或 pi-statusline 扩展可能重复注册命令或竞争 footer；本包不自动禁用或卸载这些来源

### Requirement: 能力与范围索引

可观察行为 SHALL 分别由以下档案定义，不把界面结果当作远端服务资格保证。

#### Scenario: 查询某项能力的契约

- **WHEN** 需要确定具体行为
- **THEN** SHALL 使用 [Codex 账号](../codex-accounts/archive.md)、[Fast](../codex-fast/archive.md)、[原生额度](../native-subscription-usage/archive.md)、[Sub2API](../sub2api-usage/archive.md)、[内置 usage](../provider-usage/archive.md)、[Daybreak](../daybreak-blue/archive.md)、[速度](../token-speed/archive.md)、[herdr](../herdr-subagents/archive.md) 或 [今日状态栏](../rolling-token-status/archive.md) 的对应要求
