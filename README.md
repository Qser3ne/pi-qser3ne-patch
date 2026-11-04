# pi-qser3ne-patch

个人 Pi 扩展补丁集，原名 `pi-sub2api-usage`。现已合并原 `pi-daybreak`、`pi-token-speed`，通过**一个仓库、一个包、一个扩展入口**提供 Codex 双账号、Fast、订阅额度、Daybreak Blue 和速度统计。

## 已实现功能

| 功能 | 说明 |
| --- | --- |
| Codex 双账号 | 保留原生 `openai-codex`，新增 `openai-codex-1`，登录名为 `OpenAI Codex 1(legacy)`。复用 Pi 原生 OAuth、模型目录及流式请求实现。 |
| 账号隔离 | 两账号独立登录、刷新、退出和查询额度；不复制凭据、不回退到另一账号，也不自动轮换账号。切换时保留有效工具调用 ID，隔离跨账号的加密推理。 |
| Fast 模式 | 内置 pi-usage **0.69.0 兼容入口**，原 `/fast` 及 `/usage` Fast 控件支持两个 Codex 账号；保留 Fast 费用估算修正。 |
| Daybreak Blue | `/daybreak` 控制官方 OpenAI Responses 请求参数；默认关闭，按会话分支恢复，仅服务端确认后显示 active。见 [详细说明](docs/daybreak.md)。 |
| 速度与 TTFT | TUI 显示实时 tok/s、最近 5 次首 token 延迟及最近 10 分钟平均生成速度；不计空闲和工具执行时间。见 [详细说明](docs/token-speed.md)。 |
| Codex 额度 | 使用当前账号 OAuth 查询剩余额度和重置倒计时；按服务端实际窗口显示，不假设所有套餐都有 5 小时限制。不是 API 账单或会话 token 计数。 |
| Sub2API 额度 | 查询管理员账号用量接口；支持邮箱/密码自动登录、令牌缓存、过期或 401 后重新登录，以及手动 token。 |
| 状态栏 | 通过 `ctx.ui.setStatus()` 兼容 pi-statusline，不替换 footer；额度使用 `sub2api-usage` key，不覆盖 pi-usage 的 `usage`。 |
| 刷新与安全 | 额度默认每 3 分钟刷新，失败退避 30 秒，倒计时每分钟更新；原生额度合并重复刷新、校验当前认证，切换或关闭时取消旧请求。原生额度与兼容入口请求支持环境代理和 15 秒超时。 |

```text
📊 openai-codex-1 5h 81% ↻ 2h15m 7d 63% ↻ 5d1h
⚡ fast
```

百分比表示**剩余**额度。第二账号 Fast 指示使用独立的 `qser3ne-codex-fast` key；能力未确认时显示 `⚡ fast unknown`。

## 安装

需要 Node.js >=22.19.0。已有独立 pi-usage、Daybreak、速度统计或旧名扩展时，先按下文处理重复加载，再安装并重载。

```bash
pi install git:github.com/Qser3ne/pi-qser3ne-patch
```

安装后执行 `/reload`。需要固定版本时，在 Git 来源后追加 `@<commit>`。

**避免重复加载：**

- `pi-daybreak`、`pi-token-speed` 和旧名 `pi-sub2api-usage` 不能与本包同时加载。先用 `pi list` 查看来源，再逐个执行 `pi remove <对应的完整来源>`（包括固定提交后缀）。
- 若仍有手动安装的 `~/.pi/agent/extensions/daybreak/` 或 token-speed 入口，先备份并移出自动发现目录。
- 原 `/daybreak` 会话状态、额度配置及 Fast 偏好均保持兼容，无需复制凭据。
- 若已安装独立 pi-usage，将 `~/.pi/agent/settings.json` 中对应包改为下面的形式，保留实际版本，仅禁用其扩展入口：

```json
{
  "source": "npm:@narumitw/pi-usage@0.69.0",
  "extensions": []
}
```

本包唯一入口为 `src/index.ts`，内部初始化全部功能（包括 pi-usage 兼容模块），无需修改原 npm 文件或另建 fork。加载后应只有一个 `/fast` 和 `/usage`，没有数字后缀。兼容入口随本包维护，不会跟随独立 pi-usage 自动升级。

## Codex 使用

1. 原账号继续使用 `/login openai-codex`，无需迁移。
2. 执行 `/login openai-codex-1` 登录第二账号；建议使用独立或无痕浏览器，避免选错账号。
3. 用 `/model` 选择对应提供商下的模型，再运行以下命令。

| 命令 | 功能 |
| --- | --- |
| `/openai-usage` | 强制刷新当前原生 OpenAI/Codex 额度或提示所需配置。 |
| `/sub2api-usage` | 强制刷新当前 Sub2API 或原生 OpenAI/Codex 额度，保留旧命令兼容。 |
| `/fast` | 无参数切换 Fast，仅对官方 Codex Responses 端点及支持的模型生效。 |
| `/usage` | pi-usage 原有用量界面及 Fast 控件；第二账号额度仍由本包的 `/openai-usage` 和状态栏提供。 |
| `/daybreak [on\|off\|status\|help]` | 切换或查看 Daybreak Blue；无参数切换。原有范围保持不变，仅支持 `openai` / `openai-codex` 官方 Responses 端点，暂不含 `openai-codex-1`。 |

Fast 根据**当前账号**的模型目录确认能力：开启且支持时请求 `service_tier: "priority"`，否则使用 `"default"`；不扩展到原生 `openai` 或自定义代理端点。Fast 消耗更多套餐额度，不保证实际提速。

Fast 开关沿用 `~/.pi/agent/pi-usage.json` 的 `codexFastMode`，默认关闭、两账号共享；账号凭据和能力缓存仍独立。

### 模型覆盖（可选）

模型默认沿用 Pi 内置目录，两个提供商的 `models.json` 覆盖**互不继承**。例如，将两账号的 `gpt-6.1-sol` 都设为 272K：

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

将示例合并到现有 `~/.pi/agent/models.json`，不要覆盖其他提供商；其他模型按需分别添加。**272K 是可选配置，不是扩展默认值。**

## Sub2API 配置（可选）

在 `models.json` 对应提供商中加入 `"sub2api": true`，并创建 `~/.pi/agent/pi-sub2api-usage.json`：

```json
{
  "baseUrl": "https://your-sub2api-instance",
  "email": "admin@example.com",
  "password": "your-panel-password",
  "accounts": { "sub2api-claude": 3589 }
}
```

`accounts` 将提供商 ID 映射到后台账号 ID；需要管理员权限及具有额度窗口的订阅账号。配置文件应执行 `chmod 600`，不要提交真实凭据。

可选项：`token` 优先于自动登录；`route` 默认 `/api/v1/admin/accounts/{id}/usage`；`method` 默认 `GET`；`refreshMs` 默认 `180000`；`usageSource` 默认 `passive`，设为 `active` 才会查询上游。验证码或 TOTP 不能自动处理，请改用手动 token。

## 配置兼容与限制

- 改名后保留 `pi-sub2api-usage.json` 配置文件及 `pi-sub2api-usage-cache.json` 缓存文件名；缓存权限为 `0600`，绑定实例与登录邮箱，不保存 Codex OAuth。
- 两账号凭据仍分别存放于 Pi 的 `auth.json["openai-codex"]` 和 `auth.json["openai-codex-1"]`；不修改原账号或个人模型覆盖。
- 原生 `openai` 默认只显示 ChatGPT 连接状态，没有受支持的数值额度 API。实验性 `"openai": { "useCodex": true }` 需手动确认同账号/工作区的 Codex companion，且应用注册唯一匹配原生 OAuth `clientId`；套餐与应用额度分开显示，不能验证时不冒充原生额度。
- Codex 额度与能力依赖未公开的 ChatGPT 后端，接口可能变化；自定义端点、无法匹配的认证或缺失凭据会明确失败，不猜测其他账号。
- 若原账号出现重复额度 chip，可关闭 pi-usage 对应显示；本包不会覆盖它的状态 key。

## 开发与卸载

```bash
npm ci
npm run typecheck
npm test
```

`npm test` 包含全部单元测试、统一入口加载/组合测试及 Daybreak SSE/WebSocket 集成测试。测试使用模拟传输，不调用真实账号。

两个原仓库的完整提交历史已合并；源码分别位于 `src/daybreak.ts` 和 `src/token-speed.ts`，不依赖旧目录或嵌套仓库。

pi-usage 兼容模块的来源、MIT 许可及再生方法见 [vendor/pi-usage/README.md](vendor/pi-usage/README.md)；版本记录见 [CHANGELOG.md](CHANGELOG.md)。

卸载时使用 `pi remove <pi list 中的完整来源>`。本包是单入口，不再支持通过包资源过滤单独禁用内置 pi-usage；卸载本包后可恢复独立 pi-usage 入口，再执行 `/reload`。凭据和偏好无需迁移。
