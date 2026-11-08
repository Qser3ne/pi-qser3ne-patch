# Token speed / TTFT

速度、TTFT、统计窗口、TUI 边界与显示格式的唯一现状定义见 [token-speed 档案](archive/token-speed/archive.md)。本页保留安装与开发操作。

## Install

```bash
pi install git:github.com/Qser3ne/pi-qser3ne-patch
```

Remove the old standalone source shown by `pi list` with `pi remove <exact-source>` and run `/reload` to avoid duplicate handlers. The unified `src/index.ts` initializes `src/token-speed.ts`; original Git history is preserved.

## Development

```bash
npm ci
npm test
npm run typecheck
```

## Uninstall

```bash
pi remove <exact-pi-qser3ne-patch-source-from-pi-list>
```
