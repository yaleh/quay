// quay Core: single-source contract validator.
//
// document-store.js round-trips a document's `contracts` field VERBATIM
// (it does not interpret it — see that module's header comment). This module
// is the single place that actually EVALUATES those self-verifying
// assertions: `{ target: "self", type: "grep"|"not-grep", pattern,
// description }`. `target:"self"` means "check the document's OWN body" —
// this is the only target Stage 3 supports; anything else fails closed
// (documented as an explicit non-goal in the milestone plan/charter, not an
// oversight — a cross-document target would need its own store lookup and
// is out of scope here).
//
// `pattern` is matched via plain substring `.includes()` (not a RegExp) —
// the simplest match that satisfies every known real assertion so far;
// escalate to RegExp only when a real use case needs it (plan Stage 3 note).

/**
 * @param {{target?: string, type?: string, pattern?: string, description?: string}} entry
 * @param {string} body
 * @returns {{pattern: string|undefined, type: string|undefined, ok: boolean, description: string|undefined, reason?: string}}
 */
function evaluateOne(entry, body) {
  const { target, type, pattern, description } = entry ?? {};
  const base = { pattern, type, description };

  if (target !== "self") {
    return { ...base, ok: false, reason: `unsupported contract target ${JSON.stringify(target)} — only "self" is supported` };
  }
  if (type !== "grep" && type !== "not-grep") {
    return { ...base, ok: false, reason: `unknown contract type ${JSON.stringify(type)} — must be "grep" or "not-grep"` };
  }
  if (typeof pattern !== "string" || pattern === "") {
    return { ...base, ok: false, reason: "malformed contract entry: missing (or empty) `pattern`" };
  }

  const present = String(body ?? "").includes(pattern);
  const ok = type === "grep" ? present : !present;
  return { ...base, ok };
}

/**
 * Evaluate every entry in `doc.contracts` against `doc.body` (self-checks
 * only). Fails closed on any malformed/unsupported entry and when
 * `contracts` itself is present but not an array — a document's contracts
 * must never silently "pass" because they could not be understood.
 *
 * @param {{body?: string, contracts?: Array<object>}} doc
 * @returns {{ok: boolean, results: Array<{pattern?: string, type?: string, ok: boolean, description?: string, reason?: string}>}}
 */
export function validateContracts(doc) {
  const contracts = doc?.contracts;
  if (contracts === undefined) {
    return { ok: true, results: [] };
  }
  if (!Array.isArray(contracts)) {
    return { ok: false, results: [{ ok: false, reason: "contracts must be an array" }] };
  }
  const results = contracts.map((entry) => evaluateOne(entry, doc?.body));
  return { ok: results.every((r) => r.ok), results };
}
