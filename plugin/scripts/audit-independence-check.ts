// audit-independence-check.ts — the ONE canonical implementation of the
// DIR-032 audit-independence rule, with the DIR-034 anti-forgery corroboration
// requirement folded in. This module IS the rule: pure, side-effect-free check
// functions consumed by the standalone CLI (this file's own `main` below) and
// wrappable, unchanged, by the `audit-independence` named engine gate
// (packages/quay/src/gate/registry.js), following the exact
// vmeta-lag-check.ts / it0-dod-check.mjs single-source template (module IS
// the definition; a thin `.sh`/gate wraps it, never reimplements it). If this
// header comment and the code ever disagree, THE CODE WINS.
//
// ── The rule (DIR-032 "Requested action" 2, tasks/DIR-032.md) ──────────────────────────────────
//   Every per-milestone ABSORB adversarial-audit artifact
//   (`milestones/M<NN>/audits/*.md`) MUST carry a machine-readable, distinct
//   session/agent id line identifying who ran the audit — the "Audit session
//   id:" convention this module defines and reads. Given that artifact PLUS
//   the orchestrator's OWN current session/agent id (however sourced this
//   runtime — CLI `--orchestrator-id`, or the `QUAY_ORCHESTRATOR_SESSION_ID`
//   env var), the check FAILS when the id is absent or equals the
//   orchestrator's own (self-audit), and otherwise requires DIR-034
//   corroboration (below) before PASSing.
//
// ── Anti-forgery corroboration (DIR-034 "Requested action" 2, tasks/DIR-034.md) ────────────────
//   A DISTINCT session id alone is forgeable: a self-auditing context can write
//   ANY plausible-looking distinct string into the artifact's "Audit session
//   id:" line and PASS the DIR-032-only check, because that check only
//   compares two self-reported strings — it never verifies the id corresponds
//   to a genuinely dispatched independent context. DIR-034 closes this hole:
//   a distinct id is necessary but not sufficient — it must also be
//   CORROBORATED by an independent DISPATCH-SIDE RECORD that the
//   auditing/orchestrator context cannot itself fabricate after the fact.
//
//   The corroboration source is a **dispatch-record file**: a newline-
//   delimited list of ids (blank lines / `#`-comments ignored) that the
//   TOP-LEVEL orchestrator writes AT DISPATCH TIME — before the subagent runs
//   — one line per genuinely-dispatched Agent-tool/Task call (or the harness's
//   own transcript-path registry, if one exists). Supplied via
//   `--dispatch-record <file>` (CLI) or the `dispatchRecordIds` /
//   `dispatchRecordPath` parameters (programmatic). A distinct artifact id
//   found in that record is CORROBORATED; a distinct id NOT found in it (a
//   fabricated string with no matching dispatch-side record) FAILS exactly
//   like the absent/self-audit cases — this is the case that closes the
//   forgeable-string hole. Where the record is genuinely unavailable (no
//   path/list supplied at all, or a supplied path is unreadable), the gate
//   FAILS closed (BLOCKING — hand back to the top-level session per DIR-034's
//   own explicit requirement), UNLESS the caller opts in to the pre-DIR-034
//   escape hatch below.
//
//   Escape hatch (`allowUncorroborated: true` / CLI `--allow-uncorroborated`):
//   reverts to the pre-DIR-034 DIR-032 behavior (distinct-string-only, no
//   corroboration check) for callers that have not yet wired a dispatch-record
//   file. This must NEVER be the default and the `it0-dod-check.mjs` clause
//   wiring this module (DIR-034 AC/DoD) must never pass it.
//
//   FAIL-CLOSED throughout: any ambiguity (unparseable artifact, missing
//   orchestrator id, missing/unreadable dispatch-record) resolves to FAIL,
//   never a silent PASS — the exact DIR-032/DIR-034 "never silently degrade to
//   self-audit / never pass on a bare unforgeable-looking string" invariant.
//
//   This module ONLY computes the independence verdict. It does NOT dispatch
//   the audit subagent itself and does NOT decide the audit's AC/DoD verdict
//   — those remain the OUTER-LOOP ABSORB step's own responsibility (see
//   OUTER-LOOP.md's Per-milestone acceptance audit section, DIR-032/DIR-034 edits).

const ID_LINE_RE = /^\s*(?:\*\*)?audit session id(?:\*\*)?\s*:\s*(.+)$/im;

export interface IndependenceOptions {
  dispatchRecordIds?: Set<string> | string[] | null;
  allowUncorroborated?: boolean;
}

export interface IndependenceResult {
  verdict: "PASS" | "FAIL";
  reason: string;
}

export interface ArtifactReport {
  artifactId: string | null;
  orchestratorId: string | null;
  verdict: "PASS" | "FAIL";
  reason: string;
}

// ── extractSessionId — pull the recorded "Audit session id: <id>" value out of
//    an audit artifact's raw text. Returns null if no such line is present
//    (or the value after the colon is empty/whitespace-only) — an ABSENT id,
//    never coerced into an empty-string "match".
export function extractSessionId(fullText: string): string | null {
  if (typeof fullText !== "string") return null;
  const m = fullText.match(ID_LINE_RE);
  if (!m) return null;
  const value = m[1].trim().replace(/^[`*_]+/, "").replace(/[`*_]+$/, "").trim();
  return value === "" ? null : value;
}

// ── parseDispatchRecord — parse a dispatch-record file's raw text into a Set
//    of corroborated ids: one id per non-blank, non-comment (`#`) line,
//    trimmed. Returns an empty Set for empty/whitespace-only text (a real but
//    empty record — distinguish from "no record at all", which callers signal
//    with `null`/`undefined`, never an empty Set from this function).
export function parseDispatchRecord(fullText: string): Set<string> {
  if (typeof fullText !== "string") return new Set();
  const ids = fullText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  return new Set(ids);
}

// ── isCorroborated — is `artifactId` present in `dispatchRecordIds` (a Set or
//    array of ids, or null/undefined meaning "no record supplied")?
export function isCorroborated(artifactId: string | null, dispatchRecordIds: Set<string> | string[] | null | undefined): boolean {
  if (artifactId == null || artifactId === "") return false;
  if (dispatchRecordIds == null) return false;
  const set = dispatchRecordIds instanceof Set ? dispatchRecordIds : new Set(dispatchRecordIds);
  return set.has(artifactId);
}

// ── evaluateIndependence — the pure decision function. Given the artifact's
//    extracted id (or null), the orchestrator's own id (or null/undefined),
//    and DIR-034 corroboration options, returns { verdict: "PASS"|"FAIL", reason }.
//
//    options:
//      - dispatchRecordIds: Set|Array<string>|null|undefined — the corroboration
//        source (parsed dispatch-record contents). `null`/`undefined` means "no
//        record supplied" (fails closed unless allowUncorroborated).
//      - allowUncorroborated: boolean (default false) — pre-DIR-034 escape
//        hatch; when true, skips the corroboration requirement entirely
//        (distinct-string-only, DIR-032 behavior).
export function evaluateIndependence(artifactId: string | null, orchestratorId: string | null | undefined, options: IndependenceOptions = {}): IndependenceResult {
  const { dispatchRecordIds = null, allowUncorroborated = false } = options;

  if (artifactId == null || artifactId === "") {
    return {
      verdict: "FAIL",
      reason:
        "audit artifact carries NO recorded session/agent id (absent) — fail-closed; " +
        "an audit with no independence evidence is treated as a self-audit, never a silent pass",
    };
  }
  if (orchestratorId == null || orchestratorId === "") {
    return {
      verdict: "FAIL",
      reason:
        "no orchestrator session/agent id supplied to compare against (set --orchestrator-id or " +
        "QUAY_ORCHESTRATOR_SESSION_ID) — fail-closed; cannot prove independence without both ids",
    };
  }
  if (artifactId === orchestratorId) {
    return {
      verdict: "FAIL",
      reason: `audit artifact's session id ("${artifactId}") EQUALS the orchestrator's own id — self-audit, not independent`,
    };
  }

  // DIR-034: a distinct id alone is no longer sufficient — it must be
  // corroborated by an independent dispatch-side record, unless the caller
  // has explicitly opted into the pre-DIR-034 escape hatch.
  if (allowUncorroborated) {
    return {
      verdict: "PASS",
      reason:
        `audit artifact's session id ("${artifactId}") is distinct from the orchestrator's own id ("${orchestratorId}") — ` +
        `genuinely independent (UNCORROBORATED — allowUncorroborated escape hatch in effect, pre-DIR-034 behavior; ` +
        `this should not be the default path)`,
    };
  }
  if (dispatchRecordIds == null) {
    return {
      verdict: "FAIL",
      reason:
        `audit artifact's session id ("${artifactId}") is distinct from the orchestrator's own id, but NO dispatch-record ` +
        `was supplied to corroborate it (set --dispatch-record <file> or pass dispatchRecordIds) — fail-closed per DIR-034: ` +
        `a bare distinct string is forgeable and is treated as BLOCKING, not a pass`,
    };
  }
  if (!isCorroborated(artifactId, dispatchRecordIds)) {
    return {
      verdict: "FAIL",
      reason:
        `audit artifact's session id ("${artifactId}") is distinct from the orchestrator's own id, but is NOT found in the ` +
        `supplied dispatch-record (no matching independent dispatch-side entry) — treated as a FABRICATED distinct string, ` +
        `fail-closed per DIR-034's anti-forgery requirement`,
    };
  }
  return {
    verdict: "PASS",
    reason:
      `audit artifact's session id ("${artifactId}") is distinct from the orchestrator's own id ("${orchestratorId}") AND ` +
      `is corroborated by the independent dispatch-record — genuinely independent (DIR-034 anti-forgery check satisfied)`,
  };
}

// ── checkArtifact — convenience wrapper: read the artifact's raw text +
//    orchestrator id + DIR-034 corroboration options, run extraction +
//    evaluation, return the full report.
export function checkArtifact(fullText: string, orchestratorId: string | null | undefined, options: IndependenceOptions = {}): ArtifactReport {
  const artifactId = extractSessionId(fullText);
  const { verdict, reason } = evaluateIndependence(artifactId, orchestratorId, options);
  return { artifactId, orchestratorId: orchestratorId ?? null, verdict, reason };
}

// ── CLI main (only when run directly, or invoked by a test harness). Prints the report; exits 0/1/2.
export async function main(argv: string[]): Promise<number> {
  const fs = await import("node:fs");
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit("usage: node audit-independence-check.ts [--orchestrator-id <id>] [--orchestrator-env <name>] [--dispatch-record <file>] [--allow-uncorroborated] <audit-artifact.md>");
  // --orchestrator-env: override the env-var name for the orchestrator session id (default QUAY_ORCHESTRATOR_SESSION_ID)
  let orchestratorEnvName = "QUAY_ORCHESTRATOR_SESSION_ID";
  let orchestratorId: string | undefined;
  let dispatchRecordPath: string | undefined = process.env.QUAY_DISPATCH_RECORD_FILE;
  let allowUncorroborated = false;
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--orchestrator-env") { orchestratorEnvName = args[++i]; continue; }
    if (args[i] === "--orchestrator-id") { orchestratorId = args[++i]; continue; }
    if (args[i] === "--dispatch-record") { dispatchRecordPath = args[++i]; continue; }
    if (args[i] === "--allow-uncorroborated") { allowUncorroborated = true; continue; }
    files.push(args[i]);
  }
  if (orchestratorId === undefined) {
    orchestratorId = process.env[orchestratorEnvName];
  }
  if (files.length !== 1) {
    console.error(
      "usage: node audit-independence-check.ts [--orchestrator-id <id>] [--orchestrator-env <name>] " +
      "[--dispatch-record <file>] [--allow-uncorroborated] <audit-artifact.md>"
    );
    return 2;
  }
  let text: string;
  try { text = fs.readFileSync(files[0], "utf8"); }
  catch (e: any) { console.error(`ERROR: cannot read file: ${files[0]} (${e.message})`); return 2; }

  let dispatchRecordIds: Set<string> | null = null;
  if (dispatchRecordPath) {
    let recordText: string;
    try { recordText = fs.readFileSync(dispatchRecordPath, "utf8"); }
    catch (e: any) {
      console.error(`ERROR: cannot read dispatch-record file: ${dispatchRecordPath} (${e.message})`);
      return 2;
    }
    dispatchRecordIds = parseDispatchRecord(recordText);
  }

  const rep = checkArtifact(text, orchestratorId, { dispatchRecordIds, allowUncorroborated });

  console.log(`Audit-independence check — ${files[0]}`);
  console.log(`artifact session id: ${rep.artifactId ?? "(absent)"}`);
  console.log(`orchestrator session id: ${rep.orchestratorId ?? "(none supplied)"}`);
  console.log(`dispatch-record: ${dispatchRecordPath ? `${dispatchRecordPath} (${dispatchRecordIds!.size} id(s))` : "(none supplied)"}${allowUncorroborated ? " [--allow-uncorroborated escape hatch active]" : ""}`);
  console.log("");
  console.log(`${rep.verdict}: ${rep.reason}`);
  return rep.verdict === "PASS" ? 0 : 1;
}

// Run the CLI only when this file is the entry point (not when imported by tests / a quay gate).
// ⛔ NOT a URL-equality check. Under a mirror invocation (`experiments/**/scripts/<name>.ts` is a
// symlink to `plugin/scripts/<name>.ts`), Node resolves `import.meta.url` to the REALPATH (plugin
// side) while `process.argv[1]` keeps the path as written (experiments side) ⇒ URL equality is
// permanently false, `main()` never runs, and the process exits 0 with ZERO output — the "could not
// read the input" failure printed in the same shape as "all clear" (gap-arch-duplicate-copies-zero).
// `isDirectEntry` judges by basename, so both call paths agree.
import { helpExit, isDirectEntry } from "./gate-script-base.ts";
const isDirect = isDirectEntry(import.meta, process.argv[1], "audit-independence-check");
if (isDirect) {
  main(process.argv).then((code) => process.exit(code));
}
