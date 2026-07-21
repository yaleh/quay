// loop-params.js — reads and validates .quay/loop.yml for the loop-driver skill (DIR-045/DIR-048).
//
// Contract: readLoopParams(workspaceRoot) → LoopParams | throws Error("FAIL-CLOSED: ...")
//
// FAIL-CLOSED: missing file, malformed YAML, or missing required fields ALL throw.
// A skill that cannot read its params refuses to run — no silent defaults for
// the required fields (board, gates). Optional fields (stop, policy, coexist,
// execution, audit) have safe defaults.
//
// Schema (.quay/loop.yml):
//   board:     string   REQUIRED — provider name (e.g. "native")
//   gates:     string|string[]  REQUIRED — gate name(s) refs into .quay/gates.yml
//   stop:      string   OPTIONAL — "once" | "until(.halt)" | "until(empty)" | default "once"
//   policy:    string   OPTIONAL — select-ranking policy; default "ready-first"
//   coexist:   string|null OPTIONAL — pause-hook (e.g. "pause(backlog/.loop-stop)"); default null
//   execution: string   OPTIONAL — "dispatched" (DEFAULT) | "inline"
//                         dispatched: build runs in a fresh background subagent (FAIL-CLOSED if no Agent tool)
//                         inline: build runs in the driver's own context (explicit opt-out)
//   audit:     string   OPTIONAL — "adversarial" (DEFAULT) | "none"
//                         adversarial: fresh-context subagent audits diff before land; refutation blocks land
//                         none: gate-output only; no independent audit (explicit opt-out)
//
// Valid `stop` values: "once", "until(.halt)", "until(empty)", or until(K·ΔV<ε) prefix.

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const VALID_STOP_RE = /^(once|until\(.+\))$/;

const VALID_EXECUTION = new Set(["dispatched", "inline"]);
const VALID_AUDIT = new Set(["adversarial", "none"]);

/**
 * Read and validate `.quay/loop.yml` from workspaceRoot.
 * Throws Error("FAIL-CLOSED: ...") on any validation failure.
 *
 * @param {string} workspaceRoot
 * @returns {{ board: string, gates: string[], stop: string, policy: string, coexist: string|null, execution: string, audit: string }}
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

  // 9. Optional: execution — "dispatched" (DEFAULT) | "inline"
  const execution = parsed?.execution ?? "dispatched";
  if (!VALID_EXECUTION.has(execution)) {
    throw new Error(
      `FAIL-CLOSED: .quay/loop.yml field 'execution' value "${execution}" is invalid — must be "dispatched" or "inline"`
    );
  }

  // 10. Optional: audit — "adversarial" (DEFAULT) | "none"
  const audit = parsed?.audit ?? "adversarial";
  if (!VALID_AUDIT.has(audit)) {
    throw new Error(
      `FAIL-CLOSED: .quay/loop.yml field 'audit' value "${audit}" is invalid — must be "adversarial" or "none"`
    );
  }

  // 11. Optional: concurrency — max touches-disjoint batch width (DIR-049). Integer >= 1; DEFAULT 1
  //     (serial — one dispatched build per iterate, i.e. DIR-048 behavior). N > 1 opts a workspace INTO
  //     cross-milestone concurrency (safe only where tasks are touches-disjoint + carry no SELECT←ABSORB
  //     learning dependency). Fail-closed on non-integer / < 1.
  const concurrency = parsed?.concurrency ?? 1;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(
      `FAIL-CLOSED: .quay/loop.yml field 'concurrency' value "${concurrency}" is invalid — must be an integer >= 1 (1 = serial, the default)`
    );
  }

  // 12. Optional: routines — a standing routine track (DIR-051). Array of { name, trigger, dispatch }
  //     fired on a cadence/condition independent of the ready-queue SELECT; DEFAULT [] (no routines =
  //     today's behavior). Each entry validated fail-closed: name (non-empty string), trigger
  //     ("every(N)" with N>=1 | "on(<word>)"), dispatch (non-empty string). The scheduler logic lives
  //     in routine-scheduler.mjs (parseTrigger/isDue); this only validates shape.
  const routines = parsed?.routines ?? [];
  if (!Array.isArray(routines)) {
    throw new Error(`FAIL-CLOSED: .quay/loop.yml field 'routines' must be an array (got ${typeof routines})`);
  }
  for (const [i, r] of routines.entries()) {
    if (!r || typeof r.name !== "string" || !r.name.trim()) {
      throw new Error(`FAIL-CLOSED: .quay/loop.yml routines[${i}] needs a non-empty string 'name'`);
    }
    if (typeof r.trigger !== "string" || !/^(every\(\s*\d+\s*\)|on\(\s*[\w-]+\s*\))$/.test(r.trigger.trim())) {
      throw new Error(`FAIL-CLOSED: .quay/loop.yml routines[${i}] ('${r.name}') trigger "${r.trigger}" is invalid — must be "every(N)" (N>=1) or "on(<event>)"`);
    }
    const m = r.trigger.trim().match(/^every\(\s*(\d+)\s*\)$/);
    if (m && Number(m[1]) < 1) {
      throw new Error(`FAIL-CLOSED: .quay/loop.yml routines[${i}] ('${r.name}') trigger "every(${m[1]})" invalid — N must be >= 1`);
    }
    if (typeof r.dispatch !== "string" || !r.dispatch.trim()) {
      throw new Error(`FAIL-CLOSED: .quay/loop.yml routines[${i}] ('${r.name}') needs a non-empty string 'dispatch' action`);
    }
  }

  return {
    board: parsed.board.trim(),
    gates,
    stop: stop.trim(),
    policy,
    coexist,
    execution,
    audit,
    concurrency,
    routines,
  };
}
