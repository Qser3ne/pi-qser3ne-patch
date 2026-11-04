import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import install from "../../src/index.ts";

export { install };
export const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));

const STATE = "daybreak-blue-state";
export const model = {
  id: "gpt-6-sol", name: "GPT-6 Sol", provider: "openai-codex", api: "openai-codex-responses",
  baseUrl: "https://chatgpt.com/backend-api", reasoning: true, input: ["text", "image"],
  contextWindow: 1000000, maxTokens: 32000,
  cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
};

export function harness(selected = model, entries = []) {
  const handlers = new Map();
  const commands = new Map();
  const statuses = new Map();
  const notices = [];
  const branch = [...entries];
  let idle = true;
  const ctx = {
    model: selected,
    mode: "tui", hasUI: true,
    isIdle: () => idle,
    sessionManager: { getBranch: () => branch },
    ui: {
      setStatus: (key, value) => value === undefined ? statuses.delete(key) : statuses.set(key, value),
      notify: (text, level) => notices.push({ text, level }),
      setFooter: () => assert.fail("Daybreak must not replace pi-statusline"),
    },
  };
  install({
    on: (name, handler) => handlers.set(name, handler),
    registerCommand: (name, command) => commands.set(name, command),
    appendEntry: (customType, data) => branch.push({ type: "custom", customType, data }),
  });
  return {
    ctx, handlers, commands, statuses, notices, branch,
    idle: (value) => { idle = value; },
    emit: (name, event = {}) => handlers.get(name)?.({ type: name, ...event }, ctx),
    command: (args = "") => commands.get("daybreak").handler(args, ctx),
    payload(payload = { model: ctx.model?.id, input: [] }) {
      return handlers.get("before_provider_request")({ type: "before_provider_request", payload }, ctx) ?? payload;
    },
  };
}

export const state = (enabled) => ({ type: "custom", customType: STATE, data: { version: 1, enabled } });
