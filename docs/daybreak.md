# Pi Daybreak Blue

Daybreak 能力的安装、开发和验收操作页；当前行为以所链接的档案为准。

## 安装

Daybreak 已并入 `pi-qser3ne-patch`，不再单独安装：

```bash
pi install git:github.com/Qser3ne/pi-qser3ne-patch
```

需要可复现安装时，固定到审核过的完整提交：

```bash
pi install git:github.com/Qser3ne/pi-qser3ne-patch@<完整提交哈希>
```

当前会话执行 `/reload` 后生效。Git 安装副本由 Pi 管理，位于 `~/.pi/agent/git/github.com/Qser3ne/pi-qser3ne-patch/`；统一入口 `src/index.ts` 内部初始化 `src/daybreak.ts`。

开发源码位于 `pi-extensions/pi-qser3ne-patch/`，原 Daybreak 提交历史已保留。修改源码后仍需提交、推送并更新 Pi 的安装提交；不会自动同步安装副本。旧 Git 包须用 `pi remove <pi list 中的完整旧来源>` 移除，避免重复命令。

从旧的手动安装迁移时，先备份并移走 `~/.pi/agent/extensions/daybreak/`，再安装 Git 包，避免 `/daybreak` 重复注册。迁移不更改会话记录，已有分支中的开关状态仍可恢复。

## 行为档案

命令、请求参数、会话持久化、适用端点与状态确认的唯一现状定义见 [daybreak-blue 档案](archive/daybreak-blue/archive.md)。本页保留安装、开发验证、历史验收和协议参考。

## 可选状态栏配置

可在 `pi-statusline.json` 的 `extensionStatusIcons` 中加入 `"daybreak": "🌅"` 覆盖图标。当前 pi-statusline 最多显示五个扩展状态；更多状态可能由它省略，不应仅凭图标缺失判断请求是否生效。

## 验证

需要 Node.js >= 22.19.0。在扩展目录安装锁定的开发依赖后验证：

```bash
cd pi-qser3ne-patch
npm ci
npm test
npm run typecheck
```

- `npm run test:unit`：统一插件全部单元/组合测试，无需全局安装 Pi 或状态栏。仅运行 Daybreak 单元测试可执行 `node --experimental-strip-types --test tests/daybreak.test.mjs`，无需开发依赖。
- `npm run test:integration`：使用锁文件中的本地 Pi、pi-statusline 和 WebSocket 开发依赖，验证图标/颜色/窄屏排版、Codex SSE/WebSocket 序列化和授权错误不降级。
- `npm test`：依次运行以上两组测试。
- `npm run typecheck`：严格检查扩展 TypeScript 源码。

测试使用虚构凭据和模拟传输，不调用真实账号。WebSocket 测试仅监听本机回环地址。默认不读取用户全局安装路径；可显式覆盖集成测试的 Pi 或状态栏包根目录，用于兼容性验证：

```bash
PI_PACKAGE_DIR=/path/to/pi-coding-agent \
PI_STATUSLINE_DIR=/path/to/pi-statusline \
npm run test:integration
```

Pi 及状态栏仅为开发测试依赖；扩展运行时仍使用宿主提供的 Pi，不捆绑独立宿主运行时。

## 迁移前的历史真实验证

已通过隔离 Pi 会话执行实际请求（未修改默认模型或当前对话）：

- `openai-codex/gpt-6.1-sol`：服务端拒绝，返回 `Daybreak isn't available for this model. Turn off Daybreak or choose another model.`。账号有资格并不代表所有模型都支持。
- `openai-codex/gpt-6-sol`：成功，返回 `DAYBREAK_CHECK_OK`；`response.created` 和 `response.completed` 均明确回传 `"access_programs":{"cyber":"daybreak_blue"}`，修订后的 `/daybreak status` 显示“已由服务端确认”。

这些历史结果不保证其他账号、模型或后续服务端版本可用。使用时先 `/reload`，通过 `/model` 选择支持的模型，再 `/daybreak on`，发送消息后确认状态为 `active`。不会未经用户选择自动更改模型。

## 协议依据

- [OpenAI：Using Daybreak in Codex CLI](https://help.openai.com/en/articles/20001607-using-daybreak-in-codex-cli)
- [Codex 官方源码：access program 的鉴权行为](https://github.com/openai/codex/blob/main/codex-rs/core/src/cyber_access_program.rs)
- [Codex 官方源码：AccessPrograms 请求体字段](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/common.rs)
