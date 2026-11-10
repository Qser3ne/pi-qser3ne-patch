# pi-qser3ne-patch

个人 Pi 扩展补丁集，原名 `pi-sub2api-usage`。原 `pi-daybreak`、`pi-token-speed` 的完整提交历史已合并，通过一个包提供全部功能。

## 能力与行为档案

`docs/archive/` 是当前行为的唯一档案位置；本 README 提供导航、安装与配置示例。

| capability | 说明 |
| --- | --- |
| [extension-package](docs/archive/extension-package/archive.md) | 统一入口、公开命令、宿主及状态栏共存 |
| [codex-accounts](docs/archive/codex-accounts/archive.md) | Codex 双账号、认证隔离、模型及流归属 |
| [codex-fast](docs/archive/codex-fast/archive.md) | Fast 开关、资格验证、路由、费用估算 |
| [native-subscription-usage](docs/archive/native-subscription-usage/archive.md) | 原生 OpenAI/Codex 订阅额度及 companion |
| [sub2api-usage](docs/archive/sub2api-usage/archive.md) | Sub2API 管理员认证、额度及刷新边界 |
| [provider-usage](docs/archive/provider-usage/archive.md) | 内置 /usage、设置、重置确认及事件 API |
| [daybreak-blue](docs/archive/daybreak-blue/archive.md) | Daybreak 命令、参数与确认状态 |
| [token-speed](docs/archive/token-speed/archive.md) | tok/s、TTFT 与统计口径 |
| [herdr-subagents](docs/archive/herdr-subagents/archive.md) | herdr 工作状态与运行中的子代理数 |
| [rolling-token-status](docs/archive/rolling-token-status/archive.md) | 主状态栏今日 token 总量与缓存率 |

安装/验收操作页：[Daybreak](docs/daybreak.md)、[速度](docs/token-speed.md)、[herdr](docs/herdr-subagents.md)、[今日状态栏](docs/rolling-token-status.md)。

## 安装

需要 Node.js >=22.19.0。安装后执行 `/reload`；需要固定版本时，在 Git 来源后追加 `@<完整提交哈希>`。

```bash
pi install git:github.com/Qser3ne/pi-qser3ne-patch
```

**避免重复加载：**

- 用 `pi list` 查找独立 `pi-daybreak`、`pi-token-speed`、旧名 `pi-sub2api-usage`，逐个执行 `pi remove <完整来源>`（含固定提交后缀）。
- 若有手动安装的 `~/.pi/agent/extensions/daybreak/` 或 token-speed 入口，先备份并移出自动发现目录。
- 原会话、额度配置和 Fast 偏好无需复制。
- 已安装独立 pi-usage 时，修改 `~/.pi/agent/settings.json`，保留实际版本，仅禁用其扩展入口：

```json
{
  "source": "npm:@narumitw/pi-usage@0.69.0",
  "extensions": []
}
```

本包同时集成兼容版 pi-statusline，继续读取原 `pi-statusline.json`。已安装独立状态栏时，保留实际版本并禁用其扩展入口：

```json
{
  "source": "npm:@narumitw/pi-statusline@0.50.2",
  "extensions": []
}
```

主栏示例：`🪟 ctx 42.0%/272k  📊 12.3M CH 85.2%  🕒 16:42`。独立 `pi-token-usage` 保持启用，不会重复注册 `/token`。

加载后检查 `/fast`、`/usage`、`/statusline` 没有重复数字后缀。来源、许可证和再生操作见 [pi-usage](vendor/pi-usage/README.md)、[pi-statusline](vendor/pi-statusline/README.md) 和 [纯 token 统计模块](vendor/pi-token-usage/README.md)。启用本地开发副本与固定 Git 版本的区别见 [状态栏操作页](docs/rolling-token-status.md)。

## Codex 账号操作

1. 原账号可继续使用 `/login openai-codex`。
2. 通过 `/login openai-codex-1` 登录第二账号，建议另用无痕或独立浏览器。
3. 通过 `/model` 选择对应提供商的模型。

公开命令及限制见 [统一入口档案](docs/archive/extension-package/archive.md)，具体开关和额度语义见上方各能力档案。

### 模型覆盖示例

如需把两个账号的 `gpt-6.1-sol` 都配置为 272K，可分别写入 `~/.pi/agent/models.json`：

```json
{
  "providers": {
    "openai-codex": {
      "modelOverrides": { "gpt-6.1-sol": { "contextWindow": 272000 } }
    },
    "openai-codex-1": {
      "modelOverrides": { "gpt-6.1-sol": { "contextWindow": 272000 } }
    }
  }
}
```

将示例合并到现有文件，不要覆盖其他提供商。此处 272K 是用户配置示例，不是本包默认值。

## Sub2API 配置示例

先在 `models.json` 对应提供商中加入 `"sub2api": true`，再创建 `~/.pi/agent/pi-sub2api-usage.json`：

```json
{
  "baseUrl": "https://your-sub2api-instance",
  "email": "admin@example.com",
  "password": "your-panel-password",
  "accounts": { "sub2api-claude": 3589 }
}
```

配置文件应执行 `chmod 600`，不要提交真实凭据。需要管理员权限及有适用额度窗口的订阅账号。可选 token、route、method、refreshMs、usageSource 的定义及手动查询/超时的现有边界见 [Sub2API 档案](docs/archive/sub2api-usage/archive.md)。

原生 OpenAI 的两个 companion 开关属于不同模块，配置前分别查看 [原生额度](docs/archive/native-subscription-usage/archive.md) 与 [内置 usage](docs/archive/provider-usage/archive.md)，不要混用配置文件。

## 开发与卸载

```bash
npm ci
npm run typecheck
npm test
```

测试包括单元、统一入口/生产加载与模拟 SSE/WebSocket 集成验证，不调用真实账号。herdr 的真实终端离线验收步骤见 [验收页](docs/herdr-subagents.md)。修改开发目录不会自动更新 Pi 管理的 Git 安装副本；需更新对应安装来源后再重载。

版本历史见 [CHANGELOG.md](CHANGELOG.md)。卸载时使用 `pi remove <pi list 中的完整来源>`；随后可恢复独立 pi-usage、pi-statusline 入口并 `/reload`。不要为卸载本包而删除个人凭据与偏好文件。
