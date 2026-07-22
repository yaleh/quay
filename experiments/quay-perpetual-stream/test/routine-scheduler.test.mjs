// Tests for routine-scheduler.mjs — DIR-051 routine trigger logic + DIR-056 probe support.
// RED-first (ADR-001 / DIR-019).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseTrigger, isDue, dueRoutines, resolveRoutineAction, main } from "../scripts/routine-scheduler.ts";

test("parseTrigger: every(N) and on(event); malformed throws", () => {
  assert.deepEqual(parseTrigger("every(5)"), { kind: "every", n: 5 });
  assert.deepEqual(parseTrigger("on(checkpoint)"), { kind: "on", event: "checkpoint" });
  assert.deepEqual(parseTrigger(" every( 3 ) "), { kind: "every", n: 3 });
  assert.throws(() => parseTrigger("every(0)"), /N>=1/);
  assert.throws(() => parseTrigger("weekly"), /invalid trigger/);
  assert.throws(() => parseTrigger("on()"), /invalid trigger/);
});

test("isDue: every(N) fires on multiples > 0; not on 0", () => {
  assert.equal(isDue("every(5)", { iteration: 5 }), true);
  assert.equal(isDue("every(5)", { iteration: 10 }), true);
  assert.equal(isDue("every(5)", { iteration: 7 }), false);
  assert.equal(isDue("every(5)", { iteration: 0 }), false); // never fire at iteration 0
  assert.equal(isDue("every(1)", { iteration: 3 }), true);
});

test("isDue: on(event) fires only on the matching event", () => {
  assert.equal(isDue("on(checkpoint)", { event: "checkpoint" }), true);
  assert.equal(isDue("on(checkpoint)", { event: "idle" }), false);
  assert.equal(isDue("on(checkpoint)", { iteration: 5 }), false); // no event → not due
});

test("dueRoutines: returns only the routines whose trigger fires", () => {
  const routines = [
    { name: "self-validation", trigger: "every(5)", dispatch: "adversarial-explore" },
    { name: "arch", trigger: "on(checkpoint)", dispatch: "archguard-or-proxy" },
    { name: "other", trigger: "every(3)", dispatch: "x" },
  ];
  const due = dueRoutines(routines, { iteration: 15, event: null });
  assert.deepEqual(due.map((r) => r.name), ["self-validation", "other"]); // 15%5==0, 15%3==0
  const dueCp = dueRoutines(routines, { iteration: 7, event: "checkpoint" });
  assert.deepEqual(dueCp.map((r) => r.name), ["arch"]);
  assert.deepEqual(dueRoutines(routines, { iteration: 7 }), []); // none due
});

test("dueRoutines: non-array throws (fail-closed)", () => {
  assert.throws(() => dueRoutines("nope", {}), /array/);
});

test("main: due routines → exit 0; none due → exit 3; missing file → exit 2", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "routine-"));
  const f = path.join(dir, "routines.json");
  fs.writeFileSync(f, JSON.stringify([{ name: "sv", trigger: "every(5)", dispatch: "x" }]));
  assert.equal(await main(["node", "s", "--iteration", "10", f]), 0);
  assert.equal(await main(["node", "s", "--iteration", "7", f]), 3);
  assert.equal(await main(["node", "s", "--iteration", "10", path.join(dir, "nope.json")]), 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── DIR-056: resolveRoutineAction tests ──────────────────────────────────────────────────────────

test("DIR-056 resolveRoutineAction: probe: → kind=probe with pluginRoot", () => {
  const r = { name: "history-mining", trigger: "on(checkpoint)", probe: "history-mining" };
  const result = resolveRoutineAction(r, "/some/plugin/root");
  assert.equal(result.kind, "probe");
  assert.equal(result.name, "history-mining");
  assert.equal(result.pluginRoot, "/some/plugin/root");
});

test("DIR-056 resolveRoutineAction: probe: without pluginRoot → kind=skip", () => {
  const r = { name: "sv", trigger: "on(checkpoint)", probe: "self-validation" };
  const result = resolveRoutineAction(r, null);
  assert.equal(result.kind, "skip");
  assert.match(result.reason, /pluginRoot/);
});

test("DIR-056 resolveRoutineAction: dispatch: (legacy) → kind=dispatch (back-compat)", () => {
  const r = { name: "sv", trigger: "every(5)", dispatch: "adversarial-explore" };
  const result = resolveRoutineAction(r, null);
  assert.equal(result.kind, "dispatch");
  assert.equal(result.action, "adversarial-explore");
});

test("DIR-056 resolveRoutineAction: probe: takes priority over dispatch: when both present", () => {
  const r = { name: "sv", trigger: "on(checkpoint)", probe: "self-validation", dispatch: "old-action" };
  const result = resolveRoutineAction(r, "/root");
  assert.equal(result.kind, "probe");
  assert.equal(result.name, "self-validation");
});

test("DIR-056 resolveRoutineAction: neither probe nor dispatch → kind=skip", () => {
  const r = { name: "broken", trigger: "on(checkpoint)" };
  const result = resolveRoutineAction(r, "/root");
  assert.equal(result.kind, "skip");
  assert.match(result.reason, /neither.*probe.*dispatch/i);
});

test("DIR-056 back-compat: dispatch: adversarial-explore still routes as dispatch (no behavior change)", () => {
  // This is the original exp5 loop.yml shape — must work exactly as before
  const routines = [
    { name: "self-validation", trigger: "on(checkpoint)", dispatch: "adversarial-explore" },
    { name: "architecture-analysis", trigger: "on(checkpoint)", dispatch: "arch-analyze" },
  ];
  const due = dueRoutines(routines, { event: "checkpoint" });
  assert.equal(due.length, 2);
  for (const r of due) {
    const action = resolveRoutineAction(r, null);
    assert.equal(action.kind, "dispatch", `expected dispatch for ${r.name}`);
  }
  assert.equal(resolveRoutineAction(due[0], null).action, "adversarial-explore");
  assert.equal(resolveRoutineAction(due[1], null).action, "arch-analyze");
});

test("DIR-056 main: probe routine with --plugin-root → outputs DUE ... → probe", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "routine-probe-"));
  const f = path.join(dir, "routines.json");
  fs.writeFileSync(f, JSON.stringify([{ name: "sv", trigger: "on(checkpoint)", probe: "self-validation" }]));
  // Capture stdout
  const origWrite = process.stdout.write.bind(process.stdout);
  const lines = [];
  process.stdout.write = (s) => { lines.push(s); return true; };
  const code = await main(["node", "s", "--event", "checkpoint", "--plugin-root", dir, f]);
  process.stdout.write = origWrite;
  assert.equal(code, 0);
  assert.ok(lines.some((l) => l.includes("→ probe self-validation")), `lines: ${JSON.stringify(lines)}`);
  fs.rmSync(dir, { recursive: true, force: true });
});
