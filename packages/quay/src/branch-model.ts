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

/**
 * The landing baseline's quay role name — the SAME literal the shipped mechanism reads.
 *
 * `develop` is a PROTOCOL-FIXED git ref (it is in `target-identity-literal-check.ts`'s
 * `LEGAL_IDENTITY_VALUES` alongside `integration`/`master`/`HEAD`), so naming it here is not a
 * per-project identity assumption. The DOC branch role is the opposite case — see
 * `resolveDocBranchRole` below.
 */
export const LANDING_BASELINE_ROLE = "develop";

/** Classification of ONE branch against the project's default branch. */
export type RefState = "absent" | "compatible" | "divergent" | "unreadable";

export interface RefClassification {
  /** The branch name that was classified (a quay ROLE name, e.g. `develop`). */
  name: string;
  state: RefState;
  /** Resolved sha of the branch, or null when absent/unreadable. */
  sha: string | null;
  /** Commits on the branch that the default branch does not contain (null when unknown). */
  aheadOfDefault: number | null;
  /** Commits on the default branch that the branch does not contain (null when unknown). */
  behindDefault: number | null;
  /** Always populated — the machine-readable cause (`absent`, `contains-default`, `foreign-fork`, …). */
  reason: string;
  /** Human-readable detail for the operator (never the sole carrier of `state`). */
  detail: string;
}

/** What `quay init` did (or would do) to one role branch. */
export type BranchAction = "created" | "reused" | "adopted" | "blocked" | "unreadable";

export interface BranchModelEntry {
  /** The quay role (`develop` | `author`) or `default` for the project's own default branch. */
  role: string;
  /** The concrete ref that fills the role. */
  ref: string;
  action: BranchAction;
  /** Sha the ref points at after the operation (null when it could not be resolved). */
  sha: string | null;
  /** Backup ref created by `adopt` (the preserved pre-quay tip), else null. */
  backupRef: string | null;
  detail: string;
}

export interface BranchModelReport {
  /** False iff any entry is `blocked` (a divergent branch without `adopt`) — init must not proceed. */
  ok: boolean;
  /** True when the repo could not be classified at all (no git / no commits) — provisioning skipped. */
  skipped: boolean;
  /** The project's default branch (`master` role), or null when unresolvable. */
  defaultBranch: string | null;
  entries: BranchModelEntry[];
  /** Operator-facing next step when `ok === false`. */
  remedy: string | null;
}

export interface EnsureBranchModelOptions {
  /** Copy the divergent branch aside and re-point it at the default tip (opt-in, never default). */
  adopt?: boolean;
  /** Plan only — classify and report, mutate nothing. */
  dryRun?: boolean;
}

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

/** True iff `ancestor` is reachable from `descendant` (`git merge-base --is-ancestor`). */
function isAncestor(root: string, ancestor: string, descendant: string): boolean | null {
  try {
    execFileSync("git", ["-C", root, "merge-base", "--is-ancestor", ancestor, descendant], {
      timeout: 20_000,
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true; // exit 0
  } catch (e) {
    // exit 1 === "not an ancestor" (a MEASURED negative); any other failure === could not tell.
    const status = (e as { status?: number }).status;
    if (status === 1) return false;
    return null;
  }
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
    { role: "landing-baseline", name: LANDING_BASELINE_ROLE },
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
    defaultBranch,
    entries,
    remedy:
      blocked.length === 0
        ? null
        : `Re-run with branch adoption enabled to preserve the existing branch(es) and re-point them at ` +
          `${defaultBranch ?? "the default branch"}: CLI \`quay init --force --adopt-branch-model\` ` +
          `(or the /quay:init skill with branch adoption). The existing tips are kept under ` +
          `<branch>-pre-quay-init-<sha> — nothing is destroyed.`,
  };
}

/** One-line-per-entry rendering shared by the CLI and the task-body evidence. */
export function formatBranchModelReport(report: BranchModelReport): string {
  if (report.skipped) {
    return `branch model: SKIPPED — ${report.entries[0]?.detail ?? "repository not classifiable"}`;
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

/** The doc-branch role's state relative to the landing baseline. A CLASSIFICATION, never a boolean
 *  (hard rule 3): `blocked` and `unreadable` are both non-empty answers but only one of them is a
 *  refusal. */
export type DocBranchState =
  /** ①/②: the main checkout is NOT on the landing baseline — the invariant already holds. */
  | "independent"
  /** ①: the main checkout IS on the landing baseline and no branch carries the requested name. */
  | "absent"
  /** ①: the main checkout IS on the landing baseline and a RELATED branch carries the name. */
  | "reusable"
  /** ①: the name is taken by a branch with NO ancestry relation to the baseline — a real collision. */
  | "blocked"
  /** HEAD detached/unborn, not a work tree, or undecidable ancestry — verdict WITHHELD. */
  | "unreadable";

/** What the operation did (or would have done). Kept apart from `DocBranchState` so a mutation that
 *  FAILED is not silently reported as the classification it failed to act on, and so an `adopted`
 *  collision (`state: "blocked"`, `action: "adopted"`) does not print the refusal marker the shell
 *  relays on. */
export type DocBranchAction = "created" | "switched" | "noop" | "blocked" | "adopted" | "unreadable" | "failed";

export interface DocBranchReport {
  state: DocBranchState;
  action: DocBranchAction;
  /** False ONLY for a real refusal or a failed mutation — `unreadable` is NOT a failure. */
  ok: boolean;
  /** True iff the verdict was withheld (`state === "unreadable"`) — distinct from `ok === true`. */
  notEvaluated: boolean;
  /** The requested doc-branch name (echoed verbatim; never invented here). */
  name: string;
  checkedOut: string | null;
  baselineSha: string | null;
  /** Sha of the named branch BEFORE the operation (null when it did not exist). */
  preexistingSha: string | null;
  /** The doc branch's sha AFTER the operation (null when nothing was established). */
  sha: string | null;
  detail: string;
}

export interface EnsureDocBranchOptions {
  /**
   * The doc-branch name to establish — REQUIRED, and the caller owns its default. Empty/absent is
   * reported as `unreadable`, never silently defaulted (see this section's header).
   */
  name: string;
  /** Plan only — classify and report, mutate nothing (no branch created, HEAD not moved). */
  dryRun?: boolean;
  /**
   * The NAME-COLLISION decision, opt-in and never default. False ⇒ a branch carrying `name` that
   * shares no ancestry with the baseline is REFUSED (`state: "blocked"`, nothing moved). True ⇒ the
   * SAME adopt primitive `ensureBranchModel` uses for a divergent landing baseline: preserve the
   * colliding tip under `<name>-pre-quay-init-<sha>`, re-point `name` at the baseline, switch to it.
   * Nothing is destroyed either way; this flag only decides whether the operator's decision is
   * carried out or handed back to them. ⛔ Not to be confused with the landing-baseline role's
   * `adopt`: both are the SAME declared decision (`--adopt-branch-model`), applied to two roles.
   */
  adopt?: boolean;
}

/**
 * Establish the doc-only work branch in `root`: when the main checkout is sitting ON the landing
 * baseline, put the main checkout on a doc branch so human edits and driver commits stop sharing one
 * branch and one index.
 *
 * Four states, each its own answer (this is what AC1 pins):
 *   - main checkout already OFF the landing baseline (whatever its name) ⇒ `independent`, NO-OP.
 *   - ON the baseline, name free ⇒ create that branch AT THE BASELINE'S TIP and switch to it; the
 *     tree is byte-identical (same commit), so this is pure git metadata.
 *   - ON the baseline, name taken by a RELATED branch ⇒ switch to it (the existing doc branch wins;
 *     ⛔ never renamed, never re-pointed).
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
    name,
    checkedOut: null as string | null,
    baselineSha: null as string | null,
    preexistingSha: null as string | null,
    sha: null as string | null,
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

  if (dryRun) {
    return {
      ...base,
      state: "reusable",
      action: "switched",
      ok: true,
      notEvaluated: false,
      sha: preexistingSha,
      detail: `would switch the main checkout to the existing related branch '${name}' (${preexistingSha.slice(0, 8)}) — unchanged, never renamed or re-pointed`,
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
        ? `switched the main checkout to the existing related branch '${name}' (${preexistingSha.slice(0, 8)}) — unchanged, never renamed or re-pointed`
        : `could not switch to the existing branch '${name}': git checkout returned non-zero: ${r.err}`,
  };
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
  return [
    `doc branch (name: ${report.name === "" ? "(none supplied)" : report.name}, landing baseline: ${LANDING_BASELINE_ROLE}):`,
    `  [${mark}] doc-branch -> ${report.name === "" ? "(none)" : report.name} — ${report.detail}`,
  ].join("\n");
}
