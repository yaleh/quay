#!/usr/bin/env node
// packaging-hygiene-check.ts — mechanical standing check for the GOAL-015 packaging-hygiene defect
// class (tasks/gap-packaging-hygiene-standing-check): the "delivered artifact looks runnable but is
// structurally broken from an install location" defect family that recurs with every code change,
// not a one-shot fix. Two dimensions, one report, three-state output.
//
// DIMENSION 1 (config-key, AC-235 product): reuse config-key-consumer-check.ts `audit()` — the
//   delivered config keys quay-init writes must each have a CODE consumer. drift = keys in state
//   "no-consumer-to-wire".
// DIMENSION 2 (shipped-entry, AC-233 product): wrap the shipped-entry-runnable test by spawning
//   `node --test plugin/test/shipped-entry-runnable.test.mjs`, which enumerates `npm pack --dry-run
//   --json` (the authoritative "what actually ships" source) + install-layout run. drift = test exit
//   non-zero (the assertion message names the violating files).
//
// THREE-STATE OUTPUT (硬规则 3b: 读不懂 ≠ 合格):
//   verified      both dimensions read and clean (no drift).
//   failed        ≥1 drift item (a delivered config key with no consumer, or a packed entry-like
//                 file that is not a declared bin runnable from an install location).
//   not-evaluated a dimension could not be read (writer face / dist missing, spawn error, unparseable
//                 test output) — ⛔ never reported as "clean".
//
// MODES: default (text), --json (machine-readable — the surface the quality-gate-driver's
//   packaging-hygiene routine parses). Exit 0 = clean; 1 = drift; 2 = usage/env error; 3 = not-evaluated
//   (via emitVerdict's three-state exit-code mapping).
//
// The shipped-entry dimension is build-aware: the shipped-entry-runnable test only enumerates
// meaningfully when `packages/quay/dist/quay.js` (the declared bin) exists — a missing dist would
// silently pass the test (the declared bin is absent from the packed set ⇒ nothing to check ⇒ false
// negative, 硬规则 4). So this check builds dist first (best-effort) and reports not-evaluated rather
// than a hollow "clean" when the build cannot produce it.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { emitVerdict, helpExit, isDirectEntry } from "./gate-script-base.ts";
import { audit, type AuditReport } from "./config-key-consumer-check.ts";

// ── faces ───────────────────────────────────────────────────────────────────────────────────────────

/** config-key writer face — the SAME file config-key-consumer-check.ts derives its keys from
 *  (`packages/quay/src/init.ts`; it moved there when the shell entry became a ≤40-line shim over the
 *  CLI — gap-quay-init-sh-becomes-a-shim-over-bin-quay-init-and-callers-switch). Two constants for
 *  one face would drift, so this one only answers "is the face readable here?". */
export const WRITER_REL = "packages/quay/src/init.ts";

/** shipped-entry dimension: the AC-233 product (its authoritative enumeration lives in this test). */
export const SHIPPED_ENTRY_TEST_REL = "plugin/test/shipped-entry-runnable.test.mjs";

/** dist build (declared bin must exist before the shipped-entry test enumerates meaningfully). */
export const BUILD_DIST_REL = "packages/quay/scripts/build-dist.mjs";

/** the declared bin the shipped-entry test runs from an install-location layout. */
export const DIST_JS_REL = "packages/quay/dist/quay.js";

// ── types ───────────────────────────────────────────────────────────────────────────────────────────

export type DimensionState = "verified" | "failed" | "not-evaluated";

export interface ConfigKeyDimension {
  keysTotal: number;
  noConsumerToWire: string[];
  state: "verified" | "not-evaluated";
}

export interface ShippedEntryDimension {
  state: DimensionState;
  violations: string[];
  reason: string | null;
}

export interface PackagingHygieneReport {
  mode: "packaging-hygiene-audit";
  configKeys: ConfigKeyDimension;
  shippedEntries: ShippedEntryDimension;
  /** combined drift items (config-key keys + shipped-entry violations), one string each — the
   *  gap-filing prompt's evidence list. */
  drift: string[];
}

// ── dimension 1: config-key (reuse the AC-235 product's audit) ─────────────────────────────────────

/** Enumerate delivered config keys and their consumer state (wraps config-key-consumer-check.audit).
 *  A missing writer face ⇒ not-evaluated (⛔ not "0 keys, clean" — that would hide the unreadability). */
export function auditConfigKeys(root: string): ConfigKeyDimension {
  if (!fs.existsSync(path.join(root, WRITER_REL))) {
    return { keysTotal: 0, noConsumerToWire: [], state: "not-evaluated" };
  }
  const report: AuditReport = audit(root);
  const noConsumerToWire = report.entries
    .filter((e) => e.state === "no-consumer-to-wire")
    .map((e) => e.key);
  return { keysTotal: report.keys_total, noConsumerToWire, state: "verified" };
}

// ── dimension 2: shipped-entry (wrap the AC-233 product's test) ────────────────────────────────────

/** Build the Core dist bundle (the declared bin) if missing — the shipped-entry test's meaningfulness
 *  depends on it. Returns ok:false with a reason when the build can't produce it. */
function buildDist(root: string): { ok: boolean; reason: string | null } {
  const buildScript = path.join(root, BUILD_DIST_REL);
  if (!fs.existsSync(buildScript)) {
    return { ok: false, reason: `dist build script not found: ${BUILD_DIST_REL}` };
  }
  const cwd = path.join(root, "packages", "quay");
  const r = spawnSync("node", [buildScript], {
    cwd, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.error) return { ok: false, reason: `dist build spawn error: ${r.error.message}` };
  if (r.status !== 0) {
    return { ok: false, reason: `dist build exited ${r.status}: ${String(r.stderr ?? "").slice(0, 200)}` };
  }
  return fs.existsSync(path.join(root, DIST_JS_REL))
    ? { ok: true, reason: null }
    : { ok: false, reason: "dist build produced no packages/quay/dist/quay.js" };
}

/** Extract the violating-file lines from the shipped-entry test's assertion message. The test's
 *  failure prints "Violations:\n<file>: <reason>\n…" before "Declared bins:"; anything else we can't
 *  parse into per-file items, so fall back to the raw stderr tail (honest detail, never silent). */
function extractShippedEntryViolations(stderr: string): string[] {
  const lines = String(stderr ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  const idx = lines.findIndex((l) => l.includes("Violations:"));
  if (idx === -1) return [String(stderr ?? "").slice(0, 2000)];
  const out: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith("Declared bins:")) break;
    if (l.startsWith("at ") || l.startsWith("    at ")) break; // stack-trace tail
    out.push(l);
  }
  return out.length > 0 ? out : [String(stderr ?? "").slice(0, 2000)];
}

/** A sanitized child env for the inner `node --test` spawn. When THIS check itself runs inside an outer
 *  `node --test` (its own unit test, or any harness), the parent sets `NODE_TEST_CONTEXT` ("child-v8");
 *  inheriting it makes the inner `node --test <file>` silently exit 0 without running the file — a
 *  false-negative "clean" that hides a real shipped-entry violation (硬规则 4: 结构上取假的读数). Drop it. */
function testSpawnEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

/** Run the shipped-entry dimension: build dist if missing, then run the AC-233 test. */
export function checkShippedEntries(
  root: string,
  opts: { testRel?: string; skipBuild?: boolean } = {},
): ShippedEntryDimension {
  const distJs = path.join(root, DIST_JS_REL);
  if (!fs.existsSync(distJs) && !opts.skipBuild) {
    const built = buildDist(root);
    if (!built.ok) {
      return { state: "not-evaluated", violations: [], reason: built.reason };
    }
  }
  const testRel = opts.testRel ?? SHIPPED_ENTRY_TEST_REL;
  // path.resolve（⛔ 不是 path.join）：testRel 可能是绝对路径（测试缝注入一个临时 fake test 时），
  // path.join 会把绝对段拼到 root 后面得到不存在的前缀（root + absolute）；resolve 对绝对段正确取原值。
  const testPath = path.resolve(root, testRel);
  if (!fs.existsSync(testPath)) {
    return { state: "not-evaluated", violations: [], reason: `shipped-entry test not found: ${testRel}` };
  }
  const r = spawnSync("node", ["--no-warnings", "--test", testPath], {
    cwd: root, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"], env: testSpawnEnv(),
  });
  if (r.error) {
    return { state: "not-evaluated", violations: [], reason: `shipped-entry test spawn error: ${r.error.message}` };
  }
  if (r.status === 0) return { state: "verified", violations: [], reason: null };
  return {
    state: "failed",
    violations: extractShippedEntryViolations(String(r.stderr ?? "")),
    reason: `shipped-entry-runnable test exited ${r.status}`,
  };
}

// ── combined check ──────────────────────────────────────────────────────────────────────────────────

/** Run both dimensions and combine drift into one list (the gap-filing evidence). */
export function check(
  root: string,
  opts: { shippedEntryTestRel?: string; skipBuild?: boolean } = {},
): PackagingHygieneReport {
  const configKeys = auditConfigKeys(root);
  const shippedEntries = checkShippedEntries(root, { testRel: opts.shippedEntryTestRel, skipBuild: opts.skipBuild });
  const drift: string[] = [];
  for (const k of configKeys.noConsumerToWire) {
    drift.push(`config-key ${k}: delivered with no code consumer (wire or delete, or document a reason)`);
  }
  if (shippedEntries.state === "failed") {
    drift.push(
      `shipped-entry: ${shippedEntries.violations.length} packed entry-like file(s) not runnable from an install location (see ${SHIPPED_ENTRY_TEST_REL})`,
    );
  }
  return { mode: "packaging-hygiene-audit", configKeys, shippedEntries, drift };
}

// ── modes ───────────────────────────────────────────────────────────────────────────────────────────

function reportText(report: PackagingHygieneReport): string {
  const lines: string[] = [
    `packaging-hygiene-check — config-key (${report.configKeys.keysTotal} key(s)) + shipped-entry (${report.shippedEntries.state})`,
  ];
  for (const k of report.configKeys.noConsumerToWire) {
    lines.push(`  [NO-CONSUMER] ${k}`);
  }
  for (const v of report.shippedEntries.violations) {
    lines.push(`  [NOT-RUNNABLE] ${v}`);
  }
  if (report.shippedEntries.reason) lines.push(`  shipped-entry: ${report.shippedEntries.reason}`);
  return lines.join("\n");
}

const usage =
  "usage: node packaging-hygiene-check.ts [--root <dir>] [--json] [--shipped-entry-test <rel>] [--no-build]\n" +
  "  default: run both packaging-hygiene dimensions (config-key consumer + shipped-entry runnable)\n" +
  "  --shipped-entry-test <rel>  override the shipped-entry test path (test seam)\n" +
  "  --no-build                  skip the dist build prerequisite (test seam)\n" +
  "  Exit: 0 = clean; 1 = drift; 2 = usage/env error; 3 = not-evaluated";

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit(usage);
  const asJson = args.includes("--json");
  const rootArg = args.indexOf("--root");
  const root = path.resolve(rootArg !== -1 ? args[rootArg + 1] : process.cwd());
  const testArg = args.indexOf("--shipped-entry-test");
  const shippedEntryTestRel = testArg !== -1 ? args[testArg + 1] : undefined;
  const skipBuild = args.includes("--no-build");
  if (!fs.existsSync(root)) {
    console.error(`ERROR: audit root not found: ${root}`);
    return 2;
  }

  const report = check(root, { shippedEntryTestRel, skipBuild });
  let status: "pass" | "fail" | "not-evaluated";
  let message: string;
  if (report.drift.length > 0) {
    status = "fail";
    message = `packaging-hygiene-check: ${report.drift.length} drift item(s) (config-key no-consumer or shipped-entry not-runnable)`;
  } else if (report.configKeys.state === "not-evaluated" || report.shippedEntries.state === "not-evaluated") {
    status = "not-evaluated";
    message = "packaging-hygiene-check: a dimension could not be evaluated (see configKeys.state / shippedEntries.state)";
  } else {
    status = "pass";
    message = `packaging-hygiene-check: clean — ${report.configKeys.keysTotal} config key(s) with consumers, shipped entries runnable from an install layout`;
  }
  if (!asJson) {
    console.log(reportText(report));
  }
  return emitVerdict({ status, message, detail: report }, { json: asJson });
}

if (isDirectEntry(import.meta, undefined, "packaging-hygiene-check")) {
  process.exit(main(process.argv));
}
