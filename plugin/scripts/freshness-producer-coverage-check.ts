// freshness-producer-coverage-check.ts — the COMPLETENESS judge for the freshness refresh
// mechanism (AC7 of tasks/gap-ac214-upgrade-face-refresh-and-mechanical-freshness-trigger).
//
// THE DEFECT THIS EXISTS FOR. Goal AC-214 requires that the evidence of seven carrier-type
// subjects (GOAL-009-AC-201/203/205/207/232/238/239) stay within K delivery-face commits of the
// develop tip. The gate that enforces it can only go red; nothing made the REFRESH happen. Each
// subject is refreshed by a cross-machine PRODUCER run, and the mapping
// subject -> producer lived only in prose, in a different task body each time. Measured cost of
// that: the gap re-crossed 4 times in 5 days (2026-09-13 x2, 2026-09-14 x2) — each time closed by a
// one-off manual re-run, each time re-opened because the re-run had no trigger.
//
// The 2026-09-13 crossing is the shape this check makes mechanical: TWO producer faces exist, only
// ONE was re-run, and the other's subjects aged past K. A registry that is not checked for
// completeness cannot tell "every subject has an owner" from "the owner I remembered has one".
//
// WHAT IT JUDGES (four enumerative findings, never a single boolean — 硬规则 3):
//   A. unregistered        — a subject OBSERVED in the carrier with no producer registered for it.
//                            This is the AC's own wording ("载体里出现过、却没在映射里登记产出者").
//   B. no_carrier_evidence — a REGISTERED subject that has never produced a carrier record: the
//                            registry claims coverage the artifact does not show.
//   C. margin_unregistered — a subject the AC-214 criterion itself tracks (keys of
//                            .quay/goal-freshness-margin.json, which the criterion WRITES) with no
//                            producer registered. This is the direction A cannot see: a subject
//                            added to the criterion's NEED list whose producer never runs leaves no
//                            carrier record at all, so A stays silent while C fires.
//   D. margin_orphan       — a registered subject the criterion does not track.
//
// SUBJECT SCOPE — why it is not "every ac in the carrier". The carrier
// (.quay/productization-verification.jsonl) holds 25 distinct ac kinds written by many faces
// (AC88, AC107, GOAL-016-*, GOAL-018-* ...). Treating all of them as refreshable subjects would be
// false. Scope is declared ONCE in the mapping (`subject_id_pattern` + `subject_requires_build_sha`)
// and applied mechanically:
//   a carrier record is a REFRESHABLE-SUBJECT record iff its `ac` matches the pattern AND carries a
//   top-level 40-hex `build_sha`.
// Measured on the real carrier 2026-09-14: that rule yields exactly the seven subjects above —
// GOAL-009-AC-204/206 match the pattern but carry no build_sha, GOAL-018-AC-257 carries a build_sha
// but not the goal prefix.
//
// THREE-STATE CONTRACT (硬规则 3b — a check that cannot say "I did not look" is worse than none):
//   0 = judged, consistent            (or: carrier absent ⇒ evaluated:false, exit 0 — see below)
//   1 = judged, >=1 finding
//   2 = the mapping itself is missing/corrupt (fail-closed: a broken declaration surface must not
//       read as "nothing to check")
//   3 = reserved — never produced here; the absence of the carrier is reported as evaluated:false at
//       exit 0 rather than 3, because this check is registered in the CODE-class static gate, where
//       a non-zero exit from a passive checkout would red every unrelated suite run.
//   The carrier-absent case is NOT conflated with PASS: `evaluated:false` and `NOT-EVALUATED` are
//   carried in both the JSON and the human line, so a reader can tell "judged and consistent" from
//   "there was nothing to judge".
//
// Usage:
//   node --experimental-strip-types plugin/scripts/freshness-producer-coverage-check.ts \
//     [--root <dir>] [--mapping <rel>] [--carrier <rel>] [--margin <rel>] [--json]
// Exit: 0 / 1 / 2 as above.

import fs from "node:fs";
import path from "node:path";
import { helpExit, isDirectEntry } from "./gate-script-base.ts";

export const DEFAULT_MAPPING_REL = "plugin/freshness-producers.json";

/** The record field carrying the 40-hex delivery commit this evidence was produced at. */
export const BUILD_SHA_FIELD = "build_sha";

/** A top-level `build_sha` is a 40-hex commit id (lowercase). */
const BUILD_SHA_RE = /^[0-9a-f]{40}$/;

export interface ProducerEntry {
  id: string;
  command: string;
  wallclock_hours: number;
  subjects: string[];
}

export interface ProducerMapping {
  carrier: string;
  margin_snapshot: string;
  subject_id_pattern: string;
  subject_requires_build_sha: boolean;
  producers: ProducerEntry[];
}

export interface CoverageFinding {
  kind: "unregistered" | "no_carrier_evidence" | "margin_unregistered" | "margin_orphan";
  subject: string;
  detail: string;
}

export interface CoverageReport {
  /** false = there was nothing to judge (carrier absent). NEVER conflated with a passing judgement. */
  evaluated: boolean;
  ok: boolean;
  /** Distinct subjects observed in the carrier under the declared scope rule. */
  observedSubjects: string[];
  /** Union of every producer's declared subjects. */
  registeredSubjects: string[];
  /** Keys of the margin snapshot's `subjects` map, or null when it could not be read. */
  marginSubjects: string[] | null;
  findings: CoverageFinding[];
  reason: string;
}

/**
 * Parse + validate the mapping. Throws `CoverageMappingError` on any shape violation — a mapping
 * the check cannot read must NOT degrade into "no subjects registered" (which would report every
 * observed subject as unregistered, i.e. a red for the wrong reason) nor into "nothing to check".
 */
export class CoverageMappingError extends Error {}

export function parseMapping(text: string): ProducerMapping {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    throw new CoverageMappingError(`mapping is not valid JSON: ${(e as Error).message}`);
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    throw new CoverageMappingError("mapping must be a JSON object");
  }
  const m = obj as Record<string, unknown>;
  for (const key of ["carrier", "margin_snapshot", "subject_id_pattern"]) {
    if (typeof m[key] !== "string" || !(m[key] as string).trim()) {
      throw new CoverageMappingError(`mapping.${key} must be a non-empty string`);
    }
  }
  if (typeof m.subject_requires_build_sha !== "boolean") {
    throw new CoverageMappingError("mapping.subject_requires_build_sha must be a boolean");
  }
  if (!Array.isArray(m.producers) || m.producers.length === 0) {
    throw new CoverageMappingError("mapping.producers must be a non-empty array");
  }
  const producers: ProducerEntry[] = [];
  for (const [i, raw] of (m.producers as unknown[]).entries()) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new CoverageMappingError(`mapping.producers[${i}] must be an object`);
    }
    const p = raw as Record<string, unknown>;
    for (const key of ["id", "command"]) {
      if (typeof p[key] !== "string" || !(p[key] as string).trim()) {
        throw new CoverageMappingError(`mapping.producers[${i}].${key} must be a non-empty string`);
      }
    }
    if (typeof p.wallclock_hours !== "number" || !(p.wallclock_hours > 0)) {
      throw new CoverageMappingError(`mapping.producers[${i}].wallclock_hours must be a positive number`);
    }
    if (!Array.isArray(p.subjects) || p.subjects.length === 0 || !p.subjects.every((s) => typeof s === "string")) {
      throw new CoverageMappingError(`mapping.producers[${i}].subjects must be a non-empty array of strings`);
    }
    producers.push({
      id: p.id as string,
      command: p.command as string,
      wallclock_hours: p.wallclock_hours as number,
      subjects: p.subjects as string[],
    });
  }
  return {
    carrier: m.carrier as string,
    margin_snapshot: m.margin_snapshot as string,
    subject_id_pattern: m.subject_id_pattern as string,
    subject_requires_build_sha: m.subject_requires_build_sha as boolean,
    producers,
  };
}

/** Distinct subjects observed in `records` under the declared scope rule (pattern ∧ build_sha). */
export function observedSubjects(
  records: readonly Record<string, unknown>[],
  pattern: RegExp,
  requireBuildSha: boolean,
): string[] {
  const seen: string[] = [];
  for (const r of records) {
    const ac = r.ac;
    if (typeof ac !== "string" || !pattern.test(ac)) continue;
    if (requireBuildSha) {
      const sha = r[BUILD_SHA_FIELD];
      if (typeof sha !== "string" || !BUILD_SHA_RE.test(sha)) continue;
    }
    if (!seen.includes(ac)) seen.push(ac);
  }
  return seen.sort();
}

/** The pure judgement. All inputs are already-read values, so every control is directly drivable. */
export function judgeCoverage(input: {
  observedSubjects: string[];
  registeredSubjects: string[];
  marginSubjects: string[] | null;
}): CoverageFinding[] {
  const { observedSubjects: obs, registeredSubjects: reg, marginSubjects: margin } = input;
  const findings: CoverageFinding[] = [];
  const has = (xs: readonly string[], v: string) => xs.includes(v);

  for (const s of obs) {
    if (!has(reg, s)) {
      findings.push({
        kind: "unregistered",
        subject: s,
        detail: "appears in the carrier with a build_sha, but no producer in the mapping declares it",
      });
    }
  }
  for (const s of reg) {
    if (!has(obs, s)) {
      findings.push({
        kind: "no_carrier_evidence",
        subject: s,
        detail: "registered to a producer, but the carrier holds no scoped record for it",
      });
    }
  }
  if (margin !== null) {
    for (const s of margin) {
      if (!has(reg, s)) {
        findings.push({
          kind: "margin_unregistered",
          subject: s,
          detail: "the AC-214 criterion tracks this subject, but no producer in the mapping declares it",
        });
      }
    }
    for (const s of reg) {
      if (!has(margin, s)) {
        findings.push({
          kind: "margin_orphan",
          subject: s,
          detail: "registered to a producer, but the AC-214 criterion does not track it",
        });
      }
    }
  }
  return findings;
}

function readJsonLines(abs: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const text = fs.readFileSync(abs, "utf8");
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (typeof r === "object" && r !== null && !Array.isArray(r)) out.push(r as Record<string, unknown>);
    } catch {
      // A malformed line is skipped rather than fatal: the carrier is append-only across many
      // producers, and one bad line must not blind the whole judgement. The COUNT is not reported
      // as "parsed" anywhere, so no reader can mistake this for full coverage of the file.
      continue;
    }
  }
  return out;
}

export interface RunOptions {
  root: string;
  mappingRel?: string;
  carrierRel?: string;
  marginRel?: string;
}

/** Throws CoverageMappingError when the mapping cannot be read/parsed (caller maps it to exit 2). */
export function runCoverageCheck(opts: RunOptions): CoverageReport {
  const root = path.resolve(opts.root);
  const mappingRel = opts.mappingRel ?? DEFAULT_MAPPING_REL;
  const mappingAbs = path.isAbsolute(mappingRel) ? mappingRel : path.join(root, mappingRel);
  if (!fs.existsSync(mappingAbs)) {
    throw new CoverageMappingError(`mapping not found at ${mappingAbs}`);
  }
  const mapping = parseMapping(fs.readFileSync(mappingAbs, "utf8"));
  const pattern = new RegExp(mapping.subject_id_pattern);

  const carrierRel = opts.carrierRel ?? mapping.carrier;
  const carrierAbs = path.isAbsolute(carrierRel) ? carrierRel : path.join(root, carrierRel);
  const registeredSubjects = [...new Set(mapping.producers.flatMap((p) => p.subjects))].sort();

  if (!fs.existsSync(carrierAbs)) {
    return {
      evaluated: false,
      ok: true,
      observedSubjects: [],
      registeredSubjects,
      marginSubjects: null,
      findings: [],
      reason: `NOT-EVALUATED: carrier absent at ${path.relative(root, carrierAbs) || carrierAbs} — nothing to judge (distinct from PASS)`,
    };
  }

  const obs = observedSubjects(readJsonLines(carrierAbs), pattern, mapping.subject_requires_build_sha);

  const marginRel = opts.marginRel ?? mapping.margin_snapshot;
  const marginAbs = path.isAbsolute(marginRel) ? marginRel : path.join(root, marginRel);
  let marginSubjects: string[] | null = null;
  if (fs.existsSync(marginAbs)) {
    try {
      const snap = JSON.parse(fs.readFileSync(marginAbs, "utf8"));
      if (snap && typeof snap === "object" && snap.subjects && typeof snap.subjects === "object") {
        marginSubjects = Object.keys(snap.subjects).sort();
      }
    } catch {
      marginSubjects = null; // unreadable snapshot ⇒ its two directions are not judged (reported as null)
    }
  }

  const findings = judgeCoverage({ observedSubjects: obs, registeredSubjects, marginSubjects });
  const ok = findings.length === 0;
  const reason = ok
    ? `consistent — ${obs.length} observed subject(s), ${registeredSubjects.length} registered, ` +
      `margin snapshot ${marginSubjects === null ? "NOT-EVALUATED (unreadable/absent)" : `${marginSubjects.length} subject(s)`}`
    : `${findings.length} finding(s): ` + findings.map((f) => `${f.subject}[${f.kind}]`).join(", ");
  return { evaluated: true, ok, observedSubjects: obs, registeredSubjects, marginSubjects, findings, reason };
}

const USAGE = `usage: freshness-producer-coverage-check.ts [--root <dir>] [--mapping <rel>] [--carrier <rel>] [--margin <rel>] [--json]
Judges whether every carrier-observed freshness subject has a registered producer (AC7 of
tasks/gap-ac214-upgrade-face-refresh-and-mechanical-freshness-trigger).
Exit: 0 = judged+consistent (or carrier absent ⇒ evaluated:false); 1 = findings; 2 = mapping missing/corrupt.`;

function main(argv: string[]): number {
  let root = process.cwd();
  let mappingRel: string | undefined;
  let carrierRel: string | undefined;
  let marginRel: string | undefined;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") root = argv[++i] ?? root;
    else if (a.startsWith("--root=")) root = a.slice("--root=".length);
    else if (a === "--mapping") mappingRel = argv[++i];
    else if (a.startsWith("--mapping=")) mappingRel = a.slice("--mapping=".length);
    else if (a === "--carrier") carrierRel = argv[++i];
    else if (a.startsWith("--carrier=")) carrierRel = a.slice("--carrier=".length);
    else if (a === "--margin") marginRel = argv[++i];
    else if (a.startsWith("--margin=")) marginRel = a.slice("--margin=".length);
    else if (a === "--json") json = true;
    else if (a === "-h" || a === "--help") helpExit(USAGE);
    else return helpExit(`unknown argument: ${a}\n${USAGE}`);
  }

  let report: CoverageReport;
  try {
    report = runCoverageCheck({ root, mappingRel, carrierRel, marginRel });
  } catch (e) {
    const msg = e instanceof CoverageMappingError ? e.message : String(e);
    if (json) process.stdout.write(JSON.stringify({ evaluated: false, ok: false, error: msg }, null, 2) + "\n");
    else process.stderr.write(`freshness-producer-coverage-check: USAGE/ENV ERROR — ${msg}\n`);
    return 2;
  }

  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else if (!report.evaluated) {
    // Printed on stdout as a NON-PASS line: the three states must be distinguishable by eye too.
    process.stdout.write(`freshness-producer-coverage-check: NOT-EVALUATED — ${report.reason}\n`);
  } else {
    process.stdout.write(`freshness-producer-coverage-check: ${report.ok ? "PASS" : "FAIL"} — ${report.reason}\n`);
    for (const f of report.findings) {
      process.stdout.write(`  - ${f.subject} [${f.kind}]: ${f.detail}\n`);
    }
  }
  return report.ok ? 0 : 1;
}

const invokedDirectly = (() => {
  try {
    return isDirectEntry(import.meta, undefined, "freshness-producer-coverage-check");
  } catch {
    return false;
  }
})();
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
