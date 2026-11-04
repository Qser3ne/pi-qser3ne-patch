# Pi Daybreak Blue

为官方 OpenAI Responses 请求增加 Daybreak Blue 开关；复用 Pi 当前登录和模型，不启动 Codex CLI，不读取或改写登录凭据，不替换模型目录，也不更改系统提示词。

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

## 命令

| 命令 | 行为 |
| --- | --- |
| `/daybreak` | 切换开启/关闭 |
| `/daybreak on` | 开启，重复执行不关闭 |
| `/daybreak off` | 关闭 |
| `/daybreak status` | 查看状态，不改变开关 |
| `/daybreak help` | 显示帮助 |

开启后，在后续请求体中合并：

```json
{ "access_programs": { "cyber": "daybreak_blue" } }
```

保留其他请求参数、当前模型、思考等级、工具调用、缓存设置及已有的其他 access programs。SSE 和 WebSocket 均复用 Pi 原有实现，不使用已弃用的 Daybreak 模型别名。关闭后不再注入参数，不会删除其他扩展自己设置的参数。

## pi-statusline 兼容

使用 `ctx.ui.setStatus("daybreak", ...)` 的原生扩展状态接口，不调用 `setFooter()`，无需修改现有 pi-statusline 配置或包代码。

- 开启、尚未确认：`🛡️ Daybreak Blue requested`，不显示成功色。
- 完成响应明确回传 `access_programs.cyber=daybreak_blue`：`🛡️ Daybreak Blue active`，成功色。
- 请求失败（包括模型不支持 Daybreak）：`🛡️ Daybreak Blue error`，警告色；`/daybreak status` 显示错误详情。
- 切换到不支持的提供者/端点：`🛡️ Daybreak Blue unavailable`；警告色，此时不注入参数。切回支持的端点后自动恢复请求模式，重新等待服务端确认。
- 关闭：清除此状态项。

可选：在 `pi-statusline.json` 的 `extensionStatusIcons` 中配置 `"daybreak": "🌅"` 覆盖图标。当前 pi-statusline 最多显示五个扩展状态；更多状态可能被它省略，这是其原生限制。

## 范围与状态

- 保持原范围：支持 `openai-codex` / `openai` 提供者（暂不含 `openai-codex-1`），以及官方 `https://chatgpt.com/backend-api` 的 Codex Responses 和 `https://api.openai.com/v1` 的 Responses 接口。
- 不向第三方提供者、代理端点或其他协议注入。不会自动切换模型。
- 默认关闭。开关记录在当前会话分支中；恢复会话、`/reload`、`/tree` 时按所在分支恢复。新会话默认关闭，不改变全局默认设置。
- 当前回复期间拒绝切换，避免同一轮请求混用模式；可等待完成或先停止回复。
- 作用于当前 Pi 会话中经过主请求钩子且模型匹配的请求；不会自动传播到独立子代理进程或扩展自己发出的嵌套请求。
- 开关打开不等于服务端接受：`requested` 仅表示已配置参数，只有成功完成响应明确回传对应 access program 才标记 `active`。OpenAI 服务端负责访问资格、组织/项目和模型兼容性校验；授权错误由 Pi 原样报告，不静默降级为普通模式。切换模型、重新加载或恢复会话后重新确认。

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
