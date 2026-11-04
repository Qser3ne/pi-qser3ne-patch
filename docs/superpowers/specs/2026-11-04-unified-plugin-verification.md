# 统一插件迁移验证记录

日期：2026-11-04。版本：0.5.0。

## 验证结果

- 三个源项目合并前均通过各自测试与类型检查。
- 统一项目在隔离工作区和合并后的 main 上执行 `npm ci`、`npm run typecheck`、`npm test`：139 项单元/组合测试和 4 项 Daybreak 集成测试通过。
- 使用锁定开发依赖和本机 Pi 1.5.0 的真实 bundled loader 验证仅一个扩展入口，五个命令各注册一次，第二 Codex 提供商仅注册一次。
- 验证实际安装副本只包含运行时依赖仍可加载，配置固定提交与远程 main 一致；旧 Daybreak/token-speed 来源已移除，独立 pi-usage 仍禁用入口，其他 settings.json 字段不变。
- `npm audit` 和 `npm audit --omit=dev` 均为 0 vulnerabilities。
- Daybreak 原 HEAD `c795ebeb915433fad17f83ccf2f4d8b7d52bdb2e` 和 token-speed 原 HEAD `5c79979d1557b47a7974af17cec3c3def711af18` 均为合并后目标提交的祖先。
- 父仓库仅保留 pi-qser3ne-patch gitlink 与子模块声明；旧远程仓库未删除。

## 实施说明

- 用户选择当前会话直接实施、不开子代理；进行了作者自审，没有独立审查。
- 组合回归暴露原速度模块重置时过早清空 lastShown，导致新会话/关闭时跳过 UI 清理。修正该行，并分别通过两个先失败后通过的生命周期测试；其余迁入生产逻辑保持不变。
- Daybreak 源码和传输集成测试、生成的 pi-usage runtime 与源版本字节一致；不增加第二账号 Daybreak 支持。
- 按安全要求先提交设计/计划和 .worktrees 忽略项，再在隔离工作区实施。技能辅助脚本无执行权限，使用工作区外可执行副本，未修改原技能。
- 父仓库 SSH 22 端口不可用，使用同一 GitHub 仓库的 HTTPS 地址正常推送，未强推或修改远程 URL 配置。
- 本机备份路径：`/home/qser3ne/backups/pi-unified-20261104-114523/`，包含原仓库 bundles、配置备份、测试日志和实际安装验证脚本。

当前会话仍需手动 `/reload` 才切换到新扩展实例。未执行真实账号服务请求，未更改认证或模型配置。
