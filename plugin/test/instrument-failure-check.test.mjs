// @test-group engine
// instrument-failure-check.test.mjs — the manager-instrument failure five-family detector
// (tasks/gap-manager-instrument-failures-need-mechanical-detection-not-carefulness).
//
// The defect: the manager's instrument failures recurred 7 times in one night across five families,
// every one already documented in manager-loop-tick.md §4 — prose rules provably don't work, so the
// five families get a MECHANICAL detection path. This file tests that detector:
//   - AC2 (承重条): per-family positive/negative controls — each family's CORRECT form gives 0 hits,
//     its ERROR form MUST report. A detector that cannot pass the correct form is noise; one that
//     cannot catch the error form is decoration.
//   - AC1: all five families are detected on the REAL tick-doc surface (≥1 real hit each, not
//     synthetic samples).
//   - The ## Contract band (`detected_families ≥ 5`): `--scan` on the default surface emits one
//     `FAMILY-` line per detected family (the Contract measure greps `^FAMILY-`).
//   - The `--gate` static-tier semantics: PASS on the real repo; a family dropping to 0 detections
//     (band) or exceeding its baseline (shrink-only) red-lights.
//
// Run: scripts/test.sh plugin/test/instrument-failure-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  FAMILIES,
  DEFAULT_SURFACE,
  FAMILY_BASELINE,
  gateSurface,
  detectFamily1,
  detectFamily2,
  detectFamily3,
  detectFamily4,
  detectFamily5,
  scanText,
  aggregate,
} from "../scripts/instrument-failure-check.ts";

import { makeTmpDir } from "./helpers/tmp-workspace.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const CHECKER = path.join(repoRoot, "plugin/scripts/instrument-failure-check.ts");

function runChecker(args) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECKER, ...args], {
    encoding: "utf8",
  });
}

/** The five family detectors, indexed by family id (mirrors the scanner's DETECTORS). */
const DETECTOR_FNS = { 1: detectFamily1, 2: detectFamily2, 3: detectFamily3, 4: detectFamily4, 5: detectFamily5 };

/** Count which families fire on a single crafted line (for positive/negative controls). */
function famsOn(line) {
  const out = [];
  for (const fam of FAMILIES) {
    if (DETECTOR_FNS[fam.id](line)) out.push(fam.id);
  }
  return out;
}

// ── AC2: per-family positive/negative controls (the 承重条) ─────────────────────────────────────────

test("AC2 family 1 (self-match): correct form 0 hits, error form MUST report", () => {
  // Correct: `pgrep -xc`/`pgrep -x` exact match — no `-f` with an inline literal. A node comm
  // literal (`pgrep -xc node-MainThread`) is NOT used as a correct-form example here — it is
  // host-dependent (boheidc Node v24.19.0 comm=`MainThread` ⇒ 恒 0) and fires family 4 instead
  // (gap-node-mainthread-comm-literal-host-dependent).
  assert.deepEqual(famsOn("pgrep -xc bash"), []);
  assert.deepEqual(famsOn("ps -e -o pid= -o comm= | awk '$2 == \"bash\"'"), []);
  // Error: `pgrep -f '<literal>'` — the query's own argv contains the pattern ⇒ self-match.
  assert.deepEqual(famsOn("pgrep -f 'quay.ts serve --host <ip>'"), [1]);
  assert.deepEqual(famsOn("pgrep -f \"session-liveness.sh\""), [1]);
});

test("AC2 family 2 (zero-hit-as-absent): correct form 0 hits, error form MUST report", () => {
  // Correct: a grep -c count used as a count (no zero-is-absence annotation), or a count with a
  // positive control. A node comm literal is avoided here — it fires family 4 (host-dependent).
  assert.deepEqual(famsOn("ps -e -o args= | grep -c '/bin/node'"), []);
  assert.deepEqual(famsOn("n=$(grep -c ok file); echo \"$n matches\""), []);
  // Error: grep -c count annotated/asserted as "0 = nothing" — zero-hit treated as absence.
  assert.deepEqual(famsOn("ps -e -o comm= | grep -cx node   # 0 = 没有 node 在跑"), [2, 4]);
  assert.deepEqual(famsOn("grep -cx node && echo 0 命中 不存在"), [2, 4]);
});

test("AC2 family 3 (pipe-then-$?): correct form 0 hits, error form MUST report", () => {
  // Correct: read `$?` BEFORE the pipe, or use PIPESTATUS.
  assert.deepEqual(famsOn("echo \"$?\" | cat"), []);
  assert.deepEqual(famsOn("ls | wc -l; echo \"${PIPESTATUS[0]}\""), []);
  // Error: `$?` read at a position AFTER a pipe — reads the LAST pipeline stage, not the command.
  assert.deepEqual(famsOn("bash x | tail | sed; echo $?"), [3]);
  assert.deepEqual(famsOn("cmd | grep x && echo $?"), [3]);
});

test("AC2 family 4 (fragment-or-host-dependent-literal-as-process-name): correct form 0 hits, error form MUST report", () => {
  // Correct: a cmdline-based / dual-read cross-checked node count — no bare comm literal.
  assert.deepEqual(famsOn("ps -e -o args= | grep -c '/bin/node'"), []);
  assert.deepEqual(famsOn("comm=$(grep -cx node-MainThread) cmd=$(pgrep -cf 'bin/node') — 双读互校"), []);
  // Error: bare fragment (comm=node) never matches the real comm.
  assert.deepEqual(famsOn("ps -e -o comm= | grep -cx node"), [4]);
  assert.deepEqual(famsOn("comm=node 永不匹配"), [4]);
  // Error (gap-node-mainthread-comm-literal-host-dependent): even the "full" node comm literal is
  // host/Node-version-dependent (boheidc Node v24.19.0 comm=`MainThread` ⇒ 恒 0) — a bare node
  // comm-literal count WITHOUT a cmdline cross-check fires family 4.
  assert.deepEqual(famsOn("ps -e -o comm= | grep -cx node-MainThread"), [4]);
  assert.deepEqual(famsOn("pgrep -xc node-MainThread"), [4]);

  // Error (gap-manager-tick-readings-constant-zero-instruments): in-language /proc/<pid>/comm read
  // matched against a node regex as a count, WITHOUT a cmdline cross-check — the SAME fragment /
  // host-dependent-literal-as-process-name failure in JS/TS (boheidc Node v24 comm=`MainThread` ⇒
  // `/node/` regex reads 0). The read line alone (no node predicate) and the cmdline-cross-checked
  // safe form (argv / readCmdline) do NOT fire; the dual-read cross-check full literal with a
  // hyphen does NOT fire either.
  assert.deepEqual(famsOn("if (/node/.test(comm)) nodeCount++;"), [4]);
  assert.deepEqual(famsOn('const comm = fs.readFileSync(path.join(procRoot, d, "comm"), "utf8").trim();'), []);
  assert.deepEqual(famsOn('const exe = argv[0]; if (exe === "node" || exe.endsWith("/node")) nodeCount++;'), []);
  assert.deepEqual(famsOn('if (comm === "node-MainThread") count++;'), []);
});

test("AC2 family 5 (derived-view-as-real-time): correct form 0 hits, error form MUST report", () => {
  // Correct: reading the snapshot WITH a freshness check (stat/mtime/新鲜度/距今).
  assert.deepEqual(famsOn("读 .quay/full-suite-state.json 的 startedAt 核对新鲜度"), []);
  assert.deepEqual(famsOn("stat -c %y .quay/full-suite-state.json"), []);
  assert.deepEqual(famsOn("读 .quay/full-suite-state.json 的 startedAt 距今 < 一个 tick 周期"), []);
  // Error: reading a snapshot's `state` to assert real-time status with NO freshness check.
  assert.deepEqual(famsOn("读 .quay/full-suite-state.json 的 state 断言 green"), [5]);
  assert.deepEqual(famsOn("cat full-suite-state.json | jq -r .state  # 读状态断言 running"), [5]);
});

test("AC2 family 5 refinement (gap-ac59): startedAt/durationMs are FIELD reads, not freshness checks", () => {
  // The two known real instances read snapshot FIELDS as data without a freshness check — they MUST
  // fire. (Old FRESHNESS_TOKENS suppressed them on the bare field names.)
  // manager B3-戊: quotes `startedAt=…` as snapshot content while asserting state=red.
  assert.deepEqual(famsOn(".quay/full-suite-state.json 仍是 state=red scope=main startedAt=2026-08-13T16:19:54Z"), [5]);
  // outer A11: 读 .quay/full-suite-state.json 的 state/reason/durationMs — durationMs is a field read.
  assert.deepEqual(famsOn("读 .quay/full-suite-state.json 的 state/reason/durationMs"), [5]);
  // outer B3: gates on `state != running` with --state-dir (mechanism word), no freshness check.
  assert.deepEqual(famsOn("条件 = 收尾 ≥1 且 `state != running` 且 `--state-dir \"$REPO_ROOT/.quay\"` 放行"), [5]);
  // Negative control: a genuine freshness check (距今/新鲜度) still suppresses even on the same line.
  assert.deepEqual(famsOn("state=red 且 finishedAt 距今 < 一个 tick 周期才算真"), []);
});

test("AC59 true-sample replay: the five known FAMILY-5 instances in the execution cores are detected", () => {
  // The three execution cores were NEVER on the scan surface — FAMILY-5 was numbered but never
  // looked at these three files. Each KNOWN real instance (manager B3-戊 / outer A11+B3 / inner A9)
  // must be detected; missing any ⇒ the scan surface doesn't count as coverage.
  const cores = [
    "orchestration/orchestrator-tick-core.md",
    "orchestration/fast-mode-tick-core.md",
    "orchestration/manager-tick-core.md",
  ];
  const byLine = new Map();
  for (const rel of cores) {
    const byFamily = scanText(fs.readFileSync(path.join(repoRoot, rel), "utf8"), rel);
    for (const h of byFamily[5]) byLine.set(`${rel}:${h.line}`, h.text);
  }
  // manager B3-戊 (manager-tick-core.md:82) — 读 full-suite-state.json 断言 state=red,零新鲜度.
  assert.ok(byLine.has("orchestration/manager-tick-core.md:82"), "manager B3-戊 (line 82) not detected:\n" + JSON.stringify([...byLine.keys()], null, 2));
  assert.match(byLine.get("orchestration/manager-tick-core.md:82"), /full-suite-state\.json/);
  // outer A11 (orchestrator-tick-core.md:34) — 读 state/reason/durationMs,无新鲜度.
  assert.ok(byLine.has("orchestration/orchestrator-tick-core.md:34"), "outer A11 (line 34) not detected:\n" + JSON.stringify([...byLine.keys()], null, 2));
  assert.match(byLine.get("orchestration/orchestrator-tick-core.md:34"), /durationMs/);
  // outer B3 (orchestrator-tick-core.md:52) — 条件 state != running + --state-dir,无新鲜度.
  assert.ok(byLine.has("orchestration/orchestrator-tick-core.md:52"), "outer B3 (line 52) not detected:\n" + JSON.stringify([...byLine.keys()], null, 2));
  assert.match(byLine.get("orchestration/orchestrator-tick-core.md:52"), /state != running/);
  // inner A9 (fast-mode-tick-core.md:28) — 读 full-suite-state.json, running/green ⇒ 派发,无新鲜度.
  assert.ok(byLine.has("orchestration/fast-mode-tick-core.md:28"), "inner A9 (line 28) not detected:\n" + JSON.stringify([...byLine.keys()], null, 2));
  assert.match(byLine.get("orchestration/fast-mode-tick-core.md:28"), /full-suite-state\.json/);
});

// ── AC1 + ## Contract band: real hits on the real tick-doc surface ───────────────────────────────────

test("AC1 + Contract band: all five families are detected on the REAL tick-doc surface", () => {
  const results = DEFAULT_SURFACE.map((rel) => ({
    relFile: rel,
    byFamily: scanText(fs.readFileSync(path.join(repoRoot, rel), "utf8"), rel),
  }));
  const { counts } = aggregate(results);
  for (const fam of FAMILIES) {
    assert.ok(
      counts[fam.id] >= 1,
      `family ${fam.id} (${fam.name}) has 0 real detections on the documented surface — AC1 requires ≥1 real hit`,
    );
  }
  // The ## Contract band: detected_families ≥ 5 (five FAMILY- lines from `--scan`).
  const res = runChecker(["--scan", ...DEFAULT_SURFACE.map((rel) => path.join(repoRoot, rel))]);
  assert.equal(res.status, 0);
  const familyLines = (res.stdout.match(/^FAMILY-/gm) ?? []).length;
  assert.ok(familyLines >= 5, `Contract band: expected ≥5 FAMILY- lines, got ${familyLines}`);
});

test("gate PASS on the real repo: band + shrink-only both hold (counts within baselines)", () => {
  const res = runChecker(["--gate", "--root", repoRoot]);
  assert.equal(res.status, 0, res.stdout);
  assert.match(res.stdout, /PASS/);
});

test("AC3: --gate scans plugin/scripts instrument scripts, not just the markdown docs", () => {
  const surface = gateSurface(repoRoot);
  // AC59: DEFAULT_SURFACE grew from 5 tick docs to 8 — the five driver docs + the three execution
  // cores (orchestrator/fast-mode/manager tick-core), where the known FAMILY-5 instances live.
  assert.equal(DEFAULT_SURFACE.length, 8);
  assert.ok(DEFAULT_SURFACE.includes("orchestration/orchestrator-tick-core.md"), "execution core on surface");
  assert.ok(DEFAULT_SURFACE.includes("orchestration/fast-mode-tick-core.md"), "execution core on surface");
  assert.ok(DEFAULT_SURFACE.includes("orchestration/manager-tick-core.md"), "execution core on surface");
  // The gate surface extends it with every plugin/scripts instrument script (*.ts + *.sh).
  assert.ok(surface.length > DEFAULT_SURFACE.length, `expected instruments added, got ${surface.length}`);
  assert.ok(surface.includes("plugin/scripts/manager-tick-readings.ts"), "the constant-zero instrument script must be on the gate surface");
  assert.ok(surface.some((f) => f.endsWith(".sh")), "expected at least one .sh instrument on the surface");
  assert.ok(surface.some((f) => f.endsWith(".ts")), "expected at least one .ts instrument on the surface");
  // The --gate CLI actually uses that surface (the JSON `files` field carries the relative list).
  const j = JSON.parse(runChecker(["--gate", "--root", repoRoot, "--json"]).stdout);
  assert.equal(j.files.length, surface.length);
  assert.ok(j.files.includes("plugin/scripts/manager-tick-readings.ts"));
});

test("AC3: gateSurface is lenient when plugin/scripts is absent (temp-dir gate still scans the doc surface)", (t) => {
  const dir = makeTmpDir("ifc-gatesurf-");
  // No plugin/scripts under the temp dir ⇒ instruments subset skipped.
  assert.deepEqual(gateSurface(dir), DEFAULT_SURFACE);
});

// ── Negative controls through the real CLI on a crafted surface ─────────────────────────────────────

function writeSurface(dir, text) {
  fs.writeFileSync(path.join(dir, "surface.md"), text);
}

test("AC2 CLI negative control: a fixture with all five error forms reports 5 FAMILY lines", () => {
  const dir = makeTmpDir("ifc-err-");
  writeSurface(
    dir,
    [
      "pgrep -f 'quay.ts serve --host <ip>'", // family 1
      "grep -cx node # 0 = 没有 node 在跑", // family 2 (also 4 via comm=? no comm= here, ok)
      "cmd | grep x; echo $?", // family 3
      "ps -e -o comm= | grep -cx node", // family 4
      "读 .quay/full-suite-state.json 的 state 断言 green", // family 5
    ].join("\n"),
  );
  const res = runChecker(["--scan", path.join(dir, "surface.md")]);
  assert.equal(res.status, 0);
  const familyLines = (res.stdout.match(/^FAMILY-/gm) ?? []).length;
  assert.ok(familyLines >= 5, `expected ≥5 FAMILY- lines, got ${familyLines}: ${res.stdout}`);
});

test("AC2 CLI negative control: a fixture with all five CORRECT forms reports 0 FAMILY lines", () => {
  const dir = makeTmpDir("ifc-ok-");
  writeSurface(
    dir,
    [
      "pgrep -xc bash", // family 1 correct (exact match, no self-match)
      "ps -e -o args= | grep -c '/bin/node' # cmdline-based count, no bare comm literal", // 2+4 correct
      "echo \"$?\" | cat", // family 3 correct (read before pipe)
      "读 .quay/full-suite-state.json 的 startedAt 核对新鲜度", // family 5 correct
    ].join("\n"),
  );
  const res = runChecker(["--scan", path.join(dir, "surface.md")]);
  assert.equal(res.status, 0);
  const familyLines = (res.stdout.match(/^FAMILY-/gm) ?? []).length;
  assert.equal(familyLines, 0, `expected 0 FAMILY- lines for correct forms, got ${familyLines}: ${res.stdout}`);
});

test("AC3: a crafted .ts file with the in-language comm regex count reports family 4 through the CLI", () => {
  const dir = makeTmpDir("ifc-ts-");
  fs.writeFileSync(
    path.join(dir, "instrument.ts"),
    "// 恒值仪器：comm 正则读法（无 cmdline 交叉校验）\n" +
    "const comm = fs.readFileSync(path.join(procRoot, d, \"comm\"), \"utf8\").trim();\n" +
    "if (/node/.test(comm)) nodeCount++;\n", // ← 旧 manager-tick-readings.ts:183 同形
  );
  const res = runChecker(["--scan", path.join(dir, "instrument.ts")]);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /FAMILY-4/, `expected the in-language comm regex count to report family 4: ${res.stdout}`);
});

test("AC3: the cmdline-cross-checked safe form reports 0 family-4 hits through the CLI", () => {
  const dir = makeTmpDir("ifc-ts-ok-");
  fs.writeFileSync(
    path.join(dir, "instrument.ts"),
    "const exe = readCmdline(pid, procRoot)[0] ?? \"\";\n" + // cmdline 交叉校验（安全形）
    "if (exe === \"node\" || exe.endsWith(\"/node\")) nodeCount++;\n" +
    "if (comm === \"node-MainThread\") crossCount++;\n", // 双读交叉侧字面量（含连字符，安全形）
  );
  const res = runChecker(["--scan", path.join(dir, "instrument.ts")]);
  assert.equal(res.status, 0);
  const familyLines = (res.stdout.match(/^FAMILY-/gm) ?? []).length;
  assert.equal(familyLines, 0, `expected 0 FAMILY lines for the safe form, got ${familyLines}: ${res.stdout}`);
});

// ── --gate semantics: band and shrink-only red-light the right way ───────────────────────────────────

function copySurfaceTo(tmpRoot) {
  for (const rel of DEFAULT_SURFACE) {
    const dest = path.join(tmpRoot, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, rel), dest);
  }
}

test("--gate: a NEW failure-form instance beyond the baseline red-lights (shrink-only)", () => {
  const dir = makeTmpDir("ifc-gate-");
  copySurfaceTo(dir);
  // Baseline gate on the copied surface must PASS (same counts as the real repo).
  assert.equal(runChecker(["--gate", "--root", dir]).status, 0);
  // INJECT (shrink-only): push family-1 over its baseline → MUST go RED.
  // Adaptive inject count: baseline - current + 1. From any green surface (current ≤ baseline,
  // guaranteed by the baseline check above) this always exceeds FAMILY_BASELINE[1], so the checker
  // cannot stay green regardless of doc churn. (Same fix as checker-mutation-cases/instrument-failure-check.sh
  // 431f591d — pre-2026-08-12 this hardcoded ONE instance, which broke when the AC38 doc-split shrank
  // family-1 from 2 to 1: injecting 1 gave 1→2 ≤ baseline=2, a stale-mutation-case false-green.)
  const gateJson = JSON.parse(runChecker(["--gate", "--root", dir, "--json"]).stdout);
  const inject = gateJson.baselines[1] - gateJson.counts[1] + 1;
  const target = path.join(dir, "orchestration/orchestrator-loop-tick.md");
  for (let i = 0; i < inject; i++) {
    fs.appendFileSync(target, "\n> pgrep -f 'quay.ts serve' 又一条自匹配\n");
  }
  const res = runChecker(["--gate", "--root", dir]);
  assert.equal(res.status, 1, `expected RED after injecting ${inject} family-1 instance(s) beyond baseline: ${res.stdout}`);
  assert.match(res.stdout, /FAMILY-1.*ABOVE-BASELINE|shrink-only/);
});

test("--gate: a documented family dropping to 0 detections red-lights (band)", () => {
  const dir = makeTmpDir("ifc-band-");
  copySurfaceTo(dir);
  // Baseline PASS.
  assert.equal(runChecker(["--gate", "--root", dir]).status, 0);
  // Remove every family-3 instance (the §4 row in BOTH manager docs — orchestration + plugin/loop
  // mirror) → family 3 count 0 → RED (band: a documented family no longer mechanically detectable).
  for (const rel of ["orchestration/manager-loop-tick.md", "plugin/loop/manager-loop-tick.md"]) {
    const target = path.join(dir, rel);
    let text = fs.readFileSync(target, "utf8");
    text = text.replace(/\| \*\*管道后读 \$?.*?\n/, "");
    fs.writeFileSync(target, text);
  }
  const res = runChecker(["--gate", "--root", dir]);
  assert.equal(res.status, 1, `expected RED after removing the family-3 row: ${res.stdout}`);
  assert.match(res.stdout, /FAMILY-3.*NO-DETECTION|band violation/);
});
