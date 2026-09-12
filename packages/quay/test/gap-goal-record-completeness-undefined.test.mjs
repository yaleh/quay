// @test-group product
// gap-goal-record-completeness-undefined — "what counts as a COMPLETE goal record" was never
// defined: `goal_write` made `origin` required and `body` optional, inverting the incentive
// (8 goals, 5 with empty body — prose crammed into `origin`; GOAL-008's origin hit 1130 chars).
// This test pins the kind-split completeness contract the store now enforces:
//   goal      ⇒ `body` REQUIRED (≥ MIN_GOAL_BODY_CHARS non-whitespace chars); `origin` is
//               provenance only.
//   criterion ⇒ `criterion` + `expect` + `goal` REQUIRED; `body` stays optional.
// AC1 (four-direction falsifiability), AC2 (distinguishable rejections), AC3 (ABI == store),
// AC5 (no false-positive on the 57 production criteria), AC6 (verb description updated).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";
import { createGoalStore, MIN_GOAL_BODY_CHARS, evaluateCriterionAttribution } from "../src/goal-store.ts";

const nativeBin = QUAY_NATIVE_CLI;

const _createdDirs = [];
function tmpDir(tag = "completeness") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `goal-completeness-${tag}-`));
  _createdDirs.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of _createdDirs) fs.rmSync(dir, { recursive: true, force: true });
});

// A body long enough to clear MIN_GOAL_BODY_CHARS (asserted against the SAME exported constant
// the store enforces — never a second, divergent literal, hard rule 4).
const GOAL_BODY = "goal body: background, scope, non-goals and exit conditions — long enough to satisfy the minimum";
assert.ok(GOAL_BODY.trim().length >= MIN_GOAL_BODY_CHARS, "fixture body must clear the store's own threshold");

// The four AC1 inputs, plus the two extra criterion directions AC3 cross-checks.
// `kind` is DERIVED from the id prefix (GOAL-NNN / AC-NNN) — never caller-supplied.
const CASES = [
  // (a) goal + origin, NO body → reject (GOAL-008 was this shape's product).
  { name: "goal-no-body", id: "GOAL-901", fields: { title: "g", status: "draft", origin: "o" }, want: "reject" },
  // (b) goal + body → accept.
  { name: "goal-with-body", id: "GOAL-902", fields: { title: "g", status: "draft", origin: "o", body: GOAL_BODY }, want: "accept" },
  // (c) criterion + criterion/expect, NO body → accept.
  { name: "criterion-complete-no-body", id: "AC-901", fields: { title: "c", status: "draft", goal: "GOAL-900", criterion: "true", expect: "=0", origin: "o" }, want: "accept" },
  // (d) criterion + MISSING criterion → reject.
  { name: "criterion-missing-criterion", id: "AC-902", fields: { title: "c", status: "draft", goal: "GOAL-900", expect: "=0", origin: "o" }, want: "reject" },
  // extra: criterion + MISSING expect → reject.
  { name: "criterion-missing-expect", id: "AC-903", fields: { title: "c", status: "draft", goal: "GOAL-900", criterion: "true", origin: "o" }, want: "reject" },
];

function storeVerdict(store, id, fields) {
  try {
    store.write(id, fields);
    return { verdict: "accept", detail: "ok" };
  } catch (err) {
    return { verdict: "reject", detail: String(err.message) };
  }
}

// ── AC1: kind-split contract is falsifiable — all four directions asserted ─────────────────────
test("AC1 — goal+origin-without-body and criterion-without-criterion are REJECTED; goal+body and criterion-complete are ACCEPTED", () => {
  const store = createGoalStore(tmpDir("ac1"));
  const byName = Object.fromEntries(CASES.map((c) => [c.name, storeVerdict(store, c.id, c.fields)]));

  assert.equal(byName["goal-no-body"].verdict, "reject", "(a) goal + origin without body must be rejected:\n" + byName["goal-no-body"].detail);
  assert.equal(byName["goal-with-body"].verdict, "accept", "(b) goal + body must be accepted:\n" + byName["goal-with-body"].detail);
  assert.equal(byName["criterion-complete-no-body"].verdict, "accept", "(c) criterion + criterion/expect without body must be accepted:\n" + byName["criterion-complete-no-body"].detail);
  assert.equal(byName["criterion-missing-criterion"].verdict, "reject", "(d) criterion without criterion must be rejected:\n" + byName["criterion-missing-criterion"].detail);
});

// ── AC2: rejections are distinguishable — each names its own missing field ─────────────────────
test("AC2 — the (a) and (d) rejections differ, each naming its missing field, and neither is a bare write-failure", () => {
  const store = createGoalStore(tmpDir("ac2"));
  const a = storeVerdict(store, "GOAL-901", { title: "g", status: "draft", origin: "o" });
  const d = storeVerdict(store, "AC-902", { title: "c", status: "draft", goal: "GOAL-900", expect: "=0", origin: "o" });

  assert.notEqual(a.detail, d.detail, "the two rejections must carry different messages");
  assert.match(a.detail, /body/, "(a) must name `body` as the missing field");
  assert.match(d.detail, /criterion/, "(d) must name `criterion` as the missing field");
  // Not a bare, kind-agnostic "write failed" — the failure is field-specific (hard rule 3b).
  assert.doesNotMatch(a.detail, /^write failed$/i);
  assert.doesNotMatch(d.detail, /^write failed$/i);
});

// ── AC3: ABI (MCP goal_write) and store (goal-store.ts write()) agree on every input ──────────
test("AC3 — MCP goal_write and the store write() return the SAME accept/reject verdict per input", async () => {
  const tasksDir = tmpDir("ac3-tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  const goalDir = tmpDir("ac3-goals");
  fs.mkdirSync(goalDir, { recursive: true });

  const transport = new StdioClientTransport({
    command: "node",
    args: [nativeBin, "mcp"],
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir, QUAY_NATIVE_GOAL_DIR: goalDir },
  });
  const client = new Client({ name: "test-agent", version: "0.0.1" });
  await client.connect(transport);
  try {
    const store = createGoalStore(goalDir);
    const divergences = [];
    for (const c of CASES) {
      const viaMcp = await client.callTool({ name: "goal_write", arguments: { id: c.id, ...c.fields } });
      const mcpVerdict = viaMcp.isError === true ? "reject" : "accept";
      const mcpDetail = viaMcp.content?.[0]?.text ?? "";
      const viaStore = storeVerdict(store, c.id, c.fields).verdict;
      if (mcpVerdict !== viaStore || mcpVerdict !== c.want) {
        divergences.push({ name: c.name, mcp: mcpVerdict, mcpDetail, store: viaStore, want: c.want });
      }
    }
    assert.deepEqual(divergences, [], "ABI/store must agree with each other AND with the expected verdict:\n" + JSON.stringify(divergences, null, 2));
  } finally {
    await client.close();
  }
});

// ── AC5: negative control — the completeness rule misfires on no production criterion ───────────
test("AC5 — re-running the new validation over all production criteria misfires on none (empty-body ones included)", () => {
  const goalsDir = new URL("../../../goals", import.meta.url).pathname;
  const prod = createGoalStore(goalsDir);
  const criteria = prod.list().filter((r) => String(r.id).startsWith("AC-"));
  assert.ok(criteria.length > 0, "production goals/ must contain criterion records");

  // Re-issue each criterion through the store's write() with its OWN fields (criterion+expect+goal
  // +origin+body) into a temp dir — a rejected record means a rule misfires on real data.
  //
  // gap-criterion-attribution-write-gate-at-birth: "rejected" is no longer one thing. The write
  // surface now ALSO refuses, at CREATE, a criterion whose failure exits write no cause — a
  // different contract from the completeness rule this test pins, and an intentional one (the
  // 31 baselined production ACs are grandfathered on the UPDATE path, not on CREATE). So the
  // discriminator cannot be the message and cannot be "rejected at all": it is the SAME shared
  // predicate the gate itself uses, applied to the criterion this test just fed in. A rejection of
  // a criterion that predicate calls CLEAN is a misfire — the 2026-09-08 bug class (a blanket
  // body-required rule rejecting bodyless criteria) this negative control exists to catch.
  // ⛔ This is falsifiable in both directions: mis-judge the predicate and the gate's real
  // refusals stop matching it; regress the completeness rule and clean records get rejected.
  const store = createGoalStore(tmpDir("ac5"));
  let passes = 0;
  const rejected = [];
  const emptyBodyIds = [];
  for (const c of criteria) {
    const body = typeof c.body === "string" ? c.body : "";
    if (body.trim() === "") emptyBodyIds.push(String(c.id));
    const attr = evaluateCriterionAttribution(String(c.criterion ?? ""));
    try {
      store.write(String(c.id), {
        title: String(c.title ?? c.id),
        status: String(c.status ?? "draft"),
        goal: String(c.goal ?? ""),
        criterion: String(c.criterion ?? ""),
        expect: String(c.expect ?? ""),
        origin: String(c.origin ?? ""),
        body,
      });
      passes += 1;
    } catch (err) {
      rejected.push({ id: c.id, bare: attr.evaluated ? attr.bare.length : null, reason: String(err.message) });
    }
  }

  // Every rejection must be the attribution gate refusing a criterion that really does carry bare
  // failure exits (bare > 0). bare === 0 ⇒ clean, rejected ⇒ the completeness rule misfired;
  // bare === null ⇒ NOT-EVALUATED — likewise not this gate's doing, so likewise a misfire here.
  const misfires = rejected.filter((r) => r.bare === 0 || r.bare === null);
  assert.deepEqual(misfires, [], `every rejection must be the attribution gate refusing a criterion that carries bare failure exits; misfires:\n${JSON.stringify(misfires, null, 2)}`);
  // The control is not vacuous: the completeness rule must have actually admitted real production
  // criteria (bare-exit ACs are a minority of the corpus — if this ever hits 0, nothing was tested).
  assert.ok(passes > 0, `the completeness rule must accept production criteria (empty-body ones included) — 0 passes means this negative control tested nothing; rejected:\n${JSON.stringify(rejected, null, 2)}`);
  // goals/ is a LIVE, growing store, so a frozen `== N` here rots: on 2026-09-08 AC-200 landed
  // 2m26s before this task's fan-in, turning 57 into 58 and 19 into 20 — the gate went red on a
  // stale literal, not on a rule defect. Ratchet instead. Both assertions still take-false: the
  // first if the store shrinks/is wiped, the second if every criterion body gets backfilled (at
  // which point this negative control no longer exercises the empty-body case it exists for).
  // 2026-09-08 baseline reading: 57 criteria, 19 of them empty-bodied.
  assert.ok(criteria.length >= 57, `>= the 2026-09-08 baseline of 57 criterion records (got ${criteria.length})`);
  assert.ok(emptyBodyIds.length > 0, `the empty-body subset must be non-empty for this negative control to mean anything (got ${emptyBodyIds.length})`);
});

// ── AC6: the goal_write verb description documents the kind-split body requirement ─────────────
test("AC6 — goal_write description says body is required for a GOAL, and origin is no longer the sole required prose field", () => {
  const src = fs.readFileSync(new URL("../../quay-native/src/mcp-server.ts", import.meta.url), "utf8");
  // The description block for goal_write.
  const m = src.match(/server\.registerTool\(\s*"goal_write",\s*\{\s*description:\s*"([^"]*)"/s);
  assert.ok(m, "goal_write description must be present in mcp-server.ts");
  const desc = m[1];
  // body is required for kind:goal, in so many words.
  assert.match(desc, /body/, "description mentions `body`");
  assert.match(desc, /GOAL record requires a non-empty `body`/, "description states a GOAL requires a non-empty body");
  // origin is a provenance citation, NOT the body — and no longer the sole required prose field.
  assert.match(desc, /`origin` is only a provenance citation/, "description scopes origin to provenance");
  assert.doesNotMatch(desc, /`origin` is required \(empty origin writes nothing\)/, "the old sole-required-origin phrasing is gone");
});
