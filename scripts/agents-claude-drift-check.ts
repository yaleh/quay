#!/usr/bin/env node --experimental-strip-types
/**
 * agents-claude-drift-check — fail-closed gate (DIR-121, Codex adoption Stage 1):
 * exits 0 iff the `.claude` and `.agents` host surfaces cannot silently disagree
 * about task authority, write/readback, schema validation, lifecycle, or completion
 * boundaries. Non-zero on ANY drift.
 *
 * It enforces this mechanically, not in prose:
 *
 *  1. SINGLE-SOURCE directive lifecycle: `.agents/skills/quay-directive` must be a
 *     symlink whose realpath is the runtime-neutral canonical source
 *     `plugin/skills/quay-directive/`. A non-symlink (an independent drifting copy) FAILS.
 *     (gap-ac166-second-copy-retirement: the `.claude/skills/quay-directive` second copy was retired.)
 *  2. SINGLE-SOURCE operator contract: `.agents/skills/quay-task-operator` must be a
 *     symlink resolving under `plugin/skills/quay-task-operator/`.
 *  3. PROHIBITED-ACTIONS set identity: the `<!-- PROHIBITED-AUTONOMOUS-ACTIONS -->`
 *     block in root `AGENTS.md` (the Codex authority doc) must be SET-IDENTICAL to the
 *     canonical block in `plugin/skills/quay-task-operator/SKILL.md`. Add/remove an item
 *     in one place only and this FAILS.
 *  4. DISCIPLINE markers: the canonical operator skill AND `AGENTS.md` must both carry
 *     the write/readback/schema/lifecycle/completion discipline (read+capability check,
 *     explicit authorization, semantic diff, expectedStatus CAS, freshness re-read,
 *     readback, schema check, CLI fallback/readback, scoped commit, fail-closed).
 *  5. LIFECYCLE markers: the canonical directive skill must still assert the
 *     task-canonical contract (DIR-028), schema v1, no file/projection, real-landing DoD.
 *
 * Usage: node --experimental-strip-types scripts/agents-claude-drift-check.ts
 * Exit: 0 = no drift; 1 = drift detected; 2 = environment error (missing file/symlink).
 */

import { readFileSync, realpathSync, lstatSync, existsSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Default to the repo root (this script lives in scripts/); tests may pass
// `--root <fixture-dir>` to exercise drifted/clean fixtures without touching live files.
const rootArgIdx = process.argv.indexOf("--root");
const repoRoot = rootArgIdx !== -1 && process.argv[rootArgIdx + 1]
  ? resolve(process.argv[rootArgIdx + 1])
  : resolve(__dirname, "..");

let failures = 0;
let envErrors = 0;
function ok(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`PASS: ${msg}`);
  } else {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}
function envFail(msg: string): void {
  envErrors++;
  console.error(`ENV-ERROR: ${msg}`);
}

function read(p: string): string | null {
  try {
    return readFileSync(p, "utf8");
  } catch {
    envFail(`cannot read ${p}`);
    return null;
  }
}

// --- 1 & 2: single-source symlink resolution ---------------------------------

const agentsDirectiveLink = resolve(repoRoot, ".agents/skills/quay-directive");
const agentsOperatorLink = resolve(repoRoot, ".agents/skills/quay-task-operator");
const canonicalDirectiveDir = resolve(repoRoot, "plugin/skills/quay-directive");
const canonicalOperatorDir = resolve(repoRoot, "plugin/skills/quay-task-operator");

function assertSymlinkToCanonical(linkPath: string, canonicalDir: string, label: string): string | null {
  if (!existsSync(linkPath)) {
    envFail(`${label}: missing ${linkPath}`);
    return null;
  }
  const isLink = lstatSync(linkPath).isSymbolicLink();
  ok(isLink, `${label}: ${relative(repoRoot, linkPath)} is a symlink (not an independent copy that could drift)`);
  const real = realpathSync(linkPath);
  const canonReal = realpathSync(canonicalDir);
  ok(
    real === canonReal,
    `${label}: ${relative(repoRoot, linkPath)} resolves to the canonical source ${relative(repoRoot, canonicalDir)} (realpath ${real})`
  );
  return real;
}

// gap-ac166-second-copy-retirement: the .claude/skills/quay-directive symlink was a second copy
// (retired → archived). Only .agents/skills/quay-directive remains as the directive host surface.
const agentsDirectiveReal = assertSymlinkToCanonical(agentsDirectiveLink, canonicalDirectiveDir, "directive/.agents");
assertSymlinkToCanonical(agentsOperatorLink, canonicalOperatorDir, "operator/.agents");

// The surviving directive SKILL.md resolves through the .agents symlink to the canonical source.
const agentsDirectiveSkill = read(resolve(agentsDirectiveLink, "SKILL.md"));

// --- 3: prohibited-actions set identity (AGENTS.md vs canonical operator) ------

function parseProhibited(src: string, label: string): Set<string> | null {
  const m = src.match(/<!--\s*PROHIBITED-AUTONOMOUS-ACTIONS[\s\S]*?-->([\s\S]*?)<!--\s*\/PROHIBITED-AUTONOMOUS-ACTIONS\s*-->/);
  if (!m) {
    envFail(`${label}: no <!-- PROHIBITED-AUTONOMOUS-ACTIONS --> block found`);
    return null;
  }
  const items = m[1]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .map((l) =>
      l
        .replace(/^-\s*/, "")
        .toLowerCase()
        .replace(/[^\w\s/]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter((l) => l.length > 0);
  return new Set(items);
}

const agentsMd = read(resolve(repoRoot, "AGENTS.md"));
const operatorSkill = read(resolve(canonicalOperatorDir, "SKILL.md"));

if (agentsMd !== null && operatorSkill !== null) {
  ok(agentsMd.trim().length > 0, "AGENTS.md is non-empty");
  // Concise heuristic: AGENTS.md is a guidance surface, not a workflow copy — it must
  // stay well under the canonical operator+directive skills' combined bulk. (AC: "concise".)
  const agentsLines = agentsMd.split("\n").filter((l) => l.trim().length > 0).length;
  ok(agentsLines <= 120, `AGENTS.md is concise (${agentsLines} non-empty lines <= 120)`);

  const agentsProhibited = parseProhibited(agentsMd, "AGENTS.md");
  const operatorProhibited = parseProhibited(operatorSkill, "canonical operator skill");
  if (agentsProhibited && operatorProhibited) {
    ok(operatorProhibited.size >= 6, `canonical operator skill carries the full prohibited-actions list (${operatorProhibited.size} items)`);
    const onlyInAgents = [...agentsProhibited].filter((x) => !operatorProhibited.has(x));
    const onlyInOperator = [...operatorProhibited].filter((x) => !agentsProhibited.has(x));
    ok(
      onlyInAgents.length === 0 && onlyInOperator.length === 0,
      `prohibited-actions blocks are set-identical between AGENTS.md and the canonical operator skill` +
        (onlyInAgents.length ? ` (only in AGENTS.md: ${onlyInAgents.join("; ")})` : "") +
        (onlyInOperator.length ? ` (only in operator skill: ${onlyInOperator.join("; ")})` : "")
    );
  }

  // --- 4: discipline markers present in BOTH the operator skill and AGENTS.md ---
  const discipline: [string, RegExp][] = [
    ["read + capability check", /capability check/i],
    ["explicit human authorization", /human authorization/i],
    ["before-snapshot + semantic diff", /semantic diff/i],
    ["expectedStatus CAS", /expectedstatus/i],
    ["immediate freshness re-read", /freshness re-read/i],
    ["MCP readback", /readback/i],
    ["task-schema check", /schema check|task-schema-check/i],
    ["CLI fallback/readback", /cli fallback|cli readback/i],
    ["scoped Git commit", /scoped git|scoped\s+(diff|commit)/i],
    ["fail-closed on conflict/dirty overlap", /fail[s]? closed/i],
    ["honest CAS limit (not atomic body CAS)", /not atomic same-status body cas|not\s+atomic/i],
  ];
  for (const [label, re] of discipline) {
    ok(re.test(operatorSkill), `operator skill carries discipline: ${label}`);
    ok(re.test(agentsMd), `AGENTS.md carries discipline: ${label}`);
  }
  // Completion boundary: the operator must disclaim autonomous lifecycle/completion.
  ok(/no task close|never.*status:\s*done|no autonomous lifecycle/i.test(operatorSkill), "operator skill states the completion boundary (no autonomous task close)");
}

// --- 5: canonical directive lifecycle markers ---------------------------------

if (agentsDirectiveSkill !== null) {
  const lifecycle: [string, RegExp][] = [
    ["task-canonical (DIR-028)", /DIR-028|task-canonical/i],
    ["schema v1 marker", /schema[:\s"]*v1|extra\.schema/i],
    ["no file / no projection", /no\s+(directives|file)|no projection/i],
    ["real-landing Definition of Done", /real[- ]landing|definition of done/i],
    ["task_write via Provider ABI", /task_write/i],
  ];
  for (const [label, re] of lifecycle) {
    ok(re.test(agentsDirectiveSkill), `canonical directive skill carries lifecycle contract: ${label}`);
  }
}

// --- summary ------------------------------------------------------------------

console.log("");
if (envErrors > 0) {
  console.error(`${envErrors} environment error(s), ${failures} drift failure(s)`);
  process.exit(2);
}
if (failures > 0) {
  console.error(`DRIFT: ${failures} check(s) failed — .claude and .agents surfaces disagree about task authority/lifecycle.`);
  process.exit(1);
}
console.log("OK: .agents surface resolves to one canonical contract; no drift.");
process.exit(0);
