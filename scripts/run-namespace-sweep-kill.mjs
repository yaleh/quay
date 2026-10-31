#!/usr/bin/env node
// plugin/scripts/run-namespace-sweep-kill.mjs — CLI entrypoint for the durable-registry kill
// (teardown-ol-scd-cf-leak). Invoked by scripts/test.sh immediately before the
// suite-tail tmux-leak-scan so a test process that died before its after() hook cannot leave its
// registered server to red the scan (the process-crash hole the in-memory registry cannot close).
//
// Registry-driven (PID-targeted SIGKILL of servers the tests self-built via the durable
// tmux server registry), NEVER a name-based batch kill (invariant no_pkill_by_name_on_live
// = 1). Exits 0 always (best-effort — a cleanup failure must never change the verdict; the leak-scan
// is the assertion).
//
// Filter selection:
//   QUAY_RUN_ID set     → kill that run's still-alive registered servers (a namespaced full suite:
//                         after node exits, any live registered server IS this run's leak).
//   QUAY_RUN_ID unset   → kill only entries whose OWNING TEST PROCESS is dead (crashed-process
//                         residue). A concurrent scoped run's ACTIVE servers (proc alive) are never
//                         touched — cross-run safety without the namespace.
import { killRegisteredServers } from "./run-namespace-sweep.mjs";

const runId = (process.env.QUAY_RUN_ID ?? "").trim();
const killed = runId
  ? killRegisteredServers({ runId })
  : killRegisteredServers({ deadProcOnly: true });

if (killed.length > 0) {
  process.stderr.write(
    `run-namespace-sweep-kill: killed ${killed.length} still-alive registered test server(s) before the leak scan\n`,
  );
}
