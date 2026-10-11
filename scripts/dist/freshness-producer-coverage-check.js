import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/freshness-producer-coverage-check.ts
import fs2 from "node:fs";
import path2 from "node:path";
import { spawnSync } from "node:child_process";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
import fs from "node:fs";
import path from "node:path";
function helpExit(usage) {
  process.stdout.write(usage.endsWith("\n") ? usage : usage + "\n");
  process.exit(0);
}
function readJsonLines(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line);
      if (typeof v === "object" && v !== null && !Array.isArray(v)) rows.push(v);
    } catch {
    }
  }
  return rows;
}
function isDirectEntry(importMeta, argv1, expectedBase) {
  void importMeta;
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  return path.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/freshness-producer-coverage-check.ts
var DEFAULT_MAPPING_REL = "plugin/freshness-producers.json";
var BUILD_SHA_FIELD = "build_sha";
var BUILD_SHA_RE = /^[0-9a-f]{40}$/;
var CoverageMappingError = class extends Error {
};
function parseMapping(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    throw new CoverageMappingError(`mapping is not valid JSON: ${e.message}`);
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    throw new CoverageMappingError("mapping must be a JSON object");
  }
  const m = obj;
  for (const key of ["carrier", "margin_snapshot", "subject_id_pattern"]) {
    if (typeof m[key] !== "string" || !m[key].trim()) {
      throw new CoverageMappingError(`mapping.${key} must be a non-empty string`);
    }
  }
  if (typeof m.subject_requires_build_sha !== "boolean") {
    throw new CoverageMappingError("mapping.subject_requires_build_sha must be a boolean");
  }
  if (!Array.isArray(m.producers) || m.producers.length === 0) {
    throw new CoverageMappingError("mapping.producers must be a non-empty array");
  }
  const producers = [];
  for (const [i, raw] of m.producers.entries()) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new CoverageMappingError(`mapping.producers[${i}] must be an object`);
    }
    const p = raw;
    for (const key of ["id", "command"]) {
      if (typeof p[key] !== "string" || !p[key].trim()) {
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
      id: p.id,
      command: p.command,
      wallclock_hours: p.wallclock_hours,
      subjects: p.subjects
    });
  }
  return {
    carrier: m.carrier,
    margin_snapshot: m.margin_snapshot,
    subject_id_pattern: m.subject_id_pattern,
    subject_requires_build_sha: m.subject_requires_build_sha,
    producers
  };
}
function observedSubjects(records, pattern, requireBuildSha) {
  const seen = [];
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
function judgeCoverage(input) {
  const { observedSubjects: obs, registeredSubjects: reg, marginSubjects: margin } = input;
  const findings = [];
  const has = (xs, v) => xs.includes(v);
  for (const s of obs) {
    if (!has(reg, s)) {
      findings.push({
        kind: "unregistered",
        subject: s,
        detail: "appears in the carrier with a build_sha, but no producer in the mapping declares it"
      });
    }
  }
  for (const s of reg) {
    if (!has(obs, s)) {
      findings.push({
        kind: "no_carrier_evidence",
        subject: s,
        detail: "registered to a producer, but the carrier holds no scoped record for it"
      });
    }
  }
  if (margin !== null) {
    for (const s of margin) {
      if (!has(reg, s)) {
        findings.push({
          kind: "margin_unregistered",
          subject: s,
          detail: "the AC-214 criterion tracks this subject, but no producer in the mapping declares it"
        });
      }
    }
    for (const s of reg) {
      if (!has(margin, s)) {
        findings.push({
          kind: "margin_orphan",
          subject: s,
          detail: "registered to a producer, but the AC-214 criterion does not track it"
        });
      }
    }
  }
  return findings;
}
function runCoverageCheck(opts) {
  const root = path2.resolve(opts.root);
  const mappingRel = opts.mappingRel ?? DEFAULT_MAPPING_REL;
  const mappingAbs = path2.isAbsolute(mappingRel) ? mappingRel : path2.join(root, mappingRel);
  if (!fs2.existsSync(mappingAbs)) {
    throw new CoverageMappingError(`mapping not found at ${mappingAbs}`);
  }
  const mapping = parseMapping(fs2.readFileSync(mappingAbs, "utf8"));
  const pattern = new RegExp(mapping.subject_id_pattern);
  const carrierRel = opts.carrierRel ?? mapping.carrier;
  const carrierAbs = path2.isAbsolute(carrierRel) ? carrierRel : path2.join(root, carrierRel);
  const registeredSubjects = [...new Set(mapping.producers.flatMap((p) => p.subjects))].sort();
  if (!fs2.existsSync(carrierAbs)) {
    return {
      evaluated: false,
      ok: true,
      observedSubjects: [],
      registeredSubjects,
      marginSubjects: null,
      findings: [],
      reason: `NOT-EVALUATED: carrier absent at ${path2.relative(root, carrierAbs) || carrierAbs} \u2014 nothing to judge (distinct from PASS)`
    };
  }
  const obs = observedSubjects(readJsonLines(carrierAbs), pattern, mapping.subject_requires_build_sha);
  const marginRel = opts.marginRel ?? mapping.margin_snapshot;
  const marginAbs = path2.isAbsolute(marginRel) ? marginRel : path2.join(root, marginRel);
  let marginSubjects = null;
  if (fs2.existsSync(marginAbs)) {
    try {
      const snap = JSON.parse(fs2.readFileSync(marginAbs, "utf8"));
      if (snap && typeof snap === "object" && snap.subjects && typeof snap.subjects === "object") {
        marginSubjects = Object.keys(snap.subjects).sort();
      }
    } catch {
      marginSubjects = null;
    }
  }
  const findings = judgeCoverage({ observedSubjects: obs, registeredSubjects, marginSubjects });
  const ok = findings.length === 0;
  const reason = ok ? `consistent \u2014 ${obs.length} observed subject(s), ${registeredSubjects.length} registered, margin snapshot ${marginSubjects === null ? "NOT-EVALUATED (unreadable/absent)" : `${marginSubjects.length} subject(s)`}` : `${findings.length} finding(s): ` + findings.map((f) => `${f.subject}[${f.kind}]`).join(", ");
  return { evaluated: true, ok, observedSubjects: obs, registeredSubjects, marginSubjects, findings, reason };
}
var DELIVERY_FACE_PACKAGE_JSON = "packages/quay/package.json";
var DELIVERY_FACE_EXTRA_ROOTS = ["plugin", "packages/quay-native/src"];
function deriveDeliveryFacePaths(root) {
  let files;
  try {
    files = JSON.parse(fs2.readFileSync(path2.join(root, DELIVERY_FACE_PACKAGE_JSON), "utf8")).files;
  } catch {
    return [];
  }
  if (!Array.isArray(files)) return [];
  const out = [];
  for (const f of files) {
    if (typeof f !== "string") continue;
    const rel = path2.posix.join("packages/quay", f);
    if (fs2.existsSync(path2.join(root, rel))) out.push(rel);
  }
  return out.concat([...DELIVERY_FACE_EXTRA_ROOTS]);
}
var HEX_RE = /^[0-9a-f]{40}$/;
function classifyMergeContribution(input) {
  if (input.cleanAutoMergeTree === null) return "content";
  return input.cleanAutoMergeTree === input.recordedTree ? "bookkeeping" : "content";
}
function deliveryFaceDistance(input) {
  let contentMerges = 0;
  let bookkeepingMerges = 0;
  for (const m of input.merges) {
    if (classifyMergeContribution(m) === "content") contentMerges++;
    else bookkeepingMerges++;
  }
  return { distance: input.contentCommits + contentMerges, contentMerges, bookkeepingMerges };
}
function git(root, args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", env: process.env });
  return { code: r.status ?? 127, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}
function measureDeliveryFaceDistance(q) {
  const root = path2.resolve(q.root);
  const tip = q.tip ?? "develop";
  const paths = q.paths ?? deriveDeliveryFacePaths(root);
  const empty = (reason, state) => ({
    state,
    distance: null,
    contentCommits: null,
    contentMerges: null,
    bookkeepingMerges: null,
    tip: null,
    paths,
    reason
  });
  if (paths.length === 0) {
    return empty(
      `delivery-face path set is EMPTY (derived from ${DELIVERY_FACE_PACKAGE_JSON} \`files\` + ${DELIVERY_FACE_EXTRA_ROOTS.join(", ")}) \u2014 a distance over it is structurally 0 and would read as PASS`,
      "empty-path-set"
    );
  }
  const rangeArgs = q.from !== void 0 ? [`${q.from}..${tip}`] : [tip];
  const label = q.from !== void 0 ? `${q.from}..${tip}` : `${tip} --since=${q.since ?? ""}`;
  const sinceArgs = q.since !== void 0 ? [`--since=${q.since}`] : [];
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
  const merges = [];
  for (const sha of mergeList.stdout.split("\n").map((s) => s.trim()).filter(Boolean)) {
    const rev = git(root, ["rev-parse", `${sha}^{tree}`]);
    const recordedTree = rev.stdout.trim();
    if (rev.code !== 0 || !HEX_RE.test(recordedTree)) {
      return empty(`git rev-parse ${sha}^{tree} failed (rc=${rev.code})`, "not-evaluated");
    }
    const parentsOut = git(root, ["rev-parse", `${sha}^@`]);
    const parents = parentsOut.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
    let cleanAutoMergeTree = null;
    if (parents.length === 2) {
      const auto = git(root, ["merge-tree", "--write-tree", parents[0], parents[1]]);
      if (auto.code === 0) {
        const t = auto.stdout.split("\n")[0]?.trim() ?? "";
        if (!HEX_RE.test(t)) {
          return empty(`git merge-tree --write-tree printed no tree for ${sha} (rc=0): ${JSON.stringify(auto.stdout.slice(0, 200))}`, "not-evaluated");
        }
        cleanAutoMergeTree = t;
      } else if (auto.code !== 1) {
        return empty(
          `git merge-tree --write-tree unusable for ${sha} (rc=${auto.code}): ${auto.stderr.trim() || "unsupported invocation"}`,
          "not-evaluated"
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
    reason: `${distance} = ${contentCommits} non-merge commit(s) touching the delivery face + ${contentMerges} merge(s) carrying independent content (${bookkeepingMerges} merge(s) proved content-free: tree identical to the parents' clean auto-merge) over ${label}`
  };
}
var USAGE = `usage: freshness-producer-coverage-check.ts [--root <dir>] [--mapping <rel>] [--carrier <rel>] [--margin <rel>] [--json]
       freshness-producer-coverage-check.ts --delivery-face-distance [<from>] [--from <rev>] [--since <spec>] [--tip <ref>] [--root <dir>] [--json]
Judges whether every carrier-observed freshness subject has a registered producer (AC7 of
tasks/gap-ac214-upgrade-face-refresh-and-mechanical-freshness-trigger), and \u2014 with
--delivery-face-distance \u2014 measures the AC-214 freshness clock under the ONE counting rule shared by
that criterion and plugin/probes/freshness-refresh.md \u2462 (see the section comment above).
Exit (coverage mode): 0 = judged+consistent (or carrier absent \u21D2 evaluated:false); 1 = findings; 2 = mapping missing/corrupt.
Exit (distance mode): 0 = state:"computed" (distance is an integer); 3 = state:"empty-path-set" | "not-evaluated" (distance is null); 2 = usage.`;
function main(argv) {
  let root = process.cwd();
  let mappingRel;
  let carrierRel;
  let marginRel;
  let json = false;
  let distanceMode = false;
  let from;
  let since;
  let tip;
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
    else if (distanceMode && from === void 0 && !a.startsWith("-")) from = a;
    else return helpExit(`unknown argument: ${a}
${USAGE}`);
  }
  if (distanceMode) {
    if (from !== void 0 && since !== void 0) {
      return helpExit(`--from and --since are mutually exclusive
${USAGE}`);
    }
    const rep = measureDeliveryFaceDistance({ root, from, since, tip });
    if (json) {
      process.stdout.write(JSON.stringify(rep, null, 2) + "\n");
    } else if (rep.state === "computed") {
      process.stdout.write(
        `delivery-face-distance: state=computed distance=${rep.distance} over ${from !== void 0 ? `${from}..${tip ?? "develop"}` : `${tip ?? "develop"} --since=${since}`} (content-commits=${rep.contentCommits} content-merges=${rep.contentMerges} bookkeeping-merges=${rep.bookkeepingMerges}, paths=${rep.paths.length})
`
      );
    } else {
      process.stdout.write(`delivery-face-distance: state=${rep.state} distance=null \u2014 ${rep.reason}
`);
    }
    return rep.state === "computed" ? 0 : 3;
  }
  let report;
  try {
    report = runCoverageCheck({ root, mappingRel, carrierRel, marginRel });
  } catch (e) {
    const msg = e instanceof CoverageMappingError ? e.message : String(e);
    if (json) process.stdout.write(JSON.stringify({ evaluated: false, ok: false, error: msg }, null, 2) + "\n");
    else process.stderr.write(`freshness-producer-coverage-check: USAGE/ENV ERROR \u2014 ${msg}
`);
    return 2;
  }
  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else if (!report.evaluated) {
    process.stdout.write(`freshness-producer-coverage-check: NOT-EVALUATED \u2014 ${report.reason}
`);
  } else {
    process.stdout.write(`freshness-producer-coverage-check: ${report.ok ? "PASS" : "FAIL"} \u2014 ${report.reason}
`);
    for (const f of report.findings) {
      process.stdout.write(`  - ${f.subject} [${f.kind}]: ${f.detail}
`);
    }
  }
  return report.ok ? 0 : 1;
}
var invokedDirectly = (() => {
  try {
    return isDirectEntry(import.meta, void 0, "freshness-producer-coverage-check");
  } catch {
    return false;
  }
})();
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
export {
  BUILD_SHA_FIELD,
  CoverageMappingError,
  DEFAULT_MAPPING_REL,
  DELIVERY_FACE_EXTRA_ROOTS,
  DELIVERY_FACE_PACKAGE_JSON,
  classifyMergeContribution,
  deliveryFaceDistance,
  deriveDeliveryFacePaths,
  judgeCoverage,
  measureDeliveryFaceDistance,
  observedSubjects,
  parseMapping,
  runCoverageCheck
};
