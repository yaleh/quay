#!/usr/bin/env node
// productization-verification-record-check.ts — AC89 checker: mechanically consume the productization
// verification record file (.quay/productization-verification.jsonl) so a "产品化健康" check never has
// to read prose. (tasks/gap-ac89-productization-verification-record)
//
// AC89 判据 (manager-phase-goal.md): 验证结果落一份【可机械核对】的记录——同 per-task-suite-records.jsonl
// 的形态（结构化 JSON 行）。本 checker 是 AC89 AC5 的消费侧：把记录文件变成能取假的判定。
//
//   判据1 (shape, 硬规则 3b) — every record that EXISTS must carry the base required shape
//           {ts, ac, ok, artifact, evidence, detail} plus the per-AC required fields:
//           AC85 → version; AC86 → runId; AC88 → host + stepInstall/stepInit/stepColdstart.
//           A malformed record (unparseable line, missing/invalid required field, or an AC88 record
//           without host/steps) ⇒ RED: a partial record would look like "the mechanism recorded this
//           result" while hiding what actually happened. An absent/empty record file ⇒ NOT-EVALUATED
//           (nothing recorded yet — cannot judge, never conflated with green).
//
//   判据2 (coverage, AC2/AC3/AC4) — the record set must contain a well-formed record for each
//           acceptance that must be recorded:
//           AC85 (本机 build 产物验证结果, AC2) — ≥1 well-formed AC85 record carrying version.
//           AC86 (等价路径执行结果, AC3)      — ≥1 well-formed AC86 record carrying runId.
//           AC88 (跨主机验证结果, AC4)       — ≥1 well-formed AC88 record for host=B AND ≥1 for host=C,
//                                              each carrying stepInstall/stepInit/stepColdstart + ts.
//           A missing required coverage record ⇒ RED (the mechanism recorded a subset, not the phase).
//           No records at all ⇒ NOT-EVALUATED.
//
// The coverage check judges the SHAPE of the records only — `ok:false` is a legitimate recorded
// outcome (a failed verification must be recorded too), never a shape violation. Whether the
// verification PASSED is the `ok` field a downstream "产品化健康" check reads.
//
// Exit codes: 0 = PASS (or NOT-EVALUATED — read `evaluated`), 1 = RED, 2 = usage/environment error.
//
// Usage:
//   node --experimental-strip-types plugin/scripts/productization-verification-record-check.ts
//       [--root <dir>] [--record-file <file>] [--json] [--help]

import fs from "node:fs";
import path from "node:path";
import { isDirectEntry } from "./gate-script-base.ts";
import { resolveSharedCheckout } from "./per-task-suite-record.ts";
import { KNOWN_ACS } from "./productization-verification-record.ts";

export const REQUIRED_FIELDS = ["ts", "ac", "ok", "artifact", "evidence", "detail"];

export const AC85_REQUIRED = ["version"];
export const AC86_REQUIRED = ["runId"];
export const AC88_REQUIRED = ["host", "stepInstall", "stepInit", "stepColdstart"];
export const AC88_HOSTS = ["B", "C"];

/** Judge ONE parsed record's shape (判据1). PURE. RED when any REQUIRED field is missing or invalid
 *  (a partial record must never be treated as a valid recording — 硬规则 3b). GREEN when all required
 *  fields are present and typed. A null/undefined record is RED (malformed — cannot judge as 合格).
 *  @param {Record<string, any>|null|undefined} rec
 *  @returns {{ok:boolean, evaluated:boolean, reason:string, missingFields:string[]}} */
export function validateRecord(rec) {
  if (rec == null) {
    return { ok: false, evaluated: true, reason: "unparseable-record (malformed JSON line)", missingFields: [] };
  }
  const missing = [];
  for (const f of REQUIRED_FIELDS) {
    const v = rec[f];
    if (v == null || (typeof v === "string" && !String(v).trim())) missing.push(f);
  }
  if (rec.ts != null && !Number.isFinite(Date.parse(String(rec.ts)))) missing.push("ts∈ISO");
  const ac = String(rec.ac ?? "");
  if (!KNOWN_ACS.includes(ac)) missing.push(`ac∈{${KNOWN_ACS.join("|")}}`);
  if (rec.ok != null && typeof rec.ok !== "boolean") missing.push("ok∈boolean");
  if (ac === "AC85") {
    for (const f of AC85_REQUIRED) {
      if (rec[f] == null || (typeof rec[f] === "string" && !String(rec[f]).trim())) missing.push(f);
    }
  }
  if (ac === "AC86") {
    for (const f of AC86_REQUIRED) {
      if (rec[f] == null || (typeof rec[f] === "string" && !String(rec[f]).trim())) missing.push(f);
    }
  }
  if (ac === "AC88") {
    for (const f of AC88_REQUIRED) {
      if (rec[f] == null || (typeof rec[f] === "string" && !String(rec[f]).trim())) missing.push(f);
    }
    for (const f of ["stepInstall", "stepInit", "stepColdstart"]) {
      if (rec[f] != null && typeof rec[f] !== "boolean") missing.push(`${f}∈boolean`);
    }
  }
  if (missing.length > 0) {
    return { ok: false, evaluated: true, reason: `malformed-record (missing/invalid: ${missing.join(", ")})`, missingFields: missing };
  }
  return { ok: true, evaluated: true, reason: "well-formed-record", missingFields: [] };
}

/** Aggregate 判据1 shape check over the parsed record file. PURE. An empty list ⇒ NOT-EVALUATED
 *  (nothing recorded yet — cannot judge, never conflated with green). Any malformed ⇒ RED.
 *  @param {Array<Record<string, any>|null>} records
 *  @returns {{ok:boolean, evaluated:boolean, reason:string, violations:string[]}} */
export function checkRecordFile(records) {
  const raw = records ?? [];
  if (raw.length === 0) {
    return { ok: true, evaluated: false, reason: "no-records (NOT-EVALUATED)", violations: [] };
  }
  const violations = [];
  raw.forEach((rec, i) => {
    const v = validateRecord(rec);
    if (!v.ok) violations.push(`[${i}] ${v.reason}`);
  });
  if (violations.length > 0) {
    return { ok: false, evaluated: true, reason: "malformed-record-file", violations };
  }
  return { ok: true, evaluated: true, reason: `well-formed (${raw.length} record(s))`, violations: [] };
}

/** Judge 判据2 — per-AC coverage: AC85 / AC86 / AC88(B + C) well-formed records present. PURE.
 *  A well-formed record is one validateRecord accepts (shape-valid). RED when a required acceptance's
 *  record is missing or malformed; GREEN when all are present; NOT-EVALUATED when no records exist.
 *  `ok:false` is NOT a violation — a failed verification is a legitimate recorded outcome.
 *  @param {Array<Record<string, any>|null>} records
 *  @returns {{ok:boolean, evaluated:boolean, reason:string, missing:string[]}} */
export function checkCoverage(records) {
  const raw = (records ?? []).filter(Boolean);
  if (raw.length === 0) {
    return { ok: true, evaluated: false, reason: "no-records (NOT-EVALUATED)", missing: [] };
  }
  const missing = [];
  const wellFormed = raw.filter((r) => validateRecord(r).ok);
  const byAc = { AC85: [], AC86: [], AC88: [] };
  for (const r of wellFormed) {
    if (byAc[r.ac]) byAc[r.ac].push(r);
  }
  if (byAc.AC85.length === 0) missing.push("AC85 (build-artifact verification record — version + artifact)");
  if (byAc.AC86.length === 0) missing.push("AC86 (dist-verify equivalent-path record — runId + ts)");
  const ac88Hosts = new Set(byAc.AC88.map((r) => String(r.host)));
  for (const h of AC88_HOSTS) {
    if (!ac88Hosts.has(h)) missing.push(`AC88 host=${h} (cross-host verification record — install/init/coldstart + ts)`);
  }
  if (missing.length > 0) {
    return { ok: false, evaluated: true, reason: `missing-coverage-record (${missing.length}): ${missing.join("; ")}`, missing };
  }
  return { ok: true, evaluated: true, reason: `all-recorded (AC85 ${byAc.AC85.length} / AC86 ${byAc.AC86.length} / AC88 hosts ${[...ac88Hosts].join("+")})`, missing: [] };
}

// ── fs helper ────────────────────────────────────────────────────────────────────────────────────────
function readJsonl(file) {
  if (!file || !fs.existsSync(file)) return null;
  const out = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      out.push(null); // unparseable line — 判据1 flags it as malformed
    }
  }
  return out;
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────
function getArgValue(args, name) {
  const idx = args.indexOf(name);
  return idx === -1 ? undefined : args[idx + 1];
}

const usage = `productization-verification-record-check.ts — AC89 checker for the productization
  verification record file (.quay/productization-verification.jsonl in the SHARED checkout).
    判据1 shape — every existing record must carry {ts, ac, ok, artifact, evidence, detail} plus the
      per-AC required fields (AC85→version, AC86→runId, AC88→host + stepInstall/stepInit/stepColdstart);
      a malformed/partial record ⇒ RED (硬规则 3b: 读不懂 ≠ 合格).
    判据2 coverage — the record set must contain a well-formed record for AC85 (build artifact, with
      version), AC86 (dist-verify equivalent path, with runId), and AC88 for BOTH hosts B and C (each
      with install/init/coldstart steps + ts). A missing required record ⇒ RED; no records ⇒
      NOT-EVALUATED (never conflated with green).

Usage:
  node --experimental-strip-types plugin/scripts/productization-verification-record-check.ts
      [--root <dir>] [--record-file <file>] [--json] [--help]

  --root               repo root (default: cwd) — resolves the shared checkout via git common-dir
  --record-file        override the record path (default <shared>/.quay/productization-verification.jsonl)
  --json               machine-readable output {ok, evaluated, reason, checks}
  --help               this help

Exit codes:
  0  PASS or NOT-EVALUATED (read \`evaluated\` — false = could not judge, never conflated with green)
  1  RED — a malformed record / a required acceptance's record missing (判据1 / 判据2)
  2  usage / environment error`;

export function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(usage + "\n");
    return 0;
  }
  const root = path.resolve(getArgValue(args, "--root") ?? process.cwd());
  const recordFileOverride = getArgValue(args, "--record-file");
  const asJson = args.includes("--json");

  let shared = null;
  let recordFile = recordFileOverride;
  if (!recordFile) {
    shared = resolveSharedCheckout(root);
    if (!shared) {
      const msg = `cannot resolve the shared checkout from ${root} (git common-dir failed)`;
      if (asJson) console.log(JSON.stringify({ ok: false, error: msg }));
      else console.error(`productization-verification-record-check: ${msg}`);
      return 2;
    }
    recordFile = path.join(shared, ".quay", "productization-verification.jsonl");
  }

  const records = readJsonl(recordFile);
  const checks = [];
  let anyEvaluated = false;
  let anyRed = false;

  // ── 判据1 — shape of every existing record ────────────────────────────────────────────────────────
  if (records != null) {
    const v = checkRecordFile(records);
    if (v.evaluated) {
      anyEvaluated = true;
      if (!v.ok) anyRed = true;
    }
    checks.push({ check: "record-shape", ...v, source: recordFile });
  } else {
    checks.push({ check: "record-shape", ok: true, evaluated: false, reason: "record-file-absent (NOT-EVALUATED)", violations: [], source: recordFile });
  }

  // ── 判据2 — per-AC coverage (AC2/AC3/AC4) ─────────────────────────────────────────────────────────
  const cov = checkCoverage(records);
  if (cov.evaluated) {
    anyEvaluated = true;
    if (!cov.ok) anyRed = true;
  }
  checks.push({ check: "per-ac-coverage", ...cov, source: recordFile });

  const ok = !anyRed;
  const out = {
    ok,
    evaluated: anyEvaluated,
    reason: ok ? (anyEvaluated ? "productization-verification-record-check-pass" : "nothing-to-judge (NOT-EVALUATED)") : "productization-verification-record-violation",
    checks,
  };

  if (asJson) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`productization-verification-record-check: ${ok ? "OK" : "FAIL"} — ${out.reason}`);
    for (const c of out.checks) {
      const detail = c.missing?.length
        ? ` missing=${c.missing.length}`
        : c.violations?.length
          ? ` violations=${c.violations.length}`
          : "";
      console.log(`  [${c.check}] ${c.ok ? "ok" : "RED"}${c.evaluated ? "" : " (NOT-EVALUATED)"} — ${c.reason}${detail}`);
    }
  }
  return ok ? 0 : 1;
}

if (isDirectEntry(import.meta, undefined, "productization-verification-record-check")) {
  process.exitCode = main(process.argv);
}
