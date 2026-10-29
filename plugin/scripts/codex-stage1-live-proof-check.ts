#!/usr/bin/env node --experimental-strip-types
/**
 * codex-stage1-live-proof-check — SHAPE-ONLY validator for the DIR-121 (Codex
 * adoption Stage 1) durable milestone-evidence record.
 *
 *   Usage: node --experimental-strip-types plugin/scripts/codex-stage1-live-proof-check.ts <milestone-evidence.json>
 *
 * This command checks ONLY the SHAPE and SELF-CONSISTENCY of the record. It exits 0
 * iff the record is present, complete, and internally consistent:
 *   - a fresh Codex session reference + version + trusted-checkout flag;
 *   - loaded instruction/Skill evidence (root AGENTS.md + both repository Skills);
 *   - the MCP and CLI paths used;
 *   - at least one human-authorized CREATE and one EDIT of a REAL task (neither a
 *     disposable probe/fixture — the record must name genuine task ids);
 *   - per mutation: authorization ref, before/after hashes (an edit must actually
 *     change content), MCP readback, CLI readback, schema-check exit 0, and a scoped
 *     commit whose touched files are all authorized task/evidence paths and that
 *     preserved unrelated pre-existing worktree changes;
 *   - a refused stale-`expectedStatus` (CAS) probe whose target content hash is
 *     unchanged (before == after) and whose expected != actual status.
 *
 * ⛔ SHAPE-ONLY CONTRACT: an exit 0 from THIS command does NOT assert that the evidence
 * is TRUE of the live store, that any task/commit it names actually exists, or that a
 * real landing happened. A record whose strings are all filled in and whose hashes are
 * self-consistent passes here even when every taskId/commit SHA is fabricated. The TRUTH
 * conclusion lives in the INDEPENDENT audit:
 *
 *   node --experimental-strip-types plugin/scripts/codex-stage1-live-proof-audit.ts <evidence.json>
 *
 * which reads each claimed task back from the provider-authoritative store and each
 * commit SHA + changed paths back from Git. Only the audit's exit 0 is a truth claim.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { helpExit } from "./gate-script-base.ts";

let failures = 0;
function ok(cond: boolean, msg: string): void {
  if (cond) console.log(`PASS: ${msg}`);
  else {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}

const file = process.argv[2];
if (file === "--help" || file === "-h") {
  helpExit(
    "codex-stage1-live-proof-check — SHAPE-ONLY validator (NOT a truth check)\n" +
    "usage: node --experimental-strip-types plugin/scripts/codex-stage1-live-proof-check.ts <milestone-evidence.json>\n" +
    "\n" +
    "Exit 0 = the record is structurally complete and internally consistent ONLY.\n" +
    "Exit 0 does NOT assert the evidence is true, that a task/commit it names exists,\n" +
    "or that a real landing happened. For the truth conclusion run:\n" +
    "  node --experimental-strip-types plugin/scripts/codex-stage1-live-proof-audit.ts <milestone-evidence.json>"
  );
}
if (!file) {
  console.error("usage: node plugin/scripts/codex-stage1-live-proof-check.ts <milestone-evidence.json>");
  process.exit(2);
}

let raw: string;
try {
  raw = readFileSync(resolve(file), "utf8");
} catch (e) {
  console.error(`ENV-ERROR: cannot read evidence file ${file}: ${(e as Error).message}`);
  process.exit(2);
}

let ev: any;
try {
  ev = JSON.parse(raw);
} catch (e) {
  console.error(`FAIL: evidence file is not valid JSON: ${(e as Error).message}`);
  process.exit(1);
}

const isStr = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;
const PROBE_ID = /(^|[^A-Za-z])(CODEX[-_]?PROBE|DEMO|FIXTURE|PROBE|SAMPLE|TEST[-_]?TASK)\b/i;

// --- codex session -------------------------------------------------------------
const s = ev.codexSession ?? {};
ok(isStr(s.ref), "codexSession.ref: a fresh Codex session reference is recorded");
ok(isStr(s.version), "codexSession.version: the implementing Codex version is recorded");
ok(s.trustedCheckout === true, "codexSession.trustedCheckout: the session ran in a trusted checkout (true)");

// --- loaded surfaces -----------------------------------------------------------
const ls = ev.loadedSurfaces ?? {};
ok(ls.agentsMd === true, "loadedSurfaces.agentsMd: root AGENTS.md was loaded");
const skills = Array.isArray(ls.skills) ? ls.skills : [];
ok(skills.includes("quay-task-operator"), "loadedSurfaces.skills: quay-task-operator discovered");
ok(skills.includes("quay-directive"), "loadedSurfaces.skills: quay-directive discovered");

// --- paths ---------------------------------------------------------------------
const p = ev.paths ?? {};
ok(isStr(p.mcp), "paths.mcp: the Quay MCP path used is recorded");
ok(isStr(p.cli), "paths.cli: the CLI fallback path used is recorded");

// --- mutations (>=1 create AND >=1 edit, all real + authorized + verified) ------
const mutations = Array.isArray(ev.mutations) ? ev.mutations : [];
ok(mutations.length >= 2, `mutations: at least two recorded (create + edit); got ${mutations.length}`);
ok(mutations.some((m: any) => m?.kind === "create"), "mutations: at least one CREATE is recorded");
ok(mutations.some((m: any) => m?.kind === "edit"), "mutations: at least one EDIT is recorded");

const ALLOWED_FILE = /^(tasks\/|docs\/plans\/|milestones\/.*evidence|.*milestone-evidence.*\.json$|AGENTS\.md$)/;
for (const m of mutations) {
  const label = `mutation[${m?.taskId ?? "?"}]`;
  ok(m?.kind === "create" || m?.kind === "edit", `${label}: kind is create|edit`);
  ok(isStr(m?.taskId), `${label}: taskId recorded`);
  ok(!PROBE_ID.test(m?.taskId ?? ""), `${label}: taskId is a REAL task, not a disposable probe/fixture`);
  ok(isStr(m?.providerQualifiedId), `${label}: provider-qualified id recorded`);
  ok(isStr(m?.authorizationRef), `${label}: explicit human authorization reference recorded`);
  ok(isStr(m?.afterHash), `${label}: after-hash recorded`);
  if (m?.kind === "edit") {
    ok(isStr(m?.beforeHash), `${label}: edit records a before-hash`);
    ok(isStr(m?.beforeHash) && m.beforeHash !== m.afterHash, `${label}: edit actually changed content (before != after)`);
  }
  // "before/after semantic diff OR hashes": a semanticDiff, or a recorded after-hash
  // (an edit's before-hash + before!=after is asserted above; a create has no before).
  ok(isStr(m?.semanticDiff) || isStr(m?.afterHash), `${label}: before/after semantic diff or hashes present`);
  ok(m?.mcpReadback === true, `${label}: MCP readback verified`);
  ok(m?.cliReadback === true, `${label}: CLI readback verified independently`);
  ok(m?.schemaCheck?.exitCode === 0, `${label}: task-schema-check exit code is 0`);
  const sc = m?.scopedCommit ?? {};
  ok(isStr(sc.sha), `${label}: scoped commit SHA recorded`);
  const files = Array.isArray(sc.filesChanged) ? sc.filesChanged : [];
  ok(files.length > 0, `${label}: scoped commit lists its changed files`);
  ok(files.every((f: unknown) => typeof f === "string" && ALLOWED_FILE.test(f)), `${label}: scoped commit touched ONLY authorized task/evidence paths (got: ${files.join(", ")})`);
  ok(sc.unrelatedChangesPreserved === true, `${label}: unrelated pre-existing worktree changes preserved`);
}

// --- CAS-negative probe --------------------------------------------------------
const cas = ev.casNegative ?? {};
ok(isStr(cas.taskId), "casNegative.taskId: the refused stale-CAS probe names a task");
ok(isStr(cas.expectedStatus) && isStr(cas.actualStatus), "casNegative: expected and actual status recorded");
ok(isStr(cas.expectedStatus) && cas.expectedStatus !== cas.actualStatus, "casNegative: the probe used a STALE expectedStatus (expected != actual)");
ok(cas.refused === true, "casNegative.refused: the stale write was REFUSED (isError / CAS conflict)");
ok(isStr(cas.beforeHash) && cas.beforeHash === cas.afterHash, "casNegative: target content hash unchanged by the refused probe (before == after)");

// --- summary -------------------------------------------------------------------
console.log("");
if (failures > 0) {
  console.error(`SHAPE-ONLY FAIL: ${failures} required field(s)/consistency check(s) failed (SHAPE-ONLY — this is not a truth claim).`);
  process.exit(1);
}
console.log("SHAPE-ONLY PASS: evidence record is structurally complete and internally consistent (NOT a truth claim — run codex-stage1-live-proof-audit.ts for authoritative store/Git readback).");
process.exit(0);
