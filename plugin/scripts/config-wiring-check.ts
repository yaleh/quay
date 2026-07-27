#!/usr/bin/env node
// config-wiring-check.ts — DIR-120 Phase 0: makes "every declared config field has exactly one
// named, real reader" a MECHANICALLY-CHECKED invariant instead of prose.
//
// Merging config files (DIR-050) does not fix the "declared but dead" failure mode — it can make
// it WORSE, because a dead field in the canonical file looks MORE authoritative while still being
// unread ([[gap-halt-sentinel-path-mismatch]] is the real-world proof: an authoritative-looking,
// off-path `.halt` doc caused a genuine safety miss). This check distinguishes THREE distinct
// failure shapes that "does it have a reader?" prose blurs together:
//
//   NO_READER              — no reader for this field exists ANYWHERE in the codebase.
//   NOT_CONSUMED_BY_DRIVER — a real reader exists (e.g. `readLoopParams`, invoked by the generic
//                            `plugin/skills/loop-driver/SKILL.md`), but the workspace's OWN ACTIVE
//                            driver never calls it. "A reader exists somewhere in the repo" is NOT
//                            the same claim as "this workspace's own driver reads it."
//   UNRESOLVABLE_VALUE     — reader + driver are both real, but the field's CONFIGURED VALUE does
//                            not resolve to anything real (e.g. `gates: [it0-set]` — "it0-set" is
//                            not a registered gate name anywhere; a dangling reference).
//
// Every classification below is backed by a LIVE grep/import check re-evaluated on every run — if
// the codebase changes (e.g. someone later wires `readLoopParams` into OUTER-LOOP.md), this
// script's verdict changes with it. Nothing here is a hardcoded assertion divorced from the files
// it describes about.
//
// Two drivers are recognized for THIS repo:
//   generic — the portable `plugin/skills/loop-driver/SKILL.md`, which calls `readLoopParams` and
//             genuinely branches on every field (verified per-field below against its own text).
//   bespoke — THIS workspace's own driver: `experiments/quay-perpetual-stream/OUTER-LOOP.md` plus
//             the workflow/script files it actually invokes (`.claude/workflows/*.js`,
//             `experiments/quay-perpetual-stream/scripts/*.ts`). Verified per-field by grepping
//             those files for a REAL, RUNNABLE consumption path — never by trusting prose.
//
// Usage:
//   node config-wiring-check.ts [--workspace <path>] [--driver bespoke|generic|both] [--json]
//   node config-wiring-check.ts --selftest
//
// Exit: 0 = every checked field OK for the requested driver(s); 1 = >=1 field has >=1 issue;
//       2 = usage/environment error (bad args, workspace config unreadable).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// plugin/scripts -> plugin -> repo root. Robust to being invoked via the experiments/ symlink
// mirror: Node resolves import.meta.url through symlinks to the REAL file's location (verified),
// so __dirname is always plugin/scripts regardless of which path was used to launch the script.
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const LOOP_FIELDS = ["board", "gates", "stop", "policy", "execution", "audit", "concurrency", "routines"] as const;
type LoopField = (typeof LOOP_FIELDS)[number];

interface EvidenceResult {
  ok: boolean;
  evidence: string;
}

interface FieldIssue {
  code: "NO_READER" | "NOT_CONSUMED_BY_DRIVER" | "UNRESOLVABLE_VALUE";
  driver?: string;
  message: string;
}

interface FieldReport {
  field: LoopField;
  value: unknown;
  issues: FieldIssue[];
}

function readFileSafe(p: string): string {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

// ── generalReader: does ANY reader for `field` exist? ──────────────────────────────────────────
// Ground truth: `packages/quay/src/loop-params.ts`'s `readLoopParams()` return object — the ONE
// function every driver (generic or bespoke) would call to get this field. Checked by scanning
// EVERY `return { ... };` block in the file for `field` as a bare object key (works whether the
// key is written as `field,` or `field: expr,`).
function checkGeneralReader(field: LoopField, repoRoot: string): EvidenceResult {
  const file = path.join(repoRoot, "packages/quay/src/loop-params.ts");
  const src = readFileSafe(file);
  const blocks = [...src.matchAll(/return \{([\s\S]*?)\};/g)].map((m) => m[1]);
  const keyRe = new RegExp(`(^|[{,\\s])${field}(:|,|\\s*\\})`, "m");
  const ok = blocks.some((b) => keyRe.test(b));
  return {
    ok,
    evidence: ok
      ? `packages/quay/src/loop-params.ts readLoopParams() returns '${field}' — a real reader exists`
      : `packages/quay/src/loop-params.ts readLoopParams() does NOT return '${field}' — no reader found anywhere`,
  };
}

// ── generic driver: plugin/skills/loop-driver/SKILL.md ──────────────────────────────────────────
// Real consumption evidence: either a literal `params.<field>` reference, or a bolded prose
// heading of the shape `**<Name> (`<field> ...`)` (the shape SKILL.md uses for concurrency/routines,
// which are branched on in prose rather than accessed via a single `params.<field>` expression).
function checkGenericDriverConsumes(field: LoopField, repoRoot: string): EvidenceResult {
  const file = path.join(repoRoot, "plugin/skills/loop-driver/SKILL.md");
  const src = readFileSafe(file);
  const paramRef = new RegExp(`params\\.${field}\\b`);
  const headingRef = new RegExp("\\*\\*[^*]*\\(`" + field + "[^`]*`");
  const ok = paramRef.test(src) || headingRef.test(src);
  return {
    ok,
    evidence: ok
      ? `plugin/skills/loop-driver/SKILL.md references '${field}' (params.${field} or a dedicated prose heading)`
      : `plugin/skills/loop-driver/SKILL.md does not reference '${field}' anywhere`,
  };
}

// ── bespoke driver: THIS workspace's real, invoked files ────────────────────────────────────────
function collectBespokeDriverFiles(repoRoot: string): string[] {
  const files: string[] = [
    path.join(repoRoot, "experiments/quay-perpetual-stream/OUTER-LOOP.md"),
    path.join(repoRoot, ".claude/workflows/select-preflight.js"),
    path.join(repoRoot, ".claude/workflows/execute-milestone.js"),
    path.join(repoRoot, ".claude/workflows/run-routines.js"),
    path.join(repoRoot, ".claude/workflows/drain-directives.js"),
  ];
  const scriptsDir = path.join(repoRoot, "experiments/quay-perpetual-stream/scripts");
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(scriptsDir);
  } catch {
    entries = [];
  }
  for (const f of entries) {
    // Exclude test files AND this checker's own mirror — config-wiring-check.ts is the
    // INSTRUMENT measuring drivers, not a driver itself; without this exclusion its own source
    // (which necessarily mentions `readLoopParams(` in code/evidence strings) would falsely
    // self-report as "a bespoke driver file that calls readLoopParams(".
    if (f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "config-wiring-check.ts") {
      files.push(path.join(scriptsDir, f));
    }
  }
  return files.filter((f) => fs.existsSync(f));
}

// Default bespoke-consumption check: does ANY bespoke driver file actually CALL `readLoopParams(`?
// (Every field except `routines` — see below — would have to arrive via that call; there is no
// other code path in this workspace's own driver that reads `.quay/config.yml`'s `loop:` section.)
function checkBespokeReaderViaReadLoopParams(field: LoopField, repoRoot: string): EvidenceResult {
  const files = collectBespokeDriverFiles(repoRoot);
  const hits = files.filter((f) => /readLoopParams\s*\(/.test(readFileSafe(f)));
  const ok = hits.length > 0;
  return {
    ok,
    evidence: ok
      ? `readLoopParams( call found in bespoke driver file(s): ${hits.map((h) => path.relative(repoRoot, h)).join(", ")}`
      : `no bespoke driver file (OUTER-LOOP.md, .claude/workflows/*.js, experiments/quay-perpetual-stream/scripts/*.ts) calls readLoopParams( — '${field}' is declared but never read by THIS workspace's actual driver (a general reader exists elsewhere — see plugin/skills/loop-driver/SKILL.md — but that is a DIFFERENT driver, not the one this workspace runs)`,
  };
}

// `routines` has its OWN real bespoke path, distinct from readLoopParams: DIR-051/056's
// `.claude/workflows/run-routines.js` genuinely instructs (and is invoked at the checkpoint step
// by OUTER-LOOP.md) reading `routines:` straight out of `.quay/loop.yml`, then dispatching
// `routine-scheduler.ts` against it.
function checkRoutinesBespokeReader(repoRoot: string): EvidenceResult {
  const file = path.join(repoRoot, ".claude/workflows/run-routines.js");
  const src = readFileSafe(file);
  const ok = /routines:/.test(src) && /\.quay\/loop\.yml/.test(src) && /routine-scheduler/.test(src);
  return {
    ok,
    evidence: ok
      ? `.claude/workflows/run-routines.js instructs reading 'routines:' from .quay/loop.yml and dispatching routine-scheduler.ts — a real, checkpoint-invoked path distinct from readLoopParams`
      : `.claude/workflows/run-routines.js does not reference reading routines: from .quay/loop.yml`,
  };
}

function checkBespokeDriverConsumes(field: LoopField, repoRoot: string): EvidenceResult {
  return field === "routines" ? checkRoutinesBespokeReader(repoRoot) : checkBespokeReaderViaReadLoopParams(field, repoRoot);
}

// ── value resolvability: is `gates`'s configured value real? ────────────────────────────────────
// Ground truth: `packages/quay/src/gate/registry.ts`'s `listGates()` — the SAME function
// `resolveGate` (the engine's own lookup point) uses. Importing it directly (rather than
// re-implementing gate-name enumeration here) keeps this a single source of truth, not a second
// one that could itself drift from the real registry.
async function checkGatesValueResolvable(configuredGates: string[], repoRoot: string): Promise<EvidenceResult> {
  const registryPath = path.join(repoRoot, "packages/quay/src/gate/registry.ts");
  const mod = await import(pathToFileUrl(registryPath));
  const known = new Set<string>(mod.listGates(repoRoot));
  const unresolved = configuredGates.filter((g) => !known.has(g));
  const ok = unresolved.length === 0;
  return {
    ok,
    evidence: ok
      ? `configured gate name(s) [${configuredGates.join(", ")}] all resolve via packages/quay/src/gate/registry.ts listGates() — real registered gate(s)`
      : `configured gate name(s) [${unresolved.join(", ")}] do NOT appear in listGates() — dangling reference(s), unresolvable by any real gate loader (known gates: ${[...known].sort().join(", ")})`,
  };
}

function pathToFileUrl(p: string): string {
  return "file://" + path.resolve(p);
}

// ── per-field report ─────────────────────────────────────────────────────────────────────────────
async function checkField(field: LoopField, value: unknown, drivers: string[], repoRoot: string): Promise<FieldReport> {
  const issues: FieldIssue[] = [];
  const general = checkGeneralReader(field, repoRoot);
  if (!general.ok) {
    issues.push({ code: "NO_READER", message: general.evidence });
    return { field, value, issues };
  }
  for (const driver of drivers) {
    const dc = driver === "generic" ? checkGenericDriverConsumes(field, repoRoot) : checkBespokeDriverConsumes(field, repoRoot);
    if (!dc.ok) issues.push({ code: "NOT_CONSUMED_BY_DRIVER", driver, message: dc.evidence });
  }
  if (field === "gates" && Array.isArray(value)) {
    const vc = await checkGatesValueResolvable(value as string[], repoRoot);
    if (!vc.ok) issues.push({ code: "UNRESOLVABLE_VALUE", message: vc.evidence });
  }
  return { field, value, issues };
}

export {
  checkGeneralReader,
  checkGenericDriverConsumes,
  checkBespokeReaderViaReadLoopParams,
  checkRoutinesBespokeReader,
  checkBespokeDriverConsumes,
  checkGatesValueResolvable,
  checkField,
  LOOP_FIELDS,
};

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  if (args.includes("--selftest")) return runSelftest();

  let workspaceRoot = REPO_ROOT;
  let drivers = ["bespoke", "generic"];
  let asJson = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--workspace") workspaceRoot = path.resolve(args[++i] ?? "");
    else if (args[i] === "--driver") {
      const v = (args[++i] ?? "").trim();
      drivers = v === "both" || v === "" ? ["bespoke", "generic"] : [v];
    } else if (args[i] === "--json") asJson = true;
    else {
      console.error(`Usage: config-wiring-check.ts [--workspace <path>] [--driver bespoke|generic|both] [--json] | --selftest`);
      return 2;
    }
  }
  for (const d of drivers) {
    if (d !== "bespoke" && d !== "generic") {
      console.error(`ERROR: --driver must be 'bespoke', 'generic', or 'both' (got '${d}')`);
      return 2;
    }
  }

  const { readLoopParams } = await import(pathToFileUrl(path.join(REPO_ROOT, "packages/quay/src/loop-params.ts")));
  let params: Record<string, unknown>;
  try {
    params = readLoopParams(workspaceRoot);
  } catch (e: unknown) {
    console.error(`ERROR: cannot read loop params for ${workspaceRoot}: ${(e as Error).message}`);
    return 2;
  }

  const reports: FieldReport[] = [];
  for (const field of LOOP_FIELDS) {
    reports.push(await checkField(field, params[field], drivers, REPO_ROOT));
  }

  const totalIssues = reports.reduce((n, r) => n + r.issues.length, 0);

  if (asJson) {
    console.log(JSON.stringify({ workspaceRoot, drivers, reports, ok: totalIssues === 0 }, null, 2));
  } else {
    console.log(`config-wiring-check — workspace=${workspaceRoot} drivers=[${drivers.join(",")}]`);
    for (const r of reports) {
      const status = r.issues.length === 0 ? "OK" : "FAIL";
      console.log(`\n[${status}] ${r.field} = ${JSON.stringify(r.value)}`);
      for (const issue of r.issues) {
        console.log(`    - ${issue.code}${issue.driver ? `(${issue.driver})` : ""}: ${issue.message}`);
      }
    }
    console.log(`\n${totalIssues === 0 ? "PASS" : "FAIL"}: ${totalIssues} issue(s) across ${reports.length} field(s)`);
  }
  return totalIssues === 0 ? 0 : 1;
}

// ── selftest ─────────────────────────────────────────────────────────────────────────────────────
async function runSelftest(): Promise<number> {
  let pass = 0;
  let fail = 0;
  function check(name: string, cond: boolean, detail: string = "") {
    if (cond) {
      pass++;
    } else {
      fail++;
      console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    }
  }

  // ── checkGeneralReader ──
  const r1 = checkGeneralReader("board", REPO_ROOT);
  check("general-reader-board-ok", r1.ok === true, r1.evidence);
  const r2 = checkGeneralReader("bogus_field_xyz" as LoopField, REPO_ROOT);
  check("general-reader-bogus-field-not-ok", r2.ok === false, r2.evidence);

  // ── checkGenericDriverConsumes ──
  const r3 = checkGenericDriverConsumes("concurrency", REPO_ROOT);
  check("generic-driver-consumes-concurrency", r3.ok === true, r3.evidence);
  const r4 = checkGenericDriverConsumes("routines", REPO_ROOT);
  check("generic-driver-consumes-routines", r4.ok === true, r4.evidence);
  const r5 = checkGenericDriverConsumes("bogus_field_xyz" as LoopField, REPO_ROOT);
  check("generic-driver-does-not-consume-bogus-field", r5.ok === false, r5.evidence);

  // ── checkBespokeReaderViaReadLoopParams / checkRoutinesBespokeReader ──
  const r6 = checkBespokeReaderViaReadLoopParams("stop", REPO_ROOT);
  check("bespoke-driver-does-not-consume-stop (real DIR-120 finding)", r6.ok === false, r6.evidence);
  const r7 = checkBespokeReaderViaReadLoopParams("concurrency", REPO_ROOT);
  check("bespoke-driver-does-not-consume-concurrency (real DIR-120 finding)", r7.ok === false, r7.evidence);
  const r8 = checkRoutinesBespokeReader(REPO_ROOT);
  check("bespoke-driver-consumes-routines (real, distinct path)", r8.ok === true, r8.evidence);

  // ── value resolvability (real gate registry, no fixture needed — the registry IS the ground truth) ──
  const vc1 = await checkGatesValueResolvable(["it0-set"], REPO_ROOT);
  check("gates-it0-set-unresolvable (real, current DIR-120 RED case)", vc1.ok === false, vc1.evidence);
  const vc2 = await checkGatesValueResolvable(["acceptance"], REPO_ROOT);
  check("gates-acceptance-resolvable", vc2.ok === true, vc2.evidence);
  const vc3 = await checkGatesValueResolvable(["totally-bogus-gate-name"], REPO_ROOT);
  check("gates-bogus-name-unresolvable", vc3.ok === false, vc3.evidence);

  // ── end-to-end checkField: multiple simultaneous issue codes on one field ──
  const fr1 = await checkField("gates", ["it0-set"], ["bespoke"], REPO_ROOT);
  check(
    "field-report-gates-it0-set-has-two-distinct-issues",
    fr1.issues.length === 2 &&
      fr1.issues.some((i) => i.code === "NOT_CONSUMED_BY_DRIVER") &&
      fr1.issues.some((i) => i.code === "UNRESOLVABLE_VALUE"),
    JSON.stringify(fr1.issues)
  );
  const fr2 = await checkField("routines", [], ["bespoke"], REPO_ROOT);
  check("field-report-routines-no-issues-for-bespoke", fr2.issues.length === 0, JSON.stringify(fr2.issues));
  const fr3 = await checkField("board", "native", ["generic"], REPO_ROOT);
  check("field-report-board-no-issues-for-generic", fr3.issues.length === 0, JSON.stringify(fr3.issues));

  // ── CLI end-to-end smoke: run main() against a real temp workspace with a GREEN config ──
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-wiring-selftest-"));
  try {
    fs.mkdirSync(path.join(tmpDir, ".quay"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".quay", "config.yml"), "loop:\n  board: native\n  gates: [acceptance]\n");
    const code = await main(["node", "config-wiring-check.ts", "--workspace", tmpDir, "--driver", "generic", "--json"]);
    check("cli-green-workspace-generic-driver-exit-0", code === 0, `exit=${code}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log(`\nconfig-wiring-check --selftest: ${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

// gap-config-wiring-check-symlink-noop: raw string equality between `process.argv[1]` (NEVER
// resolved through a symlink — stays exactly as typed on the command line) and
// `fileURLToPath(import.meta.url)` (ALWAYS resolved through symlinks to the real file's absolute
// path by Node's ESM loader) can never be true when this script is invoked via the
// `experiments/quay-perpetual-stream/scripts/` mirror symlink — `main()` would silently never run,
// falling through to a clean exit 0 indistinguishable from "ran and found zero issues." Resolving
// BOTH sides through `fs.realpathSync` (after `path.resolve` to handle a relative argv[1]) makes
// the two invocation paths compare equal, so the mirror path now behaves identically to the real
// path instead of silently no-opping.
function isDirectInvocation(): boolean {
  if (!process.argv[1]) return false;
  try {
    const invokedReal = fs.realpathSync(path.resolve(process.argv[1]));
    const moduleReal = fileURLToPath(import.meta.url);
    return invokedReal === moduleReal;
  } catch {
    return false;
  }
}

const isDirect = isDirectInvocation();
if (isDirect) {
  main(process.argv).then((code) => process.exit(code));
}
