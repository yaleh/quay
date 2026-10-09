#!/usr/bin/env node
// effective-capacity-probe.ts — cgroup-v2-aware "effective capacity" probe.
//
// WHY THIS EXISTS (gap-effective-capacity-cgroup-cpu-memory-probe, the first landing point of the
// human's 2026-10-09 architecture ruling DIR-132): the repo's existing capacity readings are
// HOST-WIDE and quota-blind. `nproc` / `nproc --all` (resource-gate.sh, process-budget.sh) report
// the host's online CPUs; `os.totalmem()` (driver-runtime.ts / driver-anchor.ts host-derived memory
// envelope) reports the host's /proc/meminfo total. Inside a cgroup that is capped to 2 CPUs or to
// 8 GiB, both readings over-report — a memory envelope derived from os.totalmem() inside an
// 8 GiB-capped container is far larger than what the container can actually hold, so the OOM
// protection that envelope exists to provide is weakened exactly where it is needed.
//
// WHAT IT ADDS — a read-only probe that reads the SAME files a cgroup v2 kernel writes for its own
// limits and reports the EFFECTIVE value with its PROVENANCE:
//   cpu bandwidth   /sys/fs/cgroup<cgroup-of-this-process>/cpu.max      ("<quota> <period>", "max")
//   cpu cpuset      /sys/fs/cgroup<cgroup-of-this-process>/cpuset.cpus.effective
//   memory          /sys/fs/cgroup<cgroup-of-this-process>/memory.max   (bytes, "max")
//
// ⛔ THIS MODULE CHANGES NO EXISTING CONSUMER. resource-gate.sh / process-budget.sh / driver-anchor.ts
// are byte-identical on the branch that introduced this file (AC5) — wiring this probe into the
// worker-shrink / memory-budget / backpressure consumers is a SEPARATE later task.
//
// ── Fail-open by contract (AC2/DoD) ──────────────────────────────────────────────────────────────
// cgroup v2 unavailable (no unified hierarchy, no /proc/self/cgroup "0::" line, cpu.max/memory.max
// absent or unparsable) ⇒ fall back to the existing readings (os.availableParallelism() / os.totalmem())
// and REPORT that we fell back. It never refuses to run, and it never returns a number without saying
// where the number came from.
//
// ── The third state (AC3, hard rule 3b) ──────────────────────────────────────────────────────────
// "probe failed / cgroup unavailable" must not be shaped like "cgroup present and unlimited": a
// fallback value silently dressed as a normal reading is indistinguishable from a real one. The
// landing points for that third state are `cgroup_v2` (false = the cgroup was NOT readable) plus the
// two `*_source` fields. Reading the four combinations:
//   cgroup_v2=false                     → no cgroup was read at all; every value is a host fallback.
//   cgroup_v2=true + source=cgroup-*    → the cgroup file supplied this value.
//   cgroup_v2=true + source=*-fallback  → the cgroup WAS readable but imposed no limit of that kind
//                                          (cpu.max == "max" / memory.max == "max") — a different
//                                          fact from "cgroup unavailable", and distinguishable above.
//
// ── os.availableParallelism() IS quota-aware (AC1, MEASURED 2026-10-09 on this host, do not re-assume) ──
// runner-concurrency.ts derives concurrency from os.availableParallelism() and the repo had no
// measurement of whether that API sees an external cgroup CPU quota. Measured on Node v24.21.0,
// host nproc=128, inside real `systemd-run --user --scope` scopes:
//     CPUQuota=50%    cpu.max=50000 100000     nproc=128  availableParallelism=1
//     CPUQuota=150%   cpu.max=150000 100000    nproc=128  availableParallelism=1
//     CPUQuota=250%   cpu.max=250000 100000    nproc=128  availableParallelism=2
//     CPUQuota=400%   cpu.max=400000 100000    nproc=128  availableParallelism=4
//     CPUQuota=1000%  cpu.max=1000000 100000   nproc=128  availableParallelism=10
//     (no quota)      cpu.max=max 100000       nproc=128  availableParallelism=128
//     taskset -c 0-3  (affinity, no quota)     nproc=4    availableParallelism=4
// ⇒ it DOES reflect the cgroup v2 bandwidth quota (floor(quota/period), clamped to ≥1) and CPU
// affinity. `nproc` does NOT (it stayed 128 under every quota). This is why `nproc=` below is the
// availableParallelism reading (the quota-aware "existing reading" AC2 names) and `cpu_source`
// exists: the two agree under a quota, and it is the SOURCE field that says so.
//
// ── Output contract (AC3; field names frozen by the 2026-10-09 cross-project alignment) ─────────
// report mode: one `key=value` per line, in this order:
//   effective_cpu=<int>          min(bandwidth-quota cores, cpuset cores, nproc) — the final value
//   cpu_source=cgroup-cpu-max|cpuset|nproc-fallback
//   effective_mem_mb=<int>
//   mem_source=cgroup-memory-max|free-fallback
//   nproc=<int>                  the control reading (host/affinity/quota-aware parallelism), NOT the final value
//   cgroup_v2=true|false
// `--json` prints exactly the same six fields as one JSON object with unchanged key names.
//
// Tie-break when two candidates give the same minimum: cgroup-cpu-max > cpuset > nproc-fallback
// (a cgroup constraint that happens to equal the host reading is still the cgroup constraint).
//
// Test seams (AC3; same naming style as resource-gate.sh's RESOURCE_GATE_TEST_*). They override the
// RAW READINGS, they are not a second code path:
//   EFFECTIVE_CAPACITY_TEST_CPU_MAX        override the cpu.max raw text ("200000 100000" / "max 100000")
//   EFFECTIVE_CAPACITY_TEST_CPUSET_COUNT   override the cpuset core COUNT (integer)
//   EFFECTIVE_CAPACITY_TEST_MEMORY_MAX     override the memory.max raw text (bytes / "max")
//   EFFECTIVE_CAPACITY_TEST_NPROC          override the nproc reading (integer)
//   EFFECTIVE_CAPACITY_TEST_MEM_AVAIL_MB   override the memory FALLBACK reading (MB)
// Setting any of the three cgroup seams asserts a cgroup IS present (that is what the seam simulates),
// so cgroup_v2 reads true even on a host without a unified hierarchy.
//
// Usage:
//   node --experimental-strip-types plugin/scripts/effective-capacity-probe.ts            # report
//   node --experimental-strip-types plugin/scripts/effective-capacity-probe.ts --json     # JSON
//   node --experimental-strip-types plugin/scripts/effective-capacity-probe.ts --help     # usage, exit 0
//
// Exit status: 0 = report emitted (report mode never fails — fail-open by contract);
//              2 = usage error (an unrecognized argument); --help exits 0 with no side effects.
//
// Tests: plugin/test/effective-capacity-probe.test.mjs (@test-group engine).

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { isDirectEntry } from "./gate-script-base.ts";

export const CGROUP_ROOT = "/sys/fs/cgroup";
export const PROC_SELF_CGROUP = "/proc/self/cgroup";

/** The five test-seam env var names (AC3 — exactly these, no more). */
export const TEST_CPU_MAX = "EFFECTIVE_CAPACITY_TEST_CPU_MAX";
export const TEST_CPUSET_COUNT = "EFFECTIVE_CAPACITY_TEST_CPUSET_COUNT";
export const TEST_MEMORY_MAX = "EFFECTIVE_CAPACITY_TEST_MEMORY_MAX";
export const TEST_NPROC = "EFFECTIVE_CAPACITY_TEST_NPROC";
export const TEST_MEM_AVAIL_MB = "EFFECTIVE_CAPACITY_TEST_MEM_AVAIL_MB";

export const CPU_SOURCES = ["cgroup-cpu-max", "cpuset", "nproc-fallback"] as const;
export const MEM_SOURCES = ["cgroup-memory-max", "free-fallback"] as const;
export type CpuSource = (typeof CPU_SOURCES)[number];
export type MemSource = (typeof MEM_SOURCES)[number];

/** The probe's output view-model — ONE shape shared by report mode and --json (key names frozen). */
export interface EffectiveCapacity {
  effective_cpu: number;
  cpu_source: CpuSource;
  effective_mem_mb: number;
  mem_source: MemSource;
  nproc: number;
  cgroup_v2: boolean;
}

/** The RAW readings the derivation consumes. `null` = the source was absent/unreadable (NOT zero,
 *  NOT "unlimited" — AC 硬规则 3b: "could not read" never shares a value with "read a limit"). */
export interface CapacityReadings {
  cpuMaxRaw: string | null;
  /** The RESOLVED cpuset core count (countCpusetCores of the real file, or the seam's integer —
   *  that seam is named `…_CPUSET_COUNT` and supplies a COUNT, not a cpuset list). null = absent. */
  cpusetCores: number | null;
  memoryMaxRaw: string | null;
  nproc: number;
  memFallbackMb: number;
  cgroupV2: boolean;
}

const MB = 1024 * 1024;

// ── parsers (pure, exported so the unit test drives them directly) ───────────────────────────────

/** The cgroup-relative path of THIS process, from /proc/self/cgroup's unified line "0::<path>".
 *  Returns null when there is no unified-hierarchy line (cgroup v1 / unreadable). */
export function selfCgroupRelPath(procSelfCgroup: string): string | null {
  for (const line of String(procSelfCgroup).split("\n")) {
    if (!line.startsWith("0::")) continue;
    const rel = line.slice(3).trim();
    return rel === "" ? "/" : rel;
  }
  return null;
}

/** Parse a cgroup v2 `cpu.max` value ("<quota> <period>" or "max <period>").
 *  `unlimited` = quota is literally "max" OR a non-positive number (AC2: quota<=0 ⇒ fall back).
 *  `cores` = floor(quota/period) clamped to >=1 — null when unlimited or unparsable. */
export function parseCpuMax(raw: string | null | undefined): { unlimited: boolean; cores: number | null } {
  const text = String(raw ?? "").trim();
  if (text === "") return { unlimited: true, cores: null };
  const parts = text.split(/\s+/);
  const quotaTok = parts[0];
  const periodTok = parts.length > 1 ? parts[1] : "";
  if (quotaTok === "max") return { unlimited: true, cores: null };
  const quota = Number(quotaTok);
  const period = periodTok === "" ? 100000 : Number(periodTok);
  if (!Number.isFinite(quota) || !Number.isFinite(period) || period <= 0) return { unlimited: true, cores: null };
  if (quota <= 0) return { unlimited: true, cores: null };
  return { unlimited: false, cores: Math.max(1, Math.floor(quota / period)) };
}

/** Count the CPUs a cgroup v2 `cpuset.cpus.effective` string covers ("0-3,8,10-11" => 7).
 *  Returns null when the text is empty/unparsable — never 0 (0 would read as "a real, tiny limit"). */
export function countCpusetCores(raw: string | null | undefined): number | null {
  const text = String(raw ?? "").trim();
  if (text === "") return null;
  let total = 0;
  for (const part of text.split(",")) {
    const tok = part.trim();
    if (tok === "") continue;
    const m = /^(\d+)(?:-(\d+))?$/.exec(tok);
    if (!m) return null;
    const lo = Number(m[1]);
    const hi = m[2] === undefined ? lo : Number(m[2]);
    if (hi < lo) return null;
    total += hi - lo + 1;
  }
  return total > 0 ? total : null;
}

/** Byte-valued cgroup limit ("max" = unlimited). null when unlimited or unparsable. */
export function parseByteLimit(raw: string | null | undefined): number | null {
  const text = String(raw ?? "").trim();
  if (text === "" || text === "max") return null;
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ── the derivation (pure) ───────────────────────────────────────────────────────────────────────

/** Derive the effective capacity view-model from RAW readings. Pure — no fs, no env, no globals.
 *  This is where the AC3 semantics live, and it is the function the unit test drives exhaustively. */
export function computeEffectiveCapacity(r: CapacityReadings): EffectiveCapacity {
  const nproc = Number.isFinite(r.nproc) && r.nproc > 0 ? Math.floor(r.nproc) : 1;

  // CPU — candidates in tie-break priority order (cgroup constraint first, host reading last).
  const cpuCandidates: Array<{ value: number; source: CpuSource }> = [];
  const bandwidth = r.cgroupV2 ? parseCpuMax(r.cpuMaxRaw) : { unlimited: true, cores: null };
  if (!bandwidth.unlimited && bandwidth.cores !== null) {
    cpuCandidates.push({ value: bandwidth.cores, source: "cgroup-cpu-max" });
  }
  const cpusetCores = r.cgroupV2 && Number.isFinite(r.cpusetCores) && r.cpusetCores > 0 ? Math.floor(r.cpusetCores) : null;
  if (cpusetCores !== null) cpuCandidates.push({ value: cpusetCores, source: "cpuset" });
  cpuCandidates.push({ value: nproc, source: "nproc-fallback" });
  // Strict `<` scan ⇒ the FIRST (highest-priority) candidate wins a tie.
  let cpuWinner = cpuCandidates[0];
  for (const c of cpuCandidates) if (c.value < cpuWinner.value) cpuWinner = c;

  // Memory — the cgroup limit, else the host fallback.
  const memLimit = r.cgroupV2 ? parseByteLimit(r.memoryMaxRaw) : null;
  const memFallbackMb = Number.isFinite(r.memFallbackMb) && r.memFallbackMb > 0 ? Math.floor(r.memFallbackMb) : 1;
  const effectiveMemMb = memLimit === null ? memFallbackMb : Math.max(1, Math.floor(memLimit / MB));

  return {
    effective_cpu: cpuWinner.value,
    cpu_source: cpuWinner.source,
    effective_mem_mb: effectiveMemMb,
    mem_source: memLimit === null ? "free-fallback" : "cgroup-memory-max",
    nproc,
    cgroup_v2: r.cgroupV2,
  };
}

// ── readings collection (the only impure part) ──────────────────────────────────────────────────

function readTextOrNull(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** The repo's existing host parallelism reading (AC2's "os.availableParallelism()/nproc"). */
export function hostParallelism(): number {
  try {
    if (typeof os.availableParallelism === "function") return os.availableParallelism();
  } catch {
    /* fall through to the cpus().length reading below */
  }
  return os.cpus().length || 1;
}

/** The repo's existing host memory reading (AC2's "os.totalmem()/free -m"), in MB. */
export function hostTotalMemMb(): number {
  return Math.max(1, Math.floor(os.totalmem() / MB));
}

/** True iff the unified (v2) hierarchy is mounted at `root` — judged by cgroup.controllers, the
 *  file that exists only on v2 (v1 roots carry no such file). */
export function cgroupV2Mounted(root: string = CGROUP_ROOT): boolean {
  try {
    return fs.statSync(path.join(root, "cgroup.controllers")).isFile();
  } catch {
    return false;
  }
}

/** Collect the raw readings, applying the five env seams. Never throws — every unreadable input
 *  becomes `null` (a distinguishable "not read"), never a fabricated 0. */
export function collectReadings(env: NodeJS.ProcessEnv = process.env, opts: { cgroupRoot?: string; procSelfCgroup?: string } = {}): CapacityReadings {
  const root = opts.cgroupRoot ?? CGROUP_ROOT;
  const procSelfCgroup = opts.procSelfCgroup ?? readTextOrNull(PROC_SELF_CGROUP);

  const mounted = cgroupV2Mounted(root);
  const relPath = procSelfCgroup === null ? null : selfCgroupRelPath(procSelfCgroup);
  const cgDir = mounted && relPath !== null ? path.join(root, relPath) : null;

  const fileCpuMax = cgDir === null ? null : readTextOrNull(path.join(cgDir, "cpu.max"));
  const fileCpuset = cgDir === null ? null : readTextOrNull(path.join(cgDir, "cpuset.cpus.effective"));
  const fileMemoryMax = cgDir === null ? null : readTextOrNull(path.join(cgDir, "memory.max"));

  const seamCpuMax = env[TEST_CPU_MAX];
  const seamCpuset = env[TEST_CPUSET_COUNT];
  const seamMemoryMax = env[TEST_MEMORY_MAX];
  const seamNproc = env[TEST_NPROC];
  const seamMemMb = env[TEST_MEM_AVAIL_MB];

  // A cgroup seam asserts a cgroup IS present — that is what the seam simulates (see the header).
  const seamImpliesCgroup = seamCpuMax !== undefined || seamCpuset !== undefined || seamMemoryMax !== undefined;
  const cgroupV2 = (mounted && relPath !== null) || seamImpliesCgroup;

  const seamNprocNum = seamNproc === undefined ? NaN : Number(String(seamNproc).trim());
  const seamMemNum = seamMemMb === undefined ? NaN : Number(String(seamMemMb).trim());
  const seamCpusetNum = seamCpuset === undefined ? NaN : Number(String(seamCpuset).trim());
  // ⛔ The cpuset seam supplies a COUNT (its name says so); a value that is not a positive integer is
  // "no override", never a fabricated 0-core cpuset.
  const cpusetOverride = Number.isFinite(seamCpusetNum) && seamCpusetNum > 0 ? Math.floor(seamCpusetNum) : null;
  const parsedCpuset = cgroupV2 ? countCpusetCores(fileCpuset) : null;

  return {
    cpuMaxRaw: seamCpuMax !== undefined ? String(seamCpuMax) : fileCpuMax,
    // A SET cpuset seam is authoritative (an explicit empty value means "no cpuset"), so a seam can
    // never be silently overwritten by whatever the host's own cpuset happens to be.
    cpusetCores: seamCpuset !== undefined ? cpusetOverride : parsedCpuset,
    memoryMaxRaw: seamMemoryMax !== undefined ? String(seamMemoryMax) : fileMemoryMax,
    nproc: Number.isFinite(seamNprocNum) && seamNprocNum > 0 ? Math.floor(seamNprocNum) : hostParallelism(),
    memFallbackMb: Number.isFinite(seamMemNum) && seamMemNum > 0 ? Math.floor(seamMemNum) : hostTotalMemMb(),
    cgroupV2,
  };
}

/** The probe entry point: read + derive. Read-only; never throws. */
export function probeEffectiveCapacity(env: NodeJS.ProcessEnv = process.env, opts: { cgroupRoot?: string; procSelfCgroup?: string } = {}): EffectiveCapacity {
  return computeEffectiveCapacity(collectReadings(env, opts));
}

// ── rendering ───────────────────────────────────────────────────────────────────────────────────

/** The report-mode lines, in the frozen order (AC3). ONE renderer, so --json and report mode can
 *  never disagree about a field name or a value. */
export function formatReport(c: EffectiveCapacity): string {
  return [
    `effective_cpu=${c.effective_cpu}`,
    `cpu_source=${c.cpu_source}`,
    `effective_mem_mb=${c.effective_mem_mb}`,
    `mem_source=${c.mem_source}`,
    `nproc=${c.nproc}`,
    `cgroup_v2=${c.cgroup_v2}`,
  ].join("\n");
}

/** The --json document: the SAME six fields, key names unchanged (AC3). */
export function formatJson(c: EffectiveCapacity): string {
  return JSON.stringify(c);
}

const USAGE = [
  "effective-capacity-probe.ts — cgroup-v2-aware effective capacity probe (read-only)",
  "usage: node --experimental-strip-types plugin/scripts/effective-capacity-probe.ts [--json] [--help]",
  "  (no flag)  report mode: one key=value line per field (effective_cpu, cpu_source, effective_mem_mb,",
  "             mem_source, nproc, cgroup_v2)",
  "  --json     the same six fields as one JSON object",
  "  --help,-h  print this usage and exit 0",
].join("\n");

// ── CLI entry ───────────────────────────────────────────────────────────────────────────────────

if (isDirectEntry(import.meta, process.argv[1], "effective-capacity-probe")) {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE + "\n");
    process.exit(0);
  }
  const unknown = argv.filter((a) => a !== "--json");
  if (unknown.length > 0) {
    process.stderr.write(`effective-capacity-probe: unknown argument: ${unknown[0]}\n${USAGE}\n`);
    process.exit(2);
  }
  const report = probeEffectiveCapacity();
  process.stdout.write((argv.includes("--json") ? formatJson(report) : formatReport(report)) + "\n");
  process.exit(0);
}
