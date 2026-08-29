// @test-group governance
// checker-mechanical-spine-check.test.mjs — B1 机械脊柱检查器测试
// (tasks/gap-b1-mechanical-spine-doc-checker).
//
// 契约（orchestration/SPEC-checker-mechanical-spine-contract-2026-08-28.md）：
//   ① checker 的 exit 码词表 ∈ {0,1,2,3}（0=PASS, 1=FAIL, 2=usage/env-error, 3=NOT-EVALUATED——
//     gap-not-evaluated-harness-third-state 的【已认可】扩展）；源码出现 {0,1,2,3} 之外的
//     exit 码字面量 ⇒ 不符。
//   ② 声称支持 --json 就必须真产出 JSON（.ts→JSON.stringify；.sh→jq/python/node/printf-json）。
//
// AC3（能取假，负控制）：造一个用「不符 exit 码」的 checker，检查器必须红。⚠️ 契约把 exit 3 定为
// 【已认可的 NOT-EVALUATED 扩展】（gap-not-evaluated-harness-third-state, done）而非脊柱违例，
// 所以负控制用 exit **4**（{0,1,2,3} 之外的最小码）——这是「exit 3」在第三态统一之后的等价
// 负控制形态（SPEC 起草时脊柱还是 0/1/2，exit 3 是「脊柱之外」；统一后「脊柱之外的最小码」= 4）。
// 本测试同时断言 exit 3 不被判违例、exit 4 被判违例——把这个区分钉死。
//
// Run:
//   scripts/test.sh plugin/test/checker-mechanical-spine-check.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  ALLOWED_EXIT_CODES,
  tsExitCodeLiterals,
  shExitCodeLiterals,
  claimsJson,
  emitsJsonTs,
  jsonViolation,
  checkSpine,
  parseExemptions,
} from "../scripts/checker-mechanical-spine-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const CLI = path.join(repoRoot, "plugin", "scripts", "checker-mechanical-spine-check.ts");

// ── C1 exit-code vocabulary (pure) ──────────────────────────────────────────────────────────────────

test("allowed exit-code vocabulary is exactly {0,1,2,3}", () => {
  assert.deepEqual([...ALLOWED_EXIT_CODES].sort((a, b) => a - b), [0, 1, 2, 3]);
});

test("tsExitCodeLiterals — reads process.exit / exitCode / return, code positions only", () => {
  const src = [
    "process.exit(0);",
    "process.exit(2);",
    "process.exitCode = 1;",
    "exitCode = 2;",
    "return 3; // NOT-EVALUATED",
    "// process.exit(4) — a comment mention must NOT count",
    'const s = "process.exit(5)"; // a string mention must NOT count',
    "process.exit(4);",
  ].join("\n");
  const codes = tsExitCodeLiterals(src);
  assert.deepEqual([...codes].sort((a, b) => a - b), [0, 1, 2, 2, 3, 4]);
});

test("tsExitCodeLiterals — a bare `return N;` computation with `*` is NOT an exit code", () => {
  // mechanism-vitality-check.ts 的 `return 3 * 24 * 3600 * 1000;` 是毫秒常数，不是 exit 码。
  assert.deepEqual(tsExitCodeLiterals("return 3 * 24 * 3600 * 1000;"), []);
});

test("shExitCodeLiterals — reads `exit N`, skips comments/strings", () => {
  const src = [
    "exit 0",
    "exit 2",
    "# exit 5 — a comment mention must NOT count",
    'echo "exit 9" # string mention must NOT count',
    "exit 4",
  ].join("\n");
  assert.deepEqual(shExitCodeLiterals(src), [0, 2, 4]);
});

// ── C2 --json shape (pure) ──────────────────────────────────────────────────────────────────────────

test("claimsJson / emitsJsonTs / jsonViolation", () => {
  assert.equal(claimsJson('args.includes("--json")'), true);
  assert.equal(claimsJson("no json flag here"), false);
  assert.equal(emitsJsonTs("console.log(JSON.stringify({ ok: true }))"), true);
  // template-literal interpolation IS executed code — must count as emitting JSON.
  assert.equal(emitsJsonTs("process.stdout.write(`${JSON.stringify(x)}\\n`)"), true);
  assert.equal(jsonViolation('args.includes("--json")', "ts"), true); // claims --json, no JSON.stringify
  assert.equal(jsonViolation('args.includes("--json"); console.log(JSON.stringify(x))', "ts"), false);
  assert.equal(jsonViolation("no json flag", "ts"), false); // no --json ⇒ not a violation
  assert.equal(jsonViolation('--json) JSON=1; shift ;;\necho "PASS"', "sh"), true); // claims --json, no jq/python/node/printf-json
  assert.equal(jsonViolation('--json) JSON=1; shift ;;\nprintf \'{"ok":true}\'', "sh"), false);
});

// ── checkSpine + ratchet (AC2 棘轮 + AC3 负控制) ────────────────────────────────────────────────────

test("AC3 negative control: a checker with exit code 4 is an UNEXEMPTED violation (RED)", () => {
  const files = [
    { name: "bad-exit-check.ts", kind: "ts", source: "process.exit(4);\n" },
  ];
  const result = checkSpine({ files, exemptions: { exit: [], json: [] }, baselineExemptions: { exit: [], json: [] } });
  assert.equal(result.unexempted.length, 1);
  assert.deepEqual(result.unexempted[0], { checker: "bad-exit-check.ts", dimension: "exit", detail: "exit code 4" });
  assert.equal(result.exempted.length, 0);
});

test("exit 3 (NOT-EVALUATED, sanctioned extension) is NOT a violation", () => {
  const files = [
    { name: "ne-check.ts", kind: "ts", source: "return 3; // NOT-EVALUATED\n" },
  ];
  const result = checkSpine({ files, exemptions: { exit: [], json: [] }, baselineExemptions: { exit: [], json: [] } });
  assert.equal(result.violations.length, 0);
});

test("AC2 negative control: --json claim without a JSON primitive is an UNEXEMPTED violation", () => {
  const files = [
    { name: "fake-json-check.ts", kind: "ts", source: 'if (args.includes("--json")) console.log("PASS");\n' },
  ];
  const result = checkSpine({ files, exemptions: { exit: [], json: [] }, baselineExemptions: { exit: [], json: [] } });
  assert.equal(result.unexempted.length, 1);
  assert.equal(result.unexempted[0].dimension, "json");
});

test("ratchet: an exempted historical violation is reported but NOT red (exempted)", () => {
  const files = [
    { name: "legacy-check.ts", kind: "ts", source: "process.exit(4);\n" },
  ];
  const exemptions = { exit: ["legacy-check.ts"], json: [] };
  const result = checkSpine({ files, exemptions, baselineExemptions: { exit: ["legacy-check.ts"], json: [] } });
  assert.equal(result.violations.length, 1);
  assert.equal(result.exempted.length, 1);
  assert.equal(result.unexempted.length, 0);
});

test("ratchet: an exemption entry ADDED vs the baseline is a ratchet violation (list can only shrink)", () => {
  const files = [];
  const exemptions = { exit: ["sneaky-check.ts"], json: [] };
  const result = checkSpine({ files, exemptions, baselineExemptions: { exit: [], json: [] } });
  assert.deepEqual(result.ratchetAdded, ["exit:sneaky-check.ts"]);
});

test("parseExemptions — valid JSON + throws on corrupt (fail-closed, hard rule 3b)", () => {
  assert.deepEqual(parseExemptions('{"exit":["a-check.ts"],"json":[]}'), { exit: ["a-check.ts"], json: [] });
  assert.throws(() => parseExemptions("{ not json"));
});

// ── REAL repo is GREEN (N=0) ────────────────────────────────────────────────────────────────────────

test("real repo: every shipped checker is spine-compliant (0 unexempted violations)", () => {
  const res = spawnSync("node", ["--no-warnings", "--experimental-strip-types", CLI, "--root", repoRoot, "--json"], {
    encoding: "utf8",
  });
  assert.equal(res.status, 0, res.stderr || res.stdout);
  const out = JSON.parse(res.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.unexempted.length, 0);
  assert.equal(out.ratchetAdded.length, 0);
});

// ── end-to-end negative control (spawn the checker, it must go RED) ─────────────────────────────────

test("end-to-end: a temp scripts-dir carrying a violating checker exits 1 and names it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spine-e2e-"));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "violation-check.ts"), "process.exit(4);\n");
  fs.writeFileSync(path.join(dir, "exemptions.json"), '{"exit":[],"json":[]}\n');
  const res = spawnSync("node", [
    "--no-warnings", "--experimental-strip-types", CLI,
    "--scripts-dir", dir,
    "--exemptions", path.join(dir, "exemptions.json"),
    "--baseline-exemptions", path.join(dir, "exemptions.json"),
  ], { encoding: "utf8" });
  assert.equal(res.status, 1, res.stderr || res.stdout);
  assert.match(res.stdout, /violation-check\.ts \(exit\): exit code 4/);
});

test("end-to-end: a clean temp scripts-dir exits 0", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spine-e2e-ok-"));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "ok-check.ts"), 'console.log(JSON.stringify({ ok: true }));\n');
  fs.writeFileSync(path.join(dir, "exemptions.json"), '{"exit":[],"json":[]}\n');
  const res = spawnSync("node", [
    "--no-warnings", "--experimental-strip-types", CLI,
    "--scripts-dir", dir,
    "--exemptions", path.join(dir, "exemptions.json"),
    "--baseline-exemptions", path.join(dir, "exemptions.json"),
  ], { encoding: "utf8" });
  assert.equal(res.status, 0, res.stderr || res.stdout);
});
