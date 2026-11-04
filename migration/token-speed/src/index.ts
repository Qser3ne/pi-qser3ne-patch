/**
 * pi-token-speed: 仅在 TUI 下显示当前 token 生成速度。
 *
 * - 通过 ctx.ui.setStatus("token-speed", ...) 写入 footer 扩展状态区
 *   (与 pi-statusline 兼容,会被它收集并显示)。
 * - 流式阶段:根据 text / thinking / toolcall 的 delta 估算 token,
 *   用最近 WINDOW_MS 的滑动窗口计算瞬时速度(从首个 token 起算,不含首包延迟)。
 *   由定时器按固定频率渲染,所以流停顿时数值会自然衰减,而不是冻结在旧值上。
 * - TTFT 显示最近 TTFT_SAMPLES 次请求(首个 delta 延迟)的平均值,首次测得后持续显示。
 * - 消息结束:若 provider 返回了 usage.output,则用真实 token 数计算本条消息平均速度;
 *   若首尾 delta 间隔过短(代理整段缓冲后一次吐出),速度无意义,显示 "--"。
 * - 按单条 assistant 消息统计,天然不含工具执行时间。
 * - 非 TUI 模式(print / json / rpc)完全不工作。
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const STATUS_KEY = "token-speed";
const WINDOW_MS = 2000; // 瞬时速度滑动窗口
const RENDER_INTERVAL_MS = 250; // 渲染定时器间隔
const MIN_ELAPSED_MS = 300; // 低于该时长不显示,避免首个 delta 速度爆表
const LONG_WINDOW_MS = 10 * 60 * 1000; // 长窗口:最近 10 分钟
const TTFT_SAMPLES = 5; // TTFT 取最近 N 次请求的平均值

/** 粗略估算 token:CJK 字符约 1 token/字,其余约 4 字符/token。 */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (
      (c >= 0x4e00 && c <= 0x9fff) ||
      (c >= 0x3400 && c <= 0x4dbf) ||
      (c >= 0x3040 && c <= 0x30ff) ||
      (c >= 0xac00 && c <= 0xd7af) ||
      (c >= 0xff00 && c <= 0xffef) ||
      (c >= 0x3000 && c <= 0x303f)
    ) {
      cjk++;
    } else {
      other++;
    }
  }
  return cjk + other / 4;
}

export function fmt(speed: number): string {
  return speed >= 100 ? speed.toFixed(0) : speed.toFixed(1);
}

export function fmtMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export default function tokenSpeedExtension(pi: ExtensionAPI): void {
  let firstTokenAt = 0;
  let lastTokenAt = 0;
  let estimated = 0; // 当前消息累计估算 token
  let samples: Array<{ t: number; tokens: number }> = []; // 累计值样本
  let active = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let lastShown: string | undefined;
  // TTFT:请求发出 -> 首个 delta。pendingRequestAt 跨 reset 保留(请求事件可能先于 message_start)
  let pendingRequestAt = 0;
  let ttftBase = 0;
  // 最近 TTFT_SAMPLES 次请求的 TTFT(跨 reset 保留)
  let ttftHistory: number[] = [];
  // 已完成消息记录(跨消息保留,reset 不清空):用于长窗口
  let records: Array<{ end: number; tokens: number; ms: number }> = [];

  const isTui = (ctx: ExtensionContext) => ctx.mode === "tui" && ctx.hasUI;

  const stopTimer = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };

  const reset = () => {
    stopTimer();
    firstTokenAt = 0;
    lastTokenAt = 0;
    ttftBase = 0;
    estimated = 0;
    samples = [];
    active = false;
    lastShown = undefined;
  };

  const show = (ctx: ExtensionContext, text: string | undefined) => {
    if (text === lastShown) return;
    lastShown = text;
    try {
      ctx.ui.setStatus(STATUS_KEY, text);
    } catch {
      // UI 已销毁时忽略
    }
  };

  /** 以当前时刻为终点计算滑动窗口速度;样本不足返回 undefined。 */
  const currentSpeed = (now: number): number | undefined => {
    if (!firstTokenAt || now - firstTokenAt < MIN_ELAPSED_MS) return undefined;
    // 只保留窗口内的样本(外加窗口前的一个作为基线,使突发后跨度包含停顿)
    while (samples.length > 2 && samples[1].t < now - WINDOW_MS) samples.shift();
    const base = samples[0];
    if (!base || now - base.t <= 0) return undefined;
    const speed = ((estimated - base.tokens) / (now - base.t)) * 1000;
    return Number.isFinite(speed) ? speed : undefined;
  };

  const ttftSuffix = (ctx: ExtensionContext): string => {
    if (ttftHistory.length === 0) return "";
    const avg = ttftHistory.reduce((a, b) => a + b, 0) / ttftHistory.length;
    return ctx.ui.theme.fg("dim", ` · TTFT ${fmtMs(avg)}`);
  };

  /** 长窗口内已完成消息的 tokens / 生成时长(不含空闲与工具时间);无记录返回空串。 */
  const longSuffix = (ctx: ExtensionContext, now: number): string => {
    records = records.filter((r) => r.end >= now - LONG_WINDOW_MS);
    let tokens = 0;
    let ms = 0;
    for (const r of records) {
      tokens += r.tokens;
      ms += r.ms;
    }
    if (ms <= 0) return "";
    return ctx.ui.theme.fg("dim", ` · ${fmt((tokens / ms) * 1000)} tok/s`);
  };

  const render = (ctx: ExtensionContext) => {
    if (!active) return;
    const now = Date.now();
    const speed = currentSpeed(now);
    if (speed === undefined) return;
    const theme = ctx.ui.theme;
    show(ctx, `⚡ ${theme.fg("accent", `~${fmt(speed)}`)} tok/s${ttftSuffix(ctx)}${longSuffix(ctx, now)}`);
  };

  pi.on("session_start", async (_event, ctx) => {
    if (!isTui(ctx)) return;
    records = [];
    ttftHistory = [];
    pendingRequestAt = 0;
    reset();
    show(ctx, undefined);
  });

  pi.on("message_start", async (event, ctx) => {
    if (!isTui(ctx) || event.message.role !== "assistant") return;
    reset();
    active = true;
    ttftBase = pendingRequestAt || Date.now();
    pendingRequestAt = 0;
    show(ctx, `⚡ --${ttftSuffix(ctx)}${longSuffix(ctx, Date.now())}`); // 仅重置速度,保留已有 TTFT
    timer = setInterval(() => render(ctx), RENDER_INTERVAL_MS);
    timer.unref?.();
  });

  // 请求发出时刻:比 message_start 更接近真实的起点
  pi.on("before_provider_request", async (_event, ctx) => {
    if (!isTui(ctx)) return;
    const now = Date.now();
    if (active && !firstTokenAt) ttftBase = now; // message_start 已先到
    else pendingRequestAt = now;
  });

  pi.on("message_update", async (event, ctx) => {
    if (!active || !isTui(ctx)) return;
    const e = event.assistantMessageEvent;
    if (e.type !== "text_delta" && e.type !== "thinking_delta" && e.type !== "toolcall_delta") return;

    const now = Date.now();
    if (!firstTokenAt) {
      firstTokenAt = now;
      ttftHistory.push(Math.max(now - ttftBase, 0));
      while (ttftHistory.length > TTFT_SAMPLES) ttftHistory.shift();
      samples.push({ t: now, tokens: 0 }); // 基线:首个 token 到达时刻
      show(ctx, `⚡ --${ttftSuffix(ctx)}${longSuffix(ctx, now)}`); // TTFT 已可用,无需等待速度样本
    }
    lastTokenAt = now;
    estimated += estimateTokens(e.delta);
    samples.push({ t: now, tokens: estimated });
  });

  pi.on("message_end", async (event, ctx) => {
    if (!active || !isTui(ctx) || event.message.role !== "assistant") return;
    stopTimer();
    active = false;
    if (!firstTokenAt) return;

    const msg = event.message as { usage?: { output?: number } };
    const real = msg.usage?.output;
    const exact = typeof real === "number" && real > 0;
    const tokens = exact ? real : estimated;

    // 首尾 delta 间隔过短:流式不成立(缓冲后一次性到达),速度无意义
    const end = Date.now();
    if (lastTokenAt - firstTokenAt < MIN_ELAPSED_MS || tokens <= 0) {
      show(ctx, `⚡ --${ttftSuffix(ctx)}${longSuffix(ctx, end)}`);
      return;
    }

    const ms = end - firstTokenAt;
    records.push({ end, tokens, ms });
    const speed = (tokens / ms) * 1000;
    show(ctx, `⚡ ${fmt(speed)}${exact ? "" : "~"} tok/s${ttftSuffix(ctx)}${longSuffix(ctx, end)}`);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    stopTimer();
    if (!isTui(ctx)) return;
    reset();
    show(ctx, undefined);
  });
}
