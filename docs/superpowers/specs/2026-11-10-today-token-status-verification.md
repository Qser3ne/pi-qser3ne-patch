# 今日 token 状态栏验证记录

## 交付
- 状态栏使用本机日历零点到单次查询开始时刻（含两端），总量与 CH 共享范围。
- 保留 usage24h 配置键、显示格式、250ms/60s 刷新及独立滚动查询命令。
- 同步生成脚本、生成菜单、当前文档、rolling-token-status 与 extension-package 档案；历史设计记录保留。
- 开发阶段按用户选择在当前目录原位修改，未提交、推送或修改安装副本；后续用户已授权提交、推送并更新 settings 固定版本。

## 验证证据
- 旧实现下新断言 RED：17 项中 9 项按预期失败（旧窗口及旧帮助文案）。替换窗口/再生成后 17/17 通过。
- 最终 `npm test`：209/209 单元、4/4 集成通过。
- 最终 `npm run typecheck`：退出 0；保持 ES2023 配置，测试异步 gate 沿用 new Promise 写法。
- `TZ=UTC|Asia/Shanghai|America/New_York|Pacific/Kiritimati node --experimental-strip-types --test test/rolling-token-usage.test.ts`：每个时区 16/16 通过；测试包括固定 cutoff、本地零点、午夜零宽窗口、夏令时及跨日周期刷新、真实 collector 的边界记录和当日 CH。
- `npm run vendor:pi-statusline` 后生成 commands.ts 哈希不变，完整测试也包含再生成回归。
- 最终 `git diff --check`：退出 0。

## 独立审查与裁决
只读 reviewer 405a14b1-c2ce-47e1-a647-745c95c43d18 未发现运行逻辑的 Critical/Important；Declined to judge 为空。

Ruling: 将审查中的 UTC+14 夹具可移植性备注升级为验证阻碍并处理，因为本机日期语义适用于所有合法时区。先运行 Pacific/Kiritimati 复现 2/16 失败，再仅将夹具零点改为 NOW 所在本地日历日，最终 16/16 通过。若裁决有误，风险是测试边界预期被弱化；独立的字面值时区/DST 表与真实 collector 边界断言继续约束运行逻辑，生产代码没有因该修正变化。

没有剩余审查问题或延期小项。开发验证未做真实用户 TUI 重载验收；后续安装来源及固定副本更新由用户授权的发布步骤处理。

## 档案核对
修改当前窗口、跨日、夏令时、独立命令语义及菜单范围说明；兼容键要求不变。旧窗口术语在 docs/archive 中仅保留于独立命令仍滚动近 24 小时的明确例外。未发现本轮范围外的不一致。档案在用户授权发布时以独立 docs(archive) 提交交付。
