#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/develop-deliver-python-steps.ts
import fs from "node:fs";
function pyTruthy(v) {
  if (v === null || v === void 0 || v === false) return false;
  if (v === true) return true;
  if (typeof v === "number") return v !== 0 && !Number.isNaN(v);
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}
function pyRepr(v) {
  if (typeof v === "string") {
    const quote = v.includes("'") && !v.includes('"') ? '"' : "'";
    const body = v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t").split(quote).join(`\\${quote}`);
    return `${quote}${body}${quote}`;
  }
  if (Array.isArray(v)) return `[${v.map(pyRepr).join(", ")}]`;
  if (v !== null && typeof v === "object") {
    return `{${Object.entries(v).map(([k, x]) => `${pyRepr(k)}: ${pyRepr(x)}`).join(", ")}}`;
  }
  return pyStr(v);
}
function pyStr(v) {
  if (typeof v === "string") return v;
  if (v === null || v === void 0) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number") return String(v);
  return pyRepr(v);
}
function pyInt(v) {
  if (v === true) return 1;
  if (v === false) return 0;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new TypeError(`cannot convert float to int: ${String(v)}`);
    return Math.trunc(v);
  }
  if (typeof v === "string" && /^[+-]?\d+$/.test(v.trim())) return Number.parseInt(v.trim(), 10);
  throw new TypeError(`invalid literal for int(): ${pyRepr(v)}`);
}
function get(r, key) {
  if (r === null || typeof r !== "object" || Array.isArray(r)) {
    throw new TypeError(`'${Array.isArray(r) ? "list" : typeof r}' object has no attribute 'get'`);
  }
  const v = r[key];
  return v === void 0 ? null : v;
}
function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}
function eachRecord(file, fn, onBad) {
  const text = fs.readFileSync(file, "utf8");
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let r;
    try {
      r = JSON.parse(line);
    } catch (err) {
      if (onBad === "throw") throw err;
      continue;
    }
    fn(r, line);
  }
}
var sortedListRepr = (values) => pyRepr([...values].sort());
var sortedJoin = (values) => [...values].sort().join(",");
function add(map, k, v) {
  let s = map.get(k);
  if (!s) map.set(k, s = /* @__PURE__ */ new Set());
  s.add(v);
}
function intersectPerHost(left, right, h) {
  const both = /* @__PURE__ */ new Set();
  for (const p of left.get(h) ?? []) if (right.get(h)?.has(p)) both.add(p);
  return both;
}
var out = (s) => void process.stdout.write(s + "\n");
function evidenceAppend(carrier, evidence) {
  const existing = /* @__PURE__ */ new Set();
  try {
    eachRecord(carrier, (r) => {
      try {
        existing.add(canonicalJson(r));
      } catch {
      }
    }, "skip");
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
  }
  const fd = fs.openSync(carrier, "a");
  let appended = 0;
  try {
    eachRecord(evidence, (r, line) => {
      const sig = canonicalJson(r);
      if (existing.has(sig)) return;
      existing.add(sig);
      fs.writeSync(fd, line + "\n");
      appended += 1;
    }, "skip");
  } finally {
    fs.closeSync(fd);
  }
  return appended;
}
function evidenceCompleteness(evidenceFile, expectedArg) {
  const present = /* @__PURE__ */ new Set();
  eachRecord(evidenceFile, (r) => {
    const a = get(r, "ac");
    if (pyTruthy(a)) present.add(a);
  }, "skip");
  const exp = expectedArg.split(/\s+/).filter((x) => x !== "");
  const have = exp.filter((a) => present.has(a));
  if (have.length === 0) {
    out(`ALL-MISSING present=${present.size}`);
    return 3;
  }
  const missing = exp.filter((a) => !present.has(a)).sort();
  if (missing.length > 0) {
    out(`PARTIAL present=${have.length} missing=${missing.length} list=${missing.join(",")}`);
    return 2;
  }
  out(`COMPLETE present=${have.length}`);
  return 0;
}
function pairingVerdict(left, right, okWord, missingWord, leftTag, rightTag, noRecords) {
  const hosts = [.../* @__PURE__ */ new Set([...left.keys(), ...right.keys()])].sort();
  const paired = hosts.filter((h) => (left.get(h)?.size ?? 0) > 0 && intersectPerHost(left, right, h).size > 0);
  if (paired.length > 0) {
    const union = /* @__PURE__ */ new Set();
    for (const h of paired) for (const p of intersectPerHost(left, right, h)) union.add(p);
    out(`${okWord} host=${paired.join(",")} roots=${sortedJoin(union)}`);
    return 0;
  }
  const detail = hosts.map((h) => `host=${h} ${leftTag}=${sortedListRepr(left.get(h) ?? [])} ${rightTag}=${sortedListRepr(right.get(h) ?? [])}`).join(" ; ") || noRecords;
  out(`PARTIAL ${missingWord} ${detail}`);
  return 2;
}
function e2ePairing(evidenceFile) {
  const a203 = /* @__PURE__ */ new Map();
  const a207 = /* @__PURE__ */ new Map();
  eachRecord(evidenceFile, (r) => {
    const h = pyStr(pyTruthy(get(r, "host")) ? get(r, "host") : "");
    const pr = pyStr(pyTruthy(get(r, "project_root")) ? get(r, "project_root") : "");
    if (!h || !pr) return;
    let alive, recs, gates;
    try {
      alive = pyInt(pyTruthy(get(r, "driver_alive")) ? get(r, "driver_alive") : 0);
      recs = pyInt(pyTruthy(get(r, "carrier_records")) ? get(r, "carrier_records") : 0);
      gates = pyInt(pyTruthy(get(r, "gate_events")) ? get(r, "gate_events") : 0);
    } catch {
      return;
    }
    if (get(r, "ac") === "GOAL-009-AC-203" && get(r, "has_plugin_dir") === false && alive === 1 && recs > 0) {
      add(a203, h, pr);
    }
    if (get(r, "ac") === "GOAL-009-AC-207" && get(r, "task_status") === "done" && gates > 0 && get(r, "produced_by_driver") === true && pyTruthy(get(r, "commit_sha")) && pyTruthy(get(r, "task_id"))) {
      add(a207, h, pr);
    }
  }, "skip");
  return pairingVerdict(a203, a207, "E2E-PAIR OK", "E2E_PAIR_MISSING=1", "AC203_roots", "AC207_roots", "no AC-203/AC-207 records at all");
}
function upgradePairing(evidenceFile) {
  const a238 = /* @__PURE__ */ new Map();
  const a239 = /* @__PURE__ */ new Map();
  eachRecord(evidenceFile, (r) => {
    const h = pyStr(pyTruthy(get(r, "host")) ? get(r, "host") : "");
    const pr = pyStr(pyTruthy(get(r, "project_root")) ? get(r, "project_root") : "");
    if (!h || !pr) return;
    if (get(r, "ac") === "GOAL-009-AC-238" && typeof get(r, "pre_upgrade_task_count") === "number" && Number.isInteger(get(r, "pre_upgrade_task_count")) && get(r, "pre_upgrade_task_count") > 0 && get(r, "post_upgrade_task_count") === get(r, "pre_upgrade_task_count") && typeof get(r, "pre_upgrade_runtime_age_days") === "number" && Number.isFinite(get(r, "pre_upgrade_runtime_age_days")) && get(r, "pre_upgrade_runtime_age_days") >= 1 && get(r, "runtime_replaced") === true && get(r, "task_list_ok") === true && pyTruthy(get(r, "build_sha"))) {
      add(a238, h, pr);
    }
    let gates;
    try {
      gates = pyInt(pyTruthy(get(r, "gate_events")) ? get(r, "gate_events") : 0);
    } catch {
      return;
    }
    if (get(r, "ac") === "GOAL-009-AC-239" && get(r, "task_status") === "done" && gates > 0 && get(r, "produced_by_driver") === true && pyTruthy(get(r, "commit_sha")) && pyTruthy(get(r, "task_id"))) {
      add(a239, h, pr);
    }
  }, "skip");
  return pairingVerdict(a238, a239, "UPGRADE-PAIR OK", "UPGRADE_PAIR_MISSING=1", "AC238_roots", "AC239_roots", "no AC-238/AC-239 records at all");
}
var AC248 = "GOAL-016-AC-248";
var AC249 = "GOAL-016-AC-249";
function adrFlipPasses(r) {
  return r.adr_check_before_detects === false && r.adr_check_after_detects === true && pyTruthy(r.adr_check_probe_tool);
}
function completeChangePasses(cf, taskId) {
  return Array.isArray(cf) && cf.length > 0 && cf.some((x) => pyStr(x).startsWith("src/") || pyStr(x).startsWith("scripts/")) && cf.some((x) => pyStr(x).includes("ADR-007") || pyStr(x).startsWith("docs/adr")) && pyTruthy(taskId);
}
function adrFlipShape(carrier, variant) {
  if (variant === "positive") {
    let ok = false;
    eachRecord(carrier, (r) => {
      if (get(r, "ac") !== AC248) return;
      ok = adrFlipPasses(r);
    }, "throw");
    return ok ? "1" : "0";
  }
  let n = 0;
  let bad = [{}, {}];
  eachRecord(carrier, (r) => {
    if (get(r, "ac") !== AC248) return;
    const rec = r;
    bad = [
      { ...rec, adr_check_before_detects: 0, adr_check_after_detects: 1 },
      { ...rec, adr_check_before_detects: "false", adr_check_after_detects: "true" }
    ];
    n = 1;
  }, "throw");
  if (!n) return "0";
  return bad.some((rec) => adrFlipPasses(rec)) ? "0" : "1";
}
function completeChangePredicate(carrier, variant) {
  if (variant !== "positive") {
    const cf = variant === "code-only" ? ["scripts/check-adr.ts", "tests/unit/scripts/check-adr.test.ts"] : variant === "doc-only" ? ["quay-adr/ADR-007.md", "docs/notes.md"] : ["./scripts/check-adr.ts", "quay-adr/ADR-007.md"];
    let ok2 = false;
    eachRecord(carrier, (r) => {
      if (get(r, "ac") !== AC249) return;
      ok2 = cf.some((x) => x.startsWith("src/") || x.startsWith("scripts/")) && cf.some((x) => x.includes("ADR-007") || x.startsWith("docs/adr"));
    }, "throw");
    return ok2 ? "0" : "1";
  }
  let ok = false;
  eachRecord(carrier, (r) => {
    if (get(r, "ac") !== AC249) return;
    ok = completeChangePasses(get(r, "commit_files"), get(r, "task_id"));
  }, "throw");
  return ok ? "1" : "0";
}
function stateField(stateFile, key) {
  const r = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  if (r === null || typeof r !== "object" || Array.isArray(r)) throw new TypeError("state file is not a JSON object");
  const o = r;
  return Object.prototype.hasOwnProperty.call(o, key) ? pyStr(o[key]) : "";
}
function ageSeconds(ts) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?([+-]\d{2}:?\d{2})?$/.exec(
    ts.replace(/Z/g, "+00:00")
  );
  if (!m) throw new Error(`Invalid isoformat string: ${pyRepr(ts)}`);
  const zone = m[8];
  if (!zone) throw new Error("can't subtract offset-naive and offset-aware datetimes");
  const zm = /^([+-])(\d{2}):?(\d{2})$/.exec(zone);
  const offsetMin = (zm[1] === "-" ? -1 : 1) * (Number(zm[2]) * 60 + Number(zm[3]));
  const ms = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] ?? "0"),
    Number((m[7] ?? "").padEnd(3, "0").slice(0, 3))
  ) - offsetMin * 6e4;
  return Math.max(0, Math.trunc((Date.now() - ms) / 1e3));
}
var USAGE = `usage: develop-deliver-python-steps.ts <step> [args\u2026]

steps (each mirrors the python3 invocation it replaced in plugin/scripts/develop-deliver-tgz.sh):
  evidence-append            <carrier> <evidence>          \u2192 stdout: appended count (H1)
  evidence-completeness      <evidence> <expected-ac-set>  \u2192 stdout: verdict; exit 0/2/3 (H2)
  e2e-pairing                <evidence>                    \u2192 stdout: verdict; exit 0/2 (H3)
  upgrade-pairing            <evidence>                    \u2192 stdout: verdict; exit 0/2 (H4)
  adrflip-bool-shape         <carrier> positive|impostors  \u2192 stdout: 1/0 (H5/H6)
  complete-change-predicate  <carrier> positive|code-only|doc-only|dot-slash \u2192 stdout: 1/0 (H7..H10)
  state-field                <state-file> <key>            \u2192 stdout: python str(value) or '' (H11)
  age-seconds                <iso-8601>                    \u2192 stdout: integer seconds (H12)
`;
function main() {
  const [step, ...args] = process.argv.slice(2);
  if (!step || step === "--help" || step === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }
  const need = (n) => {
    if (args.length < n) {
      process.stderr.write(`develop-deliver-python-steps: '${step}' needs ${n} argument(s), got ${args.length}
${USAGE}`);
      throw new Error("usage");
    }
  };
  switch (step) {
    case "evidence-append":
      need(2);
      out(String(evidenceAppend(args[0], args[1])));
      return 0;
    case "evidence-completeness":
      need(2);
      return evidenceCompleteness(args[0], args[1]);
    case "e2e-pairing":
      need(1);
      return e2ePairing(args[0]);
    case "upgrade-pairing":
      need(1);
      return upgradePairing(args[0]);
    case "adrflip-bool-shape": {
      need(2);
      const v = args[1];
      if (v !== "positive" && v !== "impostors") throw new Error(`unknown variant '${v}'`);
      out(adrFlipShape(args[0], v));
      return 0;
    }
    case "complete-change-predicate": {
      need(2);
      const v = args[1];
      if (v !== "positive" && v !== "code-only" && v !== "doc-only" && v !== "dot-slash") {
        throw new Error(`unknown variant '${v}'`);
      }
      out(completeChangePredicate(args[0], v));
      return 0;
    }
    case "state-field":
      need(2);
      out(stateField(args[0], args[1]));
      return 0;
    case "age-seconds":
      need(1);
      out(String(ageSeconds(args[0])));
      return 0;
    default:
      process.stderr.write(`develop-deliver-python-steps: unknown step '${step}'
${USAGE}`);
      return 2;
  }
}
try {
  process.exitCode = main();
} catch (err) {
  const usage = err instanceof Error && err.message === "usage";
  if (!usage) {
    process.stderr.write(`develop-deliver-python-steps: ${err instanceof Error ? err.message : String(err)}
`);
  }
  process.exitCode = usage ? 2 : 1;
}
