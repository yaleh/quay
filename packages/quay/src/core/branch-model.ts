// branch-model.ts — establish quay's BRANCH MODEL in a target project (`quay init`).
//
// ============================ WHY THIS EXISTS ============================
// quay's fan-in / anti-drift / landing path judges a task's work by `git diff --name-only
// <landing-baseline>...HEAD` (plugin/scripts/anti-drift-touches-check.ts:119). That judgment is
// only meaningful when <landing-baseline> is the line the task branch was forked from and will be
// fast-forwarded onto. The mechanism read that baseline as the literal `develop`
// (worker-driver.ts `opts.mergeTarget ?? "develop"`, anti-drift `--merge-target ?? "develop"`,
// fan-in-ts-typecheck-gate.ts likewise) — an ASSUMPTION about the target project that nothing
// established.
//
// Measured failure (2026-09-11, gap-fan-in-merge-target-hardcoded-develop-blocks-third-party-landing,
// real machine e2e on an upgraded meta-cc copy): the copy's `develop` was an ancient fork
// (`d95dac8`, 2025-10-14) whose merge-base with the real mainline `main` was 571 commits back, and
// whose tree contained ZERO `tasks/*.md`. A worker that implemented its fix CORRECTLY and committed
// it was killed by `ANTI-DRIFT HARD FAIL: 1566 violation(s)` — the three-dot diff against that
// foreign `develop` is 1566 files, which no `## Touches` list can cover. The task was structurally
// un-landable, and the failure text blamed the task ("wrote 1566 files") rather than the baseline.
//
// The remedy (human ruling 2026-09-11) is NOT to infer a baseline from the target project's own
// branch topology. It is to APPLY quay's own branch model to the target project, at `quay init`
// time, so the literal `develop` the mechanism reads IS the authoritative baseline quay means:
//
//   master   — the project's DEFAULT branch. Its quay role is EMPTY (quay has no release flow;
//              fork-baseline.ts:10 "add master when a real release authorization exists"). `quay init`
//              never renames or duplicates it; the existing default branch fills this role.
//   develop  — the AUTHORITATIVE landing baseline: task-worktree fork point, fan-in merge target,
//              anti-drift diff base, fast-forward destination. This is the ref the mechanism reads.
//   author   — the doc-only work branch (doc/status commits land here; develop converges from it).
//
// ⛔ NO NEW BRANCH-NAME LITERAL is introduced by this module. `develop` / `author` are the SAME two
// role names the shipped mechanism and `.quay/config.yml`'s `fork_baseline` already carry; this module
// is where they are DEFINED once (ADR-004 single source) so the literal exists in exactly one place.
//
// ============================ THE COMPATIBILITY PREDICATE ============================
// `develop` plays quay's landing role iff the project's default branch is an ANCESTOR of it — i.e.
// develop contains everything the mainline contains, so it is the mainline's continuation plus quay's
// verified work. Measured against real repos:
//   * quay itself: `git merge-base --is-ancestor master develop` = TRUE (develop is 17197 commits
//     ahead of master) ⇒ COMPATIBLE ⇒ `quay init` is a no-op here (hard requirement: this repo's
//     behavior must not change by one byte).
//   * the meta-cc copy: main is 571 commits ahead of the shared merge-base ⇒ NOT compatible ⇒
//     DIVERGENT. That is the state that must be decided, never silently reused.
//
// ============================ THREE-STATE (never two) ============================
// A classification is one of absent / compatible / divergent / unreadable — the LAST is a state of
// its own (hard rule 3b: a judge that cannot read its input must not return the same value as one
// that read it and approved). `unreadable` (not a git repo, no commits yet, default branch
// unresolvable) NEVER counts as compatible and NEVER blocks by itself; it is reported as such.
//
// DIRECTION OF REPAIR vs DIRECTION OF DETECTION: `quay init` decides and REPAIRS (create absent,
// decide divergent). The fan-in gate DETECTS (anti-drift-touches-check.ts reports a distinguishable
// BASELINE-MISMATCH instead of an unattributable violation count) and points back at init.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ancestry } from "./ancestry.ts";

import {
  LANDING_BASELINE_ROLE,
  LANDING_BASELINE_ENTRY_ROLE,
  GOAL_BRANCH_RE,
  type RefClassification,
  type BranchModelEntry,
  type BranchModelReport,
  type EnsureBranchModelOptions,
  type DocBranchReport,
  type EnsureDocBranchOptions,
  type BaselineCheckoutReport,
  type DocBranchInvariantState,
  type DocBranchInvariantReason,
  type DocBranchInvariantReport,
  type DocBranchInvariantOptions,
  type GoalBranchReport,
} from "./branch-model-types.ts";
export * from "./branch-model-types.ts";

// ── git primitives ───────────────────────────────────────────────────────────────────────────────

function git(root: string, args: string[]): { ok: true; out: string } | { ok: false; err: string } {
  try {
    const out = execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      timeout: 20_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, out };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return { ok: false, err };
  }
}

/**
 * The branch the main checkout IS ON — the raw `symbolic-ref` read, or `null` when HEAD is detached
 * (or the repo is unborn).
 *
 * Kept DISTINCT from `resolveDocBranchRole` below on purpose: that function substitutes the default
 * branch when HEAD is detached (fine for "which branch fills the doc role in the mechanism's eyes"),
 * whereas the doc-branch bootstrap must NOT treat a detached HEAD as any known branch — see
 * `DocBranchState`'s `unreadable`. Two readers of one git call with two honest answers, one shared
 * primitive.
 */
export function resolveCheckedOutBranch(root: string): string | null {
  const cur = git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (cur.ok) {
    const ref = cur.out.trim();
    if (ref) return ref;
  }
  return null;
}

/**
 * Resolve the DOC-branch role: the branch the main checkout is on.
 *
 * ⛔ NOT a name. `author` is quay's OWN naming convention, not part of the protocol, so hardcoding it
 * is a per-project identity literal — exactly the defect
 * `gap-doc-branch-hardcoded-author-breaks-third-party-develop-sync` removed from
 * `driver-filters.ts` (whose `resolveDocBranch` is this same runtime derivation), and exactly what
 * `target-identity-literal-check.ts` fails RED on (`LEGAL_IDENTITY_VALUES` deliberately excludes
 * `author`). This function therefore REPORTS which branch fills the role; it never names one and
 * never creates one — the NAME comes from the caller's CLI parameter / config default (see
 * `ensureDocBranch`'s header for how the role gets BOOTSTRAPPED without this module naming a branch).
 *
 * @returns the checked-out branch name, the default branch when HEAD is detached, or null.
 */
export function resolveDocBranchRole(root: string): string | null {
  return resolveCheckedOutBranch(root) ?? detectDefaultBranch(root);
}

/** Refs whose sha is resolvable (`git rev-parse --verify --quiet <ref>^{commit}`). */
function resolveSha(root: string, ref: string): string | null {
  const r = git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  if (!r.ok) return null;
  const sha = r.out.trim();
  return sha.length > 0 ? sha : null;
}

/** Commits reachable from `a` and not from `b` — null when the count cannot be computed. */
function revCount(root: string, a: string, b: string): number | null {
  const r = git(root, ["rev-list", "--count", `${a}..${b}`]);
  if (!r.ok) return null;
  const n = Number.parseInt(r.out.trim(), 10);
  return Number.isFinite(n) ? n : null;
}

/** This module's liveness budget for the ancestry probe — it runs on the `quay init` /
 *  compatibility-classification path, where a hung git must not hang the CLI. */
const ANCESTRY_TIMEOUT_MS = 20_000;

/** True iff `ancestor` is reachable from `descendant`. The PREDICATE is `./ancestry.ts`
 *  (semantic-dedup-scan finding `is-ancestor-three-semantics`: it was copied into this module,
 *  goal-merge.ts and observation.ts with three different value sets); this wrapper is only the
 *  timeout policy. `null` = could not be asked, and every caller below keeps it distinct from a
 *  measured `false` (hard rule 3b). */
function isAncestor(root: string, ancestor: string, descendant: string): boolean | null {
  return ancestry(root, ancestor, descendant, { timeoutMs: ANCESTRY_TIMEOUT_MS });
}

// ── default-branch detection ─────────────────────────────────────────────────────────────────────

/**
 * Detect the project's DEFAULT branch — the branch that fills the model's `master` role.
 *
 * Resolution order is deliberately conservative: a remote-tracking HEAD is the authoritative
 * declaration of a clone's default branch; the conventional `main`/`master` pair is next; the
 * currently checked-out branch is the LAST resort.
 *
 * ⚠️ `allowCurrentBranch: false` is REQUIRED for callers running inside a TASK WORKTREE. There the
 * checked-out branch is `task/<id>` — never a default-branch proxy — and using it would invert the
 * compatibility predicate (the task branch does not contain the landing baseline, so every healthy
 * fan-in would be misreported as a foreign fork). Detection then honestly returns `null`, which
 * classifies as `unreadable` (no verdict) rather than as a spurious `divergent`.
 *
 * @returns the branch name, or null when nothing can be resolved (unborn repo / not a git repo).
 */
export function detectDefaultBranch(root: string, opts: { allowCurrentBranch?: boolean } = {}): string | null {
  const allowCurrentBranch = opts.allowCurrentBranch !== false;
  const head = git(root, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  if (head.ok) {
    const ref = head.out.trim();
    if (ref) return ref.replace(/^[^/]+\//, "");
  }
  const has = (b: string): boolean => resolveSha(root, b) !== null;
  const hasMain = has("main");
  const hasMaster = has("master");
  if (hasMain && !hasMaster) return "main";
  if (hasMaster && !hasMain) return "master";
  if (hasMain && hasMaster) {
    // Both exist: ambiguous by convention alone. Fall through to the checked-out branch.
  }
  if (!allowCurrentBranch) return null;
  const cur = git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (cur.ok) {
    const ref = cur.out.trim();
    if (ref && resolveSha(root, ref) !== null) return ref;
  }
  return null;
}

// ── classification ───────────────────────────────────────────────────────────────────────────────

/**
 * Classify a branch against the project's default branch.
 *
 * `compatible` = the default branch tip is an ancestor of the ref (the ref is the mainline's
 * continuation). `divergent` = it is not — the ref is a foreign line and must not silently carry
 * quay's landing role. `absent` / `unreadable` are their own states.
 */
export function classifyBranch(root: string, name: string, defaultBranch: string | null): RefClassification {
  const base = (extra: Partial<RefClassification>): RefClassification => ({
    name,
    state: "unreadable",
    sha: null,
    aheadOfDefault: null,
    behindDefault: null,
    reason: "unreadable",
    detail: "",
    ...extra,
  });

  if (!fs.existsSync(path.join(root, ".git"))) {
    // A bare repo / worktree has `.git` as a FILE — `fs.existsSync` covers both; anything else is
    // genuinely unreadable, but let git be the final judge rather than this check alone.
  }
  const insideRepo = git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (!insideRepo.ok || insideRepo.out.trim() !== "true") {
    return base({ reason: "not-a-git-worktree", detail: `${root} is not inside a git work tree` });
  }

  const sha = resolveSha(root, name);
  if (sha === null) {
    // Distinguish "branch does not exist" from "HEAD is unborn" — the latter is a fresh repo with
    // nothing to fork from, not a missing branch.
    const unborn = git(root, ["rev-parse", "--verify", "--quiet", "HEAD"]);
    if (!unborn.ok) {
      return base({ reason: "no-commits", detail: "the repository has no commits yet — nothing to branch from" });
    }
    return base({ state: "absent", reason: "absent", detail: `branch '${name}' does not exist` });
  }

  if (defaultBranch === null) {
    return base({
      sha,
      reason: "default-branch-unresolvable",
      detail: `branch '${name}' exists (${sha.slice(0, 8)}) but the project's default branch could not be resolved, so compatibility is undecidable`,
    });
  }

  const defaultSha = resolveSha(root, defaultBranch);
  if (defaultSha === null) {
    return base({
      sha,
      reason: "default-branch-unresolvable",
      detail: `branch '${name}' exists (${sha.slice(0, 8)}) but default branch '${defaultBranch}' does not resolve`,
    });
  }

  const containsDefault = isAncestor(root, defaultBranch, name);
  if (containsDefault === null) {
    return base({
      sha,
      reason: "ancestry-undecidable",
      detail: `could not decide whether '${defaultBranch}' is an ancestor of '${name}'`,
    });
  }
  const ahead = revCount(root, defaultBranch, name);
  const behind = revCount(root, name, defaultBranch);
  if (containsDefault) {
    return {
      name,
      state: "compatible",
      sha,
      aheadOfDefault: ahead,
      behindDefault: behind,
      reason: "contains-default",
      detail: `'${name}' contains '${defaultBranch}' (${ahead ?? "?"} commit(s) ahead, ${behind ?? "?"} behind) — a valid quay landing baseline`,
    };
  }
  return {
    name,
    state: "divergent",
    sha,
    aheadOfDefault: ahead,
    behindDefault: behind,
    reason: "foreign-fork",
    detail:
      `'${name}' (${sha.slice(0, 8)}) is NOT a continuation of the project's default branch ` +
      `'${defaultBranch}' (${defaultSha.slice(0, 8)}) — it is ${behind ?? "?"} commit(s) behind and ` +
      `shares only an old merge base, so a task diff against it is meaningless`,
  };
}

// ── provisioning ─────────────────────────────────────────────────────────────────────────────────

/** `verifyBranchModel`'s verdict — read-only, used by callers that must decide BEFORE mutating. */
export function verifyBranchModel(root: string): { defaultBranch: string | null; baseline: RefClassification } {
  const defaultBranch = detectDefaultBranch(root);
  return { defaultBranch, baseline: classifyBranch(root, LANDING_BASELINE_ROLE, defaultBranch) };
}

/**
 * Establish the quay branch model in `root`.
 *
 * `develop` (the landing baseline) and `author` (the doc-only branch) are created at the default
 * branch's tip when absent, left alone when compatible, and — when one is a FOREIGN LINE — either
 * adopted (existing tip preserved under a backup ref, then re-pointed) or reported as `blocked`.
 * Blocking is the default: silently re-pointing a branch that means something to the target project
 * is exactly the class of damage this task exists to stop.
 *
 * The default branch itself is never renamed, created or moved — it fills the `master` role as-is.
 */
export function ensureBranchModel(root: string, opts: EnsureBranchModelOptions = {}): BranchModelReport {
  const dryRun = opts.dryRun === true;
  const adopt = opts.adopt === true;
  const defaultBranch = detectDefaultBranch(root);

  const probe = classifyBranch(root, LANDING_BASELINE_ROLE, defaultBranch);
  if (probe.reason === "not-a-git-worktree" || probe.reason === "no-commits") {
    return {
      ok: true,
      skipped: true,
      // The probe's own reason, carried through VERBATIM — never a second predicate (ADR-004).
      skipReason: probe.reason,
      defaultBranch,
      entries: [
        {
          role: "default",
          ref: defaultBranch ?? "(none)",
          action: "unreadable",
          sha: null,
          backupRef: null,
          detail: probe.detail,
        },
      ],
      remedy: null,
    };
  }

  const entries: BranchModelEntry[] = [];
  const frozenDefaultSha = defaultBranch === null ? null : resolveSha(root, defaultBranch);

  entries.push({
    role: "default",
    ref: defaultBranch ?? "(unresolved)",
    action: defaultBranch === null ? "unreadable" : "reused",
    sha: frozenDefaultSha,
    backupRef: null,
    detail:
      defaultBranch === null
        ? "the project's default branch could not be resolved — the master role is unverified"
        : `project default branch (master role; quay never renames or moves it)`,
  });

  // `develop` is judged by the compatibility predicate and PROVISIONED. The doc-branch role is
  // REPORTED only — its name is derived at runtime (resolveDocBranchRole), never a literal, and
  // `quay init` does not create it (see that function's header). Divergence of the doc branch from
  // develop is a normal synced state handled by driver-filters.ts, never a provisioning block.
  const docName = resolveDocBranchRole(root);
  entries.push(
    docName === null
      ? { role: "doc-branch", ref: "(unresolved)", action: "unreadable", sha: null, backupRef: null, detail: "the doc-branch role could not be resolved (detached HEAD with no default branch) — the shipped mechanism derives it at runtime and will report the same" }
      : { role: "doc-branch", ref: docName, action: "reused", sha: resolveSha(root, docName), backupRef: null, detail: `the doc-only work branch is DERIVED at runtime (driver-filters.ts resolveDocBranch = the checked-out branch), so '${docName}' fills the role; ⛔ no name is created or assumed here` },
  );

  const roles: Array<{ role: string; name: string }> = [
    { role: LANDING_BASELINE_ENTRY_ROLE, name: LANDING_BASELINE_ROLE },
  ];

  for (const { role, name } of roles) {
    const cls: RefClassification = classifyBranch(root, name, defaultBranch);

    if (cls.state === "absent") {
      if (dryRun) {
        entries.push({ role, ref: name, action: "created", sha: frozenDefaultSha, backupRef: null, detail: `would create '${name}' at ${defaultBranch ?? "?"}` });
        continue;
      }
      if (frozenDefaultSha === null) {
        entries.push({ role, ref: name, action: "unreadable", sha: null, backupRef: null, detail: `cannot create '${name}': the default branch (${defaultBranch ?? "?"}) does not resolve` });
        continue;
      }
      const r = git(root, ["branch", name, defaultBranch as string]);
      entries.push(
        // `=== true`, not truthiness: this repo's root tsconfig is `strict: false`, under which the
        // NEGATIVE branch of a boolean-discriminant union is NOT narrowed — `r.err` below would be
        // TS2339, which `tsc --noEmit` (the fan-in ts-typecheck gate) rejects. Literal comparison
        // narrows both branches; the same form is used at every `.ok` union in this file.
        r.ok === true
          ? { role, ref: name, action: "created", sha: frozenDefaultSha, backupRef: null, detail: `created '${name}' at ${defaultBranch} (${frozenDefaultSha.slice(0, 8)})` }
          : { role, ref: name, action: "unreadable", sha: null, backupRef: null, detail: `git branch ${name} failed: ${r.err}` },
      );
      continue;
    }

    if (cls.state === "compatible") {
      entries.push({ role, ref: name, action: "reused", sha: cls.sha, backupRef: null, detail: cls.detail });
      continue;
    }

    if (cls.state === "unreadable") {
      entries.push({ role, ref: name, action: "unreadable", sha: cls.sha, backupRef: null, detail: cls.detail });
      continue;
    }

    // state === "divergent"
    if (!adopt) {
      entries.push({
        role,
        ref: name,
        action: "blocked",
        sha: cls.sha,
        backupRef: null,
        detail:
          `${cls.detail}. Reusing it silently would make every task's anti-drift diff meaningless ` +
          `(the exact defect this task fixes).`,
      });
      continue;
    }

    const shortSha = (cls.sha ?? "unknown").slice(0, 8);
    const backupRef = `${name}-pre-quay-init-${shortSha}`;
    if (dryRun) {
      entries.push({ role, ref: name, action: "adopted", sha: frozenDefaultSha, backupRef, detail: `would preserve '${name}' as '${backupRef}' and re-point '${name}' at ${defaultBranch}` });
      continue;
    }
    if (frozenDefaultSha === null) {
      entries.push({ role, ref: name, action: "unreadable", sha: cls.sha, backupRef: null, detail: `cannot adopt '${name}': the default branch (${defaultBranch ?? "?"}) does not resolve` });
      continue;
    }
    const backup = git(root, ["branch", backupRef, name]);
    const repoint = git(root, ["branch", "-f", name, defaultBranch as string]);
    if (repoint.ok === true) {
      entries.push({
        role,
        ref: name,
        action: "adopted",
        sha: frozenDefaultSha,
        backupRef,
        detail:
          `'${name}' was a foreign fork (${shortSha}); preserved as '${backupRef}' and re-pointed at ` +
          `${defaultBranch} (${frozenDefaultSha.slice(0, 8)})${backup.ok === true ? "" : ` — ⚠️ backup failed: ${backup.err}`}`,
      });
    } else {
      entries.push({ role, ref: name, action: "blocked", sha: cls.sha, backupRef, detail: `adopt failed: git branch -f ${name} returned non-zero: ${repoint.err}` });
    }
  }

  const blocked = entries.filter((e) => e.action === "blocked");
  return {
    ok: blocked.length === 0,
    skipped: false,
    skipReason: null,
    defaultBranch,
    entries,
    remedy:
      blocked.length === 0
        ? null
        : `Re-run with branch adoption enabled to preserve the existing branch(es) and re-point them at ` +
          `${defaultBranch ?? "the default branch"}: CLI \`quay init --adopt-branch-model\` ` +
          `(or the /quay:init skill with branch adoption). The existing tips are kept under ` +
          `<branch>-pre-quay-init-<sha> — nothing is destroyed.`,
  };
}

/** One-line-per-entry rendering shared by the CLI and the task-body evidence. */
export function formatBranchModelReport(report: BranchModelReport): string {
  if (report.skipped) {
    const head = `branch model: SKIPPED — ${report.entries[0]?.detail ?? "repository not classifiable"}`;
    // ⛔ The two skips are NOT the same answer and must not render the same (hard rule 3b): "there is
    // no git here" is a verdict about the TARGET, while "there are no commits YET" is a verdict about
    // the target's MOMENT — and a caller that already knows what else this run does (the fresh-install
    // auto-commit creates the first commit) can leave this state behind inside the same run. Rendering
    // them identically is how a 0-commit repo came back `SKIPPED` with no hint that a single re-run
    // converges (gap-init-branch-model-runs-before-auto-commit-fresh-repo-needs-two-runs).
    if (report.skipReason === "no-commits") {
      return (
        `${head}\n` +
        `  [NOT-EVALUATED] branch-model -> ${LANDING_BASELINE_ROLE} — no verdict was reached, so this ` +
        `is NOT a pass: re-run \`quay init\` once the repository has a first commit (nothing in a ` +
        `commit-less repository can be judged against a baseline that does not exist yet).`
      );
    }
    return head;
  }
  const lines = [`branch model (default branch: ${report.defaultBranch ?? "UNRESOLVED"}):`];
  for (const e of report.entries) {
    const mark = e.action === "blocked" ? "BLOCKED" : e.action.toUpperCase();
    const backup = e.backupRef ? ` [backup: ${e.backupRef}]` : "";
    lines.push(`  [${mark}] ${e.role} -> ${e.ref}${backup} — ${e.detail}`);
  }
  if (report.remedy) lines.push(`  remedy: ${report.remedy}`);
  return lines.join("\n");
}

// ── the doc-branch role: BOOTSTRAP (gap-quay-init-no-doc-branch-bootstrap-…) ─────────────────────
//
// ============================ WHY THIS EXISTS ============================
// `ensureBranchModel` above ESTABLISHES the landing baseline but only REPORTS the doc branch: a
// project can therefore satisfy the whole branch model while its MAIN CHECKOUT sits on `develop`,
// which is the one branch the shipped mechanism writes to (propagate pushes develop; fan-in merges
// into develop). Human edits and driver commits then share one branch AND one git index — the
// collision class `driver-filters.ts`'s doc-branch indirection exists to prevent. Measured
// 2026-09-13 on a real third-party project (quay-fleet): `git branch -a` had never contained any
// doc branch, and `.quay/doc-develop-sync.jsonl` had never contained a line, because
// `propagateDocBranchToDevelop` short-circuits when the doc branch IS `develop` (a degenerate but
// mechanically correct path). The gap is that NOTHING EVER MOVED THAT PROJECT OFF `develop`.
//
// ============================ WHAT THIS FUNCTION IS NOT ============================
// ⛔ It names NO branch. The doc-branch NAME is an INPUT (`opts.name`), supplied by the caller's CLI
// parameter or its config default — never by this module. A name invented here would be exactly the
// per-project identity literal `target-identity-literal-check.ts` fails RED on, and a created
// `author` in a third-party project would be a DEAD ARTIFACT: the shipped mechanism derives the doc
// branch at runtime (`driver-filters.ts resolveDocBranch` = the checked-out branch) and would never
// return it. Supplying the name and judging the state are two different jobs; this function does
// only the second.
//
// ⛔ The judgment is NAME-AGNOSTIC. The only ref compared against by NAME is `develop`, the
// protocol-fixed landing-baseline literal (`LEGAL_IDENTITY_VALUES`) — the comparison is "is the main
// checkout sitting on the landing baseline", which is true for every project regardless of what its
// doc branch is called. No branch name in the world gets a special branch here (AC1's four-state
// invariant, and the DoD's explicit bar).

/**
 * Establish the doc-only work branch in `root`: when the main checkout is sitting ON the landing
 * baseline, put the main checkout on a doc branch so human edits and driver commits stop sharing one
 * branch and one index.
 *
 * Six states, each its own answer (this is what AC1 pins):
 *   - main checkout already OFF the landing baseline (whatever its name) ⇒ `independent`, NO-OP.
 *   - ON the baseline, name free ⇒ create that branch AT THE BASELINE'S TIP and switch to it; the
 *     tree is byte-identical (same commit), so this is pure git metadata.
 *   - ON the baseline, name taken by a RELATED branch ⇒ switch to it (the existing doc branch wins;
 *     ⛔ never renamed, never re-pointed).
 *   - ON the baseline, name taken by a RELATED branch that is BEHIND the baseline ⇒ still switch to
 *     it (no behavior change), but report `behind` with the explicit lag (gap-quay-init-doc-branch-
 *     behind-baseline-reports-satisfied) instead of the reusable/unchanged wording.
 *   - ON the baseline, name taken by an UNRELATED branch ⇒ `blocked`, nothing moves — silently
 *     re-pointing a ref that means something to the target project is the damage class the adopt
 *     path of `ensureBranchModel` exists to make an EXPLICIT decision, and no such decision was made
 *     here.
 *   - HEAD detached / not a work tree ⇒ `unreadable`: the verdict is WITHHELD, never collapsed into
 *     `independent` (hard rule 3b — a judge that cannot read its input must not return the value a
 *     judge that read it would return).
 */
export function ensureDocBranch(root: string, opts: EnsureDocBranchOptions): DocBranchReport {
  const name = (opts.name ?? "").trim();
  const dryRun = opts.dryRun === true;
  const adopt = opts.adopt === true;
  const base = {
    dryRun,
    name,
    checkedOut: null as string | null,
    baselineSha: null as string | null,
    preexistingSha: null as string | null,
    sha: null as string | null,
    behindBaseline: null as number | null,
  };
  const notEvaluated = (detail: string): DocBranchReport => ({
    ...base,
    state: "unreadable",
    action: "unreadable",
    ok: true,
    notEvaluated: true,
    detail,
  });
  const blocked = (detail: string): DocBranchReport => ({
    ...base,
    state: "blocked",
    action: "blocked",
    ok: false,
    notEvaluated: false,
    detail,
  });

  const insideRepo = git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (!insideRepo.ok || insideRepo.out.trim() !== "true") {
    return notEvaluated(`${root} is not inside a git work tree — the doc-branch role is not judged`);
  }

  const checkedOut = resolveCheckedOutBranch(root);
  if (checkedOut === null) {
    return notEvaluated(
      "HEAD is detached (or the repository is unborn): no branch is checked out, so the doc-branch " +
        "role cannot be judged — ⛔ NOT treated as 'already independent' (an unreadable HEAD is its own state).",
    );
  }
  base.checkedOut = checkedOut;
  const baselineSha = resolveSha(root, LANDING_BASELINE_ROLE);
  base.baselineSha = baselineSha;

  if (checkedOut !== LANDING_BASELINE_ROLE) {
    return {
      ...base,
      state: "independent",
      action: "noop",
      ok: true,
      notEvaluated: false,
      detail:
        `the main checkout is on '${checkedOut}', which is not the landing baseline ` +
        `'${LANDING_BASELINE_ROLE}' — the doc-branch invariant already holds; nothing was created, ` +
        `renamed or switched`,
    };
  }

  if (baselineSha === null) {
    return notEvaluated(
      `the main checkout is on '${LANDING_BASELINE_ROLE}' but that ref does not resolve — the doc ` +
        `branch cannot be judged against (or forked from) it`,
    );
  }

  if (name === "") {
    // ⛔ NOT defaulted here. Inventing a branch name in the judgment layer is the per-project
    // identity literal this module is explicitly barred from carrying. Checked AFTER the
    // `independent` verdict above on purpose: whether the invariant already holds is knowable
    // without a name, so a project that is already off the baseline still gets its true answer.
    return notEvaluated(
      "no doc-branch name was supplied — refusing to invent one (a branch name invented in the " +
        "judgment layer is the per-project identity literal target-identity-literal-check.ts fails " +
        "RED on). Pass it in: `--doc-branch-name <name>`, or `loop.doc_branch` in .quay/config.yml.",
    );
  }

  if (name === LANDING_BASELINE_ROLE) {
    return blocked(
      `the requested doc-branch name '${name}' IS the landing baseline — a doc branch must be a ` +
        `DIFFERENT ref from '${LANDING_BASELINE_ROLE}'; refusing (nothing created or switched)`,
    );
  }

  const preexistingSha = resolveSha(root, name);
  base.preexistingSha = preexistingSha;

  if (preexistingSha === null) {
    if (dryRun) {
      return {
        ...base,
        state: "absent",
        action: "created",
        ok: true,
        notEvaluated: false,
        sha: baselineSha,
        detail: `would create '${name}' at '${LANDING_BASELINE_ROLE}' (${baselineSha.slice(0, 8)}) and switch the main checkout to it`,
      };
    }
    const r = git(root, ["checkout", "-b", name]);
    return {
      ...base,
      state: "absent",
      action: r.ok === true ? "created" : "failed",
      ok: r.ok === true,
      notEvaluated: false,
      sha: r.ok === true ? baselineSha : null,
      detail:
        r.ok === true
          ? `created '${name}' at '${LANDING_BASELINE_ROLE}' (${baselineSha.slice(0, 8)}) and switched the main checkout to it — the working tree is byte-identical (same commit)`
          : `could not create/switch to '${name}': git checkout -b returned non-zero: ${r.err}`,
    };
  }

  const nameContainsBaseline = isAncestor(root, LANDING_BASELINE_ROLE, name);
  const baselineContainsName = isAncestor(root, name, LANDING_BASELINE_ROLE);
  if (nameContainsBaseline === null || baselineContainsName === null) {
    return notEvaluated(
      `branch '${name}' exists (${preexistingSha.slice(0, 8)}) but its ancestry with ` +
        `'${LANDING_BASELINE_ROLE}' could not be decided — refusing to judge it as either related or a collision`,
    );
  }
  if (!nameContainsBaseline && !baselineContainsName) {
    const shortSha = preexistingSha.slice(0, 8);
    const backupRef = `${name}-pre-quay-init-${shortSha}`;
    const collision =
      `branch '${name}' (${shortSha}) shares NO ancestry with '${LANDING_BASELINE_ROLE}' ` +
      `(${baselineSha.slice(0, 8)}) — a name collision, not a doc branch. Switching the main ` +
      `checkout onto it would move the human edit surface onto a foreign line.`;
    if (!adopt) {
      return blocked(
        `${collision} NOTHING WAS MOVED. Resolve it by hand, re-run with a different ` +
          `--doc-branch-name, or carry out the adoption decision (--adopt-branch-model) — which ` +
          `preserves the colliding tip as '${backupRef}' and re-points '${name}' at the baseline.`,
      );
    }
    if (dryRun) {
      return {
        ...base,
        state: "blocked",
        action: "adopted",
        ok: true,
        notEvaluated: false,
        sha: baselineSha,
        detail: `would preserve '${name}' (${shortSha}) as '${backupRef}', re-point '${name}' at '${LANDING_BASELINE_ROLE}' (${baselineSha.slice(0, 8)}) and switch the main checkout to it`,
      };
    }
    // The SAME primitive `ensureBranchModel` uses for a divergent landing baseline: nothing is
    // destroyed, the old tip stays reachable under the backup ref.
    const backup = git(root, ["branch", backupRef, name]);
    const repoint = git(root, ["branch", "-f", name, LANDING_BASELINE_ROLE]);
    if (repoint.ok !== true) {
      return {
        ...base,
        state: "blocked",
        action: "failed",
        ok: false,
        notEvaluated: false,
        sha: preexistingSha,
        detail: `${collision} adopt failed: git branch -f ${name} returned non-zero: ${repoint.err}`,
      };
    }
    const co = git(root, ["checkout", name]);
    return {
      ...base,
      state: "blocked",
      action: co.ok === true ? "adopted" : "failed",
      ok: co.ok === true,
      notEvaluated: false,
      sha: baselineSha,
      detail:
        co.ok === true
          ? `'${name}' was an unrelated line (${shortSha}); preserved as '${backupRef}' and re-pointed at '${LANDING_BASELINE_ROLE}' (${baselineSha.slice(0, 8)}), then the main checkout was switched to it${backup.ok === true ? "" : ` — ⚠️ backup failed: ${backup.err}`}`
          : `re-pointed '${name}' at '${LANDING_BASELINE_ROLE}' but could not switch to it: git checkout returned non-zero: ${co.err}`,
    };
  }

  // ── the explicit lag reading (gap-quay-init-doc-branch-behind-baseline-reports-satisfied) ──────
  // `name` is the baseline's ancestor (or the SAME tip) exactly here — `baselineContainsName ===
  // true`. That is the one branch where "how far behind is the doc branch" is a meaningful, READABLE
  // quantity: `git rev-list --count <name>..develop`. ⛔ It is NOT derived from the two `isAncestor`
  // booleans above (at the same tip BOTH are true, so "behind 0" and "same tip" would be
  // indistinguishable there); it is its own git read. A non-zero exit (ref vanished mid-run, or a
  // shallow/foreign read) yields `null` — 0 is trusted ONLY when the command succeeded.
  base.behindBaseline = baselineContainsName ? revCount(root, name, LANDING_BASELINE_ROLE) : null;
  const behind = base.behindBaseline !== null && base.behindBaseline > 0;
  // The doc branch has commits the baseline does NOT contain — a real fork. It is switched to AS IS,
  // never merged, never re-pointed, and the report says so explicitly (never silently "reusable").
  const diverged = nameContainsBaseline && !baselineContainsName;

  // ── STRICT ANCESTOR ⇒ lossless fast-forward (gap-quay-init-doc-branch-strict-ancestor-…) ────────
  // `behind` is true exactly when `baselineContainsName` (name is the baseline's ancestor / same tip)
  // AND the lag is > 0 — i.e. `name` is a STRICT ancestor with no unique commits. `git branch -f
  // <name> develop` moves only the ref (no tree change, no backup ref needed); then `git checkout
  // <name>` puts the main checkout onto the doc branch at the CURRENT tree instead of an older one.
  if (behind) {
    const ffDetail =
      `'${name}' (${preexistingSha.slice(0, 8)}) — it is ${base.behindBaseline} commit(s) BEHIND the ` +
      `landing baseline '${LANDING_BASELINE_ROLE}' (${baselineSha.slice(0, 8)}) with no unique ` +
      `commits (strict ancestor)`;
    if (dryRun) {
      return {
        ...base,
        state: "behind",
        action: "fast-forwarded",
        ok: true,
        notEvaluated: false,
        sha: baselineSha,
        detail: `would fast-forward ${ffDetail} — nothing is lost, so no backup ref is created; the main checkout would then move to '${name}' at the current tree`,
      };
    }
    const ff = git(root, ["branch", "-f", name, LANDING_BASELINE_ROLE]);
    if (ff.ok !== true) {
      return {
        ...base,
        state: "behind",
        action: "failed",
        ok: false,
        notEvaluated: false,
        sha: preexistingSha,
        detail: `could not fast-forward ${ffDetail}: git branch -f ${name} returned non-zero: ${ff.err}`,
      };
    }
    const co = git(root, ["checkout", name]);
    return {
      ...base,
      state: "behind",
      action: co.ok === true ? "fast-forwarded" : "failed",
      ok: co.ok === true,
      notEvaluated: false,
      sha: baselineSha,
      detail:
        co.ok === true
          ? `fast-forwarded ${ffDetail} to '${LANDING_BASELINE_ROLE}' (${baselineSha.slice(0, 8)}) — nothing lost (strict ancestor), then switched the main checkout to '${name}' at the current tree`
          : `fast-forwarded ${ffDetail} to '${LANDING_BASELINE_ROLE}' but could not switch the main checkout to '${name}': git checkout returned non-zero: ${co.err}`,
    };
  }

  // ── same tip / diverged (ahead) ⇒ switch only, never re-point ───────────────────────────────────
  if (dryRun) {
    return {
      ...base,
      state: "reusable",
      action: "switched",
      ok: true,
      notEvaluated: false,
      sha: preexistingSha,
      detail: diverged
        ? `would switch the main checkout to the existing related branch '${name}' (${preexistingSha.slice(0, 8)}) — ⚠️ diverged: it has unique commits NOT on '${LANDING_BASELINE_ROLE}'; left as is, never merged or re-pointed`
        : `would switch the main checkout to the existing related branch '${name}' (${preexistingSha.slice(0, 8)}) — unchanged, never renamed or re-pointed`,
    };
  }
  const r = git(root, ["checkout", name]);
  return {
    ...base,
    state: "reusable",
    action: r.ok === true ? "switched" : "failed",
    ok: r.ok === true,
    notEvaluated: false,
    sha: preexistingSha,
    detail:
      r.ok === true
        ? diverged
          ? `switched the main checkout to the existing related branch '${name}' (${preexistingSha.slice(0, 8)}) — ⚠️ diverged: it has unique commits NOT on '${LANDING_BASELINE_ROLE}'; left as is, never merged or re-pointed`
          : `switched the main checkout to the existing related branch '${name}' (${preexistingSha.slice(0, 8)}) — unchanged, never renamed or re-pointed`
        : `could not switch to the existing branch '${name}': git checkout returned non-zero: ${r.err}`,
  };
}

/**
 * One-line-per-state rendering for the operator (and the shell entry's `[BLOCKED] doc-branch`
 * relay token). The `doc-branch` role token is what `quay-init.sh` matches on — it is a POSITION in
 * the output, not a verdict recomputed downstream (the shell never re-judges; branch-model.ts owns
 * the judgment — ADR-004).
 */
// ── the baseline→checkout handoff (gap-quay-init-doc-branch-noop-when-fresh-develop-not-checked-out)
//
// ============================ WHY THIS EXISTS ============================
// `ensureBranchModel` ESTABLISHES `develop` by CREATING the ref (`git branch develop <default>`) when
// it is absent — and that is the shape of a project meeting quay for the first time, because a
// project whose default branch is already `develop` does not have this problem at all. Creating a ref
// does NOT move the main checkout. The doc-branch bootstrap that runs next (`ensureDocBranch`, driven
// from `cli/init.ts`) judges the world by exactly ONE fact: which branch the main checkout is on. It
// therefore reads the UNMOVED state, lands on its `independent` arm ("the main checkout is not on the
// landing baseline ⇒ the invariant already holds") and truthfully reports a NO-OP.
//
// Measured 2026-09-17 through the shipped entry on a fresh `git init -b main` repository:
//   [CREATED] landing-baseline -> develop — created 'develop' at main (79f24d7f)
//   [NOOP]    doc-branch       -> author  — the main checkout is on 'main', which is not the landing
//                                           baseline 'develop' — the doc-branch invariant already holds
// ⇒ the doc branch is never created and the user's main checkout keeps sitting on the branch quay's
// own landing path treats as the baseline: every subsequent human commit lands on `develop`, which is
// the one ref the fan-in path must fast-forward. Both steps are individually correct; the gap is
// BETWEEN them — "`develop` came into being DURING THIS RUN" is a fact the doc-branch judgment cannot
// see, because it reads the checkout, not the history.
//
// ============================ WHERE THE DECISION LIVES ============================
// ⛔ NOT inside `ensureDocBranch`. That four-state judgment is left byte-identical: it answers "is the
// main checkout on the landing baseline?", and moving HEAD is not its job. The handoff below is a
// SEPARATE step the CALLER runs BETWEEN the two, which is what makes the fresh-`main` scenario
// degenerate into the already-working `default == develop` scenario instead of teaching the judgment
// to guess how `develop` came to be.
//
// ⛔ The switch is PURE METADATA and refuses to be anything else: it runs only while the landing
// baseline points at the very commit the main checkout is already on, so no file can change. A
// `develop` that does NOT resolve to the checked-out commit is reported NOT-EVALUATED and left alone
// — moving a user's working tree is a different operation with different authorization, and it is not
// this one.

/**
 * True iff the landing baseline was (RE)ESTABLISHED by the run that produced `report`: `created`
 * (the ref was absent) or `adopted` (a divergent ref was preserved and re-pointed).
 *
 * Both leave the baseline sitting at the tip of the branch the main checkout is on, which is the fact
 * `ensureDocBranch` structurally cannot see — hence this predicate exists to hand that fact to the
 * caller. `reused` is deliberately EXCLUDED: the ref predates this run, so where the main checkout
 * sits relative to it is the operator's own state (and scenario ①/② of the doc-branch judgment — the
 * common case, and the one `--branch-model-only` must stay byte-identical on — is exactly a `reused`
 * baseline). `blocked` / `unreadable` never established anything to hand off.
 */
export function landingBaselineEstablishedNow(report: BranchModelReport): boolean {
  return report.entries.some(
    (e) => e.role === LANDING_BASELINE_ENTRY_ROLE && (e.action === "created" || e.action === "adopted"),
  );
}

/**
 * Move the MAIN CHECKOUT onto the landing baseline, but ONLY when that baseline already points at the
 * commit the checkout is on — i.e. when the move is provably a ref rename with zero tree effect.
 *
 * Call this AFTER `ensureBranchModel` reported the baseline as freshly established and BEFORE
 * `ensureDocBranch` judges the checkout; see this section's header for the gap it closes. It is
 * deliberately NOT folded into either of those two functions: `ensureBranchModel` is also run by the
 * full `quay init` (which has no doc-branch step, so it must not move the user's HEAD), and
 * `ensureDocBranch`'s judgment must stay blind to how `develop` came to be.
 */
export function moveCheckoutOntoLandingBaseline(root: string): BaselineCheckoutReport {
  const to = LANDING_BASELINE_ROLE;
  const notEvaluated = (detail: string): BaselineCheckoutReport => ({
    action: "not-evaluated",
    ok: true,
    notEvaluated: true,
    from: null,
    to,
    detail,
  });

  const insideRepo = git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (!insideRepo.ok || insideRepo.out.trim() !== "true") {
    return notEvaluated(`${root} is not inside a git work tree — there is no checkout to move`);
  }

  const from = resolveCheckedOutBranch(root);
  if (from === null) {
    return notEvaluated(
      "HEAD is detached (or the repository is unborn): no branch is checked out, so there is no " +
        "main-checkout position to move onto the landing baseline — ⛔ NOT treated as 'already there'.",
    );
  }
  if (from === to) {
    return {
      action: "already-on-baseline",
      ok: true,
      notEvaluated: false,
      from,
      to,
      detail: `the main checkout is already on '${to}' — nothing to switch`,
    };
  }

  const headSha = resolveSha(root, "HEAD");
  const baselineSha = resolveSha(root, to);
  if (headSha === null || baselineSha === null) {
    return notEvaluated(
      `the checked-out commit or '${to}' does not resolve — the switch cannot be shown to be ` +
        `metadata-only, so it is not attempted (the main checkout stays on '${from}')`,
    );
  }
  if (headSha !== baselineSha) {
    return notEvaluated(
      `'${to}' (${baselineSha.slice(0, 8)}) does not point at the checked-out commit ` +
        `(${headSha.slice(0, 8)}) — switching would move the main checkout onto a DIFFERENT tree, ` +
        `which is not this step's job (the main checkout stays on '${from}')`,
    );
  }

  const r = git(root, ["checkout", to]);
  if (r.ok !== true) {
    return {
      action: "failed",
      ok: false,
      notEvaluated: false,
      from,
      to,
      detail: `could not switch the main checkout from '${from}' to '${to}': git checkout returned non-zero: ${r.err}`,
    };
  }
  return {
    action: "switched",
    ok: true,
    notEvaluated: false,
    from,
    to,
    detail:
      `switched the main checkout from '${from}' to the landing baseline '${to}' — both point at ` +
      `${headSha.slice(0, 8)}, so the working tree is unchanged; the doc-branch judgment that runs ` +
      `next now sees the position it needs to establish the doc branch`,
  };
}

/**
 * One-line rendering for the operator (and the shell entry's failure relay token). The role token is
 * deliberately `baseline-checkout`, NOT `landing-baseline`: `verify-deliver-coldstart.sh`'s
 * `ac239_baseline_state` classifies the project by `grep -m1 'landing-baseline'` over the init
 * report, and a second line carrying that substring would make the classifier depend on line order
 * for no gain.
 */
export function formatBaselineCheckoutReport(report: BaselineCheckoutReport): string {
  const mark = report.notEvaluated
    ? "NOT-EVALUATED"
    : report.action === "failed"
      ? "FAILED"
      : report.action === "switched"
        ? "SWITCHED"
        : "NOOP";
  return `landing-baseline checkout (from: ${report.from ?? "(detached HEAD)"}, to: ${report.to}):\n  [${mark}] baseline-checkout — ${report.detail}`;
}

/**
 * One-line-per-state rendering for the operator (and the shell entry's `[BLOCKED] doc-branch`
 * relay token). The `doc-branch` role token is what `quay-init.sh` matches on — it is a POSITION in
 * the output, not a verdict recomputed downstream (the shell never re-judges; branch-model.ts owns
 * the judgment — ADR-004).
 */
export function formatDocBranchReport(report: DocBranchReport): string {
  // The MARKER describes what HAPPENED (the action), not what was classified (the state): an
  // adopted collision is `state: "blocked"` but must NOT print `[BLOCKED]` — the shell entry relays
  // that literal as a refusal (`quay-init.sh`'s `case`), and printing it for a successful adoption
  // would report a refusal for work that was carried out.
  const mark = report.notEvaluated
    ? "NOT-EVALUATED"
    : report.action === "blocked"
      ? "BLOCKED"
      : report.action === "failed"
        ? "FAILED"
        : report.action.toUpperCase();
  const lines = [
    `doc branch (name: ${report.name === "" ? "(none supplied)" : report.name}, landing baseline: ${LANDING_BASELINE_ROLE}):`,
    `  [${mark}] doc-branch -> ${report.name === "" ? "(none)" : report.name} — ${report.detail}`,
  ];
  // ── The main-checkout MOVE, named as its own summary line (AC2) ──────────────────────────────────
  // ⛔ This is NOT decoration and NOT a re-judgment (ADR-004): it renders the SAME `action` the line
  // above renders, read as the ONE fact an operator actually needs — WHICH branch their working copy
  // is now on, and what it was before. A `git checkout` of the main checkout is a side effect on the
  // user's own working position, and burying it inside a `[CREATED] …` sentence made it read as a
  // property of the branch rather than as a change to THEIR checkout: measured 2026-10-12 on a fresh
  // repository, the branch flipped `develop` → `author` between two runs with no summary line saying
  // so (gap-init-branch-model-runs-before-auto-commit-fresh-repo-needs-two-runs).
  // Only the four actions that MOVE it can print it; `noop`/`blocked`/`unreadable`/`failed` leave
  // the checkout where it was and must not claim otherwise.
  const movedCheckout =
    report.action === "created" ||
    report.action === "switched" ||
    report.action === "adopted" ||
    report.action === "fast-forwarded";
  if (movedCheckout && report.checkedOut !== null) {
    lines.push(
      `  main checkout: ${report.checkedOut} -> ${report.name}` +
        (report.dryRun
          ? " (WOULD MOVE — this run was a plan; the working copy is still on the left-hand branch)"
          : " (this working copy was switched)"),
    );
  }
  return lines.join("\n");
}

// ── THE STANDING DOC-BRANCH INVARIANT CHECK ─────────────────────────────────────────────────────
// (gap-quay-init-declined-auto-commit-leaves-doc-branch-unenforced)
//
// ============================ WHY THIS EXISTS ============================
// `ensureDocBranch` above ESTABLISHES the invariant, but only on the runs that call it. `quay init`
// calls it before any write and re-calls it after the auto-commit on an unborn repository — so the
// two paths the previous tasks closed are: (a) a repo that already had a commit when init ran;
// (b) a repo whose first commit init's OWN auto-commit created.
//
// The third path has no owner: on a non-interactive run `autoCommitClosedSet` DECLINES (it must not
// silently commit a working tree it did not create), so init writes the config, `ensureDocBranch`
// truthfully reports NOT-EVALUATED on the still-unborn HEAD, and the run ends. If the first commit
// is then created by SOMEBODY ELSE — an autonomous loop's observer session, or a human — nothing
// ever judges the checkout again. Measured 2026-10-21 on a third-party project: the first commit
// (`quay workspace laydown: init six-file config surface`) was authored by an observer session, the
// main checkout sat on `develop`, no doc branch existed, and the config carried no `loop.doc_branch`.
// The invariant was broken with zero trace of it ever having been evaluated.
//
// ============================ WHAT THIS FUNCTION IS ============================
// The READ-ONLY half of the same judgment `ensureDocBranch` acts on, expressed as a standing
// INVARIANT rather than as an action: "when the main checkout is on the landing baseline and the
// repository HAS a commit, some OTHER branch must be carrying the doc role". It is safe to run on
// every init and from a check verb — it mutates nothing (no branch created, HEAD not moved, no file
// written) — which is what lets it be a resident reading instead of a one-shot step.
//
// FIVE STATES, never a boolean (hard rule 3):
//   satisfied     — the checkout is NOT on the landing baseline; nothing to do (the negative control:
//                   a project already on its doc branch must read as OK, not as "no violation found").
//   violated      — the checkout IS on the baseline, a commit exists, and no usable doc branch is
//                   carrying the role. `ok: false`; the caller's exit code is non-zero.
//   behind        — the checkout is ON the doc branch, but that branch is BEHIND the landing baseline:
//                   the working copy is parked on an older tree. `ok: false`; exit non-zero. Its own
//                   state (gap-quay-init-doc-branch-behind-baseline-reports-satisfied), never folded
//                   into `satisfied`.
//   pending       — the checkout is on the baseline but the repository has ZERO commits (the state
//                   init's declined auto-commit leaves behind). ⛔ NOT satisfied: a doc branch cannot
//                   be forked from a commit that does not exist, and the next external commit would
//                   make this a `violated` state with nobody watching. ⛔ NOT a failure either — the
//                   caller exits 0 and carries the state separately (hard rule 3b).
//   not-evaluated — detached/unborn HEAD we cannot name, no doc-branch name supplied, or a
//                   non-git directory. Verdict WITHHELD; never `satisfied`.
//
// ⛔ The NAME is an input (`opts.name`), exactly as in `ensureDocBranch` — this module names no doc
// branch of its own. The caller resolves it with the shipped precedence (CLI flag → the target's
// `loop.doc_branch` → the caller's convention; see `init.ts` `resolveDocBranchName`).

/**
 * Judge the standing doc-branch invariant at `root`. READ-ONLY: it runs `git` queries and nothing
 * else — no branch is created, HEAD is not moved, no file is written. See the section header for the
 * five states and the three init paths this closes.
 */
export function checkDocBranchInvariant(root: string, opts: DocBranchInvariantOptions): DocBranchInvariantReport {
  const name = (opts.name ?? "").trim();
  const baseline = LANDING_BASELINE_ROLE;
  const report = (
    state: DocBranchInvariantState,
    reason: DocBranchInvariantReason,
    detail: string,
    extra: {
      checkedOut?: string | null;
      docBranchSha?: string | null;
      behindBaseline?: number | null;
      remedy?: string | null;
    } = {},
  ): DocBranchInvariantReport => ({
    state,
    ok: state !== "violated" && state !== "behind",
    notEvaluated: state === "not-evaluated",
    reason,
    checkedOut: extra.checkedOut ?? null,
    baseline,
    docBranch: name,
    docBranchSha: extra.docBranchSha ?? null,
    behindBaseline: extra.behindBaseline ?? null,
    detail,
    remedy: extra.remedy ?? null,
  });

  const insideRepo = git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (!insideRepo.ok || insideRepo.out.trim() !== "true") {
    return report("not-evaluated", "not-a-git-worktree", `${root} is not inside a git work tree — the invariant is not judged there`);
  }

  const checkedOut = resolveCheckedOutBranch(root);
  if (checkedOut === null) {
    return report(
      "not-evaluated",
      "detached-head",
      "HEAD is detached: the main checkout is on no branch, so 'is it on the landing baseline?' has no answer — ⛔ NOT treated as satisfied",
    );
  }

  // ① The invariant already holds: the checkout is somewhere other than the landing baseline.
  //    ⛔ Checked BEFORE the commit count and BEFORE the name: whether it holds is knowable without
  //    either, and a project that is already off the baseline gets its true answer with no config.
  //    ⛔ ONE exception (gap-quay-init-doc-branch-behind-baseline-reports-satisfied): being OFF the
  //    baseline is NOT automatically OK when the checkout sits on the doc branch ITSELF and that
  //    branch is BEHIND the baseline — that is the main checkout silently parked on an older tree,
  //    the exact production risk the invariant exists to surface. `behind` is its own state.
  if (checkedOut !== baseline) {
    if (name !== "" && name !== baseline && checkedOut === name) {
      const docBranchSha = resolveSha(root, name);
      const behind =
        docBranchSha !== null && isAncestor(root, name, baseline) === true
          ? revCount(root, name, baseline)
          : null;
      if (behind !== null && behind > 0) {
        return report(
          "behind",
          "doc-branch-behind-baseline",
          `the main checkout is on the doc branch '${name}' (${docBranchSha!.slice(0, 8)}) which is ` +
            `${behind} commit(s) BEHIND the landing baseline '${baseline}' — the working copy is on an older tree`,
          { checkedOut, docBranchSha, behindBaseline: behind },
        );
      }
      // The negative control: same tip (or otherwise not behind) is STILL satisfied, with the READ
      // amount on the report — never a null masquerading as "not assessed" when it WAS assessed.
      if (behind !== null) {
        return report(
          "satisfied",
          "not-on-baseline",
          `the main checkout is on '${checkedOut}', not the landing baseline '${baseline}' — the doc-branch invariant holds`,
          { checkedOut, docBranchSha, behindBaseline: behind },
        );
      }
    }
    return report(
      "satisfied",
      "not-on-baseline",
      `the main checkout is on '${checkedOut}', not the landing baseline '${baseline}' — the doc-branch invariant holds`,
      { checkedOut },
    );
  }

  // ② On the baseline. A repository with no commit cannot fork a doc branch from it: this is the
  //    state a DECLINED init auto-commit leaves behind, and it is `pending`, never `satisfied`.
  const headSha = resolveSha(root, "HEAD");
  if (headSha === null) {
    return report(
      "pending",
      "no-commits-yet",
      `the main checkout is on '${baseline}' but the repository has NO commits yet, so no doc branch ` +
        `can be created from it — the invariant is UNESTABLISHED (pending), not satisfied`,
      {
        checkedOut,
        remedy:
          `commit the laid-down workspace (any commit on '${baseline}'), then run ` +
          `\`quay init --doc-branch-name ${name === "" ? "<name>" : name}\` — or \`git checkout -b ${name === "" ? "<name>" : name}\` on the unborn HEAD`,
      },
    );
  }

  if (name === "") {
    return report(
      "not-evaluated",
      "no-doc-branch-name",
      "no doc-branch name was supplied — refusing to invent one (a branch name invented in the " +
        "judgment layer is the per-project identity literal target-identity-literal-check.ts fails RED on). " +
        "Pass it in: `--doc-branch-name <name>`, or `loop.doc_branch` in .quay/config.yml",
      { checkedOut },
    );
  }
  if (name === baseline) {
    return report(
      "not-evaluated",
      "doc-branch-is-baseline",
      `the requested doc-branch name '${name}' IS the landing baseline — there is no second ref to judge, so no verdict is issued`,
      { checkedOut },
    );
  }

  const remedy = `quay init --doc-branch-name ${name}`;
  const docBranchSha = resolveSha(root, name);

  // ③ The checkout sits on the baseline and the doc branch does not exist: the exact plantuml-js
  //    shape (external first commit, no doc branch, config without `loop.doc_branch`).
  if (docBranchSha === null) {
    return report(
      "violated",
      "on-baseline-no-doc-branch",
      `the doc-branch invariant is violated: the main checkout is on the landing baseline '${baseline}' ` +
        `(HEAD ${headSha.slice(0, 8)}) and the doc branch '${name}' does not exist — human edits and the ` +
        `driver's own commits share one branch and one git index`,
      { checkedOut, remedy },
    );
  }

  // ④ The doc branch exists. It is still a violation (the checkout should be ON it), but the reason
  //    differs by ancestry: a related branch is switched to, an unrelated one is a name collision
  //    that `--adopt-branch-model` must decide explicitly.
  const nameContainsBaseline = isAncestor(root, baseline, name);
  const baselineContainsName = isAncestor(root, name, baseline);
  if (nameContainsBaseline === null || baselineContainsName === null) {
    return report(
      "not-evaluated",
      "ancestry-undecidable",
      `doc branch '${name}' exists (${docBranchSha.slice(0, 8)}) but its ancestry with '${baseline}' could not be decided — refusing to call it related or a collision`,
      { checkedOut, docBranchSha },
    );
  }
  if (!nameContainsBaseline && !baselineContainsName) {
    return report(
      "violated",
      "on-baseline-doc-branch-collision",
      `the doc-branch invariant is violated: the main checkout is on '${baseline}' and '${name}' ` +
        `(${docBranchSha.slice(0, 8)}) shares NO ancestry with it — a name collision, not a doc branch; ` +
        `switching onto it would move the edit surface onto a foreign line`,
      { checkedOut, docBranchSha, remedy: `${remedy} --adopt-branch-model` },
    );
  }
  // The related-branch case carries the lag reading too: a doc branch that exists but is BEHIND the
  // baseline is the older-tree shape the checkout must not be moved onto silently. `behindBaseline`
  // is read only when `baselineContainsName` (name is the baseline's ancestor / same tip); otherwise
  // the "behind" quantity is not the question this branch answers and it stays null.
  const behindBaseline = baselineContainsName ? revCount(root, name, baseline) : null;
  const behindClause = behindBaseline !== null && behindBaseline > 0
    ? ` (⚠️ it is ${behindBaseline} commit(s) BEHIND '${baseline}')`
    : "";
  return report(
    "violated",
    "on-baseline-doc-branch-elsewhere",
    `the doc-branch invariant is violated: the main checkout is on the landing baseline '${baseline}' ` +
      `while the related doc branch '${name}' (${docBranchSha.slice(0, 8)}) exists — the working copy ` +
      `must be ON it, or human edits and the driver's commits share one branch and one index${behindClause}`,
    { checkedOut, docBranchSha, behindBaseline, remedy },
  );
}

/**
 * One-line rendering for the operator AND for a script: the marker + the enumerated reason make the
 * line machine-readable (`grep 'doc-branch-invariant: VIOLATED'`), never a prose sentence whose
 * verdict must be parsed out. ⛔ `PENDING` and `NOT-EVALUATED` are distinct markers — collapsing
 * either into `SATISFIED` is the hard-rule-3b failure this whole check exists to avoid.
 */
export function formatDocBranchInvariantReport(report: DocBranchInvariantReport): string {
  const mark =
    report.state === "violated"
      ? "VIOLATED"
      : report.state === "behind"
        ? "BEHIND"
        : report.state === "pending"
          ? "PENDING"
          : report.state === "not-evaluated"
            ? "NOT-EVALUATED"
            : "SATISFIED";
  const head = `doc-branch-invariant: ${mark} (reason: ${report.reason}) — ${report.detail}`;
  return report.remedy ? `${head}; remedy: ${report.remedy}` : head;
}

// ── GOAL BRANCH role (orchestration/SPEC-goal-branch-2026-10-03.md §4.1/§4.2) ─────────────────────
//
// A goal may opt in to its own isolation branch (`branch: true` on the goal record): its tasks land
// on `goal/<GOAL-NNN>` instead of directly on `develop`, so a direction with a different maturity
// level stops mixing into the release line. This section owns the ONE place the branch is created
// and the ONE place it is discarded — `goal-store.write()` is the only caller of each, because the
// goal record's status flip is the only event that may create or discard the ref (§4.1: the field is
// mutable only while the branch does not exist; §4.2: retired/superseded discards it).
//
// ⛔ The name is DERIVED, never stored (hard rule 4b): `goal/<GOAL-NNN>`. Storing it would let a
// human point a goal at an arbitrary branch, and it is exactly that constraint that makes
// `target-identity-literal-check.ts`'s "pattern + existence" rule (§4.8) decidable.

/**
 * The goal-branch name for a goal id — a DERIVED quantity (⛔ never persisted, ⛔ never caller-supplied).
 *
 * @param goalId the GOAL record id (e.g. `GOAL-028`).
 */
export function goalBranchName(goalId: string): string {
  return `goal/${goalId}`;
}

/** True iff `value` is a goal-branch token; returns the GOAL id it names, or null. */
export function goalIdFromBranchToken(value: string): string | null {
  if (!GOAL_BRANCH_RE.test(value)) return null;
  return value.slice("goal/".length);
}

/**
 * True iff `goal/<id>` resolves to a commit in `root`. Read-only; false when the repo is unknown
 * (⛔ not a "no branch" claim — callers that must distinguish use `ensureGoalBranch`'s report).
 */
export function goalBranchRefExists(root: string, goalId: string): boolean {
  const r = git(root, ["rev-parse", "--verify", "--quiet", `${goalBranchName(goalId)}^{commit}`]);
  return r.ok && r.out.trim() !== "";
}

/**
 * The tip sha of `goal/<id>`, or null when the ref does not resolve. This is the value the store
 * writes into the discarded goal's statusLog before deleting the branch — the ONE rescue handle for
 * a human (`git branch <name> <sha>`), so it must be read BEFORE the deletion (§4.2).
 */
export function goalBranchTip(root: string, goalId: string): string | null {
  return resolveSha(root, goalBranchName(goalId));
}

/**
 * LAZILY create `goal/<id>` from the CURRENT `develop` tip — idempotent: an existing ref is reported
 * `reused` and left untouched (its tip may have advanced with landed tasks; re-pointing it would
 * throw that work away).
 *
 * ⛔ This is the ONE creation call site (invoked only by `goal-store.write()` on the transition that
 * leaves a branch-mode goal `active`). A goal's branch must NOT be created at birth: a draft goal may
 * sit unactivated for a long time, and a branch forked from a stale develop is worse than none.
 *
 * A repo with no resolvable `develop` (or no git at all) is reported `unreadable`/`blocked` and
 * nothing is created — ⛔ never a silent fallback to HEAD, which would fork the goal from a
 * tree the landing baseline never contained.
 */
export function ensureGoalBranch(root: string, goalId: string): GoalBranchReport {
  const name = goalBranchName(goalId);
  const base0 = { name, sha: null as string | null, base: null as string | null };
  const unreadable = (detail: string): GoalBranchReport => ({
    ...base0, action: "unreadable", ok: true, notEvaluated: true, detail,
  });

  const insideRepo = git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (!insideRepo.ok || insideRepo.out.trim() !== "true") {
    return unreadable(`${root} is not inside a git work tree — '${name}' cannot be created there`);
  }

  const existing = resolveSha(root, name);
  if (existing !== null) {
    return {
      ...base0, action: "reused", ok: true, notEvaluated: false, sha: existing,
      detail: `'${name}' already exists at ${existing.slice(0, 8)} — reused, ⛔ never re-pointed`,
    };
  }

  const base = resolveSha(root, LANDING_BASELINE_ROLE);
  if (base === null) {
    return unreadable(
      `'${name}' does not exist and the landing baseline '${LANDING_BASELINE_ROLE}' does not ` +
        `resolve — the goal branch cannot be forked from a ref that is not there (⛔ not fallen back to HEAD)`,
    );
  }
  const created = git(root, ["branch", name, base]);
  // `=== true`, not `!created.ok`: this repo's root tsconfig is `strict: false`, under which the
  // NEGATIVE branch of a boolean-discriminant union is NOT narrowed — `created.err` below would be
  // TS2339, which the fan-in ts-typecheck gate rejects. Same form as every other `.ok` union here.
  if (created.ok === false) {
    return {
      ...base0, action: "blocked", ok: false, notEvaluated: false,
      detail: `could not create '${name}' at ${base.slice(0, 8)}: git branch returned non-zero: ${created.err}`,
    };
  }
  return {
    ...base0, action: "created", ok: true, notEvaluated: false, sha: base, base,
    detail: `created '${name}' at '${LANDING_BASELINE_ROLE}' tip ${base.slice(0, 8)}`,
  };
}

/**
 * DISCARD `goal/<id>`: delete the ref and return its tip sha (the rescue handle the caller has
 * already written into the goal's statusLog before calling this).
 *
 * ⛔ This is the ONE deletion call site (invoked only by `goal-store.write()` / `flipGoal()` when a
 * branch-mode goal transitions to `retired`/`superseded`). `tipSha: null` means there was nothing to
 * delete (a non-branch goal, or one already discarded) — a NORMAL result, ⛔ not an error.
 *
 * The ref is deleted with `-D` (force): a discarded direction's work is deliberately unmerged, so an
 * ancestry-based refusal would leave exactly the branches this mechanism exists to remove. When the
 * ref is checked out in a worktree git refuses the delete and `removed` stays false with a reason —
 * the caller surfaces it (硬规则 3b) rather than reporting a discard that did not happen.
 */
export function discardGoalBranch(
  root: string,
  goalId: string,
): { removed: boolean; tipSha: string | null; detail: string } {
  const name = goalBranchName(goalId);
  const tipSha = resolveSha(root, name);
  if (tipSha === null) {
    return { removed: false, tipSha: null, detail: `'${name}' does not exist — nothing to discard` };
  }
  const del = git(root, ["branch", "-D", name]);
  // `=== false`, not `!del.ok` — see the narrowing note in ensureGoalBranch above.
  if (del.ok === false) {
    return {
      removed: false,
      tipSha,
      detail: `could not delete '${name}' (tip ${tipSha.slice(0, 8)}): git branch -D returned non-zero: ${del.err}`,
    };
  }
  return { removed: true, tipSha, detail: `deleted '${name}' (tip ${tipSha})` };
}
