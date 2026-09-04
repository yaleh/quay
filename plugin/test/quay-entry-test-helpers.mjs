// quay-entry-test-helpers.mjs — shared helpers for the quay-<group> entry-point tests
// (gap-ac8-import-over-spawn-ticked-while-its-own-evidence-says-not-in-effect AC1/AC2). These tests
// are PURE-IMPORT: they import the entry point module and inject an `exec` seam, so the dispatch
// logic is exercised in-process with ZERO subprocesses (the "import over spawn" policy in effect).

import path from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute plugin/scripts/ dir (so the entry point resolves member files). */
export function scriptsDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts");
}

/** A fake exec that records the (command, argv, cwd) it was asked to run and returns a canned result. */
export function makeFakeExec(record) {
  return (command, argv, opts) => {
    record.push({ command, argv, cwd: opts.cwd });
    return { status: 0, stdout: "fake-ok", stderr: "" };
  };
}

/** Assert the member name set exactly equals the given names (pins the SPEC AC12 grouping). */
export function assertMembers(existing, expected) {
  const names = existing.map((m) => m.name).sort();
  const want = [...expected].sort();
  return JSON.stringify(names) === JSON.stringify(want);
}
