#!/usr/bin/env node
// human-steered-classify.ts — DIR-062 child A [halt-free]: a pure function computing a task's
// `human-steered` verdict from DIR-062's 3 clauses:
//   1. touches a DRIVER FILE (OUTER-LOOP.md / inherited-core.md / the loop's own skills under
//      .claude/skills/ — a driver-self-rewrite is unsafe to run autonomously mid-loop, the
//      bootstrap hazard OUTER-LOOP.md's own SELECT step names).
//   2. a declared MISSION-REDIRECTION marker (a judgment input, not a file fact — the caller
//      supplies it, e.g. from a task's `extra.missionRedirection` field).
//   3. drives a workspace NOT covered by `drivable-workspaces.yml` (reuses
//      drivable-workspace-check.ts's `isCovered`/`loadRegistry` as a LIBRARY function — no
//      subprocess spawn, no re-implemented coverage logic).
// A task is `human-steered` iff ANY of the 3 clauses fires — mirrors OUTER-LOOP.md's own
// `label:human-steered` exclusion-from-autonomous-SELECT convention; this script is the
// executable form of that judgment call, not a replacement for the label itself.
//
// Usage (library): import { classify } from "./human-steered-classify.ts"
// Usage (CLI):
//   node human-steered-classify.ts --touched <file> [--touched <file> ...]
//                                   --workspace <path> [--workspace <path> ...]
//                                   [--mission-redirection] [--registry <file>]
//   node human-steered-classify.ts --selftest
//
// Exit codes: 0 = ran successfully (verdict printed as JSON; NOT an ok/fail signal — this is a
//   classifier, not a pass/fail gate); 1 = selftest failed; 2 = usage error.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRegistry, isCovered, DEFAULT_REGISTRY_PATH, DrivableCheckEnvError, type Registry } from "./drivable-workspace-check.ts";

// Driver files: OUTER-LOOP.md, inherited-core.md (anywhere under experiments/quay-perpetual-stream/,
// matched by basename so both root-relative and absolute paths work), and the loop's own skills
// under `.claude/skills/` (inner-iteration prompts / ABSORB-format templates the loop itself reads).
const DRIVER_FILE_BASENAMES = new Set(["OUTER-LOOP.md", "inherited-core.md"]);
const DRIVER_PATH_SEGMENT = `${path.sep}.claude${path.sep}skills${path.sep}`;
const DRIVER_PATH_PREFIX = `.claude${path.sep}skills${path.sep}`;

export function touchesDriverFile(filePath: string): boolean {
  if (typeof filePath !== "string" || filePath.trim() === "") return false;
  const normalized = filePath.replace(/\//g, path.sep);
  if (DRIVER_FILE_BASENAMES.has(path.basename(normalized))) return true;
  return normalized.includes(DRIVER_PATH_SEGMENT) || normalized.startsWith(DRIVER_PATH_PREFIX);
}

export interface ClassifyInput {
  touchedFiles?: string[];
  missionRedirection?: boolean;
  drivenWorkspaces?: string[];
  registry?: Registry;
}

export interface ClassifyResult {
  humanSteered: boolean;
  clauses: {
    driverFileEdit: boolean;
    missionRedirection: boolean;
    unauthorizedWorkspace: boolean;
  };
  unauthorizedWorkspaces: string[];
}

// ── classify — the pure decision function. `registry` is injected (not loaded internally) so
// callers/tests control it explicitly; the CLI below loads the real DEFAULT_REGISTRY_PATH. ────────
export function classify(input: ClassifyInput): ClassifyResult {
  const touchedFiles = input.touchedFiles ?? [];
  const missionRedirection = input.missionRedirection === true;
  const drivenWorkspaces = input.drivenWorkspaces ?? [];
  const registry: Registry = input.registry ?? { authorizedRoot: null, workspacePaths: [] };

  const driverFileEdit = touchedFiles.some((f) => touchesDriverFile(f));
  const unauthorizedWorkspaces = drivenWorkspaces.filter((w) => !isCovered(w, registry));
  const unauthorizedWorkspace = unauthorizedWorkspaces.length > 0;

  return {
    humanSteered: driverFileEdit || missionRedirection || unauthorizedWorkspace,
    clauses: { driverFileEdit, missionRedirection, unauthorizedWorkspace },
    unauthorizedWorkspaces,
  };
}

// ── selftest — embedded RED+GREEN fixture suite. ────────────────────────────────────────────────
export function selftest(): boolean {
  let allPassed = true;
  function check(name: string, condition: boolean, detail: string): void {
    if (condition) {
      console.log(`SELFTEST PASS: ${name} — ${detail}`);
    } else {
      console.error(`SELFTEST FAIL: ${name} — ${detail}`);
      allPassed = false;
    }
  }

  const registry: Registry = { authorizedRoot: "/home/yale/work", workspacePaths: [] };

  // GREEN 1: editing OUTER-LOOP.md -> humanSteered:true, driverFileEdit clause fires.
  const r1 = classify({ touchedFiles: ["experiments/quay-perpetual-stream/OUTER-LOOP.md"], registry });
  check("edits-outer-loop-md", r1.humanSteered === true && r1.clauses.driverFileEdit === true, JSON.stringify(r1));

  // GREEN 2: editing inherited-core.md -> humanSteered:true (basename match, nested path).
  const r2 = classify({ touchedFiles: ["experiments/quay-perpetual-stream/inherited-core.md"], registry });
  check("edits-inherited-core-md", r2.humanSteered === true && r2.clauses.driverFileEdit === true, JSON.stringify(r2));

  // GREEN 3: editing a loop skill under .claude/skills/ -> humanSteered:true.
  const r3 = classify({ touchedFiles: [".claude/skills/quay-directive/SKILL.md"], registry });
  check("edits-loop-skill", r3.humanSteered === true && r3.clauses.driverFileEdit === true, JSON.stringify(r3));

  // GREEN 4: mission-redirection flag alone -> humanSteered:true.
  const r4 = classify({ missionRedirection: true, registry });
  check("mission-redirection-flag", r4.humanSteered === true && r4.clauses.missionRedirection === true, JSON.stringify(r4));

  // GREEN 5: driving an unlisted workspace -> humanSteered:true.
  const r5 = classify({ drivenWorkspaces: ["/opt/some-other-place"], registry });
  check("unauthorized-workspace", r5.humanSteered === true && r5.clauses.unauthorizedWorkspace === true, JSON.stringify(r5));

  // RED 1: driving ONLY /home/yale/work/* with no driver edit, no mission-redirection -> false.
  const r6 = classify({
    touchedFiles: ["packages/quay/src/gate/registry.ts"],
    drivenWorkspaces: ["/home/yale/work/quay", "/home/yale/work/archguard"],
    registry,
  });
  check("clean-milestone-not-human-steered", r6.humanSteered === false, JSON.stringify(r6));

  // RED 2: no inputs at all -> false (vacuously not human-steered).
  const r7 = classify({});
  check("no-inputs-not-human-steered", r7.humanSteered === false, JSON.stringify(r7));

  // Edge: a file merely containing "OUTER-LOOP" as a substring elsewhere in its NAME (not the
  // exact driver basename) must NOT false-positive — e.g. a hypothetical
  // "OUTER-LOOP-notes-draft.md" is a DIFFERENT file, not the driver itself.
  const r8 = classify({ touchedFiles: ["experiments/quay-perpetual-stream/OUTER-LOOP-notes-draft.md"], registry });
  check("similar-name-not-driver-file", r8.clauses.driverFileEdit === false, JSON.stringify(r8));

  if (allPassed) {
    console.log("SELFTEST: all fixture cases PASS.");
    return true;
  }
  console.error("SELFTEST: one or more fixture cases FAILED.");
  return false;
}

// ── Thin CLI ─────────────────────────────────────────────────────────────────────────────────────
function usage(): never {
  console.error(
    "usage: node human-steered-classify.ts --touched <file> [--touched <file> ...] " +
      "--workspace <path> [--workspace <path> ...] [--mission-redirection] [--registry <file>]",
  );
  console.error("       node human-steered-classify.ts --selftest");
  process.exit(2);
}

async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  if (args.includes("--selftest")) {
    return selftest() ? 0 : 1;
  }

  const touchedFiles: string[] = [];
  const drivenWorkspaces: string[] = [];
  let missionRedirection = false;
  let registryPath = DEFAULT_REGISTRY_PATH;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--touched":
        touchedFiles.push(args[++i]);
        break;
      case "--workspace":
        drivenWorkspaces.push(args[++i]);
        break;
      case "--mission-redirection":
        missionRedirection = true;
        break;
      case "--registry":
        registryPath = args[++i];
        break;
      default:
        usage();
    }
  }
  if (touchedFiles.length === 0 && drivenWorkspaces.length === 0 && !missionRedirection) usage();

  let registry: Registry = { authorizedRoot: null, workspacePaths: [] };
  if (drivenWorkspaces.length > 0) {
    try {
      registry = loadRegistry(registryPath);
    } catch (e) {
      if (e instanceof DrivableCheckEnvError) {
        console.error(e.message);
        return e.exitCode;
      }
      throw e;
    }
  }

  const result = classify({ touchedFiles, missionRedirection, drivenWorkspaces, registry });
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirect) {
  main(process.argv).then((code) => process.exit(code));
}
