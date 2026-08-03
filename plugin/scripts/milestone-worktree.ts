// milestone-worktree.ts — DIR-123: the single-source per-milestone git-worktree isolation primitive
// for execute-milestone.js's Build/Audit/Gate/Land phases. Gives a milestone a REAL `git worktree`
// (created before Build, real edits/tests/commits happen there, Land does a real merge-back +
// cleanup) so two `execute-milestone` dispatches for FILE-DISJOINT tasks can run genuinely
// concurrently, with Land (not the whole pipeline) as the SOLE serialization point against the
// shared checkout.
//
// Shape mirrors prepare-admission-check.ts / milestone-preparation-check.ts: PURE decision functions
// (path/branch derivation, isolation-plan, land-lock decide) exported + unit-tested with NO git
// needed, and a thin CLI that performs REAL git operations (`git worktree add` / `git merge` /
// `git worktree remove` / `git branch -d`) via `execFileSync`. The workflow DSL has no `import`/`fs`/
// child-process capability of its own, so execute-milestone.js's dispatched agents invoke this CLI as
// a real shell command (the SAME dispatch shape prepare-admission-check.ts already uses) — the
// workflow threads the deterministic relative worktree path through Build→Audit→Gate→Land prompts and
// never re-derives it by hand (ADR-004 single-source; the workflow's inline copy is the same
// documented mirror pattern composite-args.ts uses).
//
// ISOLATION IS OPT-IN (DIR-123, same posture as DIR-117's Prepared phase): `computeIsolationPlan`
// returns `{isolated:false}` for every `isolationMode` other than the literal `'worktree'`, so an
// omitted/unknown mode is byte-for-behavior the pre-DIR-123 direct-on-shared-tree path (golden replay
// — proven by execute-milestone-worktree.test.mjs, never asserted). This module does NOT force a
// permanent default switch; that is a later, separately-earned decision once real concurrent
// dispatches have proven the mechanism on master.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseArgs, isDirectEntry } from "./gate-script-base.ts";

// ── parseMilestoneNum ────────────────────────────────────────────────────────────────────────────
// Extract the numeric milestone id from a charter-derived token ("M191", "191", "M191-some-slug",
// or a full charter path ".../M191-charter.md"). Returns null when no number is present — callers
// FAIL CLOSED on null (a worktree path cannot be derived without a real milestone number). Mirrors
// gate-script-lib.sh's gate_resolve_milestone_root stripping rules (leading "M", trailing "-slug").
export function parseMilestoneNum(id) {
  const m = String(id == null ? "" : id).match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

// ── milestoneRootRel ─────────────────────────────────────────────────────────────────────────────
// THE repo-relative milestone-evidence root for a numeric milestone. Re-implements (in pure TS, for
// unit-testing and for the workflow DSL which cannot source a .sh) the SAME ">= 130" boundary
// gate-script-lib.sh's gate_resolve_milestone_root owns: >= 130 → top-level `milestones/M<NN>`
// (current, M130+); < 130 → legacy `experiments/quay-perpetual-stream/milestones/M<NN>`. The two
// MUST agree; execute-milestone-worktree.test.mjs pins this against the shell function on a real
// repo so the TS mirror cannot silently drift from the shell single-source.
export function milestoneRootRel(num) {
  const n = Number(num);
  if (!Number.isFinite(n)) return null;
  return n >= 130 ? `milestones/M${n}` : `experiments/quay-perpetual-stream/milestones/M${n}`;
}

// ── worktreeRelPath / worktreeBranch ─────────────────────────────────────────────────────────────
// Deterministic, milestone-scoped (so two DIFFERENT milestones can never pick the same worktree path
// or branch — collision-resistant by construction; a same-milestone double-dispatch is a logic error
// the add step fails closed on, never a silent reuse). The worktree lives under the milestone's own
// evidence root so worktree-branch-hygiene-check.sh's existing orphan scan already covers it.
export function worktreeRelPath(num) {
  const root = milestoneRootRel(num);
  return root ? `${root}/worktrees/iteration-0` : null;
}
export function worktreeBranch(num) {
  const n = Number(num);
  return Number.isFinite(n) ? `milestone/M${n}/iteration-0` : null;
}

// ── computeIsolationPlan ─────────────────────────────────────────────────────────────────────────
// The pure opt-in decision the workflow reads BEFORE Build. `isolationMode: 'worktree'` + a numeric
// milestone → `{isolated:true, worktreeRel, branch}`; ANYTHING else (mode omitted, unknown mode, or a
// non-numeric milestone) → `{isolated:false}` (legacy direct-on-shared-tree, golden-replay path). A
// requested-but-underspecified isolation (`'worktree'` with no derivable milestone number) is a
// distinct FAIL-CLOSED verdict `{isolated:false, error:'worktree-needs-numeric-milestone'}` so the
// workflow can halt rather than silently fall back to the shared tree (which would defeat the point).
export function computeIsolationPlan({ milestone, isolationMode }) {
  if (isolationMode == null || isolationMode === "") return { isolated: false };
  if (isolationMode !== "worktree") return { isolated: false, error: `unknown-isolation-mode: ${isolationMode}` };
  const num = parseMilestoneNum(milestone);
  if (num == null) return { isolated: false, error: "worktree-needs-numeric-milestone" };
  return { isolated: true, milestoneNum: num, worktreeRel: worktreeRelPath(num), branch: worktreeBranch(num) };
}

// ── Real git operations (thin CLI layer) ─────────────────────────────────────────────────────────
// Each runs `git -C <workspace> ...` via execFileSync (the SAME real-git-via-subprocess approach
// prepare-admission-check.ts uses for `git rev-parse`/`git ls-files`). Fail-closed: any non-zero git
// exit is caught and returned as a typed `{outcome:'error'|'conflict', code, detail}` — NEVER thrown
// past the CLI boundary as a crash, NEVER a blanket success.

function _git(workspace, gitArgs) {
  return execFileSync("git", ["-C", workspace, ...gitArgs], { encoding: "utf8" }).toString().trim();
}
function _gitOk(workspace, gitArgs) {
  try {
    return { ok: true, out: _git(workspace, gitArgs) };
  } catch (err) {
    return { ok: false, out: (err.stderr || err.stdout || err.message || "").toString().trim() };
  }
}

// addWorktree — real `git worktree add <rel> -b <branch>`. Fail-closed guards: the worktree path must
// NOT already exist (never reuse a stale worktree — a same-milestone double-dispatch is a collision
// the caller must see, not absorb), and the branch must NOT already exist. Returns the ABSOLUTE
// worktree path (the workflow threads the RELATIVE path through prompts; agents report/resolve the
// absolute one against the repo root they all share).
export function addWorktree({ workspace, milestone }) {
  const num = parseMilestoneNum(milestone);
  const rel = worktreeRelPath(num);
  const branch = worktreeBranch(num);
  if (!rel || !branch) return { outcome: "error", code: "no-numeric-milestone", detail: `cannot derive worktree path from milestone=${milestone}` };
  const abs = path.resolve(workspace, rel);
  if (fs.existsSync(abs)) return { outcome: "error", code: "worktree-path-exists", detail: `refusing to reuse existing worktree path: ${rel}` };
  const branchProbe = _gitOk(workspace, ["rev-parse", "--verify", "--quiet", branch]);
  if (branchProbe.ok) return { outcome: "error", code: "branch-exists", detail: `refusing to create worktree on existing branch: ${branch}` };
  const add = _gitOk(workspace, ["worktree", "add", rel, "-b", branch]);
  if (!add.ok) return { outcome: "error", code: "git-worktree-add-failed", detail: add.out };
  return { outcome: "added", worktreeRel: rel, worktreeAbs: abs, branch };
}

// mergeWorktree — real merge of the worktree branch into the PRIMARY checkout (run from `workspace`,
// which is the shared checkout on master). `--no-ff` forces a real merge commit so the milestone's
// branch history is preserved and the merge is observable. On conflict git exits non-zero and leaves
// conflict markers; we detect that and return `{outcome:'conflict', files:[...]}` so the workflow can
// mark needs-human (DEFINED same-file-conflict handling at Land — never a blanket --ours/--theirs per
// DIR-013; resolution is a human/per-file decision, the pre-dispatch orthogonality check is the
// PRIMARY guard that should keep this path unreachable for genuinely-disjoint concurrent dispatches).
export function mergeWorktree({ workspace, milestone }) {
  const num = parseMilestoneNum(milestone);
  const branch = worktreeBranch(num);
  if (!branch) return { outcome: "error", code: "no-numeric-milestone", detail: `cannot derive branch from milestone=${milestone}` };
  const probe = _gitOk(workspace, ["rev-parse", "--verify", "--quiet", branch]);
  if (!probe.ok) return { outcome: "error", code: "branch-missing", detail: `worktree branch not found: ${branch}` };
  const merge = _gitOk(workspace, ["merge", "--no-ff", "-m", `DIR-123 worktree-isolated Land: merge ${branch}`, branch]);
  if (!merge.ok) {
    const conflicts = _gitOk(workspace, ["diff", "--name-only", "--diff-filter=U"]);
    const files = conflicts.ok ? conflicts.out.split("\n").filter(Boolean) : [];
    // Abort the half-applied merge so the shared checkout is left CLEAN for the human/next dispatch
    // (never leave master mid-merge — the exact corruption class worktree isolation exists to avoid).
    _gitOk(workspace, ["merge", "--abort"]);
    return { outcome: "conflict", branch, files, detail: merge.out };
  }
  const sha = _gitOk(workspace, ["rev-parse", "HEAD"]);
  return { outcome: "merged", branch, mergeCommit: sha.ok ? sha.out : null };
}

// removeWorktree — real `git worktree remove` + `git branch -d` of the now-merged branch. `--force`
// is NEVER used on the worktree remove (gap-reclaim-21-merged-worktrees-and-fix-my-bad-criterion,
// 2026-08-03): git's own "contains modified or untracked files" refusal is the LAST gate, so a worktree
// that somehow carries uncommitted/untracked work at Land fails closed (git-worktree-remove-failed) and
// a human reconciles — never an explicit bypass that destroys it. `-d` (not `-D`) on the branch refuses
// to delete an UNMERGED branch (a mechanical backstop: if the merge step was skipped, branch cleanup
// fails loudly rather than destroying unmerged work). Returns typed outcomes for each step.
export function removeWorktree({ workspace, milestone }) {
  const num = parseMilestoneNum(milestone);
  const rel = worktreeRelPath(num);
  const branch = worktreeBranch(num);
  if (!rel || !branch) return { outcome: "error", code: "no-numeric-milestone", detail: `cannot derive worktree path from milestone=${milestone}` };
  const rm = _gitOk(workspace, ["worktree", "remove", rel]);
  const del = _gitOk(workspace, ["branch", "-d", branch]);
  if (!rm.ok) return { outcome: "error", code: "git-worktree-remove-failed", detail: rm.out };
  if (!del.ok) return { outcome: "error", code: "git-branch-delete-failed", detail: del.out };
  return { outcome: "removed", worktreeRel: rel, branch };
}

// _mergeAddedFiles — for a branch that entered master via a --no-ff MERGE (its tip is NOT on master's
// first-parent chain), find that merge commit and compute the files IT added relative to its first
// parent — the branch's own contribution, exactly the set a `git revert` of the merge removes.
// Returns {missing:[...]}: the subset of those merge-added files that are ABSENT from master's CURRENT
// tree, i.e. the revert is still active (a later restore — M243's 3dfba2c6 — re-adds them, so missing
// becomes empty).
function _mergeAddedFiles(workspace, tip) {
  const revs = _gitOk(workspace, ["rev-list", "--parents", "master"]);
  if (!revs.ok) return { error: revs.out };
  let merge = null;
  for (const line of revs.out.split("\n")) {
    const parts = line.trim().split(/\s+/);
    // The milestone flow's Land merge is `git merge --no-ff <branch>` from master, which ALWAYS puts the
    // branch tip as the SECOND parent of the merge commit. A merge whose FIRST parent is the tip would be
    // a reverse-merge the flow never produces — matching only parts[2] makes the selection provably the
    // branch's own Land merge (adversarial review, 2026-08-03: parts[1] was the one theoretical wrong-
    // merge path; unreachable in practice, removed for provable correctness).
    if (parts.length >= 3 && parts[2] === tip) { merge = parts[0]; break; }
  }
  if (!merge) return { error: `no merge commit on master has branch tip ${tip} as a parent` };
  const added = _gitOk(workspace, ["diff", "--name-only", "--diff-filter=A", `${merge}^1..${merge}`]);
  if (!added.ok) return { error: added.out };
  const missing = [];
  for (const f of added.out.split("\n").filter(Boolean)) {
    if (!_gitOk(workspace, ["cat-file", "-e", `master:${f}`]).ok) missing.push(f);
  }
  return { missing };
}

// ── cleanStaleWorktree — idempotent recovery from a crashed dispatch (DIR-123 review, Obstacle 3). ─
// A dispatch that dies AFTER worktree-create but BEFORE Land's --remove strands
// `milestones/M<NN>/worktrees/iteration-0` + branch `milestone/M<NN>/iteration-0`. A retry of the SAME
// milestone would then fail closed at --add (worktree-path-exists) FOREVER, because nothing auto-cleans
// (worktree-branch-hygiene-check.sh detects but does not remove). This is SAFE to clean automatically
// because the path/branch are milestone-scoped, so a stranded same-milestone worktree can only ever be
// the prior crashed attempt of THIS milestone.
//
// THREE gates, ALL must be safe before anything is deleted (gap-reclaim-21-merged-worktrees-and-fix-my-
// bad-criterion, 2026-08-03):
//   1. MERGED: `git merge-base --is-ancestor <branch> master` — are ALL branch commits already in
//      master? (Directly answers the question; the OLD "0 commits ahead + two-dot diff" criterion
//      false-flagged every merged branch as `merged-then-reverted` once master advanced past it.)
//   2. NOT REVERTED: only a --no-ff MERGE can be reverted (`git revert <merge>` keeps the merge commit
//      in master history so gate 1 still passes, while deleting the merge's added files from master's
//      tree). A branch fast-forwarded into master's linear history (tip ON the first-parent chain) has
//      no separate merge commit and thus cannot be merged-then-reverted — later deletions of its files
//      are ordinary evolution, not a revert (a plain tree-diff false-positives these: the original
//      two-dot-diff bug and the first two-dot --diff-filter=A attempt both did). Only a merge-entered
//      branch (tip NOT on first-parent) is checked: the files its merge added must still exist on
//      master's CURRENT tree, else `merged-then-reverted`.
//   3. CLEAN WORKTREE: `git status --porcelain` INSIDE the worktree must be empty. A clean branch does
//      NOT imply a clean worktree — 0-ahead/merged only proves no committed work is lost, not that the
//      working tree holds nothing. Non-empty → `has-uncommitted`, never deleted.
//
// Branch WITH commits ahead of master is real work → FAIL CLOSED (`has-commits`) and never silently
// discarded; a human must reconcile. Returns:
//   {outcome:"cleaned"}          — a safe worktree/branch was removed; caller may retry --add
//   {outcome:"nothing-to-clean"} — no stranded worktree/branch existed
//   {outcome:"has-commits", aheadCount}            — real committed work ahead; refuse (caller → needs-human)
//   {outcome:"merged-then-reverted"}               — branch content reverted away from master; refuse
//   {outcome:"has-uncommitted"}                    — worktree has uncommitted/untracked changes; refuse
export function cleanStaleWorktree({ workspace, milestone }) {
  const num = parseMilestoneNum(milestone);
  const rel = worktreeRelPath(num);
  const branch = worktreeBranch(num);
  if (!rel || !branch) return { outcome: "error", code: "no-numeric-milestone", detail: `cannot derive worktree path from milestone=${milestone}` };
  const abs = path.resolve(workspace, rel);
  const pathExists = fs.existsSync(abs);
  const branchExists = _gitOk(workspace, ["rev-parse", "--verify", "--quiet", branch]).ok;
  if (!pathExists && !branchExists) return { outcome: "nothing-to-clean" };
  if (branchExists) {
    // Gate 1 — merged? `merge-base --is-ancestor` exits 0 iff every commit on the branch is reachable
    // from master. A branch with commits NOT in master is real build work → has-commits (never clean).
    const ancestor = _gitOk(workspace, ["merge-base", "--is-ancestor", branch, "master"]);
    if (!ancestor.ok) {
      const ahead = _gitOk(workspace, ["rev-list", "--count", branch, "--not", "master"]);
      const aheadCount = ahead.ok ? Number(ahead.out) : NaN;
      return { outcome: "has-commits", aheadCount: Number.isFinite(aheadCount) ? aheadCount : null, branch, worktreeRel: rel };
    }
    // Gate 2 — reverted? Only a --no-ff MERGE can be reverted (`git revert <merge>`). A branch whose tip
    // is on master's FIRST-PARENT chain was fast-forwarded/folded directly into master's linear history —
    // there is NO separate merge commit to revert, so later deletions of some of its files (renames,
    // cleanups, reclassifications by subsequent milestones) are ordinary evolution, NOT a revert. A plain
    // tree-diff would false-positive these (the original two-dot-diff bug and my first two-dot
    // --diff-filter=A attempt both did). Only a branch that entered via a real merge commit (tip NOT on
    // first-parent) can be merged-then-reverted: ask whether the files THAT MERGE added still exist on
    // master's CURRENT tree (a `git revert` of the merge removes exactly those files).
    const firstParent = _gitOk(workspace, ["rev-list", "--first-parent", "master"]);
    if (!firstParent.ok) return { outcome: "error", code: "cannot-list-first-parent", detail: firstParent.out, worktreeRel: rel };
    const tipSha = _gitOk(workspace, ["rev-parse", branch]);
    const onFirstParent = tipSha.ok && firstParent.out.split("\n").includes(tipSha.out);
    if (!onFirstParent) {
      const mergeInfo = _mergeAddedFiles(workspace, tipSha.out);
      if (mergeInfo.error) return { outcome: "error", code: "cannot-find-branch-merge", detail: mergeInfo.error, worktreeRel: rel };
      const missing = mergeInfo.missing;
      if (missing.length > 0) {
        const shown = missing.slice(0, 5).join(", ");
        const extra = missing.length > 5 ? ` (+${missing.length - 5} more)` : "";
        return { outcome: "merged-then-reverted", branch, worktreeRel: rel, detail: `${missing.length} merge-added file(s) missing from master: ${shown}${extra}` };
      }
    }
  }
  // Gate 3 — worktree clean? git status --porcelain INSIDE the worktree (not the primary checkout):
  // non-empty means the worktree holds uncommitted/untracked work that deleting would destroy.
  if (pathExists) {
    const status = _gitOk(abs, ["status", "--porcelain"]);
    if (!status.ok) return { outcome: "error", code: "cannot-status-worktree", detail: status.out, worktreeRel: rel };
    if (status.out !== "") {
      return { outcome: "has-uncommitted", branch, worktreeRel: rel, detail: `worktree has uncommitted/untracked changes:\n${status.out}` };
    }
  }
  // All three gates safe (or branch already gone but path/metadata lingering) → clean. `git worktree
  // remove` WITHOUT --force: git's own "contains modified or untracked files" refusal is the LAST gate.
  if (pathExists) {
    const rm = _gitOk(workspace, ["worktree", "remove", rel]);
    if (!rm.ok) _gitOk(workspace, ["worktree", "prune"]); // corrupt metadata → prune the registration
  } else {
    _gitOk(workspace, ["worktree", "prune"]);
  }
  if (branchExists) {
    // Branch proven merged into master (ancestor) → `-d` (NOT -D) succeeds and is git's own
    // "is this merged into HEAD" double-check — the last gate, not our assertion.
    const del = _gitOk(workspace, ["branch", "-d", branch]);
    if (!del.ok) return { outcome: "error", code: "git-branch-delete-failed", detail: del.out };
  }
  return { outcome: "cleaned", worktreeRel: rel, branch };
}

// ── Land lock — single-flight serialization of ALL shared-checkout mutations across concurrent ────
// worktree Lands. Under worktree mode Land is the SOLE phase that mutates the shared checkout, and —
// critically — the lock is held for the ENTIRE Land phase (not just the merge): the merge/remove AND
// the CAPTURE commits, dashboard.md ## Log append, milestone_counter read-modify-write, and the
// it0-backlog-regen.ts regeneration ALL happen inside the held lock (execute-milestone.js acquires
// before step 1 and releases only after the last shared-checkout write). Two concurrent worktree Lands
// therefore serialize over EVERY shared-checkout mutation — no lost-update race on milestone_counter /
// dashboard.md / backlog.md and no git-index/HEAD race on the CAPTURE commits. (task_write itself is
// NOT in this race — quay-native's store serializes per-task via tasks/<id>.md.lock.)
//
// This is a GLOBAL single-flight lock (one Land at a time, NOT per-milestone — the shared checkout is
// the serialized resource, exactly as the prepare-admission lease is per-task because the TASK is that
// subsystem's serialized resource).
//
// ATOMIC RECLAIM (DIR-123 review, Obstacle 4): the reclaim path mirrors the JUST-HARDENED sibling
// proposal-convergence.ts's `_acquireEpochLock` (NOT a plain read-then-overwrite, which is a TOCTOU —
// two reclaimers that both read the stale lock before either writes would both overwrite → two holders).
// The grant is ALWAYS the atomic exclusive-create (`fs.writeFileSync(..., {flag:"wx"})`, throws EEXIST
// on contention — the same primitive prepare-admission-check.ts's _grantLeaseAtomic and the sibling
// use); a stale lock is reclaimed by `fs.rmSync` + RETRY the atomic wx-create in a BOUNDED loop, so two
// racing reclaimers resolve to exactly ONE wx winner (the loser re-reads the winner's fresh, non-stale
// lock and is refused). Staleness clock falls back to the lock FILE's own mtime when the content is
// corrupt (sibling's fix: a corrupt lock must not block reclaim forever). Never a permanent lockout.
export const LAND_LOCK_STALENESS_MS = 30 * 60 * 1000; // 30m: well beyond a single Land phase, short enough to recover a crashed one
// Bounded reclaim-retry count: two racing reclaimers self-resolve in ≤2 wx attempts (one wins, the other
// re-reads a fresh non-stale lock and refuses), so a small fixed bound can never spin unbounded.
const LAND_LOCK_RECLAIM_RETRIES = 3;
function landLockDir(workspace) { return path.join(workspace, ".quay", "land-locks"); }
function landLockPath(workspace) { return path.join(landLockDir(workspace), "shared-checkout.lock"); }
function landLockAuditPath(workspace) { return path.join(landLockDir(workspace), "shared-checkout.audit.jsonl"); }

// Sync sleep (the only synchronous sleep primitive in a .ts CLI without spawning a subprocess) — used
// for the test-only hold-delay below.
function _syncSleepMs(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

// Test-only injectable hold-delay (DIR-123 review Obstacle 4, mirroring the sibling's
// QUAY_EPOCH_LOCK_TEST_HOLD_MS): the original land-lock test relied on exactly the OS-scheduling luck
// the sibling learned is unreliable (a broken lock surfaced only ~57% of the time on a real machine).
// When set, acquireLandLock sleeps this many ms AFTER acquiring and BEFORE returning — widening the
// critical section deterministically so the regression test can force a genuine overlap window. Never
// read outside a test process (no production code path sets this env var).
function _landLockTestHoldDelayMs() {
  const raw = process.env.QUAY_LAND_LOCK_TEST_HOLD_MS;
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function acquireLandLock({ workspace, ownerExecutionId, now, stalenessMs = LAND_LOCK_STALENESS_MS }) {
  if (!ownerExecutionId) return { outcome: "error", code: "missing-session-id", detail: "ownerExecutionId (CLAUDE_CODE_SESSION_ID) is required" };
  if (!Number.isFinite(now)) return { outcome: "error", code: "missing-now", detail: "a real epoch-ms `now` is required" };
  fs.mkdirSync(landLockDir(workspace), { recursive: true });
  const record = { ownerExecutionId, acquiredAt: now, leaseUntil: now + stalenessMs, resource: "shared-checkout" };
  let reclaimed = false;
  for (let attempt = 0; attempt <= LAND_LOCK_RECLAIM_RETRIES; attempt++) {
    try {
      // THE grant: atomic exclusive-create. Throws EEXIST iff a lock already exists — two racers, only
      // one wins. This is the single-flight mechanism (never a plain overwrite).
      fs.writeFileSync(landLockPath(workspace), JSON.stringify(record, null, 2), { flag: "wx" });
      const holdMs = _landLockTestHoldDelayMs();
      if (holdMs > 0) _syncSleepMs(holdMs); // deterministic test overlap window (no-op in production)
      return { outcome: "acquired", lock: record, reclaimed };
    } catch (err) {
      if (err.code !== "EEXIST") return { outcome: "error", code: "lock-io-error", detail: err.message };
      let existing = null;
      try { existing = JSON.parse(fs.readFileSync(landLockPath(workspace), "utf8")); } catch { existing = null; }
      // Staleness clock: prefer the holder's self-reported leaseUntil; fall back to the lock FILE's own
      // mtime when the content is unparseable/corrupt (a corrupt lock must not block reclaim forever).
      let stale = false;
      if (existing && Number.isFinite(existing.leaseUntil)) {
        stale = now > existing.leaseUntil;
      } else {
        try { stale = (now - fs.statSync(landLockPath(workspace)).mtimeMs) >= stalenessMs; } catch { stale = false; }
      }
      if (stale) {
        // Stale/corrupt → reclaim by removing the orphaned lock, then RETRY the atomic wx-create (bounded
        // by THIS loop). Audit-record the superseded lock first (never a silent unlock). Two racing
        // reclaimers: both rmSync, both retry wx, exactly one wins; the loser re-reads the winner's
        // fresh NON-stale lock on its next iteration and is refused below.
        //
        // ACCEPTED TRADEOFF (DIR-123 review C4 — do NOT "fix", matches the reviewed sibling exactly):
        // this rmSync+retry-wx reclaim has the SAME two residual, negligible microsecond windows as
        // proposal-convergence.ts's hardened `_acquireEpochLock` (the precedent this mirrors): (1) a
        // loser's rmSync could, in a sub-millisecond interleaving, delete the winner's JUST-created
        // fresh lock before the winner's wx returns (both then retry; the bounded loop re-converges to a
        // single holder — never two simultaneous holders past the loop, never an unlocked proceed); and
        // (2) a Land phase exceeding the 30-min staleness window could be reclaimed mid-flight. Both are
        // identical to the sibling's accepted design and negligible operational risk for an opt-in,
        // single-host, human-supervised loop; diverging here would needlessly depart from the
        // established, independently-reviewed pattern. A fencing-token / mid-Land heartbeat is the
        // later hardening if real Lands ever approach these bounds (documented in tasks/DIR-123.md).
        try { fs.appendFileSync(landLockAuditPath(workspace), JSON.stringify({ releaseMethod: "stale-reclaim", releasedAt: now, prior: existing }) + "\n"); } catch { /* audit best-effort */ }
        try { fs.rmSync(landLockPath(workspace), { force: true }); } catch { /* another racer reclaimed first */ }
        reclaimed = true;
        continue;
      }
      // Active, non-expired holder → refuse immediately (the workflow does the wait-and-retry at the
      // prompt level; the lock primitive itself never blocks indefinitely and never proceeds unlocked).
      return { outcome: "land-already-running", owner: existing };
    }
  }
  // Exhausted the bounded reclaim retries (persistent reclaim race) — fail closed, never proceed unlocked.
  return { outcome: "land-already-running", owner: null };
}

export function releaseLandLock({ workspace, ownerExecutionId, now }) {
  let existing = null;
  try { existing = JSON.parse(fs.readFileSync(landLockPath(workspace), "utf8")); } catch (err) {
    if (err.code === "ENOENT") return { outcome: "error", code: "lock-missing", detail: "no land lock held" };
    return { outcome: "error", code: "lock-io-error", detail: err.message };
  }
  // Fencing: only the owner (or a force-release, which passes ownerExecutionId === '*') may release —
  // a stale-reclaim by a NEW owner is not clobbered by the old owner's belated release.
  if (ownerExecutionId !== "*" && existing.ownerExecutionId !== ownerExecutionId) {
    return { outcome: "error", code: "not-lock-owner", detail: `lock owned by ${existing.ownerExecutionId}, release attempted by ${ownerExecutionId}` };
  }
  try {
    fs.appendFileSync(landLockAuditPath(workspace), JSON.stringify({ releaseMethod: "normal", releasedAt: now, prior: existing }) + "\n");
  } catch { /* audit best-effort */ }
  fs.rmSync(landLockPath(workspace), { force: true });
  return { outcome: "released" };
}

// ── Exposed for tests (not part of the CLI contract). ──────────────────────────────────────────────
export const _internal = { landLockDir, landLockPath, landLockAuditPath };

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
async function main(argv) {
  const spec = {
    usage: "(--add|--merge|--remove|--clean-stale|--land-lock-acquire|--land-lock-release) --workspace <dir> --milestone <NN> [--reason <text>]",
    minArgs: 0,
    flags: {
      add: { type: "boolean" },
      merge: { type: "boolean" },
      remove: { type: "boolean" },
      "clean-stale": { type: "boolean" },
      "land-lock-acquire": { type: "boolean" },
      "land-lock-release": { type: "boolean" },
      workspace: { type: "string" },
      milestone: { type: "string" },
      reason: { type: "string" },
    },
  };
  const parsed = parseArgs(argv, spec);
  const workspace = parsed.flags.workspace;
  const milestone = parsed.flags.milestone;
  const now = Date.now();
  const emit = (obj, code) => { console.log(JSON.stringify({ ...obj, nowMs: now })); return code; };
  if (!workspace) return emit({ outcome: "error", code: "missing-workspace", detail: "--workspace is required" }, 2);
  const ownerExecutionId = process.env.CLAUDE_CODE_SESSION_ID || null;
  if (parsed.flags["land-lock-acquire"]) {
    const r = acquireLandLock({ workspace, ownerExecutionId, now });
    return emit(r, r.outcome === "acquired" ? 0 : 1);
  }
  if (parsed.flags["land-lock-release"]) {
    const r = releaseLandLock({ workspace, ownerExecutionId: ownerExecutionId || "*", now });
    return emit(r, r.outcome === "released" ? 0 : 1);
  }
  if (!milestone) return emit({ outcome: "error", code: "missing-milestone", detail: "--milestone is required for --add/--merge/--remove/--clean-stale" }, 2);
  if (parsed.flags.add) {
    const r = addWorktree({ workspace, milestone });
    return emit(r, r.outcome === "added" ? 0 : 1);
  }
  if (parsed.flags.merge) {
    const r = mergeWorktree({ workspace, milestone });
    return emit(r, r.outcome === "merged" ? 0 : 1);
  }
  if (parsed.flags.remove) {
    const r = removeWorktree({ workspace, milestone });
    return emit(r, r.outcome === "removed" ? 0 : 1);
  }
  if (parsed.flags["clean-stale"]) {
    const r = cleanStaleWorktree({ workspace, milestone });
    return emit(r, r.outcome === "cleaned" || r.outcome === "nothing-to-clean" ? 0 : 1);
  }
  return emit({ outcome: "error", code: "no-mode", detail: spec.usage }, 2);
}

if (isDirectEntry(import.meta)) {
  main(process.argv).then((code) => process.exit(code));
}
