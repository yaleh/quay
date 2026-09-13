// host-budget.mjs — test budgets derived from THIS host, read at CALL time.
//
// WHY THIS EXISTS (gap-suite-wallclock-budgets-literals-depend-on-host-capacity)
// A test budget written as a bare wall-clock literal is an unchecked claim about the machine that
// authored it — "a 16-core box with spare capacity". On a busier host the literal silently becomes a
// REAL limit, and its red is attributed to whichever unrelated task happens to be landing (硬规则 4
// 推论二: 「在本机等价于无限制」的字面值,换台机器就变成真限制,且静默). Raising the number is not a
// fix — `observation.test.mjs` was relaxed once (1.5s/200ms → 3s/500ms, gap-observation-ac1-perf-
// threshold-relax) and stayed red 25×; `worker-driver-resident`'s waitFor went 5000 → 10000 and
// stayed red; the ts-typecheck gate's timeoutMs went 60000 → 120000 and stayed red.
//
// WHAT REPLACES IT: every budget is computed in the same round as the call from a reading of the
// host itself — `/proc/loadavg` (1m) ÷ availableParallelism, the host's own oversubscription factor.
// `hostContentionFactor()` is ≥1 and is 1 exactly when at most one runnable task exists per core, so
// scaling by it can only ever LENGTHEN a budget, never tighten it. The same reading (loadavg vs
// nproc) is what this repo's own resource gate uses to decide whether a host has spare capacity —
// this module reuses that reading rather than inventing a second notion of "loaded" (硬规则 1).
//
// These budgets are HANG NETS, never the assertion: the assertion is always the predicate the caller
// polls (or the gate verdict it asserts on). A net only has to be longer than the operation could
// plausibly take on the host it is actually running on — which is exactly what a host reading gives
// and a fixed literal does not.
//
// The remaining constant at each call site is the operation's UNCONTENDED duration: a property of the
// operation (how many sequential child spawns / how much CPU-bound work it needs), not of the host's
// capacity. Host capacity enters only through the factor below, so "the host got busier" changes the
// budget, and "someone ran this on a smaller box" no longer changes the VERDICT.

import fs from "node:fs";
import os from "node:os";

/**
 * Falsification seam (AC3): a positive number that scales every derived budget down, so a dry run can
 * prove the budget is actually consulted — a budget poisoned to ~0 must turn the guarded test RED
 * (硬规则 3b: a judge that stays green when its input is destroyed is not evaluating anything).
 * Unset / non-positive ⇒ 1 (production behaviour).
 */
function envScale() {
  const v = Number(process.env.QUAY_TEST_HOST_BUDGET_SCALE);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/** Host 1-minute load average. 0 when unreadable — never a fabricated value (硬规则 ③b). */
export function hostLoadAvg1() {
  try {
    const v = Number(String(fs.readFileSync("/proc/loadavg", "utf8")).trim().split(/\s+/)[0]);
    if (Number.isFinite(v)) return v;
  } catch {
    // /proc unavailable (non-Linux) — fall back to the portable reading below
  }
  const l = os.loadavg()[0];
  return Number.isFinite(l) ? l : 0;
}

/** Cores this process may actually use (`availableParallelism()` honours affinity/cgroup limits). */
export function hostCores() {
  const n = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * How oversubscribed this host is right now: `loadavg(1m) ÷ cores`, floored at 1. At or below one
 * runnable task per core the factor is exactly 1 (no scaling); at a load of 2× cores it is 2 — work
 * on that host is getting roughly half the CPU it would get with a core to itself.
 */
export function hostContentionFactor() {
  return Math.max(1, hostLoadAvg1() / hostCores());
}

/**
 * Scale an UNCONTENDED budget by this host's own live oversubscription.
 *
 * `baseMs` is the duration the guarded operation needs on a host with a core to spare — a property of
 * the operation, not of the authoring machine's core count. `hostContentionFactor()` (read here, at
 * call time) is what adapts it to the host actually running the test.
 */
export function hostScaledMs(baseMs) {
  return Math.ceil(baseMs * hostContentionFactor() * envScale());
}

/**
 * Deadline for a gate's acceptance command, from the deadline the WORKSPACE ITSELF declares for that
 * gate (`.quay/config.yml` `gates:` → `timeoutMs`), scaled by the host reading. Passing the declared
 * value means an uncontended host gets exactly the configured budget — this never relaxes a
 * configured threshold, it only lets it stretch when the host is oversubscribed.
 */
export function hostGateDeadlineMs(declaredMs) {
  return hostScaledMs(declaredMs);
}

/** One-line description of the reading a derived budget came from — goes into evidence files and
 *  commit messages so a reader can reproduce the number without re-deriving it. */
export function hostBudgetSource() {
  const load = hostLoadAvg1();
  const cores = hostCores();
  const factor = hostContentionFactor();
  return `loadavg1=${load.toFixed(2)} nproc=${cores} contention=${factor.toFixed(2)} scale=${envScale()}`;
}
