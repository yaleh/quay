// @test-group engine
// checker-mutation-check.test.mjs — tasks/gap-checkers-have-never-been-shown-to-fail (AC1-AC7):
// mutation-testing the CHECKERS themselves. The manifest (which checkers are registered) is
// parsed from scripts/test.sh's run_static_checks + CI workflows, never hand-written (AC1);
// every registered checker must have a mutation case where a deliberately injected defect makes
// it go RED and restoring makes it GREEN (AC2); mutations_that_stayed_green must be 0 (AC3);
// breaking the mechanism itself must fail the gate (AC4); the two real failures of the day —
// the rename negative control with a zero-dependency probe (#6) and /live only testing the
// data-missing direction (#10) — are pinned as regressions (AC5).
//
// Run:
//   node --test plugin/test/checker-mutation-check.test.mjs
//   scripts/test.sh plugin/test/checker-mutation-check.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const SCRIPT = path.join(REPO_ROOT, "plugin/scripts/checker-mutation-check.sh");
const CASES_DIR = path.join(REPO_ROOT, "plugin/scripts/checker-mutation-cases");


// ── helpers ───────────────────────────────────────────────────────────────────────────────────────

const tmpDirs = [];

after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

function runScript(args, opts = {}) {
  return spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8", ...opts });
}

function runJson(args, opts = {}) {
  const r = spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8", ...opts });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch (e) {
    assert.fail(`expected JSON stdout for ${args.join(" ")}; got: ${JSON.stringify(r.stdout)} stderr: ${r.stderr}`);
  }
  return { ...r, json };
}

// One full mutation run, shared across the tests that need it (AC3/AC5) — a single ~11s run,
// not one per assertion.
let runReportCache = null;
function runReport() {
  if (!runReportCache) runReportCache = runJson(["--run", "--json"]);
  return runReportCache;
}

function manifestJson() {
  return runJson(["--list", "--json"]);
}

// ── AC1: the manifest is parsed from run_static_checks + CI, never hand-written ───────────────────

test("AC1: manifest includes every run_static_checks checker (parsed, not hand-written)", () => {
  const r = manifestJson();
  const names = r.json.checkers.map((c) => c.name);
  for (const c of [
    "it0-split-or-commit-check",
    "test-framework-policy-check",
    "test-isolation-check",
    "task-contract-check",
    "task-ac-carryover-check",
    "checker-mutation-check",
  ]) {
    assert.ok(names.includes(c), `run_static_checks checker ${c} must be in the manifest`);
  }
});

test("AC1: manifest includes every CI-wired checker", () => {
  const r = manifestJson();
  const names = r.json.checkers.map((c) => c.name);
  for (const c of ["test-coverage-check", "version-consistency-check", "delivery-manifest-check"]) {
    assert.ok(names.includes(c), `CI checker ${c} must be in the manifest`);
  }
  for (const c of r.json.checkers) {
    assert.ok(c.source.includes("run_static_checks") || c.source.includes("ci"), `checker ${c.name} must carry a parsed source`);
  }
});

test("AC1 negative control: a fake checker added to run_static_checks appears in the manifest", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cmc-ac1-"));
  tmpDirs.push(tmp);
  // run_static_checks now lives in plugin/scripts/runner-static-gate.ts (gap-ac128-hub-split-harness-concerns)
  const src = fs.readFileSync(path.join(REPO_ROOT, "plugin/scripts/runner-static-gate.ts"), "utf8");
  const fake = '  echo "== fake checker (negative control) =="\n  bash "${repo_root}/plugin/scripts/fake-negative-control.sh" "${repo_root}"\n';
  const anchor = '  echo "== split-or-commit whole-store check';
  const idx = src.indexOf(anchor);
  assert.ok(idx >= 0, "anchor line must exist in runner-static-gate.ts");
  fs.mkdirSync(path.join(tmp, "plugin/scripts"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "plugin/scripts/runner-static-gate.ts"), src.slice(0, idx) + fake + src.slice(idx));
  fs.mkdirSync(path.join(tmp, "scripts"), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, "scripts/test.sh"), path.join(tmp, "scripts/test.sh"));
  fs.mkdirSync(path.join(tmp, ".github/workflows"), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, ".github/workflows/ci.yml"), path.join(tmp, ".github/workflows/ci.yml"));
  fs.mkdirSync(path.join(tmp, "plugin/scripts/checker-mutation-cases"), { recursive: true });
  fs.cpSync(CASES_DIR, path.join(tmp, "plugin/scripts/checker-mutation-cases"), { recursive: true });

  const r = runJson(["--repo-root", tmp, "--list", "--json"]);
  const names = r.json.checkers.map((c) => c.name);
  assert.ok(names.includes("fake-negative-control"), "a checker added to run_static_checks MUST appear (AC1b: no hand-written list)");
  assert.ok(names.includes("it0-split-or-commit-check"), "existing checkers must still be present");
});

// ── AC2: every registered checker has a mutation case ─────────────────────────────────────────────

test("AC2: every registered checker has a mutation case (checkers_with_mutation === checkers_total)", () => {
  const r = manifestJson();
  assert.equal(r.json.checkers_with_mutation, r.json.checkers_total);
  assert.deepEqual(r.json.uncovered, []);
});

// ── AC3: mutations_that_stayed_green is 0 ─────────────────────────────────────────────────────────

test("AC3: mutations_that_stayed_green is 0 (no checker stays green under its injected defect)", () => {
  const r = runReport();
  assert.equal(r.json.mutations_that_stayed_green, 0,
    `injected defects that failed to redden their checker: ${JSON.stringify(r.json.stayed_green)}`);
  assert.equal(r.json.mutations_that_always_red, 0,
    `checkers that stayed red after restore: ${JSON.stringify(r.json.always_red)}`);
  assert.equal(r.json.errors, 0);
  // Relationship, not snapshot: every registered checker with a mutation case runs once, plus the
  // 2 regression cases. The hardcoded 11 was stale the moment a checker was added to
  // run_static_checks (9 → 12); the count must track the parsed manifest (gap-scoped-runs-pay-full-
  // static-check-overhead surfaced this — the tier's annotations live in the same function body).
  assert.equal(
    Object.keys(r.json.results).length,
    r.json.checkers_total + 2,
    `every registered checker (${r.json.checkers_total}) + 2 regression cases must have a result`,
  );
});

// ── AC4: meta-mutation — breaking the mechanism itself must fail ──────────────────────────────────

test("AC4: --meta-inject breakages fail the gate (mechanism mutates itself)", () => {
  for (const mode of ["empty-manifest", "skip-cases", "invert-red"]) {
    const r = spawnSync("bash", [SCRIPT, "--repo-root", REPO_ROOT, "--check", "--meta-inject", mode], { encoding: "utf8" });
    assert.notEqual(r.status, 0, `--meta-inject ${mode} must fail the gate (status was ${r.status})`);
  }
});

test("AC4: a code-level break of the parser fails the gate (sed-mutated copy)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cmc-ac4-"));
  tmpDirs.push(tmp);
  const broken = path.join(tmp, "broken.sh");
  let src = fs.readFileSync(SCRIPT, "utf8");
  assert.ok(src.includes("(list_run_static_checks_checkers; list_ci_checkers) | sort -u"),
    "parser body must be present for the sed mutation to be meaningful");
  src = src.replace("(list_run_static_checks_checkers; list_ci_checkers) | sort -u", 'echo ""');
  fs.writeFileSync(broken, src);
  const r = spawnSync("bash", [broken, "--repo-root", REPO_ROOT, "--check"], { encoding: "utf8" });
  assert.notEqual(r.status, 0, "a mechanism whose parser returns no checkers must fail the gate");
});

// ── AC5 #6: the rename negative control — a probe that cannot fail is exactly what L_S catches ───

test("AC5 #6: the runnable rename-negative-control regression case passes (quay-dependent probe)", () => {
  const r = runReport();
  assert.equal(r.json.results["regression-rename-negative-control-probe"], "pass",
    "the quay-dependent probe must go RED under the rename and GREEN on restore");
});

test("AC5 #6: a zero-dependency probe under the same defect is FLAGGED as stayed-green (the #6 bug shape)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cmc-ac6-"));
  tmpDirs.push(tmp);
  // Two fake checkers wired into run_static_checks: one whose probe depends on quay, one whose
  // probe is zero-dependency (always exits 0, like resource-gate.sh was in the real #6).
  const src = fs.readFileSync(path.join(REPO_ROOT, "plugin/scripts/runner-static-gate.ts"), "utf8");
  const fake = [
    '  bash "${repo_root}/plugin/scripts/fake-zerodep-check.sh" "${repo_root}"',
    '  bash "${repo_root}/plugin/scripts/fake-quaydep-check.sh" "${repo_root}"',
  ].map((l) => `  ${l}\n`).join("");
  const anchor = '  echo "== split-or-commit whole-store check';
  const idx = src.indexOf(anchor);
  assert.ok(idx >= 0);
  fs.mkdirSync(path.join(tmp, "plugin/scripts"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "plugin/scripts/runner-static-gate.ts"), src.slice(0, idx) + fake + src.slice(idx));
  fs.mkdirSync(path.join(tmp, "scripts"), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, "scripts/test.sh"), path.join(tmp, "scripts/test.sh"));
  fs.mkdirSync(path.join(tmp, ".github/workflows"), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, ".github/workflows/ci.yml"), path.join(tmp, ".github/workflows/ci.yml"));
  fs.mkdirSync(path.join(tmp, "plugin/scripts/checker-mutation-cases"), { recursive: true });

  // The ZERO-dependency case: probe always exits 0, so the injected defect is never seen.
  fs.writeFileSync(path.join(tmp, "plugin/scripts/checker-mutation-cases/fake-zerodep-check.sh"), `#!/usr/bin/env bash
set -u
name="fake-zerodep-check"
workdir="\${1:?}"
mkdir -p "\${workdir}/packages/quay"
printf '{"name":"quay"}\\n' > "\${workdir}/packages/quay/package.json"
# ZERO-dependency probe: never looks at the tree, always exits 0 (the #6 bug shape).
probe() { true; }
probe; [ $? -eq 0 ] || exit 4
mv "\${workdir}/packages/quay" "\${workdir}/packages/quay.moved"
if probe; then
  echo "STAYED-GREEN — the zero-dependency probe cannot fail under the defect (the #6 bug shape)"
  exit 3
fi
exit 4
`);
  // The quay-dependent case: probe greps the marker; the rename MUST redden it.
  fs.writeFileSync(path.join(tmp, "plugin/scripts/checker-mutation-cases/fake-quaydep-check.sh"), `#!/usr/bin/env bash
set -u
name="fake-quaydep-check"
workdir="\${1:?}"
mkdir -p "\${workdir}/packages/quay"
printf '{"name":"quay"}\\n' > "\${workdir}/packages/quay/package.json"
probe() { [ -f "$1/packages/quay/package.json" ] && grep -q '"name".*quay' "$1/packages/quay/package.json"; }
probe "\${workdir}" || exit 4
mv "\${workdir}/packages/quay" "\${workdir}/packages/quay.moved"
if probe "\${workdir}"; then exit 3; fi
mv "\${workdir}/packages/quay.moved" "\${workdir}/packages/quay"
probe "\${workdir}" || exit 4
exit 0
`);

  const r = runJson(["--repo-root", tmp, "--run", "--json"]);
  assert.equal(r.json.results["fake-zerodep-check"], "stayed-green",
    "a zero-dependency probe that cannot fail under the defect must be reported STAYED-GREEN");
  assert.equal(r.json.results["fake-quaydep-check"], "pass",
    "a quay-dependent probe must catch the injected defect (the #6 fix direction)");
  assert.ok(r.json.stayed_green.includes("fake-zerodep-check"),
    "the stayed-green list must name the zero-dependency checker");
  assert.ok(r.json.mutations_that_stayed_green >= 1,
    "the framework must count the zero-dependency probe as a mutation that stayed green");
});

// ── AC5 #10: /live — the activity-present-but-telemetry-empty direction must be covered ──────────

test("AC5 #10: decideLiveState covers activity-present + telemetry-empty ⇒ running-unwired", async () => {
  const { decideLiveState } = await import(path.join(REPO_ROOT, "packages/quay/src/observation.ts"));
  const act = { recentCommits: 2, tickLogFresh: true, tickLogAgeMinutes: 5, anyRecentActivity: true };
  const r = decideLiveState(act);
  assert.equal(r.state, "running-unwired",
    "activity present but telemetry empty must be running-unwired — returning not-running is the #10 hole");
  // The previously-missing direction is also a runnable case in the framework.
  const rr = runReport();
  assert.equal(rr.json.results["regression-live-telemetry-empty-activity"], "pass");
});

// ── AC7: node:test + @test-group engine ───────────────────────────────────────────────────────

test("AC7: this file declares @test-group engine and imports node:test", () => {
  const src = fs.readFileSync(__filename, "utf8");
  assert.match(src, /\/\/ @test-group engine/);
  assert.match(src, /import \{[^}]*test[^}]*\} from "node:test"/);
});

