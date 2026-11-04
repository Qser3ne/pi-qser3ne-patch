import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateTokens, fmt, fmtMs } from "../src/index.ts";

test("estimateTokens counts CJK as 1 token per char", () => {
  assert.equal(estimateTokens("你好世界"), 4);
});

test("estimateTokens counts other text as ~4 chars per token", () => {
  assert.equal(estimateTokens("abcdefgh"), 2);
});

test("estimateTokens mixes both and handles empty input", () => {
  assert.equal(estimateTokens("你好abcd"), 3);
  assert.equal(estimateTokens(""), 0);
});

test("fmt uses one decimal below 100 and none from 100", () => {
  assert.equal(fmt(12.345), "12.3");
  assert.equal(fmt(99.94), "99.9");
  assert.equal(fmt(100.4), "100");
});

test("fmtMs switches to seconds at 1000ms", () => {
  assert.equal(fmtMs(250.4), "250ms");
  assert.equal(fmtMs(999), "999ms");
  assert.equal(fmtMs(1500), "1.5s");
});
