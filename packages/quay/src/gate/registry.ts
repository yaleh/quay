// Gate registry — name -> async gateFn(task, client) -> { ok, reason } (QENG-1).

import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAcceptance } from "./acceptance-runner.ts";
import { makeDocumentContractGate } from "./factories/document-contract.ts";
import { makeGoalGate } from "./factories/goal.ts";
import { resolveRunnerOptions } from "./config/utils.ts";
import { discoverWorkspaceRoot, loadWorkspaceGates, loadWorkspaceGateMetadata } from "./config/loader.ts";
import type { Task } from "../abi.ts";

declare const __dirname;
var moduleDir = typeof __dirname === "string" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
// REPO_ROOT is workspace-root-relative: discover from the module location so
// it resolves identically under the source tree (src/gate/) and the bundled
// dist (dist/) — a fixed up-4 walk is wrong under the dist bundle location.
var REPO_ROOT = discoverWorkspaceRoot(moduleDir) ?? path.resolve(moduleDir, "..", "..", "..", "..");

export interface GateVerdict { ok: boolean; reason: string; }
export interface GateDefinition { description?: string; onPass?: string; onFail?: string; check?: (task: Task, client: unknown) => Promise<GateVerdict>; }
export type GateFn = (task: Task, client: unknown) => Promise<GateVerdict>;

export { loadWorkspaceGates, readGatesConfig, discoverWorkspaceRoot, loadWorkspaceGateMetadata } from "./config/loader.ts";
export type { GatesConfig } from "./config/types.ts";

export function registerDocumentGate(gateName, docDir, docId) {
  gateRegistry[gateName] = makeDocumentContractGate(docId, docDir);
}

export function registerGoalGate(gateName, goalDir, goalId) {
  gateRegistry[gateName] = makeGoalGate(goalId, goalDir);
}

var DOCUMENTS_DIR = path.join(REPO_ROOT, "docs-managed");
var DOCUMENT_GATE_IDS = [{ gateName: "doc-quay-directive-skill", docId: "DOC-001" }];

// Goal gates: no DEFAULT registration — per SPEC §5 the active AC set (AC20-35) is NOT
// migrated until the kind + /goal route land, and the disposition of the four unclosed
// phases (AC10/AC12/AC16/AC17/AC20) is a human adjudication, not a mechanical default.
// A workspace/goal gate is registered dynamically via registerGoalGate (or gates.yml).

export var gateRegistry = {
  dod: async function(task, client) {
    var r = await client.taskCheck(task.id);
    return { ok: r.ok === true, reason: r.reason };
  },
  acceptance: async function(task) {
    var command = (task.extra || {}).acceptance;
    if (typeof command !== "string" || command.trim() === "") {
      return { ok: false, reason: "no acceptance command defined (set with `quay task edit <id> --acceptance '<cmd>'`)" };
    }
    var opts = resolveRunnerOptions();
    var result = runAcceptance({ command: command, cwd: opts.cwd, timeoutMs: opts.timeoutMs, envFile: opts.envFile });
    return { ok: result.ok, reason: result.reason };
  },
};

for (var i = 0; i < DOCUMENT_GATE_IDS.length; i++) {
  var dg = DOCUMENT_GATE_IDS[i];
  registerDocumentGate(dg.gateName, DOCUMENTS_DIR, dg.docId);
}

export function resolveGate(name, workspaceRoot) {
  if (workspaceRoot === undefined) workspaceRoot = discoverWorkspaceRoot();
  if (gateRegistry[name]) return gateRegistry[name];
  return loadWorkspaceGates(workspaceRoot)[name];
}

export function listGates(workspaceRoot) {
  if (workspaceRoot === undefined) workspaceRoot = discoverWorkspaceRoot();
  return Object.keys(gateRegistry).concat(Object.keys(loadWorkspaceGates(workspaceRoot)));
}

export function listGatesVerbose(workspaceRoot) {
  if (workspaceRoot === undefined) workspaceRoot = discoverWorkspaceRoot();
  var meta = loadWorkspaceGateMetadata(workspaceRoot);
  var builtInRows = Object.keys(gateRegistry).map(function(name) {
    var isDod = name === "dod";
    var isAcc = name === "acceptance";
    return {
      name: name,
      source: "built-in",
      type: isDod ? "dod" : isAcc ? "acceptance" : "doc",
      detail: isDod ? "(delegates to task.taskCheck)" :
              isAcc ? "(runs task.extra.acceptance)" :
              "(skill: " + name.replace(/^doc-/, "") + ")",
    };
  });
  var builtInNames = new Set(Object.keys(gateRegistry));
  var wsRows = meta.rows.filter(function(r) { return !builtInNames.has(r.name); });
  return { rows: builtInRows.concat(wsRows), diagnostics: meta.diagnostics };
}
