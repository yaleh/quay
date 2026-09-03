// @instrument "What is the shared dispatcher framework that the six grouped instrument entry points use to preserve each member's CLI byte-for-byte?"
// quay-entry-base.ts — shared dispatcher framework for the 6 GROUPED instrument entry points
// (gap-ac8-import-over-spawn-ticked-while-its-own-evidence-says-not-in-effect, AC2; SPEC-instruments-
// behind-one-entry.md AC8/AC12). The 40 remembered-path/spawn entry points are consolidated behind
// six entry modules: quay-session / quay-deliver / quay-dispatch / quay-branch / quay-suite /
// quay-check. Each is the SAME shape:
//
//   node --experimental-strip-types plugin/scripts/quay-<group>.ts <instrument> [args...]
//   import { list, has, run, GROUP } from "../scripts/quay-<group>.ts";   // in-process reuse
//
// WHY spawn (not in-process call) inside the entry point: the member instruments have heterogeneous
// entry shapes (exported `main(argv)`, `runCli(argv.slice(2))`, bare `process.argv[1]` guards, and
// real bash scripts). Re-invoking the canonical member file under its own interpreter preserves each
// member's CLI contract BYTE-FOR-BYTE — the entry point's job is to shrink the SURFACE (40 → 6), not
// to change any instrument's behavior. The "import over spawn" policy (SPEC AC7/AC9) is enacted at
// the TEST layer: a test imports this module and injects an `exec` seam, so the DISPATCH logic is
// tested in-process with zero subprocesses — and the member logic tests that convert to direct
// `import` stop paying the spawn cost. The `exec` seam (DIR-049 injectable-exec style, as in
// cap-from-gate.ts's env seams) is what makes that possible.
//
// Run:
//   node --experimental-strip-types plugin/scripts/quay-<group>.ts list
//   node --experimental-strip-types plugin/scripts/quay-<group>.ts <instrument> [args...]
//   scripts/test.sh plugin/test/quay-<group>.test.mjs

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";export interface InstrumentSpec {
  /** subcommand name (bare — no extension) as used by the docs / entry-point CLI. */
  name: string;
  /** file name under plugin/scripts (e.g. "session-observation.sh"). */
  file: string;
  kind: "bash" | "ts" | "mjs";
  /** what question does this instrument answer (the directory's admission contract, SPEC AC4). */
  description: string;
  /** optional per-args routing: e.g. claim-task uses the .ts touch-checker for --task, the .sh
   *  claim primitive otherwise. Defaults to the spec's own file/kind. */
  resolve?: (args: string[]) => { file: string; kind: "bash" | "ts" | "mjs" };
}

export interface ExecResult { status: number; stdout: string; stderr: string; }
/** Injectable subprocess seam (tests inject a fake; production uses spawnSync). */
export type ExecFn = (
  command: string,
  argv: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv },
) => ExecResult;

/** The production exec: spawn the member's own interpreter, capture stdout/stderr, propagate exit. */
export const defaultExec: ExecFn = (command, argv, opts) => {
  const res = spawnSync(command, argv, { cwd: opts.cwd, env: opts.env, encoding: "utf8" });
  return { status: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
};

/** Interpret the member's argv: [interpreter..., member.<ext>, args...] → spawn command. */
function buildSpawn(spec: InstrumentSpec, args: string[], scriptDir: string): { command: string; argv: string[] } {
  const target = path.join(scriptDir, spec.file);
  if (spec.kind === "bash") return { command: "bash", argv: [target, ...args] };
  return { command: process.execPath, argv: ["--no-warnings", "--experimental-strip-types", target, ...args] };
}

export interface EntryPoint {
  GROUP: string;
  MEMBERS: InstrumentSpec[];
  list(): InstrumentSpec[];
  has(name: string): boolean;
  run(name: string, args: string[], opts?: {
    scriptDir: string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    exec?: ExecFn;
  }): ExecResult;
  /** CLI entry. `metaUrl` must be the ENTRY POINT module's own import.meta.url (so member paths
   *  resolve relative to plugin/scripts/, not the caller's cwd). */
  runCli(argv: string[], metaUrl: string): number;
}

export function createEntryPoint(group: string, members: InstrumentSpec[]): EntryPoint {
  const byName = new Map<string, InstrumentSpec>(members.map((m) => [m.name, m]));
  const sorted = [...members].sort((a, b) => a.name.localeCompare(b.name));
  const entry: EntryPoint = {
    GROUP: group,
    MEMBERS: members,
    list(): InstrumentSpec[] {
      return members.map((m) => ({ ...m }));
    },
    has(name: string): boolean {
      return byName.has(name);
    },
    run(name: string, args: string[], opts = { scriptDir: "" }): ExecResult {
      const spec = byName.get(name);
      if (!spec) {
        return {
          status: 2,
          stdout: "",
          stderr: `${group}: no such instrument "${name}" (known: ${sorted.map((m) => m.name).join(", ")})`,
        };
      }
      const scriptDir = opts.scriptDir || path.dirname(fileURLToPath(import.meta.url));
      const resolved = spec.resolve ? spec.resolve(args) : spec;
      const eff: InstrumentSpec = { ...spec, file: resolved.file, kind: resolved.kind };
      const { command, argv } = buildSpawn(eff, args, scriptDir);
      const exec = opts.exec ?? defaultExec;
      return exec(command, argv, { cwd: opts.cwd ?? scriptDir, env: opts.env });
    },
    runCli(argv: string[], metaUrl: string): number {
      const raw = argv.slice(2);
      if (raw.length === 0) {
        console.error(`${group}: usage — plugin/scripts/${group}.ts <instrument> [args...]`);
        console.error(`known instruments: ${sorted.map((m) => `${m.name}(${m.kind})`).join(", ")}`);
        return 2;
      }
      const [name, ...rest] = raw;
      if (name === "list" || name === "--list") {
        for (const m of sorted) console.log(`${m.name}\t${m.kind}\t${m.description}`);
        return 0;
      }
      if (name === "--help" || name === "-h" || name === "help") {
        console.log(`${group}: grouped instrument entry (SPEC AC12) — ${sorted.length} instruments`);
        console.log(`usage: plugin/scripts/${group}.ts <instrument> [args...]   |   plugin/scripts/${group}.ts list`);
        return 0;
      }
      const scriptDir = path.dirname(fileURLToPath(metaUrl));
      const result = entry.run(name, rest, { scriptDir, cwd: process.cwd() });
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      return result.status;
    },
  };
  return entry;
}
