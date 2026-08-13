// @test-group engine
// concurrency-literal-check.test.mjs — RED/GREEN tests for the concurrency-literal gate
// (plugin/scripts/concurrency-literal-check.ts, gap-concurrency-literal-only-at-definition-points).
//
// The 硬规则-4-推论二 enforcement: 并发数值字面量（cap/slot/lane/CPU-quota 值）只允许在唯一定义点
// （QUAY_MAX_TASK_SUBAGENTS / QUAY_MAX_CONCURRENT_SUITES / QUAY_MAX_OVERSUBSCRIPTION env 读）或
// 显式声明的回退默认（`concurrency-default-fallback` 标记注释）；未声明的字面量 = 违规（禁「悄悄写死」,
// 不禁「有理由的默认值」）。按位置判定（checker-lib buildNonCodeMask）—— 注释/字符串/正则里拼写该模式
// 不报。
//
// Covered here:
//   - RED  (负控): an undeclared P1 const-def / P2 CLI-flag / P3 CPU-quota / P4 object-key literal
//         reports as a violation.
//   - GREEN: a `concurrency-default-fallback` marker (attached block) makes the same literal a
//         declared-exception; a `process.env.QUAY_MAX_*` read on the line makes it a definition-point;
//         a host-read (`os.availableParallelism`) is NOT a literal; a non-concurrency const
//         (timeout / section-chars / multiplier) is NOT a hit; DEFAULT_BANDS band keys are NOT a hit;
//         a comment/string/regex that merely SPELLS the pattern does NOT report (按位置不按关键词);
//         a shell `#` comment line carrying `--cap 5` does NOT report.
//   - CLI over the REAL corpus: 0 violations (AC3 — every repo concurrency literal is declared).
//
// Run:
//   scripts/test.sh plugin/test/concurrency-literal-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { scanText, scanSurface, scanFiles } from "../scripts/concurrency-literal-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "concurrency-literal-check.ts");

// ── RED (负控): the violation class must be DETECTED ──────────────────────────────────────────────
test("RED (P1): undeclared concurrency-constant definition is a violation", () => {
  const src = "export const FIXED_DISPATCH_CAP = 5;\n";
  const hits = scanText("bad.ts", src);
  assert.equal(hits.length, 1, JSON.stringify(hits));
  assert.equal(hits[0].kind, "violation");
  assert.equal(hits[0].pattern, "P1");
});

test("RED (P2): undeclared CLI concurrency flag literal is a violation", () => {
  const src = "node ready-pool-check.ts --root x --cap 5 --json\n";
  const hits = scanText("bad.sh", src);
  assert.equal(hits.length, 1, JSON.stringify(hits));
  assert.equal(hits[0].kind, "violation");
  assert.equal(hits[0].pattern, "P2");
});

test("RED (P3): undeclared CPU-quota literal is a violation", () => {
  const src = 'limits.cpuQuota = "400%";\n';
  const hits = scanText("bad.ts", src);
  assert.equal(hits.length, 1, JSON.stringify(hits));
  assert.equal(hits[0].kind, "violation");
  assert.equal(hits[0].pattern, "P3");
});

test("RED (P4): undeclared object-literal concurrency key is a violation", () => {
  const src = "const a = analyzeTasks({ root, cap: 5 });\n";
  const hits = scanText("bad.ts", src);
  assert.equal(hits.length, 1, JSON.stringify(hits));
  assert.equal(hits[0].kind, "violation");
  assert.equal(hits[0].pattern, "P4");
});

// ── GREEN: the tolerated patterns must NOT report (or must be declared/definition-point) ──────────
test("GREEN: a concurrency-default-fallback marker makes the same literal a declared exception", () => {
  const src =
    "/** FIXED dispatch cap.\n" +
    " *  concurrency-default-fallback: human-ruled fixed cap.\n" +
    " */\n" +
    "export const FIXED_DISPATCH_CAP = 5;\n";
  const hits = scanText("ok.ts", src);
  assert.equal(hits.length, 1, JSON.stringify(hits));
  assert.equal(hits[0].kind, "declared-exception");
});

test("GREEN: a process.env.QUAY_MAX_* read on the line makes it a definition point", () => {
  const src = "const cap = Number(process.env.QUAY_MAX_TASK_SUBAGENTS ?? 5);\n";
  const hits = scanText("ok.ts", src);
  // The literal 5 is inside the env-read fallback (not a bare RHS), so it is NOT a P1 hit at all —
  // and even if it were, the env read classifies it as a definition point. Assert no violation.
  assert.equal(hits.filter((h) => h.kind === "violation").length, 0, JSON.stringify(hits));
});

test("GREEN: a host-read (os.availableParallelism) is NOT a literal", () => {
  const src = "export const DEFAULT_SERIAL_CONCURRENCY = hostParallelism();\n";
  const hits = scanText("ok.ts", src);
  assert.equal(hits.length, 0, JSON.stringify(hits));
});

test("GREEN: non-concurrency constants (timeout / chars / multiplier / failures) are not hits", () => {
  const src =
    "export const SUITE_MAX_RUNTIME_MS = 45 * 60_000;\n" +
    "export const MIN_SECTION_CHARS = 40;\n" +
    "export const POOL_FLOOR_MULT_DEFAULT = 4;\n" +
    "export const MAX_RECORDED_FAILURES = 200;\n";
  const hits = scanText("ok.ts", src);
  assert.equal(hits.length, 0, JSON.stringify(hits));
});

test("GREEN: DEFAULT_BANDS band keys (go/wait/extreme_wait) are not concurrency-value positions", () => {
  const src = "export const DEFAULT_BANDS = { go: 5, wait: 2, extreme_wait: 1 };\n";
  const hits = scanText("ok.ts", src);
  assert.equal(hits.length, 0, JSON.stringify(hits));
});

test("GREEN: a comment/string that merely SPELLS the pattern does not report (按位置不按关键词)", () => {
  const src =
    "// export const FIXED_DISPATCH_CAP = 5;\n" +
    'const s = "node --cap 5";\n' +
    'const t = "cpuQuota: 400%";\n' +
    "export const FIXED_DISPATCH_CAP = 5;\n"; // this one IS real and undeclared → 1 violation
  const hits = scanText("mixed.ts", src);
  assert.equal(hits.filter((h) => h.kind === "violation").length, 1, JSON.stringify(hits));
});

test("GREEN: a shell # comment line AND a quoted command string carrying --cap 5 do not report", () => {
  const src =
    "# run with --cap 5 (documented convention)\n" +
    'POOL_OUT="$(ready-pool-check --root x --cap 5 --json)"\n';
  // The `#` comment line is masked (shell comment); the command is a double-quoted string, so the
  // `--cap 5` inside it is masked (string) — neither reports (按位置不按关键词).
  const hits = scanText("ok.sh", src);
  assert.equal(hits.filter((h) => h.kind === "violation").length, 0, JSON.stringify(hits));
});

test("RED: an UNQUOTED executed CLI-flag literal in a shell command reports (the real scattered-literal shape)", () => {
  const src = 'POOL_OUT=$(ready-pool-check --root "$ROOT" --cap 5 --json)\n';
  const hits = scanText("bad.sh", src);
  assert.equal(hits.filter((h) => h.kind === "violation").length, 1, JSON.stringify(hits));
});

// ── CLI over the REAL corpus (AC3: 0 violations) ──────────────────────────────────────────────────
test("CLI --gate over the real corpus: 0 violations (AC3)", () => {
  const res = spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECKER, "--gate", "--root", REPO_ROOT, "--json"], { encoding: "utf8" });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.violations.length, 0, JSON.stringify(out.violations));
  // Every hit must be accounted for (定义点/已声明例外) — the DoD's "逐一标注" enumeration.
  assert.ok(out.hits.length >= 7, `expected the declared concurrency literals, got ${out.hits.length}`);
  for (const h of out.hits) assert.notEqual(h.kind, "violation", JSON.stringify(h));
});

test("CLI --scan lists the declared-exception literals (DoD enumeration)", () => {
  const res = spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECKER, "--scan", "--root", REPO_ROOT, "--json"], { encoding: "utf8" });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const out = JSON.parse(res.stdout);
  const kinds = out.hits.map((h) => h.kind);
  assert.ok(kinds.includes("declared-exception"), JSON.stringify(kinds));
  assert.equal(out.violations, 0, JSON.stringify(out.violations));
});

test("scanSurface covers the executable layer (plugin/scripts + scripts)", () => {
  const surface = scanSurface(REPO_ROOT);
  assert.ok(surface.includes("plugin/scripts/concurrency-literal-check.ts"));
  assert.ok(surface.includes("scripts/test.sh"));
  assert.ok(!surface.some((f) => f.includes("/test/")), "test dirs excluded");
});
