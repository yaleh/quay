// @test-group product
// ts-typecheck-gate-helpers.mjs — shared helpers for the ts-typecheck-gate test family.
//
// Split out of ts-typecheck-gate.test.mjs (gap-suite-split-long-multi-test-files): the original
// 110-line file carried 5 independent node:test cases that each invoke the SAME `npx tsc --noEmit`
// gate against THIS repo's real tsconfig.json. Splitting lets node:test's file-level concurrency
// run them in PARALLEL instead of one long sequential lane. Shared helpers live here so every split
// file resolves the SAME registry/CLI surface (the quay-init-loop split pattern).
//
// SPLIT CONCURRENCY SAFETY: each split file only reads THIS repo's real files (tsconfig.json,
// .quay/config.yml) — never writes shared state. The one test that writes a GateEvent log uses a
// per-file mkdtemp path, so no sibling file can collide.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { resolveGate, listGates } from "../src/gate/registry.ts";
import { QUAY_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const quayBin = QUAY_CLI;
// repo root: packages/quay/test -> repo root is 3 levels up.
export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

export const gate = (name) => resolveGate(name, REPO_ROOT);
export { listGates };

export function runQuay(args, cwd, extraEnv = {}) {
  try {
    const out = execFileSync("node", [quayBin, ...args], {
      encoding: "utf8",
      cwd,
      env: { ...process.env, ...extraEnv },
    });
    return { status: 0, stdout: out, stderr: "" };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? String(err) };
  }
}
