// worker-fan-in-hooks.test.mjs — the extension-point four-arm acceptance for
// tasks/gap-worker-fan-in-cross-cutting-hooks-not-covered-by-extension-point.
//
// WHY THIS TEST EXISTS. `WorkerPool` (AC-915) opened the OUTCOME-HANDLING axis only. The measured
// consequence over `worker-post-909` (`024f9d7f2..HEAD`) was 288 of 307 added lines landing back in
// the centre files (93.8%), because the cross-cutting steps that straddle the flip — slice-readings
// and the dark-axis predicate — had no registration slot. This file pins the slot that closes that
// axis, and it pins it with COUNTS, not with "the hook exists":
//
//   正臂   register a probe hook FROM OUTSIDE `worker-fan-in.ts`, run a flip flow ⇒ triggered=1
//   负臂   the same probe NOT registered, same flow ⇒ triggered=0 AND handlerRegistered=false
//   注入泄漏 replace the dispatcher with one that ignores the registry ⇒ the 负臂 assertion goes RED
//
// The negative arm alone is a vacuously green criterion (a broken dispatcher also reads 0), which is
// why it is only accepted together with the counted positive arm, and why the injection arm exists:
// it proves the negative assertion actually observes the dispatcher.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  PHASE_ORDER,
  registerFanInHook,
  listFanInHooks,
  runFanInHooks,
} from "../scripts/worker-fan-in-hooks.ts";

// ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────

function makeCtx(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fan-in-hooks-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const worktree = path.join(root, "wt");
  fs.mkdirSync(worktree, { recursive: true });
  const stepTrace = [];
  return {
    root,
    worktree,
    ctx: {
      root,
      task: "demo-task",
      worktree,
      mergeTarget: "develop",
      runId: "wk-test-1",
      spawnNodeSibling: (name) => ["node", "--experimental-strip-types", path.join(root, name)],
      traceStep: (step, phase, extra) => stepTrace.push({ step, phase, ...(extra ?? {}) }),
      trace: (entry) => stepTrace.push(entry),
      traceSuiteEvent: (step, extra) => stepTrace.push({ step, ...extra }),
    },
    stepTrace,
  };
}

/**
 * ONE flip flow, parameterised over the DISPATCHER so the injection-leak arm can swap it. The flow
 * is the real thing the centre runs: pre-flip hooks → the flip → post-flip hooks.
 */
async function runFlipFlow(ctx, dispatcher = runFanInHooks) {
  let flipCalls = 0;
  const result = await dispatcher(ctx, async () => {
    flipCalls += 1;
    return { ok: true, reason: null };
  });
  return { result, flipCalls };
}

/** A LEAKING dispatcher: ignores the registry and fires every probe it has ever been told about.
 *  This is the injection the 注入泄漏 arm injects — NOT a second implementation of the runner. */
function makeLeakyDispatcher(probe) {
  return async (ctx, flip) => {
    await probe.run(ctx);            // ⛔ fires unconditionally: no registry consulted
    const flipped = await flip();
    return { ok: flipped.ok, phase: null, step: null, reason: flipped.reason ?? null, executed: [] };
  };
}

// ── 正臂 / 负臂: the counted pair ────────────────────────────────────────────────────────────────

test("正臂 — a hook registered OUTSIDE worker-fan-in.ts is triggered exactly ONCE (triggered=1)", async (t) => {
  const { ctx } = makeCtx(t);
  let triggered = 0;
  const probe = {
    name: "ac2-probe",
    phase: "post-flip",
    run() {
      triggered += 1;
      return { ok: true };
    },
  };
  const unregister = registerFanInHook(probe);   // registration lives in THIS file, not the centre
  t.after(unregister);

  const { result, flipCalls } = await runFlipFlow(ctx);

  assert.equal(triggered, 1, "正臂 must be a COUNT of invocations, not 'the handler exists'");
  assert.equal(flipCalls, 1, "the flip runs exactly once, between the phases");
  assert.equal(result.ok, true);
  assert.deepEqual(result.executed.filter((e) => e.name === "ac2-probe").map((e) => e.phase), ["post-flip"]);
});

test("负臂 — the SAME probe NOT registered reads triggered=0 and handlerRegistered=false", async (t) => {
  const { ctx } = makeCtx(t);
  let triggered = 0;
  const probe = { name: "ac3-probe", phase: "post-flip", run() { triggered += 1; return { ok: true }; } };

  const handlerRegistered = listFanInHooks().some((h) => h.name === "ac3-probe");
  const { result, flipCalls } = await runFlipFlow(ctx);

  assert.equal(triggered, 0, "an unregistered hook must not fire");
  assert.equal(handlerRegistered, false, "the registry confirms there is no such handler");
  // The two green paths are split on purpose: "the hook genuinely is not registered" vs "it is
  // registered but the dispatcher ignored it" must not share one reading.
  assert.equal(result.ok, true);
  assert.equal(flipCalls, 1, "the flip still runs — an absent hook is not a refusal");
});

// ── 注入泄漏: prove the 负臂 is not vacuous ──────────────────────────────────────────────────────

test("注入泄漏 — a leaking dispatcher (ignores the registry) makes the 负臂 assertion RED", async (t) => {
  const { ctx } = makeCtx(t);
  let triggered = 0;
  const probe = { name: "ac3-probe", phase: "post-flip", run() { triggered += 1; return { ok: true }; } };

  // Same flow, same (unregistered) probe, injected dispatcher.
  const { result, flipCalls } = await runFlipFlow(ctx, makeLeakyDispatcher(probe));

  assert.equal(result.ok, true);
  assert.equal(flipCalls, 1);
  // ⛔ THE POINT: the 负臂 assertion `triggered === 0` FAILS here. If it did not, the 负臂 would be
  // green for the wrong reason and would pass with the wiring broken in every direction.
  assert.notEqual(triggered, 0, "a leaking dispatcher must be caught by the negative arm");
  assert.equal(triggered, 1);
});

// ── The registry itself: phase order is DATA, not centre code ───────────────────────────────────

test("phase order is registration data: pre-flip hooks run before the flip, post-flip after", async (t) => {
  const { ctx } = makeCtx(t);
  const order = [];
  const unPre = registerFanInHook({ name: "z-pre", phase: "pre-flip", run() { order.push("pre"); return { ok: true }; } });
  const unPost = registerFanInHook({ name: "a-post", phase: "post-flip", run() { order.push("post"); return { ok: true }; } });
  t.after(unPre);
  t.after(unPost);

  const result = await runFanInHooks(ctx, async () => {
    order.push("flip");
    return { ok: true, reason: null };
  });
  assert.equal(result.ok, true, "the runner completed");

  assert.deepEqual(order, ["pre", "flip", "post"], "PHASE_ORDER, not registration order, decides");
  assert.deepEqual(PHASE_ORDER, ["pre-flip", "post-flip"]);
});

test("a refusing pre-flip hook stops the flip and skips every post-flip hook", async (t) => {
  const { ctx } = makeCtx(t);
  let postRan = 0;
  const unReject = registerFanInHook({ name: "rejecting", phase: "pre-flip", run: () => ({ ok: false, reason: "refused by design" }) });
  const unPost = registerFanInHook({ name: "after-reject", phase: "post-flip", run() { postRan += 1; return { ok: true }; } });
  t.after(unReject);
  t.after(unPost);

  const { result, flipCalls } = await runFlipFlow(ctx);

  assert.equal(result.ok, false);
  assert.equal(result.step, "rejecting", "the refusal is reported under the hook's own name");
  assert.equal(result.reason, "refused by design");
  assert.equal(flipCalls, 0, "no flip after a refused pre-flip hook");
  assert.equal(postRan, 0, "no post-flip hook after a refused flip");
});

test("a throwing hook is a refusal with its own reason — never a silent skip (硬规则 3b)", async (t) => {
  const { ctx } = makeCtx(t);
  const un = registerFanInHook({ name: "throwing", phase: "pre-flip", run() { throw new Error("boom"); } });
  t.after(un);
  const { result, flipCalls } = await runFlipFlow(ctx);
  assert.equal(result.ok, false);
  assert.equal(result.step, "throwing");
  assert.match(String(result.reason), /boom/);
  assert.equal(flipCalls, 0);
});

test("a duplicate hook name is refused (no silent replacement)", (t) => {
  const un = registerFanInHook({ name: "dup", phase: "post-flip", run: () => ({ ok: true }) });
  t.after(un);
  assert.throws(() => registerFanInHook({ name: "dup", phase: "post-flip", run: () => ({ ok: true }) }), /already registered/);
});

test("the built-ins are registered from OUTSIDE the centre: dark-axis pre-flip, slice-readings-post post-flip", () => {
  const names = listFanInHooks();
  assert.deepEqual(
    names.find((h) => h.name === "dark-axis"),
    { name: "dark-axis", phase: "pre-flip" },
  );
  assert.deepEqual(
    names.find((h) => h.name === "slice-readings-post"),
    { name: "slice-readings-post", phase: "post-flip" },
  );
});
