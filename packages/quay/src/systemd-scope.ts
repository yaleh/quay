// systemd-scope.ts — THE single implementation of the `systemd-run --user --scope` envelope: the
// unit-name derivation, the availability probe, the MemoryMax policy, and the argv construction.
//
// THE DEFECT THIS CLOSES (measured 2026-10-06, cantus —
// gap-serve-host-spawned-in-caller-session-cgroup-dies-when-cloudcli-restarts): a serve host started
// through the DEFAULT path (`spawnHost` / `startServe`) was `spawn(…, { detached: true })` and
// nothing more. `detached:true` leaves the SESSION but **not the cgroup** ⇒ the host stayed in the
// caller's (CloudCLI session) scope, and restarting `claudecodeui-server.service` (KillMode=
// control-group on that scope) killed it along with the session. A hand-wrapped
// `systemd-run --user --scope` host in the SAME session survived that restart. The mechanism gap was
// not "the operator forgot systemd-run" — it is that the serve spawn sites had no envelope at all.
//
// ── WHY A CORE LEAF (same reasoning as loaded-version.ts) ────────────────────────────────────────
//   ① Core (`packages/quay/src/cli/server.ts:spawnHost`) may NOT statically import `plugin/**`
//      (import-graph-check's reverseEdges ratchet). The anchor's own copy lives in
//      `plugin/scripts/driver-runtime.ts`; the serve host's two spawn sites straddle the boundary
//      (Core + plugin). Hoisting the PURE functions here gives ONE implementation both sides import;
//      the alternative — Core dynamically resolving the plugin root at spawn time — would drag the
//      whole kernel closure into a `quay server start` and, under `plugin-root.ts`'s rule ①, read
//      the MAIN checkout's code from a linked worktree.
//   ② `plugin/` → `packages/` is the accepted direction, so `driver-runtime.ts` imports these and
//      re-exports the names it has always exported (`anchorLaunchArgv`, `anchorUnitName`, …) —
//      ⛔ NOT a second copy (硬规则 5b).
//
// ⛔ LEAF DISCIPLINE (same rule as serve-binding.ts / serve-log.ts): node builtins only. This module
// is imported from BOTH sides of the kernel↔target boundary, so an import edge of its own would put
// cycle risk on import-graph-check's zero-SCC baseline for no benefit.
//
// ── MEASURED ON THIS HOST (2026-10-06, before writing this file) ─────────────────────────────────
// `spawn("systemd-run", ["--user","--scope","--collect","--unit=…","-p",…, <inner…>])` **execs in
// place**: the spawned pid equals the inner `process.pid` (2697948 == 2697948) and `/proc/<pid>/cgroup`
// becomes `…/app.slice/<unit>.scope`. ⇒ `.quay/serve.pid`, `.quay/server.json`, the admission lock
// (`O_EXCL`) and their pid/cmdline checks keep their semantics unchanged, and `/proc/<pid>/cmdline`
// reports the INNER command (the host), never `systemd-run`. The envelope is still a real cgroup:
// the process leaves the caller's session scope.
//
// THREE-VALUED OUTPUT (硬规则 3b): "no envelope" is its OWN value (`envelope: "none"` + a NAMED
// `reason`), never shaped like a working envelope — a caller that silently falls back would turn
// 「this host is not restart-protected」 into 「the host started fine」.

import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

/** Forced-availability seam. Shared with the anchor probe and `full-suite-runner.systemdRunAvailable`;
 *  `"0"`/`"1"` forces the answer so a hermetic test can drive either branch. */
export const SYSTEMD_RUN_AVAILABLE_ENV = "QUAY_TEST_SYSTEMD_RUN_AVAILABLE";

/** The cgroup v2 hierarchy mount — the ONE place this literal lives. The suite's host adapter
 *  (`plugin/scripts/host-resource-adapter.ts`) asks whether it exists before claiming it can measure a
 *  scope, and `effective-capacity-probe.ts` walks it; ⛔ neither re-spells the path (硬规则 5b). It
 *  is a MECHANISM constant of the linux-cgroup-v2 adapter, not a policy value — a host without it is
 *  not "misconfigured", it is a host this adapter does not fit. */
export const LINUX_CGROUP_V2_ROOT = "/sys/fs/cgroup";

/** The systemd-run binary NAME (never a path — resolution stays with PATH, so a host with the binary
 *  elsewhere is a PATH question, not a code change). */
export const SYSTEMD_RUN_BIN = "systemd-run";

/** Default MemoryMax = host totalmem × this fraction. ⚠️ host-DERIVED on purpose: a literal ceiling
 *  is only ever "equivalent to unlimited" on the machine that wrote it and a real limit elsewhere
 *  (CLAUDE.md 硬规则 4 推论二). ⛔ Never write such a literal. */
export const SCOPE_ENVELOPE_HOST_FRACTION = 0.25;

/** Align the byte ceiling to a page boundary (same reason as the anchor: a systemd/cgroup rounding
 *  difference would otherwise show up as a few-KB mismatch in a planned-vs-in-effect comparison). */
const SCOPE_ENVELOPE_PAGE_BYTES = 4096;

/** The serve host's scope unit prefix. The name is `quay-serve-<root base>-<ts>.scope` — readable,
 *  greppable by prefix, and distinct from the anchor's `quay-anchor-*` and from the hand-made
 *  `quay-serve-quay-<ts>.service` (a different unit TYPE, so no name collision). */
export const SERVE_UNIT_PREFIX = "quay-serve-";

/** Env override for the serve host's MemoryMax, same syntax as the anchor/suite limit strings
 *  (`MemoryMax=…`; an explicitly empty string = set no ceiling). Separate name from the driver's so
 *  tuning one never silently retunes the other. */
export const SERVE_LIMITS_ENV = "QUAY_SERVE_SYSTEMD_RUN_LIMITS";

/** Stable token a serve spawn site MUST surface when the envelope could not be applied. It is a
 *  token (not prose) so a caller/test can assert the reading exists without matching a sentence, and
 *  so 「not restart-protected」 is distinguishable from a normal start. */
export const SERVE_SCOPE_UNAVAILABLE = "serve-scope-unavailable";

/** Who chose the ceiling (a launcher declaration — the kernel cannot report "who decided"). */
export type ScopeEnvelopeSource = "host-derived" | "env-override" | "env-unlimited" | null;

/** The resolved envelope. `envelope: "none"` + a named `reason` is an INDEPENDENT value, ⛔ not a
 *  missing field and ⛔ not shaped like `"scope"`. */
export interface ResolvedScopeEnvelope {
  /** `"scope"` = spawn inside a transient `--unit=<name>.scope`; `"none"` = fall back to a bare
   *  detached spawn (the pre-fix behaviour). */
  envelope: "scope" | "none";
  /** The ceiling to pass as `-p MemoryMax=<v>`, or null ⇒ pass NO property (「不限制」 expressed in
   *  the mechanism, ⛔ not as an "equivalent-unlimited" literal). */
  memoryMax: string | null;
  source: ScopeEnvelopeSource;
  /** The unit name, or null when `envelope === "none"`. */
  unit: string | null;
  /** Non-null iff `envelope === "none"`: the NAMED reason (⛔ a bare "none" without a reason is
   *  indistinguishable from "not evaluated"). */
  reason: string | null;
}

/** The property assignments (`-p <assign>` PAIRS) the envelope ALWAYS passes — the **ONE** definition
 *  the availability probe and the REAL invocation BOTH consume. The whole point of sharing it:
 *  「探测绿」 must STRUCTURALLY imply the real `systemd-run` accepts the same properties.
 *
 *  ── THE DEFECT THIS CLOSES (measured on systemd 245, 2026-10-10, v0.18.0 release triage) ─────────
 *  The probe passed ONLY `MemoryAccounting=yes` while the real argv added `OOMPolicy=continue` — a
 *  property systemd 245 does NOT accept on a `.scope` (`Unknown assignment: OOMPolicy=continue`).
 *  The probe returned rc=0 ⇒ the code took the 「we have a scope」 branch and reported success while
 *  the REAL call would have failed ⇒ the host silently ran WITHOUT its cgroup envelope. That is the
 *  硬规则 3b/4 family: 探测绿不蕴含它要认证的那条操作能成 — the probe and the operation it certifies
 *  must be the SAME thing. ⛔ NEVER spell these properties a second time at either call site. */
export const SCOPE_PROPERTY_ARGS: readonly string[] = ["-p", "MemoryAccounting=yes", "-p", "OOMPolicy=continue"];

/** The bounding dimensions a scope may carry, as DECLARED POLICY VALUES. Every field is optional and
 *  `null`/absent means 「do not pass this property」 — i.e. that dimension is NOT bounded. That is the
 *  ONLY way to express "unlimited" here: an "equivalent-unlimited" literal is only ever unlimited on
 *  the machine that wrote it (CLAUDE.md 硬规则 4 推论二).
 *
 *  ⚠️ RELATION TO THE CALLER'S POLICY TYPE: this is the ARGV BUILDER's input (optional/absent =
 *  omit). The caller-side declared-policy type is `ResourceLimits` in
 *  `plugin/scripts/host-resource-adapter.ts` (REQUIRED strings, `""` = unbounded), which is
 *  structurally assignable to this. The two differ only in the "unset" convention each layer already
 *  used — not in what gets passed. */
export interface ScopeResourceLimits {
  memoryMax?: string | null;
  cpuQuota?: string | null;
  tasksMax?: string | null;
  memorySwapMax?: string | null;
}

/** The `-p <assign>` PAIRS for a limit set, in the ONE order every caller uses. ⛔ A dimension left
 *  empty contributes NOTHING (not `-p MemoryMax=infinity`, not a commented-out line). */
export function scopeLimitPropertyArgs(limits: ScopeResourceLimits): string[] {
  const out: string[] = [];
  if (limits.memoryMax) out.push("-p", `MemoryMax=${limits.memoryMax}`);
  if (limits.cpuQuota) out.push("-p", `CPUQuota=${limits.cpuQuota}`);
  if (limits.tasksMax) out.push("-p", `TasksMax=${limits.tasksMax}`);
  if (limits.memorySwapMax) out.push("-p", `MemorySwapMax=${limits.memorySwapMax}`);
  return out;
}

/** The mechanism knobs that distinguish the call sites of the ONE argv builder. */
export interface ScopeLaunchOptions {
  /** `--collect`: reap the transient scope when its last member exits (the serve/anchor envelope). */
  collect?: boolean;
  /** `--unit=<name>`: a NAMED transient scope (the serve/anchor envelope). */
  unit?: string | null;
  /** `--quiet`: suppress systemd's "Running as unit: …" stdout line. REQUIRED for the suite, whose
   *  stdout is teed into the suite log and run through the failure-pattern matcher. */
  quiet?: boolean;
}

/**
 * THE argv builder for a `systemd-run --user --scope` envelope. Both call sites that used to spell
 * their own argv — the serve/anchor envelope (`scopeLaunchArgv`) and the suite's host adapter
 * (`host-resource-adapter.launchArgv`) — go through THIS function, so the property list, the
 * `-p` ordering and the flag set can no longer drift between the two (硬规则 5b: 改一处两处同变).
 *
 * Order: binary › `--user --scope` › mechanism flags (`--collect` / `--unit=` / `--quiet`) ›
 * `SCOPE_PROPERTY_ARGS` › limit properties › inner argv. `--scope` execs in place, so the inner argv
 * is the TAIL and no shell is inserted.
 */
export function boundedScopeArgv(
  innerArgv: string[],
  limits: ScopeResourceLimits,
  opts: ScopeLaunchOptions = {},
): string[] {
  const argv = [SYSTEMD_RUN_BIN, "--user", "--scope"];
  if (opts.collect) argv.push("--collect");
  if (opts.unit) argv.push(`--unit=${opts.unit}`);
  if (opts.quiet) argv.push("--quiet");
  argv.push(...SCOPE_PROPERTY_ARGS, ...scopeLimitPropertyArgs(limits));
  return [...argv, ...innerArgv];
}

/** The availability probe's argv — a REAL transient scope carrying EXACTLY the properties the real
 *  invocations carry (so a green probe implies the real call can succeed). `argv[0]` is the binary;
 *  the trailing `true` is the no-op member. ⛔ Built by `boundedScopeArgv`, NOT spelled by hand:
 *  that is what makes 「probe green」 structurally imply 「the real argv is accepted」. Pure + exported
 *  so a test can assert the probe exercises EVERY property the envelope relies on (the AC3 mutation
 *  control: dropping `OOMPolicy` from `SCOPE_PROPERTY_ARGS` turns that test red). */
export function scopeProbeArgv(): string[] {
  return boundedScopeArgv(["true"], {}, { quiet: true });
}

/** Run `argv[0] argv.slice(1)` and report whether it exited 0. ⛔ Returns `false` — NEVER `true` — when
 *  the binary is missing, the runner REJECTS a property, or the call times out: a probe that could not
 *  run must not share the 「available」 shape (硬规则 3b: 「没查成」 ≠ 「合格」). Exported so a test can
 *  drive a KNOWN-BAD property list as a negative control (AC2 of
 *  gap-systemd-scope-probe-params-differ-from-real-scope). */
export function runScopeProbe(argv: string[]): boolean {
  try {
    execFileSync(argv[0], argv.slice(1), { stdio: "ignore", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

let _systemdScopeAvailable: boolean | null = null;

/** Whether `systemd-run --user --scope` works on this host (memoized). The probe runs a REAL
 *  transient scope (`true`) carrying **`SCOPE_PROPERTY_ARGS`** — the SAME property list the real
 *  invocation passes (see the constant's block comment): the binary being on PATH is NOT the criterion
 *  — a live user manager / D-Bus must accept `--scope` + **those properties**. `QUAY_TEST_SYSTEMD_RUN_AVAILABLE=0|1`
 *  forces the answer.
 *
 *  ⚠️ The seam is consulted BEFORE the memo on purpose: a test that injects "unavailable" must not be
 *  defeated by an earlier REAL probe in the same process (the fallback branch can only be asserted on
 *  a host where systemd-run DOES work, which is exactly the host that would otherwise memoize true). */
export function systemdScopeAvailable(): boolean {
  const forced = process.env[SYSTEMD_RUN_AVAILABLE_ENV];
  if (forced === "0") return false;
  if (forced === "1") return true;
  if (_systemdScopeAvailable !== null) return _systemdScopeAvailable;
  _systemdScopeAvailable = runScopeProbe(scopeProbeArgv());
  return _systemdScopeAvailable;
}

/** The transient scope's unit name: `<prefix><root base>-<ts>.scope`. Sanitized to systemd's
 *  allowed character set. ⛔ Not relied on to be globally unique — `systemd-run` itself refuses a
 *  name that already exists, which is the honest failure. */
export function scopeUnitName(prefix: string, root: string, nowMs: number): string {
  const base = path.basename(path.resolve(root)).replace(/[^A-Za-z0-9_.-]/g, "-").replace(/^[^A-Za-z0-9]+/, "");
  const slug = base === "" ? "root" : base;
  // systemd's unit-name limit is 255; leave room for the prefix and the ".scope" suffix.
  return `${prefix}${slug.slice(0, 180)}-${nowMs}.scope`;
}

/** Round a byte count DOWN to a page boundary, never below one page. The ONE page-alignment routine
 *  every envelope derivation shares (⛔ not a second copy per derivation, 硬规则 5b). */
export function pageAlignScopeBytes(bytes: number): number {
  const aligned = Math.floor(Math.max(0, bytes) / SCOPE_ENVELOPE_PAGE_BYTES) * SCOPE_ENVELOPE_PAGE_BYTES;
  return Math.max(SCOPE_ENVELOPE_PAGE_BYTES, aligned);
}

/** Default ceiling: `floor(totalmem × fraction)`, page-aligned, at least one page.
 *  ⛔ Pure (the input is a byte COUNT, not `os.totalmem()`) so two injected host sizes necessarily
 *  give two different values. */
export function defaultScopeMemoryMax(totalmemBytes: number, fraction = SCOPE_ENVELOPE_HOST_FRACTION): string {
  return String(pageAlignScopeBytes(Math.floor(Math.max(0, totalmemBytes) * fraction)));
}

// ── LANE-SCALED ENVELOPE (the two halves of one decision) ────────────────────────────────────────
// A cgroup ceiling answers ONE question: how much memory may the process group running inside it
// consume? That question has two inputs — HOW MANY members run concurrently inside it, and HOW MUCH
// EACH needs. A ceiling written down as a literal answers it for one host shape only: on a machine
// with more members it silently pins (`memory.max` reached every round, reclaim jitter, timing
// assertions red in rotation), and on a smaller machine it silently stops existing (硬规则 4 推论二).
// ⇒ derive it from both halves: `laneCount × perMemberHighWater × headroom`, and keep a
// host-relative fraction as the runaway guardrail (⛔ never an absolute literal — the guardrail has
// to be a fraction of the host, or it is the same defect one level up).
//
// THREE-VALUED OUTPUT (硬规则 3b): "no measurement" and "the host guard binds" are each their OWN
// value (`bound` + a NAMED `reason`), never shaped like "derived and it is fine" — a caller that
// cannot tell them apart cannot tell 「the derivation ran」 from 「it had nothing to derive from」.

/** Headroom over the raw `laneCount × perMemberHighWater` estimate. The per-member figure is a HIGH
 *  PERCENTILE of a heavy-tailed distribution, not a hard bound, so the estimate is already
 *  conservative for the sum; this factor covers the residual (all lanes peaking in the same sample)
 *  without re-inflating the number into a second literal. */
export const SCOPE_ENVELOPE_LANE_HEADROOM = 1.25;

/** Which of the two bounds produced `memoryMax`. */
export type ScopeMemoryMaxBound = "lane-scaled" | "host-guard";

export interface LaneScaledScopeMemoryMax {
  /** The ceiling to pass as `-p MemoryMax=<v>` — a page-aligned byte count. */
  memoryMax: string;
  /** `"lane-scaled"` = the measured per-member figure × the member count won; `"host-guard"` = the
   *  host-relative fraction won (see `reason`). */
  bound: ScopeMemoryMaxBound;
  /** Non-null iff `bound === "host-guard"`: the NAMED reason (⛔ a bare value is indistinguishable
   *  from "not evaluated"). */
  reason: string | null;
  /** The host-relative guardrail in bytes (the fraction of the effective host total). */
  hostGuardBytes: number;
  /** `laneCount × perFileHighWaterBytes × headroom`, page-aligned — `null` when it could not be
   *  computed (no member count and/or no measurement; 缺值 ≠ 0). */
  laneScaledBytes: number | null;
  laneCount: number;
  perFileHighWaterBytes: number | null;
  headroom: number;
  hostFraction: number;
}

/**
 * The lane-scaled envelope ceiling. **Pure** — every input is a number/size, so two injected host
 * shapes necessarily give two different decisions (and a test can drive the small/multi-core corner
 * without owning the hardware).
 *
 *   hostGuardBytes  = `hostGuardBytes` when supplied (the caller's own already-deriving guard — e.g.
 *                     the shared-host step), else `floor(effective × hostFraction)`, page-aligned.
 *   laneScaledBytes = `ceil(laneCount × perFileHighWaterBytes × headroom)`, page-aligned.
 *   memoryMax       = `min(hostGuardBytes, laneScaledBytes)` — ⛔ the lane estimate can never exceed
 *                     the host-relative guardrail, by construction, on ANY host shape.
 *
 * `perFileHighWaterBytes === null` (no measurement yet) ⇒ the host guard alone, with a named reason.
 * That is the honest degrade: the guardrail still exists and is still host-relative; it is simply no
 * longer scaled by the second half of the decision, and says so.
 */
export function laneScaledScopeMemoryMax(opts: {
  effectiveTotalMemBytes: number;
  laneCount: number;
  perFileHighWaterBytes: number | null;
  hostFraction?: number;
  /** The caller's own host-relative guard (already page-aligned) — e.g. the shared-host tightening
   *  of the same fraction. ⛔ Absent ⇒ derived here from `effectiveTotalMemBytes × hostFraction`. */
  hostGuardBytes?: number;
  headroom?: number;
}): LaneScaledScopeMemoryMax {
  const hostFraction = opts.hostFraction ?? SCOPE_ENVELOPE_HOST_FRACTION;
  const headroom = opts.headroom ?? SCOPE_ENVELOPE_LANE_HEADROOM;
  const hostGuardBytes =
    opts.hostGuardBytes ?? pageAlignScopeBytes(Math.floor(Math.max(0, opts.effectiveTotalMemBytes) * hostFraction));
  const laneCount = Number.isFinite(opts.laneCount) && opts.laneCount >= 1 ? Math.floor(opts.laneCount) : null;
  const measured =
    opts.perFileHighWaterBytes !== null && Number.isFinite(opts.perFileHighWaterBytes) && (opts.perFileHighWaterBytes as number) > 0
      ? (opts.perFileHighWaterBytes as number)
      : null;

  const laneScaledBytes =
    laneCount === null || measured === null ? null : pageAlignScopeBytes(Math.ceil(laneCount * measured * headroom));

  const base = {
    hostGuardBytes,
    laneScaledBytes,
    laneCount: laneCount ?? opts.laneCount,
    perFileHighWaterBytes: measured,
    headroom,
    hostFraction,
  };

  if (laneScaledBytes === null) {
    return {
      memoryMax: String(hostGuardBytes),
      bound: "host-guard",
      reason:
        laneCount === null
          ? `no member count to scale by (laneCount=${opts.laneCount}) — the host-relative guardrail alone applies`
          : "no per-member memory measurement available — the host-relative guardrail alone applies",
      ...base,
    };
  }
  if (laneScaledBytes >= hostGuardBytes) {
    return {
      memoryMax: String(hostGuardBytes),
      bound: "host-guard",
      reason:
        `the lane-scaled estimate (${laneCount} × ${measured} B × ${headroom} = ${laneScaledBytes} B) reaches the ` +
        `host guardrail (${hostGuardBytes} B) — the host-relative fraction is the binding runaway guard`,
      ...base,
    };
  }
  return { memoryMax: String(laneScaledBytes), bound: "lane-scaled", reason: null, ...base };
}

/** Pull the `MemoryMax` key out of an override string. Three INDEPENDENT states (⛔ never sharing one
 *  value with "the key was absent"):
 *   - `"absent"`    — no MemoryMax in the string (or the string is `undefined`) ⇒ the host-derived
 *                     default applies.
 *   - `"value"`     — `MemoryMax=<v>` with a non-empty `<v>` ⇒ use `<v>`.
 *   - `"unlimited"` — the string is explicitly empty/all whitespace, or `MemoryMax=` ⇒ pass NO
 *                     `-p MemoryMax=` (「不限制」 expressed in the mechanism, ⛔ not as a literal). */
export function parseMemoryMaxOverride(raw: string | undefined): { kind: "absent" | "value" | "unlimited"; value: string | null } {
  if (raw === undefined) return { kind: "absent", value: null };
  if (raw.trim() === "") return { kind: "unlimited", value: null };
  for (const part of raw.trim().split(/\s+/)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq) !== "MemoryMax") continue;
    const value = part.slice(eq + 1);
    return value === "" ? { kind: "unlimited", value: null } : { kind: "value", value };
  }
  return { kind: "absent", value: null };
}

export interface ScopeEnvelopeOptions {
  /** The unit-name prefix that identifies THIS mechanism's envelope (`quay-serve-` / `quay-anchor-`). */
  prefix: string;
  /** The workspace root the unit name is derived from. */
  root: string;
  /** The env var read for an override when `limitsRaw` is not injected. */
  limitsEnv: string;
  /** Test seam: host totalmem in bytes. Default = `os.totalmem()`. */
  totalmemBytes?: number;
  /** Test seam: the override string. `undefined` = "read `limitsEnv`". */
  limitsRaw?: string;
  /** Test seam: `systemd-run` availability. Default = `systemdScopeAvailable()`. */
  systemdRun?: boolean;
  /** Test seam: the timestamp in the unit name. Default = `Date.now()`. */
  nowMs?: number;
  /** Test seam: the host-derived fraction. Default = `SCOPE_ENVELOPE_HOST_FRACTION`. */
  totalmemFraction?: number;
}

/** Resolve whether to wrap and with what. **Pure** once its inputs are injected ⇒ two hosts with
 *  different totalmem give two different ceilings, and an unavailable systemd gives the independent
 *  value `"none"` (⛔ not a missing field). */
export function resolveScopeEnvelope(opts: ScopeEnvelopeOptions): ResolvedScopeEnvelope {
  const available = opts.systemdRun ?? systemdScopeAvailable();
  if (!available) {
    return {
      envelope: "none",
      memoryMax: null,
      source: null,
      unit: null,
      reason: "systemd-run --user --scope unavailable on this host (no user manager / no D-Bus / probe failed) — falling back to an unenveloped spawn",
    };
  }
  const raw = opts.limitsRaw !== undefined ? opts.limitsRaw : process.env[opts.limitsEnv];
  const override = parseMemoryMaxOverride(raw);
  let memoryMax: string | null;
  let source: ScopeEnvelopeSource;
  if (override.kind === "value") {
    memoryMax = override.value;
    source = "env-override";
  } else if (override.kind === "unlimited") {
    memoryMax = null;
    source = "env-unlimited";
  } else {
    memoryMax = defaultScopeMemoryMax(opts.totalmemBytes ?? os.totalmem(), opts.totalmemFraction);
    source = "host-derived";
  }
  return {
    envelope: "scope",
    memoryMax,
    source,
    unit: scopeUnitName(opts.prefix, opts.root, opts.nowMs ?? Date.now()),
    reason: null,
  };
}

/** Wrap `innerArgv` in `systemd-run --user --scope` (`envelope === "none"` ⇒ return `innerArgv`
 *  UNCHANGED = the pre-fix behaviour). `--scope` execs in place ⇒ the inner argv is the TAIL, the pid
 *  is preserved, and ⛔ no shell is inserted. `--collect` reaps the transient scope when the member
 *  exits (including on failure); the property list is `SCOPE_PROPERTY_ARGS` — the **SAME** array the
 *  availability probe drives, so 「探测绿」 implies these exact properties are accepted. The ceiling is
 *  passed only when present (⛔ never as an "equivalent-unlimited" literal).
 *
 *  Since `boundedScopeArgv` exists this is a thin, serve-shaped CALL of it — ⛔ not a second argv
 *  builder (硬规则 5b). The suite's envelope goes through the same function. */
export function scopeLaunchArgv(
  innerArgv: string[],
  res: { envelope: "scope" | "none"; memoryMax: string | null; unit: string | null },
): string[] {
  if (res.envelope === "none" || !res.unit) return innerArgv;
  return boundedScopeArgv(innerArgv, { memoryMax: res.memoryMax }, { collect: true, unit: res.unit });
}

/** The serve host's envelope. ⛔ The ONE call the serve spawn sites share — neither
 *  `cli/server.ts` nor `start-drivers.ts` spells a `systemd-run` argv of its own. */
export function resolveServeEnvelope(opts: {
  root: string;
  systemdRun?: boolean;
  totalmemBytes?: number;
  limitsRaw?: string;
  nowMs?: number;
}): ResolvedScopeEnvelope {
  return resolveScopeEnvelope({
    prefix: SERVE_UNIT_PREFIX,
    root: opts.root,
    limitsEnv: SERVE_LIMITS_ENV,
    systemdRun: opts.systemdRun,
    totalmemBytes: opts.totalmemBytes,
    limitsRaw: opts.limitsRaw,
    nowMs: opts.nowMs,
  });
}

/** The stable, one-line report a serve spawn site emits when the envelope could not be applied.
 *  ⛔ Never returns a line for `envelope === "scope"` — the presence of this string IS the signal
 *  that the host is NOT restart-protected. */
export function serveScopeUnavailableReport(res: ResolvedScopeEnvelope): string | null {
  if (res.envelope !== "none") return null;
  return `${SERVE_SCOPE_UNAVAILABLE}: the serve host will spawn WITHOUT its own cgroup scope — ${res.reason ?? "reason not recorded"}; a restart of the launching session/service can kill it\n`;
}
