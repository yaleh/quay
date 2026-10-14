// host-resource-adapter.ts — THE host adapter seam: resource MEASUREMENT + bounded-resource LAUNCH
// for a heavy child (the suite, heavy ops), behind ONE interface whose SIGNATURE names no cgroup
// path, no unit name, no supervisor and no other project.
//
// THE DEFECT THIS CLOSES (2026-10-14): `full-suite-runner.ts` read `memory.peak` / `memory.events` /
// `memory.stat` and built a `systemd-run --user --scope` argv INLINE. The DECLARED-value work
// (`.quay/config.yml` `suite: memory_max:`) had already landed, but the MECHANISM that reads and
// enforces it was Linux-cgroup-shaped code living inside the runner ⇒ (a) a different host (no
// cgroup v2, a non-systemd supervisor) could not be supported without editing the runner, and
// (b) every new telemetry field (anon/file/shmem/swap/PSI/process-tree) would add one more scattered
// inline cgroup-path read.
//
// ── THREE-VALUED READINGS (硬规则 3b) ────────────────────────────────────────────────────────────
// Every reading is an `AdapterReading<T>` = `{ value, reason }`: `value === null` ALWAYS carries a
// NAMED `reason`, so 「this host cannot produce that reading」 can never be read as 「the reading is
// 0」. This is the whole point of AC2: a cgroup-less host must yield `unknown`, because `0` is a
// MEASUREMENT (「no OOM happened」) that an adapter which never read anything is not entitled to make.
// The same discipline forbids a rejected/unreadable handle from sharing the `{ value: null }` shape
// WITHOUT a reason — see `unavailable()`.
//
// ── NO CROSS-PROJECT RESOURCE CENTER (task Plan §4/§5) ───────────────────────────────────────────
// The scope is the CALLER's own process tree. Nothing here talks to a daemon, a socket, another
// project's service, or any path outside this host's own kernel/supervisor interfaces. Policy (the
// declared memory/concurrency values) lives in the runner + `.quay/config.yml`; the completeness/OOM
// GATE lives in worker-driver's attribution path. This module OWNS neither — it produces readings and
// launches bounded children, and a caller supplies the policy.
//
// ── THE LINUX ADAPTER IS *AN* IMPLEMENTATION (task title) ───────────────────────────────────────
// `linux-cgroup-v2` is the first (and for now only) implementation. It sits on the SAME shared
// envelope module (`packages/quay/src/systemd-scope.ts`) the serve host and the driver anchor use, so
// the suite's argv is built by the ONE argv builder rather than a second copy (硬规则 5b). A future
// adapter (a container runtime, a non-systemd supervisor, a host with no accounting at all)
// implements `HostResourceAdapter` and is selected by `resolveHostResourceAdapter` — without the
// runner changing. `createUnsupportedHostAdapter` is that second implementation, today.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

import {
  LINUX_CGROUP_V2_ROOT,
  SYSTEMD_RUN_BIN,
  SYSTEMD_RUN_AVAILABLE_ENV,
  boundedScopeArgv,
  systemdScopeAvailable,
} from "../../packages/quay/src/systemd-scope.ts";
// The ONE cgroup-v2 directory resolution (the `/proc/<pid>/cgroup` walk + the escape guard + the
// QUAY_TEST_CGROUP_DIR seam) already lives in suite-accounting.ts — ⛔ NOT re-implemented here
// (硬规则 5b). The accounting family and this adapter therefore read the SAME directory for a pid.
import { resolveCgroupV2Dir } from "./suite-accounting.ts";

// ── the reading contract ─────────────────────────────────────────────────────────────────────────

/** A reading that is EITHER a value OR a NAMED reason why it could not be produced (硬规则 3b).
 *  `value === null` and `reason === null` never co-occur, and `reason` is null exactly when `value`
 *  is present — so 「not evaluated」 has its own shape and cannot masquerade as 「evaluated」. */
export interface AdapterReading<T> {
  value: T | null;
  reason: string | null;
}

/** A produced reading. */
export function ok<T>(value: T): AdapterReading<T> {
  return { value, reason: null };
}

/** A reading this host/adapter COULD NOT produce, with the reason spelled out. A caller that maps
 *  this to a number is the bug this type exists to prevent: the honest mapping is `null`/`unknown`. */
export function unavailable<T>(reason: string): AdapterReading<T> {
  return { value: null, reason };
}

/** An opaque handle to one RESOURCE SCOPE (the caller's own process tree, bounded or not).
 *  `id` is meaningful only to the adapter KIND that produced it (`host`) — a handle is never portable
 *  between adapters, and each read rejects a foreign `host` rather than misreading it. */
export interface ResourceScopeHandle {
  host: string;
  id: string;
}

/** The host-relative launch spec. Every dimension is a DECLARED POLICY value in unit-suffixed string
 *  form; `""` means NOT BOUNDED on that dimension — expressed by the adapter simply not asking its
 *  mechanism to bound it (⛔ never by an "equivalent-unlimited" literal, which is only ever unlimited
 *  on the machine that wrote it — CLAUDE.md 硬规则 4 推论二). How a dimension is SPELLED to the host
 *  is the adapter's business; ⛔ no field here names a cgroup file, a unit, or a supervisor verb. */
export interface ResourceLimits {
  memoryMax: string;
  cpuQuota: string;
  tasksMax: string;
  /** Absent/`""` = no swap bounding (the pre-existing production default). */
  memorySwapMax?: string;
}

/** The `memory.stat` breakdown (bytes), the subsets a resource diagnosis actually uses. Absent keys
 *  stay `null` (缺值 ≠ 0). */
export interface MemoryStatBreakdown {
  anonBytes: number | null;
  fileBytes: number | null;
  shmemBytes: number | null;
  kernelBytes: number | null;
  slabBytes: number | null;
  inactiveFileBytes: number | null;
}

export interface MemoryReading {
  currentBytes: number | null;
  /** The high-water mark (`memory.peak`, falling back to max-observed `memory.current`). */
  peakBytes: number | null;
  /** The scope's declared ceiling in bytes; `null` when the mechanism reports "no ceiling" (which is
   *  a READING, distinct from "could not read it" — the enclosing `AdapterReading` carries that). */
  limitBytes: number | null;
  swapCurrentBytes: number | null;
  stat: MemoryStatBreakdown | null;
  /** The raw PSI block (unparsed text) — a formatted-elsewhere reading, kept verbatim so a reader can
   *  see the kernel's own wording rather than a re-rendered paraphrase. */
  pressure: string | null;
}

export interface MemoryEventReading {
  /** OOM events that did NOT kill (the kernel tried, reclaim succeeded). */
  oom: number;
  /** OOM events that DID kill a process — the red-attribution trigger. */
  oomKill: number;
  /** How many times the scope hit its ceiling while reclaiming (`memory.events` `max`), or `null`
   *  when the mechanism does not report it. */
  max: number | null;
}

export interface ProcessTreeReading {
  pids: number[];
}

/** The host capability this adapter can offer. `mechanism` is a human-readable name for the EVIDENCE
 *  (⛔ never a criterion) — e.g. which supervisor bounds the child. */
export interface AdapterCapability {
  mechanism: string;
  /** TRUE when the adapter can actually BOUND a spawned child on this host (⟺ `launchArgv` returns
   *  an enveloped argv). A host can be measurable but not boundable, and vice versa. */
  canBound: boolean;
}

/** One bounded launch: the child, the argv it was spawned with (evidence), and a LAZY scope resolver
 *  (the scope handle does not exist at spawn time on a transient-scope host). */
export interface BoundedLaunch {
  child: ChildProcess;
  argv: string[];
  /** TRUE ⟺ the child runs inside a bounding mechanism. */
  bounded: boolean;
  /** Resolve the RUNNING child's scope. Lazy on purpose: a transient scope unit appears a moment
   *  after spawn, so a one-shot resolve would return `unavailable` and make the whole evidence inert. */
  scope(): AdapterReading<ResourceScopeHandle>;
}

/**
 * The host adapter contract. A signature in this interface may name a PID, a scope handle, a
 * host-neutral limit value and a shell command — ⛔ never a cgroup file, a unit name, an argv of a
 * particular supervisor, or another project.
 */
export interface HostResourceAdapter {
  /** Stable identifier, recorded in evidence so a reader knows WHICH mechanism produced a reading. */
  readonly kind: string;
  /** Whether this host can be measured/bounded at all by this adapter. */
  available(): AdapterReading<AdapterCapability>;
  /** The resource scope of an ALREADY-RUNNING process (the suite child). */
  scopeOf(pid: number): AdapterReading<ResourceScopeHandle>;
  readMemory(scope: ResourceScopeHandle): AdapterReading<MemoryReading>;
  readMemoryEvents(scope: ResourceScopeHandle): AdapterReading<MemoryEventReading>;
  readProcessTree(scope: ResourceScopeHandle): AdapterReading<ProcessTreeReading>;
  /** The argv that runs `command` inside a bounded scope — or, on a host with no bounding mechanism,
   *  the plain shell argv (「not bounded」 expressed in the mechanism, ⛔ not hidden behind an
   *  unbounded-looking value). Total: it NEVER throws and NEVER returns an empty argv. */
  launchArgv(command: string, limits: ResourceLimits): string[];
}

/** Reject a handle produced by a DIFFERENT adapter (硬规则 3b: misreading foreign input must not look
 *  like a successful read). Returns the reason, or null when the handle belongs to `kind`. */
function foreignHandle(kind: string, scope: ResourceScopeHandle): string | null {
  if (!scope || typeof scope.id !== "string" || typeof scope.host !== "string") {
    return `malformed scope handle (${JSON.stringify(scope)}) — this adapter cannot read it`;
  }
  if (scope.host !== kind) {
    return `scope handle belongs to the ${JSON.stringify(scope.host)} adapter, not ${JSON.stringify(kind)}`;
  }
  return null;
}

// ── the Linux cgroup v2 + systemd-run adapter (the first implementation) ─────────────────────────

export const LINUX_CGROUP_V2_KIND = "linux-cgroup-v2";

/** The `memory.stat` keys this adapter surfaces, mapped to their reading field. ⛔ The kernel's own
 *  key names are the wire format — one table, read once. */
const MEMORY_STAT_KEYS: Array<[keyof MemoryStatBreakdown, string]> = [
  ["anonBytes", "anon"],
  ["fileBytes", "file"],
  ["shmemBytes", "shmem"],
  ["kernelBytes", "kernel"],
  ["slabBytes", "slab"],
  ["inactiveFileBytes", "inactive_file"],
];

/** A cgroup-v2 DIRECTORY as a scope handle — the shape the accounting family and the runner's
 *  directory-taking helpers already traffic in. Exported so a caller holding a directory (rather than
 *  a pid) can still go through the adapter instead of reopening the files itself. */
export function scopeHandleFromDir(dir: string, host = LINUX_CGROUP_V2_KIND): ResourceScopeHandle {
  return { host, id: dir };
}

/** Read one cgroup file as trimmed text, or null when it is absent/unreadable. */
function readFileOrNull(dir: string, file: string): string | null {
  try {
    return String(fs.readFileSync(path.join(dir, file), "utf8")).trim();
  } catch {
    return null;
  }
}

/** Parse a cgroup numeric file (`"1234"`, or `"max"` for "no ceiling") — null when absent/unparseable.
 *  ⛔ `"max"` is NOT 0 and NOT Infinity: it is 「the mechanism reports no ceiling」, a distinct reading. */
export function parseCgroupNumber(text: string | null): number | null {
  if (text === null || text === "" || text === "max") return null;
  const v = Number(text);
  return Number.isFinite(v) ? v : null;
}

/** Parse a `memory.stat` / `memory.events` key-value block into a lookup. */
export function parseCgroupKeyValues(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of text.split("\n")) {
    const m = /^([a-z_]+)\s+(\d+)\s*$/.exec(line.trim());
    if (m) out.set(m[1], Number(m[2]));
  }
  return out;
}

/**
 * The Linux cgroup v2 + systemd-run adapter. Every method that touches a cgroup file lives HERE (and
 * nowhere else in the suite's path) so a second host implementation is a matter of writing another
 * object against `HostResourceAdapter`, not of finding the scattered reads.
 */
export function createLinuxCgroupV2Adapter(): HostResourceAdapter {
  const KIND = LINUX_CGROUP_V2_KIND;

  const available = (): AdapterReading<AdapterCapability> => {
    // Seam FIRST (same order + same semantics as `systemdScopeAvailable`): a test that forces
    // "unavailable" must not be defeated by an earlier real probe in the same process.
    const forced = process.env[SYSTEMD_RUN_AVAILABLE_ENV];
    if (forced === "0") {
      return unavailable(
        `${SYSTEMD_RUN_AVAILABLE_ENV}=0 — the scope mechanism is forced unavailable (test seam); no bounded launch and no scope readings`,
      );
    }
    if (forced !== "1") {
      if (!fs.existsSync(LINUX_CGROUP_V2_ROOT)) {
        return unavailable(
          `no cgroup v2 hierarchy at ${LINUX_CGROUP_V2_ROOT} — this host cannot attribute a process to a resource scope`,
        );
      }
      if (!systemdScopeAvailable()) {
        return unavailable(
          `${SYSTEMD_RUN_BIN} --user --scope is unavailable (no user manager / no D-Bus / the probe rejected the real property list) — the suite would run un-enveloped`,
        );
      }
    }
    return ok({ mechanism: "linux-cgroup-v2+systemd-run --user --scope", canBound: true });
  };

  const scopeOf = (pid: number): AdapterReading<ResourceScopeHandle> => {
    if (!Number.isFinite(pid) || pid <= 0) return unavailable(`not a process id: ${JSON.stringify(pid)}`);
    const dir = resolveCgroupV2Dir(pid);
    if (!dir) {
      return unavailable(`no cgroup v2 entry for pid ${pid} (the process is gone, or this host has no unified hierarchy)`);
    }
    return ok({ host: KIND, id: dir });
  };

  const readMemory = (scope: ResourceScopeHandle): AdapterReading<MemoryReading> => {
    const foreign = foreignHandle(KIND, scope);
    if (foreign) return unavailable(foreign);
    const dir = scope.id;
    const current = parseCgroupNumber(readFileOrNull(dir, "memory.current"));
    // `memory.peak` is the kernel's high-water mark; older kernels lack it, and there the honest
    // degrade is the instantaneous `memory.current` (a LOWER bound, ⛔ not a fabricated peak).
    const peakFile = parseCgroupNumber(readFileOrNull(dir, "memory.peak"));
    const peak = peakFile ?? current;
    const limit = parseCgroupNumber(readFileOrNull(dir, "memory.max"));
    const swap = parseCgroupNumber(readFileOrNull(dir, "memory.swap.current"));
    const statText = readFileOrNull(dir, "memory.stat");
    const stat: MemoryStatBreakdown | null = statText
      ? (() => {
          const kv = parseCgroupKeyValues(statText);
          const out: MemoryStatBreakdown = {
            anonBytes: null,
            fileBytes: null,
            shmemBytes: null,
            kernelBytes: null,
            slabBytes: null,
            inactiveFileBytes: null,
          };
          for (const [field, key] of MEMORY_STAT_KEYS) out[field] = kv.has(key) ? (kv.get(key) as number) : null;
          return out;
        })()
      : null;
    const pressure = readFileOrNull(dir, "memory.pressure");
    if (current === null && peak === null && limit === null && swap === null && stat === null && pressure === null) {
      return unavailable(
        `no readable cgroup v2 memory file under ${dir} (memory.current / memory.peak / memory.max / memory.swap.current / memory.stat / memory.pressure)`,
      );
    }
    return ok({ currentBytes: current, peakBytes: peak, limitBytes: limit, swapCurrentBytes: swap, stat, pressure });
  };

  const readMemoryEvents = (scope: ResourceScopeHandle): AdapterReading<MemoryEventReading> => {
    const foreign = foreignHandle(KIND, scope);
    if (foreign) return unavailable(foreign);
    const text = readFileOrNull(scope.id, "memory.events");
    if (text === null) return unavailable(`memory.events is not readable under ${scope.id}`);
    const kv = parseCgroupKeyValues(text);
    const oom = kv.get("oom");
    const oomKill = kv.get("oom_kill");
    if (oom === undefined && oomKill === undefined) {
      // The file exists but carries NEITHER counter ⇒ this kernel does not report them. That is 「not
      // readable」, ⛔ not 「0 OOMs」 — the caller keeps its reading unknown (硬规则 3b/6).
      return unavailable(`memory.events under ${scope.id} carries neither an oom nor an oom_kill counter`);
    }
    return ok({ oom: oom ?? 0, oomKill: oomKill ?? 0, max: kv.has("max") ? (kv.get("max") as number) : null });
  };

  const readProcessTree = (scope: ResourceScopeHandle): AdapterReading<ProcessTreeReading> => {
    const foreign = foreignHandle(KIND, scope);
    if (foreign) return unavailable(foreign);
    const text = readFileOrNull(scope.id, "cgroup.procs");
    if (text === null) return unavailable(`cgroup.procs is not readable under ${scope.id}`);
    const pids = text
      .split("\n")
      .map((l) => Number(l.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    return ok({ pids });
  };

  const launchArgv = (command: string, limits: ResourceLimits): string[] =>
    boundedScopeArgv(["bash", "-c", command], limits, { quiet: true });

  return { kind: KIND, available, scopeOf, readMemory, readMemoryEvents, readProcessTree, launchArgv };
}

// ── the "unsupported host" adapter (the SECOND implementation — the seam's proof) ────────────────

export const UNSUPPORTED_HOST_KIND = "unsupported-host";

/** The reason recorded by the DEFAULT unsupported adapter (exported so a test/evidence reader asserts
 *  the same string the production fallback uses, instead of a re-typed copy). */
export const UNSUPPORTED_HOST_REASON =
  "this host has no resource-measurement mechanism this build knows how to read (no cgroup v2 hierarchy)";

/**
 * An adapter for a host with no readable resource surface: EVERY reading is `unavailable(reason)` and
 * `launchArgv` degrades to the plain shell argv (unbounded — the pre-existing fallback, ⛔ NOT a
 * bounded-looking argv that bounds nothing).
 *
 * It exists for three reasons, and none of them is "test-only": (1) it is the honest PRODUCTION
 * fallback on a host without cgroup v2; (2) it is the fixture AC2 drives the whole chain with; (3) it
 * is the structural proof that the runner no longer needs Linux to run — a second implementation
 * satisfies the interface without the runner changing.
 */
export function createUnsupportedHostAdapter(reason: string = UNSUPPORTED_HOST_REASON): HostResourceAdapter {
  const KIND = UNSUPPORTED_HOST_KIND;
  const no = <T>(what: string) => unavailable<T>(`${what}: ${reason}`);
  return {
    kind: KIND,
    available: () => no<AdapterCapability>("no host resource mechanism"),
    scopeOf: (pid: number) => no<ResourceScopeHandle>(`no scope for pid ${pid}`),
    readMemory: () => no<MemoryReading>("no memory reading"),
    readMemoryEvents: () => no<MemoryEventReading>("no memory-event reading"),
    readProcessTree: () => no<ProcessTreeReading>("no process-tree reading"),
    launchArgv: (command: string) => ["bash", "-c", command],
  };
}

// ── selection ────────────────────────────────────────────────────────────────────────────────────

/** Test/ops seam: force which adapter this process resolves. `"unsupported"` drives the cgroup-less
 *  chain end-to-end (AC2); `"linux-cgroup-v2"` forces the Linux adapter even where the mount probe
 *  would say no. ⛔ Not a policy knob — production sets nothing and gets the host's real answer. */
export const HOST_RESOURCE_ADAPTER_ENV = "QUAY_TEST_HOST_RESOURCE_ADAPTER";

/** The adapter for THIS process. Selection is by HOST CAPABILITY, never by project: nothing here
 *  consults a path, an env var or a service belonging to another project (task Plan §4). */
export function resolveHostResourceAdapter(env: NodeJS.ProcessEnv = process.env): HostResourceAdapter {
  const forced = env[HOST_RESOURCE_ADAPTER_ENV];
  if (forced === "unsupported") {
    return createUnsupportedHostAdapter(`${HOST_RESOURCE_ADAPTER_ENV}=unsupported — forced by the test/ops seam`);
  }
  if (forced === "linux-cgroup-v2") return createLinuxCgroupV2Adapter();
  if (!fs.existsSync(LINUX_CGROUP_V2_ROOT)) {
    return createUnsupportedHostAdapter(
      `no cgroup v2 hierarchy at ${LINUX_CGROUP_V2_ROOT} — this build's only measurement mechanism cannot read this host`,
    );
  }
  return createLinuxCgroupV2Adapter();
}

// ── the bounded launch (Plan §1's "second method") ───────────────────────────────────────────────

/**
 * Start `command` through `adapter`, inside a bounded scope when the host can provide one, and return
 * the child plus a LAZY scope resolver. The spawn options the runner needs (a process-group leader so
 * the whole tree can be killed; piped stdio; the caller's cwd/env) are preserved for BOTH arms, so
 * swapping the adapter never changes the runner's lifecycle semantics.
 */
export function spawnBounded(
  adapter: HostResourceAdapter,
  opts: {
    command: string;
    limits: ResourceLimits;
    cwd: string;
    env: NodeJS.ProcessEnv;
    detached?: boolean;
    /** The CALLER's veto on bounding (the runner's `--no-systemd-run` flag / hermetic seams). An
     *  independent veto lives in the adapter's own `available()`; both must permit for a bounded
     *  launch, and `bounded:false` always means the plain shell argv. */
    allowBounding?: boolean;
  },
): BoundedLaunch {
  const capability = adapter.available();
  const bounded = (opts.allowBounding ?? true) && capability.value?.canBound === true;
  const argv = bounded ? adapter.launchArgv(opts.command, opts.limits) : ["bash", "-c", opts.command];
  const child = spawn(argv[0], argv.slice(1), {
    cwd: opts.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: opts.env,
    detached: opts.detached ?? true,
  });
  return { child, argv, bounded, scope: () => adapter.scopeOf(child.pid as number) };
}
