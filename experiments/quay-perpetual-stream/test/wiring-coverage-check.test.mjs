// Unit tests for wiring-coverage-check.mjs — the DIR-117/DIR-122 shared mechanism-claim wiring
// coverage check. RED/GREEN pair per both directives' AC: an uncovered mechanism claim FAILS; the
// same claim with a matching, evidence-requiring AC item PASSES.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractMechanismClaims, extractMechanismSubsections, bulletsOf, checkWiringCoverage, splitSentences } from "../scripts/wiring-coverage-check.ts";

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

// ── M199/DIR-126-A finding 8ab695df / DIR-126-B scope: a dense, un-blank-lined Markdown bullet
// list merges multiple distinct wiring claims into one giant sentence under the old punctuation-
// only splitter, hiding real per-bullet claims from independent AC coverage. Confirmed real
// recurrence: M198/DIR-119-D1 (26 blocking findings) and M199/DIR-126-A (13 blocking findings),
// same root cause, neither content. ──
test("extractMechanismClaims: a dense, un-blank-lined bullet list splits into one claim PER bullet, not one merged claim", () => {
  const text =
    "Every terminal return releases the lease:\n" +
    "- `ProposalAuthors` invokes `--release` on exit.\n" +
    "- `Adjudicate` invokes `--release` on exit.\n" +
    "- `PlanCheck` invokes `--release` on exit.\n";
  const claims = extractMechanismClaims(text);
  assert.equal(claims.length, 3, "each bullet is its own claim, not one 3-identifier merged claim");
  assert.deepEqual(claims[0].identifiers.sort(), ["--release", "ProposalAuthors"]);
  assert.deepEqual(claims[1].identifiers.sort(), ["--release", "Adjudicate"]);
  assert.deepEqual(claims[2].identifiers.sort(), ["--release", "PlanCheck"]);
});

test("extractMechanismClaims: a continuation line under a bullet stays part of that bullet's own claim", () => {
  const text =
    "- `Admission` invokes `prepare-admission-check.ts`\n" +
    "  before `ProposalAuthors` runs.\n" +
    "- `Preflight` invokes `wiring-coverage-check.ts` before `PlanCheck`.\n";
  const claims = extractMechanismClaims(text);
  assert.equal(claims.length, 2);
  assert.deepEqual(
    claims[0].identifiers.sort(),
    ["Admission", "ProposalAuthors", "prepare-admission-check.ts"]
  );
});

// ── gap-wiring-coverage-check-owns-false-positive (M198/DIR-119-D1): possessive "own" is not an
// ownership-verb claim. This repo's own authoring convention uses "X's own Y" constantly for
// cross-referencing (CLAUDE.md and every task body); the `owns?` alternative must not fire on it. ──
test("extractMechanismClaims: possessive \"X's own Y\" / \"its own Y\" is NOT a wiring claim", () => {
  const text =
    "This Proposal's own scope covers `foo.ts` and `bar.ts`. " +
    "The Chosen mechanism's own wiring-claim paragraphs describe `alpha.ts` and `beta.ts`. " +
    "On its own merits, `gamma.ts` and `delta.ts` differ.";
  assert.equal(extractMechanismClaims(text).length, 0);
});

test("extractMechanismClaims: real ownership-verb claim (\"X owns Y\", no possessive marker) still fires", () => {
  const text = "`composite-land.ts` owns `dashboard.md` writes during Land.";
  const claims = extractMechanismClaims(text);
  assert.equal(claims.length, 1);
  assert.deepEqual(claims[0].identifiers.sort(), ["composite-land.ts", "dashboard.md"]);
});

// ── M205/gap-wiring-coverage-check-whose-own-and-bold-marker-splitting: two source-confirmed regex
// defects found live during DIR-126-D's round-4/5 ProposalReview convergence, when the milestone's
// own explanatory prose ("the one terminal whose own AC…" + back-to-back `**Claim N…**` points)
// kept re-triggering false uncovered-claim findings. Fix 1: the `owns?` possessive-determiner
// exclusion lookbehind omitted `whose`, so "whose own AC" false-matched as an ownership-verb
// claim. Fix 2: splitSentences()'s per-block punctuation split never recognized a markdown bold
// marker (`**`) on EITHER side, so two adjacent `**Bold.** **Bold.**` sentences merged into one
// oversized "claim". Each RED/GREEN fixture below FAILS before its fix and PASSES after; the
// genuine-`owns` control must stay green under BOTH literals (strict narrowing). Canonical test
// file ONLY — no `plugin/test/wiring-coverage-check.test.mjs` mirror (that file does not exist;
// mirror fidelity is proven by the `sync-vendor.sh --check` byte-identity gate). ──
test("extractMechanismClaims: possessive-determiner \"whose own\" is NOT a wiring claim (Fix 1, RED before / GREEN after)", () => {
  const text = "The terminal whose own AC requires `a.ts` and `b.ts` stays out of scope.";
  assert.equal(
    extractMechanismClaims(text).length,
    0,
    "\"whose own\" is a possessive determiner + adjective, not an ownership-verb claim"
  );
});

test("extractMechanismClaims: genuine \"owns\" control is unaffected by the `whose` exclusion (strict narrowing)", () => {
  const text = "`composite-land.ts` owns `dashboard.md` writes from `x.ts` to `y.ts`.";
  const claims = extractMechanismClaims(text);
  assert.equal(claims.length, 1, "a real ownership-verb claim must still fire under the patched literal");
  assert.deepEqual(claims[0].identifiers.sort(), ["composite-land.ts", "dashboard.md", "x.ts", "y.ts"]);
});

test("splitSentences: adjacent bold-prefixed sentences split on BOTH sides of the `**` marker (Fix 2 split-layer, RED before / GREEN after)", () => {
  // The exact AC-2 fixture text. Pre-fix: ONE merged chunk carrying all 4 identifiers — the char
  // after the post-`Done.` whitespace is `*`, outside the old lookahead class, so even `Done.` is
  // not peeled off. Post-fix: 3 chunks — a leading zero-identifier `Done.` plus two identifier-
  // carrying sentences with DISJOINT backtick-identifier sets. A lookahead-ONLY variant leaves the
  // two bold claims merged (2 chunks: `Done.` + one 4-identifier chunk) — the symmetric both-sides
  // edit is the minimal sufficient fix (live-reproduced during Proposal adjudication).
  const chunks = splitSentences("Done. **A does X (`id1`, `id2`).** **B does Y (`id3`, `id4`).**");
  assert.equal(chunks.length, 3, "leading `Done.` plus two bold sentences, not one merged chunk");
  assert.equal(chunks[0], "Done.");
  const ids = (s) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]).sort();
  assert.deepEqual(ids(chunks[1]), ["id1", "id2"]);
  assert.deepEqual(ids(chunks[2]), ["id3", "id4"]);
  assert.equal(ids(chunks[1]).some((id) => ids(chunks[2]).includes(id)), false, "identifier sets must be disjoint");
});

test("extractMechanismClaims: adjacent bold-prefixed claims with a REAL wiring verb split into 2 disjoint claims (Fix 2 claim-layer, RED before / GREEN after)", () => {
  // The claim-layer uses a real wiring verb ("calls") inside the bold sentences: "does" (the AC-2
  // fixture's verb) is NOT a wiring verb, so a claim-level assertion on the literal AC-2 text would
  // be RED-forever (0 claims both before and after — the verb test in extractMechanismClaims and
  // the >=2-identifier test would both exclude it). Pre-fix: 1 merged 4-identifier claim;
  // post-fix: 2 claims with disjoint identifier pairs.
  const text = "**A calls `x1.ts` from `y1.ts`.** **B calls `x2.ts` from `y2.ts`.**";
  const claims = extractMechanismClaims(text);
  assert.equal(claims.length, 2, "each bold sentence is its own claim, not one merged 4-identifier claim");
  assert.deepEqual(claims[0].identifiers.sort(), ["x1.ts", "y1.ts"]);
  assert.deepEqual(claims[1].identifiers.sort(), ["x2.ts", "y2.ts"]);
});

// ── gap-wiring-coverage-check-reuse-verbs-and-tables (M201/DIR-126-B): a dense Markdown pipe
// table (one mechanism claim per row) merged all rows into one giant claim under the pre-fix
// splitter — same root-cause class 335317d fixed for bullet lists, now reproduced against a
// table. ──
test("extractMechanismClaims: a Markdown pipe table splits into one claim PER row, not one merged claim", () => {
  const text =
    "| Code | Reuses |\n" +
    "|---|---|\n" +
    "| `check-a` | calls `helper-a.ts` from `lib-a.ts` |\n" +
    "| `check-b` | calls `helper-b.ts` from `lib-b.ts` |\n" +
    "| `check-c` | calls `helper-c.ts` from `lib-c.ts` |\n";
  const claims = extractMechanismClaims(text);
  assert.equal(claims.length, 3, "each table row is its own claim, not one merged claim");
  assert.deepEqual(claims[0].identifiers.sort(), ["check-a", "helper-a.ts", "lib-a.ts"]);
  assert.deepEqual(claims[1].identifiers.sort(), ["check-b", "helper-b.ts", "lib-b.ts"]);
  assert.deepEqual(claims[2].identifiers.sort(), ["check-c", "helper-c.ts", "lib-c.ts"]);
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

// ── gap-wiring-coverage-scope-narrowing (P0 #60): mechanism claims are extracted from the
// mechanism-bearing subsections of a `## Proposal` ONLY — Chosen mechanism, Mechanism-claim wiring
// coverage, Key design decisions, Mechanism-claim → AC coverage, and `**WIRING-CLAIM ...:**`
// markers. Problem-framing / Risks / Defaults / Compatibility / Alternatives / Non-goals prose full
// of code references is NOT mechanism-claimed and must not be wired-checked against AC (the
// recurring `mechanism-inventory-invalid` fingerprint 4161ab22b641 on A2/A5/DIR-099-B/DIR-124-C). ──
test("extractMechanismSubsections: a Proposal narrows to its mechanism-bearing subsections; Problem-framing code references are excluded", () => {
  const proposal =
    "### Problem framing\n\n" +
    "The installed driver `execute-milestone.js` dispatches seven phases (`Verify`, `Prepared`, `Build`, `Audit`, `Gate`, `Reconcile`, `Land`) and calls `composite-preflight.ts` from `phase('Verify')`.\n\n" +
    "### Chosen mechanism\n\n" +
    "The new `workflow-kernel.ts` module invokes `composite-args.ts` `normalizeExecuteArgs` to enforce ordering.\n";
  const narrowed = extractMechanismSubsections(proposal);
  assert.match(narrowed, /### Chosen mechanism/);
  assert.doesNotMatch(narrowed, /### Problem framing/);
  assert.doesNotMatch(narrowed, /execute-milestone\.js/);
  const claims = extractMechanismClaims(narrowed);
  assert.equal(claims.length, 1, "only the Chosen-mechanism claim survives narrowing");
  assert.deepEqual(claims[0].identifiers.sort(), ["composite-args.ts", "normalizeExecuteArgs", "workflow-kernel.ts"]);
  // Control: scanning the WHOLE Proposal (pre-narrowing) would ALSO flag the problem-framing
  // sentence — proving the narrowing is what removes the false positive.
  assert.equal(extractMechanismClaims(proposal).length, 2, "pre-narrowing the Problem-framing code-reference sentence is a claim too");
});

test("extractMechanismSubsections: bold **Chosen mechanism.** / **Key design decisions.** headings are recognized (DIR-117-B style, no ###)", () => {
  const proposal =
    "**Problem framing (grounded in current code).** The driver `execute-milestone.js` dispatches `composite-preflight.ts` and `composite-reconcile.ts` before Build.\n\n" +
    "**Chosen mechanism.** The new `workflow-kernel.ts` invokes `composite-args.ts` `normalizeExecuteArgs` on every dispatch.\n\n" +
    "**Key design decisions.** The shim invokes the kernel's `--enforce-effects` mode around `validateEffects` on each adapter dispatch.\n";
  const narrowed = extractMechanismSubsections(proposal);
  assert.doesNotMatch(narrowed, /Problem framing/);
  assert.match(narrowed, /Chosen mechanism/);
  assert.match(narrowed, /Key design decisions/);
  const claims = extractMechanismClaims(narrowed);
  assert.equal(claims.length, 2, "both mechanism headings survive; Problem framing is excluded");
});

test("extractMechanismSubsections: a **WIRING-CLAIM (...):** marker is captured even without any ### subsection", () => {
  const proposal =
    "### Problem framing\n\n" +
    "`a.ts` dispatches `b.ts` and `c.ts` during startup.\n\n" +
    "**WIRING-CLAIM (X-1):** `a.ts` invokes `b.ts` from `c.ts` to enforce ordering.\n";
  const narrowed = extractMechanismSubsections(proposal);
  assert.doesNotMatch(narrowed, /dispatches `b\.ts`/);
  assert.match(narrowed, /WIRING-CLAIM/);
  const claims = extractMechanismClaims(narrowed);
  assert.equal(claims.length, 1, "the explicit claim marker is kept; the Problem-framing sentence is not");
  assert.deepEqual(claims[0].identifiers.sort(), ["a.ts", "b.ts", "c.ts"]);
});

test("extractMechanismSubsections: a WIRING-CLAIM marker captures ONLY its own paragraph, not the rest of a Problem-framing subsection (real DIR-124-A2 placement)", () => {
  // DIR-124-A2 places its `**WIRING-CLAIM (A2-M192-CODE):**` markers INSIDE Problem framing. The
  // marker's own paragraph is a claim source, but it must not pull in the surrounding Problem-framing
  // bullets (which would re-introduce the exact false-positive class this narrowing removes).
  const proposal =
    "### Problem framing\n\n" +
    "1. **Baseline A** — `alpha.ts` dispatches `beta.ts` from `gamma.ts` before `delta.ts`.\n\n" +
    "**WIRING-CLAIM (A2-M192-CODE):** `delta.ts` invokes `epsilon.ts` from `zeta.ts` on the pre-fix null result.\n\n" +
    "2. **Baseline B** — `eta.ts` enforces `theta.ts` from `iota.ts`.\n";
  const narrowed = extractMechanismSubsections(proposal);
  assert.match(narrowed, /WIRING-CLAIM/);
  assert.match(narrowed, /delta\.ts` invokes `epsilon\.ts/, "the marker's own paragraph is kept");
  assert.doesNotMatch(narrowed, /alpha\.ts/, "Problem-framing bullet BEFORE the marker is excluded");
  assert.doesNotMatch(narrowed, /theta\.ts/, "Problem-framing bullet AFTER the marker is excluded too (marker captures only its own paragraph)");
  const claims = extractMechanismClaims(narrowed);
  assert.equal(claims.length, 1, "only the WIRING-CLAIM paragraph is a claim source, not the surrounding Problem-framing bullets");
  assert.deepEqual(claims[0].identifiers.sort(), ["delta.ts", "epsilon.ts", "zeta.ts"]);
});

test("checkWiringCoverage: GREEN — Proposal problem-framing code references produce NO blockers; the Chosen-mechanism claim with a matching AC passes", () => {
  const proposal =
    "### Problem framing\n\n" +
    "The installed driver `execute-milestone.js` dispatches seven phases (`Verify`, `Prepared`, `Build`, `Audit`, `Gate`, `Reconcile`, `Land`) and calls `composite-preflight.ts` from `phase('Verify')`.\n\n" +
    "### Chosen mechanism\n\n" +
    "The new `workflow-kernel.ts` module invokes `composite-args.ts` `normalizeExecuteArgs` to enforce ordering.\n";
  const ac = "- [ ] Real production callsite evidence confirms `workflow-kernel.ts` invokes `composite-args.ts` `normalizeExecuteArgs`.\n";
  const result = checkWiringCoverage(proposal, ac);
  assert.equal(result.ok, true, "problem-framing code references must not be flagged as uncovered");
  assert.equal(result.code, "wiring-coverage-complete");
  assert.equal(result.uncovered.length, 0);
});

test("checkWiringCoverage: RED — a genuine Chosen-mechanism claim with no matching AC still fails, and only THAT claim is flagged (narrowing never hides real findings)", () => {
  const proposal =
    "### Problem framing\n\n" +
    "The installed driver `execute-milestone.js` dispatches seven phases (`Verify`, `Prepared`, `Build`, `Audit`, `Gate`, `Reconcile`, `Land`) and calls `composite-preflight.ts` from `phase('Verify')`.\n\n" +
    "### Chosen mechanism\n\n" +
    "The new `workflow-kernel.ts` module invokes `composite-args.ts` `normalizeExecuteArgs` to enforce ordering.\n";
  const ac = "- [ ] unrelated item with no identifiers at all\n";
  const result = checkWiringCoverage(proposal, ac);
  assert.equal(result.ok, false);
  assert.equal(result.code, "wiring-coverage-uncovered");
  assert.equal(result.uncovered.length, 1, "only the Chosen-mechanism claim is uncovered, NOT the Problem-framing sentence");
  assert.deepEqual(result.uncovered[0].identifiers.sort(), ["composite-args.ts", "normalizeExecuteArgs", "workflow-kernel.ts"]);
});

test("checkWiringCoverage: a flat source section (no ###/bold subsections) keeps scanning the whole section — backward-compatible with ## Requested action", () => {
  // A flat gap-task `## Requested action`: extractMechanismSubsections finds nothing to narrow to,
  // so the whole section is scanned and a genuine uncovered claim still fails.
  const flat = "The new `wiring-coverage-check.ts` module invokes `task-schema.ts` to enforce coverage.";
  const ac = "- [ ] some unrelated acceptance item with no identifiers at all";
  const result = checkWiringCoverage(flat, ac);
  assert.equal(result.ok, false);
  assert.equal(result.code, "wiring-coverage-uncovered");
  assert.equal(result.uncovered.length, 1);
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
    // gap-wiring-coverage-rootcause-fix: every mechanical wiring-coverage finding must carry
    // rootCauseKey so _groupBlockingByRootCause() clusters them as one root cause (not N distinct
    // ones per finding.id), and repairable so prepare-milestone's repairable-bypass path offers
    // one-shot focused revision instead of split.
    assert.equal(f.rootCauseKey, "wiring-coverage-format", "rootCauseKey enables root-cause-aware clustering");
    assert.equal(f.repairable, true, "repairable enables one-shot focused revision bypass");
  }
  // All findings from the same task share the same rootCauseKey (clustering gate).
  if (verdict.findings.length >= 2) {
    const keys = new Set(verdict.findings.map((f) => f.rootCauseKey));
    assert.equal(keys.size, 1, "all findings from one task share the same rootCauseKey for clustering");
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
