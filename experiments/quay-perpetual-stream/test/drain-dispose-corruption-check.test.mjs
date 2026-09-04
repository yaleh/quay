// @test-group engine
// Tests for drain-dispose-corruption-check.ts — gap-drain-dispose-body-corruption.
// Mirror drain-scheduler.test.mjs's own test shape: pure-function tests + CLI exit-code tests.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  countRealNewlines,
  countLiteralEscapes,
  checkBodyIntegrity,
  main,
} from "../scripts/drain-dispose-corruption-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(__dirname, "..", "scripts", "drain-dispose-corruption-check.ts");

// Every CLI fixture dir is removed once at the end of this file (the carrier-array + after()
// pattern) — a mkdtemp fixture without cleanup leaks a /tmp dir per run.
const _tmpDirs = [];
after(() => {
  for (const dir of _tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

// ── real evidence fixtures ────────────────────────────────────────────────────────────────────────
// Reproduces the exact shape confirmed in wf_bb989746-4a0's own agent-*.jsonl transcripts: the
// corrupted task_write `body` argument had 0 real newlines and 100+ literal "\n" sequences; the
// clean one had 100+ real newlines and 0 literal escapes.
const CORRUPT_BODY =
  '## Proposal\\n\\n把并发批次调度的 touches-orthogonality 预检，从\\"charter-authoring 之后\\"前移到\\"charter-authoring\\n' +
  '之前\\"。当前流程是先花一次 LLM/fork 调用把每个候选的 `## Touches` 写进 charter\\n\\n## Plan\\n\\nN/A\\n\\n' +
  '## DRAIN disposition\n\n- Classification: human-steered\n- Timestamp: 2026-07-26T00:00:00Z\n';

const CLEAN_BODY =
  Array.from({ length: 120 }, (_, i) => `line ${i}`).join("\n") +
  '\n\n## DRAIN disposition\n\n- Classification: human-steered\n- Timestamp: 2026-07-26T00:00:00Z\n';

// ── countRealNewlines / countLiteralEscapes ──────────────────────────────────────────────────────
test("countRealNewlines: counts actual newline characters, matches wc -l semantics", () => {
  assert.equal(countRealNewlines("a\nb\nc"), 2);
  assert.equal(countRealNewlines("a\nb\nc\n"), 3);
  assert.equal(countRealNewlines(""), 0);
  assert.equal(countRealNewlines("no newlines here"), 0);
});

test("countLiteralEscapes: counts literal backslash-n / backslash-t two-char sequences", () => {
  assert.equal(countLiteralEscapes("a\\nb\\tc"), 2);
  assert.equal(countLiteralEscapes("real\nnewline\tand\ttab"), 0); // real chars, not literal sequences
  assert.equal(countLiteralEscapes(""), 0);
});

test("countLiteralEscapes: does not miscount a real newline as a literal escape", () => {
  const text = "line1\nline2\nline3";
  assert.equal(countLiteralEscapes(text), 0);
  assert.equal(countRealNewlines(text), 2);
});

// ── checkBodyIntegrity: real-evidence fixtures ───────────────────────────────────────────────────
test("checkBodyIntegrity: FAILS on the real corrupted-body shape (DIR-113 evidence)", () => {
  const result = checkBodyIntegrity({ oldLineCount: 122, newText: CORRUPT_BODY });
  assert.equal(result.ok, false);
  assert(result.reasons.some((r) => r.startsWith("line-count-shrinkage")), "flags line-count shrinkage");
  assert(result.reasons.some((r) => r.startsWith("literal-escape-sequences")), "flags literal escape sequences");
});

test("checkBodyIntegrity: PASSES on the real clean-body shape (DIR-114 evidence)", () => {
  const result = checkBodyIntegrity({ oldLineCount: 100, newText: CLEAN_BODY });
  assert.equal(result.ok, true);
  assert.deepEqual(result.reasons, []);
});

// ── checkBodyIntegrity: edge cases ───────────────────────────────────────────────────────────────
test("checkBodyIntegrity: FAILS on line-count shrinkage alone (no literal escapes present)", () => {
  // Simulates a body that got REPLACED with something shorter but not JSON-escaped — still corruption.
  const result = checkBodyIntegrity({ oldLineCount: 50, newText: "short\nreplacement\n" });
  assert.equal(result.ok, false);
  assert(result.reasons.some((r) => r.startsWith("line-count-shrinkage")));
  assert(!result.reasons.some((r) => r.startsWith("literal-escape-sequences")));
});

test("checkBodyIntegrity: PASSES when new body legitimately discusses escape sequences in backticks, as long as real newlines dominate", () => {
  // Mirrors this very test/script file's own header comments, which mention `\n`/`\t` a few times
  // while having far more real newlines — must NOT false-positive.
  const newText =
    Array.from({ length: 40 }, (_, i) => `real line ${i} of markdown prose`).join("\n") +
    "\n\nThis doc mentions literal `\\n` and `\\t` a couple of times for illustration.\n";
  const result = checkBodyIntegrity({ oldLineCount: 10, newText });
  assert.equal(result.ok, true, JSON.stringify(result.reasons));
});

test("checkBodyIntegrity: PASSES when body grows (the expected append-only case)", () => {
  const result = checkBodyIntegrity({ oldLineCount: 5, newText: "l1\nl2\nl3\nl4\nl5\nl6\nl7\n" });
  assert.equal(result.ok, true);
});

test("checkBodyIntegrity: handles missing/undefined oldLineCount without throwing (skips shrinkage check)", () => {
  const result = checkBodyIntegrity({ newText: "a\nb\nc\n" });
  assert.equal(typeof result.ok, "boolean");
});

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────
function makeTaskFile(dir, name, text) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, text, "utf8");
  return p;
}

test("CLI: exits 0 and prints ok:true on a clean file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "corruption-check-cli-"));
  _tmpDirs.push(dir);
  const file = makeTaskFile(dir, "CLEAN.md", CLEAN_BODY);
  const out = execFileSync("node", [scriptPath, "--file", file, "--min-lines", "100"], { encoding: "utf8" });
  const parsed = JSON.parse(out);
  assert.equal(parsed.ok, true);
});

test("CLI: exits 1 and prints ok:false + reasons on a corrupted file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "corruption-check-cli-"));
  _tmpDirs.push(dir);
  const file = makeTaskFile(dir, "CORRUPT.md", CORRUPT_BODY);
  let threw = false;
  let stdout = "";
  try {
    execFileSync("node", [scriptPath, "--file", file, "--min-lines", "122"], { encoding: "utf8" });
  } catch (e) {
    threw = true;
    stdout = e.stdout;
  }
  assert.equal(threw, true, "CLI must exit non-zero on corruption");
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.ok, false);
  assert(parsed.reasons.length >= 1);
});

test("CLI: exits 2 on missing file", () => {
  let status = 0;
  try {
    execFileSync("node", [scriptPath, "--file", "/nonexistent/path/NOPE.md", "--min-lines", "5"], { encoding: "utf8" });
  } catch (e) {
    status = e.status;
  }
  assert.equal(status, 2);
});

test("CLI: exits 2 on missing args (usage error)", () => {
  let status = 0;
  try {
    execFileSync("node", [scriptPath], { encoding: "utf8" });
  } catch (e) {
    status = e.status;
  }
  assert.equal(status, 2);
});

// ── main() direct invocation (in-process, mirrors drain-scheduler.test.mjs's own pattern) ─────────
test("main(): returns 0 for a clean file, 1 for a corrupted file", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "corruption-check-main-"));
  _tmpDirs.push(dir);
  const cleanFile = makeTaskFile(dir, "clean.md", CLEAN_BODY);
  const corruptFile = makeTaskFile(dir, "corrupt.md", CORRUPT_BODY);

  const okCode = await main(["node", scriptPath, "--file", cleanFile, "--min-lines", "100"]);
  assert.equal(okCode, 0);

  const failCode = await main(["node", scriptPath, "--file", corruptFile, "--min-lines", "122"]);
  assert.equal(failCode, 1);
});
