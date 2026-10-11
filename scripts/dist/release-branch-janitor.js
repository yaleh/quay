#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/release-branch-janitor.ts
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { spawnSync as spawnSync2 } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
import path from "node:path";
function isDirectEntry(importMeta, argv1, expectedBase) {
  void importMeta;
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  return path.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/git-runner.ts
import { spawnSync } from "node:child_process";
function git(cwd, args) {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}
function nonEmptyLines(s) {
  return s.split("\n").map((x) => x.trim()).filter((x) => x.length > 0);
}
function revParseSha(root, revision) {
  const r = git(root, ["rev-parse", "--verify", "--quiet", revision]);
  if (r.status !== 0) return null;
  const sha = r.stdout.trim();
  return sha.length > 0 ? sha : null;
}
function enumerateReleaseRefs(root) {
  const r = git(root, [
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads/release-*",
    "refs/heads/release/*"
  ]);
  if (r.status !== 0) return null;
  return nonEmptyLines(r.stdout).sort();
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/release-branch-janitor.ts
var JANITOR_RECORD_KEYS = [
  "ts",
  "scope",
  "branch",
  "sha",
  "disposition",
  "license",
  "carrier_exit",
  "exit"
];
var JANITOR_DISPOSITIONS = [
  "parked-compliant",
  "finished-via-carrier",
  "finish-failed",
  "left-alone-no-license"
];
var JANITOR_PASS_DISPOSITIONS = [
  "pass-clean",
  "pass-finished",
  "pass-left-alone-no-license",
  "pass-finish-failed"
];
var JANITOR_LICENSE_KINDS = ["tag", "merged-into", "no-license", "not-applicable"];
var JANITOR_TRACE_REL = ".quay/release-branch-janitor.jsonl";
var JANITOR_CARRIER_REL = "plugin/scripts/release-branch-finish.sh";
var OUTCOME_PARKED_COMPLIANT = 0;
var OUTCOME_FINISHED = 10;
var OUTCOME_FINISH_FAILED = 11;
var OUTCOME_LEFT_ALONE = 13;
function tagsPointingAt(root, branch) {
  const r = git(root, ["tag", "--points-at", `refs/heads/${branch}`]);
  if (r.status !== 0) return null;
  return nonEmptyLines(r.stdout);
}
function tagsContaining(root, branch) {
  const r = git(root, ["tag", "--contains", `refs/heads/${branch}`]);
  if (r.status !== 0) return null;
  return nonEmptyLines(r.stdout);
}
function countAhead(root, base, branch) {
  const r = git(root, ["rev-list", "--count", `${base}..refs/heads/${branch}`]);
  if (r.status !== 0) return null;
  const n = Number(r.stdout.trim());
  return Number.isFinite(n) ? n : null;
}
function resolveBase(root, explicit) {
  const candidates = explicit !== "" ? [explicit] : ["develop", "origin/develop"];
  for (const c of candidates) {
    if (revParseSha(root, `${c}^{commit}`) !== null) return c;
  }
  return null;
}
function runReleaseBranchJanitor(root, opts = {}) {
  const dryRun = opts.dryRun === true;
  const empty = (verdict2, exit2, cause) => ({
    evaluated: cause === null,
    verdict: verdict2,
    exit: exit2,
    cause,
    branchCount: 0,
    decisions: [],
    redBranches: [],
    carrierCalls: []
  });
  const branches = enumerateReleaseRefs(root);
  if (branches === null) {
    return empty(
      "instrument-failure",
      2,
      `CAUSE=release-branch-janitor-enumeration-failed \u2014 could not enumerate refs/heads/release-* in '${root}' (not a git repo, or git unavailable) => the branch set this pass judges could not be enumerated; "could not look" is \u26D4 not "none there" (hard rule 3b)`
    );
  }
  const base = resolveBase(root, opts.base ?? "");
  if (base === null) {
    return empty(
      "instrument-failure",
      2,
      `CAUSE=release-branch-janitor-base-unresolvable \u2014 neither 'develop' nor 'origin/develop' resolves in '${root}', so the "merged back?" licence cannot be answered; refusing to classify anything (an unanswerable check must not read as "merged")`
    );
  }
  const carrierPath = opts.carrierPath ?? join(root, JANITOR_CARRIER_REL);
  const decisions = [];
  const carrierCalls = [];
  for (const branch of branches) {
    const sha = revParseSha(root, `refs/heads/${branch}`) ?? "";
    const pointed = tagsPointingAt(root, branch);
    if (pointed === null) {
      return empty(
        "instrument-failure",
        2,
        `CAUSE=release-branch-janitor-tag-scan-failed \u2014 could not enumerate tags at '${branch}' in '${root}': 'could not look' must not be read as 'no tag holds it' (hard rule 3b)`
      );
    }
    if (pointed.length > 0) {
      decisions.push({
        branch,
        sha,
        disposition: "parked-compliant",
        license: `tag:${pointed[0]}`,
        carrierExit: null,
        exit: OUTCOME_PARKED_COMPLIANT
      });
      continue;
    }
    const containing = tagsContaining(root, branch);
    if (containing === null) {
      return empty(
        "instrument-failure",
        2,
        `CAUSE=release-branch-janitor-tag-scan-failed \u2014 could not enumerate tags containing '${branch}' in '${root}': 'could not look' must not be read as 'no tag holds it' (hard rule 3b)`
      );
    }
    let license = "no-license";
    if (containing.length > 0) {
      license = `tag:${containing[0]}`;
    } else {
      const ahead = countAhead(root, base, branch);
      if (ahead === null) {
        return empty(
          "instrument-failure",
          2,
          `CAUSE=release-branch-janitor-merge-check-failed \u2014 could not count ${base}..${branch} in '${root}'; an unanswerable check must not read as 'merged' (hard rule 3b)`
        );
      }
      if (ahead === 0) license = `merged-into:${base}`;
    }
    if (license === "no-license") {
      decisions.push({
        branch,
        sha,
        disposition: "left-alone-no-license",
        license: "no-license",
        carrierExit: null,
        exit: OUTCOME_LEFT_ALONE
      });
      continue;
    }
    if (dryRun) {
      decisions.push({
        branch,
        sha,
        disposition: "finished-via-carrier",
        license,
        carrierExit: null,
        exit: OUTCOME_FINISHED
      });
      continue;
    }
    const r = spawnSync2("bash", [carrierPath, branch, "--root", root, "--no-remote"], {
      encoding: "utf8"
    });
    const carrierExit = r.status ?? -1;
    carrierCalls.push({
      branch,
      exit: carrierExit,
      stdout: (r.stdout ?? "").trim(),
      stderr: (r.stderr ?? "").trim()
    });
    decisions.push({
      branch,
      sha,
      disposition: carrierExit === 0 ? "finished-via-carrier" : "finish-failed",
      license,
      carrierExit,
      exit: carrierExit === 0 ? OUTCOME_FINISHED : OUTCOME_FINISH_FAILED
    });
  }
  const leftAlone = decisions.filter((d) => d.disposition === "left-alone-no-license");
  const finishFailed = decisions.filter((d) => d.disposition === "finish-failed");
  const finished = decisions.filter((d) => d.disposition === "finished-via-carrier");
  let verdict = "clean";
  let exit = 0;
  if (finishFailed.length > 0) {
    verdict = "finish-failed";
    exit = 1;
  } else if (leftAlone.length > 0) {
    verdict = "left-alone-no-license";
    exit = 3;
  } else if (finished.length > 0) {
    verdict = "finished";
    exit = 0;
  }
  return {
    evaluated: true,
    verdict,
    exit,
    cause: null,
    branchCount: branches.length,
    decisions,
    redBranches: decisions.filter((d) => d.disposition !== "parked-compliant").map((d) => d.branch),
    carrierCalls
  };
}
function jsonEscape(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
function traceAppend(file, line) {
  try {
    mkdirSync(dirname(file), { recursive: true });
  } catch (e) {
    return { ok: false, error: `could not create ${dirname(file)}: ${e?.message ?? String(e)}` };
  }
  const body = `{"ts":"${jsonEscape(line.ts)}","scope":"${jsonEscape(line.scope)}","branch":"${jsonEscape(line.branch)}","sha":"${jsonEscape(line.sha)}","disposition":"${jsonEscape(line.disposition)}","license":"${jsonEscape(line.license)}","carrier_exit":${line.carrier_exit === null ? "null" : line.carrier_exit},"exit":${line.exit}}`;
  try {
    appendFileSync(file, `${body}
`, "utf8");
  } catch (e) {
    return { ok: false, error: `could not append to ${file}: ${e?.message ?? String(e)}` };
  }
  return { ok: true };
}
function passDispositionOf(verdict) {
  switch (verdict) {
    case "clean":
      return "pass-clean";
    case "finished":
      return "pass-finished";
    case "left-alone-no-license":
      return "pass-left-alone-no-license";
    case "finish-failed":
      return "pass-finish-failed";
    default:
      return "pass-clean";
  }
}
function logMode(traceFile) {
  if (!existsSync(traceFile)) {
    process.stderr.write(
      `CAUSE=release-branch-janitor-trace-missing \u2014 no janitor record at '${traceFile}': the janitor has never recorded a pass here. This is "never happened" \u2014 \u26D4 NOT the same as "ran and there was nothing to handle" (hard rule 3b/9)
`
    );
    return 4;
  }
  let text;
  try {
    if (!statSync(traceFile).isFile()) throw new Error("not a regular file");
    text = readFileSync(traceFile, "utf8");
  } catch (e) {
    process.stderr.write(
      `CAUSE=release-branch-janitor-trace-unreadable \u2014 '${traceFile}' exists but cannot be read (${e?.message ?? String(e)}); refusing to report "nothing was handled" for a record that could not be looked at (hard rule 3b)
`
    );
    return 5;
  }
  const rows = nonEmptyLines(text);
  for (const raw of rows) {
    let rec = null;
    try {
      rec = JSON.parse(raw);
    } catch {
      process.stdout.write(`  <unparseable record line: ${raw.slice(0, 120)}>
`);
      continue;
    }
    process.stdout.write(
      `${rec.ts ?? "-"}  ${rec.branch || (rec.scope === "pass" ? "(pass)" : "-")}  scope=${rec.scope ?? "-"}  disposition=${rec.disposition ?? "-"}  license=${rec.license ?? "-"}  sha=${String(rec.sha ?? "-").slice(0, 12)}  carrier_exit=${rec.carrier_exit ?? "-"}  exit=${rec.exit ?? "-"}
`
    );
  }
  process.stdout.write(`trace: ${rows.length} record(s) in ${traceFile}
`);
  return 0;
}
var usage = "usage: node --experimental-strip-types plugin/scripts/release-branch-janitor.ts [--root <repo>] [--base <ref>] [--trace <file>] [--json] [--dry-run]\n       node --experimental-strip-types plugin/scripts/release-branch-janitor.ts --log [--trace <file>] [--root <repo>]";
function main(argv) {
  const selfDir = dirname(fileURLToPath(import.meta.url));
  let root = join(selfDir, "..", "..");
  let base = "";
  let traceFile = "";
  let jsonMode = false;
  let dryRun = false;
  let log = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") root = argv[++i] ?? "";
    else if (a === "--base") base = argv[++i] ?? "";
    else if (a === "--trace") traceFile = argv[++i] ?? "";
    else if (a === "--json") jsonMode = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--log") log = true;
    else if (a === "--vocabulary-json") {
      process.stdout.write(
        `${JSON.stringify({
          keys: JANITOR_RECORD_KEYS,
          dispositions: JANITOR_DISPOSITIONS,
          passDispositions: JANITOR_PASS_DISPOSITIONS,
          licenseKinds: JANITOR_LICENSE_KINDS
        })}
`
      );
      return 0;
    } else if (a === "-h" || a === "--help") {
      process.stdout.write(`${usage}
`);
      return 0;
    } else {
      process.stderr.write(`release-branch-janitor: unknown arg: ${a}
${usage}
`);
      return 2;
    }
  }
  if (traceFile === "") traceFile = join(root, JANITOR_TRACE_REL);
  if (log) return logMode(traceFile);
  const result = runReleaseBranchJanitor(root, { base, dryRun });
  let recorded = true;
  let recordError = null;
  if (result.evaluated && !dryRun) {
    for (const d of result.decisions) {
      const r = traceAppend(traceFile, {
        ts: (/* @__PURE__ */ new Date()).toISOString(),
        scope: "branch",
        branch: d.branch,
        sha: d.sha,
        disposition: d.disposition,
        license: d.license,
        carrier_exit: d.carrierExit,
        exit: d.exit
      });
      if (!r.ok) {
        recorded = false;
        recordError = r.error ?? "unknown";
        break;
      }
    }
    if (recorded) {
      const r = traceAppend(traceFile, {
        ts: (/* @__PURE__ */ new Date()).toISOString(),
        scope: "pass",
        branch: "",
        sha: "",
        disposition: passDispositionOf(result.verdict),
        license: "not-applicable",
        carrier_exit: null,
        exit: result.exit
      });
      if (!r.ok) {
        recorded = false;
        recordError = r.error ?? "unknown";
      }
    }
  }
  if (jsonMode) {
    process.stdout.write(
      `${JSON.stringify({
        evaluated: result.evaluated,
        verdict: result.verdict,
        exit: result.exit,
        cause: result.cause,
        dryRun,
        branchCount: result.branchCount,
        decisions: result.decisions,
        redBranches: result.redBranches,
        carrierCalls: result.carrierCalls,
        trace: traceFile,
        recorded,
        traceError: recordError
      })}
`
    );
  } else if (result.evaluated) {
    process.stdout.write(
      `release-branch-janitor: enumerated ${result.branchCount} release branch(es) via the SAME enumeration AC-271 makes (refs/heads/release-* + refs/heads/release/*)
`
    );
    for (const d of result.decisions) {
      process.stdout.write(
        `release-branch-janitor:   ${d.branch}  disposition=${d.disposition}  license=${d.license}  carrier_exit=${d.carrierExit ?? "-"}  exit=${d.exit}
`
      );
    }
    if (result.decisions.length === 0) {
      process.stdout.write("release-branch-janitor: nothing to handle (enumeration empty)\n");
    }
    process.stdout.write(
      `release-branch-janitor: verdict=${result.verdict} exit=${result.exit}${dryRun ? " (--dry-run: nothing was mutated or recorded)" : ` \u2192 ${traceFile}`}
`
    );
  }
  if (!result.evaluated) {
    process.stderr.write(`${result.cause}
`);
  } else {
    for (const d of result.decisions) {
      if (d.disposition === "left-alone-no-license") {
        process.stderr.write(
          `CAUSE=release-branch-janitor-left-alone-no-license \u2014 '${d.branch}' is red and holds NO licence to delete (its tip is in no tag, and it is not merged back): deleting it would lose work. LEFT IN PLACE \u2014 AC-271 must still fail on it
`
        );
      } else if (d.disposition === "finish-failed") {
        process.stderr.write(
          `CAUSE=release-branch-janitor-finish-failed \u2014 the carrier refused/failed for '${d.branch}' (exit ${d.carrierExit}); the branch is still present
`
        );
      }
    }
  }
  if (!recorded) {
    process.stderr.write(
      `CAUSE=release-branch-janitor-trace-write-failed \u2014 the pass above ran, but it left no record in '${traceFile}' (hard rule 9)
`
    );
    return 2;
  }
  return result.exit;
}
var isDirect = isDirectEntry(import.meta, process.argv[1], "release-branch-janitor");
if (isDirect) process.exit(main(process.argv.slice(2)));
export {
  JANITOR_CARRIER_REL,
  JANITOR_DISPOSITIONS,
  JANITOR_LICENSE_KINDS,
  JANITOR_PASS_DISPOSITIONS,
  JANITOR_RECORD_KEYS,
  JANITOR_TRACE_REL,
  passDispositionOf,
  runReleaseBranchJanitor,
  traceAppend
};
