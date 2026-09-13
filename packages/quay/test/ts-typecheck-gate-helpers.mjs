// @test-group product
// ts-typecheck-gate-helpers.mjs — shared helpers for the ts-typecheck-gate test family.
//
// Split out of ts-typecheck-gate.test.mjs (gap-suite-split-long-multi-test-files): the original
// 110-line file carried 5 independent node:test cases that each invoke the SAME `npx tsc --noEmit`
// gate against THIS repo's real tsconfig.json. Splitting lets node:test's file-level concurrency
// run them in PARALLEL instead of one long sequential lane. Shared helpers live here so every split
// file resolves the SAME registry/CLI surface (the quay-init-loop split pattern).
//
// SPLIT CONCURRENCY SAFETY: each split file only reads THIS repo's real files (tsconfig.json,
// .quay/config.yml) — never writes shared state. The one test that writes a GateEvent log uses a
// per-file mkdtemp path, so no sibling file can collide.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { resolveGate, listGates, readGatesConfig } from "../src/gate/registry.ts";
import { QUAY_CLI } from "./helpers/cli-entry.mjs";
import { hostGateDeadlineMs, hostBudgetSource } from "../../../plugin/test/helpers/host-budget.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const quayBin = QUAY_CLI;
// repo root: packages/quay/test -> repo root is 3 levels up.
export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

export const gate = (name) => resolveGate(name, REPO_ROOT);
export { listGates };

/**
 * Deadline for the ts-typecheck gate's acceptance command, taken from the deadline THIS WORKSPACE
 * DECLARES for that gate (`.quay/config.yml` `gates:` → `testPass[].timeoutMs` — the same entry the
 * gate resolves its `command`/`cwd` from) and scaled by the host's live oversubscription reading
 * (`/proc/loadavg ÷ availableParallelism`, see plugin/test/helpers/host-budget.mjs).
 *
 * Why (gap-suite-wallclock-budgets-literals-depend-on-host-capacity): this family carried a bare
 * `120000` twice over — the gate's configured deadline AND node:test's own per-test `timeout`. Both
 * are claims about the authoring host having spare capacity: under a full-suite load the real
 * `npx tsc --noEmit` stretch runs long enough to trip either one, and the red lands on whatever
 * unrelated task happens to be landing. The declared value is not relaxed here — on an uncontended
 * host the factor is exactly 1 and the deadline IS the configured one; it only stretches in
 * proportion to how oversubscribed the host actually is (`hostBudgetSource()` prints the reading).
 * The `?? 60000` arm is the acceptance runner's OWN documented default (gate/config/utils.ts) for an
 * entry that declares no `timeoutMs` — not a second opinion about how long tsc takes.
 */
export const TS_TYPECHECK_DECLARED_TIMEOUT_MS =
  readGatesConfig(REPO_ROOT).testPass?.find((e) => e?.name === "ts-typecheck")?.timeoutMs ?? 60000;
export const TS_TYPECHECK_DEADLINE_MS = hostGateDeadlineMs(TS_TYPECHECK_DECLARED_TIMEOUT_MS);

/**
 * Pin the runner's deadline (`QUAY_ACCEPTANCE_TIMEOUT_MS` has precedence over the entry's own
 * `timeoutMs` — DIR-046 A/B, gate/config/utils.ts) to the host-scaled value, so this family's
 * verdict stops depending on the host's spare capacity. Set in `process.env` (not threaded through
 * the gate call) because the CLI-backed member of the family (`quay gate …`) runs in a child process
 * that inherits this environment. Returns the deadline for node:test's own `{ timeout }`.
 */
export function pinHostAcceptanceDeadline() {
  process.env.QUAY_ACCEPTANCE_TIMEOUT_MS = String(TS_TYPECHECK_DEADLINE_MS);
  return TS_TYPECHECK_DEADLINE_MS;
}

/** The host reading the deadline above was derived from — recorded in evidence/commit messages. */
export const TS_TYPECHECK_DEADLINE_SOURCE = hostBudgetSource();

export function runQuay(args, cwd, extraEnv = {}) {
  try {
    const out = execFileSync("node", [quayBin, ...args], {
      encoding: "utf8",
      cwd,
      env: { ...process.env, ...extraEnv },
    });
    return { status: 0, stdout: out, stderr: "" };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? String(err) };
  }
}
