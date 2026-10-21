import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-3UCaVR/scripts/suite-load-sampler.ts
import fs2 from "node:fs";
import path from "node:path";

// .tmp-dist-publish-worktrees/publish-3UCaVR/scripts/gate-script-base.ts
function flagValue(argv, name) {
  const idx = argv.indexOf(name);
  return idx === -1 ? void 0 : argv[idx + 1];
}

// packages/quay/src/kernel/load-avg.ts
import fs from "node:fs";
function readRunQueue() {
  try {
    const text = fs.readFileSync("/proc/stat", "utf8");
    const running = text.match(/^procs_running[ \t]+(\d+)[ \t]*$/m);
    const blocked = text.match(/^procs_blocked[ \t]+(\d+)[ \t]*$/m);
    if (!running || !blocked) return null;
    const procs_running = Number(running[1]);
    const procs_blocked = Number(blocked[1]);
    if (!Number.isFinite(procs_running) || !Number.isFinite(procs_blocked)) return null;
    return { procs_running, procs_blocked, runq: procs_running + procs_blocked };
  } catch {
    return null;
  }
}

// .tmp-dist-publish-worktrees/publish-3UCaVR/scripts/suite-load-sampler.ts
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function readLoadavg() {
  try {
    const v = Number(fs2.readFileSync("/proc/loadavg", "utf8").trim().split(/\s+/)[0]);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}
function readCpuStall() {
  try {
    const line = fs2.readFileSync("/proc/pressure/cpu", "utf8").split("\n")[0] ?? "";
    const m = line.match(/avg10=([0-9]+(?:\.[0-9]+)?)/);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}
function readMemAvailMb() {
  try {
    const text = fs2.readFileSync("/proc/meminfo", "utf8");
    const m = text.match(/^MemAvailable:\s+(\d+)\s+kB/m);
    return m ? Number((Number(m[1]) / 1024).toFixed(1)) : null;
  } catch {
    return null;
  }
}
function isSuiteRunning(stateFile, runId) {
  let parsed = null;
  try {
    parsed = JSON.parse(fs2.readFileSync(stateFile, "utf8"));
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object") return false;
  if (parsed.finishedAt != null) return false;
  if (typeof parsed.runId === "string" && parsed.runId && parsed.runId !== runId) return false;
  return true;
}
async function main() {
  const arg = (name) => flagValue(process.argv, `--${name}`);
  const stateFile = arg("state-file");
  const outFile = arg("out-file");
  const runId = arg("run-id");
  const rawInterval = Number(arg("interval") ?? "5");
  const intervalMs = Number.isFinite(rawInterval) && rawInterval >= 0.1 ? rawInterval * 1e3 : 5e3;
  if (!stateFile || !outFile || !runId) {
    process.stderr.write("suite-load-sampler: --state-file / --out-file / --run-id are required\n");
    process.exit(2);
  }
  try {
    fs2.mkdirSync(path.dirname(outFile), { recursive: true });
  } catch {
  }
  try {
    fs2.writeFileSync(`${outFile}.pid`, `${process.pid}
`, "utf8");
  } catch {
  }
  const stop = () => {
    process.exit(0);
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  const hostPid = process.ppid;
  while (isSuiteRunning(stateFile, runId) && process.ppid === hostPid) {
    const rq = readRunQueue();
    const rec = {
      t: Date.now(),
      loadavg: readLoadavg(),
      cpu_stall: readCpuStall(),
      mem_avail: readMemAvailMb(),
      procs_running: rq ? rq.procs_running : null,
      procs_blocked: rq ? rq.procs_blocked : null,
      runq: rq ? rq.runq : null
    };
    try {
      fs2.appendFileSync(outFile, JSON.stringify(rec) + "\n", "utf8");
    } catch {
    }
    await sleep(intervalMs);
  }
  process.exit(0);
}
var isDirect = process.argv[1] && path.basename(process.argv[1]).replace(/\.(?:js|ts|mjs)$/, "") === "suite-load-sampler";
if (isDirect) {
  await main();
}
export {
  readCpuStall
};
