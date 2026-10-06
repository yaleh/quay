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

let _systemdScopeAvailable: boolean | null = null;

/** Whether `systemd-run --user --scope` works on this host (memoized). The probe runs a REAL
 *  transient scope (`true`): the binary being on PATH is NOT the criterion — a live user manager /
 *  D-Bus must accept `--scope` + properties. `QUAY_TEST_SYSTEMD_RUN_AVAILABLE=0|1` forces the answer.
 *
 *  ⚠️ The seam is consulted BEFORE the memo on purpose: a test that injects "unavailable" must not be
 *  defeated by an earlier REAL probe in the same process (the fallback branch can only be asserted on
 *  a host where systemd-run DOES work, which is exactly the host that would otherwise memoize true). */
export function systemdScopeAvailable(): boolean {
  const forced = process.env[SYSTEMD_RUN_AVAILABLE_ENV];
  if (forced === "0") return false;
  if (forced === "1") return true;
  if (_systemdScopeAvailable !== null) return _systemdScopeAvailable;
  try {
    execFileSync("systemd-run", ["--user", "--scope", "--quiet", "-p", "MemoryAccounting=yes", "true"], {
      stdio: "ignore",
      timeout: 10_000,
    });
    _systemdScopeAvailable = true;
  } catch {
    _systemdScopeAvailable = false;
  }
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

/** Default ceiling: `floor(totalmem × fraction)`, page-aligned, at least one page.
 *  ⛔ Pure (the input is a byte COUNT, not `os.totalmem()`) so two injected host sizes necessarily
 *  give two different values. */
export function defaultScopeMemoryMax(totalmemBytes: number, fraction = SCOPE_ENVELOPE_HOST_FRACTION): string {
  const bytes = Math.floor(Math.max(0, totalmemBytes) * fraction);
  const aligned = Math.max(SCOPE_ENVELOPE_PAGE_BYTES, Math.floor(bytes / SCOPE_ENVELOPE_PAGE_BYTES) * SCOPE_ENVELOPE_PAGE_BYTES);
  return String(aligned);
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
 *  exits (including on failure); `OOMPolicy=continue` keeps one OOM-killed member from taking the
 *  unit down. The ceiling is passed only when present (⛔ never as an "equivalent-unlimited" literal). */
export function scopeLaunchArgv(
  innerArgv: string[],
  res: { envelope: "scope" | "none"; memoryMax: string | null; unit: string | null },
): string[] {
  if (res.envelope === "none" || !res.unit) return innerArgv;
  const argv = [
    "systemd-run", "--user", "--scope", "--collect",
    `--unit=${res.unit}`,
    "-p", "MemoryAccounting=yes",
    "-p", "OOMPolicy=continue",
  ];
  if (res.memoryMax) argv.push("-p", `MemoryMax=${res.memoryMax}`);
  return [...argv, ...innerArgv];
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
