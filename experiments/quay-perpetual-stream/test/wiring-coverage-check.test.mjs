// Unit tests for wiring-coverage-check.mjs — the DIR-117/DIR-122 shared mechanism-claim wiring
// coverage check. RED/GREEN pair per both directives' AC: an uncovered mechanism claim FAILS; the
// same claim with a matching, evidence-requiring AC item PASSES.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractMechanismClaims, bulletsOf, checkWiringCoverage } from "../scripts/wiring-coverage-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, "..", "scripts", "wiring-coverage-check.ts");
const FIXTURES = path.join(__dirname, "..", "fixtures", "preparation");
const RED_FIXTURE = path.join(FIXTURES, "wiring-uncovered-claim-task.md");

// Run the CLI exactly the way prepare-milestone.js's ProposalReview dispatch does.
function runCli(taskPath) {
  const cmd = `node --experimental-strip-types ${JSON.stringify(CLI)} --task ${JSON.stringify(taskPath)}`;
  try {
    return { status: 0, stdout: execSync(cmd, { encoding: "utf8" }) };
  } catch (e) {
    return { status: typeof e.status === "number" ? e.status : 1, stdout: e.stdout ? e.stdout.toString() : "" };
  }
}

test("extractMechanismClaims: wiring-verb sentence with >=2 backtick identifiers is a claim", () => {
  const text = "The new `foo.ts` module invokes `bar.ts` to enforce read-only access on the shard.";
  const claims = extractMechanismClaims(text);
  assert.equal(claims.length, 1);
  assert.deepEqual(claims[0].identifiers.sort(), ["bar.ts", "foo.ts"]);
});

test("extractMechanismClaims: no wiring verb -> no claim", () => {
  const text = "`foo.ts` and `bar.ts` are both new files added in this change.";
  assert.equal(extractMechanismClaims(text).length, 0);
});

test("extractMechanismClaims: wiring verb but only 1 identifier -> no claim", () => {
  const text = "`foo.ts` now enforces read-only access on every incoming request.";
  assert.equal(extractMechanismClaims(text).length, 0);
});

test("extractMechanismClaims: multiple independent claims in one section", () => {
  const text =
    "`select-preflight.ts` dispatches `composite-preflight.ts` before Build.\n\n" +
    "Separately, `composite-land.ts` owns `dashboard.md` writes during Land.";
  const claims = extractMechanismClaims(text);
  assert.equal(claims.length, 2);
});

test("bulletsOf: joins wrapped continuation lines into one bullet", () => {
  const ac = "## Acceptance Criteria\n- [ ] `foo.ts` invoking `bar.ts` is proven by real\n  production callsite evidence.\n- [ ] second item\n";
  const bullets = bulletsOf(ac);
  assert.equal(bullets.length, 2);
  assert.match(bullets[0], /production callsite evidence\.$/);
});

// ── RED: uncovered mechanism claim -> FAIL ────────────────────────────────────────────────────────
test("checkWiringCoverage: RED — claimed mechanism with no matching AC item fails", () => {
  const source = "The new `wiring-coverage-check.ts` module invokes `task-schema.ts` to enforce coverage.";
  const ac = "- [ ] some unrelated acceptance item with no identifiers at all";
  const result = checkWiringCoverage(source, ac);
  assert.equal(result.ok, false);
  assert.equal(result.code, "wiring-coverage-uncovered");
  assert.equal(result.uncovered.length, 1);
});

// ── GREEN: same claim, matching AC item -> PASS ──────────────────────────────────────────────────
test("checkWiringCoverage: GREEN — same claim with a matching, evidence-requiring AC item passes", () => {
  const source = "The new `wiring-coverage-check.ts` module invokes `task-schema.ts` to enforce coverage.";
  const ac = "- [ ] Real production callsite evidence confirms `wiring-coverage-check.ts` invokes `task-schema.ts`.";
  const result = checkWiringCoverage(source, ac);
  assert.equal(result.ok, true);
  assert.equal(result.code, "wiring-coverage-complete");
  assert.equal(result.uncovered.length, 0);
});

test("checkWiringCoverage: no claims at all -> PASS vacuously", () => {
  const result = checkWiringCoverage("plain prose with no wiring verbs or identifiers", "- [ ] anything");
  assert.equal(result.ok, true);
  assert.equal(result.code, "wiring-coverage-none-claimed");
});

test("checkWiringCoverage: identifiers matched but no evidence keyword in the bullet -> still uncovered", () => {
  const source = "`a.ts` calls `b.ts` to route requests.";
  const ac = "- [ ] `a.ts` and `b.ts` are both mentioned here as new files";
  const result = checkWiringCoverage(source, ac);
  assert.equal(result.ok, false);
});

// ── DIR-117-B/M195 AC#4: the CLI is the grep-confirmable PRODUCTION call site the ProposalReview
// phase dispatches. It must emit one BLOCKING typed ledger finding per uncovered claim, straight
// from checkWiringCoverage()'s real return value — this is the module boundary the workflow consumes. ──
test("CLI: RED fixture -> verdict with >=1 BLOCKING finding from the function's real return value", () => {
  const { status, stdout } = runCli(RED_FIXTURE);
  assert.equal(status, 0, `CLI must exit 0 (the verdict is the signal):\n${stdout}`);
  const verdict = JSON.parse(stdout);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "wiring-coverage-uncovered");
  assert.ok(Array.isArray(verdict.findings) && verdict.findings.length >= 1, "must emit >=1 blocking finding");

  // Every emitted finding is a BLOCKING ledger entry in the exact shape _upsertFindings consumes —
  // the increment path at the boundary prepare-milestone.js dispatches to (see the dedicated
  // "finding count equals checkWiringCoverage()'s uncovered count" test below for the equality).
  for (const f of verdict.findings) {
    assert.equal(f.subsystem, "wiring-coverage");
    assert.equal(f.severity, "blocker");
    assert.equal(f.blocking, true);
    assert.equal(f.disposition, "unresolved");
    assert.ok(f.summary && f.evidence && f.claimRef, "finding carries the ledger shape _upsertFindings consumes");
  }
});

test("CLI: finding count equals checkWiringCoverage()'s uncovered count (same source of truth)", () => {
  // Independently recompute via the exported function on the fixture's sections and compare to the
  // CLI's emitted findings — they must be the same number (no LLM, no second implementation).
  const body = readFileSync(RED_FIXTURE, "utf8");
  const section = (heading) => {
    const re = new RegExp(`^##\\s+${heading}\\s*$`, "m");
    const start = body.search(re);
    if (start < 0) return "";
    const rest = body.slice(start).replace(re, "");
    const next = rest.search(/^##\s+/m);
    return (next < 0 ? rest : rest.slice(0, next)).trim();
  };
  const direct = checkWiringCoverage(section("Proposal"), section("Acceptance Criteria"));
  const verdict = JSON.parse(runCli(RED_FIXTURE).stdout);
  assert.equal(verdict.findings.length, direct.uncovered.length);
  assert.ok(verdict.findings.length >= 1);
});

test("CLI: no --task -> usage error exits 2 (workflow fails the phase closed)", () => {
  const cmd = `node --experimental-strip-types ${JSON.stringify(CLI)}`;
  let status = 0;
  try {
    execSync(cmd, { encoding: "utf8" });
  } catch (e) {
    status = typeof e.status === "number" ? e.status : 1;
  }
  assert.equal(status, 2);
});

test("CLI: a Proposal whose claims are all AC-covered -> 0 findings, ok:true", () => {
  // A covered variant: write a tiny temp task whose single claim has a matching evidence AC item.
  const tmp = path.join(FIXTURES, `wiring-covered-${process.pid}.md`);
  try {
    writeFileSync(
      tmp,
      [
        "---", "id: FIXTURE-WIRING-COVERED", "title: covered", "status: todo",
        "labels:", "  - fixture", "extra:", "  schema: v1", "---",
        "## Proposal", "",
        "The new `alpha.ts` module invokes `beta.ts` to enforce ordering.", "",
        "## Acceptance Criteria", "",
        "- [ ] Real production callsite evidence confirms `alpha.ts` invokes `beta.ts`.", "",
      ].join("\n")
    );
    const verdict = JSON.parse(runCli(tmp).stdout);
    assert.equal(verdict.ok, true);
    assert.equal(verdict.code, "wiring-coverage-complete");
    assert.equal(verdict.findings.length, 0);
  } finally {
    rmSync(tmp, { force: true });
  }
});
