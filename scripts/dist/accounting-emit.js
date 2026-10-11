#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/accounting-emit.ts
import fs2 from "node:fs";
import path2 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import { spawnSync } from "node:child_process";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/accounting-emit-layer-map.ts
var MECHANISM_DEFS = {
  // ── inner (slot management + dispatch cadence; period 0.42h = 25min fast-mode tick) ──
  "cap-from-gate": { name: "cap-from-gate", periodHours: 0.42 },
  "slot-refill": { name: "slot-refill", periodHours: 0.42 },
  "ready-pool-check --apply": { name: "ready-pool-check --apply", periodHours: 0.42 },
  "fast-mode-telemetry --task-start": { name: "fast-mode-telemetry --task-start", periodHours: 0.42 },
  // ── outer (closure pass + verification cadence; real on-disk traces) ──
  "closure-lag-check": {
    name: "closure-lag-check",
    periodHours: 1,
    trace: { file: ".quay/closure-pass-last-run.json", keys: ["ranAt", "at"] }
  },
  "verification-round": {
    name: "verification-round",
    periodHours: 24,
    trace: { file: ".quay/verification-round.jsonl", keys: ["at", "startedAt", "finishedAt"] }
  },
  "full-suite-runner": {
    name: "full-suite-runner",
    periodHours: 24,
    trace: { file: ".quay/full-suite-state.json", keys: ["finishedAt", "startedAt"] }
  },
  // ── manager (cross-project coordination cadence; period 0.33h = 20min manager tick) ──
  "manager-tick-log": {
    name: "manager-tick-log",
    periodHours: 0.33,
    trace: { file: "orchestration/manager-tick-log.md", keys: [], mtime: true }
  },
  // The manager's meta-cc heartbeat — the `Workflow` tool it drives outer with
  // (orchestration/manager-loop-tick.md:1007: meta-cc `tool_name=Workflow` → last(timestamp)).
  Workflow: { name: "Workflow", periodHours: 0.33 },
  // The manager's session-liveness monitor instrumentation (manager-tick-core A10).
  "session-liveness": { name: "session-liveness", periodHours: 0.33 }
};
var LAYER_MECHANISMS = {
  inner: ["cap-from-gate", "slot-refill", "ready-pool-check --apply", "fast-mode-telemetry --task-start"],
  outer: ["closure-lag-check", "verification-round", "full-suite-runner"],
  manager: ["manager-tick-log", "Workflow", "session-liveness"]
};
function layerMechanisms(layer) {
  const names = LAYER_MECHANISMS[layer] ?? [];
  return names.map((n) => {
    const def = MECHANISM_DEFS[n];
    if (!def) {
      throw new Error(`accounting-emit-layer-map: no MECHANISM_DEFS entry for '${n}' (layer '${layer}')`);
    }
    return { name: def.name, periodHours: def.periodHours, trace: def.trace };
  });
}
var MECHANISMS = Object.fromEntries(
  Object.keys(LAYER_MECHANISMS).map((layer) => [layer, layerMechanisms(layer)])
);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/repo-root.ts
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
var MAX_DEPTH = 16;
function repoRoot(startDir = path.dirname(fileURLToPath(import.meta.url))) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < MAX_DEPTH; i++) {
    const hasPkg = fs.existsSync(path.join(dir, "package.json"));
    if (hasPkg && fs.existsSync(path.join(dir, "plugin")) && fs.existsSync(path.join(dir, "scripts", "test.sh"))) {
      return dir;
    }
    if (hasPkg && fs.existsSync(path.join(dir, ".quay", "config.yml"))) {
      return dir;
    }
    if (fs.existsSync(path.join(dir, ".git"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      timeout: 5e3,
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return process.cwd();
  }
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/accounting-emit.ts
var __dirname = path2.dirname(fileURLToPath2(import.meta.url));
var SCRIPT_DIR = __dirname;
var SCHEMA_VERSION = "quad-tuple/v1";
var JUDGEMENTS = ["\u5DF2\u505C\u7528", "\u5DF2\u66FF\u4EE3", "\u662F\u7F3A\u9677"];
var LAYERS = ["outer", "inner", "manager"];
var MECHANISMS2 = Object.fromEntries(
  Object.keys(LAYER_MECHANISMS).map((layer) => [layer, layerMechanisms(layer)])
);
function toEpochSeconds(v) {
  if (typeof v === "number") {
    return Number.isFinite(v) ? v > 1e12 ? Math.floor(v / 1e3) : v : null;
  }
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    if (Number.isFinite(n)) return n > 1e12 ? Math.floor(n / 1e3) : n;
    const ms = Date.parse(trimmed);
    if (Number.isFinite(ms)) return Math.floor(ms / 1e3);
  }
  return null;
}
function readTimestamp(root, trace) {
  if (trace.mtime) {
    const p2 = path2.join(root, trace.file ?? "");
    try {
      const st = fs2.statSync(p2);
      return { epoch: Math.floor(st.mtimeMs / 1e3), found: true };
    } catch {
      return { epoch: null, found: false };
    }
  }
  if (trace.dir) {
    let abs = path2.join(root, trace.dir);
    if (!fs2.existsSync(abs) || !fs2.statSync(abs).isDirectory()) return { epoch: null, found: false };
    const names = fs2.readdirSync(abs).filter((f) => !f.startsWith(".")).sort();
    if (names.length === 0) return { epoch: null, found: false };
    abs = path2.join(abs, names[names.length - 1]);
    return readTimestampFromFile(abs, trace.keys);
  }
  const p = path2.join(root, trace.file ?? "");
  if (!fs2.existsSync(p)) return { epoch: null, found: false };
  return readTimestampFromFile(p, trace.keys);
}
function readTimestampFromFile(file, keys) {
  let text;
  try {
    text = fs2.readFileSync(file, "utf8");
  } catch {
    return { epoch: null, found: false };
  }
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const lastLine = lines.length > 0 ? lines[lines.length - 1] : "";
  let parsed = null;
  if (lastLine !== "") {
    try {
      parsed = JSON.parse(lastLine);
    } catch {
      parsed = null;
    }
  }
  if (parsed === null) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (typeof parsed !== "object" || parsed === null) return { epoch: null, found: false };
  const rec = parsed;
  for (const k of keys) {
    if (k in rec) {
      const e = toEpochSeconds(rec[k]);
      if (e !== null) return { epoch: e, found: true };
    }
  }
  return { epoch: null, found: true };
}
function autoOccupancy(root, capOverride, inFlightOverride) {
  let cap = capOverride;
  if (cap === null && fs2.existsSync(path2.join(root, ".quay", "config.yml"))) {
    const capRes = spawnSync("bash", [path2.join(SCRIPT_DIR, "cap-from-gate.sh"), "--root", root], {
      encoding: "utf8",
      timeout: 3e4
    });
    if (capRes.status === 0 && capRes.stdout) {
      const m = capRes.stdout.match(/^effective_cap=([0-9]+)$/m);
      if (m) cap = Number(m[1]);
    }
  }
  let inFlight = inFlightOverride;
  if (inFlight === null) {
    const slotsArgs = ["--no-warnings", "--experimental-strip-types", path2.join(SCRIPT_DIR, "fast-mode-telemetry.ts"), "--slots", "--root", root, "--json"];
    if (cap !== null) {
      const idx = slotsArgs.indexOf("--slots");
      slotsArgs.splice(idx + 1, 0, "--cap", String(cap));
    }
    const slotsRes = spawnSync("node", slotsArgs, {
      encoding: "utf8",
      // The full --slots aggregation is heavy in a large workspace (~30s: per-task git history +
      // closed-but-live scan). QUAY_TELEMETRY_FAST_SLOTS=1 selects fast-mode-telemetry.ts's fast
      // slot view (~0.6s) which skips those annotations — they are irrelevant to realConcurrency.
      // Bounded long (90s) so even the un-optimized full path completes without a spurious SIGTERM.
      timeout: 9e4,
      env: { ...process.env, QUAY_TELEMETRY_FAST_SLOTS: "1" }
    });
    if (slotsRes.status === 0 && slotsRes.stdout) {
      try {
        const slots = JSON.parse(slotsRes.stdout);
        const v = typeof slots.inFlight === "number" ? slots.inFlight : slots.realConcurrency;
        if (typeof v === "number") inFlight = v;
      } catch {
        inFlight = null;
      }
    }
  }
  return { inFlight, cap };
}
function buildLedgerLine(layer, atIso, occ, writeTarget, mechs, missingCount) {
  const occStr = occ.in !== null && occ.cap !== null ? `occ=${occ.in}/${occ.cap}` : "occ=?/?";
  const mechStr = `mech=${mechs.filter((m) => m.lastRun !== null || m.judged).length}/${mechs.length}`;
  let line = `quad-tuple ${layer} ${atIso} ${occStr} wt=${writeTarget} ${mechStr}`;
  if (missingCount > 0) line += ` missing=${missingCount}`;
  return line;
}
function usage() {
  const lines = [
    "accounting-emit.ts \u2014 the UNIFIED FOUR-TUPLE emitter (SPEC \xA72.5 \u6267\u884C\u8D26\u672C)",
    "",
    "Usage:",
    "  node --experimental-strip-types plugin/scripts/accounting-emit.ts \\",
    "    --layer <outer|inner|manager> [--root <dir>] [--json]",
    "    [--in-flight <N>] [--cap <N>] [--write-target <branch>]",
    "    [--mechanism <name>[:<epoch|never>[:<judgement>]]]...   (repeatable; judgement \u2208 \u5DF2\u505C\u7528|\u5DF2\u66FF\u4EE3|\u662F\u7F3A\u9677)",
    "    [--no-registry] [--ledger-line <text>] [--help]",
    "",
    "The four tuple elements: \u2460 mechanisms (claimed mechanisms' last real exec time vs period)",
    "\u2461 occupancy (in-flight / effective_cap) \u2462 write_target \u2463 ledger_line.",
    "",
    "MISSING (invariant quad_tuple_no_missing): any tuple element that is null / empty / unreadable \u2014",
    "and any mechanism that is never-run WITHOUT a judgement (\u5DF2\u505C\u7528/\u5DF2\u66FF\u4EE3/\u662F\u7F3A\u9677) \u2014 is listed in",
    "`missing`, `complete` is false, and the exit code is 1. \u7F3A\u503C = \u672A\u6267\u884C.",
    "",
    "Exit codes: 0 complete \xB7 1 incomplete (missing non-empty; a report, not a gate) \xB7 2 usage error",
    "",
    "Test: plugin/test/accounting-emit.test.mjs"
  ];
  return lines.join("\n");
}
function parseArgs(argv) {
  const out = {
    layer: null,
    root: repoRoot(),
    json: false,
    inFlight: null,
    cap: null,
    writeTarget: null,
    ledgerLine: null,
    mechanisms: [],
    noRegistry: false
  };
  let i = 0;
  const next = (flag) => {
    i += 1;
    if (i >= argv.length) {
      console.error(`accounting-emit: ${flag} requires a value`);
      process.exit(2);
    }
    return argv[i];
  };
  while (i < argv.length) {
    const a = argv[i];
    switch (a) {
      case "--layer": {
        const v = next(a);
        if (!LAYERS.includes(v)) {
          console.error(`accounting-emit: unknown layer '${v}' (expected ${LAYERS.join("|")})`);
          process.exit(2);
        }
        out.layer = v;
        break;
      }
      case "--root":
        out.root = path2.resolve(next(a));
        break;
      case "--json":
        out.json = true;
        break;
      case "--in-flight": {
        const v = next(a);
        if (!/^[0-9]+$/.test(v)) {
          console.error(`accounting-emit: --in-flight must be a non-negative integer: ${v}`);
          process.exit(2);
        }
        out.inFlight = Number(v);
        break;
      }
      case "--cap": {
        const v = next(a);
        if (!/^[0-9]+$/.test(v)) {
          console.error(`accounting-emit: --cap must be a non-negative integer: ${v}`);
          process.exit(2);
        }
        out.cap = Number(v);
        break;
      }
      case "--write-target":
        out.writeTarget = next(a);
        break;
      case "--ledger-line":
        out.ledgerLine = next(a);
        break;
      case "--no-registry":
        out.noRegistry = true;
        break;
      case "--mechanism": {
        const v = next(a);
        const parts = v.split(":");
        const name = parts[0];
        if (!name) {
          console.error(`accounting-emit: --mechanism requires a name (name[:epoch|never[:judgement]])`);
          process.exit(2);
        }
        let epoch = null;
        let judgement = null;
        if (parts.length >= 2 && parts[1] !== "") {
          if (parts[1] === "never") {
            epoch = null;
          } else {
            const e = toEpochSeconds(parts[1]);
            if (e === null) {
              console.error(`accounting-emit: --mechanism ${name} epoch must be epoch-seconds, an ISO timestamp, or 'never': ${parts[1]}`);
              process.exit(2);
            }
            epoch = e;
          }
        }
        if (parts.length >= 3 && parts[2] !== "") {
          if (!JUDGEMENTS.includes(parts[2])) {
            console.error(`accounting-emit: --mechanism ${name} judgement must be one of ${JUDGEMENTS.join("/")}: ${parts[2]}`);
            process.exit(2);
          }
          judgement = parts[2];
        }
        out.mechanisms.push({ name, epoch, judgement });
        break;
      }
      case "--help":
      case "-h":
        console.log(usage());
        process.exit(0);
      default:
        console.error(`accounting-emit: unknown argument: ${a}`);
        console.error(usage());
        process.exit(2);
    }
    i += 1;
  }
  if (!out.layer) {
    console.error("accounting-emit: --layer <outer|inner|manager> is required");
    process.exit(2);
  }
  return out;
}
function assembleMechanism(spec, root, injected) {
  const inj = injected.find((m) => m.name === spec.name);
  const now = Math.floor(Date.now() / 1e3);
  let lastRun = null;
  let source = "none";
  if (inj) {
    lastRun = inj.epoch;
    source = inj.epoch !== null ? "flag" : "flag-never";
  } else if (spec.trace) {
    const t = readTimestamp(root, spec.trace);
    lastRun = t.epoch;
    source = t.found ? "trace" : "trace-absent";
  }
  const judgement = inj?.judgement ?? null;
  let age = null;
  let overdue = false;
  if (lastRun !== null) {
    age = Math.max(0, (now - lastRun) / 3600);
    overdue = age > spec.periodHours;
  }
  let status;
  if (judgement) {
    status = "judged";
  } else if (lastRun === null) {
    status = "never-run";
  } else if (overdue) {
    status = "overdue";
  } else {
    status = "fresh";
  }
  return {
    name: spec.name,
    claimed_period_hours: spec.periodHours,
    last_run_epoch: lastRun,
    last_run_age_hours: age !== null ? Math.round(age * 100) / 100 : null,
    overdue,
    status,
    judgement,
    source
  };
}
function main() {
  const args = parseArgs(process.argv.slice(2));
  const layer = args.layer;
  const root = args.root;
  if (!fs2.existsSync(root)) {
    console.error(`accounting-emit: not a directory: ${root}`);
    process.exit(2);
  }
  const registry = args.noRegistry ? [] : MECHANISMS2[layer] ?? [];
  const specs = [...registry];
  for (const inj of args.mechanisms) {
    if (!specs.some((s) => s.name === inj.name)) {
      specs.push({ name: inj.name, periodHours: 1 });
    }
  }
  const mechs = specs.map((s) => assembleMechanism(s, root, args.mechanisms));
  let inFlight = args.inFlight;
  let cap = args.cap;
  let occSource = "flag";
  if (!args.noRegistry) {
    const auto = autoOccupancy(root, cap, inFlight);
    if (inFlight === null && auto.inFlight !== null) {
      inFlight = auto.inFlight;
      occSource = occSource === "flag" ? "flag+auto" : "auto";
    }
    if (cap === null && auto.cap !== null) {
      cap = auto.cap;
      occSource = occSource === "flag" ? "flag+auto" : "auto";
    }
  }
  if (occSource === "flag+auto" && args.inFlight === null && args.cap === null) {
    occSource = "auto";
  }
  if (occSource === "flag" && inFlight === null && cap === null) {
    occSource = "none";
  }
  let ratio = null;
  if (inFlight !== null && cap !== null && cap > 0) ratio = Math.round(inFlight / cap * 100) / 100;
  const writeTarget = args.writeTarget ?? "integration";
  const wtSource = args.writeTarget !== null ? "flag" : "auto";
  const missing = [];
  const warnings = [];
  for (const m of mechs) {
    if (m.last_run_epoch === null && !m.judgement) {
      missing.push(`mechanism:${m.name}.last_run_epoch`);
    }
    if (m.overdue && !m.judgement) {
      missing.push(`mechanism:${m.name}.judgement`);
    }
  }
  if (!mechs.some((m) => m.last_run_epoch !== null)) {
    missing.push("mechanisms.exec_time_unreadable");
  }
  for (const m of mechs) {
    if (m.overdue) warnings.push(`mechanism:${m.name}.overdue`);
  }
  if (inFlight === null) missing.push("occupancy.in_flight");
  if (cap === null) missing.push("occupancy.effective_cap");
  if (!writeTarget) missing.push("write_target");
  const atIso = (/* @__PURE__ */ new Date()).toISOString();
  const atEpoch = Math.floor(Date.now() / 1e3);
  const ledgerLine = args.ledgerLine ?? buildLedgerLine(layer, atIso, { in: inFlight, cap }, writeTarget, mechs.map((m) => ({ name: m.name, lastRun: m.last_run_epoch, judged: m.judgement !== null })), missing.length);
  if (!ledgerLine) missing.push("ledger_line");
  const complete = missing.length === 0;
  const out = {
    layer,
    schema_version: SCHEMA_VERSION,
    at_iso: atIso,
    at_epoch: atEpoch,
    mechanisms: mechs,
    occupancy: { in_flight: inFlight, effective_cap: cap, ratio, source: occSource },
    write_target: writeTarget,
    write_target_source: wtSource,
    ledger_line: ledgerLine,
    ledger_line_source: args.ledgerLine !== null ? "flag" : "auto",
    missing,
    warnings,
    complete
  };
  if (args.json) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`layer=${layer}`);
    console.log(`schema_version=${SCHEMA_VERSION}`);
    console.log(`complete=${complete}`);
    console.log(`ledger_line=${ledgerLine}`);
    for (const m of mechs) {
      const e = m.last_run_epoch !== null ? String(m.last_run_epoch) : "null";
      console.log(`mechanism.${m.name}=${e} status=${m.status} judgement=${m.judgement ?? ""} overdue=${m.overdue}`);
    }
    console.log(`occupancy.in_flight=${inFlight ?? "null"} effective_cap=${cap ?? "null"} ratio=${ratio ?? "null"}`);
    console.log(`write_target=${writeTarget}`);
    if (missing.length > 0) console.log(`missing=${missing.join(",")}`);
    if (warnings.length > 0) console.log(`warnings=${warnings.join(",")}`);
  }
  process.exitCode = complete ? 0 : 1;
}
main();
