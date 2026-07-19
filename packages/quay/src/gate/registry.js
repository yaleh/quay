// Gate registry — name -> async gateFn(task, client) -> { ok, reason } (QENG-1).
//
// Ships exactly one gate, `dod`, a thin adapter over the existing `taskCheck`
// passthrough (`src/provider-client.js`), which itself routes to quay-native
// `store.js#check()`. This generalizes quay's already-shipped author->ready /
// execute->done gate into the first named engine gate — no gate logic is
// duplicated (proposal §"Gate registry + the `dod` gate").
//
// `dod` is status-relative (inherited from `check()`): it runs whichever gate
// matches the task's current status. See proposal §"Gate registry" and the
// QENG-1 fixtures for the reproducible contract.
//
// QENG-2 adds the `acceptance` gate — epicd ADR-019's "runnable meter". It reads
// the runnable command from `task.extra.acceptance` (round-trips through the
// generic `extra` path with NO Provider ABI change) and runs it via the pure
// `runAcceptance` runner. cwd/timeout are resolved from env set by the CLI gate
// handler (QUAY_ACCEPTANCE_CWD / QUAY_ACCEPTANCE_TIMEOUT_MS) so the engine's
// `(task, client)` gate contract stays unchanged (proposal §3, Trade-offs).

import { runAcceptance } from "./acceptance-runner.js";

/**
 * name -> async (task, client) => { ok: boolean, reason: string }
 * @type {Record<string, (task: any, client: any) => Promise<{ ok: boolean, reason: string }>>}
 */
export const gateRegistry = {
  dod: async (task, client) => {
    const r = await client.taskCheck(task.id); // reuse store.js#check() — no duplicate logic
    return { ok: r.ok === true, reason: r.reason };
  },
  acceptance: async (task) => {
    const command = task.extra?.acceptance;
    // Fail-closed: an unset/empty meter under the default gate would let
    // unverified work slip through — the exact hole QENG-2 closes (proposal Risks).
    if (typeof command !== "string" || command.trim() === "") {
      return {
        ok: false,
        reason: "no acceptance command defined (set with `quay task edit <id> --acceptance '<cmd>'`)",
      };
    }
    const cwd = process.env.QUAY_ACCEPTANCE_CWD || process.cwd();
    const timeoutMs = Number(process.env.QUAY_ACCEPTANCE_TIMEOUT_MS) || 60000;
    const { ok, reason } = runAcceptance({ command, cwd, timeoutMs });
    return { ok, reason };
  },
};

/** @returns {string[]} registered gate names */
export function listGates() {
  return Object.keys(gateRegistry);
}
