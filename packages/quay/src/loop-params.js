// loop-params.js — reads and validates .quay/loop.yml for the loop-driver skill (DIR-045).
//
// Contract: readLoopParams(workspaceRoot) → LoopParams | throws Error("FAIL-CLOSED: ...")
//
// FAIL-CLOSED: missing file, malformed YAML, or missing required fields ALL throw.
// A skill that cannot read its params refuses to run — no silent defaults for
// the required fields (board, gates). Optional fields (stop, policy, coexist)
// have safe defaults.
//
// Schema (.quay/loop.yml):
//   board:   string   REQUIRED — provider name (e.g. "native")
//   gates:   string|string[]  REQUIRED — gate name(s) refs into .quay/gates.yml
//   stop:    string   OPTIONAL — "once" | "until(.halt)" | "until(empty)" | default "once"
//   policy:  string   OPTIONAL — select-ranking policy; default "ready-first"
//   coexist: string|null OPTIONAL — pause-hook (e.g. "pause(backlog/.loop-stop)"); default null
//
// Valid `stop` values: "once", "until(.halt)", "until(empty)", or until(K·ΔV<ε) prefix.

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const VALID_STOP_RE = /^(once|until\(.+\))$/;

/**
 * Read and validate `.quay/loop.yml` from workspaceRoot.
 * Throws Error("FAIL-CLOSED: ...") on any validation failure.
 *
 * @param {string} workspaceRoot
 * @returns {{ board: string, gates: string[], stop: string, policy: string, coexist: string|null }}
 */
export function readLoopParams(workspaceRoot) {
  const loopYmlPath = path.join(workspaceRoot, ".quay", "loop.yml");

  // 1. File must exist
  if (!fs.existsSync(loopYmlPath)) {
    throw new Error(
      `FAIL-CLOSED: .quay/loop.yml not found at ${loopYmlPath} — skill refuses to run without params`
    );
  }

  // 2. Must parse as valid YAML
  let parsed;
  try {
    parsed = YAML.parse(fs.readFileSync(loopYmlPath, "utf8"));
  } catch (e) {
    throw new Error(
      `FAIL-CLOSED: .quay/loop.yml is malformed YAML — ${e.message}`
    );
  }

  // 3. Required: board
  if (!parsed?.board || typeof parsed.board !== "string" || !parsed.board.trim()) {
    throw new Error(
      `FAIL-CLOSED: .quay/loop.yml missing required field 'board' (provider name, e.g. "native")`
    );
  }

  // 4. Required: gates
  if (parsed?.gates === undefined || parsed?.gates === null) {
    throw new Error(
      `FAIL-CLOSED: .quay/loop.yml missing required field 'gates' (gate name or list, e.g. [vitest])`
    );
  }

  // 5. Normalize gates to array
  let gates;
  if (Array.isArray(parsed.gates)) {
    gates = parsed.gates;
  } else if (typeof parsed.gates === "string" && parsed.gates.trim()) {
    gates = [parsed.gates.trim()];
  } else {
    throw new Error(
      `FAIL-CLOSED: .quay/loop.yml field 'gates' must be a string or non-empty array`
    );
  }

  // 6. Optional: stop — validate if present
  const stop = parsed?.stop ?? "once";
  if (typeof stop !== "string" || !VALID_STOP_RE.test(stop.trim())) {
    throw new Error(
      `FAIL-CLOSED: .quay/loop.yml field 'stop' value "${stop}" is invalid — must be "once", "until(.halt)", "until(empty)", or "until(<condition>)"`
    );
  }

  // 7. Optional: policy (no constraint — workspace-defined ranking label)
  const policy = typeof parsed?.policy === "string" ? parsed.policy.trim() : "ready-first";

  // 8. Optional: coexist (string or null/omitted)
  const coexist =
    parsed?.coexist === null || parsed?.coexist === undefined
      ? null
      : typeof parsed.coexist === "string"
      ? parsed.coexist.trim() || null
      : null;

  return {
    board: parsed.board.trim(),
    gates,
    stop: stop.trim(),
    policy,
    coexist,
  };
}
