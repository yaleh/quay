#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-staleness-check.ts
import fs2 from "node:fs";

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

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
import path2 from "node:path";
function helpExit(usage) {
  process.stdout.write(usage.endsWith("\n") ? usage : usage + "\n");
  process.exit(0);
}
function parseArgs(argv, spec) {
  const result = { args: [], flags: {} };
  const raw = argv.slice(2);
  const flagDefs = spec.flags || {};
  const unknownMode = spec.unknown ?? (spec.strict ? "reject" : "accept");
  const scriptName = path2.basename(argv[1] || "script");
  if (raw.includes("--help") || raw.includes("-h")) {
    if (spec.help === "return") {
      result.help = true;
      return result;
    }
    helpExit(`usage: ${scriptName} ${spec.usage}`);
  }
  const usageError = (message) => {
    if (spec.errors === "return") {
      result.error = message;
      return result;
    }
    console.error(message);
    process.exit(2);
  };
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a.startsWith("--")) {
      const eqIdx = a.indexOf("=");
      const name = eqIdx >= 0 ? a.slice(2, eqIdx) : a.slice(2);
      const def = flagDefs[name];
      if (!def && unknownMode === "reject") return usageError(`unknown argument: --${name}`);
      if (!def && unknownMode === "skip") continue;
      if (def?.type === "boolean") {
        result.flags[name] = true;
      } else if (def?.type === "string[]") {
        if (!result.lists) result.lists = {};
        const list = result.lists[name] ??= [];
        if (eqIdx >= 0) list.push(a.slice(eqIdx + 1));
        else if (def.greedy) {
          while (i + 1 < raw.length && !raw[i + 1].startsWith("--")) list.push(raw[++i]);
        } else if (i + 1 < raw.length) list.push(raw[++i]);
      } else if (eqIdx >= 0) {
        result.flags[name] = a.slice(eqIdx + 1);
      } else if (i + 1 < raw.length) {
        result.flags[name] = raw[++i];
      } else {
        result.flags[name] = "";
      }
    } else {
      result.args.push(a);
    }
  }
  const minArgs = spec.minArgs ?? 1;
  if (result.args.length < minArgs) {
    return usageError(`Usage: ${scriptName} ${spec.usage}`);
  }
  return result;
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-staleness-check.ts
import path3 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
var SCRIPT_DIR = path3.dirname(fileURLToPath2(import.meta.url));
var DEFAULT_TIMEOUT = 86400;
var SPEC = {
  minArgs: 0,
  // measure-only invocation (no positionals) is this probe's normal mode
  strict: true,
  usage: "[--root <dir>] [--timeout <secs>] [--json]",
  flags: { root: { type: "string" }, timeout: { type: "string" }, json: { type: "boolean" } }
};
function readGateLedger(root) {
  const ledger = path3.join(root, ".quay", "gate-events.jsonl");
  let lastTs = null;
  let count = 0;
  if (fs2.existsSync(ledger)) {
    const raw = fs2.readFileSync(ledger, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        if (ev && typeof ev.timestamp === "string") {
          count++;
          if (lastTs === null || ev.timestamp > lastTs) lastTs = ev.timestamp;
        }
      } catch {
      }
    }
  }
  let ageSeconds = null;
  if (lastTs !== null) {
    const ms = Date.parse(lastTs);
    if (Number.isFinite(ms)) ageSeconds = Math.max(0, Math.floor((Date.now() - ms) / 1e3));
  }
  return { lastTs, count, ageSeconds };
}
function main(argv) {
  const parsed = parseArgs(argv, SPEC);
  const json = parsed.flags.json === true;
  let timeout = DEFAULT_TIMEOUT;
  const rawTimeout = parsed.flags.timeout;
  if (typeof rawTimeout === "string" && rawTimeout !== "") {
    const v = Number(rawTimeout);
    if (!Number.isFinite(v) || v < 0) {
      console.error("gate-staleness-check: --timeout must be a non-negative integer (seconds)");
      return 2;
    }
    timeout = v;
  }
  const rootFlag = parsed.flags.root;
  const root = typeof rootFlag === "string" && rootFlag !== "" ? rootFlag : repoRoot(SCRIPT_DIR);
  if (!fs2.existsSync(path3.join(root, ".quay"))) {
    if (json) {
      console.log(JSON.stringify({ last_gate_event_at: null, gate_event_count: 0, age_seconds: null, timeout, gate_never_ran: true, gate_stale: true, signal: true }));
    } else {
      console.error(`gate-staleness-check: not a workspace (no .quay/ dir): ${root}`);
    }
    return json ? 1 : 2;
  }
  const { lastTs, count, ageSeconds } = readGateLedger(root);
  const gateNeverRan = lastTs === null;
  const gateStale = !gateNeverRan && ageSeconds !== null && ageSeconds > timeout;
  const signal = gateNeverRan || gateStale;
  if (json) {
    console.log(JSON.stringify({
      last_gate_event_at: lastTs,
      gate_event_count: count,
      age_seconds: ageSeconds,
      timeout,
      gate_never_ran: gateNeverRan,
      gate_stale: gateStale,
      signal
    }));
    return signal ? 1 : 0;
  }
  if (signal) {
    if (gateNeverRan) {
      console.log("GATE-STALE-WARN: gate ledger is empty/missing \u2014 the gate engine has never run here (\u673A\u5236\u5B58\u5728 \u2260 \u673A\u5236\u5728\u8DD1)");
    } else {
      console.log(`GATE-STALE-WARN: last gate event ${lastTs} is ${ageSeconds}s old > claimed period ${timeout}s \u2014 AC status would show a silent collective green`);
    }
    return 1;
  }
  console.log(`gate-staleness-check: ok (last gate event ${lastTs}, age ${ageSeconds}s \u2264 ${timeout}s)`);
  return 0;
}
if (process.argv[1] && path3.resolve(process.argv[1]) === fileURLToPath2(import.meta.url)) {
  process.exitCode = main(process.argv);
}
export {
  main,
  readGateLedger
};
