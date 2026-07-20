// audit-independence-check.mjs — the ONE canonical implementation of the
// DIR-032 audit-independence rule. This module IS the rule: pure,
// side-effect-free check functions consumed by the standalone CLI (this
// file's own `main` below) and wrappable, unchanged, by the `audit-independence`
// named engine gate (packages/quay/src/gate/registry.js), following the exact
// `vmeta-lag-check.mjs` / `it0-dod-check.mjs` single-source template (module IS
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
//   env var), the check:
//     - FAILS (verdict FAIL, exit 1) when the artifact carries NO id line at
//       all (absent — the exact M41/M42/M43 self-audit shape: real audit
//       work happened, but no independent-session evidence was ever recorded)
//       OR when the artifact's id EQUALS the orchestrator's own id (self-audit
//       — the artifact was authored by the same session that is now checking
//       it, i.e. no independent context ever ran it).
//     - PASSES (verdict PASS, exit 0) when the artifact carries an id line
//       that is NON-EMPTY and DISTINCT from the orchestrator's own id (a
//       genuinely independent fresh-context subagent produced this artifact).
//   FAIL-CLOSED throughout: any ambiguity (unparseable artifact, missing
//   orchestrator id to compare against) resolves to FAIL, never a silent PASS
//   — the exact DIR-032 "never silently degrade to self-audit" invariant.
//
//   This module ONLY computes the independence verdict. It does NOT dispatch
//   the audit subagent itself and does NOT decide the audit's AC/DoD verdict
//   — those remain the OUTER-LOOP ABSORB step's own responsibility (see
//   OUTER-LOOP.md's Per-milestone acceptance audit section, DIR-032 edit).

const ID_LINE_RE = /^\s*(?:\*\*)?audit session id(?:\*\*)?\s*:\s*(.+)$/im;

// ── extractSessionId — pull the recorded "Audit session id: <id>" value out of
//    an audit artifact's raw text. Returns null if no such line is present
//    (or the value after the colon is empty/whitespace-only) — an ABSENT id,
//    never coerced into an empty-string "match".
export function extractSessionId(fullText) {
  if (typeof fullText !== "string") return null;
  const m = fullText.match(ID_LINE_RE);
  if (!m) return null;
  const value = m[1].trim().replace(/^[`*_]+/, "").replace(/[`*_]+$/, "").trim();
  return value === "" ? null : value;
}

// ── evaluateIndependence — the pure decision function. Given the artifact's
//    extracted id (or null) and the orchestrator's own id (or null/undefined),
//    returns { verdict: "PASS"|"FAIL", reason }.
export function evaluateIndependence(artifactId, orchestratorId) {
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
  return {
    verdict: "PASS",
    reason: `audit artifact's session id ("${artifactId}") is distinct from the orchestrator's own id ("${orchestratorId}") — genuinely independent`,
  };
}

// ── checkArtifact — convenience wrapper: read the artifact's raw text +
//    orchestrator id, run extraction + evaluation, return the full report.
export function checkArtifact(fullText, orchestratorId) {
  const artifactId = extractSessionId(fullText);
  const { verdict, reason } = evaluateIndependence(artifactId, orchestratorId);
  return { artifactId, orchestratorId: orchestratorId ?? null, verdict, reason };
}

// ── CLI main (only when run directly, or invoked by a test harness). Prints the report; exits 0/1/2.
export async function main(argv) {
  const fs = await import("node:fs");
  const args = argv.slice(2);
  let orchestratorId = process.env.QUAY_ORCHESTRATOR_SESSION_ID;
  const files = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--orchestrator-id") { orchestratorId = args[++i]; continue; }
    files.push(args[i]);
  }
  if (files.length !== 1) {
    console.error("usage: node audit-independence-check.mjs [--orchestrator-id <id>] <audit-artifact.md>");
    return 2;
  }
  let text;
  try { text = fs.readFileSync(files[0], "utf8"); }
  catch (e) { console.error(`ERROR: cannot read file: ${files[0]} (${e.message})`); return 2; }

  const rep = checkArtifact(text, orchestratorId);

  console.log(`Audit-independence check — ${files[0]}`);
  console.log(`artifact session id: ${rep.artifactId ?? "(absent)"}`);
  console.log(`orchestrator session id: ${rep.orchestratorId ?? "(none supplied)"}`);
  console.log("");
  console.log(`${rep.verdict}: ${rep.reason}`);
  return rep.verdict === "PASS" ? 0 : 1;
}

// Run the CLI only when this file is the entry point (not when imported by tests / a quay gate).
import { fileURLToPath } from "node:url";
const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) {
  main(process.argv).then((code) => process.exit(code));
}
