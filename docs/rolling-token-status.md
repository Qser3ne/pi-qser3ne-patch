# 今日 token 状态栏：启用与验收

当前行为的唯一档案见 [rolling-token-status](archive/rolling-token-status/archive.md)。

## 启用前

本包提供唯一状态栏 owner 和 `/statusline`，保留原有 `~/.pi/agent/pi-statusline.json`。备份 `~/.pi/agent/settings.json`，将独立状态栏的 packages 项改成（保留实际版本）：

```json
{ "source": "npm:@narumitw/pi-statusline@0.50.2", "extensions": [] }
```

保持独立 `pi-token-usage` 启用，它继续提供 `/token` 和 `/token-usage`。不要同时加载两个 pi-qser3ne-patch 来源，也不要额外启用其他 footer owner。

### 本地开发目录

只修改开发目录不会改变当前固定 Git 安装副本。希望使用本地开发版时，先用 `pi list` 确认旧本包来源，移除精确来源，再安装本地目录：

```sh
pi remove <pi-list-中原-pi-qser3ne-patch-的完整来源>
pi install /home/qser3ne/application/pi-extensions/pi-qser3ne-patch
```

不要删除开发目录；本地安装直接引用该目录。确认独立状态栏入口已经禁用，再 `/reload`。

### 固定 Git 安装副本

代码经用户授权推送后，安装经过验证的新完整提交哈希，替换旧的本包来源；确保没有残留第二个本包入口，再 `/reload`。本轮开发不会自动推送，也不会修改全局设置、安装副本或凭据。

## 显示与配置

```text
🪟 ctx 42.0%/272k  📊 12.3M CH 85.2%  🕒 16:42
```

- 段名保留 `usage24h` 以兼容已有配置；统计实际为本机时区今日 00:00 至当前，只有一个 `📊` 图标，不显示时间范围文字。
- 旧布局有 `context` 时自动在其后插入，仅在内存生效，不自动改写配置文件；空布局或没有 context 的旧布局不插入。
- `/statusline → Advanced → Custom layout` 可隐藏、移动或换行；菜单保存后隐藏状态在重载后仍有效。
- 修改图标：`"segmentText": { "usage24h": { "prefix": "📊 ", "suffix": "" } }`。
- 手动 JSON 隐藏：从 `segments` 移除 `usage24h`，并保留 `segmentText.usage24h`（可设为 `{}`）表示这是显式配置，防止按旧布局自动插回。
- 如只想改图标并继续显示，必须同时在 `segments` 的目标位置显式加入 `usage24h`。
- `…` 为加载中，`0 CH —` 为没有用量或输入分母为零，`unavailable` 为查询失败；报告含扫描/缓存/协调警告时仍直接显示总量和缓存率，不添加 `~`。
- `CH` 是窗口总缓存读取除以窗口总输入（普通输入＋缓存读取＋缓存写入），不包含输出，不是单次请求命中率。

仅统计当前模型列表的本机已保存历史，从运行 Pi 的本机时区今日 00:00 至查询开始时刻，两端包含，跨日后下一次刷新从新一天零点重新统计；并非所有机器的用量或服务商账单。内存和 `pi-token-usage/cache-v1` 磁盘快照复用，后台扫描不在 render 内运行。完成轮次/agent 后合并刷新（250ms），每 60 秒刷新以观察其他会话和日期变化。独立 `/token 24h` 与 `/token-usage` 仍为滚动近 24 小时，不再与状态栏使用同一时间窗口。

## 离线验收

1. 启用后确认 `/statusline`、`/fast`、`/usage` 没有重复编号，其他扩展状态仍存在。
2. 在足够宽的终端确认 `context → 📊 总量 CH 缓存率 → time`。
3. 用离线历史夹具核对今日零点及当前端点计入、昨日和未来记录排除，确认总量 K/M/B 紧凑格式及 CH 一位小数；跨午夜后等待下一次刷新确认只累计新一天。不要用 `/token 24h` 的数值直接对照今日统计。
4. 调窄终端确认不越界，上下文优先保留；用菜单隐藏/重载/重新显示新段。
5. 测试不使用真实账号：`npm run typecheck && npm test`。

卸载或回滚到未集成状态栏的旧版本时，恢复独立 pi-statusline 的扩展入口并 `/reload`。不要为清理缓存而删除源 `sessions/`。
