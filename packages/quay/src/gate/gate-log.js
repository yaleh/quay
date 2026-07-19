// Read-only CLI wrapper over `queryGateEvents` (QENG-1). Port of epicd
// `src/engine/gate-log.ts`. The ONE place that turns CLI-shaped options into a
// GateEventFilter and resolves the default log path, so the CLI, and any future
// Web/MCP read surface, share a single query implementation (proposal §Risks:
// log-path drift). Never appends.

import path from "node:path";
import { queryGateEvents } from "./gate-event-store.js";

/** Default gate-event log location, relative to the workspace root. */
export const DEFAULT_GATE_LOG_RELATIVE_PATH = path.join(".quay", "gate-events.jsonl");

/**
 * @typedef {Object} GateLogQueryOptions
 * @property {string=} file  explicit log path; overrides the default
 * @property {string=} pipelineId
 * @property {string=} gate
 * @property {string=} actor
 * @property {string=} since
 * @property {string=} until
 * @property {string|number=} limit
 * @property {string|number=} offset
 */

/** @param {string|number|undefined} value */
function toInt(value) {
  if (value === undefined) return undefined;
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Resolve the log path: `opts.file` if set, else
 * `<workspaceRoot>/.quay/gate-events.jsonl`.
 *
 * @param {string} workspaceRoot
 * @param {GateLogQueryOptions} [opts]
 * @returns {string}
 */
export function resolveGateLogPath(workspaceRoot, opts = {}) {
  if (opts.file) return opts.file;
  return path.join(workspaceRoot, DEFAULT_GATE_LOG_RELATIVE_PATH);
}

/**
 * Run a read-only gate-event query. Pure pass-through onto `queryGateEvents`.
 *
 * @param {string} workspaceRoot
 * @param {GateLogQueryOptions} [opts]
 * @returns {import("./gate-event-store.js").GateEvent[]}
 */
export function runGateLogQuery(workspaceRoot, opts = {}) {
  return queryGateEvents(resolveGateLogPath(workspaceRoot, { file: opts.file }), {
    pipeline_id: opts.pipelineId,
    gate: opts.gate,
    actor: opts.actor,
    since: opts.since,
    until: opts.until,
    limit: toInt(opts.limit),
    offset: toInt(opts.offset),
  });
}
