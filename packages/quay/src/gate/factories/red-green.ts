// `makeRedGreenGate` — RED->GREEN evidence-shape gate factory (DIR-042-A).
//
// PASS iff `red` exits non-zero AND `green` exits 0 — a mechanical proof
// that a real RED->GREEN transition happened, not an assertion of it.

import type { GateFn } from "../types.ts";
import { runAcceptance } from "../acceptance-runner.ts";
import { type GateConfig, resolveRunnerOptions } from "./utils.ts";

/**
 * `red-green` — the reusable RED->GREEN evidence-shape check, parameterized
 * by TWO workspace-configured commands: `red` (expected to FAIL — the
 * pre-fix/failing-test state) and `green` (expected to PASS — the post-fix
 * state). PASS iff `red` exits non-zero AND `green` exits 0 — a mechanical
 * proof that a real RED->GREEN transition happened (ADR-001's evidence bar,
 * generalized). Fails closed when either command is unset, or when `red`
 * unexpectedly PASSES or `green` FAILS.
 */
export function makeRedGreenGate(redCommand: string, greenCommand: string, _label: string, gateConfig?: GateConfig): GateFn {
  return async () => {
    if (typeof redCommand !== "string" || redCommand.trim() === "") {
      return { ok: false, reason: "no red command configured (set gates.yml redGreen[].red)" };
    }
    if (typeof greenCommand !== "string" || greenCommand.trim() === "") {
      return { ok: false, reason: "no green command configured (set gates.yml redGreen[].green)" };
    }
    const { cwd, timeoutMs } = resolveRunnerOptions(gateConfig);
    const redResult = runAcceptance({ command: redCommand, cwd, timeoutMs });
    if (redResult.ok) {
      return { ok: false, reason: `red command unexpectedly passed (exit 0) — no real RED state to prove: ${redResult.reason}` };
    }
    const greenResult = runAcceptance({ command: greenCommand, cwd, timeoutMs });
    if (!greenResult.ok) {
      return { ok: false, reason: `green command failed — RED->GREEN transition not evidenced: ${greenResult.reason}` };
    }
    return { ok: true, reason: `red command failed as expected (${redResult.reason}); green command passed (${greenResult.reason})` };
  };
}
