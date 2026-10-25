// cli/goal.ts — `quay goal` command handler (goal + AC records, provider-backed —
// SPEC-goal-mechanism-2026-09-06.md §5.2). Reads/writes goals through the Provider
// ABI (`client.goalList` / `client.goalGet` / `client.goalWrite`), never the store
// directly — the store lives in quay-native; Core keeps only the view-model + shim.
// Mirrors cli/adr.ts's `withProvider` shape (the same per-invocation context + flags).
//
// ⚠️ ONE deliberate exception, added by gap-ac262-goal-meta-driver-spawn-core-src-absent-from-plugin-cache:
// `gate` / `check` / `batch` (and a `write` that asks for a store-only flag) delegate to the goal
// store's OWN CLI dispatch — see the "store-level verbs" block below for why the ABI cannot carry
// them and why restating the dialect here would be the wrong fix. `list` / `show` / plain `write`
// keep the provider-agnostic ABI path above, unchanged.

import path from "node:path";
import fs from "node:fs";
import { withProvider, printJson } from "./shared.ts";
import type { CliCtx } from "./context.ts";
import type { CliFlags } from "./flags.ts";
import type { GoalRecord } from "../abi.ts";
import { runGoalStoreCli } from "../core/goal-store.ts";
import { loadConfig } from "../config.ts";
import { resolveWorkspaceRootOrThrow } from "../gate/config/loader.ts";

/**
 * AC2 — the staleness marker for a GOAL row's TEXT rendering
 * (gap-goal-status-stale-achieved-after-new-active-criterion-filed).
 *
 * THE DEFECT IT RENDERS: a GOAL whose `status` is `achieved` while a new undischarged criterion has
 * since been filed under it used to print EXACTLY the same `achieved` token as a genuinely closed
 * GOAL. A reader had no field that told the two apart. So the marker is appended to the status
 * token itself — ⛔ not as an optional extra column a reader can skip past.
 *
 * THREE-STATE, ⛔ never a boolean (hard rule 3b):
 *   clean         → ""                        (byte-identical to the pre-change output)
 *   stale         → "(⚠️stale:n=<N>)"         (N ENUMERATED — "how many", not just "something")
 *   not-evaluated → "(⚠️stale:NOT-EVALUATED)"  (an INSTRUMENT failure — deliberately a different
 *                                              string from both, so "could not read the carrier"
 *                                              can never be mistaken for "read it, nothing there")
 *
 * Applies to `status: achieved` GOAL rows ONLY: the field answers 「is this GOAL's `achieved` still
 * earned」, a question with no subject on a GOAL that is not claiming to be closed.
 */
export function goalStalenessMark(g: GoalRecord): string {
  const s = g.staleness;
  if (!s || g.status !== "achieved") return "";
  if (s.state === "stale") return `(⚠️stale:n=${s.signals?.length ?? 0})`;
  if (s.state === "not-evaluated") return "(⚠️stale:NOT-EVALUATED)";
  return "";
}

// ── the incremental / thin read surfaces (gap-goal-list-no-thin-projection-no-since) ──────────────
//
// WHY THIS LIVES IN THE CLI, NOT IN THE PROVIDER (DoD): the ABI's `GoalRecord` is the PROVIDER's
// contract. `quay goal list --json` returns that whole view-model — `body` / `criterion` / `expect`
// / `origin` / `statusLog` included — and an external read-only consumer (a workspace title-bar
// panel) that needs only `{id,title,status,kind,goal,updatedAt}` paid 786ms / 1.28MB for 397 rows.
// The projection is the CALLER's choice of fields, so it is applied here, after the ABI read; the
// ABI shape is untouched.
//
// ⛔ The thin field set is ENUMERATED (allow-list), never "drop these four keys": a provider that
// later grows a field must not silently start leaking it through the thin surface (hard rule 3b —
// "the set I promised" cannot be expressed as a subtraction from a set I do not control).

/** The thin projection's COMPLETE field list (AC1). `goal` is absent on GOAL rows BY SHAPE (a GOAL
 *  carries no owning-goal pointer), and `updatedAt` is absent only when the carrier's mtime could
 *  not be read — both are omitted rather than emitted as a `null` placeholder. */
const THIN_LIST_FIELDS = ["id", "title", "status", "kind", "goal", "updatedAt"] as const;

/** One append-only status transition, as the goal store writes it
 *  (core/goal-store.ts `statusLog: [{at,from,to,actor,reason}]`). Declared LOCALLY: `statusLog` is
 *  part of the provider's read surface (`toViewModel` returns it) but is deliberately NOT a field of
 *  the ABI's `GoalRecord` — so the CLI types it here instead of widening the ABI shape (DoD). */
type StatusLogEntry = { at?: string; from?: string; to?: string; actor?: string; reason?: string };
type GoalReadRecord = GoalRecord & { statusLog?: StatusLogEntry[] };

/** The merged `goal log` row (AC3): one statusLog entry, carrying the record it belongs to. */
type MergedStatusEntry = {
  id: string;
  goal: string | null;
  kind: string | null;
  at: string;
  from: string | null;
  to: string | null;
  actor: string | null;
  reason: string | null;
};

/**
 * `--since <ISO8601|epoch-ms>` (AC2). ⛔ Not `task-log.ts`'s `parseSinceArg`: that one accepts an
 * ISO instant OR a page CURSOR (`quay task log` is paged over the task carrier); a goal record's
 * time is its file mtime, so the goal surfaces accept an ISO instant or the raw epoch-ms reading
 * `updatedAt` itself prints — a consumer can feed back the exact number it just read, with no
 * round-trip through a date formatter that could shift by a timezone.
 */
function parseGoalSince(name: string, raw: unknown): { ms: number | null; error: string | null } {
  const usage = `--${name} requires a value (an ISO-8601 instant or epoch milliseconds)`;
  if (raw === true) return { ms: null, error: usage };
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ms: null, error: `${usage}, got ${JSON.stringify(raw)}` };
  }
  const t = raw.trim();
  const ms = /^-?\d+$/.test(t) ? Number(t) : Date.parse(t);
  if (!Number.isFinite(ms)) {
    return { ms: null, error: `--${name} ${JSON.stringify(raw)} is neither a parseable ISO-8601 instant nor epoch milliseconds` };
  }
  return { ms, error: null };
}

/** The thin projection (AC1). `--with-status-log` opts the transition history BACK IN — the one
 *  field a consumer that wants history needs — because history has its own read surface
 *  (`goal log`) and a list read should not carry it by default. */
function thinGoalRecord(g: GoalReadRecord, withStatusLog: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of THIN_LIST_FIELDS) {
    const v = (g as unknown as Record<string, unknown>)[key];
    if (v !== undefined) out[key] = v;
  }
  if (withStatusLog && Array.isArray(g.statusLog)) out.statusLog = g.statusLog;
  return out;
}

/**
 * `--since` on a LIST read: is this record at/after the instant? `updatedAt` is the carrier file's
 * mtime, and a git checkout/merge only ever makes it NEWER — so filtering on it can OVER-report but
 * never under-report, which is the safe direction for a "what changed" feed (the task's own
 * finding). A record whose mtime could not be read has NO place in time: it is INCLUDED (same
 * over-reporting direction) rather than silently dropped, which would masquerade as "unchanged"
 * (hard rules 3b/6).
 */
function updatedAtOrAfter(g: GoalReadRecord, sinceMs: number): boolean {
  const t = typeof g.updatedAt === "number" && Number.isFinite(g.updatedAt) ? g.updatedAt : null;
  return t === null ? true : t >= sinceMs;
}

/** Same direction rule for `goal log`'s `--since`, applied to a transition's own `at` instant. */
function statusAtOrAfter(at: string, sinceMs: number): boolean {
  const t = Date.parse(at);
  return Number.isFinite(t) ? t >= sinceMs : true;
}

/**
 * THE ONE statusLog merge (DoD: "只有一个实现，⛔ 不新增第二套 statusLog 解析").
 * Every record's own `statusLog` is concatenated and ordered by `at` ascending. The per-record log
 * stays the single source of truth — this adds no second carrier, no derivation, no re-parsing.
 * `goal` is the owning GOAL on an AC row and `null` on a GOAL row (a GOAL has no owner).
 */
function mergeStatusLog(records: GoalReadRecord[]): MergedStatusEntry[] {
  const out: MergedStatusEntry[] = [];
  for (const g of records) {
    if (!Array.isArray(g.statusLog)) continue;
    for (const e of g.statusLog) {
      const at = typeof e?.at === "string" ? e.at : "";
      out.push({
        id: String(g.id),
        goal: typeof g.goal === "string" ? g.goal : null,
        kind: typeof g.kind === "string" ? g.kind : null,
        at,
        from: typeof e?.from === "string" ? e.from : null,
        to: typeof e?.to === "string" ? e.to : null,
        actor: typeof e?.actor === "string" ? e.actor : null,
        reason: typeof e?.reason === "string" ? e.reason : null,
      });
    }
  }
  const instant = (at: string): number => {
    const t = Date.parse(at);
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
  };
  out.sort((a, b) => {
    const ta = instant(a.at);
    const tb = instant(b.at);
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.id.localeCompare(b.id); // stable tie-break: same-instant transitions stay grouped
  });
  return out;
}

// ── the carrier three-state for an incremental read (AC4) ─────────────────────────────────────────
//
// THE DEFECT THIS CLOSES: a missing `goals/` directory reads as an EMPTY ARRAY — indistinguishable
// from "read the carrier, there were no changes". That is exactly the confusion an incremental
// (`--since`) feed must not make (hard rule 3b). The store itself cannot answer the question: its
// constructor `mkdirSync`s the directory, so by the time a provider call returns, "missing" has
// already been rewritten into "empty". ⇒ The CLI probes the CARRIER DIRECTORY BEFORE it connects to
// the provider (once connected, the provider process has created the directory).
//
// THREE VALUES, never a boolean: `present` / `not-declared` / `not-evaluated`. `not-declared` is a
// provider that declares no local carrier layout at all (a non-native provider — e.g. the GitHub
// stub, whose `goal_list` answer is the only reading there is): it is ⛔ NOT "present" (that would
// claim a check happened) and ⛔ NOT "not-evaluated" (that would fail a provider which never had a
// local directory to begin with).

type GoalCarrierProbe =
  | { state: "present"; dir: string }
  | { state: "not-declared" }
  | { state: "not-evaluated"; dir: string; reason: string };

/**
 * The carrier directory a provider's config DECLARES, resolved the same way the provider resolves
 * it (`packages/quay-native/src/carrier-dirs.ts`): `QUAY_NATIVE_GOAL_DIR` when declared, else the
 * `goals/` sibling of the resolved tasks dir, else `<workspaceRoot>/goals` (the default the
 * provider and `quay init` share). `null` when the active provider entry declares NO tasks dir and
 * no carrier env at all — i.e. there is no local layout to judge.
 */
function declaredGoalCarrierDir(workspaceRoot: string, config: unknown, providerId?: string): string | null {
  // `config` is the parsed `.quay/config.yml` (untyped by construction — same `any` discipline as
  // the CLI's own flag bag); only the four declared keys below are read.
  const cfg = (config && typeof config === "object" ? config : {}) as Record<string, any>;
  const providers: Record<string, any> =
    cfg.providers && typeof cfg.providers === "object" ? cfg.providers : {};
  const id = providerId ?? Object.keys(providers).find((pid) => providers[pid]?.enabled);
  const entry = id ? providers[id] : undefined;
  const env = entry && typeof entry.env === "object" && entry.env !== null
    ? (entry.env as Record<string, unknown>)
    : {};
  const envString = (k: string): string | null => (typeof env[k] === "string" && (env[k] as string).trim() !== "" ? (env[k] as string) : null);
  // process.env is the same knob the provider process inherits; honour it here so a workspace that
  // pins the carrier only in its shell (no config entry) is still judged on the right directory.
  const processEnvString = (k: string): string | null =>
    typeof process.env[k] === "string" && (process.env[k] as string).trim() !== "" ? (process.env[k] as string) : null;
  const goalEnv = envString("QUAY_NATIVE_GOAL_DIR") ?? processEnvString("QUAY_NATIVE_GOAL_DIR");
  if (goalEnv) return path.resolve(workspaceRoot, goalEnv);
  const tasks = (typeof entry?.tasks_dir === "string" && entry.tasks_dir.trim() !== "" ? entry.tasks_dir : null)
    ?? envString("QUAY_NATIVE_TASKS_DIR")
    ?? processEnvString("QUAY_NATIVE_TASKS_DIR");
  if (!tasks) return null;
  return path.join(path.dirname(path.resolve(workspaceRoot, tasks)), "goals");
}

/** Probe the carrier BEFORE the provider is connected (see the block comment above). A config that
 *  cannot be loaded is `not-declared`: the provider path owns that error — it is reported once, by
 *  `withProvider`, in its established shape, ⛔ never restated as a "not-evaluated" reading here. */
function probeGoalCarrier(flags: CliFlags): GoalCarrierProbe {
  let cfg;
  try {
    cfg = flags.root ? loadConfig(resolveWorkspaceRootOrThrow(flags.root)) : loadConfig();
  } catch {
    return { state: "not-declared" };
  }
  const providerId = typeof flags.provider === "string" ? flags.provider : undefined;
  const dir = declaredGoalCarrierDir(cfg.workspaceRoot, cfg.config, providerId);
  if (!dir) return { state: "not-declared" };
  try {
    fs.readdirSync(dir);
    return { state: "present", dir };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code ?? "UNKNOWN";
    return {
      state: "not-evaluated",
      dir,
      reason: code === "ENOENT"
        ? `goal carrier directory does not exist: ${dir}`
        : `goal carrier directory is unreadable (${code}): ${dir}`,
    };
  }
}

/** AC4's output shape: `evaluated:false` on the machine channel AND a distinct exit code (3 — the
 *  goal mechanism's own NOT-EVALUATED code, see `goal check --stale-pass`), so neither a JSON reader
 *  nor a shell reader can mistake "could not read the carrier" for "read it, nothing changed". */
function emitGoalReadNotEvaluated(reason: string, wantsJson: boolean): void {
  if (wantsJson) printJson({ evaluated: false, reason });
  console.error(`goal read NOT-EVALUATED: ${reason}`);
  process.exitCode = 3;
}

// ── store-level verbs: gate / check / batch (+ the store-only flags of `write`) ────────────────────
//
// WHY THESE DELEGATE (gap-ac262-goal-meta-driver-spawn-core-src-absent-from-plugin-cache):
// goal-driver / meta-driver drive the goal mechanism by SPAWNING one command per record read,
// criterion run and status flip, and they read the EXIT CODE as a verdict — `gate` = 0 pass /
// 1 fail / 2 usage, `check --stale-pass` = 0 clean / 1 violated / 3 not-evaluated. Those codes,
// the flag grammar and the stdout JSON are therefore a CONTRACT, not a presentation choice. The
// drivers used to spawn `<quayCodeRoot>/packages/quay/src/goal-store.ts` directly, which does not
// exist in an installed layout (plugin marketplace cache / npm-pack / third-party vendored copy —
// the store is present only as a LIBRARY inlined into the driver bundle, whose `isMain` guard is
// false, so its CLI dispatch is unreachable). They now spawn `quay goal gate|check|batch|write`
// instead, and these verbs hand the argv to the store's OWN dispatch (`runGoalStoreCli`) rather
// than restating it: ⛔ a second implementation of the exit codes the driver reads as verdicts is
// precisely the drift class this repo keeps removing (硬规则 5b).
//
// The store-only `write` flags take the same path for the same reason: `--actor`, `--reason`,
// `--force`, `--dry-run`, `--long-term`, `--expect-absent` / `--expect-existing`, `--dispose-old`
// / `--dispose-to`, `--fidelity-judge-argv` and `--supersedes` are goal-STORE semantics with no field in the
// Provider ABI's `goal_write` view-model. Forwarding them through the ABI would DROP them silently
// — and `--actor` is load-bearing (it is recorded in the status log and it is the actor handed to
// `resolveGoalStaleness` on a transition back into `active`), as is `--fidelity-judge-argv` (the
// activation gate). So an invocation that asks for any of them runs where they exist. An
// invocation that does not keeps the provider-agnostic ABI path (unchanged).

/** `write` flags the Provider ABI cannot carry — presence of any of them routes the write to the
 *  goal store itself (see the block comment above). Enumerated, ⛔ not a boolean "is it weird".
 *
 *  `supersedes` belongs here for the reason this list exists, and it was measured, not inferred
 *  (gap-meta-driver-proposal-lacks-supersedes-field): without `--store` an invocation carrying it
 *  printed `wrote AC-008` and exited 0 while the field never reached the file — the silent-drop
 *  failure this comment names, on a field whose whole purpose is to record a declaration. The ABI
 *  `goal_write` view-model has no `supersedes` (it carries `superseded_by`, a different field with
 *  different semantics: that one says "I was replaced", and `write()` only acts on it for GOALs). */
const STORE_ONLY_WRITE_FLAGS = [
  "actor", "reason", "force", "dry-run", "long-term",
  "expect-absent", "expect-existing", "dispose-old", "dispose-to", "fidelity-judge-argv",
  "supersedes",
  // SPEC-goal-branch §4.1 — the goal-branch opt-in gate. Store-only for the same reason as
  // `long-term`: the ABI `goal_write` view-model has no `branch` field, and forwarding it through
  // the ABI would DROP it silently. The branch NAME is derived (`goal/<id>`), ⛔ not a flag.
  "branch",
  // SPEC-goal-branch §4.7 (裁定⑭⑮) — the AC evaluation phase. Store-only for the same reason: the
  // ABI `goal_write` view-model has no `phase` field, so the ABI route would silently drop a
  // `--phase post-merge` and the AC would be evaluated as the default `pre-merge`.
  "phase",
] as const;

/** The goal store's CLI verbs — store-level BY NATURE: they have no Provider ABI counterpart at all
 *  (`gate` writes a GateEvent into the ledger, `check` reads it, `batch` writes N records in one
 *  commit), so there is no other implementation to route them to. */
const STORE_VERBS = new Set(["gate", "check", "batch"]);

/** `--store` — select the goal-store dialect for a verb that ALSO has an ABI form (`list` / `show`
 *  / `write`). ⛔ Not decoration: the ABI route needs a WORKSPACE (`.quay/config.yml` at `--root`,
 *  found by `withProvider`'s `resolveWorkspaceRootOrThrow`), while the store route needs only
 *  `<root>/goals` + `<root>/.quay/gate-events.jsonl`. The goal-driver's per-round reads run on
 *  EXACTLY the config-free shape (its fixtures — and a third-party root before quay-init — are bare
 *  directories), so it asks for the dialect it can actually reach instead of having the CLI guess.
 *  ⛔ The CLI never falls back on its own: a `--root` with no workspace still FAILS CLOSED on the
 *  ABI route (⛔ never silently read `--root/goals` instead — pointing `--root` at the wrong
 *  directory would then render as "(no goals)", i.e. a wrong reading wearing the shape of a real one). */
const STORE_DIALECT_FLAG = "store";

/** The workspace root for a store-level invocation. `--root <dir>` wins; otherwise walk up from the
 *  cwd for the repository root — the same anchor goal-store's own CLI uses (it walks up from its
 *  module's directory), restated here for the cwd case. ⛔ No config lookup: a store-level verb
 *  reads `<root>/goals` + `<root>/.quay/gate-events.jsonl` only, so it must keep working in a bare
 *  checkout with no `.quay/config.yml` (which is exactly the shape goal-driver's fixtures use). */
function storeWorkspaceRoot(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/** Build the goal-store argv for a delegation, ensuring `--root` is explicit.
 *  ⚠️ `sub` must be re-prepended: the Core dispatch consumed it (`[cmd, sub, ...rest]`), while the
 *  store's dispatch reads it as `argv.slice(2)[0]` — dropping it silently shifts the verb away and
 *  the store reports `unknown subcommand "<first flag>"` (observed).
 *  Returns null (and prints a usage error) for a bare `--root` — the same fail-closed shape every
 *  other workspace-scoped command uses (⛔ never a silent cwd fallback). */
function storeDelegationArgv(sub: string, rest: string[], flags: CliFlags): string[] | null {
  if (flags.root !== undefined && typeof flags.root !== "string") {
    console.error("Error: --root requires a value (e.g., --root /path/to/workspace)");
    return null;
  }
  // `--store` is a CORE-side dialect selector — the store's own dispatch does not know it, so it
  // must not travel in the delegated argv (for `write`/`check` an unknown flag is a usage error).
  const out = [sub, ...rest.filter((a) => a !== `--${STORE_DIALECT_FLAG}`)];
  if (flags.root === undefined) out.push("--root", storeWorkspaceRoot() as string);
  return ["node", "goal-store", ...out];
}

export async function handleGoal({ sub, positional, flags, wantsJson, rest }: CliCtx) {
  // Store-level verbs (gate / check / batch) — full argv, exit code is the verdict.
  // `write` joins them when the caller asks for a store-only flag the ABI cannot carry.
  const storeOnlyWrite = (sub === "write" || sub === "new") &&
    STORE_ONLY_WRITE_FLAGS.some((f) => flags[f] !== undefined);
  const storeDialect = flags[STORE_DIALECT_FLAG] === true;
  if (sub !== undefined && (STORE_VERBS.has(sub) || storeDialect || storeOnlyWrite)) {
    const argv = storeDelegationArgv(sub, rest ?? [], flags);
    if (argv === null) { process.exitCode = 1; return; }
    process.exitCode = await runGoalStoreCli(argv);
    return;
  }
  if (sub === "merge") {
    // SPEC-goal-branch-2026-10-03 §4.7 (rulings ⑭⑱): the HUMAN merge-request verb. It ⛔ does NOT
    // merge — it records a `goal-merge-request` GateEvent; the worker-driver executes (DIR-131, the
    // task-landing mechanism owns it). Fail-closed refusals live in goal-merge.ts (one definition,
    // shared with the tests), never restated here (硬规则 5b).
    const id = positional[0];
    if (!id) {
      console.error("quay goal merge: usage: quay goal merge <GOAL-NNN> --reason \"<why now>\" [--override \"<why the unmet ACs are acceptable>\"] [--actor <who>] [--root <path>] [--json]");
      process.exitCode = 2;
      return;
    }
    if (flags.root !== undefined && typeof flags.root !== "string") {
      console.error("Error: --root requires a value (e.g., --root /path/to/workspace)");
      process.exitCode = 1;
      return;
    }
    if (typeof flags.reason !== "string" || flags.reason.trim() === "") {
      console.error("quay goal merge: --reason is required (why the goal is mature enough to merge now)");
      process.exitCode = 2;
      return;
    }
    if (flags.override !== undefined && typeof flags.override !== "string") {
      console.error("Error: --override requires a reason string");
      process.exitCode = 2;
      return;
    }
    const root = (flags.root as string | undefined) ?? (storeWorkspaceRoot() as string);
    const { recordGoalMergeRequest } = await import("../goal-merge.ts");
    const r = recordGoalMergeRequest({
      root, goalId: id, reason: flags.reason,
      override: typeof flags.override === "string" ? flags.override : null,
      actor: typeof flags.actor === "string" ? flags.actor : undefined,
    });
    if (wantsJson) {
      printJson(r.ok ? { ok: true, goal: id, tipSha: r.request?.tipSha, requestEventId: r.request?.eventId, override: r.request?.override ?? null, unmetAcs: r.unmetAcs, sufficiency: r.sufficiency } : { ok: false, goal: id, refusal: r.refusal });
    } else if (r.ok) {
      console.log(`merge requested: ${id} (tip ${String(r.request?.tipSha ?? "").slice(0, 12)})`);
      if (r.unmetAcs && r.unmetAcs.length > 0) console.log(`  ⚠️ override recorded for unmet pre-merge AC(s): ${r.unmetAcs.join(", ")}`);
      console.log(`  sufficiency: ${r.sufficiency?.verdict ?? "not-evaluated"} (display only — does not block)`);
      console.log(`  the worker-driver will execute the goal→develop merge; this command only recorded the request.`);
    } else {
      console.error(`merge refused (${r.refusal?.code}): ${r.refusal?.message}`);
    }
    process.exitCode = r.ok ? 0 : 1;
    return;
  }
  if (sub === "preview") {
    // SPEC-goal-branch-2026-10-03 §4.10 (rulings ⑮⑫㉒㉓): `quay goal preview <GOAL-NNN> start|stop|status`.
    // The preview WORKTREE belongs to goal-driver; the preview SERVE belongs to the human — this verb
    // is that half. `start` runs the preview worktree's OWN quay code with that worktree as the
    // workspace root, at an EXPLICIT port; `stop` stops it by reading ITS OWN `.quay/server.json`
    // (⛔ never a pattern kill); `status` reads the same carrier.
    const id = positional[0];
    const action = positional[1];
    if (!id || !/^GOAL-\d+$/.test(id)) {
      console.error("quay goal preview: usage: quay goal preview <GOAL-NNN> start|stop|status [--port <n>] [--host <h>] [--root <path>] [--json]");
      process.exitCode = 2;
      return;
    }
    if (action !== "start" && action !== "stop" && action !== "status") {
      console.error(`quay goal preview: unknown action "${action ?? ""}" (expected start|stop|status)`);
      process.exitCode = 2;
      return;
    }
    if (flags.root !== undefined && typeof flags.root !== "string") {
      console.error("Error: --root requires a value (e.g., --root /path/to/workspace)");
      process.exitCode = 1;
      return;
    }
    const mainRoot = (flags.root as string | undefined) ?? (storeWorkspaceRoot() as string);
    const { previewWorktreeDir, startPreviewServe, stopPreviewServe, readPreviewStatus } = await import("../goal-preview.ts");
    // ⛔ The displayed bind fallback is DERIVED from the ONE definition point — spelling a host
    // literal here is the second copy `serve-binding-literal-check` exists to catch.
    const hostFallback = (await import("../serve/serve-binding.ts")).SERVE_BINDING_FALLBACK.host;
    const previewRoot = previewWorktreeDir(mainRoot, id);
    if (action === "start") {
      const rawPort = flags.port;
      const port = rawPort === undefined ? Number.NaN : Number(rawPort);
      const host = typeof flags.host === "string" ? flags.host : undefined;
      const r = await startPreviewServe({ previewRoot, port, host });
      if (wantsJson) printJson({ goal: id, action, previewRoot, ...r });
      else if (r.state === "failed") console.error(`preview start FAILED: ${r.detail}`);
      else console.log(`${r.state === "already-running" ? "already running" : "started"}: ${id} preview at ${previewRoot} — http://${r.host ?? hostFallback}:${r.port} (pid ${r.pid})`);
      if (r.state === "failed") process.exitCode = 1;
      return;
    }
    if (action === "stop") {
      const r = stopPreviewServe(previewRoot);
      if (wantsJson) printJson({ goal: id, action, previewRoot, ...r });
      else console.log(`preview ${r.state}: ${id} (${r.detail})`);
      if (r.state === "failed" || r.state === "not-evaluated") process.exitCode = r.state === "not-evaluated" ? 3 : 1;
      return;
    }
    const r = readPreviewStatus(previewRoot);
    if (wantsJson) printJson({ goal: id, action, previewRoot, ...r });
    else if (r.state === "running") console.log(`running: ${id} preview pid ${r.pid} on http://${r.host ?? hostFallback}:${r.port} (${previewRoot})`);
    else console.log(`preview ${r.state}: ${id} (${r.detail})`);
    if (r.state === "not-evaluated") process.exitCode = 3;
    return;
  }
  if (sub === "list") {
    // AC1/AC2 — the thin projection and the incremental filter are the NEW read surfaces; the
    // default (`quay goal list --json`, no flags) is byte-identical to the pre-change output (AC5),
    // which is why neither the probe nor the projection runs unless a caller asked for one.
    const thin = flags["no-body"] !== undefined;
    const withStatusLog = flags["with-status-log"] !== undefined;
    let sinceMs: number | null = null;
    if (flags.since !== undefined) {
      const p = parseGoalSince("since", flags.since);
      if (p.error !== null) { console.error(`quay goal list: ${p.error}`); process.exitCode = 2; return; }
      sinceMs = p.ms;
    }
    if (thin || sinceMs !== null) {
      const probe = probeGoalCarrier(flags);
      if (probe.state === "not-evaluated") { emitGoalReadNotEvaluated(probe.reason, wantsJson); return; }
    }
    await withProvider(async (client) => {
      const filter: Record<string, unknown> = {};
      if (flags.status !== undefined) filter.status = flags.status;
      if (flags.kind !== undefined) filter.kind = flags.kind;
      if (flags.goal !== undefined) filter.goal = flags.goal;
      // gap-goal-list-ledger-scan: `--no-evidence` is the LEDGER-FREE projection — the Provider
      // returns the same records WITHOUT the derived `evidence` / `staleness` / `lastProgressAt`
      // keys, so a summariser never pays the `.quay/gate-events.jsonl` full scan (∝ ledger size,
      // independent of goal count). Same idiom as `task list --no-body` (task-list.ts): read the
      // flag off the flag bag directly — `goal list` takes no positionals, so a bare
      // `--no-evidence` parses to `true` in every real invocation order.
      if (flags["no-evidence"] !== undefined) filter.includeEvidence = false;
      const goals = (await client.goalList(filter)) as GoalReadRecord[];
      // AC2: filter on the carrier mtime, in the CLI (the ABI carries the number; the window is the
      // caller's question, not the provider's).
      const windowed = sinceMs === null ? goals : goals.filter((g) => updatedAtOrAfter(g, sinceMs));
      // AC1: project AFTER filtering, so the filter still sees `updatedAt` (it is in the thin set
      // too) and the output carries only the allow-listed fields.
      const rows: Array<GoalReadRecord | Record<string, unknown>> =
        thin ? windowed.map((g) => thinGoalRecord(g, withStatusLog)) : windowed;
      if (wantsJson) printJson(rows);
      else if (rows.length === 0) console.log("(no goals)");
      else for (const g of rows as GoalReadRecord[]) console.log(`${g.id}\t${g.status}${goalStalenessMark(g)}\t${g.kind}\t${g.title}`);
    }, { providerId: flags.provider, root: flags.root });
    return;
  }
  if (sub === "log") {
    // AC3 — the CROSS-RECORD status-transition read: the history already lives append-only on every
    // record (`statusLog`); what was missing was one surface that merges them. ⛔ No second carrier
    // and no second parser: `mergeStatusLog` above is the only implementation.
    let sinceMs: number | null = null;
    if (flags.since !== undefined) {
      const p = parseGoalSince("since", flags.since);
      if (p.error !== null) { console.error(`quay goal log: ${p.error}`); process.exitCode = 2; return; }
      sinceMs = p.ms;
    }
    const probe = probeGoalCarrier(flags);
    if (probe.state === "not-evaluated") { emitGoalReadNotEvaluated(probe.reason, wantsJson); return; }
    await withProvider(async (client) => {
      // `includeEvidence:false`: a transition's `at` lives in the record's own frontmatter; the
      // ledger-derived projection is not part of this answer, so a history read never pays the
      // `.quay/gate-events.jsonl` scan (∝ ledger size).
      const records = (await client.goalList({ includeEvidence: false })) as GoalReadRecord[];
      const merged = mergeStatusLog(records);
      const entries = sinceMs === null ? merged : merged.filter((e) => statusAtOrAfter(e.at, sinceMs));
      if (wantsJson) printJson(entries);
      else if (entries.length === 0) console.log("(no status transitions)");
      else for (const e of entries) console.log(`${e.at}\t${e.id}\t${e.from ?? ""}→${e.to ?? ""}\t${e.actor ?? ""}\t${e.reason ?? ""}`);
    }, { providerId: flags.provider, root: flags.root });
    return;
  }
  if (sub === "show" || sub === "view" || sub === "get") {
    const id = positional[0];
    if (!id) { console.error(`quay goal ${sub}: missing required <id> (GOAL-NNN or AC-NNN)`); process.exitCode = 1; return; }
    await withProvider(async (client) => {
      const g = await client.goalGet(id);
      if (!g) { console.error(`no such goal: ${id}`); process.exitCode = 1; return; }
      if (wantsJson) printJson(g);
      else {
        console.log(`${g.id}: ${g.title} [${g.status}${goalStalenessMark(g)}]${g.kind ? ` (${g.kind})` : ""}${g.goal ? ` → ${g.goal}` : ""}`);
        if (g.criterion) console.log(`criterion: ${g.criterion}`);
        if (g.status === "achieved" && g.staleness && g.staleness.state !== "clean") {
          // Same three-state distinction as the marker, spelled out: the reader needs to know WHICH
          // criterion introduced the divergence and HOW to record the human decision (AC3's path).
          if (g.staleness.state === "stale") {
            console.log(
              `staleness: ⚠️ ${g.staleness.signals.length} criterion/criteria were filed under this GOAL after it read achieved — its status field may be outdated. Triggering: ${g.staleness.signals
                .map((s) => `${s.triggeringAcId} (${s.staleSince})`)
                .join(", ")}. Reopening is a HUMAN decision: quay goal write ${g.id} --status active --reason "…"`,
            );
          } else {
            console.log(
              `staleness: ⚠️ NOT-EVALUATED — the signal carrier could not be read (${g.staleness.reason}); whether this GOAL's achieved is still earned is UNKNOWN, ⛔ not "no divergence".`,
            );
          }
        }
        if (g.body) console.log(g.body);
      }
    }, { providerId: flags.provider, root: flags.root });
    return;
  }
  if (sub === "write" || sub === "new") {
    const id = positional[0];
    if (!id) { console.error("quay goal write: missing required <id> (GOAL-NNN or AC-NNN)"); process.exitCode = 1; return; }
    await withProvider(async (client) => {
      const patch: Record<string, unknown> = { id };
      if (flags.title !== undefined) patch.title = flags.title;
      if (flags.status !== undefined) patch.status = flags.status;
      if (flags.goal !== undefined) patch.goal = flags.goal;
      if (flags.criterion !== undefined) patch.criterion = flags.criterion;
      if (flags.expect !== undefined) patch.expect = flags.expect;
      if (flags.origin !== undefined) patch.origin = flags.origin;
      if (flags.body !== undefined) patch.body = flags.body;
      if (flags["superseded-by"] !== undefined) patch.superseded_by = String(flags["superseded-by"]).split(",").filter(Boolean);
      const g = await client.goalWrite(patch);
      if (wantsJson) printJson(g); else console.log(`wrote ${id}`);
    }, { providerId: flags.provider, root: flags.root });
    return;
  }
  console.error(`unknown goal subcommand: ${sub} (try: list, log, show, write, gate, check, batch, merge, preview)`);
  process.exitCode = 1;
  return;
}
