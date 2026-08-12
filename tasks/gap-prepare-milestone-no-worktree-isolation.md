---
id: gap-prepare-milestone-no-worktree-isolation
title: prepare-milestone has no per-milestone worktree isolation
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
  superseded: true
  superseded_at: 2026-08-12
---
**type:** execution
> **SUPERSEDED / 作废（人 2026-08-12 00:4x 裁定，B 组）**：本任务引用 ADR-022 已物理删除的机制（prepare-milestone.js / execute-milestone.js 等），剩余 AC 要求针对已被删除的 pipeline 取证，**前提已不存在**——不是「完成」是「作废」。历史记录保留，不重开。引用已删机制：prepare-milestone.js + execute-milestone.js + milestone-worktree.ts。

**ADR-022 RE-TRIAGE (2026-08-04, gap-ready-queue-still-lists-eight-tasks-targeting-retired-pipeline-files):**
status `ready` → `needs-human`. This task is about `prepare-milestone.js`'s per-milestone worktree
isolation, which ADR-022 explicitly RETIRED: CLAUDE.md's retirement notice states "`prepare-milestone.js`
also supported the SAME opt-in `isolationMode: 'worktree'` (gap-prepare-milestone-no-worktree-isolation,
M252) — RETIRED under ADR-022 (the file is deleted; kept as historical record)". Its `## Touches` are
2/3 files that no longer exist (`.claude/workflows/prepare-milestone.js` +
`plugin/workflows/prepare-milestone.js`; only `CLAUDE.md` remains). The mechanism it describes
(milestone-worktree.ts isolation) was superseded by the two-layer fast mode's direct `git worktree add`
per task. Real-run resolve evidence (worktree branch, 2026-08-04):
```
$ node --no-warnings --experimental-strip-types plugin/scripts/touches-orthogonality-check.ts --resolve tasks/gap-prepare-milestone-no-worktree-isolation.md --root "$(pwd)"
  MISSING: .claude/workflows/prepare-milestone.js
  MISSING: plugin/workflows/prepare-milestone.js
  ok: CLAUDE.md
RESOLVE tasks/gap-prepare-milestone-no-worktree-isolation.md: 2/3 non-(new) touches missing — MAJORITY-MISSING (NOT dispatchable)
```
Disposition: needs-human — the target pipeline is retired, scope no longer applies.

**CLOSEOUT STATUS (2026-08-02, dev-session-handoff-2026-08-02b item 3):** the mechanism IS landed —
`prepare-milestone.js` accepts `isolationMode: 'worktree'`, creates a real worktree via
`milestone-worktree.ts --add` before Admission, routes content phases through
`_worktreeIsolationNote`, and prepare-merge commits + merges + removes (verified by the
task-status-drift-check detector: 11/12 symbols resolve; the mechanism is in the tree). It stays
**ready** because the ACs demand REAL DISPATCH verification that fast-mode direct execution cannot
produce: a real prepare-milestone dispatch with `isolationMode:'worktree'` under the outer loop
proving AC2 (zero primary diffs until merge), AC3 (exactly one merge commit), AC4 (single-task
dispatch → prepared receipt + clean merge), AC7 (clean-stale recovery on a real stranded worktree),
AC8 (concurrent return shape). The mechanical sub-parts (milestone-worktree.ts `--add`/`--clean-stale`/
`--merge`/`--remove`) have unit coverage in `experiments/quay-perpetual-stream/test/milestone-worktree.test.mjs`.
What is missing before `done`: the real-dispatch proof of AC2/AC3/AC4/AC7/AC8 (and AC1's golden-replay
verification under the prepare workflow's own mocks).

## Proposal

**Problem framing:** `prepare-milestone.js` currently operates directly on the shared working tree (`master`) with no isolation boundary. Every phase -- Admission, Preflight, ProposalAuthors, Adjudicate, ProposalReview, PlanAuthor, PlanCheck, Receipt -- edits task bodies (via `task_write` in the Adjudicate phase), writes plan files (`docs/plans/M<NN>-<slug>.md` in the PlanAuthor phase), creates receipts and ledgers (`milestones/M<NN>/preparation.json` + `proposal-ledger.json` + `mechanism-inventory.json` in the Receipt phase), and writes checkpoints (`.quay/prepare-checkpoints/_input-*.json` in the ProposalReview phase) directly on the primary checkout. There is no git-level isolation boundary.

The direct consequence: two file-disjoint prepare-milestone tasks CANNOT run concurrently, even though their Touches are perfectly disjoint (different task files, different milestone directories). The reason is the shared working tree itself -- uncommitted state from one dispatch (intermediate file writes, git index entries) can be swept by the other dispatch's operations. The concrete incident: M211's staged Build commit was swept by M212's prepare-milestone via broad `git add` on the shared working tree, causing the `.halt` that paused the loop.

The secondary consequence: serializing prepare for every candidate in a multi-milestone batch adds significant wall-clock time (each prepare generation consumes ~30-60 minutes of LLM agent turns), since OUTER-LOOP.md step `forall c in batch: prepare(c)` must run strictly one-at-a-time.

`execute-milestone.js` already solved this exact class of problem for its own Build/Audit/Gate phases via DIR-123's opt-in per-milestone `git worktree` isolation. This proposal extends that SAME mechanism to `prepare-milestone.js`.

**Chosen mechanism:** Add opt-in `isolationMode: 'worktree'` to `prepare-milestone.js`, mirroring DIR-123's `execute-milestone.js` pattern. When present and valid:

1. **Create worktree before Admission:** A real `git worktree` at `milestones/M<NN>/worktrees/iteration-0` on branch `milestone/M<NN>/iteration-0` is created via the EXISTING `milestone-worktree.ts --add` CLI PRIOR to the first content-agent dispatch. Creation failure (path-exists, branch-exists) triggers the existing `--clean-stale` recovery path; persistent failure returns `needs-human` without ever acquiring the Admission lease. The worktree path is the SAME as `execute-milestone.js`'s -- prepare always completes (and worktree is removed by prepare-merge) before execute starts for the same milestone (OUTER-LOOP.md stages: SELECT -> prepare -> execute), so no collision occurs in practice. For DIFFERENT milestones, the paths differ (M222 vs M223).

2. **Coordination-vs-content boundary:** The Admission lease (`.quay/prepare-admission/`), epoch records, generation telemetry, and split-decision records are COORDINATION primitives that must be visible across dispatches -- they stay in the primary checkout, unchanged. Task body edits, plan files, receipt files, ledger files, inventory files, and ProposalReview checkpoints are CONTENT outputs -- they happen EXCLUSIVELY in the worktree. This is the EXACT same boundary `execute-milestone.js` uses (leases/land-locks stay primary; Build edits go to worktree).

3. **Thread worktree path through content-agent dispatches:** A `_worktreeIsolationNote` string is prepended into EVERY content-agent prompt. When worktree isolation is off, `_worktreeIsolationNote === ''` (the empty string), structurally guaranteeing byte-for-behavior golden replay. When isolation is on, the note instructs agents to `cd` to the worktree path before all file operations. The note is defined ONCE as a module-level constant and referenced at every dispatch site -- grep-confirmable coverage, never a per-site hand-edit. Under worktree isolation, agents must NOT use the MCP `task_write`/`task_get` tools for task body edits (the MCP server resolves `tasks_dir` against the primary checkout's `.quay/config.yml` at server startup). Instead, the `_worktreeIsolationNote` instructs agents to use `quay-native` CLI commands (`quay-native task edit`, `quay-native task show`, or direct file reads/writes from within the worktree).

4. **prepare-merge step:** After Receipt passes (outcome `prepared`), and AFTER the Admission lease has been released, a NEW `prepare-merge` step: (a) commits all worktree changes (`git -C <worktree> add -A && git -C <worktree> commit -m "prepare: <taskId> proposal + plan + receipt (DIR-XXX worktree isolation)"`), (b) merges the worktree branch into the primary checkout via `milestone-worktree.ts --merge --no-ff`, and (c) removes the worktree via `--remove`. On merge conflict: auto-aborts (`git merge --abort`), leaves the worktree intact for human inspection, and returns `needs-human` with `prepare-merge-conflict` + conflict file list. The merge runs after lease release -- a merge failure does not strand the lease.

**Concrete control/data flow:**

```
$args.isolationMode ?== 'worktree'
  |-- omitted/empty/unknown -> _worktreeIsolationNote = '' (golden-replay, 0 diffs)
  '-- 'worktree' + numeric milestone -> derive isolation plan:
        worktreeRel = milestones/M<NN>/worktrees/iteration-0
        branch = milestone/M<NN>/iteration-0
        (inline mirror of milestone-worktree.ts's computeIsolationPlan,
         SAME pattern execute-milestone.js already uses)

if (isolation requested but unusable):
  -> return needs-human, phase:Verify (FAIL CLOSED; never silently fall back)

if _useWorktree:
  |-- agent dispatch: milestone-worktree.ts --add
  |     failure + clean-stale -> retry once
  |     persistent failure -> needs-human (no lease held)
  '-- _worktreeIsolationNote = "WORKTREE ISOLATION (DIR-XXX): ..."

Admission: SAME lease acquire against PRIMARY checkout .quay/prepare-admission/
           _worktreeIsolationNote NOT threaded (Admission is coordination, not content)

Preflight -> ProposalAuthors -> Adjudicate -> ProposalReview -> PlanAuthor -> PlanCheck -> Receipt:
  ALL content-agent dispatches carry _worktreeIsolationNote
  Task edits (Adjudicate task_write, reviser task_write):
    agent cds to worktree, reads/writes task file via quay-native CLI or direct file ops
  Plan file, receipt file, ledger file, checkpoint files: written in worktree's copy
  Phase renewal/dispatch: runs against PRIMARY checkout's lease (unchanged)

if outcome === 'prepared':
  |-- Commit worktree: git -C <worktree> add -A && git -C <worktree> commit
  |-- prepare-merge: milestone-worktree.ts --merge (--no-ff on primary)
  |     conflict -> auto-abort, needs-human
  '-- milestone-worktree.ts --remove (cleanup)

if outcome !== 'prepared' (any terminal exit):
  lease released (PRIMARY), worktree STRANDED
  next retry: --clean-stale removes if 0-ahead, refuses if has-commits
```

**Key design decisions:**

1. **Reuse milestone-worktree.ts as the single source of truth (D1).** The worktree path derivation (`milestoneRootRel`, `worktreeRelPath`, `worktreeBranch`), real git operations (`addWorktree`, `mergeWorktree`, `removeWorktree`, `cleanStaleWorktree`), and the inline mirror in the workflow ALL reuse the EXISTING module that `execute-milestone.js` already uses. No new worktree script, no new path derivation. The inline mirror in `prepare-milestone.js` is the SAME documented pattern (`computeIsolationPlan` copy) `execute-milestone.js` already uses, cross-pinned by the same test (`milestone-worktree.test.mjs`). The worktree path convention (`milestones/M<NN>/worktrees/iteration-0`, branch `milestone/M<NN>/iteration-0`) is byte-identical to `execute-milestone.js`'s -- no prepare-scoped variants needed. Prepare always completes and removes the worktree before execute starts for the same milestone (OUTER-LOOP.md serial ordering guarantee), so the path is free by the time execute needs it. The existing `worktree-branch-hygiene-check.sh` already covers this path.

2. **Coordination-vs-content boundary (D2).** The Admission lease, epoch records, generation telemetry, and split-decision records are COORDINATION primitives -- they exist to prevent conflicting dispatches from stepping on each other and to track cumulative budget across generations. They MUST live in the primary checkout so every dispatch (regardless of worktree) can see and update them. Task body edits, plan files, receipt/ledger/inventory files, and ProposalReview checkpoints are CONTENT outputs -- the deliverable of THIS dispatch, which must be isolated from other concurrent dispatches. The boundary is: everything that needs cross-dispatch visibility stays in the primary checkout; everything that must NOT be visible to another dispatch until complete goes into the worktree. The `_admissionAgentCall`, `_convergenceAgentCall`, `_preflightAgentCall`, `_renewLease`, `_releaseLeaseAndRecord`, `_releaseLease`, `_writeGenerationTelemetry`, `_recordEpochDispatch`, and `_recordAttemptAgentCall` dispatch functions are NEVER modified to use the worktree path -- they continue operating against the primary checkout's filesystem.

3. **`task_write`/`task_get` -> CLI translation under isolation (D3).** Under worktree isolation, agents must NOT use the MCP `task_write`/`task_get` tools for task body edits because the MCP server resolves `tasks_dir` against the primary checkout's `.quay/config.yml` at server startup. Instead, the `_worktreeIsolationNote` instructs agents to `cd` to the worktree and use direct file reads/writes via Bash (`cat tasks/<id>.md`, `cat >> tasks/<id>.md`). For `task_get` specifically: ProposalReview agents that read the current Proposal (lines 1020, 1266) must read from the worktree copy (`cat $WT/tasks/<id>.md`) -- NOT from `task_get` -- because the primary checkout still has the pre-adjudicate Proposal. The `_worktreeIsolationNote` is prepended to every content-agent prompt that references `task_get` or `task_write`, instructing: `WORKTREE ISOLATION: you are operating inside a per-milestone git worktree at <path>. Read task bodies via Bash: cat <path>/tasks/<id>.md. Write task bodies via Bash: cat >> <path>/tasks/<id>.md. Never use task_get or task_write -- the MCP server reads from the primary checkout, not this worktree.` This is the SAME pattern `execute-milestone.js`'s Build phase already uses under worktree isolation.

4. **Opt-in, default-off (D4).** `isolationMode: 'worktree'` is opt-in, exactly matching `execute-milestone.js`'s posture. Omitted, empty, or unknown mode -> golden-replay legacy path (zero diffs). A REQUESTED-but-unusable mode -> fail-closed (never silently falls back), matching `execute-milestone.js`'s verified behavior. This is the same "opt-in-then-prove" phasing DIR-123 used -- the mechanism is implemented and tested first; making it the default is a SEPARATE, later decision after real concurrent dispatches have proven the mechanism on master.

5. **No Land lock in serial prepare-merge (D5).** The serial path is serial by construction (OUTER-LOOP.md hard precondition: serial prepare path never overlaps concurrent path). The Land lock serializes concurrent worktree Lands -- a serial prepare-merge that immediately merges its own worktree has no concurrent Land to race. Taking the Land lock would introduce unnecessary coupling and a potential deadlock if a serial prepare-milestone runs during a concurrent execute-milestone batch (the execute-milestone survivors hold the lock for their entire Land phase). For the concurrent path, prepare-merge is deferred to the fan-in (OUTER-LOOP.md step g), which IS serialized by the Land lock.

6. **Worktree creation BEFORE Admission (D6).** The worktree is created BEFORE the Admission `--acquire` dispatch. Creation failure returns `needs-human` WITHOUT an Admission lease being acquired -- zero coordination state is created on failure. The prepare-merge step runs AFTER Receipt success AND lease release -- a merge conflict does not strand the lease.

7. **Stranded-worktree recovery (D7).** When a worktree-isolated prepare dispatch exits mid-phase (any terminal reason: epoch breach, preflight rejection, proposal-review split/cap, etc.), the worktree and its branch are LEFT ON DISK, not auto-cleaned. The worktree preserves partial state for human inspection (the same posture as execute-milestone's stranded Build worktrees). On the NEXT retry of the same milestone, `milestone-worktree.ts --add` will fail with `worktree-path-exists`; the workflow's error-handling path dispatches `--clean-stale` which removes the stranded worktree ONLY when its branch has ZERO commits ahead of master (no real work lost). A branch WITH commits -> refuses to clean (`has-commits`), returns `needs-human` for manual reconciliation.

8. **Agent prompt routing via single module-level constant (D8).** The worktree routing prefix (`_worktreeIsolationNote`) is defined ONCE as a module-level constant and injected at every content-agent dispatch site -- grep-confirmable coverage, never a per-site hand-edit. When isolation is off, the constant is the empty string `''`, structurally guaranteeing byte-for-behavior golden replay.

**Defaults and failure behavior:**

- **Default (no `isolationMode`):** Golden-replay. Zero new dispatch sites, zero prompt changes, zero path derivation, zero worktree operations. `_worktreeIsolationNote === ''` guarantees every agent prompt is byte-identical to the current file. When `isolationMode` is `null`, `undefined`, `''`, or any value other than the literal `'worktree'`, the return shape, dispatch count, and observable behavior are byte-for-behavior identical to the current file.

- **Requested but unusable:** `isolationMode: 'worktree'` with a non-numeric milestone -> returns `needs-human` with reason `worktree-needs-numeric-milestone` BEFORE any Admission dispatch. Unknown mode (e.g., `isolationMode: 'worktre'`, a typo) -> returns `needs-human` with reason `unknown-isolation-mode`. Both fail BEFORE the Admission lease is acquired -- zero coordination state is created.

- **Worktree creation failure:** `milestone-worktree.ts --add` fails (path-exists or branch-exists from a prior crashed dispatch) -> dispatches `--clean-stale`, then retries `--add`. If `--clean-stale` returns `has-commits` (real work on the branch) -> returns `needs-human`, no lease held. If `--add` still fails after clean -> returns `needs-human`, no lease held.

- **Mid-phase failure under worktree isolation:** Any terminal exit (epoch breach, preflight rejection, proposal-review needs-human, etc.) releases the Admission lease via the EXISTING `_releaseLeaseAndRecord`/`_releaseLease` choke points and returns the existing outcome shape with ONE added field: `worktreeRel` (the relative worktree path left on disk for human inspection). The worktree branch is NOT merged, NOT removed. The next retry's `--add` will encounter the stranded worktree and follow the `--clean-stale` recovery path.

- **prepare-merge failure:** `milestone-worktree.ts --merge` encounters a real merge conflict -> `git merge --abort` runs automatically (leaves `master` clean), the lease is already released (merge happens AFTER Receipt success + lease release), worktree is left intact for human inspection, returns `needs-human` with `prepare-merge-conflict` + conflict file list.

**Concurrent path** (for OUTER-LOOP.md concurrent prepare): when dispatched with `mode === 'concurrent'`, the prepare-merge step does NOT merge, does NOT remove the worktree, does NOT take the Land lock -- it commits changes on the worktree branch and returns `buildBranch` + `worktreeRel` (mirroring `execute-milestone.js`'s concurrent Land path). The fan-in (OUTER-LOOP.md concurrent_execute step g) is the sole merge owner: under the Land lock, it merges each surviving prepare worktree via `--merge` + `--remove` before any execute-milestone dispatch.

**Compatibility:**

- **Legacy path:** `$a.isolationMode` omitted/empty/`undefined` -> `_useWorktree` is `false` -> the entire worktree block (creation, routing, merge) is skipped. All existing callers (OUTER-LOOP.md serial prepare, manual dispatches) are unaffected. Golden-replay test proves byte-for-behavior identical observable dispatch count and returned outcome/reason/phase shapes when `isolationMode` is absent.

- **Admission lease:** Unchanged -- still acquired at the same point, still released via the same `_releaseLeaseAndRecord` / `_releaseLease` choke points. The lease file lives in the primary checkout's `.quay/` directory, unchanged.

- **Admission script:** `prepare-admission-check.ts` uses `--workspace .` -- since Admission runs against the primary checkout, no change needed.

- **Convergence script:** `proposal-convergence.ts` uses `--workspace .` -- same resolution from the primary checkout. Existing flags are all workspace-relative -- they continue to work.

- **Receipt + Plan paths:** `_taskFile`, `_receiptFile`, `_planFile`, `_ledgerFile`, `_inventoryFile` are all repo-relative paths. When agents working inside the worktree write to these paths, they write to the worktree's copy. The prepare-merge step then brings those changes into the primary checkout via `git merge --no-ff`.

- **Return shapes:** Under the default (no-isolation) path, the return shape at every terminal site is byte-identical. Under worktree isolation, the success return adds `worktreeRel` (informational) and `merged` (boolean); the failure returns add `worktreeRel` (for human inspection of the stranded worktree).

**Risks:**

1. **Agent non-compliance with cd instructions (Medium).** Under worktree isolation, agents are instructed to `cd <worktree>` before file operations. If an agent ignores this instruction and edits the primary checkout instead, the isolation boundary is breached. Mitigation: (a) `execute-milestone.js`'s Build phase has already proven this pattern works with real LLM agents over many successful worktree-isolated builds; (b) the `prepare-merge` step's `git merge --no-ff` merge commit is structurally distinguishable from direct-on-master edits, enabling post-hoc verification; (c) `git diff --stat` on the primary checkout after prepare-merge shows exactly the merged changes and nothing else.

2. **`task_write` MCP tool ambiguity (Medium).** The existing prompts say "write back via `task_write`". Under worktree isolation, agents need to use the CLI instead. If an agent still calls the MCP `task_write` tool, it writes to the PRIMARY checkout's task file, breaking isolation. Mitigation: the `_worktreeIsolationNote` explicitly replaces the `task_write` instruction with `quay-native task edit` instructions. A subsequent agent dispatch that reads the task via `task_get` from the MCP (against the primary checkout) would see STALE pre-prepare content, creating a detectable inconsistency.

3. **Worktree path collision with execute-milestone (Low).** Both prepare-milestone and execute-milestone use `milestones/M<NN>/worktrees/iteration-0`. However, for the SAME milestone, prepare ALWAYS completes (and the worktree is removed by prepare-merge) before execute-milestone starts (OUTER-LOOP.md stages: SELECT -> prepare -> execute). The worktree path is free by the time execute needs it. For DIFFERENT milestones, the paths are different (M222 vs M223).

4. **Increased disk usage (Low).** Each worktree is a full checkout (~50MB for this repo). Concurrent prepares each get their own worktree, so N concurrent prepares consume N * 50MB. Negligible for the expected concurrency (2-3 parallel prepares).

5. **Agent prompt routing completeness (Medium).** Every one of the ~20 content-agent dispatch sites must carry the worktree routing instruction. A missed site silently reads/writes the primary checkout. Mitigation: `_worktreeIsolationNote` is defined ONCE as a module-level constant and referenced at every dispatch site -- grep audit confirms coverage. This is structurally verifiable, unlike hand-edited per-site strings.

**Non-goals:**

- NOT making worktree isolation the default. That is a separate decision after real concurrent proofs on master, matching DIR-123's own opt-in-then-prove posture.
- NOT changing the Admission/coordination mechanism. The existing lease, epoch, and telemetry infrastructure already correctly lives in the primary checkout.
- NOT implementing concurrent prepare dispatch in OUTER-LOOP.md. Concurrent prepare is task #22's real-landing proof scope.
- NOT adding a per-task or per-milestone file-level locking mechanism inside prepare-milestone.js. File-disjointness is checked PRE-dispatch (by `touches-orthogonality-check.ts` for concurrent batches), matching the execute-milestone guarantee.
- NOT changing how `task_write`/`task_get` MCP tools resolve paths. The CLI translation is a prompt-level instruction, not a protocol change.
- NOT creating prepare-scoped worktree paths or CLI modes on `milestone-worktree.ts`. The existing path convention and CLI flags are reused directly.
- NOT taking the Land lock in serial prepare-merge. The serial path is serial by construction (OUTER-LOOP.md hard precondition).

**AC coverage:**

- **AC1 (Legacy calls byte-for-behavior identical):** When `isolationMode` is omitted, empty, or any value other than the literal `'worktree'`, `_worktreeIsolationNote === ''` and `_useWorktree === false`. Zero new agent dispatch sites execute. All existing agent prompt strings, return shapes, and dispatch counts are unchanged. Verified by golden-replay tests using the EXISTING mocks (which never pass `isolationMode`) passing with zero diffs.

- **AC2 (Zero primary-checkout diffs until merge):** ALL content-agent phases (ProposalAuthors, Adjudicate, ProposalReview, PlanAuthor, PlanCheck, Receipt) produce zero primary-checkout diffs until prepare-merge. Every agent prompt that performs file writes carries `_worktreeIsolationNote` with `cd <worktree>` instructions. Task body edits, plan writes, and receipt writes all happen inside the worktree. Verified by: after each phase under worktree isolation, `git diff --stat` on the PRIMARY checkout shows zero changes. After prepare-merge, the primary checkout shows exactly ONE merge commit containing all prepared content.

- **AC3 (prepare-merge commits atomically):** The prepare-merge step (1) runs `git -C <worktree> add -A && git -C <worktree> commit` to capture any final receipts/ledgers written by the Receipt phase agent, (2) runs `milestone-worktree.ts --merge` which does a real `git merge --no-ff <branch>` on the primary checkout, (3) runs `milestone-worktree.ts --remove` which does `git worktree remove` + `git branch -d`. The entire merge is ONE `--no-ff` merge commit. Verified by: `git log --merges` on master shows exactly one merge commit with the worktree branch as its second parent.

- **AC4 (Worktree isolation mechanism exists):** prepare-milestone.js accepts `isolationMode: 'worktree'`, creates a real git worktree via the existing `milestone-worktree.ts --add` CLI before Admission, routes all content-agent phases (ProposalAuthors through Receipt) to the worktree path, and merges the worktree branch at prepare-merge. This is a mechanism claim, not a concurrency claim -- concurrent prepare dispatch proof is task #22's scope. Verified by: single-task dispatch with `isolationMode: 'worktree'` produces a prepared receipt and a clean merge commit on master.

- **AC5 (Failure cleanup):** On ANY non-success terminal exit under worktree isolation, (a) the Admission lease is released via the existing `_releaseLeaseAndRecord`/`_releaseLease` choke points, (b) the worktree and branch are LEFT on disk with their current content, (c) a subsequent `--add` for the same milestone detects `worktree-path-exists` and dispatches `--clean-stale`, which (d) removes the stranded worktree+branch ONLY when the branch has zero commits ahead of master, or (e) returns `has-commits` (real partial work) and refuses to clean. Verified by: unit tests covering each terminal exit site under worktree isolation, confirming the lease is released AND the worktree path still exists afterward; and a `--clean-stale` test verifying the zero-ahead-clean / has-commits-refuse contract.

- **AC6 (Coordination isolation):** Coordination state -- Admission leases (`.quay/prepare-admission/`), epoch records (`.quay/prepare-epochs/`), prepare-telemetry (`milestones/prepare-telemetry/`), and split-decision records -- is NEVER read from or written to inside the worktree. All `_admissionAgentCall`, `_convergenceAgentCall`, `_recordEpochDispatch`, `_preflightAgentCall`, `_renewLease`, `_releaseLeaseAndRecord`, `_releaseLease`, and `_recordAttemptAgentCall` dispatch functions continue operating against primary-checkout paths. Verified mechanically: `grep` for `_isolationPlan.worktreeRel` near every `_admissionAgentCall` site returns zero matches -- leases stay on the primary checkout by construction.

- **AC7 (Stranded-worktree recovery path):** `milestone-worktree.ts --add` failing with `worktree-path-exists` or `branch-exists` (from a prior crashed dispatch) triggers `--clean-stale` dispatch, then retries `--add`. `--clean-stale` removes the stranded worktree+branch ONLY when zero commits ahead of master; `has-commits` returns `needs-human`. Worktree creation failure returns `needs-human` WITHOUT an Admission lease being acquired. Verified by: unit tests covering the `--add` -> failure -> `--clean-stale` -> retry -> success path, and the `--clean-stale` refusal on `has-commits`.

- **AC8 (Concurrent-path return-shape invariants):** When dispatched with `mode === 'concurrent'`, the prepare-merge step does NOT merge, does NOT remove the worktree, and does NOT take the Land lock -- it commits changes on the worktree branch and returns `{ buildBranch, worktreeRel }`. The worktree and branch are left intact for the fan-in (task #22's merge owner). Verified by: unit tests confirming the concurrent path's return shape contains `buildBranch` (the branch name string), `worktreeRel` (the relative worktree path), NO merge commit on master, and the worktree directory still exists after return.

**Explicit alternatives considered and rejected:**

1. **Alternative: Per-task file-level locks + continue using shared checkout.** Instead of worktree isolation, add per-task-file or per-milestone-directory locking inside prepare-milestone.js. Rejected because: (a) the shared working tree's git index is the problem, not just individual files -- a `git add` in one dispatch can see uncommitted changes from another even if file CONTENTS never conflict; (b) locking is complex and fragile (deadlocks, stale locks, lock ordering); (c) `git worktree` already solves the problem correctly and completely, and execute-milestone.js already uses it successfully.

2. **Alternative: Make worktree isolation the default (remove opt-in).** Rejected because: (a) DIR-123's explicit design is opt-in-then-prove -- the mechanism is proven first, then defaulting is a separate decision; (b) diverging from execute-milestone.js's posture would create inconsistency across the two workflows; (c) the legacy golden-replay path is the safety baseline during transition.

3. **Alternative: Thread worktree path via MCP tool `cwd` parameter instead of CLI translation.** Rather than instructing agents to use `quay-native` CLI for `task_write`, add a `cwd` field to the MCP `task_write` tool. Rejected because: (a) this modifies the quay-native provider's MCP interface (out of scope for this task's Touches declaration); (b) the CLI-translation pattern is already proven in execute-milestone.js's Build phase; (c) a prompt-level instruction is simpler, more transparent, and easier to verify in golden-replay tests.

4. **Alternative: Use a separate worktree path from execute-milestone (e.g., `milestones/M<NN>/worktrees/prepare-iteration-0`).** Rejected because: (a) prepare and execute for the same milestone are strictly serialized (OUTER-LOOP.md guarantees prepare completes, worktree is removed, THEN execute starts); (b) a separate path wastes disk space and creates a SECOND naming convention to maintain; (c) the existing `worktree-branch-hygiene-check.sh` orphan-scan already covers the shared path without modification; (d) a separate path would require prepare-scoped CLI modes on `milestone-worktree.ts`, adding unnecessary abstraction.

5. **Alternative: Have the workflow create and commit into the worktree directly via shell commands instead of agent prompts.** The workflow itself performs `git worktree add` and all file writes via scripted commands, then only dispatches agents for CONTENT work. Rejected because: the workflow DSL has NO `fs`/`import`/child-process capability (confirmed by M203/DIR-126-D -- `import('node:fs')` threw at runtime). The existing `agent()`-wraps-CLI dispatch pattern is the ONLY mechanism available for filesystem operations in a workflow script.

6. **Alternative: Acquire Admission lease INSIDE the worktree.** Rejected: the Admission lease's purpose is serializing per-task access at the semantic level, not per-worktree. Two concurrent prepare-milestone dispatches for the same task should contend on the lease regardless of worktree. Acquiring from the primary checkout ensures the lease scope is correct and visible to all dispatches.

## Finding

M211's staged Build commit was swept by M212's prepare-milestone via broad `git add` on shared working tree -- the direct cause of the .halt that paused the loop. prepare-milestone currently edits task bodies, writes plans, and creates receipts directly on the shared tree with no isolation boundary. Two file-disjoint prepare-milestone tasks cannot run concurrently.

## Requested action

1. Add `isolationMode: 'worktree'` parameter (opt-in, default off)
2. Create worktree before Admission, thread path through all content-agent dispatches; coordination primitives stay in primary checkout
3. Add prepare-merge step: commit worktree -> git merge --no-ff -> remove worktree, after Receipt success and lease release
4. Real concurrent proof: two file-disjoint tasks

## Plan

See `docs/plans/M252-gap-prepare-milestone-no-worktree-isolation.md` for the full mechanical stage spec (8 stages, AC1-8 mapped, RED/GREEN commands, guardrails, rollback, real-landing verification). Standardized stopping rule: at most 3 Plan-check rounds, success only at F_i=0.

## Acceptance Criteria

- [ ] **AC1 (Legacy calls byte-for-behavior identical):** When `isolationMode` is omitted, empty, or any value other than the literal `'worktree'`, `_worktreeIsolationNote === ''` and `_useWorktree === false`. Zero new agent dispatch sites execute. All existing agent prompt strings, return shapes, and dispatch counts are unchanged. Verified by golden-replay tests using the EXISTING mocks (which never pass `isolationMode`) passing with zero diffs.
- [ ] **AC2 (Zero primary-checkout diffs until merge):** ALL content-agent phases (ProposalAuthors, Adjudicate, ProposalReview, PlanAuthor, PlanCheck, Receipt) produce zero primary-checkout diffs until prepare-merge. Every agent prompt that performs file writes carries `_worktreeIsolationNote` with `cd <worktree>` instructions. Task body edits, plan writes, and receipt writes all happen inside the worktree. Verified by: after each phase under worktree isolation, `git diff --stat` on the PRIMARY checkout shows zero changes. After prepare-merge, the primary checkout shows exactly ONE merge commit containing all prepared content.
- [ ] **AC3 (prepare-merge commits atomically):** The prepare-merge step (1) runs `git -C <worktree> add -A && git -C <worktree> commit` to capture any final receipts/ledgers written by the Receipt phase agent, (2) runs `milestone-worktree.ts --merge` which does a real `git merge --no-ff <branch>` on the primary checkout, (3) runs `milestone-worktree.ts --remove` which does `git worktree remove` + `git branch -d`. The entire merge is ONE `--no-ff` merge commit. Verified by: `git log --merges` on master shows exactly one merge commit with the worktree branch as its second parent.
- [ ] **AC4 (Worktree isolation mechanism exists):** prepare-milestone.js accepts `isolationMode: 'worktree'`, creates a real git worktree via the existing `milestone-worktree.ts --add` CLI before Admission, routes all content-agent phases (ProposalAuthors through Receipt) to the worktree path, and merges the worktree branch at prepare-merge. This is a mechanism claim, not a concurrency claim — concurrent prepare dispatch proof is task #22's scope. Verified by: single-task dispatch with `isolationMode: 'worktree'` produces a prepared receipt and a clean merge commit on master.
- [ ] **AC5 (Failure cleanup):** On ANY non-success terminal exit under worktree isolation, (a) the Admission lease is released via the existing `_releaseLeaseAndRecord`/`_releaseLease` choke points, (b) the worktree and branch are LEFT on disk with their current content, (c) a subsequent `--add` for the same milestone detects `worktree-path-exists` and dispatches `--clean-stale`, which (d) removes the stranded worktree+branch ONLY when the branch has zero commits ahead of master, or (e) returns `has-commits` (real partial work) and refuses to clean. Verified by: unit tests covering each terminal exit site under worktree isolation, confirming the lease is released AND the worktree path still exists afterward; and a `--clean-stale` test verifying the zero-ahead-clean / has-commits-refuse contract.
- [ ] **AC6 (Coordination isolation):** Coordination state — Admission leases (`.quay/prepare-admission/`), epoch records (`.quay/prepare-epochs/`), prepare-telemetry (`milestones/prepare-telemetry/`), and split-decision records — is NEVER read from or written to inside the worktree. All `_admissionAgentCall`, `_convergenceAgentCall`, `_recordEpochDispatch`, `_preflightAgentCall`, `_renewLease`, `_releaseLeaseAndRecord`, `_releaseLease`, and `_recordAttemptAgentCall` dispatch functions continue operating against primary-checkout paths. Verified mechanically: `grep` for `_isolationPlan.worktreeRel` near every `_admissionAgentCall` site returns zero matches — leases stay on the primary checkout by construction.
- [ ] **AC7 (Stranded-worktree recovery path):** `milestone-worktree.ts --add` failing with `worktree-path-exists` or `branch-exists` (from a prior crashed dispatch) triggers `--clean-stale` dispatch, then retries `--add`. `--clean-stale` removes the stranded worktree+branch ONLY when zero commits ahead of master; `has-commits` returns `needs-human`. Worktree creation failure returns `needs-human` WITHOUT an Admission lease being acquired. Verified by: unit tests covering the `--add` -> failure -> `--clean-stale` -> retry -> success path, and the `--clean-stale` refusal on `has-commits`.
- [ ] **AC8 (Concurrent-path return-shape invariants):** When dispatched with `mode === 'concurrent'`, the prepare-merge step does NOT merge, does NOT remove the worktree, and does NOT take the Land lock — it commits changes on the worktree branch and returns `{ buildBranch, worktreeRel }`. The worktree and branch are left intact for the fan-in (task #22's merge owner). Verified by: unit tests confirming the concurrent path's return shape contains `buildBranch` (the branch name string), `worktreeRel` (the relative worktree path), NO merge commit on master, and the worktree directory still exists after return.

## Definition of Done

Standard inherited-core DoD clauses apply.

## Touches

- `.claude/workflows/prepare-milestone.js`
- `plugin/workflows/prepare-milestone.js`
- `CLAUDE.md`