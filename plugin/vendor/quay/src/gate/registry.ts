// Gate registry — name -> async gateFn(task, client) -> { ok, reason } (QENG-1).
//
// Ships exactly one true built-in gate, `dod`, a thin adapter over the
// existing `taskCheck` passthrough (`src/provider-client.js`), which itself
// routes to quay-native `store.js#check()`. This generalizes quay's
// already-shipped author->ready / execute->done gate into the first named
// engine gate — no gate logic is duplicated (proposal §"Gate registry + the
// `dod` gate").
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
// DIR-035-B (M49) / ADR-013 Decision item 2: the product ships the gate ENGINE
// + generic FACTORIES (`makeIt0Gate`, `makeAdrGate`) only. WHICH scripts get an
// `it0`-style named gate, and WHICH ADRs get an auto-wired `adr-<id>` gate, is
// no longer baked into this module as hardcoded `experiments/quay-perpetual-
// stream/**` path constants / an `ADR_GATE_IDS` array — it is now WORKSPACE
// DATA, read from `<workspaceRoot>/.quay/gates.yml` at gate-list/gate-run time
// (see `loadWorkspaceGates` below) — the same "derived at gate-run time, not
// baked into the module" discipline the `adr-<id>` gate already used for ITS
// data (an ADR's own `enforcement:` frontmatter field); this just applies it
// one level up, to WHICH ids get wired at all. A fresh non-research workspace
// with no `gates.yml` (or none of these keys set) sees only the two built-ins
// above (`dod`, `acceptance`) plus its own `doc-*` gates (DOCUMENT_GATE_IDS
// below is a genuinely product-owned mechanism, not research-specific data,
// so it stays baked in — same reasoning the D1 milestone task itself gives).
// This repo's own research-loop gates (5 it0/vmeta/audit/dogfood scripts plus
// 1 wired ADR) now live in THIS repo's own `.quay/gates.yml`, preserving the
// exact prior gate set/behavior for this repo's own workspace.
//
// Per-gate argument convention (documented here per the charter's AC1
// requirement, unchanged by DIR-035-B): each `it0`-style gate reads its
// script's positional arguments from a DEDICATED `task.extra.*` key holding
// an array of strings (e.g. `task.extra.implRowArgs`), rather than a single
// pre-joined command string — a deliberate, minimal extension of the existing
// `task.extra.acceptance` convention: `acceptance` stores a full shell command
// because it wraps an ARBITRARY runnable meter chosen by the task author,
// whereas an `it0`-style gate wraps ONE FIXED script (declared once in
// `gates.yml`, not per task) — only the script's own positional arguments
// vary per task. Storing just the args (not the whole command line) keeps the
// fixed script path out of every task file and keeps every such gate
// symmetric with its siblings. The args array is optional; each script
// tolerates its own optional trailing argument (see the scripts' own
// `${2:-default}` fallbacks), so an absent args array is not automatically a
// hard failure — only a missing REQUIRED first argument is (a fail-closed
// `ok:false` with a clear reason, same shape as the `acceptance` gate's
// unset-meter fail-closed branch).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import YAML from "yaml";
import { runAcceptance } from "./acceptance-runner.ts";
// ADR-013 / DIR-035-A: these are generic filesystem-frontmatter stores with no
// dependency on any Provider's task vocabulary — they were misplaced under
// quay-native (a Provider) purely because that's where they were first added
// (E1/E3/D1); Core needs them standalone for its own gate registry, so they
// now live here as Core-owned modules (moved, not duplicated — quay-native's
// own CLI/MCP-server imports them back from `quay` as a declared dependency).
import { createAdrStore } from "../adr-store.ts";
import { createDocumentStore } from "../document-store.ts";
import { validateContracts } from "../contract-validator.ts";
import { findConfig } from "../config.ts";
import type { Task } from "../abi.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/quay/src/gate -> repo root is 4 levels up. Used ONLY for the
// product's OWN built-in doc-gate data (DOCUMENT_GATE_IDS/DOCUMENTS_DIR
// below), which is genuinely product-owned, not research-specific — see the
// header comment. Everything research-loop-specific now resolves relative to
// a WORKSPACE root discovered at gate-run time (loadWorkspaceGates), never
// this module's own directory.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

/** The verdict shape every gate function returns. */
export interface GateVerdict {
  ok: boolean;
  reason: string;
}

/**
 * A named gate definition: an async function that evaluates a task (and
 * optionally the provider client) and returns a pass/fail verdict.
 * The `check` function is the core gate logic; `description`, `onPass`, and
 * `onFail` are optional metadata fields used by the DSL/display layer.
 */
export interface GateDefinition {
  /** Short human-readable description of what this gate checks. */
  description?: string;
  /** Optional hook called after a passing verdict (informational, not enforcement). */
  onPass?: string;
  /** Optional hook called after a failing verdict (informational, not enforcement). */
  onFail?: string;
  /** The gate evaluation function. */
  check?: (task: Task, client: unknown) => Promise<GateVerdict>;
}

/** Type alias for a bare gate function (the common usage in the registry). */
export type GateFn = (task: Task, client: unknown) => Promise<GateVerdict>;

interface RunnerOptions {
  cwd: string;
  timeoutMs: number;
}

interface GateConfig {
  cwd?: string;
  timeoutMs?: number;
}

/**
 * Shell-quote one argument for safe interpolation into a `runAcceptance`
 * command string (spawnSync shell:true). Wraps in single quotes, escaping any
 * embedded single quote the POSIX-safe way: close, escaped quote, reopen.
 */
function shQuote(arg: string): string {
  return `'${String(arg).replaceAll("'", `'\\''`)}'`;
}

/**
 * DIR-046 (A/B) — resolve the acceptance runner's cwd/timeoutMs for ONE gate
 * invocation, with a single shared precedence rule used by every factory in
 * this module (single-source, ADR-004 — the precedence used to be silently
 * hardcoded per-factory as `process.env.QUAY_ACCEPTANCE_CWD || process.cwd()`
 * / `Number(process.env.QUAY_ACCEPTANCE_TIMEOUT_MS) || 60000`; this is that
 * SAME default, now overridable and named once):
 *
 *   cwd:       pre-set `QUAY_ACCEPTANCE_CWD` env var  >  this gate's own
 *              `gates.yml` `cwd` field  >  `process.cwd()` (the CLI layer
 *              pins `process.cwd()`-equivalent workspaceRoot into the env var
 *              itself as the DEFAULT — see bin/quay.js — so by the time a
 *              factory reads `process.env.QUAY_ACCEPTANCE_CWD` here, an
 *              explicit `--cwd` flag has ALREADY been folded in with the
 *              correct precedence over the workspaceRoot pin; a gates.yml
 *              per-gate `cwd` is the one precedence level this module itself
 *              must apply, since the CLI has no per-gate visibility).
 *   timeoutMs: pre-set `QUAY_ACCEPTANCE_TIMEOUT_MS` env var (also folded in at
 *              the CLI layer from an explicit `--timeout` flag) > this gate's
 *              own `gates.yml` `timeoutMs` field > the 60000ms default.
 */
function resolveRunnerOptions(gateConfig: GateConfig = {}): RunnerOptions {
  const cwd = process.env.QUAY_ACCEPTANCE_CWD || gateConfig.cwd || process.cwd();
  const envTimeout = Number(process.env.QUAY_ACCEPTANCE_TIMEOUT_MS);
  const timeoutMs = (Number.isFinite(envTimeout) && envTimeout > 0)
    ? envTimeout
    : (typeof gateConfig.timeoutMs === "number" && gateConfig.timeoutMs > 0 ? gateConfig.timeoutMs : 60000);
  return { cwd, timeoutMs };
}

/**
 * Build a thin it0-script-wrapping gate fn: reads `task.extra[argsKey]`
 * (expected to be an array of positional args, first arg required), shells
 * out to `scriptPath` via the shared `runAcceptance` runner (no duplicated
 * process-spawn/timeout logic), and maps its exit code straight through
 * (0 = ok:true; the script's own doc'd non-zero exit(s) = ok:false — this
 * wrapper does not interpret exit-code MEANING beyond zero/non-zero, exactly
 * like the `acceptance` gate does for arbitrary meters).
 */
function makeIt0Gate(scriptPath: string, argsKey: string, label: string, gateConfig?: GateConfig): GateFn {
  return async (task: Task) => {
    const args = (task.extra as Record<string, unknown>)?.[argsKey];
    if (!Array.isArray(args) || args.length === 0 || typeof args[0] !== "string" || (args[0] as string).trim() === "") {
      return {
        ok: false,
        reason: `no ${label} arguments defined (set task.extra.${argsKey} to an array, e.g. via ` +
          `\`quay task edit <id> --extra '{"${argsKey}":["<arg1>"]}'\`)`,
      };
    }
    const command = [scriptPath, ...(args as string[])].map(shQuote).join(" ");
    const { cwd, timeoutMs } = resolveRunnerOptions(gateConfig);
    const { ok, reason } = runAcceptance({ command, cwd, timeoutMs });
    return { ok, reason };
  };
}

/**
 * DIR-035-D — a thin sibling of `makeIt0Gate` for a FIXED script that takes
 * NO `task.extra` args at all (unlike the it0-style scripts, which require
 * >=1 positional arg). `delivery-standalone-smoke.sh` is exactly this shape:
 * a zero-argument conformance check. Reuses the SAME `runAcceptance` runner
 * (no new process-spawn logic) — this is the missing zero-arg case in the
 * same factory family, not a duplication of `makeIt0Gate`'s args-required
 * logic (see `docs/plans/13-dir035-d-kit-singlesource-and-smoke-gate.md`).
 */
function makeFixedScriptGate(scriptPath: string, _label: string, gateConfig?: GateConfig): GateFn {
  return async () => {
    const command = shQuote(scriptPath);
    const { cwd, timeoutMs } = resolveRunnerOptions(gateConfig);
    const { ok, reason } = runAcceptance({ command, cwd, timeoutMs });
    return { ok, reason };
  };
}

/**
 * E3 (DIR-030 item 2/4) — adr-as-contract enforcement: wire an
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
 * Adjudicated design choice (see the E3 milestone task's `## Proposal` /
 * docs/plans/10-adr-gate-enforcement.md): `enforcement` is a raw runnable COMMAND
 * STRING (same convention family as `task.extra.acceptance`), not a structured
 * `{check,args}` object — B7's real invocation shape (`loadbearing-test-gate.sh
 * --scripts <dir> [--tests <dir>] ...`) does not reduce to one-fixed-script-plus-
 * positional-args the way an `it0`-style gate does, so a raw command string is
 * the better fit; execution safety is identical either way (both ultimately hit
 * `runAcceptance`'s `spawnSync(shell:true)`).
 */
function makeAdrGate(adrId: string, adrDir: string): GateFn {
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
    const { cwd, timeoutMs } = resolveRunnerOptions();
    const { ok, reason } = runAcceptance({ command, cwd, timeoutMs });
    return { ok, reason };
  };
}

/**
 * Generic DoD gate SET (this milestone): three runner-agnostic factories, each
 * taking its actual COMMAND (+ threshold, for the coverage one) as pure
 * workspace config — never a hardcoded test-runner/language invocation. They
 * extend the SAME family as `makeIt0Gate`/`makeAdrGate`/`makeFixedScriptGate`
 * above: thin wrappers over `runAcceptance` (spawnSync, real process I/O),
 * fail-closed on missing config, exit-0-is-pass. Wiring is via
 * `.quay/gates.yml`'s new `testPass` / `coverageFloor` / `redGreen` lists (see
 * `readGatesConfig`/`loadWorkspaceGates` below) — the WORKSPACE names its own
 * test/coverage/red+green commands; this module never names one.
 *
 * `test-pass` — run a workspace-configured command, PASS iff exit 0. This is
 * the generic "some command exits clean" shape shared by any test-runner
 * invocation, whatever language or tool a workspace happens to use — no such
 * tool name ever appears here; the actual invocation is workspace DATA (a
 * `gates.yml` `testPass[].command`).
 */
function makeTestPassGate(command: string, _label: string, gateConfig?: GateConfig): GateFn {
  return async () => {
    if (typeof command !== "string" || command.trim() === "") {
      return { ok: false, reason: "no test command configured (set gates.yml testPass[].command)" };
    }
    const { cwd, timeoutMs } = resolveRunnerOptions(gateConfig);
    const { ok, reason } = runAcceptance({ command, cwd, timeoutMs });
    return { ok, reason };
  };
}

interface SpawnCaptureResult {
  output: string;
  timedOut: boolean;
  error: string | null;
}

/**
 * Run `command` in `cwd` capturing combined stdout+stderr text (unlike
 * `runAcceptance`, which reports only ok/reason/code — `coverage-floor` needs
 * the actual output text to extract a number from). Kept as a tiny sibling
 * rather than changing `runAcceptance`'s return shape (would ripple through
 * every existing caller of that shared, load-bearing function).
 */
function spawnSyncCapture(command: string, cwd: string, timeoutMs: number): SpawnCaptureResult {
  const r = spawnSync(command, {
    cwd,
    shell: true,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.error && (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
    return { output: "", timedOut: true, error: null };
  }
  if (r.error) {
    return { output: "", timedOut: false, error: r.error.message };
  }
  return { output: `${r.stdout ?? ""}\n${r.stderr ?? ""}`, timedOut: false, error: null };
}

/**
 * `coverage-floor` — run a workspace-configured coverage command, extract a
 * numeric coverage percentage from its stdout via a workspace-configured
 * regex (default matches a bare `NN(.N)%` — the lowest-common-denominator
 * shape most coverage tool summary lines share, e.g. "... 87.5% ...", without
 * naming any one tool's report format), and PASS iff the extracted number is
 * `>= floor`. The extraction PATTERN itself is workspace config too (an
 * optional `pattern` — a JS regex source string with one capture group for
 * the number), so a workspace whose coverage tool prints an unusual line
 * shape can supply its own pattern without touching this module — the
 * default only covers the common case, it is not a parser for any specific
 * tool's report format.
 *
 * Fails closed (same discipline as the other factories) when: the command is
 * unset, the command errors/times out, or its output does not contain a
 * number matching the pattern at all (an unparsable coverage report must
 * never silently PASS).
 */
function makeCoverageFloorGate(command: string, floor: number, pattern: string | undefined, _label: string, gateConfig?: GateConfig): GateFn {
  return async () => {
    if (typeof command !== "string" || command.trim() === "") {
      return { ok: false, reason: "no coverage command configured (set gates.yml coverageFloor[].command)" };
    }
    if (typeof floor !== "number" || Number.isNaN(floor)) {
      return { ok: false, reason: "no coverage floor configured (set gates.yml coverageFloor[].floor, a number 0-100)" };
    }
    const { cwd, timeoutMs } = resolveRunnerOptions(gateConfig);
    const r = spawnSyncCapture(command, cwd, timeoutMs);
    if (r.timedOut) return { ok: false, reason: `coverage command timed out after ${timeoutMs}ms (killed) — raise gates.yml timeoutMs / --timeout` };
    if (r.error) return { ok: false, reason: `coverage command failed to spawn: ${r.error}` };
    const re = new RegExp(pattern && pattern.trim() !== "" ? pattern : "([\\d.]+)\\s*%");
    const m = re.exec(r.output);
    if (!m || m[1] === undefined) {
      return {
        ok: false,
        reason: `could not find a coverage percentage in command output (pattern ${JSON.stringify(re.source)} matched nothing)`,
      };
    }
    const actual = Number(m[1]);
    if (Number.isNaN(actual)) {
      return { ok: false, reason: `matched coverage value ${JSON.stringify(m[1])} is not a number` };
    }
    const ok = actual >= floor;
    return {
      ok,
      reason: ok
        ? `coverage ${actual}% >= floor ${floor}%`
        : `coverage ${actual}% below floor ${floor}%`,
    };
  };
}

/**
 * `red-green` — the reusable RED->GREEN evidence-shape check, parameterized
 * by TWO workspace-configured commands rather than any one runner: `red`
 * (expected to FAIL — the pre-fix/failing-test state) and `green` (expected
 * to PASS — the post-fix state). PASS iff `red` exits non-zero AND `green`
 * exits 0 — a mechanical proof that a real RED->GREEN transition happened,
 * not an assertion of it (ADR-001's evidence bar, generalized so any
 * workspace's own test-runner-shaped RED->GREEN pair can be checked this
 * same way, without naming a specific tool here).
 *
 * Fails closed when either command is unset, or when `red` unexpectedly
 * PASSES (there was no real red state to fix) or `green` FAILS (the fix
 * doesn't actually land) — either condition means the RED->GREEN claim is
 * not evidenced.
 */
function makeRedGreenGate(redCommand: string, greenCommand: string, _label: string, gateConfig?: GateConfig): GateFn {
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

/**
 * D1 — document-as-contract enforcement: the SAME
 * "continuously applied" shape as `makeAdrGate`, but for the NEW `document`
 * object kind (document-store.js, Stage 2) rather than an ADR. Unlike
 * `makeAdrGate`, this does NOT shell out via `runAcceptance` — a document's
 * `contracts` check the document's OWN live body content in-process
 * (`contract-validator.js#validateContracts`, Stage 3), so there is no
 * external command to run; the validation itself is synchronous, but the
 * gate fn is still declared `async` to match the `(task, client) =>
 * Promise<{ok, reason}>` contract every other gate in this registry follows
 * (`engine.js` always `await`s the gate fn — Node/JS awaits a non-Promise
 * value fine, so this is a documentation-only note per the plan-check, not a
 * required code change).
 *
 * Fails closed (same discipline as `makeAdrGate`) when the document is
 * missing or has no (or empty) `contracts` — an unenforceable document must
 * never silently PASS, mirroring an ADR with no `enforcement` command.
 */
function makeDocumentContractGate(docId: string, docDir: string): GateFn {
  return async (_task: Task) => {
    const store = createDocumentStore(docDir);
    const doc = store.get(docId);
    if (!doc) {
      return { ok: false, reason: `no such document: ${docId}` };
    }
    if (!Array.isArray(doc.contracts) || doc.contracts.length === 0) {
      return {
        ok: false,
        reason: `${docId} has no contracts defined (set its \`contracts:\` frontmatter field to a non-empty list of self-checks)`,
      };
    }
    const { ok, results } = validateContracts(doc);
    if (ok) return { ok: true, reason: `all ${results.length} contract(s) passed` };
    const failed = results.filter((r: { ok: boolean; reason?: string; pattern?: string; type?: string }) => !r.ok);
    const reason = failed
      .map((r: { ok: boolean; reason?: string; pattern?: string; type?: string }) => r.reason ?? `pattern ${JSON.stringify(r.pattern)} (${r.type}) failed`)
      .join("; ");
    return { ok: false, reason };
  };
}

/**
 * Register a `doc-<name>` gate for a given document id + directory. Exported
 * so tests can register throwaway fixture gates the SAME way the module's
 * own DOCUMENT_GATE_IDS-driven loop below does (mirrors E3's own precedent of
 * exercising `makeAdrGate`'s logic against fixture dirs, but here proves the
 * exact registered code path via a real dynamically-added gate name).
 */
export function registerDocumentGate(gateName: string, docDir: string, docId: string): void {
  gateRegistry[gateName] = makeDocumentContractGate(docId, docDir);
}

const DOCUMENTS_DIR = path.join(REPO_ROOT, "docs-managed");

// D1: declarative table of which managed documents are wired as gates so far
// — `{gateName, docId}` pairs, one real wired case landed in Stage 5 (the
// retrofitted quay-directive skill doc). Unlike the retired ADR_GATE_IDS /
// the 5 it0-script constants, this table is genuinely product-owned (the
// document store + gate factory ship as product code, and DOC-001 is the
// product's OWN quay-directive skill doc, not research-loop data) — see the
// D1 milestone task for the original rationale. Left baked in by design.
const DOCUMENT_GATE_IDS: Array<{ gateName: string; docId: string }> = [
  { gateName: "doc-quay-directive-skill", docId: "DOC-001" },
];

/**
 * name -> async (task, client) => { ok: boolean, reason: string }
 */
export const gateRegistry: Record<string, GateFn> = {
  dod: async (task: Task, client: unknown) => {
    const r = await (client as { taskCheck: (id: string) => Promise<{ ok: boolean; reason: string }> }).taskCheck(task.id); // reuse store.js#check() — no duplicate logic
    return { ok: r.ok === true, reason: r.reason };
  },
  acceptance: async (task: Task) => {
    const command = (task.extra as Record<string, unknown>)?.acceptance;
    // Fail-closed: an unset/empty meter under the default gate would let
    // unverified work slip through — the exact hole QENG-2 closes (proposal Risks).
    if (typeof command !== "string" || command.trim() === "") {
      return {
        ok: false,
        reason: "no acceptance command defined (set with `quay task edit <id> --acceptance '<cmd>'`)",
      };
    }
    const { cwd, timeoutMs } = resolveRunnerOptions();
    const { ok, reason } = runAcceptance({ command, cwd, timeoutMs });
    return { ok, reason };
  },
  // NOTE — deliberately NOT registered here (M43 SELECT-time re-derivation,
  // see the DIR-022-remainder milestone task's `## Proposal` for the full
  // rationale):
  //   * `escrow-delta-v` / `test-floor` — these are NOT standalone scripts;
  //     they are Clauses 6/7 INSIDE `it0-dod-check.mjs`, already run (and
  //     gated) via the `dod` gate above. A separate named gate would either
  //     re-invoke the same script with a non-existent "run only clause 6/7"
  //     flag, or duplicate the text-scanning logic — both violate this
  //     task's own single-source DoD requirement. `dod` already covers them.
  //   * `audit` — already exists as a GateEvent NAME via `quay adjudicate`
  //     (`lifecycle.js#runAdjudicate`, wraps `taskCheck`), which is a
  //     DIFFERENT check than this project's per-milestone adversarial-audit
  //     narrative (OUTER-LOOP.md step 6). Adding a second `gateRegistry.audit`
  //     entry here would collide with that existing name under a different
  //     meaning; this project's per-milestone audit itself has no single mechanical
  //     script to wrap (it is a dispatched subagent's refute-first read of
  //     AC/DoD, not a fixed command) — there is nothing to wrap without
  //     inventing a synthetic pass/fail script that doesn't reflect the real
  //     audit's actual judgment. Left unregistered by design, not omitted by
  //     oversight.
};

// D1: register one `doc-<name>` gate per DOCUMENT_GATE_IDS entry — same shape
// as the (now-retired) module-level ADR loop used to have, via the exported
// `registerDocumentGate` helper so tests exercise the exact same code path.
for (const { gateName, docId } of DOCUMENT_GATE_IDS) {
  registerDocumentGate(gateName, DOCUMENTS_DIR, docId);
}

/**
 * DIR-035-B: locate this process's workspace root the SAME way `config.js`'s
 * `findConfig` does (walk up from `startDir` for `.quay/config.yml`), so gate
 * discovery works both from a real CLI invocation (cwd = workspaceRoot, per
 * `withProvider`'s own resolution) and from an in-process test/module caller
 * that never constructed a `cfg` object (e.g. this repo's own existing
 * `listGates()`/`gateRegistry[...]` unit tests, which run with cwd =
 * `packages/quay` — three levels below this repo's own `.quay/config.yml`).
 *
 * Returns `null` (never throws) when no `.quay/config.yml` is found upward
 * from `startDir` — a bare `node -e "require(...)"` outside any workspace
 * simply sees the built-ins only, exactly like a fresh workspace with an
 * empty `gates.yml`.
 */
function discoverWorkspaceRoot(startDir: string = process.cwd()): string | null {
  const configPath = findConfig(startDir);
  if (!configPath) return null;
  // configPath is <workspaceRoot>/.quay/config.yml
  return path.dirname(path.dirname(configPath));
}

interface It0Entry {
  name: string;
  script: string;
  argsKey: string;
  cwd?: string;
  timeoutMs?: number;
}

interface FixedEntry {
  name: string;
  script: string;
  cwd?: string;
  timeoutMs?: number;
}

interface TestPassEntry {
  name: string;
  command: string;
  cwd?: string;
  timeoutMs?: number;
}

interface CoverageFloorEntry {
  name: string;
  command: string;
  floor: number;
  pattern?: string;
  cwd?: string;
  timeoutMs?: number;
}

interface RedGreenEntry {
  name: string;
  red: string;
  green: string;
  cwd?: string;
  timeoutMs?: number;
}

interface GatesConfig {
  it0: It0Entry[];
  adr: string[];
  fixed: FixedEntry[];
  testPass: TestPassEntry[];
  coverageFloor: CoverageFloorEntry[];
  redGreen: RedGreenEntry[];
}

/**
 * Read `<workspaceRoot>/.quay/gates.yml` (if present) and return its parsed
 * `{it0, adr, fixed, testPass, coverageFloor, redGreen}` shape. Missing file
 * / unparsable YAML / missing keys all degrade to all-empty-arrays
 * (fail-quiet, not fail-closed here — an ABSENT gates.yml is the
 * fresh-workspace default, not an error condition; the gates it WOULD have
 * declared simply don't exist, which is the whole point of AC3).
 *
 * `fixed` (DIR-035-D) — zero-argument scripts wired via `makeFixedScriptGate`
 * (e.g. `delivery-standalone-smoke.sh`), parallel to `it0` but with no
 * `argsKey` (the script takes no positional args at all).
 *
 * `testPass` / `coverageFloor` / `redGreen` (DIR-042-A) — the generic
 * runner-agnostic DoD gate SET: each entry supplies its own COMMAND (+
 * threshold/pattern for `coverageFloor`, + a `red`/`green` command pair for
 * `redGreen`) as pure workspace data — see `makeTestPassGate` /
 * `makeCoverageFloorGate` / `makeRedGreenGate` above for the exact contract.
 *
 * DIR-046-A/B: `it0`/`fixed`/`testPass`/`coverageFloor`/`redGreen` entries may
 * ALSO carry optional `cwd`/`timeoutMs` fields — this gate's own workspace-
 * declared cwd override / time budget, applied via `resolveRunnerOptions`
 * (env var > gates.yml entry > default), see that function's own doc comment
 * for the full precedence rule.
 */
function readGatesConfig(workspaceRoot: string): GatesConfig {
  const empty: GatesConfig = { it0: [], adr: [], fixed: [], testPass: [], coverageFloor: [], redGreen: [] };
  if (!workspaceRoot) return empty;

  // DIR-050: try unified .quay/config.yml (gates: section) first, fall back to .quay/gates.yml
  const unifiedConfigPath = path.join(workspaceRoot, ".quay", "config.yml");
  const legacyGatesPath = path.join(workspaceRoot, ".quay", "gates.yml");

  let parsed: unknown;
  if (fs.existsSync(unifiedConfigPath)) {
    let unified: unknown;
    try {
      unified = YAML.parse(fs.readFileSync(unifiedConfigPath, "utf8"));
    } catch {
      // malformed unified config -> fall through to legacy
    }
    if (unified && typeof unified === "object" && "gates" in unified) {
      parsed = (unified as Record<string, unknown>).gates;
    }
  }
  if (parsed === undefined) {
    if (!fs.existsSync(legacyGatesPath)) return empty;
    try {
      parsed = YAML.parse(fs.readFileSync(legacyGatesPath, "utf8"));
    } catch {
      return empty; // malformed gates.yml -> no workspace gates, not a hard crash
    }
  }
  const it0 = Array.isArray((parsed as Record<string, unknown>)?.it0) ? (parsed as Record<string, unknown>).it0 as It0Entry[] : [];
  const adr = Array.isArray((parsed as Record<string, unknown>)?.adr) ? (parsed as Record<string, unknown>).adr as string[] : [];
  const fixed = Array.isArray((parsed as Record<string, unknown>)?.fixed) ? (parsed as Record<string, unknown>).fixed as FixedEntry[] : [];
  const testPass = Array.isArray((parsed as Record<string, unknown>)?.testPass) ? (parsed as Record<string, unknown>).testPass as TestPassEntry[] : [];
  const coverageFloor = Array.isArray((parsed as Record<string, unknown>)?.coverageFloor) ? (parsed as Record<string, unknown>).coverageFloor as CoverageFloorEntry[] : [];
  const redGreen = Array.isArray((parsed as Record<string, unknown>)?.redGreen) ? (parsed as Record<string, unknown>).redGreen as RedGreenEntry[] : [];
  return { it0, adr, fixed, testPass, coverageFloor, redGreen };
}

/**
 * Build the WORKSPACE-DATA-DRIVEN gate set for `workspaceRoot`: one
 * `makeIt0Gate` per `gates.yml`'s `it0[]` entry (script path resolved
 * relative to `workspaceRoot`), one `makeAdrGate` per `gates.yml`'s `adr[]`
 * entry (lowercased, e.g. "ADR-001" -> "adr-001", per the original E3 AC1
 * naming convention — unchanged), one `makeFixedScriptGate` per `gates.yml`'s
 * `fixed[]` entry (DIR-035-D — a zero-argument script, e.g.
 * `delivery-standalone-smoke.sh`), plus (DIR-042-A) one `makeTestPassGate`
 * per `testPass[]` entry, one `makeCoverageFloorGate` per `coverageFloor[]`
 * entry, and one `makeRedGreenGate` per `redGreen[]` entry — the generic DoD
 * gate SET, each entry's actual command(s)/threshold coming straight from
 * this workspace's own `gates.yml` data. The ADR store dir mirrors this
 * workspace's own native-provider convention (`QUAY_NATIVE_ADR_DIR`,
 * `.quay/config.yml`'s `providers.native.env`), falling back to
 * `<workspaceRoot>/adr` when unset — the same default quay-native itself uses.
 *
 * Returns `{}` for a workspace with no `gates.yml` (or an empty one) — the
 * fresh non-research workspace case (AC3).
 */
export function loadWorkspaceGates(workspaceRoot: string | null): Record<string, GateFn> {
  if (!workspaceRoot) return {};
  const { it0, adr, fixed, testPass, coverageFloor, redGreen } = readGatesConfig(workspaceRoot);
  const gates: Record<string, GateFn> = {};
  // DIR-046-B: pull each entry's own optional `cwd`/`timeoutMs` gates.yml
  // fields into a `{cwd, timeoutMs}` gateConfig, resolved relative to
  // workspaceRoot for a relative `cwd` (mirrors how a relative `script` path
  // is resolved just below) so a workspace can declare a worktree-relative
  // path without needing to know its own absolute location.
  const gateConfigOf = (entry: GateConfig & { cwd?: string; timeoutMs?: number }): GateConfig => {
    const cwd = typeof entry?.cwd === "string" && entry.cwd.trim() !== ""
      ? (path.isAbsolute(entry.cwd) ? entry.cwd : path.resolve(workspaceRoot, entry.cwd))
      : undefined;
    const timeoutMs = typeof entry?.timeoutMs === "number" && entry.timeoutMs > 0 ? entry.timeoutMs : undefined;
    return { cwd, timeoutMs };
  };
  for (const entry of it0) {
    if (!entry?.name || !entry?.script || !entry?.argsKey) continue;
    const scriptPath = path.isAbsolute(entry.script)
      ? entry.script
      : path.resolve(workspaceRoot, entry.script);
    gates[entry.name] = makeIt0Gate(scriptPath, entry.argsKey, entry.name, gateConfigOf(entry));
  }
  const adrDir = path.join(workspaceRoot, "adr");
  for (const adrId of adr) {
    if (typeof adrId !== "string" || adrId.trim() === "") continue;
    gates[adrId.toLowerCase()] = makeAdrGate(adrId, adrDir);
  }
  for (const entry of fixed) {
    if (!entry?.name || !entry?.script) continue;
    const scriptPath = path.isAbsolute(entry.script)
      ? entry.script
      : path.resolve(workspaceRoot, entry.script);
    gates[entry.name] = makeFixedScriptGate(scriptPath, entry.name, gateConfigOf(entry));
  }
  for (const entry of testPass) {
    if (!entry?.name || typeof entry?.command !== "string") continue;
    gates[entry.name] = makeTestPassGate(entry.command, entry.name, gateConfigOf(entry));
  }
  for (const entry of coverageFloor) {
    if (!entry?.name || typeof entry?.command !== "string" || typeof entry?.floor !== "number") continue;
    gates[entry.name] = makeCoverageFloorGate(entry.command, entry.floor, entry.pattern, entry.name, gateConfigOf(entry));
  }
  for (const entry of redGreen) {
    if (!entry?.name || typeof entry?.red !== "string" || typeof entry?.green !== "string") continue;
    gates[entry.name] = makeRedGreenGate(entry.red, entry.green, entry.name, gateConfigOf(entry));
  }
  return gates;
}

/**
 * Resolve a gate function by name for `workspaceRoot` — the single lookup
 * point used by both `listGates` and the engine (`engine.js#runGate`). Checks
 * the product's own baked-in `gateRegistry` FIRST (built-ins + doc-* gates
 * always win a name collision, since they are the stable, product-owned
 * surface), then falls back to this workspace's own `gates.yml`-declared
 * gates. `workspaceRoot` defaults to `discoverWorkspaceRoot()` when omitted,
 * so existing in-process callers (module-level `gateRegistry[name]` access,
 * and this repo's own unit tests) keep resolving this repo's real gates
 * without change, as long as they run with a cwd under this repo.
 */
export function resolveGate(name: string, workspaceRoot: string | null = discoverWorkspaceRoot()): GateFn | undefined {
  if (gateRegistry[name]) return gateRegistry[name];
  return loadWorkspaceGates(workspaceRoot)[name];
}

/**
 * @param workspaceRoot defaults to `discoverWorkspaceRoot()`
 * @returns registered gate names (built-ins + this workspace's own `gates.yml`-declared gates)
 */
export function listGates(workspaceRoot: string | null = discoverWorkspaceRoot()): string[] {
  return [...Object.keys(gateRegistry), ...Object.keys(loadWorkspaceGates(workspaceRoot))];
}
