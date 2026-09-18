#!/usr/bin/env node
// external-dogfooding-check.ts — DIR-043: the mechanical contract checker for the standing
// EXTERNAL-dogfooding / discovery routine (the third DIR-051 routine instance, after DIR-052
// self-validation and DIR-053 architecture-analysis). The routine keeps `L_T` (product truth)
// illuminated by persistently USING quay on a real foreign workspace (archguard) on a cadence,
// and filing evidence-backed `label:directive` findings behind the quality/dedup/rate gate.
//
// This module answers ONE question (capability-catalog): "Is the external-dogfooding routine's
// contract satisfied — a configured cadence (every(N)/on(checkpoint)), a drivable foreign target
// (authorized by drivable-workspaces.yml), the tmux remote-drive surface present (ADR-016), and a
// filed candidate finding shaped as an evidence-backed directive?"
//
// The routine track ALREADY has the mechanism (routine-scheduler.ts / read-probe-spec.ts /
// routine-file-gate.ts / the quay:run-routines skill). This checker REUSES those modules
// (ADR-004 single-source — no re-implementation): cadence is validated by the scheduler's own
// `parseTrigger`, target authorization by drivable-workspace-check's `isCovered`, finding quality
// by routine-file-gate's `isActionable`. FAIL-CLOSED: a missing/unparseable input never passes.
//
// Usage:
//   node external-dogfooding-check.ts --selftest
//   node external-dogfooding-check.ts --cadence every(5)
//   node external-dogfooding-check.ts --routine-config <routines.yml> --routine external-dogfooding
//   node external-dogfooding-check.ts --target <path> --registry <file>
//   node external-dogfooding-check.ts --surface --plugin-root <dir>
//   node external-dogfooding-check.ts --finding <candidate-task.md>
//   node external-dogfooding-check.ts --check --routines <file> --target <path> --registry <file> \
//       --plugin-root <dir> [--finding <file>] [--routine <name>]
//
// Exit codes:
//   0 = every requested sub-check PASSED (or selftest passed)
//   1 = at least one sub-check FAILED
//   2 = usage/environment error (missing required arg, missing/unreadable file)

import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { helpExit, isDirectEntry, createSelftest } from "./gate-script-base.ts";
import { parseTrigger } from "./routine-scheduler.ts";
import { isCovered, loadRegistry, parseRegistry } from "./drivable-workspace-check.ts";
import type { Registry } from "./drivable-workspace-check.ts";
import { isActionable } from "./routine-file-gate.ts";

// ── sub-check 1: cadence ──────────────────────────────────────────────────────────────────────────
// A routine must fire on a configurable cadence — every(N) or on(<event>) — the EXACT grammar the
// scheduler itself accepts. Delegating to parseTrigger keeps ONE trigger grammar (ADR-004): if the
// scheduler changes its grammar, this check follows without re-implementation.
export interface CadenceResult {
  ok: boolean;
  kind?: "every" | "on";
  n?: number;
  event?: string;
  reason?: string;
}

export function checkCadenceTrigger(trigger: unknown): CadenceResult {
  if (typeof trigger !== "string" || trigger.trim() === "") {
    return { ok: false, reason: "cadence: trigger must be a non-empty string" };
  }
  try {
    const t = parseTrigger(trigger);
    if (t.kind === "every") return { ok: true, kind: "every", n: t.n };
    return { ok: true, kind: "on", event: t.event };
  } catch (e) {
    return { ok: false, reason: `cadence: ${(e as Error).message}` };
  }
}

// ── sub-check 2: routine config ───────────────────────────────────────────────────────────────────
// The routine must be DECLARED in the loop config (`loop.routines:` / `routines:`) with a valid
// cadence AND an action (probe:<name> — the DIR-056 form — or legacy dispatch:<action>). A routine
// with neither action is skipped by the scheduler; the check must not pass it either (fail-closed).
export interface RoutineConfigResult {
  ok: boolean;
  routine?: Record<string, unknown>;
  reason?: string;
}

export function checkRoutineConfig(routines: unknown, name: string): RoutineConfigResult {
  if (!Array.isArray(routines)) {
    return { ok: false, reason: `routines: expected an array, got ${typeof routines}` };
  }
  const routine = routines.find(
    (r) => r !== null && typeof r === "object" && (r as Record<string, unknown>).name === name
  );
  if (!routine) {
    return { ok: false, reason: `routines: no routine named "${name}" declared` };
  }
  const trig = checkCadenceTrigger((routine as Record<string, unknown>).trigger);
  if (!trig.ok) return { ok: false, reason: trig.reason };
  const action = routine as Record<string, unknown>;
  const hasAction =
    (typeof action.probe === "string" && action.probe.trim() !== "") ||
    (typeof action.dispatch === "string" && action.dispatch.trim() !== "");
  if (!hasAction) {
    return { ok: false, reason: `routines: "${name}" must declare a probe: (DIR-056 form) or dispatch: action` };
  }
  return { ok: true, routine };
}

// Extract the routines array from a parsed loop-config document. Accepts both the canonical
// `.quay/config.yml` `loop.routines:` nesting and a flat `routines:` list (the DIR-052/053 body
// shape). Returns null when neither is present (the caller fails closed).
export function extractRoutines(doc: unknown): unknown[] | null {
  if (doc === null || typeof doc !== "object") return null;
  const obj = doc as Record<string, unknown>;
  if (Array.isArray(obj.routines)) return obj.routines;
  if (obj.loop !== null && typeof obj.loop === "object" && Array.isArray((obj.loop as Record<string, unknown>).routines)) {
    return (obj.loop as Record<string, unknown>).routines as unknown[];
  }
  return null;
}

// ── sub-check 3: drivable foreign target ─────────────────────────────────────────────────────────
// The foreign workspace the routine drives must be COVERED by the human-authorized
// drivable-workspaces.yml registry (DIR-062). Reuses the registry's own isCovered — a target the
// registry refuses is refused here too.
export interface TargetResult {
  ok: boolean;
  reason?: string;
}

export function checkTargetDrivable(target: string, registry: Registry): TargetResult {
  if (typeof target !== "string" || target.trim() === "") {
    return { ok: false, reason: "target: no foreign-workspace target given" };
  }
  if (!isCovered(target, registry)) {
    return { ok: false, reason: `target: ${target} is NOT covered by the drivable-workspaces registry (fail-closed)` };
  }
  return { ok: true };
}

// ── sub-check 4: tmux remote-drive surface ───────────────────────────────────────────────────────
// ADR-016 remote-drive needs the reliable send-keys sequence + the transcript delivery verdict +
// the target-authorization gate, all shipped with the plugin. If any is missing the routine cannot
// actually drive → the contract is not satisfied.
export interface SurfaceResult {
  ok: boolean;
  present: string[];
  missing: string[];
}

export const REMOTE_DRIVE_SURFACE = [
  "send-keys-reliable.sh",       // ADR-016 reliable 3-step send-keys (C-u → text → Enter)
  "transcript-delivery-check.ts", // delivery verdict from the foreign session's transcript
  "drivable-workspace-check.ts", // fail-closed target-authorization gate (DIR-062)
] as const;

export function checkRemoteDriveSurface(pluginRoot: string): SurfaceResult {
  const present: string[] = [];
  const missing: string[] = [];
  for (const f of REMOTE_DRIVE_SURFACE) {
    if (fs.existsSync(path.join(pluginRoot, "scripts", f))) present.push(f);
    else missing.push(f);
  }
  return { ok: missing.length === 0, present, missing };
}

// ── sub-check 5: finding shape ───────────────────────────────────────────────────────────────────
// A candidate finding the routine wants to file must be shaped as an evidence-backed
// `label:directive` task: (a) labeled directive (AC3), and (b) actionable per the routine-file-gate
// quality bar (`## Finding` + reproduction evidence). The gate's own isActionable is the single
// quality source — this check adds the directive-label requirement the gate does not enforce.
export interface FindingResult {
  ok: boolean;
  reasons: string[];
}

const LABEL_DIRECTIVE_BLOCK = /^labels:\s*\n(\s+-\s+[^\n]*\n)*\s+-\s+directive\b/m;
const LABEL_DIRECTIVE_INLINE = /labels:\s*\[[^\]]*\bdirective\b[^\]]*\]/;

export function checkDirectiveFinding(taskText: unknown): FindingResult {
  const reasons: string[] = [];
  if (typeof taskText !== "string" || taskText.trim() === "") {
    return { ok: false, reasons: ["finding: empty candidate task text"] };
  }
  if (!LABEL_DIRECTIVE_BLOCK.test(taskText) && !LABEL_DIRECTIVE_INLINE.test(taskText)) {
    reasons.push("finding: must be labeled `directive` (AC3 — filed as `label:directive`)");
  }
  if (!isActionable(taskText)) {
    reasons.push("finding: must be actionable — a `## Finding` section citing reproduction evidence (routine-file-gate quality bar)");
  }
  return { ok: reasons.length === 0, reasons };
}

// ── selftest — embedded GREEN+RED fixture suite (mirrors drivable-workspace-check's selftest) ──────
export function selftest(): boolean {
  const st = createSelftest({ flavor: "cases-period" });
  const check = st.check;

  // ── cadence (GREEN) ──
  const every5 = checkCadenceTrigger("every(5)");
  check("cadence-every5", every5.ok === true && every5.kind === "every" && every5.n === 5, "every(5) parses");
  const every1 = checkCadenceTrigger("every(1)");
  check("cadence-every1", every1.ok === true && every1.n === 1, "every(1) parses (minimum N)");
  const onCk = checkCadenceTrigger("on(checkpoint)");
  check("cadence-on-checkpoint", onCk.ok === true && onCk.kind === "on" && onCk.event === "checkpoint", "on(checkpoint) parses");
  // ── cadence (RED) ──
  check("cadence-every0", checkCadenceTrigger("every(0)").ok === false, "every(0) rejected (N>=1)");
  check("cadence-garbage", checkCadenceTrigger("sometimes").ok === false, "unknown grammar rejected");
  check("cadence-empty", checkCadenceTrigger("   ").ok === false, "blank trigger rejected");
  check("cadence-null", checkCadenceTrigger(null).ok === false, "null trigger rejected (fail-closed)");

  // ── routine config ──
  const routinesFixture = [
    { name: "self-validation", trigger: "every(5)", probe: "self-validation" },
    { name: "external-dogfooding", trigger: "every(8)", probe: "external-dogfooding" },
    { name: "architecture-analysis", trigger: "every(10)", probe: "architecture-analysis" },
  ];
  const cfgOk = checkRoutineConfig(routinesFixture, "external-dogfooding");
  check("config-declared", cfgOk.ok === true && (cfgOk.routine as { probe?: string }).probe === "external-dogfooding", "declared routine with probe: resolves");
  check("config-probe-wins", checkRoutineConfig([{ name: "x", trigger: "every(2)", probe: "p", dispatch: "d" }], "x").ok === true, "probe + dispatch both present is fine (probe wins at dispatch)");
  check("config-missing", checkRoutineConfig(routinesFixture, "never-declared").ok === false, "undeclared routine rejected");
  check("config-bad-trigger", checkRoutineConfig([{ name: "x", trigger: "sometimes" }], "x").ok === false, "malformed trigger rejected");
  check("config-no-action", checkRoutineConfig([{ name: "x", trigger: "every(2)" }], "x").ok === false, "routine with no probe/dispatch rejected (scheduler would SKIP it)");
  check("config-not-array", checkRoutineConfig("nope", "x").ok === false, "non-array routines rejected");
  const nestedDoc = parseYaml("loop:\n  routines:\n    - name: external-dogfooding\n      trigger: every(8)\n      probe: external-dogfooding\n");
  check("extract-routines-nested", Array.isArray(extractRoutines(nestedDoc)) && extractRoutines(nestedDoc).length === 1, "loop.routines nesting extracted");
  check("extract-routines-flat", Array.isArray(extractRoutines(parseYaml("routines:\n  - name: x\n"))) && true, "flat routines: list extracted");
  check("extract-routines-none", extractRoutines(parseYaml("gates: [acceptance]\n")) === null, "no routines -> null (caller fails closed)");

  // ── target drivability ──
  const fixtureRegistry = parseRegistry("authorized_root: /home/yale/work\nworkspaces:\n  - path: /opt/outside/foreign\n");
  check("target-covered", checkTargetDrivable("/home/yale/work/archguard", fixtureRegistry).ok === true, "foreign target under authorized_root is drivable");
  check("target-explicit", checkTargetDrivable("/opt/outside/foreign", fixtureRegistry).ok === true, "explicit workspaces[] entry is drivable");
  check("target-uncovered", checkTargetDrivable("/tmp/x", fixtureRegistry).ok === false, "uncovered target rejected (fail-closed)");
  check("target-empty", checkTargetDrivable("", fixtureRegistry).ok === false, "empty target rejected");
  // Real registry round-trip (unconditional — a missing/moved registry must surface as a FAILURE):
  const realRegistryPath = path.resolve(__dirname, "..", "..", "experiments", "quay-perpetual-stream", "drivable-workspaces.yml");
  const realExists = fs.existsSync(realRegistryPath);
  check("real-registry-exists", realExists, `path=${realRegistryPath}`);
  const real = realExists ? loadRegistry(realRegistryPath) : { authorizedRoot: null, workspacePaths: [] };
  check("real-registry-covers-archguard", isCovered("/home/yale/work/archguard", real) === true, "real archguard entry covered");
  check("real-registry-rejects-tmp", isCovered("/tmp/x", real) === false, "real registry rejects /tmp/x");

  // ── remote-drive surface ──
  const pluginRoot = path.resolve(__dirname, "..");
  const surface = checkRemoteDriveSurface(pluginRoot);
  check("surface-present", surface.ok === true, `present=${JSON.stringify(surface.present)}`);
  const emptyDir = fs.mkdtempSync(path.join(fs.realpathSync(tmpdir()), "edog-surface-red-"));
  try {
    const redSurface = checkRemoteDriveSurface(emptyDir);
    check("surface-red", redSurface.ok === false && redSurface.missing.length === REMOTE_DRIVE_SURFACE.length, `missing all ${REMOTE_DRIVE_SURFACE.length} in empty dir`);
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }

  // ── finding shape ──
  const goodFinding = [
    "---",
    "id: GAP-ED-001",
    "title: \"dogfooding found a real friction\"",
    "status: todo",
    "labels:",
    "  - directive",
    "---",
    "## Finding",
    "Reproduced real friction: `quay task get` on archguard returned exit 1 when the foreign board",
    "uses a different id prefix. Evidence: node_modules/quay -- task get QX-999 on /home/yale/work/archguard.",
    "## Requested action",
    "1. Fix the id-prefix handling.",
  ].join("\n");
  const good = checkDirectiveFinding(goodFinding);
  check("finding-good", good.ok === true, "evidence-backed directive finding passes");
  check("finding-no-label", checkDirectiveFinding(goodFinding.replace("  - directive", "  - milestone-candidate")).ok === false, "non-directive label rejected (AC3)");
  check("finding-no-evidence", checkDirectiveFinding(goodFinding.replace("`quay task get`", "the CLI").replace("returned exit 1", "failed").replace("Evidence: node_modules/quay -- task get QX-999 on /home/yale/work/archguard.", "A friction happened.")).ok === false, "vague finding without evidence rejected");
  check("finding-empty", checkDirectiveFinding("").ok === false, "empty finding rejected");
  return st.report();
}

// ── Thin CLI ─────────────────────────────────────────────────────────────────────────────────────
function usage(): never {
  console.error("usage: node external-dogfooding-check.ts <mode> [args]");
  console.error("  --selftest");
  console.error("  --cadence <trigger>");
  console.error("  --routine-config <routines.yml> [--routine <name>]");
  console.error("  --target <path> --registry <file>");
  console.error("  --surface --plugin-root <dir>");
  console.error("  --finding <candidate-task.md>");
  console.error("  --check --routines <file> --target <path> --registry <file> --plugin-root <dir> [--finding <file>] [--routine <name>]");
  process.exit(2);
}

function readYamlFile(file: string): unknown {
  if (!fs.existsSync(file)) throw new Error(`file not found: ${file}`);
  return parseYaml(fs.readFileSync(file, "utf8"));
}

function printResult(name: string, ok: boolean, detail: string): boolean {
  if (ok) console.log(`PASS: ${name} — ${detail}`);
  else console.error(`FAIL: ${name} — ${detail}`);
  return ok;
}

async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit("usage: node external-dogfooding-check.ts <mode> [args]");

  if (args.includes("--selftest")) {
    return selftest() ? 0 : 1;
  }

  const flag = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };

  // --check: the combined contract gate (the invocation the tick docs use).
  if (args.includes("--check")) {
    const routinesFile = flag("--routines");
    const target = flag("--target");
    const registryFile = flag("--registry");
    const pluginRoot = flag("--plugin-root");
    const findingFile = flag("--finding");
    const routineName = flag("--routine") ?? "external-dogfooding";
    if (!routinesFile || !target || !registryFile || !pluginRoot) usage();

    const results: boolean[] = [];
    let routines: unknown[];
    try {
      const doc = readYamlFile(routinesFile);
      const extracted = extractRoutines(doc);
      if (extracted === null) {
        console.error(`FAIL: routine-config — no routines array found in ${routinesFile}`);
        results.push(false);
      } else {
        routines = extracted;
        results.push(printResult("routine-config", checkRoutineConfig(routines, routineName).ok, `routine "${routineName}" declared with cadence + action`));
      }
    } catch (e) {
      console.error(`FAIL: routine-config — ${(e as Error).message}`);
      results.push(false);
    }

    try {
      const registry = loadRegistry(registryFile);
      results.push(printResult("target", checkTargetDrivable(target, registry).ok, `foreign target ${target} authorized`));
    } catch (e) {
      console.error(`FAIL: target — ${(e as Error).message}`);
      results.push(false);
    }

    results.push(printResult("surface", checkRemoteDriveSurface(pluginRoot).ok, `ADR-016 drive surface in ${pluginRoot}`));

    if (findingFile) {
      try {
        const text = fs.readFileSync(findingFile, "utf8");
        const r = checkDirectiveFinding(text);
        results.push(printResult("finding", r.ok, r.reasons.length === 0 ? "evidence-backed directive finding" : r.reasons.join("; ")));
      } catch (e) {
        console.error(`FAIL: finding — ${(e as Error).message}`);
        results.push(false);
      }
    }

    return results.every(Boolean) ? 0 : 1;
  }

  if (args.includes("--cadence")) {
    const t = flag("--cadence");
    if (t === undefined) usage();
    const r = checkCadenceTrigger(t);
    return printResult("cadence", r.ok, r.ok ? JSON.stringify({ kind: r.kind, n: r.n, event: r.event }) : r.reason!) ? 0 : 1;
  }

  if (args.includes("--routine-config")) {
    const file = flag("--routine-config");
    const name = flag("--routine") ?? "external-dogfooding";
    if (!file) usage();
    try {
      const doc = readYamlFile(file);
      const extracted = extractRoutines(doc);
      if (extracted === null) {
        console.error(`FAIL: routine-config — no routines array found in ${file}`);
        return 1;
      }
      const r = checkRoutineConfig(extracted, name);
      return printResult("routine-config", r.ok, r.ok ? `routine "${name}" declared with cadence + action` : r.reason!) ? 0 : 1;
    } catch (e) {
      console.error(`FAIL: routine-config — ${(e as Error).message}`);
      return 1;
    }
  }

  if (args.includes("--target")) {
    const target = flag("--target");
    const registryFile = flag("--registry");
    if (target === undefined || !registryFile) usage();
    try {
      const registry = loadRegistry(registryFile);
      const r = checkTargetDrivable(target, registry);
      return printResult("target", r.ok, r.ok ? `${target} authorized` : r.reason!) ? 0 : 1;
    } catch (e) {
      console.error(`FAIL: target — ${(e as Error).message}`);
      return 1;
    }
  }

  if (args.includes("--surface")) {
    const pluginRoot = flag("--plugin-root");
    if (!pluginRoot) usage();
    const r = checkRemoteDriveSurface(pluginRoot);
    if (r.ok) {
      console.log(`PASS: surface — ADR-016 drive surface present: ${r.present.join(", ")}`);
      return 0;
    }
    console.error(`FAIL: surface — missing: ${r.missing.join(", ")}`);
    return 1;
  }

  if (args.includes("--finding")) {
    const file = flag("--finding");
    if (!file) usage();
    try {
      const text = fs.readFileSync(file, "utf8");
      const r = checkDirectiveFinding(text);
      if (r.ok) {
        console.log("PASS: finding — evidence-backed directive finding");
        return 0;
      }
      console.error(`FAIL: finding — ${r.reasons.join("; ")}`);
      return 1;
    } catch (e) {
      console.error(`FAIL: finding — ${(e as Error).message}`);
      return 1;
    }
  }

  usage();
}

if (isDirectEntry(import.meta, undefined, "external-dogfooding-check")) {
  main(process.argv).then((code) => process.exit(code));
}
