// @test-group engine
// concurrency-literal-check.test.mjs — RED/GREEN tests for the concurrency-literal gate
// (plugin/scripts/concurrency-literal-check.ts, gap-concurrency-literal-only-at-definition-points).
//
// The 硬规则-4-推论二 enforcement: 并发数值字面量（cap/slot/lane/CPU-quota 值）只允许在唯一定义点
// （QUAY_MAX_TASK_SUBAGENTS / QUAY_MAX_CONCURRENT_SUITES / QUAY_MAX_OVERSUBSCRIPTION env 读）或
// 显式声明的回退默认（`concurrency-default-fallback` 标记注释）；未声明的字面量 = 违规。按位置判定
// （checker-lib buildNonCodeMask）—— 注释/字符串/正则里拼写该模式不报。
//
// path→content (gap-b5-input-shape-path-to-content): the JUDGMENT logic is tested as the PURE
// `scanText(rel, src)` function over string content — ZERO spawn, ZERO mkdtemp. The CLI shell
// (main) is exercised IN-PROCESS (not a subprocess) against the real repo and one COMMITTED fixture
// tree (plugin/test/fixtures/concurrency-literal/.claude/workflows/bad.js) instead of a temp dir.
// 负控制 (AC2): commenting out any judgment branch (e.g. the `if (p.domainCheck && !p.domainCheck(m))`
// P1 keyword filter, or the P5 systemd-run-limit scan) makes the corresponding RED test fail.
//
// Covered here:
//   - RED: an undeclared P1 const-def / P2 CLI-flag / P3 CPU-quota / P4 object-key literal reports
//         as a violation; a P5 CPU-quota literal inside a systemd-run-limit override STRING reports.
//   - GREEN: a `concurrency-default-fallback` marker makes the same literal a declared-exception; a
//         `process.env.QUAY_MAX_*` read makes it a definition-point; a host-read is NOT a literal;
//         non-concurrency constants / DEFAULT_BANDS keys are NOT hits; a comment/string/regex that
//         merely SPELLS the pattern does NOT report; a shell `#` comment carrying `--cap 5` does not
//         report; a systemd-run override string WITHOUT CPUQuota is NOT a hit; a doc mention is NOT a hit.
//   - AC1: the scan surface EXPLICITLY enumerates .claude/workflows/ + plugin/workflows/.
//   - AC2: negative control — a committed .claude/workflows/bad.js carrying CPUQuota=400% makes
//         --gate go red (in-process, exit 1).
//   - AC3: the checker documents the seam-enumeration principle; 0 violations over the real corpus.
//
// Run:
//   scripts/test.sh plugin/test/concurrency-literal-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { scanText, scanSurface, main } from "../scripts/concurrency-literal-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "concurrency-literal-check.ts");
const FIXTURE_ROOT = path.join(__dirname, "fixtures", "concurrency-literal");

/** Run `fn` in-process, capturing console.log/console.error (the CLI shell prints to stdout, never
 *  spawning a subprocess — path→content). Returns { result, stdout, stderr }. */
function captureConsole(fn) {
  const origLog = console.log, origErr = console.error;
  const out = [], err = [];
  console.log = (...a) => out.push(a.join(" "));
  console.error = (...a) => err.push(a.join(" "));
  try { return { result: fn(), stdout: out.join("\n"), stderr: err.join("\n") }; }
  finally { console.log = origLog; console.error = origErr; }
}

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

test("RED (P5): CPU-quota literal inside a systemd-run-limit override STRING is a violation (the historical 400% leak shape)", () => {
  const src = 'systemdRunLimits = "MemoryMax=4G CPUQuota=400% TasksMax=200",\n';
  const hits = scanText(".claude/workflows/execute-suite-fix.js", src);
  assert.equal(hits.length, 1, JSON.stringify(hits));
  assert.equal(hits[0].kind, "violation");
  assert.equal(hits[0].pattern, "P5");
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
  const hits = scanText("ok.sh", src);
  assert.equal(hits.filter((h) => h.kind === "violation").length, 0, JSON.stringify(hits));
});

test("RED: an UNQUOTED executed CLI-flag literal in a shell command reports (the real scattered-literal shape)", () => {
  const src = 'POOL_OUT=$(ready-pool-check --root "$ROOT" --cap 5 --json)\n';
  const hits = scanText("bad.sh", src);
  assert.equal(hits.filter((h) => h.kind === "violation").length, 1, JSON.stringify(hits));
});

test("GREEN (P5): a systemd-run override string WITHOUT CPUQuota is not a hit (the current correct form)", () => {
  const src = 'systemdRunLimits = "MemoryMax=4G TasksMax=200",\n';
  const hits = scanText(".claude/workflows/execute-suite-fix.js", src);
  assert.equal(hits.length, 0, JSON.stringify(hits));
});

test("GREEN (P5): a string that merely SPELLS CPUQuota (no MemoryMax=/TasksMax= sibling key) is not a hit", () => {
  const src = 'const t = "cpuQuota: 400%";\n';
  const hits = scanText("ok.js", src);
  assert.equal(hits.length, 0, JSON.stringify(hits));
});

test("GREEN (P5): a COMMENT mention of the override string is not a hit (按位置不按关键词)", () => {
  const src = "/*\n * Parse a `MemoryMax=4G CPUQuota=400% TasksMax=200` override string\n */\n";
  const hits = scanText("ok.ts", src);
  assert.equal(hits.length, 0, JSON.stringify(hits));
});

test("GREEN (P5): a shell # comment carrying the override string is not a hit", () => {
  const src = '# QUAY_TEST_SYSTEMD_RUN_LIMITS seam can set CPUQuota=200% (documented convention)\n';
  const hits = scanText("ok.sh", src);
  assert.equal(hits.length, 0, JSON.stringify(hits));
});

test("GREEN (P5): a template literal interpolating the value (no literal CPUQuota=num%) is not a hit", () => {
  const src = 'const launchEnv = `QUAY_TEST_SYSTEMD_RUN_LIMITS=\'${systemdRunLimits}\'`\n';
  const hits = scanText("ok.js", src);
  assert.equal(hits.length, 0, JSON.stringify(hits));
});

// ── CLI shell IN-PROCESS (not a subprocess) over the real corpus ────────────────────────────────
test("CLI --gate over the real corpus: 0 violations, exit 0 (AC3 — in-process, zero spawn)", () => {
  const { result, stdout } = captureConsole(() => main(["node", "concurrency-literal-check.ts", "--gate", "--root", REPO_ROOT, "--json"]));
  assert.equal(result, 0, stdout);
  const out = JSON.parse(stdout);
  assert.equal(out.ok, true);
  assert.equal(out.violations.length, 0, JSON.stringify(out.violations));
  assert.ok(out.hits.length >= 7, `expected the declared concurrency literals, got ${out.hits.length}`);
  for (const h of out.hits) assert.notEqual(h.kind, "violation", JSON.stringify(h));
});

test("CLI --scan lists the declared-exception literals (DoD enumeration — in-process)", () => {
  const { result, stdout } = captureConsole(() => main(["node", "concurrency-literal-check.ts", "--scan", "--root", REPO_ROOT, "--json"]));
  assert.equal(result, 0, stdout);
  const out = JSON.parse(stdout);
  const kinds = out.hits.map((h) => h.kind);
  assert.ok(kinds.includes("declared-exception"), JSON.stringify(kinds));
  assert.equal(out.violations, 0, JSON.stringify(out.violations));
});

test("scanSurface covers the executable layer (plugin/scripts + scripts + .claude/workflows + plugin/workflows)", () => {
  const surface = scanSurface(REPO_ROOT);
  assert.ok(surface.includes("plugin/scripts/concurrency-literal-check.ts"));
  assert.ok(surface.includes("scripts/test.sh"));
  assert.ok(surface.includes(".claude/workflows/execute-suite-fix.js"));
  assert.ok(surface.includes("plugin/workflows/execute-suite-fix.js"));
  assert.ok(!surface.some((f) => f.includes("/test/")), "test dirs excluded");
});

// ── AC1: 扫描面显式枚举 .claude/workflows/ (可 grep 的清单, 非一个 glob 糊过去) ──────────────────────
test("AC1: the scan surface EXPLICITLY enumerates .claude/workflows/ + plugin/workflows/", () => {
  const surface = scanSurface(REPO_ROOT);
  assert.ok(surface.includes(".claude/workflows/execute-suite-fix.js"), "the seam file must be in the surface");
  assert.ok(surface.includes(".claude/workflows/fan-in-execute.js"));
  assert.ok(surface.includes("plugin/workflows/execute-suite-fix.js"), "the shipping mirror must be in the surface");
  const surfaceSrc = fs.readFileSync(CHECKER, "utf8");
  assert.ok(surfaceSrc.includes('".claude/workflows"'), "SCAN_ROOTS must name the .claude/workflows root explicitly");
});

// ── AC2: 负控制 —— CPUQuota=400% 塞进一个 COMMITTED 的 .claude/workflows/bad.js ⇒ gate 必红 ────────
test("AC2 negative control: CPUQuota=400% in a committed .claude/workflows/bad.js makes the gate go red (exit 1, in-process)", () => {
  // The committed fixture tree is plugin/test/fixtures/concurrency-literal/.claude/workflows/bad.js
  // — the same 400% leak shape the P5 RED test detects at the string level, here driven through the
  // full gate wiring (main → scanSurface → scanFiles → verdict) with NO temp dir and NO subprocess.
  const { result, stdout } = captureConsole(() => main(["node", "concurrency-literal-check.ts", "--gate", "--root", FIXTURE_ROOT, "--json"]));
  assert.equal(result, 1, "gate must go red on a 400% literal in .claude/workflows/ — " + stdout);
  const out = JSON.parse(stdout);
  assert.equal(out.ok, false);
  const v = out.violations.find((x) => x.file === ".claude/workflows/bad.js");
  assert.ok(v, "violation must be attributed to the .claude/workflows file — " + JSON.stringify(out.violations));
  assert.equal(v.pattern, "P5");
});

// ── AC3: seam 枚举原则写进检查器的判据文档/注释 ──────────────────────────────────────────────────────
test("AC3: the checker documents the seam-enumeration principle (a source fix must enumerate every bypass seam)", () => {
  const src = fs.readFileSync(CHECKER, "utf8");
  assert.ok(src.includes("SEAM ENUMERATION"), "checker header must carry the SEAM ENUMERATION marker");
  assert.ok(src.includes("QUAY_TEST_SYSTEMD_RUN_LIMITS"), "the enumerated seam must be named");
  assert.ok(src.includes(".claude/workflows"), "the coverage note must name the workflow dir");
});
