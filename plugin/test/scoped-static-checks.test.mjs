// @test-group engine
// scoped-static-checks.test.mjs — gap-scoped-runs-pay-full-static-check-overhead: the change-
// relevant static-check TIER for scoped task runs. Covers AC1 (subset rule), AC2 (full set
// unchanged — the registry is a complete partition), AC3 (the mapping is MECHANICAL, parsed from
// scripts/test.sh's run_static_checks body, never hand-listed), AC4 (two-direction negative
// controls), and the `--strict-subset` contract-consumer mode that makes the scoped tier CATCH a
// touched task's Contract violation.
//
// Run:
//   scripts/test.sh plugin/test/scoped-static-checks.test.mjs
//   node --test plugin/test/scoped-static-checks.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SEL_CLI = path.join(REPO_ROOT, "plugin", "scripts", "select-static-checks-for-touches.ts");
const CONTRACT_CLI = path.join(REPO_ROOT, "plugin", "scripts", "task-contract-check.ts");
const TEST_SH = path.join(REPO_ROOT, "plugin", "scripts", "runner-static-gate.ts");

function t(name, fn) {
  test(name, fn);
}

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────────────

async function importMod() {
  return import(SEL_CLI);
}

function makeWorkspace(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scoped-static-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  return root;
}

function cleanup(root) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

function writeTask(root, id, body) {
  const f = path.join(root, "tasks", `${id}.md`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, `---\nid: ${id}\nstatus: todo\nextra:\n  schema: v1\n---\n\n${body}\n`, "utf8");
}

function runSelCli(root, ...args) {
  const res = spawnSync("node", ["--no-warnings", "--experimental-strip-types", SEL_CLI, "--root", root, ...args], {
    encoding: "utf8",
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function runNodeCli(cli, root, ...args) {
  const res = spawnSync("node", ["--no-warnings", "--experimental-strip-types", cli, ...args], {
    cwd: root,
    encoding: "utf8",
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

// A valid ## Contract block (all five keys present + a Dispatch review — passes the consumer check).
const VALID_CONTRACT = `## Contract

measure   m = \`echo 1\` field f
band      m = 1
invariant full_gate = 1
invoke    \`scripts/test.sh --list-files\`
control   touched violation => scoped catches; unrelated ratchet => full catches
resume    step 1 written before step 2

## Dispatch review

reviewer: none
at: 2026-08-05T00:00:00Z
changed: fixture
status: todo
`;

// A ## Contract block missing the field on `measure` → measure-no-field (the AC4-i injected defect).
const BAD_CONTRACT = `## Contract

measure   m = \`echo 1\`

## Dispatch review

reviewer: none
at: 2026-08-05T00:00:00Z
changed: fixture
status: todo
`;

// ── AC3: registry parsing is mechanical (from scripts/test.sh's run_static_checks body) ─────────────

t("AC3 — registry is parsed from scripts/test.sh, tier annotations land on the right checkers", async () => {
  const mod = await importMod();
  const registry = mod.parseStaticCheckRegistry(fs.readFileSync(TEST_SH, "utf8"));
  const byName = new Map(registry.map((c) => [c.name, c]));
  // The always-relevant ## Contract consumer must be `always` + `subset-touched`.
  const contract = byName.get("task-contract-check");
  assert.ok(contract, "task-contract-check must be in the registry");
  assert.equal(contract.tier, "always");
  assert.equal(contract.scopedMode, "subset-touched");
  // checker-mutation-check (the ~13s meta-check) must be `full` — never in scoped.
  assert.equal(byName.get("checker-mutation-check")?.tier, "full");
  // split-or-commit + ac-carryover whole-store ratchets are `full` (deferred).
  assert.equal(byName.get("it0-split-or-commit-check")?.tier, "full");
  assert.equal(byName.get("task-ac-carryover-check")?.tier, "full");
  // test-framework-policy / test-isolation are `change` with the test globs as objects.
  for (const n of ["test-framework-policy-check", "test-isolation-check"]) {
    const c = byName.get(n);
    assert.equal(c.tier, "change");
    assert.ok(c.objects.some((o) => o === "plugin/test/"), `${n} must have the plugin/test object`);
  }
  // The registry must cover every checker checker-mutation-check's own parser sees (single source).
  assert.ok(registry.length >= 9, `registry should have the run_static_checks checkers, got ${registry.length}`);
});

t("AC3 — an unannotated checker defaults to `full` (fail-safe: stays in the full set only)", async () => {
  const mod = await importMod();
  const reg = mod.parseStaticCheckRegistry(
    'run_static_checks() {\n  bash "${repo_root}/plugin/scripts/no-annotation-check.sh" "${repo_root}"\n}\n',
  );
  assert.equal(reg.length, 1);
  assert.equal(reg[0].name, "no-annotation-check");
  assert.equal(reg[0].tier, "full");
});

// ── matchesObject unit tests ─────────────────────────────────────────────────────────────────────────

t("matchesObject — dir prefix, concrete file, and star-glob forms", async () => {
  const mod = await importMod();
  const { matchesObject } = mod;
  assert.equal(matchesObject("tasks/", "tasks/foo.md"), true);
  assert.equal(matchesObject("tasks/", "plugin/test/foo.test.mjs"), false);
  assert.equal(matchesObject("plugin/test/", "plugin/test/foo.test.mjs"), true);
  assert.equal(matchesObject("docs/proposals/", "docs/proposals/exp5-x.md"), true);
  assert.equal(matchesObject("docs/proposals/", "plugin/loop/fast-mode-loop-tick.md"), false);
  assert.equal(matchesObject("orchestration/QUAY-OUTER-HANDOFF.md", "orchestration/QUAY-OUTER-HANDOFF.md"), true);
  assert.equal(matchesObject("orchestration/QUAY-OUTER-HANDOFF.md", "orchestration/other.md"), false);
  // star-globs: **/*.sh matches any shell script path.
  assert.equal(matchesObject("**/*.sh", "plugin/scripts/foo.sh"), true);
  assert.equal(matchesObject("**/*.sh", "scripts/test.sh"), true);
  assert.equal(matchesObject("**/*.sh", "plugin/loop/fast-mode-loop-tick.md"), false);
  // packages/*/test/ matches any package test dir.
  assert.equal(matchesObject("packages/*/test/", "packages/quay/test/foo.test.mjs"), true);
  assert.equal(matchesObject("packages/*/test/", "plugin/test/foo.test.mjs"), false);
});

// ── AC1: the scoped subset rule ──────────────────────────────────────────────────────────────────────

t("AC1 — a test-file touch selects the test ratchets + contract consumer, defers the rest", async () => {
  const mod = await importMod();
  const registry = mod.parseStaticCheckRegistry(fs.readFileSync(TEST_SH, "utf8"));
  const { selected, deferred } = mod.selectStaticChecksForTouches(
    ["tasks/foo.md", "plugin/test/foo.test.mjs"],
    registry,
  );
  const names = selected.map((s) => s.name);
  const regNames = registry.map((s) => s.name);
  // Change-relevant: the test-file ratchets (a test file is touched) + the always contract consumer.
  assert.ok(names.includes("test-framework-policy-check"), `test-framework-policy selected: ${names}`);
  assert.ok(names.includes("test-isolation-check"), `test-isolation selected: ${names}`);
  // The always-relevant ## Contract consumer runs against the touched task file.
  assert.ok(names.includes("task-contract-check"), `contract consumer selected: ${names}`);
  const contract = selected.find((s) => s.name === "task-contract-check");
  assert.deepEqual(contract.touchedTasks, ["tasks/foo.md"]);
  // checker-mutation + unrelated repo-level ratchets are DEFERRED (full gate catches them).
  assert.ok(deferred.includes("checker-mutation-check"), `checker-mutation deferred: ${deferred}`);
  assert.ok(deferred.includes("adr016-screen-use-check"), `adr016 deferred (no .sh touched): ${deferred}`);
  // AC51 (gap-ac51-assertion-surface-split): the DOC-CLASS checkers (strategic-doc / drive-contract)
  // moved OUT of the scoped registry entirely (their home is run_doc_checks → pre-commit). They are
  // neither selected nor deferred — they are absent from the scoped surface by construction.
  assert.ok(!regNames.includes("strategic-doc-staleness-check"), "strategic-doc moved to pre-commit (run_doc_checks), not in scoped registry");
  assert.ok(!regNames.includes("drive-contract-check"), "drive-contract moved to pre-commit (run_doc_checks), not in scoped registry");
  // AC2 partition: every checker is either selected or deferred — nothing is dropped.
  for (const c of registry) {
    const inSel = names.includes(c.name);
    const inDef = deferred.includes(c.name);
    assert.ok(inSel !== inDef, `checker ${c.name} must be in exactly one of selected/deferred`);
  }
});

t("AC1 — a docs touch selects NO doc ratchet (AC51: doc checks live at pre-commit), defers the test ratchets", async () => {
  const mod = await importMod();
  const registry = mod.parseStaticCheckRegistry(fs.readFileSync(TEST_SH, "utf8"));
  const { selected, deferred } = mod.selectStaticChecksForTouches(
    ["docs/proposals/exp5-x.md", "tasks/foo.md"],
    registry,
  );
  const names = selected.map((s) => s.name);
  const regNames = registry.map((s) => s.name);
  // AC51: strategic-doc is no longer in the scoped registry (run_doc_checks → pre-commit), so a
  // docs touch selects no doc ratchet here — the pre-commit hook runs it at commit time instead.
  assert.ok(!regNames.includes("strategic-doc-staleness-check"), "strategic-doc not in scoped registry");
  assert.ok(!names.includes("strategic-doc-staleness-check"), `strategic-doc NOT selected (pre-commit): ${names}`);
  assert.ok(!names.includes("test-framework-policy-check"), `test ratchet NOT selected: ${names}`);
  assert.ok(deferred.includes("test-framework-policy-check"));
  assert.ok(deferred.includes("checker-mutation-check"));
  // A shell-script touch selects adr016 (adr016 is CODE-class — it scans .sh/.bash too).
  const r2 = mod.selectStaticChecksForTouches(["plugin/scripts/foo.sh", "tasks/foo.md"], registry);
  assert.ok(r2.selected.map((s) => s.name).includes("adr016-screen-use-check"));
});

// ── AC3/AC1: full-width CJK annotations are stripped (the mapping must not skip checks) ──────────────

// A minimal annotated runner-static-gate.ts for hermetic CLI tests (the real annotations live in the
// repo's runner-static-gate.ts and are covered by the AC3 registry test above; this fixture exercises
// the selector CLI end-to-end without depending on the real repo state).
const MINI_TEST_SH = `#!/usr/bin/env bash
set -euo pipefail
repo_root="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
run_static_checks() {
  echo "== test-framework-policy =="
  # @static-tier change
  # @static-object plugin/test/ packages/*/test/
  bash "\${repo_root}/plugin/scripts/test-framework-policy-check.sh" "\${repo_root}"
  echo "== test-isolation =="
  # @static-tier change
  # @static-object plugin/test/
  bash "\${repo_root}/plugin/scripts/test-isolation-check.sh" "\${repo_root}"
  echo "== contract =="
  # @static-tier always
  # @static-scoped-mode subset-touched
  node --no-warnings --experimental-strip-types "\${repo_root}/plugin/scripts/task-contract-check.ts" --root "\${repo_root}"
  echo "== checker-mutation =="
  # @static-tier full
  bash "\${repo_root}/plugin/scripts/checker-mutation-check.sh" --check
}
`;

t("AC1/AC3 — full-width （…） annotations are stripped from touches before relevance", async () => {
  // NOTE: the registry fixture is written via writeFileSync (not as a makeWorkspace KEY) so the
  // workspace variable's initializer never contains a "test.sh" string literal — the test-isolation
  // `spawns-test-sh` code-position heuristic flags any spawn region that mentions a variable
  // which ANYWHERE holds a test.sh path, and this test DOES spawn the selector CLI against the
  // workspace root. (gap-ac128 moved the registry from scripts/test.sh to runner-static-gate.ts.)
  const root = makeWorkspace({
    "plugin/test/foo.test.mjs": "export const x = 1;\n",
    "scripts/foo.ts": "export const y = 1;\n",
  });
  fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "plugin", "scripts", "runner-static-gate.ts"), MINI_TEST_SH);
  try {
    writeTask(root, "t1", "## Touches\n- plugin/test/（AC4 负控制 + 档位测试）\n- scripts/foo.ts\n");
    // The full-width （…） annotation must be stripped so `plugin/test/` matches the test ratchet.
    const r = runSelCli(root, "--task", "t1", "--json");
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.ok(out.selected.includes("test-framework-policy-check"), `selected: ${out.selected}`);
    assert.ok(out.selected.includes("test-isolation-check"), `selected: ${out.selected}`);
    // checker-mutation is always deferred, never selected.
    assert.ok(!out.selected.includes("checker-mutation-check"), `deferred: ${out.deferred}`);
    assert.ok(out.deferred.includes("checker-mutation-check"));
    // stripTrailingAnnotation unit: both paren spellings.
    const mod = await importMod();
    assert.equal(mod.stripTrailingAnnotation("plugin/test/（档位测试）"), "plugin/test/");
    assert.equal(mod.stripTrailingAnnotation("plugin/test/(tier tests)"), "plugin/test/");
  } finally {
    cleanup(root);
  }
});

// ── AC4-i: a touched task's Contract violation ⇒ scoped MUST catch it (strict-subset exits 1) ───────

t("AC4-i — the scoped contract consumer catches a touched task's Contract violation (strict-subset exits 1)", async () => {
  const root = makeWorkspace({});
  try {
    writeTask(root, "victim", VALID_CONTRACT);
    writeTask(root, "defective", BAD_CONTRACT);
    // Clean task: strict-subset exits 0.
    const clean = runNodeCli(CONTRACT_CLI, root, "--root", root, "--strict-subset", path.join(root, "tasks", "victim.md"));
    assert.equal(clean.status, 0, `clean task must exit 0: ${clean.stdout}`);
    // Defective touched task: strict-subset exits 1 AND prints the VIOLATION.
    const bad = runNodeCli(CONTRACT_CLI, root, "--root", root, "--strict-subset", path.join(root, "tasks", "defective.md"));
    assert.notEqual(bad.status, 0, `defective task must exit non-zero: ${bad.stdout}`);
    assert.match(bad.stdout, /VIOLATION:/, `must print the violation: ${bad.stdout}`);
    assert.match(bad.stdout, /measure-no-field/, `must name the violation code: ${bad.stdout}`);
    // The selector (REAL test.sh registry) picks task-contract-check with the touched task file for
    // a task touching tasks/ — the AC1/AC3 mechanism, verified at the module level.
    const mod = await importMod();
    const registry = mod.parseStaticCheckRegistry(fs.readFileSync(TEST_SH, "utf8"));
    const { selected } = mod.selectStaticChecksForTouches(["tasks/defective.md"], registry);
    const contract = selected.find((s) => s.name === "task-contract-check");
    assert.ok(contract, `selector must select task-contract-check: ${selected.map((s) => s.name)}`);
    assert.deepEqual(contract.touchedTasks, ["tasks/defective.md"]);
    const cmd = mod.buildCommand(contract, REPO_ROOT);
    assert.match(cmd, /--strict-subset/, `scoped command must pass --strict-subset: ${cmd}`);
    assert.match(cmd, /tasks\/defective\.md/, `scoped command must name the touched task: ${cmd}`);
  } finally {
    cleanup(root);
  }
});

// ── AC4-ii: an unrelated repo-level ratchet violation ⇒ scoped defers, full must catch ───────────────

t("AC4-ii — an unrelated CODE-class ratchet violation is DEFERRED by scoped (object not touched) and still in the full set", async () => {
  const mod = await importMod();
  const registry = mod.parseStaticCheckRegistry(fs.readFileSync(TEST_SH, "utf8"));
  // The change touches ONLY a test file + its own task — no .sh/.bash, so adr016's object is
  // untouched (adr016 is CODE-class — it scans **/*.sh **/*.bash — so it stays in run_static_checks).
  const { selected, deferred } = mod.selectStaticChecksForTouches(
    ["tasks/foo.md", "plugin/test/foo.test.mjs"],
    registry,
  );
  // Scoped does NOT run the adr016 ratchet.
  assert.ok(!selected.map((s) => s.name).includes("adr016-screen-use-check"));
  assert.ok(deferred.includes("adr016-screen-use-check"), "deferred (not silently dropped)");
  // Full set still contains it — the full-suite gate MUST catch it.
  assert.ok(registry.some((c) => c.name === "adr016-screen-use-check"));
  // And the full registry's runner line is still the whole-store scan (unchanged by the tier).
  const doc = registry.find((c) => c.name === "adr016-screen-use-check");
  assert.match(doc.commandLine, /adr016-screen-use-check\.ts/);
  // AC51 (gap-ac51-assertion-surface-split): the DOC-CLASS ratchet (strategic-doc) is NOT in this
  // registry at all — it moved to run_doc_checks → pre-commit. Scoped defers it by CONSTRUCTION
  // (absent from the scoped surface), and the full-suite gate no longer runs it either; the
  // pre-commit hook (plugin/scripts/precommit-guard.ts) is its gate.
  assert.ok(!registry.some((c) => c.name === "strategic-doc-staleness-check"), "strategic-doc moved to pre-commit (run_doc_checks), absent from scoped+full registries");
});

// ── buildCommand: subset-touched expands to --strict-subset + the touched task file ─────────────────

t("buildCommand — subset-touched resolves ${repo_root} and appends --strict-subset", async () => {
  const mod = await importMod();
  const registry = mod.parseStaticCheckRegistry(fs.readFileSync(TEST_SH, "utf8"));
  const { selected } = mod.selectStaticChecksForTouches(["tasks/foo.md"], registry);
  const contract = selected.find((s) => s.name === "task-contract-check");
  assert.ok(contract, "contract consumer selected for a task-file touch");
  const cmd = mod.buildCommand(contract, "/tmp/root");
  // checker-cost recording (gap-no-criterion-records-its-own-cost-checker-cost-jsonl) wraps every
  // checker invocation with `run_checker "<name>"` — the emitted command must keep that wrapper
  // prefix AND still resolve ${repo_root} + append --strict-subset for the touched task file.
  assert.match(cmd, /^run_checker "task-contract-check" node --no-warnings --experimental-strip-types "\/tmp\/root\/plugin\/scripts\/task-contract-check\.ts" --root "\/tmp\/root"/);
  assert.match(cmd, /--strict-subset '/);
  assert.match(cmd, /\/tmp\/root\/tasks\/foo\.md/);
});

// gap-task-file-static-syntax-should-not-block-product-verification, option ① — the verification-round
// path runs task-file static checkers in --no-block (recorded, never red). The scoped tier inherits it
// from the run_static_checks command line, so a scoped run is ALSO never blocked by task-file syntax.
t("buildCommand — the task-file checker's scoped command inherits --no-block (verification-round degradation)", async () => {
  const mod = await importMod();
  const registry = mod.parseStaticCheckRegistry(fs.readFileSync(TEST_SH, "utf8"));
  const { selected } = mod.selectStaticChecksForTouches(["tasks/foo.md"], registry);
  const contract = selected.find((s) => s.name === "task-contract-check");
  assert.ok(contract, "contract consumer selected for a task-file touch");
  const cmd = mod.buildCommand(contract, "/tmp/root");
  // The REAL run_static_checks line carries --no-block; the scoped command preserves it alongside
  // the appended --strict-subset (a scoped run is also a verification — task-file syntax must not stop it).
  assert.match(cmd, /--no-block/, `scoped command must inherit --no-block: ${cmd}`);
  assert.match(cmd, /--strict-subset/, `scoped command must still append --strict-subset: ${cmd}`);
  // The full-suite registry line for task-ac-carryover-check also carries --no-block.
  const carry = registry.find((c) => c.name === "task-ac-carryover-check");
  assert.ok(carry, "task-ac-carryover-check registered");
  assert.match(carry.commandLine, /--no-block/, `full registry line must carry --no-block: ${carry.commandLine}`);
});

// gap-kernel-sibling-check-stays-no-block-after-ac225-migration-zero — the kernel-sibling checker's
// AC-225 migration reached zero (violations: [] / total: 0), so its run_static_checks registration
// is fail-closed again: the `run_checker "kernel-sibling-resolution-check"` LINE must NOT carry
// --no-block. Positional by construction — `commandLine` is the exact parsed run_checker line, so a
// --no-block spelled only inside a COMMENT (or any other checker's line) does NOT trip this. The
// mirror direction of the task-contract/task-ac-carryover test above (those still have violations ⇒
// still REPORT-ONLY). A negative control that "re-adds --no-block ⇒ this test fails" is the AC3 反跑.
t("kernel-sibling-resolution-check is fail-closed (its run_checker line carries no --no-block)", async () => {
  const mod = await importMod();
  const registry = mod.parseStaticCheckRegistry(fs.readFileSync(TEST_SH, "utf8"));
  const sibling = registry.find((c) => c.name === "kernel-sibling-resolution-check");
  assert.ok(sibling, "kernel-sibling-resolution-check must be in the registry");
  assert.ok(
    !sibling.commandLine.includes("--no-block"),
    `kernel-sibling-resolution-check must be fail-closed (no --no-block): ${sibling.commandLine}`,
  );
});

// ── AC2: the full set is unchanged (registry coverage vs checker-mutation-check's own parser) ───────

t("AC2 — every run_static_checks checker checker-mutation-check sees is in the tier registry", async () => {
  const mod = await importMod();
  const registry = mod.parseStaticCheckRegistry(fs.readFileSync(TEST_SH, "utf8"));
  const tierNames = new Set(registry.map((c) => c.name));
  // AC51 (gap-ac51-assertion-surface-split): the DOC-CLASS checkers moved to run_doc_checks
  // (pre-commit), so they are NOT in the tier registry (which parses run_static_checks only) —
  // but the mutation manifest still lists them (checker-mutation-check.sh parses BOTH functions).
  // 2026-09-02 passive-machine ruling: the OPERATIONAL-CLASS (runtime-state) checkers likewise moved
  // OUT of run_static_checks into run_operational_checks (only `--static-checks-operational` on the
  // ACTIVE host), so they are NOT in the tier registry either — but their mutation cases stay in the
  // manifest (checker-mutation-check.sh now also parses run_operational_checks).
  const DOC_CLASS = new Set([
    "strategic-doc-staleness-check",
    "drive-contract-check",
    "threshold-scope-check",
    "state-worded-clause-check",
    "red-on-omission-audit",
    "tick-core-static-check",
    "instrument-failure-check",
  ]);
  const OPERATIONAL_CLASS = new Set([
    "worktree-node-modules-check",
    "outer-tick-log-check",
    "suite-bucket-drift-check",
    "obligation-ledger-check",
    "fan-in-workflow-retirement-check",
    "dispatch-record-fingerprint-reason-check",
    "per-task-suite-record-check",
    "fan-in-ff-protocol-check",
    "fan-in-materialize-check",
    "direct-to-develop-bypass-check",
    "suite-duration-exceed-check",
    "instrument-decay-check",
    "release-freshness-check",
  ]);
  // checker-mutation-check.sh's own manifest parser (list_run_static_checks_checkers) extracts the
  // same invocation set from run_static_checks + run_operational_checks + run_doc_checks — the tier
  // registry must cover the CODE-class subset, and must EXCLUDE the doc-class (pre-commit) and
  // operational-class (active-host-only) subsets.
  const list = spawnSync("bash", [path.join(REPO_ROOT, "plugin", "scripts", "checker-mutation-check.sh"), "--list"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(list.status, 0, list.stderr);
  for (const m of list.stdout.matchAll(/^(\S+)\s+yes\s+run_static_checks$/gm)) {
    if (DOC_CLASS.has(m[1]) || OPERATIONAL_CLASS.has(m[1])) {
      assert.ok(!tierNames.has(m[1]), `out-of-tier ${m[1]} must NOT be in the tier registry (moved out of run_static_checks)`);
    } else {
      assert.ok(tierNames.has(m[1]), `checker ${m[1]} must be in the tier registry`);
    }
  }
});
// ── gap-scoped-static-gate-sequential-pays-sum-not-max ───────────────────────────────────────────
// The scoped tier evals its selected checkers one after another (wall = Σ of the selected set),
// while the full gate pays max(...) — the parallel mode was deliberately left UNSET for the scoped
// path (runner-static-gate.ts: "The scoped tier leaves this unset."). These two controls pin the
// change that turns the scoped loop parallel AND the fail-open question it had to answer first:
// run_doc_checks FORCES RUN_CHECKER_PARALLEL=0 because a backgrounded run_checker returns 0
// immediately, so a caller that reads `$?` right after it would turn a failure into a pass.
//
// ⛔ These controls do NOT re-implement the scoped loop. `scripts/test.sh --for-task` cannot be
// driven from inside the suite (the suite exports QUAY_TEST_NESTED=1 and the scoped function
// returns early on it), so they EXECUTE THE REAL TEXT: the two function bodies are extracted from
// the live scripts/test.sh at test time and sourced into a bash harness that also sources the real
// plugin/scripts/checker-cost-lib.sh (run_checker / run_checker_parallel_wait). Only the
// touch→checker SELECTOR is stubbed (its formula is AC6-pinned and is not what is under test) and
// only the checker BODIES are fixtures — a copy of the loop would measure the copy (hard rule 4);
// extracted text cannot drift from the file it is read out of.

const SUITE_TEST_SH = path.join(REPO_ROOT, "scripts", "test.sh");
const COST_LIB = path.join(REPO_ROOT, "plugin", "scripts", "checker-cost-lib.sh");

function extractBashFunction(src, name) {
  const m = src.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}\\n`, "m"));
  assert.ok(m, `could not extract ${name}() from scripts/test.sh`);
  return m[0];
}

// A checker body recording `<name> start|end <epochNs>` around a sleep. The start/end pairs make
// "were two checkers in flight at the same time" a DIRECT measurement (interval overlap), never a
// proxy such as "the mode flag said parallel" (hard rule 4b: a self-reported flag is not evidence
// that the thing it names happened).
const MARKER_CHECKER = `#!/usr/bin/env bash
name="$1"
printf '%s start %s\\n' "$name" "$(date +%s%N)" >> "$MARK_FILE"
sleep "\${MARK_SLEEP:-1}"
printf '%s end %s\\n' "$name" "$(date +%s%N)" >> "$MARK_FILE"
`;

function buildScopedHarness({ dir, markerCheckers = [], extraLines = [] }) {
  const fixture = path.join(dir, "fixture");
  fs.mkdirSync(path.join(fixture, "plugin", "scripts"), { recursive: true });
  fs.mkdirSync(path.join(fixture, "bin"), { recursive: true });
  const marker = path.join(fixture, "bin", "marker.sh");
  fs.writeFileSync(marker, MARKER_CHECKER, "utf8");
  // The ONLY stub: the touch→checker selector (AC6 pins its formula unchanged; it is not under test).
  const checkerLines = [
    ...markerCheckers.map((n) => `run_checker "fake-${n}" bash ${JSON.stringify(marker)} ${n}`),
    ...extraLines,
  ];
  fs.writeFileSync(
    path.join(fixture, "plugin", "scripts", "select-static-checks-for-touches.ts"),
    `process.stdout.write(${JSON.stringify(checkerLines.join("\n") + "\n")});\n`,
    "utf8",
  );
  const src = fs.readFileSync(SUITE_TEST_SH, "utf8");
  const harness = path.join(dir, "harness.sh");
  const mark = path.join(dir, "mark.txt");
  const out = path.join(dir, "out.txt");
  const err = path.join(dir, "err.txt");
  fs.writeFileSync(harness, [
    "set -euo pipefail",
    `repo_root=${JSON.stringify(fixture)}`,
    `export CHECKER_COST_FILE=${JSON.stringify(path.join(dir, "checker-cost.jsonl"))}`,
    `export MARK_FILE=${JSON.stringify(mark)}`,
    "export MARK_SLEEP=1",
    "unset QUAY_TEST_NESTED QUAY_TEST_NESTED_ROOT QUAY_TEST_SKIP_STATIC_CHECKS",
    `source ${JSON.stringify(COST_LIB)}`,
    extractBashFunction(src, "record_scoped_static_evidence"),
    extractBashFunction(src, "run_scoped_static_checks_sel"),
    // The tier is called BARE, inside a subshell where errexit is ON — exactly how scripts/test.sh
    // calls it (`run_scoped_static_checks "${task_id}"`, no `||`, under `set -euo pipefail`).
    // ⛔ `run_scoped_static_checks_sel ... || rc=$?` would be a WRONG harness: a command on the left
    // of `||` disables errexit for the whole call, so a sequential-mode failure would no longer
    // abort and the captured rc would be whatever the trailing wait returned (measured: RC=0 with
    // the machine line on stderr — a harness artifact, not the product's behavior).
    "set +e",
    `( set -e; run_scoped_static_checks_sel --touches plugin/test/fake.test.mjs >${JSON.stringify(out)} 2>${JSON.stringify(err)} )`,
    "rc=$?",
    'printf "RC=%s\\n" "$rc"',
  ].join("\n") + "\n", "utf8");
  return { harness, mark, out, err };
}

function runScopedHarness(h) {
  const env = { ...process.env };
  delete env.QUAY_TEST_NESTED;
  delete env.QUAY_TEST_NESTED_ROOT;
  delete env.QUAY_TEST_SKIP_STATIC_CHECKS;
  delete env.QUAY_SCOPED_STATIC_EVIDENCE;
  const res = spawnSync("bash", [h.harness], { encoding: "utf8", env });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

/** name → {start, end} epoch-ns, read from the marker checker's append-only file. */
function readMarkerIntervals(mark) {
  const byName = new Map();
  for (const row of fs.readFileSync(mark, "utf8").split("\n")) {
    if (!row) continue;
    const [name, kind, ns] = row.split(/\s+/);
    byName.set(name, { ...(byName.get(name) ?? {}), [kind]: Number(ns) });
  }
  return byName;
}

t("parallel — the scoped tier runs its selected checkers CONCURRENTLY (paid max, not sum)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scoped-par-"));
  try {
    const h = buildScopedHarness({ dir, markerCheckers: ["alpha", "beta", "gamma"] });
    const r = runScopedHarness(h);
    assert.match(r.stdout, /^RC=0$/m, `all-green scoped run must return 0: ${r.stdout}\n${r.stderr}`);
    const iv = readMarkerIntervals(h.mark);
    for (const n of ["alpha", "beta", "gamma"]) {
      assert.ok(iv.get(n)?.start && iv.get(n)?.end, `${n} must have run to completion: ${JSON.stringify([...iv])}`);
    }
    // DIRECT concurrency measurement: two checkers were in flight at the same time iff their
    // [start,end) intervals overlap. Sequential execution cannot produce an overlap (checker N+1
    // starts only after checker N has exited). ⛔ Inverting the production change (removing the
    // scoped tier's RUN_CHECKER_PARALLEL=1) makes every interval disjoint ⇒ this test goes red.
    const entries = [...iv.entries()];
    const overlapped = entries.some(([, a]) => entries.some(([, b]) => a !== b && a.start < b.end && b.start < a.end));
    assert.ok(
      overlapped,
      `no two scoped checkers were in flight simultaneously ⇒ the scoped tier is running sequentially: ${JSON.stringify(entries)}`,
    );
  } finally {
    cleanup(dir);
  }
});

t("parallel — a failing checker still fails the scoped tier CLOSED (exit code + machine line, siblings not masked)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scoped-par-fail-"));
  try {
    // fake-boom is FIRST: a sequential abort would stop before the markers even start, so their
    // completion below is itself a discriminator for "all checkers were launched, then awaited".
    const h = buildScopedHarness({
      dir,
      markerCheckers: ["alpha", "beta", "gamma"],
      extraLines: [`run_checker "fake-boom" bash -c ${JSON.stringify("exit 7")}`],
    });
    const r = runScopedHarness(h);
    const rc = Number((/^RC=(\d+)$/m.exec(r.stdout) ?? [])[1]);
    // The tier's own stderr was redirected into err.txt by the harness (so it cannot interleave
    // with the spawn's), which is why the machine line is read from the FILE, not from r.stderr.
    const tierErr = fs.readFileSync(h.err, "utf8");
    // This is the run_doc_checks fail-open question, answered as a live control: the failing
    // checker's OWN exit code must travel out of the scoped tier, not be swallowed by the
    // backgrounding that parallel mode introduces.
    assert.equal(rc, 7, `the failing checker's exit code must be the scoped tier's exit code: ${r.stdout}\n${tierErr}`);
    assert.match(
      tierErr,
      /STATIC_CHECK_FAILED: fake-boom exit=7/,
      `the fail-closed machine line must name the failing checker: ${tierErr}`,
    );
    const iv = readMarkerIntervals(h.mark);
    for (const n of ["alpha", "beta", "gamma"]) {
      assert.ok(iv.get(n)?.end, `${n} must still have run — a failing sibling must not mask the others: ${JSON.stringify([...iv])}`);
    }
  } finally {
    cleanup(dir);
  }
});
