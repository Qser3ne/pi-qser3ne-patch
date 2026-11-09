# rolling-token-status

## Purpose

定义统一 TUI 状态栏中的滚动近 24 小时 token 总量、缓存命中率及其配置和生命周期边界。

## Requirements

### Requirement: 集成状态栏兼容

本包 SHALL 提供兼容 pi-statusline 0.50.2 的单一 footer owner 与 /statusline 命令，沿用 getAgentDir() 下的 pi-statusline.json，以及外观、菜单、布局、扩展状态显示能力。独立 pi-statusline 入口 MUST 保持禁用以避免重复命令或 footer 竞争；本包 MUST 不自动改写全局包来源或禁用其他扩展。

#### Scenario: 加载统一扩展

- **WHEN** 在 TUI 启用本包且未并行启用其他 footer owner
- **THEN** SHALL 保留现有状态栏配置和其他能力的状态项，提供 /statusline
- **AND** MUST 不额外注册 /token 或 /token-usage，独立查询扩展可继续提供这些命令

### Requirement: 当前模型列表的滚动窗口

统计 SHALL 聚合本机跨项目、跨会话的已保存历史，使用查询时刻之前 24 小时的滚动窗口，范围两端包含在内；模型范围 SHALL 使用 scopedModels，空列表时使用 modelRegistry.getAvailable()。统计本身 MUST 不请求模型服务、不调用服务商账单或认证刷新接口；数值 MUST 不被描述为跨机器总量或远端账单。

#### Scenario: 查询跨会话用量

- **WHEN** 后台执行一次统计
- **THEN** SHALL 读取默认 sessions 根目录和当前 sessionManager.getSessionDir()，只累计窗口内且属于当前模型列表的记录
- **AND** SHALL 使用固定截止时刻，不把查询开始后的记录加入该次结果
- **AND** SHALL 沿用固定统计模块的重叠根去重、复制/分叉历史去重、子代理用量协调规则，不把父汇总与已覆盖的子记录重复相加

### Requirement: 总量和缓存率显示

原生段名 SHALL 为 usage24h，默认仅以一个 📊 图标作前缀，显示例如 `📊 12.3M CH 85.2%`，MUST 不额外显示 24h 文字。总量 SHALL 使用报告 totalTokens，按 K/M/B 紧凑格式显示；缓存率 SHALL 使用窗口总 cacheRead / (input + cacheRead + cacheWrite)，显示一位小数，MUST 不把输出加入分母或平均每条消息的命中率。

#### Scenario: 累计后展示

- **WHEN** 窗口总量为 12300000，普通输入 1000000、缓存读取 8520000、缓存写入 480000
- **THEN** 默认段 SHALL 显示 `📊 12.3M CH 85.2%`

#### Scenario: 加载、空值或失败

- **WHEN** 首次扫描尚未返回、输入分母为零或查询失败
- **THEN** SHALL 分别显示 `📊 …`、`CH —` 或 `📊 unavailable`
- **AND** 无用量的有效报告 SHALL 显示 `📊 0 CH —`，不得把查询失败伪装成准确的零

#### Scenario: 报告包含警告

- **WHEN** 有效报告包含扫描、快照缓存或子代理协调警告
- **THEN** SHALL 仍直接显示总量和缓存率，MUST 不在总量前添加 `~`
- **AND** 警告存在与否 MUST 不改变统计数值或缓存率口径

### Requirement: 布局与显式配置

默认布局 SHALL 将 usage24h 放在 context 后；现有 context、time 相邻的布局 SHALL 显示为 context、usage24h、time。旧配置存在 context 且未显式设置 usage24h 段或其 segmentText 时 SHALL 只在内存插入；空布局和没有 context 的旧布局 SHALL 保持原样。显式 segmentText.usage24h SHALL 作为用户布局标记，未列入 segments 时 MUST 不自动插回。

#### Scenario: 读取旧布局或保存新布局

- **WHEN** 读取旧的 context、time 布局
- **THEN** SHALL 在 context 后插入统计段，但不写回文件
- **AND** 在菜单保存布局时 SHALL 保留显式段配置，使隐藏、重排或换行在重载后仍有效
- **AND** segmentText.usage24h 的 prefix/suffix SHALL 支持安全单行文字，与其他段采用相同校验

#### Scenario: 终端变窄

- **WHEN** 一行超过可用宽度
- **THEN** SHALL 沿用响应式段省略机制，context 的保留优先级高于 usage24h，MUST 不输出超宽行
- **AND** SHALL 支持已有颜色预设、ANSI-256 回退及多行布局

### Requirement: 异步刷新与迟到结果隔离

统计 SHALL 仅在 mode=tui 且 hasUI 时运行，启动或会话替换时刷新，模型选择及轮次/agent 完成事件合并触发 250ms 刷新，并每 60000ms 刷新。扫描 MUST 不在 render 内执行，同一控制器 MUST 至多存在一次运行中的扫描；会话、模型范围变化及关闭后的迟到结果 MUST 不覆盖当前显示。

#### Scenario: 扫描期间改变模型列表

- **WHEN** 模型范围在扫描期间发生变化，包括未发出 model_select 的模型列表更新
- **THEN** SHALL 在发布成功或失败结果前重新检查当前范围，丢弃旧范围结果并串行安排新扫描
- **AND** 更换会话或关闭后 SHALL 使旧结果失效并清理事件防抖和周期定时器

#### Scenario: 空闲观察其他会话

- **WHEN** 本会话无新轮次但其他会话增加用量，或已有记录离开近 24 小时窗口
- **THEN** SHALL 在后续周期刷新后反映新聚合结果

### Requirement: 缓存与独立安装边界

统计 SHALL 复用 pi-token-usage/cache-v1 快照路径及格式，运行时 MUST 不依赖同级开发仓库。开发目录修改 MUST 不被描述为已更新 Pi 管理的固定 Git 安装副本。

#### Scenario: 使用开发目录或固定安装副本

- **WHEN** 本包运行或开发者修改开发副本
- **THEN** 统计 SHALL 使用包内的固定统计模块，独立 /token 命令仍可复用同一磁盘快照
- **AND** 已安装的固定 Git 副本 SHALL 只有在显式更新其来源并重载后才采用新实现
