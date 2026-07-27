// composite-preflight.ts — M189/DIR-119-B Stage 2.1/2.2 wiring: the CLI entry point
// `execute-milestone`'s workflow shells out to (mirroring how `select-preflight.ts` is invoked
// from `select-preflight.js`, since workflow DSL scripts have no `import` capability — only
// `phase`/`agent`/`parallel`/`log`/`args` globals, so real logic lives here, not inline in the
// workflow file).
//
// Combines:
//   1. composite-args.ts's `normalizeExecuteArgs` — accepts legacy `{taskId,...}` OR new
//      `{milestoneCandidate:{taskIds,...}, compositeManifestFile,...}`, normalized to one
//      non-empty `taskIds` array. NEVER rejects on array length.
//   2. composite-contracts.ts's `checkCompositeContract` — ONLY run when the call is composite
//      AND a `compositeManifestFile` was supplied (a legacy singleton call skips this entirely —
//      vacuous pass, golden-replay preserved).
//
// Usage:
//   node --experimental-strip-types experiments/quay-perpetual-stream/scripts/composite-preflight.ts \
//     --args-json '<JSON of the workflow $a object>' [--current-hashes-json '<JSON map>']
//
// The `compositeManifestFile`, if given, must be a JSON file shaped `{manifest, context}` matching
// `CompositeManifest`/`CompositeContext` from composite-contracts.ts.
//
// Exit 0 + prints `{ok:true, taskIds, isComposite, contractViolations:[]}` on success.
// Exit 1 + prints `{ok:false, code, message}` (arg-normalization failure) or
//   `{ok:false, taskIds, isComposite, contractViolations:[...]}` (contract failure) on failure.

import fs from "node:fs";
import { normalizeExecuteArgs, ExecuteArgsError, type RawExecuteArgs } from "./composite-args.ts";
import { checkCompositeContract, type CompositeManifest, type CompositeContext } from "./composite-contracts.ts";
import { isDirectEntry } from "./gate-script-base.ts";

export interface PreflightResult {
  ok: boolean;
  code?: string;
  message?: string;
  taskIds?: string[];
  isComposite?: boolean;
  contractViolations?: string[];
}

export function runPreflight(rawArgsJson: string, currentHashesJson?: string): PreflightResult {
  let raw: RawExecuteArgs;
  try {
    raw = JSON.parse(rawArgsJson);
  } catch (e) {
    return { ok: false, code: "invalid-json", message: `--args-json did not parse: ${(e as Error).message}` };
  }

  let currentSourceHashes: Record<string, string> | undefined;
  if (currentHashesJson) {
    try {
      currentSourceHashes = JSON.parse(currentHashesJson);
    } catch (e) {
      return { ok: false, code: "invalid-json", message: `--current-hashes-json did not parse: ${(e as Error).message}` };
    }
  }

  let normalized;
  try {
    normalized = normalizeExecuteArgs(raw, { currentSourceHashes });
  } catch (e) {
    if (e instanceof ExecuteArgsError) {
      return { ok: false, code: e.code, message: e.message };
    }
    throw e;
  }

  // Legacy singleton path, or new-shape without a manifest file: vacuous pass — the mechanical
  // contract checker only applies when there is an actual manifest to check (golden replay for
  // the pre-existing single-task path is otherwise untouched by this preflight step).
  if (!normalized.isComposite || !normalized.compositeManifestFile) {
    return { ok: true, taskIds: normalized.taskIds, isComposite: normalized.isComposite, contractViolations: [] };
  }

  if (!fs.existsSync(normalized.compositeManifestFile)) {
    return { ok: false, code: "manifest-not-found", message: `compositeManifestFile does not exist: ${normalized.compositeManifestFile}` };
  }

  let combined: { manifest: CompositeManifest; context: CompositeContext };
  try {
    combined = JSON.parse(fs.readFileSync(normalized.compositeManifestFile, "utf8"));
  } catch (e) {
    return { ok: false, code: "manifest-invalid-json", message: `compositeManifestFile did not parse: ${(e as Error).message}` };
  }

  const contractResult = checkCompositeContract(combined.manifest, combined.context);
  return {
    ok: contractResult.ok,
    taskIds: normalized.taskIds,
    isComposite: true,
    contractViolations: contractResult.violations,
  };
}

// ── CLI entry ──────────────────────────────────────────────────────────────────────────────────────

function parseCliFlag(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= argv.length) return undefined;
  return argv[idx + 1];
}

function main(argv: string[]): number {
  const argsJson = parseCliFlag(argv, "args-json");
  if (!argsJson) {
    console.error("Usage: composite-preflight.ts --args-json '<json>' [--current-hashes-json '<json>']");
    return 2;
  }
  const currentHashesJson = parseCliFlag(argv, "current-hashes-json");
  const result = runPreflight(argsJson, currentHashesJson);
  console.log(JSON.stringify(result));
  return result.ok ? 0 : 1;
}

if (isDirectEntry(import.meta) && !process.argv.includes("--selftest")) {
  process.exitCode = main(process.argv);
}

// ── selftest ───────────────────────────────────────────────────────────────────────────────────────

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

  // Legacy call: vacuous pass, taskIds:[taskId].
  {
    const result = runPreflight(JSON.stringify({ taskId: "DIR-1", charterFile: "c.md" }));
    check("legacy-vacuous-pass", result.ok === true && JSON.stringify(result.taskIds) === '["DIR-1"]' && result.isComposite === false, JSON.stringify(result));
  }

  // Invalid JSON input.
  {
    const result = runPreflight("{not json");
    check("invalid-json-rejected", result.ok === false && result.code === "invalid-json", JSON.stringify(result));
  }

  // New shape, no manifest file given: vacuous pass at any width.
  {
    const result = runPreflight(JSON.stringify({ milestoneCandidate: { taskIds: ["A", "B", "C"] } }));
    check("new-shape-no-manifest-vacuous-pass", result.ok === true && result.taskIds?.length === 3 && result.isComposite === true, JSON.stringify(result));
  }

  // Duplicate task id rejected before any manifest is even considered.
  {
    const result = runPreflight(JSON.stringify({ milestoneCandidate: { taskIds: ["A", "A"] } }));
    check("duplicate-task-id-rejected", result.ok === false && result.code === "duplicate-task-id", JSON.stringify(result));
  }

  // Manifest file not found.
  {
    const result = runPreflight(JSON.stringify({ milestoneCandidate: { taskIds: ["A"] }, compositeManifestFile: "/nonexistent/manifest.json" }));
    check("manifest-not-found-rejected", result.ok === false && result.code === "manifest-not-found", JSON.stringify(result));
  }

  console.log(`\nSELFTEST: ${allPassed ? "all fixture cases PASS" : "SOME FIXTURES FAILED"}`);
  return allPassed;
}

if (isDirectEntry(import.meta) && process.argv.includes("--selftest")) {
  process.exitCode = selftest() ? 0 : 1;
}
