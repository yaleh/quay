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
//
// DIR-022 Layer 2 phase 1 (M39) adds two more named gates, `impl-row` and
// `line-budget` — thin wrappers over exp5's existing standing mechanical
// checks (`experiments/quay-perpetual-stream/scripts/it0-impl-row-check.sh`
// and `it0-ceiling-line-budget-check.sh`). Per DIR-022's own instruction
// ("Reuse the it0 scripts as-is — do NOT rewrite gate logic"), NEITHER gate
// re-implements any check: both shell out to the real script via the same
// `runAcceptance` runner QENG-2 already ships (spawnSync, real process I/O,
// enforced timeout, real exit-code mapping) — no second command-runner is
// introduced.
//
// Argument convention (documented here per the charter's AC1 requirement):
// each gate reads its script's positional arguments from a DEDICATED
// `task.extra.*` key holding an array of strings — `task.extra.implRowArgs`
// / `task.extra.lineBudgetArgs` — rather than a single pre-joined command
// string. This is a deliberate, minimal extension of the existing
// `task.extra.acceptance` convention: `acceptance` stores a full shell
// command because it wraps an ARBITRARY runnable meter chosen by the task
// author, whereas `impl-row`/`line-budget` wrap ONE FIXED script each (the
// same it0 script for every task that uses the gate) — only the script's
// own positional arguments vary per task. Storing just the args (not the
// whole command line) keeps the fixed script path out of every task file
// (avoids repo-relative-path drift across tasks) and keeps the two gates
// symmetric with each other. Both arrays are optional; each script tolerates
// its own optional trailing argument (see the scripts' own `${2:-default}`
// fallbacks), so an absent args array is not automatically a hard failure —
// only a missing REQUIRED first argument is (mirrored below as a fail-closed
// `ok:false` with a clear reason, same shape as the `acceptance` gate's
// unset-meter fail-closed branch).

import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAcceptance } from "./acceptance-runner.js";
import { createAdrStore } from "../../../quay-native/src/adr-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/quay/src/gate -> repo root is 4 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const IMPL_ROW_SCRIPT = path.join(
  REPO_ROOT,
  "experiments/quay-perpetual-stream/scripts/it0-impl-row-check.sh"
);
const LINE_BUDGET_SCRIPT = path.join(
  REPO_ROOT,
  "experiments/quay-perpetual-stream/scripts/it0-ceiling-line-budget-check.sh"
);
const ADR_DIR = path.join(REPO_ROOT, "adr");

/**
 * Shell-quote one argument for safe interpolation into a `runAcceptance`
 * command string (spawnSync shell:true). Wraps in single quotes, escaping any
 * embedded single quote the POSIX-safe way: close, escaped quote, reopen.
 * @param {string} arg
 */
function shQuote(arg) {
  return `'${String(arg).replaceAll("'", `'\\''`)}'`;
}

/**
 * Build a thin it0-script-wrapping gate fn: reads `task.extra[argsKey]`
 * (expected to be an array of positional args, first arg required), shells
 * out to `scriptPath` via the shared `runAcceptance` runner (no duplicated
 * process-spawn/timeout logic), and maps its exit code straight through
 * (0 = ok:true; the script's own doc'd non-zero exit(s) = ok:false — this
 * wrapper does not interpret exit-code MEANING beyond zero/non-zero, exactly
 * like the `acceptance` gate does for arbitrary meters).
 *
 * @param {string} scriptPath  absolute path to the it0-*.sh script
 * @param {string} argsKey     `task.extra` key holding the args array
 * @param {string} label       short label used in fail-closed reason text
 */
function makeIt0Gate(scriptPath, argsKey, label) {
  return async (task) => {
    const args = task.extra?.[argsKey];
    if (!Array.isArray(args) || args.length === 0 || typeof args[0] !== "string" || args[0].trim() === "") {
      return {
        ok: false,
        reason: `no ${label} arguments defined (set task.extra.${argsKey} to an array, e.g. via ` +
          `\`quay task edit <id> --extra '{"${argsKey}":["<arg1>"]}'\`)`,
      };
    }
    const command = [scriptPath, ...args].map(shQuote).join(" ");
    const cwd = process.env.QUAY_ACCEPTANCE_CWD || process.cwd();
    const timeoutMs = Number(process.env.QUAY_ACCEPTANCE_TIMEOUT_MS) || 60000;
    const { ok, reason } = runAcceptance({ command, cwd, timeoutMs });
    return { ok, reason };
  };
}

/**
 * E3 (exp5-M-CRYST-E3, DIR-030 item 2/4) — adr-as-contract enforcement: wire an
 * `accepted` ADR carrying a real `enforcement` command as a named `adr-<id>` gate.
 * Its GateEvents become the "ADR honored" ledger (`quay gate-log`) — this is the
 * "continuously applied" half E1 deliberately deferred (E1 only reserved the
 * `applies-to`/`enforcement` frontmatter fields, round-tripped verbatim, unconsumed
 * until now).
 *
 * Reads the ADR at GATE-RUN TIME (not module-load time), so an edit to the ADR's
 * `enforcement` field takes effect without a process restart. Fails closed (same
 * discipline as `acceptance`'s unset-meter branch / `makeIt0Gate`'s unset-args
 * branch) when the ADR is missing, not `accepted`, or has no non-empty
 * `enforcement` string — an un-enforceable ADR must never silently PASS.
 *
 * Adjudicated design choice (see tasks/exp5-M-CRYST-E3.md `## Proposal` /
 * docs/plans/10-adr-gate-enforcement.md): `enforcement` is a raw runnable COMMAND
 * STRING (same convention family as `task.extra.acceptance`), not a structured
 * `{check,args}` object — B7's real invocation shape (`loadbearing-test-gate.sh
 * --scripts <dir> [--tests <dir>] ...`) does not reduce to one-fixed-script-plus-
 * positional-args the way `impl-row`/`line-budget` do, so a raw command string is
 * the better fit; execution safety is identical either way (both ultimately hit
 * `runAcceptance`'s `spawnSync(shell:true)`).
 *
 * @param {string} adrId    e.g. "ADR-001"
 * @param {string} adrDir   absolute path to the adr/ directory
 */
function makeAdrGate(adrId, adrDir) {
  return async (task) => {
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
    const command = adr.enforcement;
    if (typeof command !== "string" || command.trim() === "") {
      return {
        ok: false,
        reason: `${adrId} has no enforcement command defined (set its \`enforcement:\` frontmatter field to a runnable check)`,
      };
    }
    const cwd = process.env.QUAY_ACCEPTANCE_CWD || process.cwd();
    const timeoutMs = Number(process.env.QUAY_ACCEPTANCE_TIMEOUT_MS) || 60000;
    const { ok, reason } = runAcceptance({ command, cwd, timeoutMs });
    return { ok, reason };
  };
}

// Declarative table of which ADRs are wired as gates so far (per proposal 2's
// folded-in refinement — a future ADR gate is a one-line addition here, not a
// copy-pasted `makeAdrGate` call site). First wired case: ADR-001 → B7.
const ADR_GATE_IDS = ["ADR-001"];

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
  // DIR-022 Layer 2 phase 1 (M39): thin wrappers, see comment block above.
  "impl-row": makeIt0Gate(IMPL_ROW_SCRIPT, "implRowArgs", "impl-row"),
  "line-budget": makeIt0Gate(LINE_BUDGET_SCRIPT, "lineBudgetArgs", "line-budget"),
};

// E3: register one `adr-<id>` gate per ADR_GATE_IDS entry (lowercase numeric
// suffix, e.g. "ADR-001" -> "adr-001", per the task's own AC1 naming convention).
for (const adrId of ADR_GATE_IDS) {
  const gateName = adrId.toLowerCase();
  gateRegistry[gateName] = makeAdrGate(adrId, ADR_DIR);
}

/** @returns {string[]} registered gate names */
export function listGates() {
  return Object.keys(gateRegistry);
}
