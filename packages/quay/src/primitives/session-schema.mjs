// Schema validator for merged session records (AC-001).
//
// Two state dimensions — session.lifecycle and session.activity — must stay
// separate objects, each carrying its own source and a timestamp. This is
// the discipline docs/design/quay-fleet-design.md §3.2 exists to enforce:
// `claude agents --json` folds registry's `shell` into `busy`, losing a
// value the registry actually has. This validator refuses to let the agent
// repeat that fold at its own output boundary.
//
// goals/AC-001-*.md — able-to-be-falsified per its `expect`: merge the two
// dimensions into one top-level `status`, or drop source/observedAt, and
// this validator must report invalid.

const LIFECYCLE_VALUES = new Set(["working", "blocked", "done", "not-applicable", "unknown"]);
const ACTIVITY_VALUES = new Set(["busy", "idle", "shell", "unknown"]);
// AC-013 (phase-2 cross-machine prep): sessionKey must be tagged with the
// scope it was actually built with — "global" (pidDomain-prefixed, safe to
// aggregate across machines) or "local-only" (bare sessionId, no
// machine-scoping guarantee) — never silently unmarked either way.
const SESSION_KEY_SCOPES = new Set(["global", "local-only"]);

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate a merged session record's two-dimension state shape.
 * Never throws — callers assert on `.valid` and inspect `.errors` to see why
 * a record was rejected (including the deliberately-red negative controls).
 *
 * @param {unknown} record
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSessionRecord(record) {
  const errors = [];

  if (!isPlainObject(record)) {
    return { valid: false, errors: ["record is not an object"] };
  }

  // The exact folding this AC exists to forbid: a single top-level `status`
  // field standing in for both lifecycle and activity.
  if ("status" in record) {
    errors.push(
      "record has a folded top-level `status` field — lifecycle and activity must stay separate objects",
    );
  }

  if (!isPlainObject(record.lifecycle)) {
    errors.push("record.lifecycle is missing or not an object");
  } else {
    if (!LIFECYCLE_VALUES.has(record.lifecycle.value)) {
      errors.push(`record.lifecycle.value is not a known lifecycle value: ${record.lifecycle.value}`);
    }
    if (typeof record.lifecycle.source !== "string" || record.lifecycle.source === "") {
      errors.push("record.lifecycle.source is missing");
    }
    if (typeof record.lifecycle.observedAt !== "number") {
      errors.push("record.lifecycle.observedAt is missing or not a number");
    }
  }

  if (!SESSION_KEY_SCOPES.has(record.sessionKeyScope)) {
    errors.push(`record.sessionKeyScope is missing or invalid: ${record.sessionKeyScope}`);
  }

  if (!isPlainObject(record.activity)) {
    errors.push("record.activity is missing or not an object");
  } else {
    if (!ACTIVITY_VALUES.has(record.activity.value)) {
      errors.push(`record.activity.value is not a known activity value: ${record.activity.value}`);
    }
    if (typeof record.activity.source !== "string" || record.activity.source === "") {
      errors.push("record.activity.source is missing");
    }
    if (typeof record.activity.ageSec !== "number") {
      errors.push("record.activity.ageSec is missing or not a number");
    }
  }

  return { valid: errors.length === 0, errors };
}
