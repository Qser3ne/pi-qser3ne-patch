// Pure collector only; never initialize a second /token extension.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = process.argv[2] ?? join(root, "../pi-token-usage");
const target = process.argv[3] ?? join(root, "vendor/pi-token-usage");
const commit = "295bfb579ff4d159683f6400cffdeb683c461b54";
const files = ["cache.ts", "collector.ts", "memory-cache.ts", "query.ts", "reader.ts", "subagents.ts", "types.ts"];
const hashes = {};
mkdirSync(target, { recursive: true });
for (const file of files) {
  const code = execFileSync("git", ["-C", source, "show", `${commit}:src/${file}`], { encoding: "utf8" });
  // Refuse dirty/wrong working copies even though extraction itself is pinned.
  assert.equal(readFileSync(join(source, "src", file), "utf8"), code, `source drift: ${file}`);
  hashes[file] = createHash("sha256").update(code).digest("hex");
  writeFileSync(join(target, file), code);
}
writeFileSync(join(target, "upstream.json"), JSON.stringify({ repository: "https://github.com/Qser3ne/pi-token-usage", commit, sha256: hashes }, null, 2) + "\n");
console.log(`Vendored pure pi-token-usage collector at ${commit}`);
