// @test-group product
// gap-goal-status-stale-achieved-after-new-active-criterion-filed — 给已 achieved 的 GOAL 挂新
// active criterion 后，GOAL 自己的 status 字段不会跟着标记过期 ⇒ 真正完成与名义完成同形。
//
// THE DEFECT (first-hand reading, 2026-09-14, third-party workspace quay-fleet): GOAL-003 sat at
// `status: achieved` while AC-029/030/031/032 were filed `status: active` under it. `write()` is a
// PER-RECORD function — writing an AC touches nothing on its owning GOAL's record — so both worlds
// rendered as the SAME `achieved` token. Only a human noticing corrected it.
//
// What this file pins, AC by AC:
//   AC1 — the trigger: a non-`achieved` AC written under an `achieved` GOAL appends EXACTLY ONE
//         signal record with goalId/staleSince/triggeringAcId/goalStatusAtTime. Negative controls:
//         (a) an ACTIVE goal's new AC writes NOTHING; (b) an AC that is itself `achieved` writes
//         NOTHING (the "introduced an undischarged child" predicate is the whole trigger).
//   AC2 — the reader: a stale `achieved` GOAL and a clean `achieved` GOAL are DISTINGUISHABLE in
//         `quay goal list`'s text output (asserted end-to-end through the real CLI).
//   AC3 — the human path: an EXISTING `status: active` write records the decision (appends a
//         `resolved` line — ⛔ never deletes the original signal) and the marker disappears.
//   AC4 — the boundary: the owning GOAL's `.md` is BYTE-IDENTICAL across the triggering write
//         (裁定 3 — 激活归人; the mechanism never flips achieved→active).
//   + the hard-rule-3b controls: an unreadable carrier reads `not-evaluated`, ⛔ NOT `clean`.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { createGoalStore, readGoalStaleness, GOAL_STALENESS_SIGNAL_REL } from "../src/goal-store.ts";
import { goalStalenessMark } from "../src/cli/goal.ts";
import { QUAY_CLI, QUAY_NATIVE_CLI, QUAY_PKG_DIR } from "./helpers/cli-entry.mjs";

const _createdDirs = [];
function tmpDir(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `goal-stale-${tag}-`));
  _createdDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of _createdDirs) fs.rmSync(dir, { recursive: true, force: true });
});

// Complete-record fixtures (gap-goal-record-completeness-undefined: a GOAL needs a ≥40-char body, a
// criterion record needs criterion+expect+goal+origin). `true` is a criterion with no failure exit,
// so the write-side attribution gate has nothing to refuse.
const GOAL_BODY = "goal body: background, scope and non-goals, exit conditions — long enough to clear the 40-char minimum";
const EXPECT = "the expected outcome this criterion proves";

/** The signal carrier for a `<root>/goals` store — the SAME derivation the store uses. */
function carrierPath(root) {
  return path.join(root, GOAL_STALENESS_SIGNAL_REL);
}
function carrierLines(root) {
  const p = carrierPath(root);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim() !== "");
}

/** GOAL-001 (active) + AC-010 (active) — then GOAL-001 is closed, the precondition for the defect. */
function achievedGoalWithAc(store) {
  store.write("GOAL-001", { title: "g", status: "active", origin: "o", body: GOAL_BODY });
  store.write("AC-010", { title: "ac", status: "active", goal: "GOAL-001", criterion: "true", expect: EXPECT, origin: "o" });
  store.write("GOAL-001", { title: "g", status: "achieved", origin: "o", body: GOAL_BODY });
}

// ── AC1 — the trigger + both negative controls ───────────────────────────────────────────────────
test("AC1 — a non-achieved AC filed under an achieved GOAL appends exactly ONE complete signal record", () => {
  const root = tmpDir("ac1");
  const store = createGoalStore(path.join(root, "goals"));
  achievedGoalWithAc(store);
  const before = carrierLines(root).length;

  store.write("AC-020", { title: "new child", status: "active", goal: "GOAL-001", criterion: "true", expect: EXPECT, origin: "o" });

  const lines = carrierLines(root);
  assert.equal(lines.length, before + 1, `expected exactly one new signal; carrier=${JSON.stringify(lines)}`);
  const rec = JSON.parse(lines[lines.length - 1]);
  assert.equal(rec.event, "stale");
  assert.equal(rec.goalId, "GOAL-001");
  assert.equal(rec.triggeringAcId, "AC-020");
  assert.equal(rec.goalStatusAtTime, "achieved");
  assert.ok(typeof rec.staleSince === "string" && rec.staleSince !== "", "staleSince must be recorded");
  assert.ok(!Number.isNaN(Date.parse(rec.staleSince)), "staleSince must be a real timestamp");
});

test("AC1 negative control (a) — filing an AC under an ACTIVE GOAL writes NO signal", () => {
  const root = tmpDir("ac1-active");
  const store = createGoalStore(path.join(root, "goals"));
  store.write("GOAL-001", { title: "g", status: "active", origin: "o", body: GOAL_BODY });
  store.write("AC-010", { title: "ac", status: "active", goal: "GOAL-001", criterion: "true", expect: EXPECT, origin: "o" });
  const before = carrierLines(root).length;
  store.write("AC-020", { title: "new child", status: "active", goal: "GOAL-001", criterion: "true", expect: EXPECT, origin: "o" });
  assert.equal(carrierLines(root).length, before, "only a GOAL that READS achieved triggers — an active one must not");
});

test("AC1 negative control (b) — an AC written as ACHIEVED under an achieved GOAL writes NO signal", () => {
  const root = tmpDir("ac1-achieved-ac");
  const store = createGoalStore(path.join(root, "goals"));
  achievedGoalWithAc(store);
  const before = carrierLines(root).length;
  // Same owning GOAL, same write path — the ONLY difference is the child's own status. If the
  // predicate were "an AC was written under an achieved goal" this branch would fire, so this
  // control separates 「写入了一条未达成子项」 from 「写入了子项」 (hard rule 3: a real discriminator).
  store.write("AC-021", { title: "discharged child", status: "achieved", goal: "GOAL-001", criterion: "true", expect: EXPECT, origin: "o" });
  assert.equal(carrierLines(root).length, before, "an `achieved` child introduces no undischarged item");
});

// ── AC4 — the boundary: the owning GOAL's record is NEVER modified ───────────────────────────────
test("AC4 — the owning GOAL's .md is BYTE-IDENTICAL across the triggering write (裁定 3: activation is human)", () => {
  const root = tmpDir("ac4");
  const goalsDir = path.join(root, "goals");
  const store = createGoalStore(goalsDir);
  achievedGoalWithAc(store);
  const goalFile = path.join(goalsDir, fs.readdirSync(goalsDir).find((f) => f.startsWith("GOAL-001")));
  const before = fs.readFileSync(goalFile);

  store.write("AC-020", { title: "new child", status: "active", goal: "GOAL-001", criterion: "true", expect: EXPECT, origin: "o" });

  const after = fs.readFileSync(goalFile);
  assert.deepEqual(
    after,
    before,
    "the signal is a SIDE-CARRIER append only — the GOAL record must not be touched (not its status, not any field)",
  );
  // …and the GOAL's stored status is still `achieved`: the mechanism recorded the divergence, it did
  // NOT reopen. This is the direct机械 check of 裁定 3 (goal-driver.ts:516/2243).
  const fm = fs.readFileSync(goalFile, "utf8");
  assert.match(fm, /^status: achieved$/m, "the store must never flip achieved→active on its own");
});

// ── AC2 — the reader distinguishes the two worlds ────────────────────────────────────────────────
test("AC2 (store) — a stale achieved GOAL and a clean achieved GOAL are DIFFERENT derived values", () => {
  const root = tmpDir("ac2-store");
  const store = createGoalStore(path.join(root, "goals"));
  achievedGoalWithAc(store);                                            // GOAL-001 → stale after the write below
  store.write("AC-020", { title: "new child", status: "active", goal: "GOAL-001", criterion: "true", expect: EXPECT, origin: "o" });

  // A genuinely closed GOAL, built the same way but with its child discharged BEFORE closure.
  store.write("GOAL-002", { title: "clean", status: "active", origin: "o", body: GOAL_BODY });
  store.write("AC-030", { title: "ac", status: "achieved", goal: "GOAL-002", criterion: "true", expect: EXPECT, origin: "o" });
  store.write("GOAL-002", { title: "clean", status: "achieved", origin: "o", body: GOAL_BODY });

  const byId = new Map(store.list().map((g) => [String(g.id), g]));
  assert.equal(byId.get("GOAL-001").status, "achieved");
  assert.equal(byId.get("GOAL-002").status, "achieved");
  assert.equal(byId.get("GOAL-001").staleness.state, "stale", "the divergent GOAL must say so");
  assert.deepEqual(byId.get("GOAL-001").staleness.signals.map((s) => s.triggeringAcId), ["AC-020"]);
  assert.equal(byId.get("GOAL-002").staleness.state, "clean", "a genuinely closed GOAL must NOT carry the marker");
  // The rendered marker is the observable half of that difference (⛔ never the same string).
  assert.notEqual(goalStalenessMark(byId.get("GOAL-001")), goalStalenessMark(byId.get("GOAL-002")));
  assert.equal(goalStalenessMark(byId.get("GOAL-002")), "");
  assert.match(goalStalenessMark(byId.get("GOAL-001")), /stale:n=1/);
});

test("hard rule 3b — an UNREADABLE carrier reads `not-evaluated`, ⛔ never `clean`", () => {
  const root = tmpDir("ac2-unreadable");
  const store = createGoalStore(path.join(root, "goals"));
  achievedGoalWithAc(store);
  // Corrupt one line of the carrier (a carrier the reader "cannot understand" must not look like
  // "read it, nothing there" — that is this repo's most expensive failure shape).
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(carrierPath(root), "{not json\n", "utf8");

  const g = store.list().find((x) => String(x.id) === "GOAL-001");
  assert.equal(g.staleness.state, "not-evaluated");
  assert.ok(typeof g.staleness.reason === "string" && g.staleness.reason.length > 0, "the reason must be carried");
  assert.notEqual(goalStalenessMark(g), "", "not-evaluated must be VISIBLE, not silently equal to clean");
  assert.match(goalStalenessMark(g), /NOT-EVALUATED/);
  // The single-record reader agrees with the list reader (one implementation, not two).
  assert.equal(readGoalStaleness(path.join(root, "goals"), "GOAL-001").state, "not-evaluated");
});

// ── AC3 — the human confirmation path is the EXISTING status: active write ───────────────────────
test("AC3 — `status: active` marks the signals resolved (appended, never deleted) and clears the marker", () => {
  const root = tmpDir("ac3");
  const goalsDir = path.join(root, "goals");
  const store = createGoalStore(goalsDir);
  achievedGoalWithAc(store);
  store.write("AC-020", { title: "new child", status: "active", goal: "GOAL-001", criterion: "true", expect: EXPECT, origin: "o" });
  const staleLines = carrierLines(root);
  assert.equal(JSON.parse(staleLines[staleLines.length - 1]).event, "stale");
  assert.equal(readGoalStaleness(goalsDir, "GOAL-001").state, "stale");

  // The decision — an EXISTING verb on an EXISTING path, ⛔ not a new one.
  store.write("GOAL-001", { title: "g", status: "active", origin: "o", body: GOAL_BODY, actor: "human", reason: "reopened: AC-020" });

  const after = carrierLines(root);
  assert.equal(after.length, staleLines.length + 1, "resolution APPENDS a record; it never rewrites the carrier");
  const resolved = JSON.parse(after[after.length - 1]);
  assert.equal(resolved.event, "resolved");
  assert.equal(resolved.goalId, "GOAL-001");
  assert.equal(resolved.actor, "human");
  // The ORIGINAL signal line is still there, verbatim — the audit trail keeps both the divergence
  // and the decision that closed it (`*-sync.jsonl` 「事件不删只追加状态」).
  assert.equal(after[staleLines.length - 1], staleLines[staleLines.length - 1]);

  assert.equal(readGoalStaleness(goalsDir, "GOAL-001").state, "clean");
  const g = store.list().find((x) => String(x.id) === "GOAL-001");
  assert.equal(g.status, "active");
  assert.equal(goalStalenessMark(g), "", "after the human decision the marker must be gone");
});

// ── AC2 end-to-end: the marker reaches the REAL `quay goal list` surface ─────────────────────────
const nativeProviderDir = path.join(QUAY_PKG_DIR, "..", "quay-native", "bin");

function makeWorkspace(tag) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `goal-stale-cli-${tag}-`));
  _createdDirs.push(ws);
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(ws, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(ws, "goals"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    [
      "providers:",
      "  native:",
      "    enabled: true",
      `    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"`,
      `    mcp_entry: ["node", "${QUAY_NATIVE_CLI.replaceAll("\\", "\\\\")}", "mcp"]`,
      "    env:",
      `      QUAY_NATIVE_TASKS_DIR: "${path.join(ws, "tasks").replaceAll("\\", "\\\\")}"`,
      `      QUAY_NATIVE_GOAL_DIR: "${path.join(ws, "goals").replaceAll("\\", "\\\\")}"`,
      "",
    ].join("\n"),
  );
  return ws;
}

function runQuay(args, cwd) {
  try {
    return { status: 0, stdout: execFileSync("node", [QUAY_CLI, ...args], { encoding: "utf8", cwd }), stderr: "" };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? String(err) };
  }
}

test("AC2 (end-to-end) — `quay goal list` marks the stale achieved GOAL and NOT the clean one", () => {
  const ws = makeWorkspace("list");
  const store = createGoalStore(path.join(ws, "goals"));
  achievedGoalWithAc(store);
  store.write("AC-020", { title: "new child", status: "active", goal: "GOAL-001", criterion: "true", expect: EXPECT, origin: "o" });
  store.write("GOAL-002", { title: "clean", status: "active", origin: "o", body: GOAL_BODY });
  store.write("AC-030", { title: "ac", status: "achieved", goal: "GOAL-002", criterion: "true", expect: EXPECT, origin: "o" });
  store.write("GOAL-002", { title: "clean", status: "achieved", origin: "o", body: GOAL_BODY });

  const r = runQuay(["goal", "list"], ws);
  assert.equal(r.status, 0, `quay goal list failed: ${r.stderr}`);
  const lineOf = (id) => r.stdout.split("\n").find((l) => l.startsWith(`${id}\t`));
  const staleLine = lineOf("GOAL-001");
  const cleanLine = lineOf("GOAL-002");
  assert.ok(staleLine, `GOAL-001 row missing from:\n${r.stdout}`);
  assert.ok(cleanLine, `GOAL-002 row missing from:\n${r.stdout}`);
  assert.match(staleLine, /achieved\(⚠️stale:n=1\)/, `stale row must carry the enumerated marker; got ${JSON.stringify(staleLine)}`);
  assert.match(cleanLine, /^GOAL-002\tachieved\t/, `clean row must read as a plain achieved; got ${JSON.stringify(cleanLine)}`);
  assert.notEqual(staleLine, cleanLine, "the two worlds must NOT render as the same string");

  // The JSON surface carries the same distinction (the machine-readable form of the same reading).
  const j = runQuay(["goal", "list", "--json"], ws);
  assert.equal(j.status, 0, `quay goal list --json failed: ${j.stderr}`);
  const byId = new Map(JSON.parse(j.stdout).map((g) => [g.id, g]));
  assert.equal(byId.get("GOAL-001").staleness.state, "stale");
  assert.equal(byId.get("GOAL-002").staleness.state, "clean");

  // ── AC3 end-to-end: the human path clears it on the SAME read surface ──
  const reopen = runQuay(["goal", "write", "GOAL-001", "--status", "active", "--title", "g", "--origin", "o", "--body", GOAL_BODY], ws);
  assert.equal(reopen.status, 0, `reopen failed: ${reopen.stderr}`);
  const r2 = runQuay(["goal", "list"], ws);
  assert.equal(r2.status, 0, `quay goal list failed: ${r2.stderr}`);
  const line2 = r2.stdout.split("\n").find((l) => l.startsWith("GOAL-001\t"));
  assert.match(line2, /^GOAL-001\tactive\t/, `after the human decision the marker must be gone; got ${JSON.stringify(line2)}`);
  assert.doesNotMatch(line2, /stale/, "no marker survives the confirmation");
});
