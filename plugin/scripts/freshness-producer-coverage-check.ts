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
import { spawnSync } from "node:child_process";
import { helpExit, isDirectEntry, readJsonLines } from "./gate-script-base.ts";

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

  // readJsonLines (gate-script-base.ts) skips a malformed line rather than failing: the carrier is
  // append-only across many producers, and one bad line must not blind the whole judgement. The
  // COUNT of parsed rows is not reported as "parsed" anywhere below, so no reader can mistake a
  // partially-read carrier for full coverage of it. The `existsSync` guard above is what keeps the
  // absent case NOT-EVALUATED (硬规则 3b) — the shared reader is deliberately fail-open (absent ⇒ []).
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

// ── delivery-face DISTANCE — the ONE counting rule for freshness ─────────────────────────────────
// (gap-ac214-ninth-crossing-freshness-clock-counts-fan-in-merges, 2026-09-25.)
//
// THE DEFECT THIS REPLACES. The AC-214 criterion measured "how old is this evidence" as
//   git rev-list --count <build_sha>..develop -- <delivery-face paths>
// With a pathspec, `rev-list` counts MERGE commits too — and this repo's fan-in topology makes
// "task branch merges develop into itself" (`Merge branch 'develop' into task/<X>`) a routine step
// of every landing. Such a merge re-imports content develop ALREADY had, whose own non-merge
// commits are counted separately, so the same change is counted twice. Measured on the production
// repo 2026-09-25 over `c80040ad..develop`: 203 total, of which 84 are merges; 71 of those 84 have a
// tree BYTE-IDENTICAL to the clean auto-merge of their two parents (zero independent content) and
// 82/84 are titled `Merge branch 'develop'`. ⇒ the criterion's clock ran ~1.7x faster than the
// delivery face, and the tested object could push that clock itself by merging develop more often
// (硬规则 4: a quantity the measured object can drive is not a measurement). The gap crossed for the
// ninth time because of it.
//
// THE RULE. A commit in the measured range counts iff it CHANGED THE DELIVERY-FACE CONTENT of the
// tip:
//   · every NON-MERGE commit in range that touches a delivery-face path (`--no-merges`);
//   · PLUS every merge commit in range that touches a delivery-face path whose own tree is NOT
//     byte-identical to the clean auto-merge of its parents. Such a merge either has no clean
//     auto-merge (both sides touched the same file ⇒ a human resolved a conflict; measured 13/84) or
//     has one that differs from the recorded tree (an "evil merge"; measured 0/84) — in both cases
//     it MAY carry content present in neither parent, so it is counted. The complement is dropped
//     because it PROVABLY carries nothing new.
// ⛔ NOT "merges never count": that assertion is not what makes the rule right. The per-merge
// positional judge — `git merge-tree --write-tree <M^1> <M^2>` compared byte-for-byte with `M^{tree}`
// — is. (A merge with ≠2 parents is counted: no two-parent auto-merge exists to compare against, so
// the conservative direction is taken.)
//
// THREE STATES (硬规则 3b) — a reader can always tell "measured" from "could not measure":
//   computed       — `distance` is an integer (0 is a LEGAL computed value: the evidence IS the tip)
//   empty-path-set — the mechanically derived path set is empty; every distance would be 0 (i.e.
//                    "everything is fresh"), the structurally-true reading this contract forbids
//   not-evaluated  — a git read failed, or `git merge-tree --write-tree` is unsupported
// The two non-computed states carry `distance: null` and exit 3 — NEVER 0, never a PASS shape.
//
// ONE IMPLEMENTATION, THREE CONSUMERS: the AC-214 criterion (goals/AC-214-*.md, via subprocess), the
// freshness-refresh probe (plugin/probes/freshness-refresh.md ③), and this file's tests. The argv
// prefix both callers use is declared ONCE in plugin/freshness-producers.json `.delivery_face.command`
// — ⛔ not copied into either caller's text.

export const DELIVERY_FACE_PACKAGE_JSON = "packages/quay/package.json";

/** Staging roots appended to the tarball's own `files` — same rule the AC-214 criterion derives. */
export const DELIVERY_FACE_EXTRA_ROOTS: readonly string[] = ["plugin", "packages/quay-native/src"];

/** How a merge commit is classified against its parents' clean auto-merge. */
export type MergeContribution = "bookkeeping" | "content";

export type DeliveryFaceState = "computed" | "empty-path-set" | "not-evaluated";

export interface DeliveryFaceDistanceReport {
  state: DeliveryFaceState;
  /** The rule's output. `null` iff state ≠ "computed" — ⛔ never conflated with 0. */
  distance: number | null;
  contentCommits: number | null;
  contentMerges: number | null;
  bookkeepingMerges: number | null;
  tip: string | null;
  paths: string[];
  reason: string;
}

/**
 * The delivery-face path set, mechanically derived from `packages/quay/package.json`'s `files`
 * (what the tarball actually ships), filtered to entries that exist, plus the two staging roots.
 * ⛔ Never a hand-written list — a maintained list is what missed driver-runtime.ts before.
 */
export function deriveDeliveryFacePaths(root: string): string[] {
  let files: unknown;
  try {
    files = (JSON.parse(fs.readFileSync(path.join(root, DELIVERY_FACE_PACKAGE_JSON), "utf8")) as { files?: unknown }).files;
  } catch {
    return [];
  }
  if (!Array.isArray(files)) return [];
  const out: string[] = [];
  for (const f of files) {
    if (typeof f !== "string") continue;
    const rel = path.posix.join("packages/quay", f);
    if (fs.existsSync(path.join(root, rel))) out.push(rel);
  }
  return out.concat([...DELIVERY_FACE_EXTRA_ROOTS]);
}

const HEX_RE = /^[0-9a-f]{40}$/;

/**
 * The pure classification of ONE merge: does it contribute independent delivery-face content?
 * `cleanAutoMergeTree` = the tree `git merge-tree --write-tree <M^1> <M^2>` produced, or `null` when
 * the parents do not merge cleanly (conflict / non-two-parent merge / unsupported git).
 * A merge whose tree equals the clean auto-merge carries NOTHING its parents did not already carry —
 * counting it is exactly the phantom the defect above was made of.
 */
export function classifyMergeContribution(input: {
  cleanAutoMergeTree: string | null;
  recordedTree: string;
}): MergeContribution {
  if (input.cleanAutoMergeTree === null) return "content";
  return input.cleanAutoMergeTree === input.recordedTree ? "bookkeeping" : "content";
}

/** The pure rule: distance = content commits + merges that carry independent content. */
export function deliveryFaceDistance(input: {
  contentCommits: number;
  merges: readonly { cleanAutoMergeTree: string | null; recordedTree: string }[];
}): { distance: number; contentMerges: number; bookkeepingMerges: number } {
  let contentMerges = 0;
  let bookkeepingMerges = 0;
  for (const m of input.merges) {
    if (classifyMergeContribution(m) === "content") contentMerges++;
    else bookkeepingMerges++;
  }
  return { distance: input.contentCommits + contentMerges, contentMerges, bookkeepingMerges };
}

function git(root: string, args: string[]): { code: number; stdout: string; stderr: string } {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", env: process.env });
  return { code: r.status ?? 127, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

export interface DeliveryFaceQuery {
  root: string;
  /** Lower bound: measure `<from>..<tip>`. Mutually exclusive with `since`. */
  from?: string;
  /** Trailing window (`git --since` spec) applied to `<tip>`. Mutually exclusive with `from`. */
  since?: string;
  /** The measured tip (default `develop`). */
  tip?: string;
  /** Override the mechanically derived path set (tests/controls only). */
  paths?: string[];
}

/**
 * Measure the delivery-face distance. Never throws: every unreadable input becomes a NON-computed
 * state with a reason, so a caller cannot mistake "could not measure" for "nothing is stale".
 */
export function measureDeliveryFaceDistance(q: DeliveryFaceQuery): DeliveryFaceDistanceReport {
  const root = path.resolve(q.root);
  const tip = q.tip ?? "develop";
  const paths = q.paths ?? deriveDeliveryFacePaths(root);
  const empty = (reason: string, state: DeliveryFaceState): DeliveryFaceDistanceReport => ({
    state,
    distance: null,
    contentCommits: null,
    contentMerges: null,
    bookkeepingMerges: null,
    tip: null,
    paths,
    reason,
  });

  if (paths.length === 0) {
    return empty(
      `delivery-face path set is EMPTY (derived from ${DELIVERY_FACE_PACKAGE_JSON} \`files\` + ` +
        `${DELIVERY_FACE_EXTRA_ROOTS.join(", ")}) — a distance over it is structurally 0 and would read as PASS`,
      "empty-path-set",
    );
  }
  const rangeArgs = q.from !== undefined ? [`${q.from}..${tip}`] : [tip];
  const label = q.from !== undefined ? `${q.from}..${tip}` : `${tip} --since=${q.since ?? ""}`;
  const sinceArgs = q.since !== undefined ? [`--since=${q.since}`] : [];

  const commits = git(root, ["rev-list", "--count", "--no-merges", ...sinceArgs, ...rangeArgs, "--", ...paths]);
  if (commits.code !== 0) {
    return empty(`git rev-list failed for ${label} (rc=${commits.code}): ${commits.stderr.trim()}`, "not-evaluated");
  }
  const contentCommits = Number.parseInt(commits.stdout.trim() || "0", 10);
  if (!Number.isFinite(contentCommits)) {
    return empty(`git rev-list printed a non-numeric count for ${label}: ${JSON.stringify(commits.stdout)}`, "not-evaluated");
  }

  const mergeList = git(root, ["rev-list", "--merges", ...sinceArgs, ...rangeArgs, "--", ...paths]);
  if (mergeList.code !== 0) {
    return empty(`git rev-list --merges failed for ${label} (rc=${mergeList.code}): ${mergeList.stderr.trim()}`, "not-evaluated");
  }

  const merges: { cleanAutoMergeTree: string | null; recordedTree: string }[] = [];
  for (const sha of mergeList.stdout.split("\n").map((s) => s.trim()).filter(Boolean)) {
    const rev = git(root, ["rev-parse", `${sha}^{tree}`]);
    const recordedTree = rev.stdout.trim();
    if (rev.code !== 0 || !HEX_RE.test(recordedTree)) {
      return empty(`git rev-parse ${sha}^{tree} failed (rc=${rev.code})`, "not-evaluated");
    }
    const parentsOut = git(root, ["rev-parse", `${sha}^@`]);
    const parents = parentsOut.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
    let cleanAutoMergeTree: string | null = null;
    if (parents.length === 2) {
      const auto = git(root, ["merge-tree", "--write-tree", parents[0], parents[1]]);
      if (auto.code === 0) {
        const t = auto.stdout.split("\n")[0]?.trim() ?? "";
        if (!HEX_RE.test(t)) {
          return empty(`git merge-tree --write-tree printed no tree for ${sha} (rc=0): ${JSON.stringify(auto.stdout.slice(0, 200))}`, "not-evaluated");
        }
        cleanAutoMergeTree = t;
      } else if (auto.code !== 1) {
        // rc=1 is the documented "conflict" exit (no clean auto-merge ⇒ counted). Anything else
        // (129 = usage, 127 = not found) means THIS git cannot judge merges at all — reporting it as
        // "every merge carries content" would be a silent over-count dressed as a measurement.
        return empty(
          `git merge-tree --write-tree unusable for ${sha} (rc=${auto.code}): ${auto.stderr.trim() || "unsupported invocation"}`,
          "not-evaluated",
        );
      }
    }
    merges.push({ cleanAutoMergeTree, recordedTree });
  }

  const { distance, contentMerges, bookkeepingMerges } = deliveryFaceDistance({ contentCommits, merges });
  return {
    state: "computed",
    distance,
    contentCommits,
    contentMerges,
    bookkeepingMerges,
    tip: git(root, ["rev-parse", tip]).stdout.trim() || null,
    paths,
    reason:
      `${distance} = ${contentCommits} non-merge commit(s) touching the delivery face + ` +
      `${contentMerges} merge(s) carrying independent content (${bookkeepingMerges} merge(s) proved ` +
      `content-free: tree identical to the parents' clean auto-merge) over ${label}`,
  };
}

const USAGE = `usage: freshness-producer-coverage-check.ts [--root <dir>] [--mapping <rel>] [--carrier <rel>] [--margin <rel>] [--json]
       freshness-producer-coverage-check.ts --delivery-face-distance [<from>] [--from <rev>] [--since <spec>] [--tip <ref>] [--root <dir>] [--json]
Judges whether every carrier-observed freshness subject has a registered producer (AC7 of
tasks/gap-ac214-upgrade-face-refresh-and-mechanical-freshness-trigger), and — with
--delivery-face-distance — measures the AC-214 freshness clock under the ONE counting rule shared by
that criterion and plugin/probes/freshness-refresh.md ③ (see the section comment above).
Exit (coverage mode): 0 = judged+consistent (or carrier absent ⇒ evaluated:false); 1 = findings; 2 = mapping missing/corrupt.
Exit (distance mode): 0 = state:"computed" (distance is an integer); 3 = state:"empty-path-set" | "not-evaluated" (distance is null); 2 = usage.`;

function main(argv: string[]): number {
  let root = process.cwd();
  let mappingRel: string | undefined;
  let carrierRel: string | undefined;
  let marginRel: string | undefined;
  let json = false;
  // ── delivery-face-distance mode (see the section comment above) ────────────────────────────────
  let distanceMode = false;
  let from: string | undefined;
  let since: string | undefined;
  let tip: string | undefined;
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
    else if (a === "--delivery-face-distance") distanceMode = true;
    else if (a === "--from") from = argv[++i];
    else if (a.startsWith("--from=")) from = a.slice("--from=".length);
    else if (a === "--since") since = argv[++i];
    else if (a.startsWith("--since=")) since = a.slice("--since=".length);
    else if (a === "--tip") tip = argv[++i];
    else if (a.startsWith("--tip=")) tip = a.slice("--tip=".length);
    else if (a === "-h" || a === "--help") helpExit(USAGE);
    else if (distanceMode && from === undefined && !a.startsWith("-")) from = a; // `--delivery-face-distance <rev>`
    else return helpExit(`unknown argument: ${a}\n${USAGE}`);
  }

  if (distanceMode) {
    if (from !== undefined && since !== undefined) {
      return helpExit(`--from and --since are mutually exclusive\n${USAGE}`);
    }
    const rep = measureDeliveryFaceDistance({ root, from, since, tip });
    if (json) {
      process.stdout.write(JSON.stringify(rep, null, 2) + "\n");
    } else if (rep.state === "computed") {
      process.stdout.write(
        `delivery-face-distance: state=computed distance=${rep.distance} over ${from !== undefined ? `${from}..${tip ?? "develop"}` : `${tip ?? "develop"} --since=${since}`} ` +
          `(content-commits=${rep.contentCommits} content-merges=${rep.contentMerges} bookkeeping-merges=${rep.bookkeepingMerges}, paths=${rep.paths.length})\n`,
      );
    } else {
      // Printed as a NON-computed line: the three states must be distinguishable by eye too.
      process.stdout.write(`delivery-face-distance: state=${rep.state} distance=null — ${rep.reason}\n`);
    }
    return rep.state === "computed" ? 0 : 3;
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
