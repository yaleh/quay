// loop-params.js — reads and validates loop params for the loop-driver skill (DIR-045/DIR-048/DIR-056/DIR-050).
//
// Contract: readLoopParams(workspaceRoot) → LoopParams | throws Error("FAIL-CLOSED: ...")
//
// FAIL-CLOSED: missing file, malformed YAML, or missing required fields ALL throw.
// A skill that cannot read its params refuses to run — no silent defaults for
// the required fields (board, gates). Optional fields (stop, policy, execution,
// audit) have safe defaults.
//
// DIR-050/DIR-120 Phase 2: unified config format, branch-A-only-terminal.
//   Branch A: `.quay/config.yml` exists — TERMINAL. Must have a `loop:` section
//     (else FAIL-CLOSED); never falls through to a legacy `.quay/loop.yml`.
//   Branch B: no `.quay/config.yml` — reads `.quay/loop.yml` (legacy format,
//     back-compat fallback for workspaces with no unified config).
//     DIR-120 Phase 3a: a branch-B `.quay/loop.yml` may not declare
//     `providers:` (FAIL-CLOSED) — a loop-only profile fragment, not a second
//     provider map.
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
//   worktree_deps_install: string  OPTIONAL — the shell command run INSIDE a freshly dispatched task
//                         worktree to install its dependencies, when the project refuses a symlinked
//                         node_modules (pnpm is the motivating case). Absent/blank ⇒ auto-detect: a
//                         pnpm marker (pnpm-lock.yaml, or package.json `packageManager: pnpm@…`)
//                         selects the built-in `pnpm install --frozen-lockfile --offline`; with no
//                         marker the pre-existing symlink-or-`npm install` behavior is unchanged.
//                         Consumed by plugin/scripts/worktree-deps-provision.ts (the task-worktree
//                         deps step); the shared judgment lives in packages/quay/src/worktree-deps.ts.
//
// Valid `stop` values: "once", "until(.halt)", "until(empty)", or until(K·ΔV<ε) prefix.

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export const VALID_STOP_RE = /^(once|until\(.+\))$/;

export const VALID_EXECUTION = new Set(["dispatched", "inline"]);
export const VALID_AUDIT = new Set(["adversarial", "none"]);

/**
 * Read and validate loop params from workspaceRoot.
 * DIR-050: tries unified `.quay/config.yml` (loop: section) first, falls back to `.quay/loop.yml`.
 * Throws Error("FAIL-CLOSED: ...") on any validation failure.
 *
 * @param {string} workspaceRoot
 * @returns {{ board: string, gates: string[], stop: string, policy: string, execution: string, audit: string, concurrency: number, routines: Array<object>, worktreeDepsInstall: string | null }}
 */
export function readLoopParams(workspaceRoot) {
  const unifiedConfigPath = path.join(workspaceRoot, ".quay", "config.yml");

  // DIR-120 Phase 2: branch A (unified config.yml exists) is TERMINAL — it
  // returns/throws before ever constructing a legacy .quay/loop.yml path.
  // Branch B (no config.yml) is untouched pre-DIR-050 legacy behavior,
  // reachable ONLY when branch A does not apply. The legacy root
  // `.quay/loop.yml` was deleted as part of this same change — branch A is
  // unconditionally true for THIS workspace, so branch B is dead weight
  // here but stays live for any workspace with no config.yml of its own.
  let parsed: unknown;
  let sourceLabel: string;
  if (fs.existsSync(unifiedConfigPath)) {
    let unified: unknown;
    try {
      unified = YAML.parse(fs.readFileSync(unifiedConfigPath, "utf8"));
    } catch (e: unknown) {
      throw new Error(
        `FAIL-CLOSED: .quay/config.yml is malformed YAML — ${(e as Error).message}`
      );
    }
    if (unified && typeof unified === "object" && "loop" in unified) {
      parsed = (unified as Record<string, unknown>).loop;
      sourceLabel = ".quay/config.yml (loop: section)";
    } else {
      // DIR-120 Phase 2: config.yml exists but has no loop: key — NEW
      // FAIL-CLOSED (previously silently fell through to a co-located
      // .quay/loop.yml). Unreachable for any workspace checked today, since
      // all three real .quay/config.yml's have a loop: section.
      throw new Error(
        `FAIL-CLOSED: .quay/config.yml exists but has no 'loop:' section, and legacy .quay/loop.yml fallback has been removed (DIR-120 Phase 2) — add a loop: section to .quay/config.yml`
      );
    }
  } else {
    // Branch B — no config.yml at all. Untouched pre-DIR-050 legacy path.
    const legacyLoopPath = path.join(workspaceRoot, ".quay", "loop.yml");
    if (!fs.existsSync(legacyLoopPath)) {
      throw new Error(
        `FAIL-CLOSED: no loop config found — neither .quay/config.yml (with loop: section) nor .quay/loop.yml exists in ${workspaceRoot}`
      );
    }
    let legacyParsed: unknown;
    try {
      legacyParsed = YAML.parse(fs.readFileSync(legacyLoopPath, "utf8"));
    } catch (e: unknown) {
      throw new Error(
        `FAIL-CLOSED: .quay/loop.yml is malformed YAML — ${(e as Error).message}`
      );
    }
    // DIR-120 Phase 3a: a loop-only profile fragment (no config.yml) may not
    // declare `providers:` — that belongs exclusively in a unified
    // .quay/config.yml. Scoped to branch B ONLY — branch-A workspaces
    // legitimately have `providers:` at config.yml's own top level.
    if (legacyParsed && typeof legacyParsed === "object" && "providers" in legacyParsed) {
      throw new Error(
        `FAIL-CLOSED: .quay/loop.yml declares 'providers:' — a loop-only profile fragment may not declare 'providers:', that belongs exclusively in a unified .quay/config.yml (DIR-120 Phase 3a)`
      );
    }
    parsed = legacyParsed;
    sourceLabel = ".quay/loop.yml";
  }

  const src = sourceLabel!;

  const p = parsed as Record<string, unknown>;

  // 3. Required: board
  if (!p?.board || typeof p.board !== "string" || !(p.board as string).trim()) {
    throw new Error(
      `FAIL-CLOSED: ${src} missing required field 'board' (provider name, e.g. "native")`
    );
  }

  // 4. Required: gates
  if (p?.gates === undefined || p?.gates === null) {
    throw new Error(
      `FAIL-CLOSED: ${src} missing required field 'gates' (gate name or list, e.g. [vitest])`
    );
  }

  // 5. Normalize gates to array
  let gates: string[];
  if (Array.isArray(p.gates)) {
    gates = p.gates as string[];
  } else if (typeof p.gates === "string" && (p.gates as string).trim()) {
    gates = [(p.gates as string).trim()];
  } else {
    throw new Error(
      `FAIL-CLOSED: ${src} field 'gates' must be a string or non-empty array`
    );
  }

  // 6. Optional: stop — validate if present
  const stop = (p?.stop ?? "once") as string;
  if (typeof stop !== "string" || !VALID_STOP_RE.test(stop.trim())) {
    throw new Error(
      `FAIL-CLOSED: ${src} field 'stop' value "${stop}" is invalid — must be "once", "until(.halt)", "until(empty)", or "until(<condition>)"`
    );
  }

  // 7. Optional: policy (no constraint — workspace-defined ranking label)
  const policy = typeof p?.policy === "string" ? (p.policy as string).trim() : "ready-first";

  // 8. coexist: RETIRED (DIR-050) — silently ignored if present in legacy YAML.
  //    Not returned in the result object.

  // 9. Optional: execution — "dispatched" (DEFAULT) | "inline"
  const execution = (p?.execution ?? "dispatched") as string;
  if (!VALID_EXECUTION.has(execution)) {
    throw new Error(
      `FAIL-CLOSED: ${src} field 'execution' value "${execution}" is invalid — must be "dispatched" or "inline"`
    );
  }

  // 10. Optional: audit — "adversarial" (DEFAULT) | "none"
  const audit = (p?.audit ?? "adversarial") as string;
  if (!VALID_AUDIT.has(audit)) {
    throw new Error(
      `FAIL-CLOSED: ${src} field 'audit' value "${audit}" is invalid — must be "adversarial" or "none"`
    );
  }

  // 11. Optional: concurrency — max touches-disjoint batch width (DIR-049). Integer >= 1; DEFAULT 1
  //     (serial — one dispatched build per iterate, i.e. DIR-048 behavior). N > 1 opts a workspace INTO
  //     cross-milestone concurrency (safe only where tasks are touches-disjoint + carry no SELECT←ABSORB
  //     learning dependency). Fail-closed on non-integer / < 1.
  const concurrency = (p?.concurrency ?? 1) as number;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(
      `FAIL-CLOSED: ${src} field 'concurrency' value "${concurrency}" is invalid — must be an integer >= 1 (1 = serial, the default)`
    );
  }

  // 12. Optional: routines — a standing routine track (DIR-051/DIR-056). Array of
  //     { name, trigger, dispatch?, probe? } fired on a cadence/condition independent of the
  //     ready-queue SELECT; DEFAULT [] (no routines = today's behavior). Each entry validated
  //     fail-closed: name (non-empty string), trigger ("every(N)" with N>=1 LEGACY iteration-based |
  //     "interval:<N>m" with N>=1 TIME-based two-layer quantity | "on(<word>)" event-based), and at
  //     least one of: dispatch (non-empty string, legacy) OR probe (non-empty string, DIR-056
  //     probe-spec name). The scheduler logic lives in routine-scheduler.ts
  //     (parseTrigger/isDue/resolveRoutineAction); this only validates shape. interval:<N>m is the
  //     two-layer form (ADR-022 retired the iteration counter; see
  //     gap-probe-mechanism-dead-15-days-rewire-to-two-layer).
  const routines = (p?.routines ?? []) as unknown[];
  if (!Array.isArray(routines)) {
    throw new Error(`FAIL-CLOSED: ${src} field 'routines' must be an array (got ${typeof routines})`);
  }
  for (const [i, r] of (routines as Record<string, unknown>[]).entries()) {
    if (!r || typeof r.name !== "string" || !(r.name as string).trim()) {
      throw new Error(`FAIL-CLOSED: ${src} routines[${i}] needs a non-empty string 'name'`);
    }
    if (typeof r.trigger !== "string" || !/^(every\(\s*\d+\s*\)|interval:\s*\d+\s*m|on\(\s*[\w-]+\s*\))$/.test((r.trigger as string).trim())) {
      throw new Error(`FAIL-CLOSED: ${src} routines[${i}] ('${r.name}') trigger "${r.trigger}" is invalid — must be "every(N)" (N>=1, LEGACY iteration), "interval:<N>m" (N>=1, two-layer time), or "on(<event>)"`);
    }
    const everyMatch = (r.trigger as string).trim().match(/^every\(\s*(\d+)\s*\)$/);
    if (everyMatch && Number(everyMatch[1]) < 1) {
      throw new Error(`FAIL-CLOSED: ${src} routines[${i}] ('${r.name}') trigger "every(${everyMatch[1]})" invalid — N must be >= 1`);
    }
    const intervalMatch = (r.trigger as string).trim().match(/^interval:\s*(\d+)\s*m$/);
    if (intervalMatch && Number(intervalMatch[1]) < 1) {
      throw new Error(`FAIL-CLOSED: ${src} routines[${i}] ('${r.name}') trigger "interval:${intervalMatch[1]}m" invalid — N must be >= 1`);
    }
    // DIR-056: must have at least one of dispatch (legacy) or probe (new).
    const hasDispatch = typeof r.dispatch === "string" && (r.dispatch as string).trim();
    const hasProbe = typeof r.probe === "string" && (r.probe as string).trim();
    if (!hasDispatch && !hasProbe) {
      throw new Error(`FAIL-CLOSED: ${src} routines[${i}] ('${r.name}') needs at least one of 'dispatch' (legacy) or 'probe' (DIR-056 probe-spec name)`);
    }
  }

  // 13. Optional: worktree_deps_install — the shell command run inside a freshly dispatched task
  //     worktree to install dependencies, for projects that refuse a symlinked node_modules (pnpm).
  //     DEFAULT null (auto-detect: a pnpm marker selects the built-in pnpm command; otherwise the
  //     pre-existing symlink/npm behavior). Fail-closed on a non-string / blank value — a declared
  //     command that is blank is a configuration mistake, not silently "no declaration".
  let worktreeDepsInstall: string | null = null;
  if (p?.worktree_deps_install !== undefined && p?.worktree_deps_install !== null) {
    if (typeof p.worktree_deps_install !== "string" || !(p.worktree_deps_install as string).trim()) {
      throw new Error(`FAIL-CLOSED: ${src} field 'worktree_deps_install' must be a non-empty string when present (a blank install command is a mistake, not 'no declaration')`);
    }
    worktreeDepsInstall = (p.worktree_deps_install as string).trim();
  }

  return {
    board: (p.board as string).trim(),
    gates,
    stop: stop.trim(),
    policy,
    execution,
    audit,
    concurrency,
    routines,
    worktreeDepsInstall,
  };
}
