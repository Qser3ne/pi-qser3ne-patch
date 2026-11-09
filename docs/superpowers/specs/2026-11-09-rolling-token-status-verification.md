# 近 24h token 状态栏验证记录

## 交付与证据

- 开发目录：`/home/qser3ne/application/pi-extensions/pi-qser3ne-patch`；分支 `feat/rolling-token-status`，基于 `main` 的 `5e41fafad057769b5f1461a8308d55972214cf92`。
- 显示：`📊 12.3M CH 85.2%`；默认 `context → usage24h → time`，不显示 24h 文字。
- 新统计模块保持与 pi-token-usage `295bfb579ff4d159683f6400cffdeb683c461b54` 一致；仅内置纯模块，不注册 /token。快照文件 SHA-256 与版本来源已固定。
- pi-statusline 0.50.2 源码带 MIT 许可和原文件哈希，生成器断言补丁必须唯一命中；回归验证输出可再生，上游接口漂移会明确失败。
- 基线：185 单元 + 4 集成测试通过；最终 `npm run typecheck` 退出 0，`npm test` 为 201 单元 + 4 集成测试通过，0 失败。
- 最终另以实际全局宿主 bundle 验证：`PI_HOST_BUNDLE=/home/qser3ne/.local/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/index.js npm test`，同样 201 + 4 通过。
- `git diff --check` 通过；README、操作页和两份受影响档案的相对链接存在；旧的“本包不替换用户 footer”描述已移除。

## 覆盖

- 聚合缓存率、总量紧凑格式、无用量/加载/失败/警告状态。
- 固定滚动截止时间、当前模型列表、跨根去重、fork/子代理协调。
- 异步 single-flight、250ms 事件合并、60s 空闲刷新、会话切换/关闭和旧结果隔离、错误恢复。
- 宽度 1..240、truecolor 与 ANSI-256、上下文优先保留、旧/空/多行布局及自定义图标。
- 真正运行 /statusline 菜单并发送键盘输入，验证隐藏 usage24h 后重载不插回；移除保存标记补丁时此测试确实失败，恢复再生成后通过。
- 真正 Pi bundled loader 的生产依赖沙盒，单一入口、独立 statusline/usage 入口禁用、唯一 /statusline、懒加载 help 和全部既有命令保留。

## 独立审查与修复

只读 reviewer 使用 `openai-codex-1/gpt-6.1-sol:xhigh` 审查 `5e41faf..fc72a25`。发现一个 Important 问题，无 Critical/Minor：扫描期间 /models 更新 scopedModels 而不发 model_select 时，旧范围成功或失败结果可能发布。

已核实宿主 live getter 和更新路径；新增两条不调用 refresh 的延迟扫描回归，先观察到旧成功值和旧失败状态错误发布（RED），再在发布前重新读取范围，丢弃旧结果并串行安排替代扫描（GREEN）。修复提交 `da2a4ed`；修复后全套与实际全局宿主验证均通过。没有额外二次审查，不将本记录描述成“审查者独立运行过全部测试”。

## 裁决与保留边界

- 审查者将档案同步留给主执行者：按既定流程在审查后同步并单独提交；若遗漏会造成档案陈旧，已由最终档案核对覆盖。
- 审查者未独立重跑测试/部署：由主执行者重跑 typecheck、全套和全局 bundle 加载验证。全局设置与安装副本保持不变，未做真实已安装终端验收；风险是仅在真实部署环境出现的问题仍需启用后确认。
- 无延期 Minor 项。未推送、未合并 main、未修改全局包来源或凭据。
- 操作适配：技能脚本部分文件无可执行权限，使用 bash 调用 task-brief；task-start/task-done 的嵌套调用仍被权限阻止，其 BASE/测试结果在专属 ledger 中记录，不修改技能安装。

## 档案同步

提交 `881ea11`，仅包含：

- `docs/archive/rolling-token-status/archive.md`：新增集成兼容、统计范围、显示口径、布局配置、异步隔离、缓存/安装边界等 6 条 Requirement 及对应 Scenario。
- `docs/archive/extension-package/archive.md`：公开命令增加 /statusline；状态栏共存改为唯一内置 owner；补充独立状态栏竞争边界及能力索引。

由实现方确定并明示的细节包括 usage24h 段名、K/M/B 与无值标记、250ms/60s 刷新、旧配置的显式隐藏标记和响应式优先级；这些均已写入实现、测试和新档案。范围外未发现需要本轮处理的档案不一致；旧术语检索未发现本轮改变行为的残留。
