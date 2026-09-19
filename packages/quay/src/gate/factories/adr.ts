// `makeAdrGate` — adr-as-contract enforcement gate factory (E3/DIR-030).
//
// Wires an `accepted` ADR carrying a real `enforcement` command as a named
// `adr-<id>` gate. Fails closed when the ADR is missing, not accepted, or
// has no non-empty `enforcement` string.

import path from "node:path";
import type { GateFn } from "../types.ts";
import { runAcceptance } from "../acceptance-runner.ts";
import { resolveRunnerOptions } from "./utils.ts";
import { createAdrStore } from "../../adr-store.ts";
import type { Task } from "../../abi.ts";

/**
 * E3 (DIR-030 item 2/4) — adr-as-contract enforcement: wire an
 * `accepted` ADR carrying a real `enforcement` command as a named `adr-<id>` gate.
 * Its GateEvents become the "ADR honored" ledger (`quay gate-log`) — this is the
 * "continuously applied" half E1 deliberately deferred.
 *
 * Reads the ADR at GATE-RUN TIME (not module-load time), so an edit to the ADR's
 * `enforcement` field takes effect without a process restart. Fails closed when
 * the ADR is missing, not `accepted`, or has no non-empty `enforcement` string.
 */
export function makeAdrGate(adrId: string, adrDir: string): GateFn {
  return async (_task: Task) => {
    const adrStore = createAdrStore(adrDir);
    const adr = adrStore.get(adrId);
    if (!adr) {
      return { ok: false, reason: `no such ADR: ${adrId}` };
    }
    if (adr.status !== "accepted") {
      return {
        ok: false,
        reason: `${adrId} is not accepted (status: ${adr.status}) — an ADR must be accepted before its gate can enforce it`,
      };
    }
    const command = (adr as unknown as Record<string, unknown>).enforcement;
    if (typeof command !== "string" || command.trim() === "") {
      return {
        ok: false,
        reason: `${adrId} has no enforcement command defined (set its \`enforcement:\` frontmatter field to a runnable check)`,
      };
    }
    // `enforcement:` commands are workspace data written as repo-relative paths (e.g. "bash
    // experiments/.../foo.sh"), so they must run with cwd = workspaceRoot (adrDir's parent), not
    // whatever process.cwd() happens to be for the caller (an in-process gate() call vs the `quay
    // gate` CLI, which sets its own cwd, otherwise resolve to it by coincidence only).
    const { cwd, timeoutMs } = resolveRunnerOptions({ cwd: path.dirname(adrDir) });
    const { ok, reason } = runAcceptance({ command, cwd, timeoutMs });
    return { ok, reason };
  };
}
