// @test-group engine
// promotion-driver.test.mjs — AC130 + AC131 + AC132 + AC134 (tasks/gap-ac130-promotion-driver-resident-loop,
// tasks/gap-ac131-promotion-mechanical-no-llm, tasks/gap-ac132-fix-worker-structured-input,
// tasks/gap-ac134-promotion-outcome-ledger): the resident
// promotion driver loops forever, calling ready-pool-check for the FULL-pool determination (never a
// single --targeted task) each round, does not exit after one round, and enters the next round after
// --interval. AC2 is the FALSIFIABLE half: stop the driver ⇒ a newly-eligible todo in the pool is NOT
// promoted — proving promotion is driven by the driver, not some outer tick.
// AC131 (falsifiable): a qualified todo (four artifacts complete + empty deps) is promoted to ready
// within one round via the mechanical A22 --apply path, with ZERO LLM — the round's outcome record
// carries promote_path_llm_invoked=false (derived from the spawned argv, not hardcoded).
// AC132 (falsifiable): an ineligible todo spawns a short-lived `claude -p` fix worker whose input is
// the task id + the gate's STRUCTURED missing list (A24 三可修/五不可修), never a prose directive.
// AC2: a DoD<40 todo ⇒ the fix worker's prompt carries the structured identifier (fourArtifacts=false
// missing=[dod]); a prompt with only the task id and no missing list would falsify it.
// AC134 (falsifiable): every determination/promotion/fix writes one structured outcome record to
// .quay/promotion-outcome.jsonl (gitignored) with task_id · gate(eligible + missing) · action
// (promote/fix/skip) · result · ts. AC2: the carrier holds REAL records from the real ready-pool-check
// against real task files (not fixture/injected output) — ≥ N records after the driver runs.
//
// The ready-pool-check command is injectable (--ready-pool-cmd) so the pure/loop tests never touch the
// real checker; the AC2 test drives the REAL ready-pool-check --apply against a temp workspace to prove
// the promotion lands on disk while the driver lives and does not after it is SIGTERM'd. The fix-worker
// command is injectable (--fix-worker-cmd) with the structured prompt appended as the last arg, so the
// AC132 AC2 test captures the prompt the worker actually received without spawning a real claude.
//
// Run: scripts/test.sh plugin/test/promotion-driver.test.mjs

// SPLIT from promotion-driver.test.mjs by gap-suite-split-15-over-30s-test-files — shard 3/8 (6 tests). Shared fixtures: ./helpers/promotion-driver-harness.mjs (single source).

import { test } from "node:test";
import { DRIVER, assert, classifyCandidate, defaultPromotionCheckArgv, fs, isLlmInvocation, makeRoot, path, readRoundLines, readStatus, realReadyPoolCmd, runDriver, runPromotionRound, spawn, writeTask } from "./helpers/promotion-driver-harness.mjs";

test("AC2 — stop the driver (SIGTERM) ⇒ newly-eligible todo is not promoted; alive driver promotes it", async (t) => {
  const root = makeRoot("ac2");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-eligible-1", "todo");

  const pidFile = path.join(root, "driver.pid");
  const driver = spawn(process.execPath, [
    "--no-warnings", "--experimental-strip-types", DRIVER, "--root", root,
    "--ready-pool-cmd", realReadyPoolCmd(root),
    "--interval", "25", "--cap", "5", "--pid-file", pidFile, "--json",
  ], { stdio: ["ignore", "pipe", "ignore"] });
  let buf = "";
  driver.stdout.on("data", (d) => { buf += d; });

  // Positive control: while the driver is ALIVE, the eligible todo gets promoted (todo → ready).
  let promoted = false;
  for (let i = 0; i < 300 && !promoted; i++) {
    if (readStatus(root, "gap-eligible-1") === "ready") promoted = true;
    else await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(promoted, true, "AC2 positive: the living driver promoted the eligible todo via full-pool --apply");

  // Stop the driver and wait for it to fully exit.
  driver.kill("SIGTERM");
  const exitCode = await new Promise((resolve) => { driver.on("close", (c) => resolve(c)); });
  assert.equal(exitCode, 0, "SIGTERM ⇒ clean exit (0)");
  const events = buf.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(events.some((e) => e.event === "stop" && e.reason === "signal"), "the signal stop is recorded, not silent");

  // Negative control: AFTER the driver is dead, a NEW eligible todo appears in the pool…
  writeTask(root, "gap-eligible-2", "todo");
  await new Promise((r) => setTimeout(r, 500)); // ≫ interval — any live driver round would have run by now

  // …and it is NOT promoted (proving promotion is driven by the driver, not some outer tick).
  assert.equal(readStatus(root, "gap-eligible-2"), "todo", "AC2 falsifiable: after stop, the newly-eligible todo stays todo");

  // Non-vacuous guard: the SAME task IS genuinely eligible — a single driver round (--once) promotes it.
  runDriver(root, ["--ready-pool-cmd", realReadyPoolCmd(root), "--cap", "5", "--once"]);
  assert.equal(readStatus(root, "gap-eligible-2"), "ready", "guard: gap-eligible-2 was eligible all along — only the stopped driver held it back");
});

// ── AC131 (falsifiable): qualified todo promoted via A22 --apply, zero LLM, promote_path_llm_invoked=false ─────


test("isLlmInvocation — falsifiable SET-based derivation (AC140-4 AC1 + AC2；⛔ not a claude literal)", () => {
  assert.equal(isLlmInvocation(["claude", "-p", "fix task X"]), true, "claude -p is an LLM invocation (default set)");
  assert.equal(isLlmInvocation(["/usr/local/bin/claude", "print"]), true, "absolute claude path is an LLM invocation");
  assert.equal(isLlmInvocation(["node", "--experimental-strip-types", "/r/plugin/scripts/ready-pool-check.ts", "--apply"]), false, "ready-pool-check is mechanical, not an LLM");
  assert.equal(isLlmInvocation([]), false, "empty argv is not an LLM invocation");
  // AC140-4 AC1: the judgment reads the CONFIGURED set, not the literal `claude`.
  // AC140-4 AC2 (能取假): 配 wrapper（claude-fjdac 进集合）后，isLlmInvocation(<wrapper argv>) 必须返回 true。
  assert.equal(isLlmInvocation(["claude-fjdac", "-p", "fix task X"], ["claude", "claude-fjdac"]), true, "AC2: claude-fjdac in the configured set ⇒ isLlmInvocation(<wrapper argv>)=true");
  assert.equal(isLlmInvocation(["claude-fjdac", "-p", "fix task X"]), false, "取假对照: claude-fjdac NOT in the default set ⇒ false (the SET decides, not the literal)");
});


test("AC131 AC1 — the promotion path spawns no LLM: default argv mechanical + round promotePathLlmInvoked=false", (t) => {
  const root = makeRoot("ac131-ac1");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  // The default promotion command is the mechanical ready-pool-check, never an LLM CLI.
  const argv = defaultPromotionCheckArgv(root, 5);
  assert.equal(argv[0], "node");
  assert.equal(isLlmInvocation(argv), false, "AC131: default promotion argv is not an LLM invocation");

  // A mechanical round reports promotePathLlmInvoked=false — and isLlmInvocation is falsifiable (claude ⇒ true),
  // so this is a DERIVED measurement of the spawned argv, not a hardcoded false (hard rule 4).
  const r = runPromotionRound(root, ["node", "-e", "console.log(JSON.stringify({pool:1,should_apply:true,promotions:[{id:'gap-x'}],applied_promotions:[{id:'gap-x',ok:true,from:'todo',to:'ready',deliveryCritical:false}]}))"], 5);
  assert.equal(r.ok, true);
  assert.equal(r.promotePathLlmInvoked, false, "AC131 AC1: the mechanical promotion round reports promotePathLlmInvoked=false");
});


test("AC131 AC2 — four-artifact + empty-deps todo promoted to ready in one round, outcome promote_path_llm_invoked=false", (t) => {
  const root = makeRoot("ac131-ac2");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // four artifacts (Proposal/Contract/AC/DoD) + Touches self-touch, frontmatter has no depends_on ⇒ deps empty.
  writeTask(root, "gap-ac131-eligible", "todo");

  // One driver round (--once) with the REAL ready-pool-check --apply against the temp workspace.
  runDriver(root, ["--ready-pool-cmd", realReadyPoolCmd(root), "--cap", "5", "--once"]);

  assert.equal(readStatus(root, "gap-ac131-eligible"), "ready", "AC131 AC2: eligible todo promoted to ready within one round");

  const records = readRoundLines(root);
  assert.equal(records.length, 1, "exactly one round record");
  const rec = records[0];
  assert.equal(rec.action, "promote");
  assert.ok(rec.promoted_ids.includes("gap-ac131-eligible"), "the promoted id is recorded in the outcome");
  assert.equal(rec.promote_path_llm_invoked, false, "AC131 AC2: the outcome record carries promote_path_llm_invoked=false (the falsifiable half)");
});

// ── AC132 (falsifiable): ineligible todo → short-lived fix worker with the gate's STRUCTURED input ──


test("classifyCandidate — A24 classification (三可修 / 五不可修), ⛔ not re-designed", () => {
  const base = {
    id: "gap-a", fourArtifacts: true, missingArtifacts: [], selfTouchOk: true, touchesResolve: true,
    depsReady: true, retiredMechanism: false, superseded: false, compound: false, prosePrereqGap: [],
  };
  // fixable: DoD missing (fourArtifacts=false)
  const dod = classifyCandidate({ ...base, fourArtifacts: false, missingArtifacts: ["dod"] });
  assert.equal(dod.fixable, true);
  assert.deepEqual(dod.missing, ["fourArtifacts=false missing=[dod]"], "structured identifier verbatim from the gate");
  assert.equal(dod.unfixable.length, 0);
  assert.ok(dod.prompt.includes("fourArtifacts=false missing=[dod]"), "fixable ⇒ prompt carries the structured identifier");

  // fixable: self-touch + touches (two fixable items)
  const st = classifyCandidate({ ...base, selfTouchOk: false, touchesResolve: false });
  assert.equal(st.fixable, true);
  assert.deepEqual(st.missing, ["selfTouchOk=false", "touchesResolve=false"]);

  // unfixable: deps not ready ⇒ no spawn, reason recorded
  const deps = classifyCandidate({ ...base, depsReady: false });
  assert.equal(deps.fixable, false);
  assert.deepEqual(deps.unfixable, ["depsReady=false"]);
  assert.equal(deps.prompt, null, "unfixable ⇒ no fix worker prompt");

  // each of the other four unfixable classes records its own reason
  assert.deepEqual(classifyCandidate({ ...base, retiredMechanism: true }).unfixable, ["retiredMechanism=true"]);
  assert.deepEqual(classifyCandidate({ ...base, superseded: true }).unfixable, ["superseded=true"]);
  assert.deepEqual(classifyCandidate({ ...base, compound: true }).unfixable, ["compound=true"]);
  assert.deepEqual(classifyCandidate({ ...base, prosePrereqGap: ["gap-z"] }).unfixable, ["prosePrereqGap=[gap-z]"]);

  // mixed: fixable AND unfixable ⇒ NOT fixable (the unfixable blocker is the real obstacle)
  const mixed = classifyCandidate({ ...base, fourArtifacts: false, missingArtifacts: ["dod"], depsReady: false });
  assert.equal(mixed.fixable, false, "a fixable item plus an unfixable blocker ⇒ no spawn");
  assert.deepEqual(mixed.unfixable, ["depsReady=false"]);
});

// ── BODY-FRESHNESS third state (tasks/gap-ready-pool-body-still-read-from-stale-main-checkout) ─────
// The consumer half. The defect: the gate's read source was behind the write face, so it reported a
// body defect that no longer existed; the driver spawned a fix worker for it, the worker could not
// fix what was not there, timed out, and 3 rounds of that flipped the task needs-human
// (2026-09-14 gap-rework-multiplier-predictors). The fix worker IS the harm — so the consumer must
// refuse it on an unvouched-for body, with a value that cannot be confused with a verdict.


test("classifyCandidate — bodyEvaluated=false is its OWN class: ⛔ no fix worker for a body the gate could not vouch for", () => {
  const base = {
    id: "gap-a", fourArtifacts: true, missingArtifacts: [], selfTouchOk: true, touchesResolve: true,
    depsReady: true, retiredMechanism: false, superseded: false, compound: false, prosePrereqGap: [],
  };
  // THE FALSIFIABLE PAIR — same body-derived input (`touchesResolve=false`, a fixable class), the
  // ONLY difference is whether the body was evaluated. Body fresh ⇒ spawn; body unvouched-for ⇒ ⛔ no.
  const fresh = classifyCandidate({ ...base, touchesResolve: false, bodyEvaluated: true, bodyFreshness: "fresh" });
  assert.equal(fresh.fixable, true, "control: a fresh body with touchesResolve=false IS the fixable class");
  assert.deepEqual(fresh.missing, ["touchesResolve=false"]);
  assert.ok(fresh.prompt, "control: a fix worker prompt is built");

  const stale = classifyCandidate({ ...base, touchesResolve: false, bodyEvaluated: false, bodyFreshness: "stale-suspected" });
  assert.equal(stale.fixable, false, "same input + an unvouched-for body ⇒ ⛔ NO spawn (this is the 3-retry burn closed)");
  assert.deepEqual(stale.missing, [], "⛔ the fixable identifier is NOT carried — it was judged on a body we cannot vouch for");
  assert.equal(stale.prompt, null, "⛔ no fix worker prompt");
  assert.equal(stale.notEvaluated, true, "the third state is carried as its own value, separate from `missing`/`unfixable` (硬规则 3b)");
  assert.deepEqual(stale.unfixable, ["bodyNotEvaluated=true freshness=stale-suspected (闸读源落后写面 ⇒ 该体未被评估,⛔ 不派 fix worker)"],
    "the reason names the freshness value — distinct from every A24 class");

  // `unknown` (unmeasurable direction) is its own reason too, never collapsed into stale-suspected.
  const unknown = classifyCandidate({ ...base, touchesResolve: false, bodyEvaluated: false, bodyFreshness: "unknown" });
  assert.equal(unknown.notEvaluated, true);
  assert.match(unknown.unfixable[0], /freshness=unknown/, "unknown is distinguishable from stale-suspected in the word list");

  // 缺值 = 未查 (硬规则 6): an OLDER gate output without the field must NOT be read as `false`.
  assert.equal(classifyCandidate({ ...base, touchesResolve: false }).fixable, true, "field absent ⇒ pre-change behavior (undefined is not false)");
});
