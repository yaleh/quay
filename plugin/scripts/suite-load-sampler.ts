// suite-load-sampler.ts — per-run system-load sampler (gap-test-detail-load-timeseries).
//
// Spawned by full-suite-runner.ts while a full-suite verification round runs. Every N seconds it
// samples the three structural resource signals the resource-gate already defines — loadavg (1m),
// cpu_stall (PSI `some avg10` %), mem_avail (MB) — and appends one JSON line to
// `<state-dir>/suite-load-<runId>.jsonl`. The Test 详情 page pulls that timeseries to render a
// server-side load curve.
//
// STOP IS FINISHEDAT-DRIVEN (⛔ the "结束即停 / 不常驻空跑" invariant), NOT state-driven
// (gap-suite-load-sampler-early-red-truncates-load-curve): full-suite-runner.ts writes an EARLY-RED
// state (`state="red"` + `finishedAt: null`) on the FIRST failure line, but the suite keeps running
// to its natural end — only the terminal write sets `finishedAt`. So `state !== "running"` is NOT a
// stop signal; the sampler keeps sampling while `finishedAt` is null (running OR temporary
// early-red/aborted) and stops only once `finishedAt` is set, the state file is missing/unreadable
// (fail-closed), or a NEWER run owns the generation. Every terminal path — green, red, aborted,
// signal-aborted, crash-trap, watchdog-written — writes `finishedAt`, so sampling can never outlive
// the suite by construction. This is NOT a resident idle-spin process: no suite ⇒ no sampler.
//
// STOP IS ALSO HOST-DEATH-DRIVEN (gap-suite-load-sampler-orphan-process): the finishedAt-driven stop
// only fires when SOMEONE writes a terminal state / removes the state file. A host that dies
// UNCLEANLY — SIGKILL (uncatchable), a worker mid-exit exception, the fan-in detached wrapper
// killed before its `rm -f` of the per-task state file — leaves the state file stuck at "running",
// and the sampler would otherwise spin for minutes-to-hours polluting the load metric. The sampler
// therefore ALSO records its host's PID (process.ppid at spawn) and exits the moment that PID
// disappears: the kernel reparents an orphan to PID 1 / a subreaper, so process.ppid changing is
// the one host-death signal that survives EVERY exit branch. Either stop — state terminal, or host
// dead — ends sampling; neither depends on a cleanup path that a killed host never reaches.
//
// Read semantics match plugin/scripts/resource-gate.sh so the curve is the SAME 口径 the gate's
// point readings carry (a curve point is comparable to the gate's GO/WAIT readings).

import fs from "node:fs";
import path from "node:path";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** /proc/loadavg field 1 (1-minute load average — runnable + uninterruptible queue depth). */
function readLoadavg(): number | null {
  try {
    const v = Number(fs.readFileSync("/proc/loadavg", "utf8").trim().split(/\s+/)[0]);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** /proc/pressure/cpu line 1 `some avg10=X` (PSI CPU stall %, 10s window). */
function readCpuStall(): number | null {
  try {
    const line = fs.readFileSync("/proc/pressure/cpu", "utf8").split("\n")[0] ?? "";
    const m = line.match(/avg10=([0-9]+(?:\.[0-9]+)?)/);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

/** /proc/meminfo MemAvailable kB → MB (the `available` column of `free -m`, not the `free` column). */
function readMemAvailMb(): number | null {
  try {
    const text = fs.readFileSync("/proc/meminfo", "utf8");
    const m = text.match(/^MemAvailable:\s+(\d+)\s+kB/m);
    return m ? Number((Number(m[1]) / 1024).toFixed(1)) : null;
  } catch {
    return null;
  }
}

/**
 * True while THIS run's suite is still running. The stop signal is `finishedAt`, NOT `state`
 * (gap-suite-load-sampler-early-red-truncates-load-curve): full-suite-runner.ts writes an early-red
 * `state="red"` + `finishedAt: null` on the first failure line while the suite keeps running to its
 * natural end, so `state !== "running"` would truncate a red round's load curve at first-failure.
 * Keep sampling while `finishedAt` is null/absent (running OR temporary early-red/aborted); stop
 * once `finishedAt` is set (terminal write). Fail-closed on an unreadable/missing state file (stop
 * rather than sample an unverified run); fail-open on a missing/empty runId (legacy state has no
 * generation to protect — matching the runner's writeState generation guard).
 */
function isSuiteRunning(stateFile: string, runId: string): boolean {
  let parsed: { state?: unknown; runId?: unknown; finishedAt?: unknown } | null = null;
  try {
    parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object") return false;
  if (parsed.finishedAt != null) return false;
  if (typeof parsed.runId === "string" && parsed.runId && parsed.runId !== runId) return false;
  return true;
}

async function main(): Promise<void> {
  const arg = (name: string): string | undefined => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const stateFile = arg("state-file");
  const outFile = arg("out-file");
  const runId = arg("run-id");
  const rawInterval = Number(arg("interval") ?? "5");
  const intervalMs = Number.isFinite(rawInterval) && rawInterval >= 0.1 ? rawInterval * 1000 : 5000;
  if (!stateFile || !outFile || !runId) {
    process.stderr.write("suite-load-sampler: --state-file / --out-file / --run-id are required\n");
    process.exit(2);
  }
  try {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
  } catch {
    // best-effort — a mkdir failure must never crash the sampler
  }
  try {
    fs.writeFileSync(`${outFile}.pid`, `${process.pid}\n`, "utf8");
  } catch {
    // best-effort — the pid sidecar is a stop-verification aid, not a correctness input
  }
  const stop = (): void => {
    process.exit(0);
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);

  // gap-suite-load-sampler-orphan-process — record the host PID (the process that spawned us:
  // full-suite-runner.ts, or the fan-in detached suite wrapper) so sampling stops the moment the
  // host dies on ANY exit branch, not only the paths that write a terminal state. An unclean host
  // exit (SIGKILL / worker mid-exit exception) leaves the state file stuck at "running"; the
  // kernel's reparent of this orphan to PID 1 (or a subreaper) is the host-death signal that
  // survives such a death, and it never fires a false positive (a child's ppid only changes when
  // its parent dies).
  const hostPid = process.ppid;

  // Sample immediately, then every interval — but ALWAYS check the suite is still running AND the
  // host is still alive FIRST, so a finished/superseded suite never gets one extra post-mortem
  // sample (the 结束即停 invariant) and a killed host can never leave a resident orphan sampler.
  while (isSuiteRunning(stateFile, runId) && process.ppid === hostPid) {
    const rec = {
      t: Date.now(),
      loadavg: readLoadavg(),
      cpu_stall: readCpuStall(),
      mem_avail: readMemAvailMb(),
    };
    try {
      fs.appendFileSync(outFile, JSON.stringify(rec) + "\n", "utf8");
    } catch {
      // best-effort — a write failure must never crash the sampler
    }
    await sleep(intervalMs);
  }
  process.exit(0);
}

const isDirect =
  process.argv[1] && path.basename(process.argv[1]).replace(/\.(?:js|ts|mjs)$/, "") === "suite-load-sampler";
if (isDirect) {
  await main();
}
