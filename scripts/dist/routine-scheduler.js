import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/routine-scheduler.ts
import fs from "node:fs";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
import path from "node:path";
function isDirectEntry(importMeta, argv1, expectedBase) {
  void importMeta;
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  return path.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/routine-scheduler.ts
function parseTrigger(s) {
  const t = String(s).trim();
  let m = t.match(/^every\(\s*(\d+)\s*\)$/);
  if (m) {
    const n = Number(m[1]);
    if (!Number.isInteger(n) || n < 1) throw new Error(`routine-scheduler: every(N) needs N>=1 (got ${m[1]})`);
    return { kind: "every", n };
  }
  m = t.match(/^interval:\s*(\d+)\s*m$/);
  if (m) {
    const minutes = Number(m[1]);
    if (!Number.isInteger(minutes) || minutes < 1) throw new Error(`routine-scheduler: interval:<N>m needs N>=1 (got ${m[1]})`);
    return { kind: "interval", minutes };
  }
  m = t.match(/^on\(\s*([\w-]+)\s*\)$/);
  if (m) return { kind: "on", event: m[1] };
  throw new Error(`routine-scheduler: invalid trigger "${s}" \u2014 must be "every(N)", "interval:<N>m", or "on(<event>)"`);
}
function isDue(trigger, state = {}) {
  const t = typeof trigger === "string" ? parseTrigger(trigger) : trigger;
  if (t.kind === "every") {
    const it = Number(state.iteration);
    return Number.isInteger(it) && it > 0 && it % t.n === 0;
  }
  if (t.kind === "interval") {
    const now = Number(state.now ?? Date.now());
    if (!Number.isFinite(now)) return false;
    const lastRun = Number(state.lastRun);
    if (!Number.isFinite(lastRun) || lastRun <= 0) return true;
    return now - lastRun >= t.minutes * 6e4;
  }
  return state.event != null && state.event === t.event;
}
function dueRoutines(routines, state = {}) {
  if (!Array.isArray(routines)) throw new Error("routine-scheduler: routines must be an array");
  const lastRunMap = state.lastRun && typeof state.lastRun === "object" ? state.lastRun : {};
  return routines.filter((r) => isDue(r.trigger, { ...state, lastRun: lastRunMap[r.name] }));
}
function resolveRoutineAction(routine, pluginRoot) {
  const hasProbe = typeof routine.probe === "string" && routine.probe.trim();
  const hasDispatch = typeof routine.dispatch === "string" && routine.dispatch.trim();
  if (hasProbe) {
    if (!pluginRoot || typeof pluginRoot !== "string") {
      return { kind: "skip", reason: `routine "${routine.name}": probe requires pluginRoot but none provided` };
    }
    return { kind: "probe", name: routine.probe.trim(), pluginRoot };
  }
  if (hasDispatch) {
    return { kind: "dispatch", action: routine.dispatch.trim() };
  }
  return { kind: "skip", reason: `routine "${routine.name}": has neither 'probe' nor 'dispatch' \u2014 skipped (fix loop.yml)` };
}
function usage() {
  process.stderr.write("Usage: routine-scheduler.mjs [--iteration N] [--event X] [--now <epoch-ms>] [--last-run <json>] [--plugin-root <dir>] <routines.json>\n");
}
async function main(argv) {
  const args = argv.slice(2);
  const state = {};
  const files = [];
  let pluginRoot = null;
  let lastRunPath = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--iteration") {
      state.iteration = Number(args[++i]);
      continue;
    }
    if (args[i] === "--event") {
      state.event = args[++i];
      continue;
    }
    if (args[i] === "--now") {
      state.now = Number(args[++i]);
      continue;
    }
    if (args[i] === "--last-run") {
      lastRunPath = args[++i];
      continue;
    }
    if (args[i] === "--plugin-root") {
      pluginRoot = args[++i];
      continue;
    }
    files.push(args[i]);
  }
  if (files.length !== 1) {
    usage();
    return 2;
  }
  if (!fs.existsSync(files[0])) {
    process.stderr.write(`ERROR: not found: ${files[0]}
`);
    return 2;
  }
  let routines;
  try {
    routines = JSON.parse(fs.readFileSync(files[0], "utf8"));
  } catch (e) {
    process.stderr.write(`ERROR: not valid JSON: ${e.message}
`);
    return 2;
  }
  if (lastRunPath) {
    try {
      const raw = fs.readFileSync(lastRunPath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) state.lastRun = parsed;
    } catch (e) {
      process.stderr.write(`ERROR: --last-run not valid JSON: ${e.message}
`);
      return 2;
    }
  }
  let due;
  try {
    due = dueRoutines(routines, state);
  } catch (e) {
    process.stderr.write(`ERROR: ${e.message}
`);
    return 2;
  }
  if (due.length === 0) {
    process.stdout.write("no routines due\n");
    return 3;
  }
  for (const r of due) {
    const action = resolveRoutineAction(r, pluginRoot);
    if (action.kind === "dispatch") {
      process.stdout.write(`DUE: ${r.name} (${r.trigger}) \u2192 dispatch ${action.action}
`);
    } else if (action.kind === "probe") {
      process.stdout.write(`DUE: ${r.name} (${r.trigger}) \u2192 probe ${action.name}
`);
    } else {
      process.stderr.write(`SKIP: ${r.name} (${r.trigger}) \u2192 ${action.reason}
`);
    }
  }
  return 0;
}
if (isDirectEntry(import.meta, void 0, "routine-scheduler")) {
  main(process.argv).then((c) => process.exit(c));
}
export {
  dueRoutines,
  isDue,
  main,
  parseTrigger,
  resolveRoutineAction
};
