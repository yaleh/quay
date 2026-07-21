// loop-params.js — reads and validates loop params for the loop-driver skill (DIR-045/DIR-048/DIR-056/DIR-050).
//
// Contract: readLoopParams(workspaceRoot) → LoopParams | throws Error("FAIL-CLOSED: ...")
//
// FAIL-CLOSED: missing file, malformed YAML, or missing required fields ALL throw.
// A skill that cannot read its params refuses to run — no silent defaults for
// the required fields (board, gates). Optional fields (stop, policy, execution,
// audit) have safe defaults.
//
// DIR-050: unified config format. Reader tries in order:
//   1. `.quay/config.yml` with a `loop:` section (unified format, preferred)
//   2. `.quay/loop.yml` (legacy format, back-compat fallback)
//
// Schema (loop section / .quay/loop.yml):
//   board:     string   REQUIRED — provider name (e.g. "native")
//   gates:     string|string[]  REQUIRED — gate name(s) refs into gates config
//   stop:      string   OPTIONAL — "once" | "until(.halt)" | "until(empty)" | default "once"
//   policy:    string   OPTIONAL — select-ranking policy; default "ready-first"
//   coexist:   RETIRED (DIR-050) — ignored if present in legacy YAML; not returned
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
 * Read and validate loop params from workspaceRoot.
 * DIR-050: tries unified `.quay/config.yml` (loop: section) first, falls back to `.quay/loop.yml`.
 * Throws Error("FAIL-CLOSED: ...") on any validation failure.
 *
 * @param {string} workspaceRoot
 * @returns {{ board: string, gates: string[], stop: string, policy: string, execution: string, audit: string, concurrency: number, routines: Array<object> }}
 */
export function readLoopParams(workspaceRoot) {
  const unifiedConfigPath = path.join(workspaceRoot, ".quay", "config.yml");
  const legacyLoopPath = path.join(workspaceRoot, ".quay", "loop.yml");

  // 1. DIR-050: try unified .quay/config.yml with loop: section first
  let parsed;
  let sourceLabel;
  if (fs.existsSync(unifiedConfigPath)) {
    let unified;
    try {
      unified = YAML.parse(fs.readFileSync(unifiedConfigPath, "utf8"));
    } catch (e) {
      throw new Error(
        `FAIL-CLOSED: .quay/config.yml is malformed YAML — ${e.message}`
      );
    }
    if (unified && typeof unified === "object" && "loop" in unified) {
      parsed = unified.loop;
      sourceLabel = ".quay/config.yml (loop: section)";
    }
  }

  // 2. Fall back to .quay/loop.yml
  if (parsed === undefined) {
    if (!fs.existsSync(legacyLoopPath)) {
      throw new Error(
        `FAIL-CLOSED: no loop config found — neither .quay/config.yml (with loop: section) nor .quay/loop.yml exists in ${workspaceRoot}`
      );
    }
    try {
      parsed = YAML.parse(fs.readFileSync(legacyLoopPath, "utf8"));
    } catch (e) {
      throw new Error(
        `FAIL-CLOSED: .quay/loop.yml is malformed YAML — ${e.message}`
      );
    }
    sourceLabel = ".quay/loop.yml";
  }

  const src = sourceLabel;

  // 3. Required: board
  if (!parsed?.board || typeof parsed.board !== "string" || !parsed.board.trim()) {
    throw new Error(
      `FAIL-CLOSED: ${src} missing required field 'board' (provider name, e.g. "native")`
    );
  }

  // 4. Required: gates
  if (parsed?.gates === undefined || parsed?.gates === null) {
    throw new Error(
      `FAIL-CLOSED: ${src} missing required field 'gates' (gate name or list, e.g. [vitest])`
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
      `FAIL-CLOSED: ${src} field 'gates' must be a string or non-empty array`
    );
  }

  // 6. Optional: stop — validate if present
  const stop = parsed?.stop ?? "once";
  if (typeof stop !== "string" || !VALID_STOP_RE.test(stop.trim())) {
    throw new Error(
      `FAIL-CLOSED: ${src} field 'stop' value "${stop}" is invalid — must be "once", "until(.halt)", "until(empty)", or "until(<condition>)"`
    );
  }

  // 7. Optional: policy (no constraint — workspace-defined ranking label)
  const policy = typeof parsed?.policy === "string" ? parsed.policy.trim() : "ready-first";

  // 8. coexist: RETIRED (DIR-050) — silently ignored if present in legacy YAML.
  //    Not returned in the result object.

  // 9. Optional: execution — "dispatched" (DEFAULT) | "inline"
  const execution = parsed?.execution ?? "dispatched";
  if (!VALID_EXECUTION.has(execution)) {
    throw new Error(
      `FAIL-CLOSED: ${src} field 'execution' value "${execution}" is invalid — must be "dispatched" or "inline"`
    );
  }

  // 10. Optional: audit — "adversarial" (DEFAULT) | "none"
  const audit = parsed?.audit ?? "adversarial";
  if (!VALID_AUDIT.has(audit)) {
    throw new Error(
      `FAIL-CLOSED: ${src} field 'audit' value "${audit}" is invalid — must be "adversarial" or "none"`
    );
  }

  // 11. Optional: concurrency — max touches-disjoint batch width (DIR-049). Integer >= 1; DEFAULT 1
  //     (serial — one dispatched build per iterate, i.e. DIR-048 behavior). N > 1 opts a workspace INTO
  //     cross-milestone concurrency (safe only where tasks are touches-disjoint + carry no SELECT←ABSORB
  //     learning dependency). Fail-closed on non-integer / < 1.
  const concurrency = parsed?.concurrency ?? 1;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(
      `FAIL-CLOSED: ${src} field 'concurrency' value "${concurrency}" is invalid — must be an integer >= 1 (1 = serial, the default)`
    );
  }

  // 12. Optional: routines — a standing routine track (DIR-051/DIR-056). Array of
  //     { name, trigger, dispatch?, probe? } fired on a cadence/condition independent of the
  //     ready-queue SELECT; DEFAULT [] (no routines = today's behavior). Each entry validated
  //     fail-closed: name (non-empty string), trigger ("every(N)" with N>=1 | "on(<word>)"),
  //     and at least one of: dispatch (non-empty string, legacy) OR probe (non-empty string,
  //     DIR-056 probe-spec name). The scheduler logic lives in routine-scheduler.mjs
  //     (parseTrigger/isDue/resolveRoutineAction); this only validates shape.
  const routines = parsed?.routines ?? [];
  if (!Array.isArray(routines)) {
    throw new Error(`FAIL-CLOSED: ${src} field 'routines' must be an array (got ${typeof routines})`);
  }
  for (const [i, r] of routines.entries()) {
    if (!r || typeof r.name !== "string" || !r.name.trim()) {
      throw new Error(`FAIL-CLOSED: ${src} routines[${i}] needs a non-empty string 'name'`);
    }
    if (typeof r.trigger !== "string" || !/^(every\(\s*\d+\s*\)|on\(\s*[\w-]+\s*\))$/.test(r.trigger.trim())) {
      throw new Error(`FAIL-CLOSED: ${src} routines[${i}] ('${r.name}') trigger "${r.trigger}" is invalid — must be "every(N)" (N>=1) or "on(<event>)"`);
    }
    const m = r.trigger.trim().match(/^every\(\s*(\d+)\s*\)$/);
    if (m && Number(m[1]) < 1) {
      throw new Error(`FAIL-CLOSED: ${src} routines[${i}] ('${r.name}') trigger "every(${m[1]})" invalid — N must be >= 1`);
    }
    // DIR-056: must have at least one of dispatch (legacy) or probe (new).
    const hasDispatch = typeof r.dispatch === "string" && r.dispatch.trim();
    const hasProbe = typeof r.probe === "string" && r.probe.trim();
    if (!hasDispatch && !hasProbe) {
      throw new Error(`FAIL-CLOSED: ${src} routines[${i}] ('${r.name}') needs at least one of 'dispatch' (legacy) or 'probe' (DIR-056 probe-spec name)`);
    }
  }

  return {
    board: parsed.board.trim(),
    gates,
    stop: stop.trim(),
    policy,
    execution,
    audit,
    concurrency,
    routines,
  };
}
