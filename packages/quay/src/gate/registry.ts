// Gate registry — name -> async gateFn(task, client) -> { ok, reason } (QENG-1).
//
// Ships exactly two true built-in gates, `dod` and `acceptance`, plus the
// product-owned `doc-*` gates (document-as-contract, D1). All 7 factory
// functions (makeIt0Gate, makeFixedScriptGate, makeAdrGate, makeTestPassGate,
// makeCoverageFloorGate, makeRedGreenGate, makeDocumentContractGate) and the
// workspace loader (loadWorkspaceGates, readGatesConfig, discoverWorkspaceRoot)
// now live in ./factories/ to keep this file under 150 lines (ARCH-M93-001).
//
// Public API is unchanged: all previously-exported symbols are still exported
// from this module (either defined here or re-exported from ./factories/).

import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAcceptance } from "./acceptance-runner.ts";
import { makeDocumentContractGate } from "./factories/document-contract.ts";
import { resolveRunnerOptions } from "./config/utils.ts";
import { discoverWorkspaceRoot, loadWorkspaceGates } from "./config/loader.ts";
import type { Task } from "../abi.ts";

// esbuild bundles this module to CJS for the SEA build (Node SEA does not
// support ESM main modules), where `import.meta.url` is unavailable and
// evaluates to `undefined` (esbuild warns, does not error) — crashing
// `fileURLToPath(undefined)` at module-init for every gate-touching command.
// Node's CJS module wrapper provides a real `__dirname` binding in that
// context, so prefer it when present (mirrors the src/version.ts /
// scripts/version-sea-shim.js dual-mode precedent) and fall back to the
// ESM-only computation otherwise.
declare const __dirname: string | undefined;
const moduleDir =
  typeof __dirname === "string" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
// packages/quay/src/gate -> repo root is 4 levels up. Used ONLY for the
// product's OWN built-in doc-gate data (DOCUMENT_GATE_IDS/DOCUMENTS_DIR
// below), which is genuinely product-owned, not research-specific.
const REPO_ROOT = path.resolve(moduleDir, "..", "..", "..", "..");

/** The verdict shape every gate function returns. */
export interface GateVerdict {
  ok: boolean;
  reason: string;
}

/**
 * A named gate definition: an async function that evaluates a task (and
 * optionally the provider client) and returns a pass/fail verdict.
 */
export interface GateDefinition {
  description?: string;
  onPass?: string;
  onFail?: string;
  check?: (task: Task, client: unknown) => Promise<GateVerdict>;
}

/** Type alias for a bare gate function (the common usage in the registry). */
export type GateFn = (task: Task, client: unknown) => Promise<GateVerdict>;

// Re-export loader symbols so existing importers of these from registry.ts
// continue to work unchanged (public API preservation).
export {
  loadWorkspaceGates,
  readGatesConfig,
  discoverWorkspaceRoot,
} from "./config/loader.ts";
export type { GatesConfig } from "./config/types.ts";

/**
 * Register a `doc-<name>` gate for a given document id + directory. Exported
 * so tests can register throwaway fixture gates the SAME way the module's
 * own DOCUMENT_GATE_IDS-driven loop below does.
 */
export function registerDocumentGate(gateName: string, docDir: string, docId: string): void {
  gateRegistry[gateName] = makeDocumentContractGate(docId, docDir);
}

const DOCUMENTS_DIR = path.join(REPO_ROOT, "docs-managed");

// D1: declarative table of which managed documents are wired as gates so far.
// Left baked in by design — product-owned, not research-specific data.
const DOCUMENT_GATE_IDS: Array<{ gateName: string; docId: string }> = [
  { gateName: "doc-quay-directive-skill", docId: "DOC-001" },
];

/**
 * name -> async (task, client) => { ok: boolean, reason: string }
 */
export const gateRegistry: Record<string, GateFn> = {
  dod: async (task: Task, client: unknown) => {
    const r = await (client as { taskCheck: (id: string) => Promise<{ ok: boolean; reason: string }> }).taskCheck(task.id);
    return { ok: r.ok === true, reason: r.reason };
  },
  acceptance: async (task: Task) => {
    const command = (task.extra as Record<string, unknown>)?.acceptance;
    if (typeof command !== "string" || command.trim() === "") {
      return {
        ok: false,
        reason: "no acceptance command defined (set with `quay task edit <id> --acceptance '<cmd>'`)",
      };
    }
    const { cwd, timeoutMs } = resolveRunnerOptions();
    const { ok, reason } = runAcceptance({ command, cwd, timeoutMs });
    return { ok, reason };
  },
};

// D1: register one `doc-<name>` gate per DOCUMENT_GATE_IDS entry.
for (const { gateName, docId } of DOCUMENT_GATE_IDS) {
  registerDocumentGate(gateName, DOCUMENTS_DIR, docId);
}

/**
 * Resolve a gate function by name for `workspaceRoot` — the single lookup
 * point used by both `listGates` and the engine (`engine.js#runGate`). Checks
 * the product's own baked-in `gateRegistry` FIRST (built-ins + doc-* gates
 * always win a name collision), then falls back to this workspace's own
 * `gates.yml`-declared gates.
 */
export function resolveGate(name: string, workspaceRoot: string | null = discoverWorkspaceRoot()): GateFn | undefined {
  if (gateRegistry[name]) return gateRegistry[name];
  return loadWorkspaceGates(workspaceRoot)[name];
}

/**
 * @param workspaceRoot defaults to `discoverWorkspaceRoot()`
 * @returns registered gate names (built-ins + this workspace's own `gates.yml`-declared gates)
 */
export function listGates(workspaceRoot: string | null = discoverWorkspaceRoot()): string[] {
  return [...Object.keys(gateRegistry), ...Object.keys(loadWorkspaceGates(workspaceRoot))];
}
