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
  // checker-mutation-check (the whole-store meta-check) must stay `full` — never in scoped.
  // ⚠️ `name` is the SCRIPT identity (parseStaticCheckRegistry derives it from the
  // `${repo_root}/plugin/scripts/<name>.(sh|ts)` path, NOT from the `run_checker "<label>"`), so a
  // change-tier companion that invokes the SAME script carries the SAME name — and a name→tier Map
  // is last-wins, so it reads whichever registration happens to come last. There are two such
  // colliding pairs: `checker-mutation-check` / its `--check-changed` companion added by
  // gap-checker-mutation-check-has-no-change-tier-companion, and the older precedent
  // `quay-init-closure-ratchet` / `-stale` (runner-static-gate.ts). Both registrations are pinned
  // here by their command line (the only discriminator) instead of by the shared name.
  const mutations = registry.filter((c) => c.name === "checker-mutation-check");
  assert.equal(mutations.length, 2, `whole-store registration + its change-tier companion: ${JSON.stringify(mutations.map((c) => c.commandLine))}`);
  const mutationFull = mutations.filter((c) => c.tier === "full");
  assert.equal(mutationFull.length, 1, "exactly ONE registration of checker-mutation-check must be `full` (deferred ≠ dropped)");
  assert.match(mutationFull[0].commandLine, /--check$/, "the full registration must be the WHOLE-STORE mode (--check)");
  const mutationCompanion = mutations.filter((c) => c.tier === "change");
  assert.equal(mutationCompanion.length, 1, "exactly one registration must be the change-tier companion (else the changers' own scoped gate never runs it)");
  assert.match(mutationCompanion[0].commandLine, /--check-changed/, "the companion must be the DELTA-NARROWED mode (--check-changed)");
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
  // AC2 partition: nothing is dropped — every registry ENTRY is either selected or deferred.
  // ⚠️ The SELECTED side is matched by `commandLine`, not by `name`: `name` is the script identity
  // (path-derived, see the AC3 registry test above), so the two registrations of a checker that
  // collide on it (`checker-mutation-check` / `--check-changed`, `quay-init-closure-ratchet` /
  // `-stale`) are indistinguishable by name. `deferred` carries names only, so "selected XOR
  // deferred" is NOT assertable per entry once a selected companion shares its whole-store
  // sibling's name — the direction that actually matters is asserted explicitly instead: a
  // full-tier entry must never appear as a selected command.
  const selectedCmds = new Set(selected.map((s) => s.commandLine));
  for (const c of registry) {
    const inSel = selectedCmds.has(c.commandLine);
    const inDef = deferred.includes(c.name);
    assert.ok(inSel || inDef, `checker ${c.name} (${c.commandLine}) must be selected or deferred — nothing is dropped`);
    if (c.tier === "full") {
      assert.ok(!inSel, `full-tier ${c.name} must NEVER be selected in scoped mode: ${c.commandLine}`);
    }
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
