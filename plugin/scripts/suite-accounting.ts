// suite-accounting.ts — the cgroup/systemd ACCOUNTING family, extracted from full-suite-runner.ts
// (gap-suite-hub-file-responsibility-strip).
//
// WHY A SEPARATE FILE: full-suite-runner.ts is a HUB file (any change forces the full suite). But the
// accounting family (per-phase cgroup cpu/psi differential reads + the systemd `Consumed` load fields)
// is PURE TELEMETRY — changing it never flips pass/fail, yet each such change forced a ~13-min full
// suite. Extracted to this NON-hub file, an accounting-only change now takes the bucket path
// (suite-bucket-hub-list.ts deliberately does NOT list this file). The functions keep their exact
// names/semantics and are re-exported from full-suite-runner.ts, so the runner's public API surface
// (and its importers, e.g. full-suite-runner.test.mjs) is unchanged.
//
// Moved verbatim from full-suite-runner.ts lines 804-1293: PhaseCounters / PhaseCountersRead /
// PhaseDiffRecord (types); resolveCgroupV2Dir / parseCpuStatUsageUsec / parsePressureSomeTotal /
// readPhaseCounters (cgroup v2 reads); PhaseDifferentialAccounting (the per-phase differential
// accumulator); ParsedConsumedLine / ScopeConsumedLoadRead / parseSystemdTimespanToSeconds /
// parseSystemdBytesToMb / parseSystemdConsumedLine / parseConsumedFromJournalOutput /
// readScopeConsumedLoad (the systemd `Consumed` load family). Hermetic seams unchanged:
// QUAY_TEST_CGROUP_DIR, QUAY_TEST_CGROUP_SCRIPT, QUAY_TEST_JOURNALCTL_OUTPUT.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

// ── gap-phase-boundary-differential-accounting ─────────────────────────────────────────────────────
// Per-phase DIFFERENTIAL accounting of MONOTONIC CUMULATIVE counters at each phase boundary
// (static→serial→lowconc→main→end + inter-phase gaps). Reads are DIFFERENTIAL — the cumulative
// cgroup counters (`cpu.stat usage_usec`, `cpu.pressure`/`io.pressure` `some … total=`) are read
// once at each boundary and the phase's usage is the DIFF between consecutive reads — never periodic
// sampling of an instantaneous rate. The counters are kernel-accumulated EXACT totals, so a phase's
// cpu_usec is the exact CPU consumed inside that phase's window, and the derived quantities
// (相利用率=cpu_usec/(wall×lanes), 相饱和度=cpu_usec/(wall×nproc), 等待占比=psi diff/wall) answer
// 「这一相是算得多还是等得久」 directly from the record — no wall-clock + code-constant 推算.
//
// The counter source is the SUITE CHILD's cgroup (resolved from /proc/<pid>/cgroup — cgroup v2;
// the child's process tree accumulates the phase CPU). Hermetic seam for deterministic tests:
//   QUAY_TEST_CGROUP_DIR    — override the cgroup dir (real files read from it).
//   QUAY_TEST_CGROUP_SCRIPT — JSON map phase-name → {cpu_usec, psi_cpu_total, psi_io_total}
//                             (counters AT THE START of that phase; key "round_end" = the finalize
//                             read). When set, overrides file reads entirely.
// Fail-open (硬规则⑥ 缺值=未查≠为假): an unreadable counter yields EXPLICIT null cpu/psi fields +
// a read-error reason, NEVER a fabricated 0 (a 0 cpu_usec would read as "idle" — a wrong claim).

export interface PhaseCounters {
  cpu_usec: number;
  psi_cpu_total: number;
  psi_io_total: number;
}

export interface PhaseCountersRead {
  counters: PhaseCounters | null;
  read_error: string | null;
  cgroup_dir: string | null;
}

/** One per-phase differential record (the task's `phase, wall_ms, cpu_usec, psi_cpu_total, psi_io_total, lanes`). */
export interface PhaseDiffRecord {
  phase: string;
  wall_ms: number;
  /** ABSOLUTE epoch-ms start of the phase (gap-verification-round-observability-holes AC2): `wall_ms`
   *  (the duration) collapses under PHASE_OVERLAP — serial+lowconc merge into ONE window, so a duration
   *  can no longer say WHEN each ran or how much they truly overlapped. The absolute edges do not
   *  collapse, so a reader can reconstruct the real overlap post-hoc (`start_ms`/`end_ms` are the phase
   *  boundary timestamps, contiguous across phases — a phase's `end_ms` == the next phase's `start_ms`). */
  start_ms: number;
  end_ms: number;
  cpu_usec: number | null;
  psi_cpu_total: number | null;
  psi_io_total: number | null;
  lanes: number;
  /** TRUE only on the FINAL phase when its cpu_usec was backfilled from the systemd `Consumed`
   *  total (the transient scope is destroyed before the round-end read — cpu.stat is ENOENT). The
   *  derived value is `consumed_total − Σ(completed phases)` — exact, kernel-accumulated, but
   *  DERIVED (never a fabricated 0). PSI stays null on that phase (no PSI in the Consumed line). */
  reconstructed?: boolean;
  /** PHASE_OVERLAP only — the combined serial+lowconc window's per-process sub-times (test.sh's
   *  `__OVERHEAD__ overlap_<phase>_ms=N` markers, attached to the window record when BOTH parallel
   *  phases have finished). Lets a reader split the window back into the serial and lowconc
   *  contributions (gap-verification-round-phases-overlap-merged AC1/AC2 — 不得再合成一桶). Absent
   *  on sequential rounds and when the markers were missed (a truncated/red window has no breakdown). */
  overlap_sub_ms?: { serial_ms?: number; lowconc_ms?: number };
}

/** Resolve the cgroup v2 directory of a process (its CPU/PSI counters), or the QUAY_TEST_CGROUP_DIR seam. */
export function resolveCgroupV2Dir(pid: number): string | null {
  const seam = process.env.QUAY_TEST_CGROUP_DIR;
  if (seam) return path.resolve(seam);
  try {
    const line = String(fs.readFileSync(`/proc/${pid}/cgroup`, "utf8"))
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith("0::"));
    if (!line) return null;
    const rel = line.slice("0::".length).trim();
    const root = "/sys/fs/cgroup";
    if (!rel || rel === "/") return root;
    const full = path.join(root, rel);
    // Guard: the resolved path must stay under the cgroup v2 root (a malformed /proc entry must not
    // escape into arbitrary filesystem reads).
    const relCheck = path.relative(root, full);
    if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) return null;
    return full;
  } catch {
    return null;
  }
}

/** Parse a cgroup v2 `cpu.stat` for `usage_usec <n>` (null when absent). */
export function parseCpuStatUsageUsec(text: string): number | null {
  const m = /^usage_usec\s+(\d+)$/m.exec(text);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

/** Parse a cgroup v2 `cpu.pressure` / `io.pressure` `some` line for `total=<n>` (null when absent). */
export function parsePressureSomeTotal(text: string): number | null {
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("some")) continue;
    const m = /total=(\d+)/.exec(t);
    if (m) {
      const v = Number(m[1]);
      if (Number.isFinite(v)) return v;
    }
  }
  return null;
}

/** Read the three monotonic cumulative counters from a cgroup dir (null + reason on any failure). */
export function readPhaseCounters(cgroupDir: string): PhaseCountersRead {
  try {
    const cpuStat = String(fs.readFileSync(path.join(cgroupDir, "cpu.stat"), "utf8"));
    const cpuPressure = String(fs.readFileSync(path.join(cgroupDir, "cpu.pressure"), "utf8"));
    const ioPressure = String(fs.readFileSync(path.join(cgroupDir, "io.pressure"), "utf8"));
    const cpu_usec = parseCpuStatUsageUsec(cpuStat);
    const psi_cpu_total = parsePressureSomeTotal(cpuPressure);
    const psi_io_total = parsePressureSomeTotal(ioPressure);
    if (cpu_usec === null || psi_cpu_total === null || psi_io_total === null) {
      return {
        counters: null,
        read_error: `counter file missing required field (cpu_usec=${cpu_usec} psi_cpu=${psi_cpu_total} psi_io=${psi_io_total}) in ${cgroupDir}`,
        cgroup_dir: cgroupDir,
      };
    }
    return { counters: { cpu_usec, psi_cpu_total, psi_io_total }, read_error: null, cgroup_dir: cgroupDir };
  } catch (e) {
    return {
      counters: null,
      read_error: `cgroup counter read failed: ${e instanceof Error ? e.message : String(e)}`,
      cgroup_dir: cgroupDir,
    };
  }
}

interface PhaseCgroupScript {
  [phaseKey: string]: PhaseCounters;
}

/**
 * Per-phase differential accumulator. Holds the current phase, the counter snapshot at its start,
 * and the completed phase records. boundary()/finalize() read the counters at the boundary, diff
 * against the phase-start snapshot, push one record, and roll the snapshot forward. All reads are
 * fail-open (null cpu/psi + read_error on any failure — never a fabricated 0).
 */
export class PhaseDifferentialAccounting {
  records: PhaseDiffRecord[] = [];
  read_error: string | null = null;
  /** The ROUND-END (finalize) read failure, kept SEPARATE from `read_error`: the transient
   *  systemd-run scope is destroyed before the finalize read (cpu.stat → ENOENT) in EVERY real
   *  production round — an EXPECTED gap that must not be confused with "the counters were never
   *  readable" (which `read_error` carries, from the baseline/boundary reads). A reader can
   *  distinguish "completed phases real, final read failed (scope destroyed)" from "no counters at
   *  all" by checking `phase_final_read_error` vs `phase_counter_error`. */
  finalReadError: string | null = null;

  private readonly childPid: number;
  private readonly lanesFor: (phase: string) => number;
  private startCounters: PhaseCounters | null = null;
  private startWallMs = 0;
  private currentPhase = "";
  private countersDir: string | null = null;
  private readonly script: PhaseCgroupScript | null;

  /** The phase currently being accumulated ("" after finalize). */
  get phase(): string {
    return this.currentPhase;
  }

  constructor(childPid: number, lanesFor: (phase: string) => number) {
    this.childPid = childPid;
    this.lanesFor = lanesFor;
    const seam = process.env.QUAY_TEST_CGROUP_SCRIPT;
    if (seam) {
      try {
        this.script = JSON.parse(seam) as PhaseCgroupScript;
      } catch {
        this.script = null;
        this.read_error = `QUAY_TEST_CGROUP_SCRIPT is not valid JSON`;
      }
    } else {
      this.script = null;
    }
  }

  /** Read the counters at the moment a phase is ABOUT TO START (keyed by that phase in the seam). */
  private readFor(nextPhase: string): PhaseCountersRead {
    if (this.script) {
      const c = this.script[nextPhase];
      if (!c) {
        return { counters: null, read_error: `phase script has no snapshot for '${nextPhase}'`, cgroup_dir: null };
      }
      return { counters: { ...c }, read_error: null, cgroup_dir: null };
    }
    this.countersDir = this.countersDir ?? resolveCgroupV2Dir(this.childPid);
    if (!this.countersDir) {
      return { counters: null, read_error: `could not resolve the suite cgroup (pid ${this.childPid})`, cgroup_dir: null };
    }
    return readPhaseCounters(this.countersDir);
  }

  /** Establish the baseline + open the first phase. */
  init(firstPhase: string): void {
    this.currentPhase = firstPhase;
    this.startWallMs = Date.now();
    const r = this.readFor(firstPhase);
    this.startCounters = r.counters;
    if (r.read_error) this.read_error = r.read_error;
  }

  /** Close the current phase (record its differential) and open the next. */
  boundary(nextPhase: string): void {
    const now = Date.now();
    const wall_ms = now - this.startWallMs;
    const r = this.readFor(nextPhase);
    const cur = r.counters;
    let cpu_usec: number | null = null;
    let psi_cpu_total: number | null = null;
    let psi_io_total: number | null = null;
    if (this.startCounters && cur) {
      cpu_usec = Math.max(0, cur.cpu_usec - this.startCounters.cpu_usec);
      psi_cpu_total = Math.max(0, cur.psi_cpu_total - this.startCounters.psi_cpu_total);
      psi_io_total = Math.max(0, cur.psi_io_total - this.startCounters.psi_io_total);
    }
    this.records.push({
      phase: this.currentPhase,
      wall_ms: Math.max(0, wall_ms),
      start_ms: this.startWallMs,
      end_ms: now,
      cpu_usec,
      psi_cpu_total,
      psi_io_total,
      lanes: this.lanesFor(this.currentPhase),
    });
    if (r.read_error) this.read_error = r.read_error;
    this.startCounters = cur;
    this.startWallMs = now;
    this.currentPhase = nextPhase;
    this.countersDir = r.cgroup_dir ?? this.countersDir;
  }

  /**
   * Rename the in-flight phase (and its just-pushed record). Used to REPAIR a spurious gap record:
   * when a phase between serial and main is EMPTY (its start marker never fires — e.g. an empty
   * lowconc group), the gap opened at serial's __GROUP__ actually spans the MAIN interval. The
   * caller renames it to "main" (its wall/cpu ARE main's) before closing main→end.
   */
  replacePhase(newPhase: string): void {
    const last = this.records[this.records.length - 1];
    if (last && last.phase === this.currentPhase) {
      last.phase = newPhase;
      last.lanes = this.lanesFor(newPhase);
    }
    this.currentPhase = newPhase;
  }

  /**
   * Close the final phase at round end (the "end"/tail record). Runs at SUITE EXIT — before the
   * post-suite journal poll — so the final phase's wall_ms is the real exit-spanning wall, not the
   * poll's ≤5s tail. The transient systemd-run scope is DESTROYED before this read (cpu.stat →
   * ENOENT), so the final phase's own cpu.stat read fails fail-open (null); `backfillFinalCpu` is
   * called later with the systemd `Consumed` total (when available) to derive the exit-spanning CPU.
   */
  finalize(): void {
    if (!this.currentPhase) return;
    const lastPhase = this.currentPhase;
    // The finalize read is the ROUND-END snapshot. In the seam, key "round_end"; on the real path
    // it reads the child's cgroup one last time (a destroyed systemd scope yields null — fail-open).
    const now = Date.now();
    const wall_ms = now - this.startWallMs;
    const r = this.readFor("round_end");
    const cur = r.counters;
    let cpu_usec: number | null = null;
    let psi_cpu_total: number | null = null;
    let psi_io_total: number | null = null;
    if (this.startCounters && cur) {
      cpu_usec = Math.max(0, cur.cpu_usec - this.startCounters.cpu_usec);
      psi_cpu_total = Math.max(0, cur.psi_cpu_total - this.startCounters.psi_cpu_total);
      psi_io_total = Math.max(0, cur.psi_io_total - this.startCounters.psi_io_total);
    }
    this.records.push({
      phase: lastPhase,
      wall_ms: Math.max(0, wall_ms),
      start_ms: this.startWallMs,
      end_ms: now,
      cpu_usec,
      psi_cpu_total,
      psi_io_total,
      lanes: this.lanesFor(lastPhase),
    });
    // The finalize read failure is EXPECTED when the transient scope was destroyed at exit — record
    // it as `finalReadError` (distinct from `read_error`, which stays the "counters never readable"
    // signal from the baseline/boundary reads). A round whose completed phases carry real data but
    // whose exit-spanning phase read failed is NORMAL in production, not a counter failure.
    if (r.read_error) this.finalReadError = r.read_error;
    this.currentPhase = "";
  }

  /**
   * Backfill the FINAL (exit-spanning) phase's cpu_usec from the round's TOTAL CPU — the systemd
   * `Consumed` journal line (authoritative kernel-accumulated User+System µs for the transient
   * scope). Called AFTER the journal poll (the line appears ~2s after the scope ends). The value is
   * `total − Σ(completed phases)` — exact, clamped ≥ 0 (a read-timing overage must not go negative).
   * PSI has no journal counterpart — it stays null (honest; not fabricatable). No-op when the final
   * phase already has a real reading, when totalCpuUsec is absent, or when nothing was finalized.
   */
  backfillFinalCpu(totalCpuUsec: number | null): void {
    const last = this.records[this.records.length - 1];
    if (!last || last.cpu_usec != null) return; // real read already closed it (plain-bash path)
    if (totalCpuUsec == null || !Number.isFinite(totalCpuUsec) || totalCpuUsec <= 0) return;
    const completedSum = this.records.reduce((s, rec) => s + (rec.cpu_usec ?? 0), 0);
    const remaining = totalCpuUsec - completedSum;
    if (remaining > 0) {
      last.cpu_usec = Math.round(remaining);
      last.reconstructed = true;
    }
  }
}

// ── gap-verification-round-load-fields-from-systemd ────────────────────────────────────────────────
// The phase-lane experiment (#26) needs a per-round 关注负载 (load focus) axis. systemd already
// records the consumed CPU time / memory peak / memory swap peak for every scope and writes a
// `Consumed` journal line when the scope exits (`journalctl --user -u <scope_unit>`). The runner
// captures the scope_unit at round START (the fire-and-forget below), then reads the Consumed line
// with BOUNDED POLLING (the line appears ~2s AFTER the scope ends) and carries the three fields into
// the verification-round record — zero new instrumentation, kernel-accumulated exact values (NOT the
// 34×5s-sample 20.8% extrapolation). Traps (manager 2026-08-12, adopted verbatim):
//   1. suite-cgroup-evidence.txt is a SINGLE-SLOT file overwritten each round — the scope_unit must
//      be captured into THIS round's OWN record at round start, NOT read back from the shared file
//      at teardown (shadow-copy-drift shape).
//   2. the Consumed line appears ~2s AFTER the round ends — reading the journal at subprocess-exit is
//      empty; poll with a bounded timeout (≤5s, 200ms interval). The runner lives OUTSIDE the scope
//      (it spawns systemd-run --scope wrapping the suite), so it survives the child's exit and is
//      eligible to poll.
//   3. a failed read must be explicit null + reason, NEVER 0 (硬规则⑥ 缺值=未查≠为假) —
//      `mem_peak_mb: 0` reads as "this round used no memory"; `cpu_time_s: 0` makes the parallelism
//      quotient infinite.

/** A parsed systemd `Consumed` journal line. mem/swap are null when the line omitted them (memory
 * accounting off — the line is then `Consumed <T> CPU time.`); cpu_time_s is always present when the
 * line matched. */
export interface ParsedConsumedLine {
  cpu_time_s: number;
  mem_peak_mb: number | null;
  swap_peak_mb: number | null;
}

/** The round's scope-load read result: the three fields + a read-error reason (trap 3 — never 0). */
export interface ScopeConsumedLoadRead {
  cpu_time_s: number | null;
  mem_peak_mb: number | null;
  swap_peak_mb: number | null;
  load_read_error: string | null;
}

/** Convert systemd's human timespan (`3.005s`, `48min 3.887s`, `1h 2min 3.456s`) to seconds. */
export function parseSystemdTimespanToSeconds(raw: string): number | null {
  const parts = raw.match(/(\d+(?:\.\d+)?)\s*(h|min|s)/g);
  if (!parts) return null;
  let total = 0;
  for (const p of parts) {
    const m = p.match(/(\d+(?:\.\d+)?)\s*(h|min|s)/);
    if (!m) return null;
    const v = Number(m[1]);
    if (!Number.isFinite(v)) return null;
    if (m[2] === "h") total += v * 3600;
    else if (m[2] === "min") total += v * 60;
    else total += v;
  }
  return total;
}

/** Convert systemd's human byte size (`1.4G`, `512M`, `0B` — IEC binary units) to MB. */
export function parseSystemdBytesToMb(raw: string): number | null {
  const m = String(raw).trim().match(/^(\d+(?:\.\d+)?)\s*([KMGTPE]?)(?:i?B)?$/i);
  if (!m) return null;
  const v = Number(m[1]);
  if (!Number.isFinite(v)) return null;
  const unit = m[2].toUpperCase();
  const mult =
    unit === "K"
      ? 1024
      : unit === "M"
        ? 1024 ** 2
        : unit === "G"
          ? 1024 ** 3
          : unit === "T"
            ? 1024 ** 4
            : unit === "P"
              ? 1024 ** 5
              : unit === "E"
                ? 1024 ** 6
                : 1;
  return (v * mult) / 1024 ** 2;
}

/**
 * Parse a systemd `Consumed` journal line:
 *   `run-<uuid>.scope: Consumed 48min 3.887s CPU time, 1.4G memory peak, 0B memory swap peak.`
 * Returns null when the line has no Consumed shape (e.g. the scope's `Started …` line). mem/swap are
 * null when the line omitted them (memory accounting off — the line is then `Consumed <T> CPU time.`).
 */
export function parseSystemdConsumedLine(line: string): ParsedConsumedLine | null {
  const m = /Consumed\s+(.+?)\s+CPU time/i.exec(line);
  if (!m) return null;
  const cpu_time_s = parseSystemdTimespanToSeconds(m[1]);
  if (cpu_time_s === null) return null;
  const memM = /,\s*(\S+)\s+memory peak/i.exec(line);
  const swapM = /,\s*(\S+)\s+memory swap peak/i.exec(line);
  return {
    cpu_time_s,
    mem_peak_mb: memM ? parseSystemdBytesToMb(memM[1]) : null,
    swap_peak_mb: swapM ? parseSystemdBytesToMb(swapM[1]) : null,
  };
}

/** Find the first `Consumed` line in a journalctl blob and parse it (null when absent). */
export function parseConsumedFromJournalOutput(output: string): ParsedConsumedLine | null {
  for (const l of output.split("\n")) {
    const parsed = parseSystemdConsumedLine(l);
    if (parsed) return parsed;
  }
  return null;
}

/**
 * Read the scope's `Consumed` journal line with BOUNDED POLLING (trap 2 — the line appears ~2s AFTER
 * the scope ends; a single read at subprocess-exit is empty). Polls `journalctl --user -u <unit>
 * --since <startedAt> --no-pager` every intervalMs until a Consumed line appears or timeoutMs elapses
 * (≤5s default). Returns explicit null + load_read_error on ANY failure (trap 3 — never 0).
 * Seam (hermetic): QUAY_TEST_JOURNALCTL_OUTPUT — when set, the "journal output" is read from the env
 * var exactly once (no journalctl, no polling) so deterministic hermetic tests exercise the same
 * parse-and-record path without a real systemd scope.
 */
export async function readScopeConsumedLoad(
  scopeUnit: string,
  sinceIso: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<ScopeConsumedLoadRead> {
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const intervalMs = opts.intervalMs ?? 200;
  const seam = process.env.QUAY_TEST_JOURNALCTL_OUTPUT;
  const deadline = Date.now() + timeoutMs;
  let lastError: string | null = null;
  for (;;) {
    let output: string;
    if (seam !== undefined) {
      // Hermetic seam — single-shot, no polling (deterministic).
      const found = parseConsumedFromJournalOutput(seam);
      if (found) {
        return {
          cpu_time_s: found.cpu_time_s,
          mem_peak_mb: found.mem_peak_mb,
          swap_peak_mb: found.swap_peak_mb,
          load_read_error:
            found.mem_peak_mb === null || found.swap_peak_mb === null
              ? "Consumed line reported CPU time but not memory peak/swap (memory accounting off)"
              : null,
        };
      }
      return {
        cpu_time_s: null,
        mem_peak_mb: null,
        swap_peak_mb: null,
        load_read_error: `no Consumed line in QUAY_TEST_JOURNALCTL_OUTPUT seam for ${scopeUnit}`,
      };
    }
    try {
      output = execFileSync(
        "journalctl",
        ["--user", "-u", scopeUnit, "--since", sinceIso, "--no-pager"],
        { encoding: "utf8", timeout: 2_000, stdio: ["ignore", "pipe", "ignore"] },
      );
      const found = parseConsumedFromJournalOutput(output);
      if (found) {
        return {
          cpu_time_s: found.cpu_time_s,
          mem_peak_mb: found.mem_peak_mb,
          swap_peak_mb: found.swap_peak_mb,
          load_read_error:
            found.mem_peak_mb === null || found.swap_peak_mb === null
              ? "Consumed line reported CPU time but not memory peak/swap (memory accounting off)"
              : null,
        };
      }
      lastError = `no Consumed line in journal for ${scopeUnit} within ${timeoutMs}ms`;
    } catch (e) {
      lastError = `journalctl failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { cpu_time_s: null, mem_peak_mb: null, swap_peak_mb: null, load_read_error: lastError ?? "unknown" };
}

// ── gap-routine-semantic-dedup-scan-preverified-effective-parallelism ──────────────────────────────
/**
 * The round's effective parallelism: cpu_time_s ÷ (durationMs/1000) = consumed CPU time ÷ wall time
 * = the average cores actually driven. Rounded to 3 decimals (comparable across rounds). null when
 * either input is missing/non-finite/≤0 (a fabricated 0 quotient would read "infinite cores" —
 * 硬规则⑥ 缺值=未查≠为假).
 *
 * gap-verification-round-observability-holes AC4 introduced this KPI; gap-wiring-B-verification-
 * round-write-path AC1 wired it into the real fan-in landing writer.
 *
 * SINGLE DEFINITION POINT (.quay/routine-findings.jsonl finding `preverified-effective-parallelism`,
 * routine `semantic-dedup-scan`): the body lived in BOTH full-suite-runner.ts and
 * pre-verified-round-record.ts, byte-identical ⇒ two homes for one cpu/wall expression, free to
 * drift on any seam change. Lifted here — the NON-hub telemetry module the accounting family already
 * lives in — and re-exported from full-suite-runner.ts so its public API surface is unchanged; the
 * thin writer imports THIS binding (mirrors the hostParallelism re-export from runner-concurrency.ts).
 */
export function effectiveParallelism(cpuTimeS: number | null | undefined, durationMs: number): number | null {
  if (cpuTimeS == null || !Number.isFinite(cpuTimeS) || cpuTimeS <= 0) return null;
  const wallS = durationMs / 1000;
  if (!Number.isFinite(wallS) || wallS <= 0) return null;
  return Number((cpuTimeS / wallS).toFixed(3));
}
