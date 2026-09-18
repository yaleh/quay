// claim-task.ts — the two-machine git-branch claiming protocol's PURE decision half
// (gap-two-machine-collaboration-git-branch-claiming, AC1/AC2/AC4).
//
// Two machines (A and B) execute tasks against a shared bare repo. The claim marker is a branch
// named `task/<id>` on the SHARED BARE REPO — the only truly cross-host state store: telemetry
// inProgress files and worktree directories are LOCAL to one machine (B cannot see A's), whereas
// `git ls-remote` on the shared repo shows both machines' `task/*` branches. Claiming = pushing an
// empty marker commit to `refs/heads/task/<id>`; the branch's EXISTENCE on the shared repo is the
// distributed mutual exclusion. This module is the DECISION half (pure, unit-tested); the git
// push/delete side effects live in claim-task.sh / release-task.sh.
//
// Three verdicts:
//   claimable        — `task/<id>` is not in-flight AND the candidate's `## Touches` are disjoint
//                      from every in-flight peer's (AC2).
//   already-claimed  — `task/<id>` is already in-flight on the shared repo (either machine owns it).
//   touches-overlap  — the candidate's `## Touches` overlap an in-flight peer. AC2: reuse the
//                      single-source checkTouchesPair — the SAME constraint that serializes same-host
//                      overlapping tasks; the cross-host claim just enforces it EARLIER (at claim
//                      time), so two machines never start touching work that will collide at fan-in.
//
// The disjointness verdict is IMPORTED from touches-orthogonality-check.ts (ADR-004 single-source —
// NEVER a second copy). The expander is `expandDeclaredTouches` (the same declared-path expander the
// dispatch gate uses: a task creating NEW files is judged on declared intent, not the current
// filesystem). Peer task bodies are read from the LOCAL `tasks/<peer>.md` by id — both machines share
// the task board, so the declared `## Touches` are the same on either host.
//
// CLI (also invoked by claim-task.sh):
//   node --experimental-strip-types claim-task.ts --task tasks/<id>.md --root <repo>
//        [--in-flight <id1,id2,...>] [--json]
//   --in-flight: explicit peer task ids (the AC2 test seam; the bash wrapper passes the ids derived
//                from `git ls-remote --heads <remote> 'refs/heads/task/*'`).
//   stdout: `claimable` | `already-claimed` | `touches-overlap` (+ reason). Exit 0 iff claimable.
import fs from "node:fs";
import path from "node:path";
// getArgValue now lives in gate-script-base.ts as `flagValue` (it was one of the ~73 byte-identical
// copies of the indexOf+next-arg idiom in plugin/scripts; .quay/routine-findings.jsonl finding
// `arg-parsing-helper-family`, routine `semantic-dedup-scan`).
import { isDirectEntry, flagValue } from "./gate-script-base.ts";
import { parseTouches, checkTouchesPair } from "./touches-orthogonality-check.ts";
import { expandDeclaredTouches } from "./concurrent-batch-scheduler.ts";

/** Parse `git ls-remote --heads <remote>` output lines into {sha, ref} entries. */
export function parseLsRemoteHeads(text) {
  const out = [];
  for (const line of String(text).split("\n")) {
    const m = /^([0-9a-f]{40})\t(refs\/heads\/.+)$/.exec(line.trim());
    if (m) out.push({ sha: m[1], ref: m[2] });
  }
  return out;
}

/** Derive the in-flight task ids from `refs/heads/task/<id>` refs (deduplicated, sorted). */
export function deriveInFlightTaskIds(refs) {
  const ids = [];
  const seen = new Set();
  for (const r of refs) {
    const m = /^refs\/heads\/task\/([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(r.ref);
    if (m && !seen.has(m[1])) {
      seen.add(m[1]);
      ids.push(m[1]);
    }
  }
  return ids.sort();
}

/**
 * Decide whether the candidate task may be claimed, given the in-flight task set (derived from the
 * shared repo's `task/*` branches).
 *
 * @param {{hasSection: boolean, globs: string[]}} candidate — parseTouches(candidateBody)
 * @param {string} candidateId — the candidate's task id (basename of its tasks/<id>.md)
 * @param {Array<{id: string, parsed: {hasSection: boolean, globs: string[]}}>} peers — every
 *        in-flight peer task (parseTouches of each tasks/<peer>.md)
 * @param {(globs: string[]) => Set<string>} expand — declared-path expander (injected for
 *        testability; production passes `(globs) => expandDeclaredTouches(globs, root)`)
 * @returns {{claimable: boolean, code: "claimable"|"already-claimed"|"touches-overlap",
 *            reason: string, overlaps?: string[]}}
 */
export function decideClaim(candidate, candidateId, peers, expand) {
  if (peers.some((p) => p.id === candidateId)) {
    return {
      claimable: false,
      code: "already-claimed",
      reason: `task/${candidateId} is already in-flight on the shared repo (claim branch exists)`,
    };
  }
  for (const peer of peers) {
    const r = checkTouchesPair(candidate, peer.parsed, expand);
    if (!r.disjoint) {
      return {
        claimable: false,
        code: "touches-overlap",
        reason: `touches overlap in-flight task ${peer.id}: ${r.reason}`,
        overlaps: r.overlaps.length ? r.overlaps : undefined,
      };
    }
  }
  return { claimable: true, code: "claimable", reason: "disjoint from every in-flight task on the shared repo" };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────

function usage() {
  process.stderr.write(`claim-task.ts — two-machine git-branch claiming decision (AC1/AC2/AC4)

Usage:
  node --experimental-strip-types claim-task.ts --task <tasks/<id>.md> [--root <repo>]
       [--in-flight <id1,id2,...>] [--json]

  --task       candidate task file (required)
  --root       repo root (default: auto-detected from the task file)
  --in-flight  explicit comma-separated in-flight peer task ids (the AC2 seam)
  --json       emit the verdict object as JSON

stdout: one line — \`claimable\` | \`already-claimed\` | \`touches-overlap\` (+ reason).
Exit 0 iff claimable; 1 not claimable; 2 usage / missing file.
`);
}


/**
 * CLI main. @param {string[]} argv — process.argv @returns {number} exit code
 */
export function main(argv) {
  const args = argv.slice(2);
  const taskFile = flagValue(args, "--task");
  const rootArg = flagValue(args, "--root");
  const inFlightCsv = flagValue(args, "--in-flight");
  const json = args.includes("--json");

  if (!taskFile) {
    usage();
    return 2;
  }
  if (!fs.existsSync(taskFile)) {
    process.stderr.write(`claim-task: task file not found: ${taskFile}\n`);
    return 2;
  }

  const root = rootArg
    ? path.resolve(rootArg)
    : path.resolve(path.dirname(taskFile), "..");
  const expand = (globs) => expandDeclaredTouches(globs, root);
  const candidateId = path.basename(taskFile, ".md");
  const candidate = parseTouches(fs.readFileSync(taskFile, "utf8"));

  const peers = [];
  if (inFlightCsv) {
    for (const id of inFlightCsv.split(",").map((s) => s.trim()).filter(Boolean)) {
      const f = path.join(root, "tasks", `${id}.md`);
      if (!fs.existsSync(f)) {
        process.stderr.write(`claim-task: --in-flight task file not found: ${f}\n`);
        return 2;
      }
      peers.push({ id, parsed: parseTouches(fs.readFileSync(f, "utf8")) });
    }
  }

  const d = decideClaim(candidate, candidateId, peers, expand);
  if (json) {
    process.stdout.write(JSON.stringify(d) + "\n");
  } else {
    process.stdout.write(`${d.code}: ${d.reason}\n`);
  }
  return d.claimable ? 0 : 1;
}

if (isDirectEntry(import.meta, undefined, "claim-task")) {
  process.exitCode = main(process.argv);
}
