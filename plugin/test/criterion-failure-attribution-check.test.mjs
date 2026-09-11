// @test-group engine
// criterion-failure-attribution-check.test.mjs — unit + CLI tests for the criterion failure-attribution
// ratchet (tasks/gap-goal-criteria-bare-failing-exit-unattributable, GOAL-009 AC-241).
//
// Split by what it proves:
//   · the pure predicate (isBareFailureExitLine / maskHashComments) — POSITION-based judgment, with the
//     comment-mention and exit(10) negative controls (硬规则 2).
//   · the pure ratchet (checkRatchet) — shrink-only: a fix is green, an addition is red.
//   · the CLI three-state contract — 0 pass / 1 red / 3 NOT-EVALUATED, pairwise distinct (硬规则 3b),
//     and the committed baseline artifact actually gates the REAL repo at 0.
//   · AC4's取证: count on the real repo == baseline; inject a bare fixture ⇒ +1; remove ⇒ restore.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  isBareFailureExitLine,
  maskHashComments,
  maskValueStrings,
  checkRatchet,
  enumerateBareFailureExits,
  readBaseline,
} from "../scripts/criterion-failure-attribution-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CLI = path.join(REPO_ROOT, "plugin/scripts/criterion-failure-attribution-check.ts");
const BASELINE_REL = "docs/analysis/criterion-failure-attribution.baseline.json";

const tmpDirs = [];
function mkTmp(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

function runCli(args) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", CLI, ...args], {
    encoding: "utf8",
  });
}

/** A self-contained workspace: `count` in-domain criteria each carrying one bare failure exit. */
function makeRoot(count) {
  const root = mkTmp("cfac-");
  fs.mkdirSync(path.join(root, "goals"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs/analysis"), { recursive: true });
  for (let i = 0; i < count; i++) {
    fs.writeFileSync(
      path.join(root, `goals/AC-9${String(i).padStart(2, "0")}-fixture.md`),
      [
        "---",
        `id: AC-9${String(i).padStart(2, "0")}`,
        "status: active",
        "kind: criterion",
        "criterion: |",
        "  python3 - <<'P'",
        "  import sys",
        "  sys.exit(1)",
        "  P",
        "---",
        "",
      ].join("\n"),
    );
  }
  fs.writeFileSync(
    path.join(root, BASELINE_REL),
    JSON.stringify({ count, inDomain: count, entries: [], generatedAt: "2026-09-11T00:00:00.000Z" }, null, 2) + "\n",
  );
  return root;
}

// ── the predicate (硬规则 2 — position, not keyword) ────────────────────────────────────────────────

test("isBareFailureExitLine: a failure exit with no cause on its line is BARE", () => {
  for (const line of [
    "  if not upgraded: sys.exit(1)",
    "      sys.exit(1)",
    "  [ -e \"$f\" ] || exit 1",
    "  sys.exit(1 if bare else 0)", // the computed form — fails with no cause on its red branch
  ]) {
    assert.equal(isBareFailureExitLine(line), true, `expected BARE: ${line}`);
  }
});

test("isBareFailureExitLine: an attribution on the same line is NOT bare", () => {
  for (const line of [
    "  if not upgraded: sys.stderr.write(\"no site\\n\"); sys.exit(1)",
    "  print('why', file=sys.stderr) or sys.exit(1)",
    "  echo 'why' >&2; exit 1",
    "  if (bad) { console.error('why'); process.exit(1); }",
  ]) {
    assert.equal(isBareFailureExitLine(line), false, `expected ATTRIBUTED: ${line}`);
  }
});

test("isBareFailureExitLine — negative control: a COMMENT mentioning `exit 1` is not a failure exit", () => {
  // The exact shape that made this checker's first run self-trip on AC-241's own rationale comment.
  assert.equal(isBareFailureExitLine('  # AC-239: acceptance failed (exit 1) — criterion wrote no output'), false);
  assert.equal(isBareFailureExitLine("  grep -q ok f || exit 1  # a trailing note is still a bare failure exit"), true, "code BEFORE the # is still real");
});

test("isBareFailureExitLine — negative control: exit(10) / exit(0) / exit(3) are not failure exits", () => {
  for (const line of ["  sys.exit(10)", "  exit 3", "  sys.exit(0)", "  raise SystemExit(0)"]) {
    assert.equal(isBareFailureExitLine(line), false, `expected NOT a bare failure exit: ${line}`);
  }
});

test("maskHashComments is quote-aware — `#` inside a quoted string is data", () => {
  assert.equal(maskHashComments("  echo 'a#b' && exit 1"), "  echo 'a#b' && exit 1");
  assert.equal(maskHashComments("  exit 1  # why"), "  exit 1  ");
});

test("isBareFailureExitLine — negative control: a quoted VALUE holding `exit 1` is DATA, not an exit (AC-243)", () => {
  // The exact line that made the ratchet report the achieved, fully-attributable AC-243 as a regression
  // and block an unrelated task from landing (2026-09-11). AC-243's own failure exits all write stderr.
  const ac243 = '   \'const r=m.runAcceptance({command:"exit 1",cwd:".",timeoutMs:10000});\'';
  assert.equal(isBareFailureExitLine(ac243), false, "a string handed to an API as an argument is not a failure exit");
  assert.equal(isBareFailureExitLine("  local cmd='exit 1'"), false, "same for a shell value assignment");
});

test("isBareFailureExitLine — positive control: the value-position mask must NOT swallow a real exit", () => {
  // The exemption for quoted strings exists for THESE shapes; a value-position mask must leave them BARE.
  assert.equal(isBareFailureExitLine('  bash -c "exit 1"'), true, "`-c` makes the string a COMMAND, not a value");
  assert.equal(isBareFailureExitLine('  python3 -c "import sys; sys.exit(1)"'), true);
  assert.equal(isBareFailureExitLine('  x="$(exit 1)"'), true, "command substitution inside a value still EXECUTES");
  assert.equal(isBareFailureExitLine("  x=`exit 1`"), true);
});

test("maskValueStrings is pure and blanks only the value-position literal", () => {
  assert.equal(maskValueStrings('a:"exit 1",b:1'), 'a:        ,b:1');
  assert.equal(maskValueStrings('k="x"'), 'k=   ');
  assert.equal(maskValueStrings('echo "exit 1"'), 'echo "exit 1"', "not in value position ⇒ untouched");
});

// ── the ratchet (shrink-only) ──────────────────────────────────────────────────────────────────────

test("checkRatchet: equal / shrunk is ok, grown is not (and names the added ACs)", () => {
  const enumOf = (ids) => ({ evaluated: true, inDomain: 5, bareLines: ids.length, bareAcs: ids.map((id) => ({ id, file: `${id}.md`, bareLines: [] })) });
  const base = { count: 2, inDomain: 5, entries: [{ id: "AC-A", file: "a", bareLines: [] }, { id: "AC-B", file: "b", bareLines: [] }], generatedAt: "" };
  assert.deepEqual(checkRatchet(enumOf(["AC-A", "AC-B"]), base), { ok: true, delta: 0, added: [], fixed: [] });
  const shrunk = checkRatchet(enumOf(["AC-A"]), base);
  assert.equal(shrunk.ok, true);
  assert.equal(shrunk.delta, -1);
  assert.deepEqual(shrunk.fixed, ["AC-B"]);
  const grown = checkRatchet(enumOf(["AC-A", "AC-B", "AC-C"]), base);
  assert.equal(grown.ok, false, "an ADDED bare-failure-exit criterion must be RED (the ratchet is shrink-only)");
  assert.deepEqual(grown.added, ["AC-C"]);
});

// ── the CLI three-state contract ────────────────────────────────────────────────────────────────────

test("CLI: baseline-consistent workspace ⇒ exit 0, one added bare criterion ⇒ exit 1, restore ⇒ exit 0 (AC4)", () => {
  const root = makeRoot(2);
  assert.equal(runCli(["--root", root]).status, 0, "baseline-consistent fixture must be GREEN");

  fs.writeFileSync(
    path.join(root, "goals/AC-999-fixture.md"),
    ["---", "id: AC-999", "status: active", "kind: criterion", "criterion: |", "  test -f /nonexistent || exit 1", "---", ""].join("\n"),
  );
  const injected = runCli(["--root", root, "--json"]);
  assert.equal(injected.status, 1, "an injected bare-failure-exit criterion must turn the ratchet RED");
  assert.equal(JSON.parse(injected.stdout).bareAcs, 3);

  fs.rmSync(path.join(root, "goals/AC-999-fixture.md"));
  assert.equal(runCli(["--root", root]).status, 0, "removing the injected criterion must restore GREEN");
});

test("CLI 硬规则 3b: an unreadable goals/ ⇒ exit 3 NOT-EVALUATED, distinct from BOTH pass and red", () => {
  const root = makeRoot(1);
  fs.rmSync(path.join(root, "goals"), { recursive: true, force: true });
  const r = runCli(["--root", root]);
  assert.equal(r.status, 3, "unreadable input must be NOT-EVALUATED, never 0 (which would read as 'no bare exits')");
  assert.notEqual(r.status, 0);
  assert.notEqual(r.status, 1);
  assert.match(r.stderr, /NOT-EVALUATED/);
});

test("CLI 硬规则 3b: a malformed / absent baseline ⇒ exit 3, never a silent '≤ baseline'", () => {
  const root = makeRoot(1);
  fs.writeFileSync(path.join(root, BASELINE_REL), "{ not json");
  const r = runCli(["--root", root]);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /NOT-EVALUATED/);
  fs.rmSync(path.join(root, BASELINE_REL));
  assert.equal(runCli(["--root", root]).status, 3, "a MISSING baseline is also NOT-EVALUATED (the ratchet is not established)");
});

test("enumerateBareFailureExits: a goals dir holding only out-of-domain drafts is NOT-EVALUATED", () => {
  const root = mkTmp("cfac-draft-");
  fs.mkdirSync(path.join(root, "goals"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "goals/AC-901-fixture.md"),
    ["---", "id: AC-901", "status: draft", "kind: criterion", "criterion: |", "  sys.exit(1)", "---", ""].join("\n"),
  );
  const e = enumerateBareFailureExits(path.join(root, "goals"));
  assert.equal(e.evaluated, false, "zero in-domain criteria means the question could not be asked (硬规则 3b)");
});

// ── the committed artifact really gates the real repo ───────────────────────────────────────────────

test("the COMMITTED baseline gates the REAL repo at exit 0, and its count IS the live enumeration", () => {
  const r = runCli(["--root", REPO_ROOT, "--json"]);
  assert.equal(r.status, 0, `the real repo must be at/below its committed baseline: ${r.stdout}${r.stderr}`);
  const out = JSON.parse(r.stdout);
  const committed = readBaseline(path.join(REPO_ROOT, BASELINE_REL));
  assert.ok(committed, "the committed baseline must exist and be well-shaped");
  assert.equal(out.bareAcs, committed.count, "the live count must equal the committed count (⛔ not a constant that drifted)");
  assert.ok(out.inDomain > 0, "the enumeration must have read a non-empty in-domain set");
});
